# SOLID и OOP принципы

## 1. S — Single Responsibility Principle

Класс/модуль должен иметь **одну причину для изменения**.

```java
// Плохо: UserService и отправляет email, и сохраняет в БД, и форматирует
class UserService {
    void register(User user) {
        validate(user);
        db.save(user);
        emailClient.sendWelcome(user.email()); // ← другая ответственность
        auditLog.record("registered", user);   // ← третья
    }
}

// Хорошо: каждый класс — одна ответственность
class UserService {
    void register(User user) {
        validate(user);
        userRepo.save(user);
        eventBus.publish(new UserRegistered(user)); // другие сервисы подписываются
    }
}
```

---

## 2. O — Open/Closed Principle

Открыт для расширения, закрыт для изменения. Новое поведение — через новые классы, а не правку существующих.

```java
// Плохо: каждый новый тип скидки меняет метод
double calcDiscount(Order order) {
    if (order.type == STUDENT) return 0.1;
    if (order.type == VIP) return 0.2;
    // добавление нового типа → правим этот метод
}

// Хорошо: стратегия через интерфейс
interface DiscountStrategy {
    double apply(Order order);
}
class StudentDiscount implements DiscountStrategy { ... }
class VipDiscount implements DiscountStrategy { ... }
// Новый тип → новый класс, метод не трогаем
```

---

## 3. L — Liskov Substitution Principle

Подтип должен быть полностью заменяем родительским типом без нарушения корректности программы.

```java
// Нарушение: Rectangle → Square
class Rectangle { setWidth(w); setHeight(h); }
class Square extends Rectangle {
    void setWidth(w) { super.setWidth(w); super.setHeight(w); } // меняет оба!
    void setHeight(h) { super.setWidth(h); super.setHeight(h); }
}

// Тест, который ломается при подстановке Square вместо Rectangle:
Rectangle r = new Square();
r.setWidth(5); r.setHeight(3);
assert r.area() == 15; // FAIL: Square.area() = 9

// Решение: не наследоваться, использовать общий интерфейс Shape
```

**Контракты:** LSP требует не усиливать предусловия (принимать меньше), не ослаблять постусловия (возвращать меньше), не бросать новые исключения.

---

## 4. I — Interface Segregation Principle

Клиент не должен зависеть от методов, которые не использует. Много узких интерфейсов лучше одного толстого.

```java
// Плохо: один интерфейс Worker с методами, не нужными всем
interface Worker { void work(); void eat(); void sleep(); }
class Robot implements Worker {
    void eat() { throw new UnsupportedOperationException(); } // Robot не ест!
}

// Хорошо: разбить на узкие интерфейсы
interface Workable { void work(); }
interface Eatable  { void eat(); }
class Human implements Workable, Eatable { ... }
class Robot implements Workable { ... }
```

---

## 5. D — Dependency Inversion Principle

1. Модули высокого уровня не должны зависеть от низкоуровневых — оба зависят от **абстракции**.
2. Абстракции не должны зависеть от деталей — детали зависят от абстракций.

```java
// Плохо: UserService зависит от конкретного MySQLUserRepository
class UserService {
    private MySQLUserRepository repo = new MySQLUserRepository(); // конкретика
}

// Хорошо: зависимость от интерфейса, конкретику внедряют снаружи
interface UserRepository { User findById(long id); void save(User user); }

class UserService {
    private final UserRepository repo; // абстракция
    UserService(UserRepository repo) { this.repo = repo; } // DI
}

// В prod: new UserService(new MySQLUserRepository())
// В тесте: new UserService(new InMemoryUserRepository())
```

---

## 6. DIP и Jackson — реальный пример с собеседования

**Вопрос:** является ли прямая зависимость на `ObjectMapper` (Jackson) нарушением Dependency Inversion?

```java
// Нарушение DIP: сервис знает про Jackson
class OrderService {
    private final ObjectMapper mapper = new ObjectMapper(); // Jackson конкретика

    String serialize(Order order) throws JsonProcessingException {
        return mapper.writeValueAsString(order);
    }
}
```

**Проблемы:**
- Нельзя заменить Jackson на Gson или другой сериализатор без правки `OrderService`
- Тяжело тестировать без реального Jackson
- Нарушает принцип: высокоуровневый сервис зависит от низкоуровневой детали

**Решение — Adapter через интерфейс:**

```java
// 1. Абстракция (принадлежит слою domain/application)
interface Serializer {
    String serialize(Object obj);
    <T> T deserialize(String json, Class<T> clazz);
}

// 2. Адаптер (принадлежит слою infrastructure)
class JacksonSerializer implements Serializer {
    private final ObjectMapper mapper = new ObjectMapper();

    @Override
    public String serialize(Object obj) {
        try {
            return mapper.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            throw new SerializationException(e);
        }
    }

    @Override
    public <T> T deserialize(String json, Class<T> clazz) {
        try {
            return mapper.readValue(json, clazz);
        } catch (JsonProcessingException e) {
            throw new SerializationException(e);
        }
    }
}

// 3. Сервис зависит от абстракции
class OrderService {
    private final Serializer serializer; // не знает про Jackson

    OrderService(Serializer serializer) { this.serializer = serializer; }

    String exportOrder(Order order) {
        return serializer.serialize(order);
    }
}

// 4. Сборка
new OrderService(new JacksonSerializer()); // в Spring: @Bean
```

**Паттерн Adapter** — оборачивает несовместимый интерфейс (Jackson API) за целевой интерфейс (`Serializer`). Клиент (`OrderService`) работает с целевым интерфейсом.

```
OrderService → Serializer (interface)
                    ↑
             JacksonSerializer (adapter)
                    ↑
             ObjectMapper (adaptee)
```

---

## Источники

**Books:**
- *Clean Architecture* (Robert C. Martin, Prentice Hall 2017) — формулировка SOLID, Dependency Rule.
- *Agile Software Development: Principles, Patterns, and Practices* (Robert C. Martin, 2002) — оригинальные эссе по SOLID.
- *Patterns of Enterprise Application Architecture* (Martin Fowler, Addison-Wesley 2002) — Adapter, Repository, Unit of Work.
- *Effective Java*, 3rd ed. (Joshua Bloch, 2018) — Item 18 (composition over inheritance), 64 (interfaces, not classes).
- *Refactoring*, 2nd ed. (Martin Fowler, 2018) — практический контекст SOLID-изменений в коде.

**Papers:**
- [Liskov, Wing (1994) — «A Behavioral Notion of Subtyping» (ACM TOPLAS)](https://www.cs.cmu.edu/~wing/publications/LiskovWing94.pdf) — формальное определение LSP (контракты, инварианты).
- [Robert C. Martin — «The Single Responsibility Principle» (objectmentor PDF, 2003)](https://web.archive.org/web/20150202200348/http://www.objectmentor.com/resources/articles/srp.pdf) — оригинальное эссе.
