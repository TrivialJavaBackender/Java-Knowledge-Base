'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  MIN_QUERY_LENGTH,
  SEARCH_INDEX_URL,
  prepareIndex,
  search,
  type PreparedIndex,
  type ResultGroup,
  type SearchIndex,
  type SearchResult,
} from '@/lib/search';

/**
 * One fetch per browser tab, kept across client-side navigations. The index is
 * a static CDN asset, so even a hard reload usually costs a 304 from a nearby
 * edge rather than a trip to the origin.
 */
let indexPromise: Promise<PreparedIndex> | null = null;

function loadIndex(): Promise<PreparedIndex> {
  if (!indexPromise) {
    indexPromise = fetch(SEARCH_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`search index: HTTP ${res.status}`);
        return res.json() as Promise<SearchIndex>;
      })
      .then(prepareIndex)
      .catch((err) => {
        indexPromise = null; // let the next focus retry
        throw err;
      });
  }
  return indexPromise;
}

const GROUP_ORDER: ResultGroup[] = ['concept', 'theory', 'qa', 'exercise'];
const GROUP_LABELS: Record<ResultGroup, string> = {
  concept: 'Концепты',
  theory: 'Теория',
  qa: 'Q&A',
  exercise: 'Упражнения',
};

/** Match offsets come from a length-preserving normalization — see lib/search.ts. */
function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([rawStart, rawEnd], i) => {
    const start = Math.min(rawStart, text.length);
    const end = Math.min(rawEnd, text.length);
    if (start >= end) return;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-accent">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

export function SearchBox() {
  const pathname = usePathname();
  const listId = useId();

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<PreparedIndex | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [open, setOpen] = useState(false);
  /** Small screens have no room in the header — the field lives in an overlay. */
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  const currentModule = useMemo(
    () => pathname?.match(/^\/modules\/([^/]+)/)?.[1],
    [pathname],
  );

  const ensureIndex = useCallback(() => {
    if (status === 'loading' || status === 'ready') return;
    setStatus('loading');
    loadIndex().then(
      (loaded) => {
        setIndex(loaded);
        setStatus('ready');
      },
      () => setStatus('error'),
    );
  }, [status]);

  // Filtering 6.5k rows is a sub-millisecond pass, but deferring it keeps
  // typing responsive no matter how the list grows.
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(
    () => (index ? search(index, deferredQuery, currentModule) : []),
    [index, deferredQuery, currentModule],
  );

  const groups = useMemo(() => {
    const buckets = new Map<ResultGroup, SearchResult[]>();
    for (const r of results) {
      const bucket = buckets.get(r.group);
      if (bucket) bucket.push(r);
      else buckets.set(r.group, [r]);
    }
    return GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({
      group: g,
      items: buckets.get(g)!,
    }));
  }, [results]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const close = useCallback(() => {
    setOpen(false);
    setExpanded(false);
  }, []);

  const focusSearch = useCallback(() => {
    setExpanded(true);
    setOpen(true);
    ensureIndex();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [ensureIndex]);

  useEffect(() => setActive(0), [deferredQuery]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // A finished navigation means the result was taken — drop back to neutral.
  useEffect(() => {
    close();
    setQuery('');
  }, [pathname, close]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [close]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        focusSearch();
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        focusSearch();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusSearch]);

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'Tab') {
      close();
      return;
    }
    if (!open || flat.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Click the real anchor so keyboard and mouse take the identical path.
      activeRef.current?.click();
    }
  }

  const tooShort = query.trim().length < MIN_QUERY_LENGTH;
  const showPanel = open;

  let panelBody: ReactNode = null;
  if (tooShort) {
    panelBody = (
      <Hint>
        Минимум {MIN_QUERY_LENGTH} символа. Ищет по концептам, заголовкам теории, вопросам Q&amp;A
        и упражнениям.
      </Hint>
    );
  } else if (status === 'loading') {
    panelBody = <Hint>Загружаю индекс…</Hint>;
  } else if (status === 'error') {
    panelBody = <Hint>Не удалось загрузить индекс поиска. Попробуй ещё раз.</Hint>;
  } else if (flat.length === 0) {
    panelBody = <Hint>Ничего не найдено.</Hint>;
  } else {
    let cursor = -1;
    panelBody = (
      <ul id={listId} role="listbox" aria-label="Результаты поиска" className="py-1">
        {groups.map(({ group, items }) => (
          <li key={group}>
            <div className="sticky top-0 z-10 bg-bg-card px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
              {GROUP_LABELS[group]}
            </div>
            <ul>
              {items.map((r) => {
                cursor += 1;
                const i = cursor;
                const isActive = i === active;
                return (
                  <li key={`${r.href}-${i}`}>
                    <Link
                      id={`${listId}-opt-${i}`}
                      role="option"
                      aria-selected={isActive}
                      ref={isActive ? activeRef : undefined}
                      href={r.href}
                      title={`${r.row.t} — ${r.breadcrumb}`}
                      // Prefetching every visible result would fire a server
                      // render — and its database queries — per row.
                      prefetch={false}
                      onMouseEnter={() => setActive(i)}
                      onClick={(e) => {
                        close();
                        // Same page, different fragment: do it the way a plain
                        // anchor would. Assigning location.hash both scrolls and
                        // fires `hashchange` (which AnchoredQuestionCard listens for); Next's
                        // pushState does neither.
                        const at = r.href.indexOf('#');
                        if (at !== -1 && r.href.slice(0, at) === pathname) {
                          e.preventDefault();
                          window.location.hash = r.href.slice(at + 1);
                        }
                      }}
                      // A neutral tint plus an accent rule: the highlighted
                      // <mark>s already use accent-soft, so tinting the row with
                      // it too would swallow them.
                      className={`flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm text-fg ${
                        isActive ? 'bg-bg-soft shadow-[inset_2px_0_0_0_var(--accent)]' : ''
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <Highlighted text={r.row.t} ranges={r.ranges} />
                      </span>
                      {/* Needs min-w-0 to be allowed to truncate, and a cap so a
                          long document title cannot squeeze the result title out. */}
                      <span className="min-w-0 max-w-[38%] truncate text-right text-[11px] text-fg-subtle sm:max-w-[45%]">
                        {r.breadcrumb}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={focusSearch}
        aria-label="Поиск"
        className="rounded border border-border bg-bg-card px-2 py-1 text-xs text-fg-muted hover:border-accent/50 hover:text-fg sm:hidden"
      >
        ⌕
      </button>

      <div
        ref={rootRef}
        className={
          expanded
            ? 'fixed inset-x-0 top-0 z-50 border-b border-border bg-bg-soft p-3 sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0'
            : 'hidden sm:block'
        }
      >
        <div className={expanded ? 'flex items-center gap-2' : ''}>
          <div className={expanded ? 'relative flex-1' : 'relative'}>
            <input
              ref={inputRef}
              type="search"
              value={query}
              role="combobox"
              aria-expanded={showPanel}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                showPanel && flat.length > 0 ? `${listId}-opt-${active}` : undefined
              }
              autoComplete="off"
              spellCheck={false}
              placeholder="Поиск по теории, вопросам и концептам"
              onFocus={() => {
                setOpen(true);
                ensureIndex();
              }}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                ensureIndex();
              }}
              onKeyDown={onInputKeyDown}
              className="h-8 w-full rounded-md border border-border bg-bg-card pl-8 pr-16 text-[13.5px] text-fg placeholder:text-fg-subtle focus:border-accent/60 focus:outline-none"
            />

            {/* Иконка и бейдж — поверх поля; pl-8/pr-16 выше держат под них место. */}
            <svg
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-subtle"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-bg-soft px-1.5 py-0.5 font-mono text-[11px] leading-none text-fg-subtle">
              ⌘K
            </span>

            {showPanel && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-bg-card shadow-lg sm:left-auto sm:w-[26rem] lg:w-[32rem]">
                {panelBody}
              </div>
            )}
          </div>

          {/* The overlay hides the header, so give the reader a way out that
              does not require an Escape key. */}
          {expanded && (
            <button
              type="button"
              onClick={close}
              className="shrink-0 px-1 text-sm text-fg-muted hover:text-fg sm:hidden"
            >
              Отмена
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2.5 text-xs text-fg-muted">{children}</div>;
}
