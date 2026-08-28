/**
 * Проверка разметки `> theory/FILE.md §N` в `INTERVIEW_QUESTIONS.md` — без базы
 * и без Prisma, чтобы её можно было гонять на каждый модуль прямо во время
 * правки контента.
 *
 * Разбирает вопросы теми же парсерами, что и импорт (`scripts/qa-parse.ts`), и
 * считает разделы тем же кодом, что и читалка (`lib/theory-sections.ts`), —
 * поэтому «здесь зелено, а на сайте плашки нет» невозможно по построению.
 *
 *   node_modules/.bin/tsx scripts/check-theory-refs.ts            # все модули
 *   node_modules/.bin/tsx scripts/check-theory-refs.ts concurrency ddd
 *
 * Exit code 1 — есть битые ссылки (несуществующий файл или номер раздела вне
 * документа). Непривязанные вопросы и разделы без вопросов — это не ошибка, а
 * список работы: печатаются, но код возврата не меняют.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULES } from '../content.config';
import { extractTheorySections } from '../lib/theory-sections';
import { parseQA } from './qa-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES_ROOT = process.env.MODULES_ROOT
  ? path.resolve(process.env.MODULES_ROOT)
  : path.resolve(__dirname, '..', '..', 'modules');

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

interface DocInfo {
  /** refKey всех разделов документа в порядке появления. */
  keys: number[];
  /** Есть ли в документе хоть один `## N.` — иначе §N считается позицией. */
  numbered: boolean;
  titles: Map<number, string>;
  /** refKey → строка заголовка в исходнике: для точечного чтения раздела. */
  lines: Map<number, number>;
  /** Всего строк в файле — чтобы у последнего раздела был конец диапазона. */
  totalLines: number;
  /** Все `##` подряд, включая ненумерованные (refKey = null): их в карте видно
   *  отдельно — сослаться на такой раздел нельзя, пока он без номера. */
  all: { refKey: number | null; title: string; line: number }[];
}

async function readDocs(moduleDir: string): Promise<Map<string, DocInfo>> {
  const out = new Map<string, DocInfo>();
  const dir = path.join(moduleDir, 'theory');
  if (!(await exists(dir))) return out;
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()) {
    const body = await readFile(path.join(dir, file), 'utf8');
    const { sections } = extractTheorySections(body);
    const titles = new Map<number, string>();
    const lines = new Map<number, number>();
    for (const s of sections) {
      if (s.refKey == null) continue;
      titles.set(s.refKey, s.title);
      lines.set(s.refKey, s.line);
    }
    out.set(file.replace(/\.md$/, ''), {
      keys: sections.map((s) => s.refKey).filter((k): k is number => k != null),
      numbered: sections.some((s) => s.number != null),
      titles,
      lines,
      totalLines: body.split('\n').length,
      all: sections.map((s) => ({ refKey: s.refKey, title: s.title, line: s.line })),
    });
  }
  return out;
}

/** Разделы, к которым вопрос не пишут: справка, а не механизм. */
const SERVICE_SECTION_RE = /^(шпаргалк|упражнени|вопросы для самопроверк|источник|литератур)/i;

async function checkModule(slug: string): Promise<number> {
  const cfg = MODULES.find((m) => m.slug === slug);
  if (!cfg) {
    console.error(`× нет такого модуля в content.config.ts: ${slug}`);
    return 1;
  }
  const moduleDir = path.join(MODULES_ROOT, slug);
  const docs = await readDocs(moduleDir);
  const qaFile = path.join(moduleDir, 'INTERVIEW_QUESTIONS.md');
  if (!(await exists(qaFile))) {
    console.error(`× нет INTERVIEW_QUESTIONS.md: ${slug}`);
    return 1;
  }

  const parsed = parseQA(await readFile(qaFile, 'utf8'), cfg);
  const qas = parsed.flatMap((s) => s.qas);

  const broken: string[] = [];
  const noSection: number[] = [];
  const unlinked: number[] = [];
  /** docSlug → refKey, на которые уже сослались. */
  const covered = new Map<string, Set<number>>();

  const REF = /^theory\/([A-Za-z][A-Za-z0-9_-]*)\.md(?:\s*§\s*(\d+))?/;
  for (const q of qas) {
    const m = q.sourceRef?.match(REF);
    if (!m) {
      unlinked.push(q.qNumber);
      continue;
    }
    const [, docSlug, num] = m;
    const doc = docs.get(docSlug);
    if (!doc) {
      broken.push(`Q${q.qNumber} → theory/${docSlug}.md (нет такого файла)`);
      continue;
    }
    if (!num) {
      noSection.push(q.qNumber);
      continue;
    }
    const n = parseInt(num, 10);
    if (!doc.keys.includes(n)) {
      broken.push(
        `Q${q.qNumber} → theory/${docSlug}.md §${n} (разделы: ${doc.keys.join(', ') || 'нет'})`,
      );
      continue;
    }
    if (!covered.has(docSlug)) covered.set(docSlug, new Set());
    covered.get(docSlug)!.add(n);
  }

  const linked = qas.length - unlinked.length - noSection.length - broken.length;
  console.log(`\n[${slug}] вопросов ${qas.length} · привязано ${linked} · файлов теории ${docs.size}`);

  if (broken.length > 0) {
    console.log(`  × битые ссылки (${broken.length}):`);
    for (const b of broken) console.log(`      ${b}`);
  }
  if (unlinked.length > 0) {
    console.log(`  · без ссылки (${unlinked.length}): ${unlinked.map((n) => `Q${n}`).join(' ')}`);
  }
  if (noSection.length > 0) {
    console.log(
      `  · файл без §N (${noSection.length}, плашки в тексте не будет): ${noSection
        .map((n) => `Q${n}`)
        .join(' ')}`,
    );
  }

  const unnumbered = [...docs].filter(([, d]) => !d.numbered && d.keys.length > 0);
  if (unnumbered.length > 0) {
    console.log(
      `  · без нумерации разделов (${unnumbered.length}, §N = позиция раздела): ${unnumbered
        .map(([s]) => s)
        .join(', ')}`,
    );
  }

  const gaps: string[] = [];
  for (const [docSlug, doc] of docs) {
    const has = covered.get(docSlug) ?? new Set<number>();
    // Служебный хвост файла вопросов не заслуживает: там нет механизма, только
    // таблицы, ссылки на упражнения и список источников.
    const missing = doc.keys.filter((k) => !has.has(k) && !SERVICE_SECTION_RE.test(doc.titles.get(k) ?? ''));
    if (has.size === 0 && missing.length > 0) gaps.push(`${docSlug}: вопросов нет вообще`);
    else if (missing.length > 0) gaps.push(`${docSlug}: §${missing.join(', §')}`);
  }
  if (gaps.length > 0) {
    console.log(`  · разделы без вопросов (${gaps.length} файлов):`);
    for (const g of gaps) console.log(`      ${g}`);
  }

  return broken.length > 0 ? 1 : 0;
}

/**
 * Карта разделов модуля: что где лежит и на каких строках. Ею работает батч
 * разметки — теорию целиком (5.7 МБ на репозиторий) в контекст не поднять, а
 * заголовков с диапазонами строк хватает, чтобы выбрать §N и точечно открыть
 * нужный раздел через `sed -n 'A,Bp'`.
 */
async function printMap(slug: string): Promise<number> {
  const cfg = MODULES.find((m) => m.slug === slug);
  if (!cfg) {
    console.error(`× нет такого модуля в content.config.ts: ${slug}`);
    return 1;
  }
  const moduleDir = path.join(MODULES_ROOT, slug);
  const docs = await readDocs(moduleDir);
  console.log(`# ${slug} · формат вопросов: ${cfg.qaFormat ?? 'qa-bold'} · файлов теории: ${docs.size}`);
  for (const [docSlug, doc] of docs) {
    console.log(
      `\n## theory/${docSlug}.md${doc.numbered ? '' : '   ⚠ НУМЕРАЦИИ НЕТ — §N считается позицией раздела'}`,
    );
    doc.all.forEach((sec, i) => {
      const from = sec.line;
      const to = i + 1 < doc.all.length ? doc.all[i + 1].line - 1 : doc.totalLines;
      const service = SERVICE_SECTION_RE.test(sec.title) ? '  ·служебный' : '';
      const label = sec.refKey != null ? `§${sec.refKey}` : '(без номера — сослаться нельзя)';
      console.log(`  ${label}  строки ${from}–${to}  ${sec.title}${service}`);
    });
  }
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const mapMode = args.includes('--map');
  const rest = args.filter((a) => a !== '--map');
  if (mapMode) {
    const slugs = rest.length > 0 ? rest : MODULES.map((m) => m.slug);
    let bad = 0;
    for (const slug of slugs) bad += await printMap(slug);
    process.exit(bad > 0 ? 1 : 0);
  }
  const slugs = rest.length > 0 ? rest : MODULES.map((m) => m.slug);
  let bad = 0;
  for (const slug of slugs) bad += await checkModule(slug);
  if (bad > 0) {
    console.error(`\n× модулей с битыми ссылками: ${bad}`);
    process.exit(1);
  }
  console.log('\n✓ битых ссылок нет');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
