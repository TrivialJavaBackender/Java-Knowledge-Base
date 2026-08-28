/**
 * Витринные однострочные описания модулей для шапки страницы модуля.
 * В базе такого текста нет и заводить его не планируется — это чисто
 * отображаемый текст, вручную сжатый из колонки «Тема» таблицы «Структура»
 * в корневом CLAUDE.md. Обновлять вручную при правке той таблицы.
 * Модуль без записи здесь просто не показывает блок описания.
 */
export const MODULE_DESCRIPTIONS: Record<string, string> = {
  concurrency: 'Java Concurrency: JUC, потоки, локи, атомики + прикладная практика на Java.',
  'kotlin-coroutines': 'Kotlin Coroutines: suspend, Flow, Channel, структурная конкурентность.',
  'graphql-kotlin': 'GraphQL на Kotlin: graphql-kotlin, DataLoader, Federation.',
  'spring-frameworks': 'Spring Core/Boot/MVC/Data/Security/Cloud.',
  'system-design': 'System Design: подготовка к собеседованиям, теория и design-задачи.',
  databases: 'Транзакции, индексы, типы БД, storage engines, репликация, шардирование.',
  'caching-deep-dive': 'Кэширование: CPU → JVM → Caffeine → Redis → CDN.',
  infrastructure: 'Docker, Kubernetes, Helm, наблюдаемость, логирование, метрики, секреты/Vault/mTLS.',
  'java-core': 'Java Core в деталях: GC, JIT, class loading, JPMS, байткод, современные фичи.',
  'software-engineering': 'SOLID/OOP, Stream API и принципы FP, практики тестирования.',
  'hibernate-jpa': 'Hibernate/JPA: жизненный цикл, маппинг, fetch/N+1, кэш L1/L2, блокировки, JPQL.',
  go: 'Go с нуля: синтаксис, интерфейсы, горутины/каналы, GMP-шедулер, GC, дженерики + упражнения.',
  'design-patterns': 'Паттерны GoF, UML, GRASP, сравнения, антипаттерны + упражнения на Java.',
  ddd: 'Domain-Driven Design: стратегическое и тактическое моделирование, архитектура, интеграция.',
  'engineering-process': 'Процессы разработки: роли, бэклог, оценки, Scrum, ветвление, техдолг, инциденты, метрики.',
  microservices: 'Микросервисы: границы, отказоустойчивость, события, данные, сага/Outbox, CQRS, контракты, mesh.',
};
