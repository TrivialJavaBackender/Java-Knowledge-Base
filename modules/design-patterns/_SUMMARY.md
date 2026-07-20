# Design Patterns (GoF) — Semantic Summary

## Core Model
23 паттерна GoF в трёх категориях: **порождающие** (создание объектов), **структурные** (композиция объектов), **поведенческие** (распределение обязанностей и взаимодействие). Паттерн — это ответ на вопрос «**что варьируется**» в задаче (ось изменчивости), а не украшение. Три сквозных принципа: программируй к интерфейсу, а не к реализации; предпочитай композицию наследованию; инкапсулируй то, что изменяется.

## Key Concepts
- **Порождающие**: Factory Method (подкласс выбирает продукт) · Abstract Factory (семейство продуктов) · Builder (пошаговая сборка иммутабельного объекта) · Prototype (клонирование) · Singleton (один экземпляр).
- **Структурные**: Adapter (сменить интерфейс) · Bridge (две оси) · Composite (часть-целое) · Decorator (добавить поведение) · Facade (упростить вход) · Flyweight (разделяемое состояние) · Proxy (контроль доступа).
- **Поведенческие**: Strategy · State · Template Method · Chain of Responsibility · Command · Observer · Mediator · Memento · Iterator · Visitor · Interpreter.

## Important Invariants
- Strategy и State структурно идентичны — различие в намерении и владении переходами (клиент выбирает vs объект сам переключается).
- Пять «обёрток» при похожей структуре: Adapter меняет интерфейс, Decorator добавляет поведение, Proxy контролирует доступ, Facade упрощает, Bridge разводит оси.
- Потокобезопасный Singleton: holder idiom / `enum` / DCL с `volatile`; `enum` защищён от рефлексии и десериализации.
- Visitor = double dispatch: дёшев для новых операций, дорог для новых типов (expression problem).
- Builder: иммутабельность + валидация обязательных полей в `build()`.

## Common Pitfalls
- Over-engineering («паттерн ради паттерна», patternitis) — косвенность без оси изменчивости.
- Singleton как глобальное изменяемое состояние (скрытые зависимости, нетестируемость).
- Flyweight и ловушка `==` (кэш `Integer.valueOf` -128..127).
- Decorator теряет идентичность объекта (`==`, `instanceof`).
- Fail-fast итератор → `ConcurrentModificationException` при изменении во время обхода.

## Related Modules
- **concurrency** — потокобезопасность Singleton (DCL, `volatile`, happens-before).
- **java-core** — сериализация Singleton, String pool / кэш Integer (Flyweight), sealed + pattern matching (альтернатива Visitor).
- **software-engineering** — SOLID (канонические формулировки за принципами GoF).
- **spring-frameworks** — DI как инверсия создания, Spring AOP proxy; **hibernate-jpa** — ленивый proxy.
- **system-design** — enterprise/распределённые паттерны (Circuit Breaker, Saga, CQRS) — это НЕ GoF.
