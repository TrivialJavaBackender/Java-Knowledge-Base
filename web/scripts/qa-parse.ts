/**
 * Парсеры `INTERVIEW_QUESTIONS.md` — общий код для `scripts/sync.ts` (импорт в
 * базу) и `scripts/check-theory-refs.ts` (проверка разметки без базы).
 *
 * Раньше жили внутри sync.ts. Вынесены, потому что валидатор обязан разбирать
 * файл ровно теми же регулярками, что и импорт: копия regex разошлась бы с
 * оригиналом на первой же правке формата, и проверка начала бы врать.
 */

import type { ModuleConfig } from '../content.config';

export interface ParsedQA {
  qNumber: number;
  question: string;
  answer: string;
  sourceRef?: string;
}
export interface ParsedSection {
  number: number;
  title: string;
  qas: ParsedQA[];
}

/** Горизонтальная линейка: `---`, `***`, `___`. */
const HR_RE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;

export function trimAnswer(raw: string): { answer: string; sourceRef?: string } {
  let answer = raw.trim();
  let sourceRef: string | undefined;
  // Trailing `> ...` line is a citation in qa-bold style.
  const lines = answer.split('\n');
  // Разделитель между секциями (`---` перед следующим `## `) попадает в конец
  // блока ответа: границей слайса он не считается. Пока его не отбрасывали,
  // именно он оказывался последней непустой строкой, и цитата строкой выше
  // молча не читалась — так терялись ссылки в каждом модуле, где секции
  // разделены линейкой.
  while (
    lines.length > 0 &&
    (lines[lines.length - 1].trim() === '' || HR_RE.test(lines[lines.length - 1]))
  ) {
    lines.pop();
  }
  if (lines.length > 0 && lines[lines.length - 1].trimStart().startsWith('>')) {
    sourceRef = lines.pop()!.replace(/^\s*>\s*/, '').trim();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    answer = lines.join('\n');
  }
  return { answer: answer.trim(), sourceRef };
}

/**
 * `sourceRef` deep-links into a theory section — but only when it actually
 * names one: `theory/FILE.md §N`. Most refs cite a spec or a book (`JCP §6.3.2`,
 * `JLS §17.4.5`, `spec.graphql.org §6.2`) — those are not anchors and must not
 * parse into one. The `theory/` prefix is what tells the two apart.
 *
 * `§N` необязателен: `> theory/BACKLOG_MANAGEMENT.md` без номера — это всё ещё
 * привязка к документу (вкладка «Этот файл», счётчики на дашборде), просто без
 * плашки в тексте. Пока номер был обязателен, такая ссылка молча теряла и
 * `refDocSlug` — 57 вопросов engineering-process выпадали отовсюду.
 */
export const THEORY_REF_RE = /^theory\/([A-Za-z][A-Za-z0-9_-]*)\.md(?:\s*§\s*(\d+))?/;

export function parseTheoryRef(sourceRef: string | undefined): { refDocSlug?: string; refSection?: number } {
  if (!sourceRef) return {};
  const m = sourceRef.match(THEORY_REF_RE);
  if (!m) return {};
  return { refDocSlug: m[1], refSection: m[2] ? parseInt(m[2], 10) : undefined };
}

export interface SectionMark { idx: number; raw: string }
export interface QAMark { idx: number; qNumber: number; question: string }

export function findAllSections(text: string): SectionMark[] {
  const re = /^## (.+?)\s*$/gm;
  const out: SectionMark[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ idx: m.index!, raw: m[1].trim() });
  }
  return out;
}

export function sectionNumber(raw: string, fallback: number): number {
  const m = raw.match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : fallback;
}

export function sectionTitle(raw: string): string {
  return raw.replace(/^\d+\.\s*/, '').trim();
}

/** Group QAs by surrounding `## ` headings (any heading style — numbered or not). */
export function groupBySections(text: string, qas: (QAMark & ParsedQA)[]): ParsedSection[] {
  const sectionMarks = findAllSections(text);
  const sections: ParsedSection[] = sectionMarks.map((s, i) => ({
    number: sectionNumber(s.raw, i + 1),
    title: sectionTitle(s.raw),
    qas: [],
  }));
  if (sections.length === 0) {
    sections.push({ number: 1, title: '(no section)', qas: [] });
  }
  for (const q of qas) {
    let idx = 0;
    for (let i = 0; i < sectionMarks.length; i++) {
      if (sectionMarks[i].idx <= q.idx) idx = i;
      else break;
    }
    sections[idx].qas.push({
      qNumber: q.qNumber,
      question: q.question,
      answer: q.answer,
      sourceRef: q.sourceRef,
    });
  }
  return sections.filter((s) => s.qas.length > 0);
}

/** Format A: any `## ...` section + `### QN: ...\n**A:** ...` body. */
export function parseQABold(text: string): ParsedSection[] {
  const headRe = /^### Q(\d+):\s*(.+?)\s*$/gm;
  const heads: { idx: number; qNumber: number; question: string }[] = [];
  for (const m of text.matchAll(headRe)) {
    heads.push({ idx: m.index!, qNumber: parseInt(m[1], 10), question: m[2].trim() });
  }
  const sectionMarks = findAllSections(text);
  const qas: (QAMark & ParsedQA)[] = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const nextHead = heads[i + 1]?.idx ?? Number.MAX_SAFE_INTEGER;
    const nextSection = sectionMarks.find((s) => s.idx > h.idx)?.idx ?? Number.MAX_SAFE_INTEGER;
    const end = Math.min(nextHead, nextSection, text.length);
    const slice = text.slice(h.idx, end);
    // Drop the heading line, find **A:** marker.
    const afterHead = slice.replace(/^### Q\d+:.+?(\r?\n)/, '');
    const aMatch = afterHead.match(/\*\*A:\*\*\s*([\s\S]*)/);
    const raw = aMatch ? aMatch[1] : afterHead;
    const { answer, sourceRef } = trimAnswer(raw);
    qas.push({ idx: h.idx, qNumber: h.qNumber, question: h.question, answer, sourceRef });
  }
  return groupBySections(text, qas);
}

/** Format B (spring): any `## ...` section + `**Q1. ...?**` blocks. */
export function parseQAsterisk(text: string): ParsedSection[] {
  const headRe = /^\*\*Q(\d+)\.\s*(.+?)\*\*\s*$/gm;
  const heads: { idx: number; qNumber: number; question: string }[] = [];
  for (const m of text.matchAll(headRe)) {
    heads.push({ idx: m.index!, qNumber: parseInt(m[1], 10), question: m[2].trim() });
  }
  const sectionMarks = findAllSections(text);
  const qas: (QAMark & ParsedQA)[] = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const nextHead = heads[i + 1]?.idx ?? Number.MAX_SAFE_INTEGER;
    const nextSection = sectionMarks.find((s) => s.idx > h.idx)?.idx ?? Number.MAX_SAFE_INTEGER;
    const end = Math.min(nextHead, nextSection, text.length);
    const slice = text.slice(h.idx, end);
    // Drop the heading line.
    const afterHead = slice.replace(/^\*\*Q\d+\..+?\*\*\s*\r?\n/, '');
    // Strip trailing `---` separators.
    const cleaned = afterHead.replace(/\n---\s*\n?$/, '');
    const { answer, sourceRef } = trimAnswer(cleaned);
    qas.push({ idx: h.idx, qNumber: h.qNumber, question: h.question, answer, sourceRef });
  }
  return groupBySections(text, qas);
}

/** Format C (caching): `## N. Title` is both section and the only Q. */
export function parseHeadingAsQ(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const re = /^## (\d+)\.\s*(.+?)\s*$/gm;
  const matches: { idx: number; number: number; title: string }[] = [];
  for (const m of text.matchAll(re)) {
    matches.push({ idx: m.index!, number: parseInt(m[1], 10), title: m[2].trim() });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx;
    const end = i + 1 < matches.length ? matches[i + 1].idx : text.length;
    const body = text.slice(start, end);
    // Strip the heading itself
    const after = body.replace(/^## .+?\n/, '');
    // Strip trailing horizontal rule
    const cleaned = after.replace(/\n---\s*\n?$/, '').trim();
    const { answer, sourceRef } = trimAnswer(cleaned);
    sections.push({
      number: matches[i].number,
      title: matches[i].title,
      qas: [
        {
          qNumber: matches[i].number,
          question: matches[i].title,
          answer,
          sourceRef,
        },
      ],
    });
  }
  return sections;
}

export function parseQA(text: string, cfg: ModuleConfig): ParsedSection[] {
  switch (cfg.qaFormat) {
    case 'q-asterisk':
      return parseQAsterisk(text);
    case 'heading-as-q':
      return parseHeadingAsQ(text);
    case 'qa-bold':
    default: {
      const out = parseQABold(text);
      // Fallback: if qa-bold yields nothing useful, try the others.
      const qaCount = out.reduce((s, x) => s + x.qas.length, 0);
      if (qaCount > 0) return out;
      const alt = parseQAsterisk(text);
      const altCount = alt.reduce((s, x) => s + x.qas.length, 0);
      if (altCount > 0) return alt;
      return parseHeadingAsQ(text);
    }
  }
}
