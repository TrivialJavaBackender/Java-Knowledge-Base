/**
 * Извлекает разделы верхнего уровня (`## `) из тела теории — для оглавления,
 * скролл-спая и позиции чтения (`UserTheoryProgress.lastSectionIndex`).
 *
 * Раздел — любой заголовок `## ` (H2). Подраздел `### ` не отдельный раздел:
 * его текст и заголовок входят в счёт родительского `##`. Не все файлы теории
 * нумеруют разделы (`## N. Заголовок`) — там, где номера нет, `number` = null;
 * `index` (0-based позиция в документе) есть всегда и не зависит от нумерации.
 *
 * Якоря — через `slugifyHeading`/`uniqueAnchor` из lib/slugify.ts, счётчик
 * дублей пополняется заголовками ВСЕХ уровней (h1–h6) в порядке появления —
 * так же, как в рендерере (lib/markdown.tsx:42-55) и в индексе поиска
 * (scripts/search-index.ts:36-62). Если считать дубли только по h2, якоря
 * разъедутся с тем, что реально отрисует MarkdownView.
 *
 * Вопрос адресует раздел через `refKey` (см. поле): в пронумерованном документе
 * это печатный номер, в документе без нумерации — позиция раздела. Так плашка
 * «Проверь себя» работает и там, где заголовки не нумеруют.
 *
 * Fenced-блоки ``` / ~~~ пропускаются при поиске заголовков (заголовок внутри
 * блока кода — не заголовок), но из подсчёта слов НЕ выбрасываются: в теории
 * внутри ``` лежат не только листинги, а схемы, прогоны и расчёты — то есть
 * содержательный текст. Считаются с понижающим весом CODE_WEIGHT: код и вывод
 * прогона просматривают быстрее прозы, но не мгновенно.
 */

import { headingText, slugifyHeading, uniqueAnchor } from './slugify';

export interface TheorySection {
  /** 0-based позиция раздела в документе. */
  index: number;
  /** N из `## N. Заголовок`; null, если заголовок без номера. */
  number: number | null;
  /**
   * Ключ, которым в вопрос-ссылке `> theory/FILE.md §N` адресуется этот раздел.
   * В документе с нумерацией это её номер; в документе, где не пронумерован ни
   * один `##`, — позиция раздела, считая с единицы. Смешивать нельзя: если у
   * части разделов номер есть, у остальных `refKey` = null, иначе позиция
   * одного раздела совпала бы с печатным номером другого.
   */
  refKey: number | null;
  /** Заголовок без префикса `N. ` и без инлайн-markdown. */
  title: string;
  anchor: string;
  /** Номер строки заголовка в исходнике, считая с единицы. */
  line: number;
  /** Число слов раздела (текст до следующего `##`; код внутри ``` — с весом CODE_WEIGHT). */
  words: number;
  /** `Math.max(1, Math.round(words / WORDS_PER_MINUTE))`. */
  minutes: number;
}

export interface TheoryAggregate {
  sections: TheorySection[];
  sectionCount: number;
  /** Суммарное время чтения документа, включая шапку файла до первого `##`. */
  readingMinutes: number;
}

const LEADING_NUMBER_RE = /^(\d+)\.\s*(.+)$/;

/** Слова внутри ``` весят меньше слов прозы — см. шапку файла. */
const CODE_WEIGHT = 0.4;
/** Слов в минуту для русского технического текста. */
const WORDS_PER_MINUTE = 150;

function words(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}

/**
 * Считает слова, разделяя прозу и содержимое fenced-блоков. Сканер границ тот
 * же, что в scanHeadings, — иначе непарная ``` разошлась бы с поиском заголовков.
 */
function countWords(text: string): number {
  const prose: string[] = [];
  const code: string[] = [];
  let fence: string | null = null;

  for (const line of text.split('\n')) {
    const fenceMatch = line.match(/^\s{0,3}(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    (fence === null ? prose : code).push(line);
  }

  return words(prose.join('\n')) + words(code.join('\n')) * CODE_WEIGHT;
}

function minutesFor(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}

interface HeadingHit {
  level: number;
  raw: string;
  line: number;
}

/**
 * Fence-aware сканирование ATX-заголовков (`#`…`######`). Заголовки внутри
 * ``` / ~~~ блоков не возвращаются — зеркалит extractHeadings в
 * scripts/search-index.ts, чтобы счётчик дублей совпадал 1:1.
 */
function scanHeadings(lines: string[]): HeadingHit[] {
  const out: HeadingHit[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s{0,3}(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) continue;

    const raw = m[2].replace(/\s+#+\s*$/, ''); // закрывающие ATX-решётки
    out.push({ level: m[1].length, raw, line: i });
  }
  return out;
}

export function extractTheorySections(body: string): TheoryAggregate {
  const lines = body.split('\n');
  const headings = scanHeadings(lines);

  const seen = new Map<string, number>();
  const h2: { raw: string; line: number; anchor: string }[] = [];
  for (const h of headings) {
    // Счётчик дублей двигают заголовки всех уровней, даже если в разделы
    // попадают только h2 — иначе якорь h2 №5 не совпадёт с рендерером,
    // если между h2 №4 и №5 был h3 с тем же текстом, что и более ранний h2.
    const anchor = uniqueAnchor(seen, slugifyHeading(h.raw));
    if (h.level === 2) h2.push({ raw: h.raw, line: h.line, anchor });
  }

  const anyNumbered = h2.some((h) => LEADING_NUMBER_RE.test(h.raw));

  const sections: TheorySection[] = h2.map((h, i) => {
    const start = h.line + 1;
    const end = i + 1 < h2.length ? h2[i + 1].line : lines.length;
    const sectionWords = countWords(lines.slice(start, end).join('\n'));
    const numMatch = h.raw.match(LEADING_NUMBER_RE);
    const title = headingText(numMatch ? numMatch[2] : h.raw);
    const number = numMatch ? parseInt(numMatch[1], 10) : null;
    return {
      index: i,
      number,
      refKey: anyNumbered ? number : i + 1,
      title,
      anchor: h.anchor,
      line: h.line + 1,
      words: Math.round(sectionWords),
      minutes: minutesFor(sectionWords),
    };
  });

  // Шапка файла (до первого `##`) разделом не является, но её читают — она
  // рендерится карточками «Какую проблему решает / Кому это надо / Когда НЕ надо»,
  // поэтому в общее время документа входит.
  const headerWords = countWords(lines.slice(0, h2.length > 0 ? h2[0].line : lines.length).join('\n'));
  const totalWords = headerWords + sections.reduce((sum, s) => sum + s.words, 0);
  return {
    sections,
    sectionCount: sections.length,
    readingMinutes: minutesFor(totalWords),
  };
}
