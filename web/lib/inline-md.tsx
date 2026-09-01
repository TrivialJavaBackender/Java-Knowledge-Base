import { Fragment } from 'react';

/**
 * Заголовки и вопросы приходят из markdown-исходников в modules/ и содержат
 * инлайн-разметку: `synchronized`, `notify()`, **важно**. 168 из 704 вопросов и
 * часть заголовков теории — с обратными кавычками. Раньше они выводились как
 * есть в JSX и читались как «Чем отличается `Runnable` от `Callable`?» —
 * кавычки на экране, во всех списках сразу.
 *
 * Полный markdown-рендер тут не годится: это однострочные подписи внутри
 * ссылок и кнопок, а рендер выдаёт блочный `<p>` и (для ссылок) вложенный
 * интерактив. Поэтому — минимальный инлайн-разбор: код и жирный, остальное
 * как текст.
 *
 * Для мест, где нужен именно plain text (атрибут `title`, `<option>`,
 * подсчёт длины), есть `headingText` в lib/slugify.ts.
 */

/** `code` и **bold** — единственная разметка, реально встречающаяся в заголовках. */
const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*)/g;

export function InlineMd({ text, className }: { text: string; className?: string }) {
  const parts = text.split(TOKEN).filter((p) => p !== '');
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="rounded-[3px] bg-accent-soft px-[3px] py-px font-mono text-[0.92em] text-accent">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.length > 3 && part.startsWith('**') && part.endsWith('**')) {
          return (
            <b key={i} className="font-semibold">
              {part.slice(2, -2)}
            </b>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </span>
  );
}
