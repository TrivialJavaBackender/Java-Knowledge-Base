import { marked, Marked } from 'marked';
import { slugifyHeading, uniqueAnchor } from './slugify';
import { createHighlighter, type Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;

const LANGS = [
  'kotlin', 'java', 'typescript', 'javascript', 'sql', 'bash', 'shell',
  'yaml', 'json', 'xml', 'properties', 'dockerfile', 'http', 'plaintext',
  'diff', 'graphql', 'python', 'rust', 'go', 'css', 'html',
] as const;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark-default'],
      langs: LANGS as unknown as string[],
    });
  }
  return highlighterPromise;
}

async function highlight(code: string, lang: string): Promise<string> {
  const hl = await getHighlighter();
  const safe = (LANGS as readonly string[]).includes(lang) ? lang : 'plaintext';
  return hl.codeToHtml(code, { lang: safe, theme: 'github-dark-default' });
}

const MARKED_OPTIONS = { gfm: true, breaks: false };

marked.setOptions(MARKED_OPTIONS);

/**
 * Parser whose heading renderer emits stable `id`s, so theory pages can be
 * deep-linked to a section (search results, cross-file `…#anchor` links).
 * A fresh instance per document keeps the "anchors already used here" map
 * local: `marked.use()` is global, and Q&A answers render concurrently.
 *
 * Anchors must match `scripts/search-index.ts`, which slugifies the same raw
 * heading text in the same document order.
 */
function anchoredMarked(): Marked {
  const seen = new Map<string, number>();
  const md = new Marked(MARKED_OPTIONS);
  md.use({
    renderer: {
      heading(token) {
        const id = uniqueAnchor(seen, slugifyHeading(token.text));
        const inner = this.parser.parseInline(token.tokens);
        return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
      },
    },
  });
  return md;
}

interface CodeBlockToken {
  placeholder: string;
  lang: string;
  code: string;
}

/**
 * Render markdown into HTML on the server with Shiki-highlighted code blocks.
 * Approach:
 *   1. Strip fenced code blocks into placeholders before marked sees them.
 *   2. Run marked over the placeholder-substituted markdown.
 *   3. Async-highlight each code block with Shiki.
 *   4. Replace placeholders in the final HTML with Shiki HTML.
 */
async function renderMarkdownToHtml(source: string, anchors = false): Promise<string> {
  const blocks: CodeBlockToken[] = [];
  const stripped = source.replace(
    /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g,
    (_m, lang: string, code: string) => {
      const placeholder = `<!--CODEBLOCK:${blocks.length}-->`;
      blocks.push({ placeholder, lang: lang || 'plaintext', code });
      return `\n\n${placeholder}\n\n`;
    },
  );

  let html = await (anchors ? anchoredMarked() : marked).parse(stripped);

  for (const block of blocks) {
    const replacement =
      block.lang === 'mermaid'
        ? renderMermaidPlaceholder(block.code.replace(/\n$/, ''))
        : await highlight(block.code.replace(/\n$/, ''), block.lang);
    const re = new RegExp(`(?:<p>\\s*)?${escapeRegex(block.placeholder)}(?:\\s*</p>)?`);
    html = html.replace(re, replacement);
  }
  return html;
}

function renderMermaidPlaceholder(code: string): string {
  // mermaid.run() on the client picks up `.mermaid` nodes and replaces their
  // textContent with rendered SVG. `not-prose` keeps Tailwind Typography from
  // styling the inner SVG; the textual fallback is shown until JS hydrates.
  return `<div class="mermaid not-prose my-4 flex justify-center">${escapeHtml(code)}</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite repo-relative links inside rendered markdown so they point at the
 * site routes instead of raw .md/.kt files. Handles same-module and
 * cross-module references via `../<other-module>/...` paths.
 *
 *   theory/FOO.md                                    →  /modules/{currentSlug}/theory/FOO
 *   FOO.md                                           →  /modules/{currentSlug}/theory/FOO
 *   ../<mod>/theory/FOO.md                           →  /modules/<mod>/theory/FOO
 *   modules/<mod>/theory/FOO.md                      →  /modules/<mod>/theory/FOO
 *   src/main/{kotlin,java}/exercises/ExNN_X.{kt,java}      →  /modules/{currentSlug}/exercises/ExNN_X
 *   ../<mod>/src/main/.../ExNN_X.kt                  →  /modules/<mod>/exercises/ExNN_X
 *   ROADMAP.md / INTERVIEW_QUESTIONS.md → /modules/{slug}
 *
 * Anchors are preserved. Absolute URLs (http://, mailto:, /…) are left alone.
 */
function rewriteInternalLinks(html: string, moduleSlug: string): string {
  return html.replace(/href="([^"]+)"/g, (full, raw: string) => {
    if (/^(https?:|mailto:|tel:|#|\/)/i.test(raw)) return full;

    const [pathPart, anchor] = splitAnchor(raw);

    // Cross-module exercise: …/<mod>/src/main/{kotlin,java}/exercises/ExNN_Name.{kt,java}
    // The <mod> is just whichever directory sits immediately before /src/main/ — works for
    // `../concurrency/...`, `../../concurrency/...`, `modules/concurrency/...` alike.
    const crossExMatch = pathPart.match(
      /(?:^|\/)([a-z][a-z0-9-]+)\/src\/main\/(?:kotlin|java)\/exercises\/(Ex\d+_[A-Za-z0-9_]+)\.(?:kt|java)$/,
    );
    if (crossExMatch) {
      return `href="/modules/${crossExMatch[1]}/exercises/${crossExMatch[2]}${anchor}"`;
    }

    // Same-module exercise (path without an explicit module dir prefix)
    const exMatch = pathPart.match(/(?:^|\/)(Ex\d+_[A-Za-z0-9_]+)\.(?:kt|java)$/);
    if (exMatch) {
      return `href="/modules/${moduleSlug}/exercises/${exMatch[1]}${anchor}"`;
    }

    // Cross-module theory: …/<mod>/theory/X.md
    const crossTheoryMatch = pathPart.match(
      /(?:^|\/)([a-z][a-z0-9-]+)\/theory\/([A-Za-z0-9_-]+)\.md$/,
    );
    if (crossTheoryMatch) {
      return `href="/modules/${crossTheoryMatch[1]}/theory/${crossTheoryMatch[2]}${anchor}"`;
    }

    // Cross-module root file
    const crossModRootMatch = pathPart.match(
      /(?:^|\/)([a-z][a-z0-9-]+)\/(?:README|ROADMAP|INTERVIEW_QUESTIONS)\.md$/,
    );
    if (crossModRootMatch) {
      return `href="/modules/${crossModRootMatch[1]}${anchor}"`;
    }

    // Same-module theory file (with or without theory/ prefix)
    const theoryMatch =
      pathPart.match(/(?:^|\/)theory\/([A-Za-z0-9_-]+)\.md$/) ??
      pathPart.match(/^([A-Za-z0-9_-]+)\.md$/);
    if (theoryMatch) {
      const slug = theoryMatch[1];
      if (slug === 'README' || slug === 'ROADMAP' || slug === 'INTERVIEW_QUESTIONS') {
        return `href="/modules/${moduleSlug}${anchor}"`;
      }
      return `href="/modules/${moduleSlug}/theory/${slug}${anchor}"`;
    }

    return full;
  });
}

function splitAnchor(href: string): [string, string] {
  const i = href.indexOf('#');
  if (i === -1) return [href, ''];
  return [href.slice(0, i), href.slice(i)];
}

export async function renderMarkdown(source: string): Promise<string> {
  return renderMarkdownToHtml(source);
}

/**
 * Same pipeline as `MarkdownView` (anchored headings + internal link rewrite),
 * but returns the raw HTML string instead of JSX. The theory reader (batch B2)
 * needs the string so it can post-process it — `wrapContractMarkers` /
 * `injectSelfChecks` below — before handing it to `dangerouslySetInnerHTML`.
 */
export async function renderTheoryBodyHtml(source: string, moduleSlug: string): Promise<string> {
  const html = await renderMarkdownToHtml(source, true);
  return rewriteInternalLinks(html, moduleSlug);
}

export async function MarkdownView({
  source,
  moduleSlug,
}: {
  source: string;
  moduleSlug?: string;
}) {
  const html = moduleSlug
    ? await renderTheoryBodyHtml(source, moduleSlug)
    : await renderMarkdownToHtml(source, true);
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export async function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const html = await highlight(code, lang);
  return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ============================================================================
 * Theory contract header (batch B2)
 *
 * `knowledge/THEORY_CONTRACT.md` asks every theory file to open with a leading
 * blockquote answering three fixed questions. Not every file follows this —
 * 61/199 do at the time of writing. Where present, the reader renders it as a
 * three-column header instead of a normal quote block, so it is stripped from
 * the body before the body is rendered.
 * ========================================================================= */

export interface ContractHeader {
  /** Raw markdown (unrendered) for each of the three fixed answers. */
  problem: string;
  who: string;
  whenNot: string;
}

const CONTRACT_HEADER_RE = {
  problem: /\*\*Какую проблему решает\.\*\*\s*([\s\S]*?)(?=\*\*Кому это надо\.\*\*|\*\*Когда НЕ надо\.\*\*|$)/,
  who: /\*\*Кому это надо\.\*\*\s*([\s\S]*?)(?=\*\*Когда НЕ надо\.\*\*|$)/,
  whenNot: /\*\*Когда НЕ надо\.\*\*\s*([\s\S]*)$/,
};

/**
 * Looks for a contiguous run of `> ` lines starting at (or right after) the H1
 * and containing all three fixed markers. Returns the parsed header plus the
 * body with that blockquote removed, or `null` if the file doesn't use this
 * convention (most don't — the caller renders the body unchanged then).
 */
export function extractContractHeader(
  body: string,
): { header: ContractHeader; strippedBody: string } | null {
  const lines = body.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^>\s?/.test(lines[i])) {
      start = i;
      break;
    }
    if (/^##\s/.test(lines[i])) return null; // hit the first section, no leading quote
  }
  if (start === -1) return null;

  let end = start;
  while (end < lines.length && /^>\s?/.test(lines[end])) end++;

  const joined = lines
    .slice(start, end)
    .map((l) => l.replace(/^>\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const problem = joined.match(CONTRACT_HEADER_RE.problem)?.[1]?.trim();
  const who = joined.match(CONTRACT_HEADER_RE.who)?.[1]?.trim();
  const whenNot = joined.match(CONTRACT_HEADER_RE.whenNot)?.[1]?.trim();
  if (!problem || !who || !whenNot) return null;

  const strippedBody = [...lines.slice(0, start), ...lines.slice(end)].join('\n');
  return { header: { problem, who, whenNot }, strippedBody };
}

/**
 * Drops the file's leading `# Title` line. `TheoryDoc.title` (shown by the
 * reader as its own styled `<h1>`) is extracted from that exact line at sync
 * time (`scripts/sync.ts: extractTitle`), so rendering the body unchanged
 * duplicated the heading — this existed before batch B2 too, `MarkdownView`
 * just had nothing else to compare it against. Only the first line is
 * touched; everything else (including the H1's own scroll-spy relevance —
 * there is none, sections start at `##`) is unaffected.
 */
export function stripLeadingH1(body: string): string {
  return body.replace(/^#[^\n]*\n?/, '');
}

/* ============================================================================
 * Contract markers (batch B2)
 *
 * `**Задача.**`, `**Наивный ответ.**`, `**Где ломается.**`, `**Механизм.**`,
 * `**Правило.**` mark paragraphs that follow the "задача → наивный ответ → где
 * ломается → механизм → правило" shape from THEORY_CONTRACT.md. Present in
 * 25/199 files (microservices 13, engineering-process 10, infrastructure 2);
 * `Правило` alone reaches 38 files. Only the single matched `<p>` is boxed —
 * a following code block or list (common after "Где ломается") is left as
 * normal body content below the box, not swallowed into it.
 * ========================================================================= */

const MARKER_KEYS = ['Задача', 'Наивный ответ', 'Где ломается', 'Механизм', 'Правило'] as const;
type MarkerKey = (typeof MARKER_KEYS)[number];

const MARKER_STYLE: Record<MarkerKey, { box: string; label: string }> = {
  'Задача': { box: 'my-3.5', label: 'text-fg-subtle' },
  'Наивный ответ': {
    box: 'my-3.5 rounded-r-lg border-l-[3px] border-fg-subtle bg-fg-subtle/[0.07] py-2.5 pl-3.5 pr-4',
    label: 'text-fg-muted',
  },
  'Где ломается': {
    box: 'my-3.5 rounded-r-lg border-l-[3px] border-warn bg-warn/[0.08] py-2.5 pl-3.5 pr-4',
    label: 'text-warn',
  },
  'Механизм': { box: 'my-3.5', label: 'text-fg-subtle' },
  'Правило': {
    box: 'my-3.5 rounded-r-lg border-l-[3px] border-accent bg-accent-soft py-2.5 pl-3.5 pr-4',
    label: 'text-accent',
  },
};

const MARKER_PARAGRAPH_RE = new RegExp(
  `<p><strong>((?:${MARKER_KEYS.join('|')})[\\s\\S]*?)<\\/strong>[\\s\\S]*?<\\/p>`,
  'g',
);

/** Wraps each matched marker paragraph in a labeled, color-coded block. */
export function wrapContractMarkers(html: string): string {
  return html.replace(MARKER_PARAGRAPH_RE, (full, labelInner: string) => {
    const key = MARKER_KEYS.find((k) => labelInner.startsWith(k));
    if (!key) return full;
    const style = MARKER_STYLE[key];
    // No `not-prose` here on purpose: `full` is the original `<p>` produced by
    // the normal markdown pipeline, and it keeps inheriting `.prose` paragraph
    // typography (color, code/link styling) from the surrounding document —
    // this div only adds the label and the colored rule/background around it.
    return `<div class="${style.box}"><span class="lbl ${style.label}">${key}</span>${full}</div>`;
  });
}

/* ============================================================================
 * Self-check callouts (batch B2)
 *
 * For a section number N, if the doc has an InterviewQA with refSection = N,
 * a "Проверь себя" callout is injected right before the next `##` heading (or
 * at the end of the doc for the last section). Pure HTML/CSS — the answer
 * reveal uses `<details>`, no client JS.
 * ========================================================================= */

export interface SelfCheckItem {
  qNumber: number;
  refSection: number;
  /** Rendered via renderMarkdown — already `<p>…</p>`. */
  questionHtml: string;
  /** Rendered via renderMarkdown — already `<p>…</p>`. */
  answerHtml: string;
  sourceRef?: string | null;
}

function selfCheckHtml(item: SelfCheckItem): string {
  const src = item.sourceRef
    ? `<div class="mt-2 border-l-2 border-accent/40 pl-2.5 font-mono text-[11px] text-fg-subtle">${escapeHtml(item.sourceRef)}</div>`
    : '';
  return `<div class="not-prose my-4 flex items-start gap-2.5 rounded-lg border border-accent/30 bg-accent/5 p-3.5">
<svg class="mt-0.5 h-[15px] w-[15px] flex-none text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M9.6 9.4a2.4 2.4 0 1 1 3.2 2.3c-.6.2-.8.7-.8 1.3"></path><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"></circle></svg>
<div class="min-w-0 flex-1">
<div class="mb-1.5 flex flex-wrap items-center gap-2"><span class="lbl text-accent">Проверь себя</span><span class="font-mono text-[10.5px] text-fg-subtle">Q${item.qNumber} · привязан к §${item.refSection}</span></div>
<div class="prose prose-sm max-w-none text-fg [&>p]:font-medium">${item.questionHtml}</div>
<details class="group mt-2.5">
<summary class="inline-flex h-[27px] cursor-pointer list-none items-center rounded-md border border-accent bg-accent px-3 text-[12.5px] font-medium text-white [&::-webkit-details-marker]:hidden group-open:bg-bg-card group-open:text-accent"><span class="group-open:hidden">Показать ответ</span><span class="hidden group-open:inline">Скрыть ответ</span></summary>
<div class="mt-2.5 rounded-md bg-bg-soft p-3"><div class="prose prose-sm max-w-none text-fg">${item.answerHtml}</div>${src}</div>
</details>
</div>
</div>`;
}

interface SectionAnchor {
  index: number;
  number: number | null;
  anchor: string;
}

/**
 * Splices self-check callouts into already-rendered body HTML. `sections`
 * must come from `extractTheorySections` run on the same body that produced
 * `html` (same anchors, same order) — see lib/theory-sections.ts.
 */
export function injectSelfChecks(
  html: string,
  sections: SectionAnchor[],
  itemsBySection: Map<number, SelfCheckItem[]>,
): string {
  if (itemsBySection.size === 0) return html;
  let out = html;
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.number == null) continue;
    const items = itemsBySection.get(sec.number);
    if (!items || items.length === 0) continue;
    const block = items.map(selfCheckHtml).join('');
    const next = sections[i + 1];
    const marker = next ? `<h2 id="${next.anchor}">` : null;
    if (marker && out.includes(marker)) {
      out = out.replace(marker, block + marker);
    } else {
      out += block;
    }
  }
  return out;
}
