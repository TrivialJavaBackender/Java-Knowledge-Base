import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getTrack, type TrackKey } from '@/lib/tracks';
import { MODULES } from '@/content.config';
import { MODULE_DESCRIPTIONS } from '@/components/module/module-descriptions';
import { ModuleHeader } from '@/components/module/ModuleHeader';
import { ModuleTabs, MODULE_TABS, type ModuleTab } from '@/components/module/ModuleTabs';
import { OverviewTab, type RoadmapStep, type ContinueInfo, type WeakQa, type RelatedModule } from '@/components/module/OverviewTab';
import { TheoryTab, type TheoryRow } from '@/components/module/TheoryTab';
import { ExercisesTab, type ExerciseRow } from '@/components/module/ExercisesTab';
import { QaTab, type QaSectionCard } from '@/components/module/QaTab';

export const dynamic = 'force-dynamic';

function normalizeTab(v: string | undefined): ModuleTab {
  return (MODULE_TABS as string[]).includes(v ?? '') ? (v as ModuleTab) : 'overview';
}

export default async function ModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab = normalizeTab(sp.tab);
  const userId = await requireUser();

  const module = await prisma.module.findUnique({
    where: { slug },
    include: {
      theory: {
        orderBy: [{ order: 'asc' }, { slug: 'asc' }],
        select: { id: true, slug: true, title: true, sectionCount: true, readingMinutes: true, filePath: true },
      },
      exercises: {
        orderBy: { number: 'asc' },
        select: { id: true, slug: true, number: true, title: true, language: true },
      },
      sections: {
        orderBy: { order: 'asc' },
        include: {
          qas: {
            orderBy: { qNumber: 'asc' },
            select: { id: true, qNumber: true, question: true, refDocSlug: true },
          },
        },
      },
    },
  });
  if (!module) notFound();

  const allQas = module.sections.flatMap((s) => s.qas);

  const [theoryProgress, exerciseProgress, qaProgress] = await Promise.all([
    prisma.userTheoryProgress.findMany({
      where: { userId, theoryDocId: { in: module.theory.map((t) => t.id) } },
      select: { theoryDocId: true, isRead: true, lastSectionIndex: true, lastVisitedAt: true },
    }),
    prisma.userExerciseProgress.findMany({
      where: { userId, exerciseId: { in: module.exercises.map((e) => e.id) } },
      select: { exerciseId: true, isRead: true },
    }),
    prisma.userQAProgress.findMany({
      where: { userId, qaId: { in: allQas.map((q) => q.id) } },
      select: { qaId: true, isKnown: true },
    }),
  ]);

  const theoryProgMap = new Map(theoryProgress.map((p) => [p.theoryDocId, p]));
  const exReadMap = new Map(exerciseProgress.map((p) => [p.exerciseId, p.isRead]));
  const knownMap = new Map(qaProgress.map((p) => [p.qaId, p.isKnown]));

  const theoryDone = module.theory.filter((t) => theoryProgMap.get(t.id)?.isRead).length;
  const theoryTotal = module.theory.length;
  const exDone = module.exercises.filter((e) => exReadMap.get(e.id)).length;
  const exTotal = module.exercises.length;
  const qaDone = allQas.filter((q) => knownMap.get(q.id)).length;
  const qaTotal = allQas.length;

  const track = getTrack(module.track as TrackKey);
  const description = MODULE_DESCRIPTIONS[module.slug] ?? null;

  // Первый непрочитанный документ по order — "текущий" шаг роадмапа и
  // подсветка строки на вкладке "Теория".
  const currentIdx = module.theory.findIndex((t) => !theoryProgMap.get(t.id)?.isRead);

  // Данные, нужные только вкладке "Обзор" (включая единственный запрос
  // тел документов для связанных модулей) — считаем только когда она активна.
  let steps: RoadmapStep[] = [];
  let continueInfo: ContinueInfo | null = null;
  let weakQas: WeakQa[] = [];
  let relatedModules: RelatedModule[] = [];

  if (tab === 'overview') {
    steps = module.theory.map((t, i) => {
      const isRead = theoryProgMap.get(t.id)?.isRead ?? false;
      const isCurrent = i === currentIdx;
      const status: RoadmapStep['status'] = isRead ? 'done' : isCurrent ? 'current' : 'future';
      let meta: string;
      if (status === 'done') {
        meta = 'прочитано';
      } else if (status === 'current') {
        const sec = (theoryProgMap.get(t.id)?.lastSectionIndex ?? 0) + 1;
        meta = t.sectionCount > 0 ? `§${Math.min(sec, t.sectionCount)} из ${t.sectionCount}` : 'начать';
      } else {
        meta = `~${t.readingMinutes} мин`;
      }
      return { slug: t.slug, num: i + 1, title: t.title, status, meta };
    });

    const visited = theoryProgress
      .filter((p) => p.lastVisitedAt)
      .sort((a, b) => (b.lastVisitedAt as Date).getTime() - (a.lastVisitedAt as Date).getTime());
    const continueRow = visited[0] ?? null;
    const continueDoc = continueRow
      ? (module.theory.find((t) => t.id === continueRow.theoryDocId) ?? null)
      : currentIdx >= 0
        ? module.theory[currentIdx]
        : null;

    if (continueDoc) {
      const prog = theoryProgMap.get(continueDoc.id);
      let meta: string;
      if (prog?.lastVisitedAt) {
        const secNum = Math.min((prog.lastSectionIndex ?? 0) + 1, continueDoc.sectionCount || 1);
        const remaining =
          continueDoc.sectionCount > 0
            ? Math.max(0, Math.round(continueDoc.readingMinutes * (1 - secNum / continueDoc.sectionCount)))
            : continueDoc.readingMinutes;
        meta =
          continueDoc.sectionCount > 0
            ? `§${secNum} из ${continueDoc.sectionCount} · осталось ~${remaining} мин`
            : `осталось ~${remaining} мин`;
      } else {
        meta = `~${continueDoc.readingMinutes} мин`;
      }
      continueInfo = {
        slug: continueDoc.slug,
        title: continueDoc.title,
        meta,
        // Вся теория прочитана — карточка «Продолжить» иначе предлагала бы
        // «Читать дальше» с подписью «§13 из 13 · осталось ~0 мин».
        allRead: theoryTotal > 0 && theoryDone === theoryTotal,
        qaOpen: Math.max(0, qaTotal - qaDone),
      };
    }

    if (allQas.length > 0) {
      const weakStates = await prisma.leitnerState.findMany({
        where: { userId, lapses: { gt: 0 }, flashcard: { qaId: { in: allQas.map((q) => q.id) } } },
        orderBy: { lapses: 'desc' },
        take: 5,
        select: { lapses: true, flashcard: { select: { qa: { select: { qNumber: true, question: true } } } } },
      });
      weakQas = weakStates
        .filter((s): s is typeof s & { flashcard: { qa: { qNumber: number; question: string } } } => !!s.flashcard?.qa)
        .map((s) => ({ qNumber: s.flashcard.qa.qNumber, question: s.flashcard.qa.question, lapses: s.lapses }));
    }

    // Связанные модули: единственный запрос, выбирающий только `body`
    // документов этого модуля — тела крупные, поэтому не тянем их на
    // других вкладках.
    const bodies = await prisma.theoryDoc.findMany({ where: { moduleId: module.id }, select: { body: true } });
    const freq = new Map<string, number>();
    const linkRe = /\.\.\/\.\.\/([a-z0-9-]+)\/theory\//g;
    for (const { body } of bodies) {
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(body))) {
        const otherSlug = m[1];
        if (otherSlug === module.slug) continue;
        freq.set(otherSlug, (freq.get(otherSlug) ?? 0) + 1);
      }
    }
    relatedModules = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([s]) => ({ slug: s, title: MODULES.find((m) => m.slug === s)?.title ?? s }));
  }

  let theoryRows: TheoryRow[] = [];
  if (tab === 'theory') {
    const qCountByDoc = new Map<string, number>();
    for (const q of allQas) {
      if (!q.refDocSlug) continue;
      qCountByDoc.set(q.refDocSlug, (qCountByDoc.get(q.refDocSlug) ?? 0) + 1);
    }
    theoryRows = module.theory.map((t, i) => ({
      slug: t.slug,
      num: i + 1,
      title: t.title,
      sectionCount: t.sectionCount,
      readingMinutes: t.readingMinutes,
      qCount: qCountByDoc.get(t.slug) ?? 0,
      isRead: theoryProgMap.get(t.id)?.isRead ?? false,
      isCurrent: i === currentIdx,
    }));
  }

  let exerciseRows: ExerciseRow[] = [];
  if (tab === 'exercises') {
    exerciseRows = module.exercises.map((e) => ({
      slug: e.slug,
      number: e.number,
      title: e.title,
      language: e.language,
      isRead: exReadMap.get(e.id) ?? false,
    }));
  }

  let qaSections: QaSectionCard[] = [];
  if (tab === 'qa') {
    const filePathBySlug = new Map(module.theory.map((t) => [t.slug, t.filePath]));
    qaSections = module.sections.map((s) => {
      const known = s.qas.filter((q) => knownMap.get(q.id)).length;
      const refSlugs = new Set(s.qas.map((q) => q.refDocSlug).filter((x): x is string => !!x));
      let fileName: string | null = null;
      if (refSlugs.size === 1) {
        const [only] = refSlugs;
        const fp = filePathBySlug.get(only);
        if (fp) fileName = fp.split('/').pop() ?? fp;
      }
      return { id: s.id, title: s.title, known, total: s.qas.length, fileName };
    });
  }

  const tabCounts = {
    theory: `${theoryDone}/${theoryTotal}`,
    exercises: exTotal > 0 ? `${exDone}/${exTotal}` : '—',
    qa: `${qaDone}/${qaTotal}`,
  } as const;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <ModuleHeader
        trackTitle={track.title}
        trackColor={track.color}
        title={module.title}
        order={module.order}
        description={description}
        theoryDone={theoryDone}
        theoryTotal={theoryTotal}
        exDone={exDone}
        exTotal={exTotal}
        qaDone={qaDone}
        qaTotal={qaTotal}
      />

      <div className="mt-4 border-b border-border">
        <ModuleTabs slug={slug} active={tab} counts={tabCounts} />
      </div>

      <div className="py-5">
        {tab === 'overview' && (
          <OverviewTab
            moduleSlug={slug}
            steps={steps}
            continueInfo={continueInfo}
            weakQas={weakQas}
            relatedModules={relatedModules}
          />
        )}
        {tab === 'theory' && <TheoryTab moduleSlug={slug} rows={theoryRows} />}
        {tab === 'exercises' && <ExercisesTab moduleSlug={slug} rows={exerciseRows} />}
        {tab === 'qa' && <QaTab moduleSlug={slug} sections={qaSections} />}
      </div>
    </div>
  );
}
