/**
 * Content sync: walks ../modules/<slug>/ and upserts theory, exercises,
 * interview Q&A into the SQLite DB. Auto-creates flashcards for new QAs.
 *
 * Idempotent via per-entity sha256 content hashes — re-runs make zero
 * writes when sources are unchanged. Stable natural keys preserve user
 * progress (isRead/isKnown) and Leitner state across edits.
 */

import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULES, type ModuleConfig } from '../content.config';
import { spreadInitialDueDate } from '../lib/leitner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES_ROOT = process.env.MODULES_ROOT
  ? path.resolve(process.env.MODULES_ROOT)
  : path.resolve(__dirname, '..', '..', 'modules');

const prisma = new PrismaClient();

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

type Counter = { added: number; updated: number; unchanged: number; removed: number };
function newCounter(): Counter {
  return { added: 0, updated: 0, unchanged: 0, removed: 0 };
}

// ───────────────────────────── Theory ─────────────────────────────

function extractTitle(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m?.[1] ?? fallback;
}

/**
 * Returns the order of theory file slugs as referenced in ROADMAP.md.
 * First mention wins. Files not mentioned in roadmap get order=999 and
 * fall back to alphabetical sort downstream.
 */
async function readRoadmapTheoryOrder(moduleDir: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const file = path.join(moduleDir, 'ROADMAP.md');
  if (!(await exists(file))) return out;
  const text = await readFile(file, 'utf8');
  // Match `theory/FOO.md` or just `FOO.md`. Case-insensitive,
  // first mention wins. Skip non-theory dotmd refs (README, PROGRESS, etc).
  const re = /(?:theory\/)([A-Za-z][A-Za-z0-9_-]+)\.md/g;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const slug = m[1];
    if (!out.has(slug)) {
      out.set(slug, i);
      i += 1;
    }
  }
  return out;
}

async function syncTheory(moduleId: number, moduleDir: string, c: Counter): Promise<Set<string>> {
  const seen = new Set<string>();
  const dir = path.join(moduleDir, 'theory');
  if (!(await exists(dir))) return seen;

  const orderMap = await readRoadmapTheoryOrder(moduleDir);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  for (const file of files) {
    const filePath = path.join(dir, file);
    const body = await readFile(filePath, 'utf8');
    const slug = file.replace(/\.md$/, '');
    const title = extractTitle(body, slug);
    const hash = sha(body);
    const order = orderMap.get(slug) ?? 999;
    seen.add(slug);

    const existing = await prisma.theoryDoc.findUnique({
      where: { moduleId_slug: { moduleId, slug } },
    });
    if (!existing) {
      await prisma.theoryDoc.create({
        data: { moduleId, slug, title, filePath, contentHash: hash, body, order },
      });
      c.added++;
    } else if (
      existing.contentHash !== hash ||
      existing.title !== title ||
      existing.filePath !== filePath ||
      existing.order !== order
    ) {
      await prisma.theoryDoc.update({
        where: { id: existing.id },
        data: { title, filePath, contentHash: hash, body, order },
      });
      c.updated++;
    } else {
      c.unchanged++;
    }
  }
  return seen;
}

// ─────────────────────────── Exercises ────────────────────────────

async function syncExercises(moduleId: number, moduleDir: string, c: Counter): Promise<Set<string>> {
  const seen = new Set<string>();
  const candidates = [
    path.join(moduleDir, 'src', 'main', 'kotlin', 'exercises'),
    path.join(moduleDir, 'src', 'main', 'java', 'exercises'),
  ];
  let dir: string | null = null;
  for (const cand of candidates) {
    if (await exists(cand)) {
      dir = cand;
      break;
    }
  }
  if (!dir) return seen;

  const files = (await readdir(dir))
    .filter((f) => /^Ex(\d+)_.+\.(kt|java)$/.test(f))
    .sort();

  for (const file of files) {
    const filePath = path.join(dir, file);
    const body = await readFile(filePath, 'utf8');
    const m = file.match(/^Ex(\d+)_(.+)\.(kt|java)$/);
    if (!m) continue;
    const number = parseInt(m[1], 10);
    const titlePart = m[2].replace(/([a-z])([A-Z])/g, '$1 $2');
    const title = `${m[1]}. ${titlePart}`;
    const language = m[3] === 'kt' ? 'kotlin' : 'java';
    const slug = file.replace(/\.(kt|java)$/, '');
    const hash = sha(body);
    seen.add(slug);

    const existing = await prisma.exercise.findUnique({
      where: { moduleId_slug: { moduleId, slug } },
    });
    if (!existing) {
      await prisma.exercise.create({
        data: { moduleId, slug, number, title, filePath, contentHash: hash, body, language },
      });
      c.added++;
    } else if (existing.contentHash !== hash || existing.filePath !== filePath || existing.title !== title) {
      await prisma.exercise.update({
        where: { id: existing.id },
        data: { number, title, filePath, contentHash: hash, body, language },
      });
      c.updated++;
    } else {
      c.unchanged++;
    }
  }
  return seen;
}

// ─────────────────────────── QA Parsers ───────────────────────────

interface ParsedQA {
  qNumber: number;
  question: string;
  answer: string;
  sourceRef?: string;
}
interface ParsedSection {
  number: number;
  title: string;
  qas: ParsedQA[];
}

function trimAnswer(raw: string): { answer: string; sourceRef?: string } {
  let answer = raw.trim();
  let sourceRef: string | undefined;
  // Trailing `> ...` line is a citation in qa-bold style.
  const lines = answer.split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length > 0 && lines[lines.length - 1].trimStart().startsWith('>')) {
    sourceRef = lines.pop()!.replace(/^\s*>\s*/, '').trim();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    answer = lines.join('\n');
  }
  return { answer: answer.trim(), sourceRef };
}

interface SectionMark { idx: number; raw: string }
interface QAMark { idx: number; qNumber: number; question: string }

function findAllSections(text: string): SectionMark[] {
  const re = /^## (.+?)\s*$/gm;
  const out: SectionMark[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ idx: m.index!, raw: m[1].trim() });
  }
  return out;
}

function sectionNumber(raw: string, fallback: number): number {
  const m = raw.match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : fallback;
}

function sectionTitle(raw: string): string {
  return raw.replace(/^\d+\.\s*/, '').trim();
}

/** Group QAs by surrounding `## ` headings (any heading style — numbered or not). */
function groupBySections(text: string, qas: (QAMark & ParsedQA)[]): ParsedSection[] {
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
function parseQABold(text: string): ParsedSection[] {
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
function parseQAsterisk(text: string): ParsedSection[] {
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
function parseHeadingAsQ(text: string): ParsedSection[] {
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

function parseQA(text: string, cfg: ModuleConfig): ParsedSection[] {
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

// ─────────────────────────── Q&A sync ─────────────────────────────

async function syncQAs(
  moduleId: number,
  moduleDir: string,
  cfg: ModuleConfig,
  qaCounter: Counter,
  cardCounter: Counter,
  newCardSeed: { idx: number },
): Promise<{ qaIds: Set<number> }> {
  const file = path.join(moduleDir, 'INTERVIEW_QUESTIONS.md');
  const qaIds = new Set<number>();
  if (!(await exists(file))) return { qaIds };

  const text = await readFile(file, 'utf8');
  const parsed = parseQA(text, cfg);

  for (let order = 0; order < parsed.length; order++) {
    const ps = parsed[order];
    const section = await prisma.interviewSection.upsert({
      where: { moduleId_number: { moduleId, number: ps.number } },
      create: { moduleId, number: ps.number, title: ps.title, order },
      update: { title: ps.title, order },
    });

    for (const q of ps.qas) {
      const slice = `${q.question}\n\n${q.answer}\n${q.sourceRef ?? ''}`;
      const hash = sha(slice);
      const existing = await prisma.interviewQA.findUnique({
        where: { moduleId_qNumber: { moduleId, qNumber: q.qNumber } },
      });

      let qaId: number;
      if (!existing) {
        const created = await prisma.interviewQA.create({
          data: {
            sectionId: section.id,
            moduleId,
            qNumber: q.qNumber,
            question: q.question,
            answer: q.answer,
            sourceRef: q.sourceRef,
            contentHash: hash,
          },
        });
        qaId = created.id;
        qaCounter.added++;
        // Auto-flashcard
        const card = await prisma.flashcard.create({
          data: {
            source: 'AUTO',
            qaId,
            front: q.question,
            back: q.answer,
            moduleId,
          },
        });
        await prisma.leitnerState.create({
          data: {
            flashcardId: card.id,
            box: 1,
            nextDueAt: new Date('2099-01-01'),
          },
        });
        cardCounter.added++;
      } else {
        qaId = existing.id;
        if (existing.contentHash !== hash || existing.sectionId !== section.id) {
          await prisma.interviewQA.update({
            where: { id: existing.id },
            data: {
              sectionId: section.id,
              question: q.question,
              answer: q.answer,
              sourceRef: q.sourceRef,
              contentHash: hash,
            },
          });
          qaCounter.updated++;
          // Update auto-flashcard text but preserve Leitner state.
          const card = await prisma.flashcard.findUnique({ where: { qaId } });
          if (card) {
            if (card.front !== q.question || card.back !== q.answer) {
              await prisma.flashcard.update({
                where: { id: card.id },
                data: { front: q.question, back: q.answer, archived: false },
              });
              cardCounter.updated++;
            } else if (card.archived) {
              await prisma.flashcard.update({ where: { id: card.id }, data: { archived: false } });
              cardCounter.updated++;
            }
          } else {
            // Auto card was missing — recreate.
            const created = await prisma.flashcard.create({
              data: { source: 'AUTO', qaId, front: q.question, back: q.answer, moduleId },
            });
            await prisma.leitnerState.create({
              data: {
                flashcardId: created.id,
                box: 1,
                nextDueAt: spreadInitialDueDate(newCardSeed.idx++),
              },
            });
            cardCounter.added++;
          }
        } else {
          qaCounter.unchanged++;
        }
      }
      qaIds.add(qaId);
    }
  }
  return { qaIds };
}

// ─────────────────────────── Cleanup ──────────────────────────────

async function pruneRemoved(
  moduleId: number,
  seenTheory: Set<string>,
  seenExercises: Set<string>,
  seenQAIds: Set<number>,
  c: { theory: Counter; exercises: Counter; qa: Counter; cards: Counter },
) {
  const orphanTheory = await prisma.theoryDoc.findMany({
    where: { moduleId, slug: { notIn: [...seenTheory] } },
    select: { id: true },
  });
  if (orphanTheory.length) {
    await prisma.theoryDoc.deleteMany({ where: { id: { in: orphanTheory.map((x) => x.id) } } });
    c.theory.removed += orphanTheory.length;
  }

  const orphanExercises = await prisma.exercise.findMany({
    where: { moduleId, slug: { notIn: [...seenExercises] } },
    select: { id: true },
  });
  if (orphanExercises.length) {
    await prisma.exercise.deleteMany({ where: { id: { in: orphanExercises.map((x) => x.id) } } });
    c.exercises.removed += orphanExercises.length;
  }

  const orphanQAs = await prisma.interviewQA.findMany({
    where: { moduleId, id: { notIn: [...seenQAIds] } },
    select: { id: true, flashcard: { select: { id: true } } },
  });
  if (orphanQAs.length) {
    // Archive auto-cards instead of cascading delete — preserves history.
    for (const o of orphanQAs) {
      if (o.flashcard) {
        await prisma.flashcard.update({
          where: { id: o.flashcard.id },
          data: { archived: true },
        });
        c.cards.removed++;
      }
    }
    await prisma.interviewQA.deleteMany({ where: { id: { in: orphanQAs.map((x) => x.id) } } });
    c.qa.removed += orphanQAs.length;
  }
}

// ────────────────────── Dormantify Existing ───────────────────────

async function dormantifyUnknownCards() {
  const DORMANT = new Date('2099-01-01');
  const DORMANT_THRESHOLD = new Date('2098-01-01');

  const cards = await prisma.flashcard.findMany({
    where: { source: 'AUTO', archived: false, qa: { isKnown: false } },
    include: { leitner: true },
  });

  let count = 0;
  for (const card of cards) {
    if (!card.leitner || card.leitner.box !== 1) continue;
    if (card.leitner.nextDueAt >= DORMANT_THRESHOLD) continue;
    await prisma.leitnerState.update({
      where: { flashcardId: card.id },
      data: { nextDueAt: DORMANT },
    });
    count++;
  }
  console.log(`dormantified: ${count} box1 auto-cards with unknown QA`);
}

// ──────────────────────────── Driver ──────────────────────────────

async function main() {
  console.log(`MODULES_ROOT = ${MODULES_ROOT}`);
  if (!(await exists(MODULES_ROOT))) {
    console.error(`× modules root not found: ${MODULES_ROOT}`);
    process.exit(1);
  }

  const cardCounter = newCounter();
  const newCardSeed = { idx: 0 };

  for (const cfg of MODULES) {
    const moduleDir = path.join(MODULES_ROOT, cfg.slug);
    if (!(await exists(moduleDir))) {
      console.warn(`! module dir missing, skipping: ${cfg.slug}`);
      continue;
    }
    const module = await prisma.module.upsert({
      where: { slug: cfg.slug },
      create: { slug: cfg.slug, title: cfg.title, order: cfg.order },
      update: { title: cfg.title, order: cfg.order },
    });

    const theoryC = newCounter();
    const exercisesC = newCounter();
    const qaC = newCounter();

    const seenTheory = await syncTheory(module.id, moduleDir, theoryC);
    const seenExercises = await syncExercises(module.id, moduleDir, exercisesC);
    const { qaIds: seenQAIds } = await syncQAs(
      module.id,
      moduleDir,
      cfg,
      qaC,
      cardCounter,
      newCardSeed,
    );

    await pruneRemoved(module.id, seenTheory, seenExercises, seenQAIds, {
      theory: theoryC,
      exercises: exercisesC,
      qa: qaC,
      cards: cardCounter,
    });

    const fmt = (c: Counter) =>
      `+${c.added} ~${c.updated} =${c.unchanged} -${c.removed}`;
    console.log(
      `[${cfg.slug}] theory ${fmt(theoryC)} | exercises ${fmt(exercisesC)} | qa ${fmt(qaC)}`,
    );
  }
  console.log(`auto-flashcards: +${cardCounter.added} ~${cardCounter.updated} -${cardCounter.removed}`);
  await dormantifyUnknownCards();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
