import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ProgressBar } from '@/components/ProgressBar';
import { endOfDay } from '@/lib/leitner';

export const dynamic = 'force-dynamic';

interface ModuleStats {
  slug: string;
  title: string;
  order: number;
  theory: { done: number; total: number };
  exercises: { done: number; total: number };
  qas: { done: number; total: number };
}

async function loadStats(userId: number): Promise<{ modules: ModuleStats[]; totals: { done: number; total: number }; due: number }> {
  const modules = await prisma.module.findMany({
    orderBy: { order: 'asc' },
    include: {
      _count: { select: { theory: true, exercises: true, qas: true } },
    },
  });

  const [theoryProgress, exerciseProgress, qaProgress] = await Promise.all([
    prisma.userTheoryProgress.findMany({ where: { userId, isRead: true }, select: { theoryDocId: true } }),
    prisma.userExerciseProgress.findMany({ where: { userId, isRead: true }, select: { exerciseId: true } }),
    prisma.userQAProgress.findMany({ where: { userId, isKnown: true }, select: { qaId: true } }),
  ]);

  const readTheory = new Set(theoryProgress.map((p) => p.theoryDocId));
  const readExercises = new Set(exerciseProgress.map((p) => p.exerciseId));
  const knownQAs = new Set(qaProgress.map((p) => p.qaId));

  const allTheory = await prisma.theoryDoc.findMany({ select: { id: true, moduleId: true } });
  const allExercises = await prisma.exercise.findMany({ select: { id: true, moduleId: true } });
  const allQAs = await prisma.interviewQA.findMany({ select: { id: true, moduleId: true } });

  const stats: ModuleStats[] = modules.map((m) => ({
    slug: m.slug,
    title: m.title,
    order: m.order,
    theory: {
      total: m._count.theory,
      done: allTheory.filter((t) => t.moduleId === m.id && readTheory.has(t.id)).length,
    },
    exercises: {
      total: m._count.exercises,
      done: allExercises.filter((e) => e.moduleId === m.id && readExercises.has(e.id)).length,
    },
    qas: {
      total: m._count.qas,
      done: allQAs.filter((q) => q.moduleId === m.id && knownQAs.has(q.id)).length,
    },
  }));

  let totalDone = 0;
  let totalTotal = 0;
  for (const s of stats) {
    totalDone += s.theory.done + s.exercises.done + s.qas.done;
    totalTotal += s.theory.total + s.exercises.total + s.qas.total;
  }

  const due = await prisma.leitnerState.count({
    where: { userId, nextDueAt: { lte: endOfDay(new Date()) }, flashcard: { archived: false } },
  });

  return { modules: stats, totals: { done: totalDone, total: totalTotal }, due };
}

export default async function DashboardPage() {
  const userId = await requireUser();
  const { modules, totals, due } = await loadStats(userId);

  if (modules.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-fg">Welcome</h1>
        <p className="text-fg">
          База пуста. Запусти <code className="rounded bg-bg-card px-1.5 py-0.5">pnpm sync</code> чтобы
          подтянуть теорию и Q&amp;A из <code>../modules/</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h1 className="text-2xl font-semibold text-fg">Прогресс</h1>
          <Link
            href="/flashcards"
            className="rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-fg hover:text-fg hover:border-accent/50 sm:py-1.5"
          >
            На повторение: <b className="tabular-nums">{due}</b>
          </Link>
        </div>
        <ProgressBar done={totals.done} total={totals.total} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">Модули</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const done = m.theory.done + m.exercises.done + m.qas.done;
            const total = m.theory.total + m.exercises.total + m.qas.total;
            return (
              <Link
                key={m.slug}
                href={`/modules/${m.slug}`}
                className="group rounded-lg border border-border bg-bg-card p-4 transition hover:border-accent/50"
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="font-medium text-fg group-hover:text-accent">{m.title}</h3>
                </div>
                <ProgressBar done={done} total={total} />
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-fg-muted">
                  <Cell label="theory" stat={m.theory} />
                  <Cell label="ex." stat={m.exercises} />
                  <Cell label="Q&A" stat={m.qas} />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Cell({ label, stat }: { label: string; stat: { done: number; total: number } }) {
  return (
    <div className="rounded border border-border/50 bg-bg-soft px-2 py-1 text-center">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="font-mono text-fg">
        {stat.done}/{stat.total}
      </div>
    </div>
  );
}
