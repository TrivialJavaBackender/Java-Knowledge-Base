# Java Serialization

---

## 1. Серилизация в Java: история и почему её больше не любят

В 1997 году, когда Sun добавляла serialization в Java 1.1, она казалась удачной идеей: маркер-интерфейс `Serializable`, и любой объект можно записать в поток / прочитать обратно. RMI, EJB, distributed Java — всё строилось на этом. Никакого XML / JSON / Protobuf тогда не было.

К 2010-м начали накапливаться проблемы:
1. **Безопасность**: deserialization gadget chains (Apache Commons Collections в 2015) — серьёзные RCE-уязвимости.
2. **Performance**: serialization медленнее JSON (на удивление).
3. **Versioning**: добавил поле — старый формат не читается без extra dance.
4. **Lock-in**: формат — Java-only, не interoperable с другими языками.
5. **Object graph reflection** — медленно, не cache-friendly.

К 2015 году большинство микросервисов перешли на JSON (Jackson) или Protobuf для inter-service communication. Java Serialization осталась в legacy-системах и Hazelcast/Apache Ignite (для cache замены), но **не рекомендуется для новых проектов**.

Brian Goetz и команда Java называли её «**one of the worst decisions** ever made in Java» (на JVM Language Summit 2020). Идут разговоры о **deprecation for removal** в будущем, но пока без firm timeline.

> Brian Goetz, [*Towards Better Serialization*](https://cr.openjdk.org/~briangoetz/amber/serialization.html) — почему нужна замена.

---

## 2. `java.io.Serializable` — базовый механизм

Маркер-интерфейс. Если класс реализует — `ObjectOutputStream.writeObject(obj)` сериализует его в **бинарный формат** (документирован в *Object Serialization Specification*).

```java
class User implements Serializable {
    private static final long serialVersionUID = 1L;
    private final long id;
    private final transient String password;   // не сериализуется
}

// Запись:
try (ObjectOutputStream oos = new ObjectOutputStream(out)) {
    oos.writeObject(user);
}

// Чтение:
try (ObjectInputStream ois = new ObjectInputStream(in)) {
    User u = (User) ois.readObject();
}
```

### 2.1. Что попадает в сериализацию

JDK serialization включает:
- Все non-static, non-transient поля (включая private);
- Наследников (если superclass не Serializable — должен иметь no-arg constructor);
- Circular references (через `serialIdentityHashMap` — каждый объект сериализуется один раз);
- Объекты по составу (deep clone).

### 2.2. `transient` — пропустить поле

```java
class Session implements Serializable {
    long id;
    transient Logger logger;       // не сериализуется
    transient String temporaryToken;
}
```

`Logger` — обычно DI-инжектированный, не имеет смысла сериализовать. `transient` поле после deserialization будет `null` / `0` / `false`.

### 2.3. `Externalizable` — manual control

```java
class Foo implements Externalizable {
    public Foo() {}    // public no-arg ОБЯЗАТЕЛЕН (для deserialization)
    
    @Override
    public void writeExternal(ObjectOutput out) throws IOException {
        out.writeUTF(this.name);
        out.writeInt(this.age);
    }
    
    @Override
    public void readExternal(ObjectInput in) throws IOException, ClassNotFoundException {
        this.name = in.readUTF();
        this.age = in.readInt();
    }
}
```

Различия от `Serializable`:
- Ты пишешь **всё** — нет defaults;
- Public no-arg constructor **обязателен**;
- Быстрее (без reflection), но более fragile;
- Никакой backward compatibility automatic — ты сам управляешь.

Редко используется напрямую — обычно serialization proxy лучше (см. §5).

---

## 3. `serialVersionUID`

```java
private static final long serialVersionUID = 1L;
```

При чтении сериализованного объекта `ObjectInputStream` сравнивает UID stream'а с UID текущего класса. Не совпало → `InvalidClassException`.

Если не указать — компилятор **вычисляет** UID из структуры класса (полей, методов). Любое изменение → новый UID → старые сериализованные данные не прочитать.

**Правила**:
- Всегда явно указывать (`1L` начало, инкрементировать при breaking-change в формате);
- IDE генерирует (`Alt+Enter` в IntelliJ);
- `serialver` JDK tool тоже считает.

### 3.1. Версионирование схемы

Без явного UID — обычный refactor (rename поля, add private method) ломает deserialization. С явным UID — JVM проверяет только структурную совместимость:
- Добавил поле → старые данные ОК, поле = default;
- Удалил поле → старые данные ОК, удалённое значение игнорируется;
- Изменил тип → InvalidClassException;
- Удалил/добавил interface → ОК.

Это не полная schema evolution, но базовая backward compat работает.

---

## 4. `writeObject` / `readObject` — custom format

Класс может **переопределить** как себя сериализовать:

```java
class CachedData implements Serializable {
    private static final long serialVersionUID = 1L;
    private final List<Item> items;
    private transient Map<String, Item> indexCache;   // recomputed on deserialization

    private void writeObject(ObjectOutputStream out) throws IOException {
        out.defaultWriteObject();   // serialize non-transient fields normally
        out.writeInt(items.size());
        // ... extra custom data
    }

    private void readObject(ObjectInputStream in) throws IOException, ClassNotFoundException {
        in.defaultReadObject();
        int size = in.readInt();
        // ... reconstruct
        rebuildIndex();   // populate transient indexCache
    }

    private void rebuildIndex() {
        indexCache = items.stream().collect(Collectors.toMap(Item::id, Function.identity()));
    }
}
```

Использования:
- Lazy-init transient полей после чтения (kэши, indices);
- Обработка format-evolution (`if (version >= 2) readNewField()`);
- Конвертация старого формата в новый.

Эти методы — `private` (по конвенции), JVM находит их через reflection.

---

## 5. `writeReplace` / `readResolve` — substitution

### 5.1. `writeReplace` — заменить writing object

```java
class Money implements Serializable {
    private final BigDecimal amount;
    private final Currency currency;
    
    private Object writeReplace() {
        return new SerializationProxy(this);   // вместо Money сериализуется proxy
    }
    
    // SerializationProxy implements Serializable, описывает stable format
}
```

### 5.2. `readResolve` — заменить deserialized instance

Главное применение — **enum-safe singleton**:

```java
class Singleton implements Serializable {
    static final Singleton INSTANCE = new Singleton();
    private Singleton() {}
    
    private Object readResolve() {
        return INSTANCE;   // вместо нового объекта — вернуть singleton
    }
}
```

Без `readResolve` каждая десериализация создавала бы **новый** объект, ломая singleton invariant. `enum` не имеет этой проблемы — JLS гарантирует уникальность enum constants даже при deserialization.

---

## 6. Serialization Proxy Pattern — Bloch idiom

Для сложных immutable классов с invariant'ами:

```java
class Period implements Serializable {
    private final Date start, end;
    
    public Period(Date start, Date end) {
        if (start.compareTo(end) > 0) throw new IllegalArgumentException();
        this.start = start;
        this.end = end;
    }
    
    // Заменяем себя на proxy при сериализации
    private Object writeReplace() { return new SerProxy(this); }
    
    // Защита от bypassing proxy
    private void readObject(ObjectInputStream s) throws InvalidObjectException {
        throw new InvalidObjectException("Use proxy");
    }
    
    private static class SerProxy implements Serializable {
        private static final long serialVersionUID = 1L;
        private final Date start, end;
        
        SerProxy(Period p) { this.start = p.start; this.end = p.end; }
        
        // Деserialization возвращает Period (с validation в конструкторе!)
        private Object readResolve() { return new Period(start, end); }
    }
}
```

Защищает от:
- **Bypassing constructor** — обычная deserialization обходит конструктор → invariant'ы не проверяются;
- **Mutating transient state** через `readObject` injection;
- **Inconsistent state** между deserialization и use.

Bloch (Effective Java item 90) считает это **default approach** для serializable классов с invariant'ами.

---

## 7. Уязвимости deserialization

### 7.1. Главная проблема

`ObjectInputStream.readObject` **выполняет произвольный код** — `readObject`/`readResolve` методы любого класса в classpath. Если атакующий контролирует stream — он может выбрать **gadget chain**: последовательность классов, чьи `readObject` побочно вызывают `Runtime.exec` или эквивалент.

### 7.2. CommonsCollections1 — классический gadget chain

```
InvokerTransformer → ChainedTransformer → LazyMap → AnnotationInvocationHandler
```

Десериализация специально сконструированного `LazyMap.get(key)` триггерит цепочку:
1. `LazyMap.get` — если key отсутствует, вызывает `transformer.transform(key)`;
2. `ChainedTransformer.transform` — последовательно вызывает array transformers;
3. `InvokerTransformer.transform` — через reflection вызывает arbitrary method.

Атакующий конструирует:
```
ChainedTransformer:
  - new ConstantTransformer(Runtime.class)
  - new InvokerTransformer("getMethod", ...)   → Runtime.getMethod("exec", ...)
  - new InvokerTransformer("invoke", ...)       → exec.invoke(...)
  - new InvokerTransformer("exec", ...)         → exec("calc")
```

Когда атакующий присылает blob через HTTP cookie / JNDI / RMI — RCE.

### 7.3. Influenced systems

CVE-2015-4852 (Apache Commons Collections) impacted:
- **WebLogic** — accepted Java-serialized в T3 protocol;
- **JBoss** — JMX-Console with serialized parameters;
- **OpenNMS** — RMI server;
- **Jenkins** — slave connection;
- **Solr** — accepted ObjectStream через HTTP;
- **много другого**.

И это **только один** gadget chain. Известны Spring framework gadgets, Groovy runtime, Hibernate proxies.

**ysoserial** ([github.com/frohoff/ysoserial](https://github.com/frohoff/ysoserial)) — public tool, генерирующий payloads. Penetration testing tool, который любой может использовать.

---

## 8. Защита

### 8.1. Не принимать Java serialization от untrusted

Главная защита. Переход на JSON / Protobuf для inter-service данных. Java serialization — только для internal trusted communication (например, Hazelcast cluster nodes, где сетевой trust уже установлен).

### 8.2. Serialization filter (JEP 290, Java 9+)

```java
ObjectInputFilter filter = ObjectInputFilter.Config.createFilter(
    "java.util.*;java.lang.*;com.example.*;!*"   // whitelist
);
ois.setObjectInputFilter(filter);
```

Filter syntax:
- `pkg.*` — allow package and subpackages;
- `class.X` — allow specific class;
- `!*` — deny everything else (must end with this);
- `maxbytes=10000` — limit total size;
- `maxdepth=20` — limit graph depth.

Или JVM-флаг `-Djdk.serialFilter="..."` — глобально для всей JVM.

**Best practice**: «default deny»:
```
-Djdk.serialFilter=!*
```

И per-stream allowing нужного:
```java
filter = ObjectInputFilter.Config.createFilter("com.example.dto.*;java.lang.String;!*");
```

> [JEP 290: Serialization Filter](https://openjdk.org/jeps/290).

### 8.3. Context-specific filter (JEP 415, Java 17+)

Расширение JEP 290 для **per-stream** filter factory:

```java
ObjectInputFilter.Config.setSerialFilterFactory((cur, next) -> {
    if (currentContext.isHigh()) return strictFilter;
    return lenientFilter;
});
```

Позволяет адаптивную фильтрацию по контексту. Тонкая настройка для multi-tenant систем.

---

## 9. Records и serialization

`record` имеет специальный механизм serialization:
- Сериализуется по `RecordComponent`s через **canonical constructor**;
- `writeObject` / `readObject` **не работают** (нельзя customize);
- `serialPersistentFields` игнорируется;
- Защищён от gadget chain в самом классе (canonical constructor должен пройти validation).

```java
public record User(long id, String email) implements Serializable {
    private static final long serialVersionUID = 1L;
    
    public User {
        if (email == null) throw new NullPointerException();
    }
}

// При deserialization компилятор:
// 1. Читает (id, email) из stream;
// 2. Вызывает canonical constructor (с validation);
// 3. Если validation падает → InvalidObjectException, объект не создан.
```

Это **сознательное** дизайн-решение Brian Goetz: records — value-objects, нельзя обходить invariant'ы через deserialization. Это **главное** преимущество records для serialization.

---

## 10. Альтернативы Java Serialization

| Формат | Преимущества | Недостатки | Использования |
|---|---|---|---|
| **JSON** (Jackson, Gson) | Человекочитаемый, language-agnostic, ubiquitous | Verbose, slower, no schema | REST APIs, configs, logs |
| **Protobuf** (Google) | Binary, schema evolution, fast, language-agnostic | Надо описывать `.proto`, codegen | gRPC, microservices |
| **Avro** (Apache) | Binary, schema reside в data, Kafka-friendly | Overhead schema-resolution, runtime cost | Kafka topics, Hadoop |
| **MessagePack** | Compact JSON-like binary | Smaller ecosystem | IoT, mobile |
| **Kryo** | Очень быстрый Java-only binary | Как и Java ser, vulnerable to gadgets без filter | Hazelcast, Apache Ignite, ScalaXxx |
| **CBOR** | Binary JSON, IoT-friendly | Поменьше распространён | Constrained networks |

Современные рекомендации:
- **Inter-service RPC**: gRPC + Protobuf;
- **REST API**: JSON через Jackson;
- **Event streaming (Kafka)**: Avro или Protobuf с Schema Registry;
- **Distributed cache** (Hazelcast, Ignite): Kryo (с filter!) или Protobuf;
- **Java native serialization**: **только legacy**, никогда для нового кода.

---

## 11. Practical advice

1. **Never** trust untrusted serialized input → JEP 290 filter (или совсем не используй).
2. В современном dev — Jackson / Protobuf, не Serializable.
3. Если уж приходится — use serialization proxy pattern + filter + tests.
4. Records — auto-safe, но используй только для DTO.
5. Helpful tool: **ysoserial** для тестирования (penetration testing — на свой код).
6. JNDI lookup — `-Dcom.sun.jndi.ldap.object.trustURLCodebase=false` (Log4Shell-эпоха).
7. Все frameworks (Spring, Jackson) рекомендуют **default deny** в JEP 290.

---

## 12. Что обязательно знать на собесе

1. **`serialVersionUID`** — зачем нужен, что происходит без него.
2. **`transient`** — что делает.
3. **`writeObject` / `readObject`** — кастомный формат.
4. **`writeReplace` / `readResolve`** — substitution patterns, enum-safe singleton.
5. **Serialization proxy pattern** — для immutable классов с invariant'ами.
6. **Gadget chain** — что это, пример CommonsCollections1.
7. **JEP 290 filter** — основная защита.
8. **JEP 415 context-specific filter** — расширение.
9. **Records и serialization** — почему safer.
10. **Альтернативы** (Protobuf, Avro, JSON) — когда какая.

---

## Related

- Records и canonical constructor → [`MODERN_JAVA_FEATURES.md`](MODERN_JAVA_FEATURES.md)
- Secrets management и encrypted storage → [`modules/system-design/theory/secrets_management.md`](../../system-design/theory/secrets_management.md)
- Object invariants и constructor → [`EQUALS_HASHCODE_COMPARABLE.md`](EQUALS_HASHCODE_COMPARABLE.md)
- ClassLoader и `Class.forName` в deserialization → [`CLASS_LOADERS.md`](CLASS_LOADERS.md)

### Внешние ресурсы

- **Joshua Bloch, *Effective Java*** — Items 85-90 про serialization (especially 90: serialization proxy).
- **Brian Goetz, *Towards Better Serialization***: <https://cr.openjdk.org/~briangoetz/amber/serialization.html>
- **JEP 290 Serialization Filter**: <https://openjdk.org/jeps/290>
- **JEP 415 Context-Specific Deserialization Filters**: <https://openjdk.org/jeps/415>
- **ysoserial GitHub**: <https://github.com/frohoff/ysoserial>
- **CWE-502: Deserialization of Untrusted Data**: <https://cwe.mitre.org/data/definitions/502.html>
- **Foxglove Security (CommonsCollections1 history)**: <https://foxglovesecurity.com/2015/11/06/what-do-weblogic-websphere-jboss-jenkins-opennms-and-your-application-have-in-common-this-vulnerability/>
- **OWASP Deserialization Cheat Sheet**: <https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html>
