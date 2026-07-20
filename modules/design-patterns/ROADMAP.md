# design-patterns — Roadmap

## Порядок прохождения

| Приоритет | Тема | Частота на собесах |
|-----------|------|--------------------|
| 1 | Введение: таксономия, UML, принципы GoF, GRASP | ★★★★ |
| 2 | Порождающие: Factory Method, Abstract Factory, Builder, Prototype, Singleton | ★★★★★ |
| 3 | Структурные: Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy | ★★★★★ |
| 4 | Поведенческие I: Strategy, State, Template Method, Chain of Responsibility | ★★★★★ |
| 5 | Поведенческие II: Command, Observer, Mediator, Memento | ★★★★ |
| 6 | Поведенческие III: Iterator, Visitor, Interpreter | ★★★ |
| 7 | Сравнения похожих паттернов (выбор на собесе) | ★★★★ |
| 8 | Антипаттерны и code smells | ★★★ |

---

## Модуль 1: Введение

📖 Теория: [theory/INTRO.md](theory/INTRO.md)

- [ ] Три категории: порождающие / структурные / поведенческие
- [ ] Как читать UML-диаграммы классов и последовательностей для паттернов
- [ ] Принципы GoF: программируй к интерфейсу; предпочитай композицию наследованию; инкапсулируй изменяемое
- [ ] GRASP-обязанности (Information Expert, Creator, Controller, Low Coupling, High Cohesion)
- [ ] Связь с SOLID (канон — в `software-engineering`)
- [ ] Когда паттерн уместен, а когда это over-engineering

---

## Модуль 2: Порождающие паттерны

📖 Теория: [theory/CREATIONAL.md](theory/CREATIONAL.md)

- [ ] Factory Method — делегирование создания подклассам
- [ ] Abstract Factory — семейства согласованных объектов
- [ ] Builder — пошаговая сборка сложных иммутабельных объектов
- [ ] Prototype — клонирование вместо конструирования
- [ ] Singleton — единственный экземпляр (потокобезопасность, сериализация)

---

## Модуль 3: Структурные паттерны

📖 Теория: [theory/STRUCTURAL.md](theory/STRUCTURAL.md)

- [ ] Adapter — согласование несовместимых интерфейсов
- [ ] Bridge — разделение абстракции и реализации
- [ ] Composite — древовидные структуры «часть-целое»
- [ ] Decorator — динамическое добавление обязанностей
- [ ] Facade — упрощённый фасад над подсистемой
- [ ] Flyweight — разделение состояния для экономии памяти
- [ ] Proxy — заместитель (ленивый / защитный / удалённый)

---

## Модуль 4: Поведенческие паттерны I

📖 Теория: [theory/BEHAVIORAL_1.md](theory/BEHAVIORAL_1.md)

- [ ] Strategy — взаимозаменяемые алгоритмы
- [ ] State — поведение зависит от состояния
- [ ] Template Method — скелет алгоритма с переопределяемыми шагами
- [ ] Chain of Responsibility — цепочка обработчиков

---

## Модуль 5: Поведенческие паттерны II

📖 Теория: [theory/BEHAVIORAL_2.md](theory/BEHAVIORAL_2.md)

- [ ] Command — инкапсуляция запроса как объекта (undo/redo)
- [ ] Observer — подписка на изменения (эволюция в реактивность)
- [ ] Mediator — централизация взаимодействия объектов
- [ ] Memento — снимок состояния без нарушения инкапсуляции

---

## Модуль 6: Поведенческие паттерны III

📖 Теория: [theory/BEHAVIORAL_3.md](theory/BEHAVIORAL_3.md)

- [ ] Iterator — обход коллекции без раскрытия структуры
- [ ] Visitor — новые операции над иерархией без её изменения
- [ ] Interpreter — грамматика и её интерпретация

---

## Модуль 7: Сравнения паттернов

📖 Теория: [theory/COMPARISONS.md](theory/COMPARISONS.md)

- [ ] Strategy vs State vs Template Method
- [ ] Factory Method vs Abstract Factory vs Builder
- [ ] Adapter vs Bridge vs Proxy vs Decorator
- [ ] Command vs Strategy, Composite + Visitor, Observer vs Mediator
- [ ] Как обосновать выбор паттерна на собеседовании

---

## Модуль 8: Антипаттерны

📖 Теория: [theory/ANTIPATTERNS.md](theory/ANTIPATTERNS.md)

- [ ] Over-engineering и «паттерн ради паттерна»
- [ ] God Object, anemic domain model, poltergeist, golden hammer
- [ ] Злоупотребление Singleton как глобальным состоянием
- [ ] Code smells (по Фаулеру) и рефакторинг к паттернам
