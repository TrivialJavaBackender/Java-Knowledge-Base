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
import { extractTheorySections } from '../lib/theory-sections';
import { parseQA, parseTheoryRef } from './qa-parse';
import { SearchIndexCollector, readConcepts, writeSearchIndex } from './search-index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES_ROOT = process.env.MODULES_ROOT
  ? path.resolve(process.env.MODULES_ROOT)
  : path.resolve(__dirname, '..', '..', 'modules');

const KNOWLEDGE_ROOT = process.env.KNOWLEDGE_ROOT
  ? path.resolve(process.env.KNOWLEDGE_ROOT)
  : path.resolve(MODULES_ROOT, '..', 'knowledge');

/** Served straight from the CDN edge — see middleware.ts and next.config.mjs. */
const SEARCH_INDEX_PATH = path.resolve(__dirname, '..', 'public', 'search-index.json');

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
  // first mention wins. Skip non-theory dotmd refs (README, ROADMAP, etc).
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

/**
 * Ключи разделов каждого документа теории: `slug` → `refKey` всех его `##`.
 * Нужны syncQAs, чтобы проверить ссылку `> theory/FILE.md §N` — без этого
 * промах (нет файла, номер вне диапазона) просто не рендерил бы плашку, и
 * никто бы об этом не узнал.
 */
type TheoryKeys = Map<string, number[]>;

async function syncTheory(
  moduleId: number,
  moduleDir: string,
  c: Counter,
  index: SearchIndexCollector,
  mi: number,
): Promise<TheoryKeys> {
  const seen: TheoryKeys = new Map();
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
    const { sections, sectionCount, readingMinutes } = extractTheorySections(body);
    seen.set(
      slug,
      sections.map((x) => x.refKey).filter((k): k is number => k != null),
    );
    index.theory(mi, slug, title, body);

    const existing = await prisma.theoryDoc.findUnique({
      where: { moduleId_slug: { moduleId, slug } },
    });
    if (!existing) {
      await prisma.theoryDoc.create({
        data: { moduleId, slug, title, filePath, contentHash: hash, body, order, sectionCount, readingMinutes },
      });
      c.added++;
    } else if (
      existing.contentHash !== hash ||
      existing.title !== title ||
      existing.filePath !== filePath ||
      existing.order !== order ||
      existing.sectionCount !== sectionCount ||
      existing.readingMinutes !== readingMinutes
    ) {
      await prisma.theoryDoc.update({
        where: { id: existing.id },
        data: { title, filePath, contentHash: hash, body, order, sectionCount, readingMinutes },
      });
      c.updated++;
    } else {
      c.unchanged++;
    }
  }
  return seen;
}

// ─────────────────────────── Exercises ────────────────────────────

async function syncExercises(
  moduleId: number,
  moduleDir: string,
  c: Counter,
  index: SearchIndexCollector,
  mi: number,
): Promise<Set<string>> {
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
    index.exercise(mi, slug, title);

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

// ─────────────────────────── Q&A sync ─────────────────────────────

async function syncQAs(
  moduleId: number,
  moduleDir: string,
  cfg: ModuleConfig,
  qaCounter: Counter,
  cardCounter: Counter,
  index: SearchIndexCollector,
  mi: number,
  theoryKeys: TheoryKeys,
): Promise<{ qaIds: Set<number>; linked: number; total: number }> {
  const file = path.join(moduleDir, 'INTERVIEW_QUESTIONS.md');
  const qaIds = new Set<number>();
  let linked = 0;
  let total = 0;
  if (!(await exists(file))) return { qaIds, linked, total };

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
      index.qa(mi, q.qNumber, q.question);

      const { refDocSlug, refSection } = parseTheoryRef(q.sourceRef);
      total++;
      if (refDocSlug) {
        const keys = theoryKeys.get(refDocSlug);
        if (!keys) {
          console.warn(
            `! bad theory ref: ${cfg.slug} Q${q.qNumber} → theory/${refDocSlug}.md (нет такого файла)`,
          );
        } else if (refSection != null && !keys.includes(refSection)) {
          console.warn(
            `! bad theory ref: ${cfg.slug} Q${q.qNumber} → theory/${refDocSlug}.md §${refSection} ` +
              `(разделы документа: ${keys.length > 0 ? keys.join(', ') : 'нет'})`,
          );
        } else {
          linked++;
        }
      }
      const slice = `${q.question}\n\n${q.answer}\n${q.sourceRef ?? ''}\n${refDocSlug ?? ''}\n${refSection ?? ''}`;
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
            refDocSlug: refDocSlug ?? null,
            refSection: refSection ?? null,
            contentHash: hash,
          },
        });
        qaId = created.id;
        qaCounter.added++;
        // Auto-flashcard (no LeitnerState — created per-user on registration)
        await prisma.flashcard.create({
          data: { source: 'AUTO', qaId, front: q.question, back: q.answer, moduleId },
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
              refDocSlug,
              refSection,
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
            // Auto card was missing — recreate (no LeitnerState — per-user).
            await prisma.flashcard.create({
              data: { source: 'AUTO', qaId, front: q.question, back: q.answer, moduleId },
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
  return { qaIds, linked, total };
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

// ───────────────────────── Search index ───────────────────────────

/**
 * Writes the client-side search index collected during the walk above, after
 * folding in the concept map from `knowledge/GLOBAL_INDEX.md`.
 *
 * Concepts pointing at a module or a theory file that did not turn up are
 * reported rather than silently dropped — it is the cheapest available check
 * that GLOBAL_INDEX.md still matches the repo.
 */
async function buildSearchIndex(collector: SearchIndexCollector) {
  const concepts = await readConcepts(KNOWLEDGE_ROOT);
  const { index, stale } = collector.finalize(concepts);

  for (const entry of stale) console.warn(`! GLOBAL_INDEX stale entry: ${entry}`);

  const bytes = await writeSearchIndex(SEARCH_INDEX_PATH, index);
  const kinds = index.rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.k] = (acc[r.k] ?? 0) + 1;
    return acc;
  }, {});
  const shape = ['c', 'd', 'h', 'q', 'x'].map((k) => `${k}:${kinds[k] ?? 0}`).join(' ');
  console.log(
    `search-index: ${index.rows.length} rows (${shape}), ${(bytes / 1024).toFixed(0)} KB` +
      (stale.length ? ` | ${stale.length} stale GLOBAL_INDEX entries` : ''),
  );
}

// ──────────────────────────── Driver ──────────────────────────────

async function main() {
  console.log(`MODULES_ROOT = ${MODULES_ROOT}`);
  if (!(await exists(MODULES_ROOT))) {
    console.error(`× modules root not found: ${MODULES_ROOT}`);
    process.exit(1);
  }

  const cardCounter = newCounter();
  const index = new SearchIndexCollector();

  for (const cfg of MODULES) {
    const moduleDir = path.join(MODULES_ROOT, cfg.slug);
    if (!(await exists(moduleDir))) {
      console.warn(`! module dir missing, skipping: ${cfg.slug}`);
      continue;
    }
    const module = await prisma.module.upsert({
      where: { slug: cfg.slug },
      create: { slug: cfg.slug, title: cfg.title, order: cfg.order, track: cfg.track },
      update: { title: cfg.title, order: cfg.order, track: cfg.track },
    });

    const mi = index.module(cfg.slug, cfg.title);

    const theoryC = newCounter();
    const exercisesC = newCounter();
    const qaC = newCounter();

    const seenTheory = await syncTheory(module.id, moduleDir, theoryC, index, mi);
    const seenExercises = await syncExercises(module.id, moduleDir, exercisesC, index, mi);
    const { qaIds: seenQAIds, linked, total } = await syncQAs(
      module.id,
      moduleDir,
      cfg,
      qaC,
      cardCounter,
      index,
      mi,
      seenTheory,
    );

    await pruneRemoved(module.id, new Set(seenTheory.keys()), seenExercises, seenQAIds, {
      theory: theoryC,
      exercises: exercisesC,
      qa: qaC,
      cards: cardCounter,
    });

    const fmt = (c: Counter) =>
      `+${c.added} ~${c.updated} =${c.unchanged} -${c.removed}`;
    console.log(
      `[${cfg.slug}] theory ${fmt(theoryC)} | exercises ${fmt(exercisesC)} | qa ${fmt(qaC)}` +
        ` | linked ${linked}/${total}`,
    );
  }
  console.log(`auto-flashcards: +${cardCounter.added} ~${cardCounter.updated} -${cardCounter.removed}`);

  await buildSearchIndex(index);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
