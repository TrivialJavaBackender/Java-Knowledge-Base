# Design Patterns (GoF) — Interview Prep

Модуль для подготовки к собеседованиям по паттернам проектирования «Банды четырёх»
(Gang of Four). Покрывает все 23 канонических паттерна, их UML-структуру, применимость,
современные аналоги на Java/Kotlin и типичные ошибки — на уровне backend-разработчика.

## Структура проекта

```
├── ROADMAP.md                 # порядок прохождения теории + чеклисты
├── INTERVIEW_QUESTIONS.md     # вопросы с ответами (формат qa-bold)
│
├── theory/                    # теория по категориям паттернов
│   ├── INTRO.md               # таксономия, UML, принципы GoF, GRASP, когда применять
│   ├── CREATIONAL.md          # Factory Method, Abstract Factory, Builder, Prototype, Singleton
│   ├── STRUCTURAL.md          # Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy
│   ├── BEHAVIORAL_1.md        # Strategy, State, Template Method, Chain of Responsibility
│   ├── BEHAVIORAL_2.md        # Command, Observer, Mediator, Memento
│   ├── BEHAVIORAL_3.md        # Iterator, Visitor, Interpreter
│   ├── COMPARISONS.md         # попарный выбор между похожими паттернами
│   └── ANTIPATTERNS.md        # over-engineering, God Object, code smells
│
└── src/
    ├── main/java/exercises/   # ExNN_*.java — стартовые упражнения
    └── test/java/exercises/   # JUnit 5 тесты к упражнениям
```

## Темы

| Категория | Паттерны | Теория |
|-----------|----------|--------|
| Введение | Таксономия, UML, принципы, GRASP | [INTRO](theory/INTRO.md) |
| Порождающие | Factory Method, Abstract Factory, Builder, Prototype, Singleton | [CREATIONAL](theory/CREATIONAL.md) |
| Структурные | Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy | [STRUCTURAL](theory/STRUCTURAL.md) |
| Поведенческие I | Strategy, State, Template Method, Chain of Responsibility | [BEHAVIORAL_1](theory/BEHAVIORAL_1.md) |
| Поведенческие II | Command, Observer, Mediator, Memento | [BEHAVIORAL_2](theory/BEHAVIORAL_2.md) |
| Поведенческие III | Iterator, Visitor, Interpreter | [BEHAVIORAL_3](theory/BEHAVIORAL_3.md) |
| Сравнения | Strategy vs State, Factory vs Builder, … | [COMPARISONS](theory/COMPARISONS.md) |
| Антипаттерны | over-engineering, God Object, code smells | [ANTIPATTERNS](theory/ANTIPATTERNS.md) |

## Как работать

Упражнения лежат в `src/main/java/exercises/` как классы с `TODO`. Реализуй решение,
затем попроси Claude проверить:

```
"проверь design-patterns Ex01"   — проверка реализации + code review
"следующий"                       — следующая тема теории по ROADMAP
"квиз"                            — 5 случайных вопросов из INTERVIEW_QUESTIONS.md
```

## Стек

- Java 21
- Maven 3.9
- JUnit 5 (Jupiter)

## Сборка и запуск

```bash
cd modules/design-patterns

mvn -q clean test-compile   # проверить, что скелет и тесты компилируются
mvn -q test                 # прогнать тесты (нерешённые упражнения ожидаемо КРАСНЫЕ)
mvn -q -Dtest=Ex01_HttpRequestBuilderTest test   # один конкретный тест
```

## Code review — на что смотреть

- **Соответствие ролям паттерна.** Участники (например, Strategy/Context, Subject/Observer,
  Component/Composite) присутствуют и имеют правильные обязанности; намерение паттерна
  выдержано, а не имитируется.
- **Композиция вместо наследования.** Поведение выносится в делегатов, а не «зашивается»
  в глубокую иерархию наследования.
- **Инкапсуляция изменяемого.** То, что варьируется, спрятано за интерфейсом; клиент
  программирует к абстракции, а не к реализации.
- **Потокобезопасность Singleton.** Корректная ленивая инициализация (holder idiom / enum /
  double-checked locking с `volatile`), без гонок при первой инициализации.
- **Иммутабельность и валидация Builder.** Собранный объект неизменяем (защитные копии),
  обязательные поля проверяются в `build()`.
- **Отсутствие over-engineering.** Паттерн решает реальную проблему изменяемости, а не
  добавлен «потому что паттерн»; нет лишних уровней косвенности.

## Источники

- *Design Patterns: Elements of Reusable Object-Oriented Software* — Gamma, Helm, Johnson, Vlissides (GoF)
- *Head First Design Patterns* — Freeman & Robson
- *Effective Java* (3rd ed.) — Joshua Bloch (Builder, Singleton, статические фабрики)
- *Refactoring* — Martin Fowler (code smells)
- refactoring.guru — иллюстрированный справочник паттернов
