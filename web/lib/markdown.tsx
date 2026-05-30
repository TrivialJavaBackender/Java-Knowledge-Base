import { marked } from 'marked';
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

marked.setOptions({ gfm: true, breaks: false });

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
async function renderMarkdownToHtml(source: string): Promise<string> {
  const blocks: CodeBlockToken[] = [];
  const stripped = source.replace(
    /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g,
    (_m, lang: string, code: string) => {
      const placeholder = `<!--CODEBLOCK:${blocks.length}-->`;
      blocks.push({ placeholder, lang: lang || 'plaintext', code });
      return `\n\n${placeholder}\n\n`;
    },
  );

  let html = await marked.parse(stripped);

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

export async function MarkdownView({
  source,
  moduleSlug,
}: {
  source: string;
  moduleSlug?: string;
}) {
  let html = await renderMarkdownToHtml(source);
  if (moduleSlug) html = rewriteInternalLinks(html, moduleSlug);
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export async function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const html = await highlight(code, lang);
  return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
}
