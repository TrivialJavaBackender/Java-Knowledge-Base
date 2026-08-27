/**
 * Heading → anchor id. Shared by the markdown renderer (`lib/markdown.tsx`) and
 * the search-index builder (`scripts/search-index.ts`) so that a link produced
 * by search always lands on a heading the renderer actually emitted.
 *
 * Both sides must feed headings in document order — `uniqueAnchor` resolves
 * collisions positionally (10 theory docs repeat a heading text).
 */

/** Strip inline markdown so the anchor is built from the visible text. */
export function headingText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → label
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * GitHub-style slug, extended to keep Cyrillic. Latin/Cyrillic/digits survive,
 * everything else collapses into hyphens.
 */
export function slugifyHeading(raw: string): string {
  const slug = headingText(raw)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/** Adds `-2`, `-3`, … when the same slug was already emitted in this document. */
export function uniqueAnchor(seen: Map<string, number>, base: string): string {
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}
