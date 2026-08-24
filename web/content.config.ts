/**
 * Mapping of repo modules to display order/title.
 * Sync only ingests modules listed here — adding a new repo module
 * requires an explicit entry to keep titles/order under user control.
 */
export interface ModuleConfig {
  slug: string;
  title: string;
  order: number;
  /** Hint for the Q&A parser when format auto-detection isn't reliable. */
  qaFormat?: 'qa-bold' | 'q-asterisk' | 'heading-as-q';
}

export const MODULES: ModuleConfig[] = [
  { slug: 'concurrency',          title: 'Java Concurrency',     order: 1, qaFormat: 'qa-bold' },
  { slug: 'kotlin-coroutines',    title: 'Kotlin Coroutines',    order: 2, qaFormat: 'qa-bold' },
  { slug: 'graphql-kotlin',       title: 'GraphQL (Kotlin)',     order: 3, qaFormat: 'qa-bold' },
  { slug: 'spring-frameworks',    title: 'Spring Frameworks',    order: 4, qaFormat: 'q-asterisk' },
  { slug: 'system-design',        title: 'System Design',        order: 5, qaFormat: 'qa-bold' },
  { slug: 'databases',            title: 'Databases',            order: 6, qaFormat: 'qa-bold' },
  { slug: 'caching-deep-dive',    title: 'Caching Deep Dive',    order: 7, qaFormat: 'heading-as-q' },
  { slug: 'infrastructure',       title: 'Infrastructure',       order: 8, qaFormat: 'qa-bold' },
  { slug: 'java-core',            title: 'Java Core (Deep)',     order: 9, qaFormat: 'qa-bold' },
  { slug: 'software-engineering', title: 'Software Engineering', order: 10, qaFormat: 'qa-bold' },
  { slug: 'hibernate-jpa',        title: 'Hibernate & JPA',      order: 11, qaFormat: 'qa-bold' },
  { slug: 'go',        title: 'Golang',      order: 12, qaFormat: 'qa-bold' },
  { slug: 'design-patterns',      title: 'Design Patterns (GoF)', order: 13, qaFormat: 'qa-bold' },
  { slug: 'ddd',                  title: 'Domain-Driven Design', order: 14, qaFormat: 'qa-bold' },
  { slug: 'engineering-process',  title: 'Engineering Process',  order: 15, qaFormat: 'qa-bold' },
];
