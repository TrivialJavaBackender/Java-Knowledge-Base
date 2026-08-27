/**
 * Builds `public/search-index.json` — the structural index the header search
 * box queries entirely client-side.
 *
 * It is filled from inside `sync.ts` rather than by a second walk of
 * `../modules/`: sync already reads every theory body, exercise and parsed Q&A,
 * so piggybacking guarantees the index can never point at a document the site
 * does not actually serve.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { headingText, slugifyHeading, uniqueAnchor } from '../lib/slugify';
import {
  INDEX_VERSION,
  normalize,
  type IndexModule,
  type IndexRow,
  type SearchIndex,
} from '../lib/search';

export interface ExtractedHeading {
  level: number;
  text: string;
  anchor: string;
}

/**
 * H2–H4 of a theory document with the anchors `lib/markdown.tsx` will render.
 *
 * Two things keep the anchors in lockstep with the renderer: fenced blocks are
 * skipped (marked never sees them as headings either), and *every* heading
 * level — H1 and H5/H6 included — still consumes a slot in the duplicate
 * counter, because the renderer numbers duplicates across all levels.
 */
export function extractHeadings(body: string): ExtractedHeading[] {
  const out: ExtractedHeading[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;

  for (const line of body.split('\n')) {
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

    const raw = m[2].replace(/\s+#+\s*$/, ''); // closing ATX hashes
    const anchor = uniqueAnchor(seen, slugifyHeading(raw));
    const level = m[1].length;
    if (level < 2 || level > 4) continue;

    out.push({ level, text: headingText(raw), anchor });
  }
  return out;
}

export interface Concept {
  text: string;
  moduleSlug: string;
  docSlug: string;
}

/** `- концепт → modules/<slug>/theory/<FILE>.md` lines of GLOBAL_INDEX.md. */
const CONCEPT_RE = /^-\s+(.+?)\s*→\s*modules\/([a-z0-9-]+)\/theory\/([A-Za-z0-9_-]+)\.md/;

export async function readConcepts(knowledgeRoot: string): Promise<Concept[]> {
  const file = path.join(knowledgeRoot, 'GLOBAL_INDEX.md');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    console.warn(`! GLOBAL_INDEX.md not found at ${file} — search index will have no concepts`);
    return [];
  }

  const out: Concept[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(CONCEPT_RE);
    if (!m) continue;
    const concept = headingText(m[1]);
    if (concept) out.push({ text: concept, moduleSlug: m[2], docSlug: m[3] });
  }
  return out;
}

/**
 * Key for the "same text, same document" lookup. Unambiguous without a special
 * separator: the module index is digits and a doc slug is `[A-Za-z0-9_-]+`, so
 * the first two `/`-delimited segments can never absorb part of the text.
 */
function textKey(moduleIdx: number, docSlug: string, text: string): string {
  return `${moduleIdx}/${docSlug}/${normalize(text)}`;
}

export class SearchIndexCollector {
  private mods: IndexModule[] = [];
  private rows: IndexRow[] = [];
  /** `textKey(...)` → row indices, for merging concepts into existing rows. */
  private textIndex = new Map<string, number[]>();
  /** `${moduleSlug}/${docSlug}` of every theory doc actually synced. */
  private theoryDocs = new Set<string>();

  module(slug: string, title: string): number {
    const existing = this.mods.findIndex((m) => m.slug === slug);
    if (existing !== -1) return existing;
    this.mods.push({ slug, title });
    return this.mods.length - 1;
  }

  theory(m: number, docSlug: string, title: string, body: string): void {
    this.theoryDocs.add(`${this.mods[m].slug}/${docSlug}`);
    this.push({ k: 'd', m, s: docSlug, t: title }, docSlug);
    for (const h of extractHeadings(body)) {
      this.push({ k: 'h', m, s: docSlug, t: h.text, a: h.anchor, l: h.level }, docSlug);
    }
  }

  exercise(m: number, slug: string, title: string): void {
    this.rows.push({ k: 'x', m, s: slug, t: title });
  }

  qa(m: number, qNumber: number, question: string): void {
    this.rows.push({ k: 'q', m, n: qNumber, t: question });
  }

  private push(row: IndexRow, docSlug: string): void {
    const key = textKey(row.m, docSlug, row.t);
    const at = this.rows.push(row) - 1;
    const bucket = this.textIndex.get(key);
    if (bucket) bucket.push(at);
    else this.textIndex.set(key, [at]);
  }

  /**
   * Folds GLOBAL_INDEX.md in. A concept whose name already exists as a heading
   * or a title in its owner document only flags that row as canonical — the row
   * then carries both the deep-link anchor and the concept's ranking weight.
   * Concepts with no matching heading become their own rows, pointing at the
   * document.
   *
   * Concepts naming a module or a file that did not turn up during sync are
   * dropped and reported: GLOBAL_INDEX.md drifting out of date shows up here.
   */
  finalize(concepts: Concept[]): { index: SearchIndex; stale: string[] } {
    const stale: string[] = [];

    for (const c of concepts) {
      const m = this.mods.findIndex((x) => x.slug === c.moduleSlug);
      if (m === -1 || !this.theoryDocs.has(`${c.moduleSlug}/${c.docSlug}`)) {
        stale.push(`${c.text} → modules/${c.moduleSlug}/theory/${c.docSlug}.md`);
        continue;
      }
      const hit = this.textIndex.get(textKey(m, c.docSlug, c.text));
      if (hit) {
        for (const i of hit) this.rows[i].c = 1;
      } else {
        this.rows.push({ k: 'c', m, s: c.docSlug, t: c.text });
      }
    }

    return {
      index: {
        v: INDEX_VERSION,
        generatedAt: new Date().toISOString(),
        mods: this.mods,
        rows: this.rows,
      },
      stale,
    };
  }
}

/** Returns the on-disk size in bytes — Cyrillic costs two per character. */
export async function writeSearchIndex(outPath: string, index: SearchIndex): Promise<number> {
  const json = JSON.stringify(index);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, json, 'utf8');
  return Buffer.byteLength(json, 'utf8');
}
