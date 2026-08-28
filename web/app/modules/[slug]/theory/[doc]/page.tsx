import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { OpenInIde } from '@/components/OpenInIde';
import { ToggleTheoryRead } from '@/components/ToggleProgress';
import { MermaidInit } from '@/components/MermaidInit';
import {
  renderMarkdown,
  renderTheoryBodyHtml,
  extractContractHeader,
  stripLeadingH1,
  wrapContractMarkers,
  injectSelfChecks,
  type SelfCheckItem,
} from '@/lib/markdown';
import { extractTheorySections } from '@/lib/theory-sections';
import { ContractHeaderCards } from '@/components/theory/ContractHeaderCards';
import { LeftNav, type NavDoc, type NavQaSection } from '@/components/theory/LeftNav';
import { TocColumn, type TocSection } from '@/components/theory/TocColumn';
import { QuestionsPanel, type QaCard } from '@/components/theory/QuestionsPanel';
import { ReadingProgress } from '@/components/theory/ReadingProgress';

export const dynamic = 'force-dynamic';

const SCROLL_ID = 'theory-scroll';

export default async function TheoryPage({
  params,
}: {
  params: Promise<{ slug: string; doc: string }>;
}) {
  const { slug, doc } = await params;
  const userId = await requireUser();

  const module = await prisma.module.findUnique({ where: { slug } });
  if (!module) notFound();

  const theory = await prisma.theoryDoc.findUnique({
    where: { moduleId_slug: { moduleId: module.id, slug: doc } },
  });
  if (!theory) notFound();

  const [progress, siblings, exercises, qaSectionsRaw, allModuleQas, moduleCount] = await Promise.all([
    prisma.userTheoryProgress.findUnique({
      where: { userId_theoryDocId: { userId, theoryDocId: theory.id } },
    }),
    prisma.theoryDoc.findMany({
      where: { moduleId: module.id },
      orderBy: [{ order: 'asc' }, { slug: 'asc' }],
      select: { id: true, slug: true, title: true, sectionCount: true, readingMinutes: true },
    }),
    prisma.exercise.findMany({ where: { moduleId: module.id }, select: { id: true } }),
    prisma.interviewSection.findMany({
      where: { moduleId: module.id },
      orderBy: { order: 'asc' },
      include: { qas: { select: { id: true } } },
    }),
    prisma.interviewQA.findMany({
      where: { moduleId: module.id },
      orderBy: [{ sectionId: 'asc' }, { qNumber: 'asc' }],
      include: {
        section: { select: { title: true } },
        flashcard: { include: { leitnerStates: { where: { userId } } } },
      },
    }),
    prisma.module.count(),
  ]);

  const isRead = progress?.isRead ?? false;

  const [siblingProgress, exerciseProgress, qaProgress] = await Promise.all([
    prisma.userTheoryProgress.findMany({
      where: { userId, theoryDocId: { in: siblings.map((s) => s.id) } },
      select: { theoryDocId: true, isRead: true },
    }),
    prisma.userExerciseProgress.findMany({
      where: { userId, exerciseId: { in: exercises.map((e) => e.id) } },
      select: { exerciseId: true, isRead: true },
    }),
    prisma.userQAProgress.findMany({
      where: { userId, qaId: { in: allModuleQas.map((q) => q.id) } },
      select: { qaId: true, isKnown: true },
    }),
  ]);

  const readMap = new Map(siblingProgress.map((p) => [p.theoryDocId, p.isRead]));
  const knownQaMap = new Map(qaProgress.map((p) => [p.qaId, p.isKnown]));

  const idx = siblings.findIndex((s) => s.slug === doc);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const docsDone = siblings.filter((s) => readMap.get(s.id)).length;
  const exDone = exerciseProgress.filter((p) => p.isRead).length;

  const docsNav: NavDoc[] = siblings.map((s) => ({
    slug: s.slug,
    title: s.title,
    isRead: readMap.get(s.id) ?? false,
    isCurrent: s.slug === doc,
  }));

  const qaSectionsNav: NavQaSection[] = qaSectionsRaw.map((s) => ({
    id: s.id,
    title: s.title,
    known: s.qas.filter((q) => knownQaMap.get(q.id)).length,
    total: s.qas.length,
  }));
  const qaTotal = allModuleQas.length;
  const qaKnown = qaSectionsNav.reduce((sum, s) => sum + s.known, 0);
  const overallDone = docsDone + exDone + qaKnown;
  const overallTotal = siblings.length + exercises.length + qaTotal;

  // Answers are rendered for the whole module up front (~90 at most, same
  // scale the existing /qa browser already renders eagerly) so the drawer's
  // "весь модуль" tab doesn't need a client round-trip.
  const answerHtmls = await Promise.all(allModuleQas.map((q) => renderMarkdown(q.answer)));
  const answerHtmlById = new Map(allModuleQas.map((q, i) => [q.id, answerHtmls[i]]));

  const moduleQuestions: QaCard[] = allModuleQas.map((q) => toQaCard(q, answerHtmlById.get(q.id)!, knownQaMap));
  const docQasRaw = allModuleQas.filter((q) => q.refDocSlug === theory.slug);
  const docQuestions: QaCard[] = docQasRaw.map((q) => toQaCard(q, answerHtmlById.get(q.id)!, knownQaMap));

  // Self-check callouts need the question rendered too (they're inlined into
  // the body as HTML, not shown via a React prose wrapper like the drawer).
  const selfCheckCandidates = docQasRaw.filter((q) => q.refSection != null);
  const questionHtmls = await Promise.all(selfCheckCandidates.map((q) => renderMarkdown(q.question)));
  const itemsBySection = new Map<number, SelfCheckItem[]>();
  selfCheckCandidates.forEach((q, i) => {
    const item: SelfCheckItem = {
      qNumber: q.qNumber,
      refSection: q.refSection!,
      questionHtml: questionHtmls[i],
      answerHtml: answerHtmlById.get(q.id)!,
      sourceRef: q.sourceRef,
    };
    const arr = itemsBySection.get(q.refSection!) ?? [];
    arr.push(item);
    itemsBySection.set(q.refSection!, arr);
  });

  const qCountBySection = new Map<number, number>();
  for (const q of docQasRaw) {
    if (q.refSection == null) continue;
    qCountBySection.set(q.refSection, (qCountBySection.get(q.refSection) ?? 0) + 1);
  }

  const extracted = extractContractHeader(theory.body);
  const bodyForRender = stripLeadingH1(extracted ? extracted.strippedBody : theory.body);

  // Sections are computed on the exact body that gets rendered (H1 and
  // contract-header blockquote stripped), so `sections[i].anchor` is
  // guaranteed to match the `id` the renderer actually emits — both walk
  // headings in document order through the same slug/dedupe logic
  // (lib/slugify.ts), but only if they start from the same text.
  const sections = extractTheorySections(bodyForRender).sections;
  const tocSections: TocSection[] = sections.map((s) => ({
    index: s.index,
    number: s.number,
    title: s.title,
    anchor: s.anchor,
    minutes: s.minutes,
    qCount: s.number != null ? (qCountBySection.get(s.number) ?? 0) : 0,
  }));

  let bodyHtml = await renderTheoryBodyHtml(bodyForRender, slug);
  bodyHtml = wrapContractMarkers(bodyHtml);
  bodyHtml = injectSelfChecks(bodyHtml, sections, itemsBySection);

  let contractHeaderNode: React.ReactNode = null;
  if (extracted) {
    const [problemHtml, whoHtml, whenNotHtml] = await Promise.all([
      renderMarkdown(extracted.header.problem),
      renderMarkdown(extracted.header.who),
      renderMarkdown(extracted.header.whenNot),
    ]);
    contractHeaderNode = <ContractHeaderCards problemHtml={problemHtml} whoHtml={whoHtml} whenNotHtml={whenNotHtml} />;
  }

  const fileName = theory.filePath.split('/').pop() ?? theory.filePath;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <LeftNav
          moduleSlug={slug}
          moduleTitle={module.title}
          moduleOrder={module.order}
          moduleCount={moduleCount}
          docs={docsNav}
          docsDone={docsDone}
          qaSections={qaSectionsNav}
          qaKnown={qaKnown}
          qaTotal={qaTotal}
          overallDone={overallDone}
          overallTotal={overallTotal}
        />

        <div id={SCROLL_ID} className="scroll relative min-w-0 flex-1 overflow-y-auto bg-bg">
          <ReadingProgress containerId={SCROLL_ID} />

          <div className="mx-auto max-w-[720px] px-4 pb-32 pt-6 sm:px-6">
            <div className="mb-3.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
              <Link href="/" className="text-fg-muted hover:text-accent">Dashboard</Link>
              <span>/</span>
              <Link href={`/modules/${slug}`} className="text-fg-muted hover:text-accent">{module.title}</Link>
              <span>/</span>
              <span>Теория</span>
            </div>

            <h1 className="mb-2.5 text-[28px] font-semibold leading-[1.25] tracking-tight text-fg">{theory.title}</h1>

            <div className="flex flex-wrap items-center gap-2.5 border-b border-border pb-4">
              <span className="text-[12.5px] text-fg-muted">
                {theory.sectionCount} {pluralizeSections(theory.sectionCount)}
              </span>
              <span className="text-fg-subtle">·</span>
              <span className="text-[12.5px] text-fg-muted">~{theory.readingMinutes} мин</span>
              <span className="text-fg-subtle">·</span>
              <span className="font-mono text-xs text-fg-subtle">{fileName}</span>
              <span className="flex-1" />
              <QuestionsPanel docQuestions={docQuestions} moduleQuestions={moduleQuestions} />
              <OpenInIde filePath={theory.filePath} />
              <ToggleTheoryRead id={theory.id} initial={isRead} label="Прочитано" />
            </div>

            {contractHeaderNode}

            <div className="prose mt-6 max-w-none" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            <MermaidInit />

            <nav className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
              {prev ? (
                <Link href={`/modules/${slug}/theory/${prev.slug}`} className="text-fg-muted hover:text-accent">
                  ← {prev.title}
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link href={`/modules/${slug}/theory/${next.slug}`} className="text-right text-fg-muted hover:text-accent">
                  {next.title} →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </div>
        </div>

        <TocColumn
          containerId={SCROLL_ID}
          theoryDocId={theory.id}
          sections={tocSections}
          initialActiveIndex={progress?.lastSectionIndex ?? 0}
          moduleSlug={slug}
          nextDoc={next}
        />
      </div>
    </div>
  );
}

type ModuleQaRow = {
  id: number;
  qNumber: number;
  refSection: number | null;
  question: string;
  sourceRef: string | null;
  section: { title: string };
  flashcard: { leitnerStates: { box: number }[] } | null;
};

function toQaCard(q: ModuleQaRow, answerHtml: string, knownQaMap: Map<number, boolean>): QaCard {
  return {
    id: q.id,
    qNumber: q.qNumber,
    sectionLabel: q.refSection != null ? `§${q.refSection}` : truncate(q.section.title, 24),
    box: q.flashcard?.leitnerStates[0]?.box ?? null,
    question: q.question,
    answerHtml,
    sourceRef: q.sourceRef,
    isKnown: knownQaMap.get(q.id) ?? false,
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function pluralizeSections(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'раздел';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'раздела';
  return 'разделов';
}
