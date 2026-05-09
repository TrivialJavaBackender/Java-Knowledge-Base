import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { ProgressBar } from '@/components/ProgressBar';
import { ToggleTheoryRead, ToggleExerciseRead } from '@/components/ToggleProgress';

export const dynamic = 'force-dynamic';

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const module = await prisma.module.findUnique({
    where: { slug },
    include: {
      theory: { orderBy: [{ order: 'asc' }, { slug: 'asc' }] },
      exercises: { orderBy: { number: 'asc' } },
      sections: {
        orderBy: { order: 'asc' },
        include: {
          qas: { orderBy: { qNumber: 'asc' } },
        },
      },
    },
  });
  if (!module) notFound();

  const theoryDone = module.theory.filter((t) => t.isRead).length;
  const exDone = module.exercises.filter((e) => e.isRead).length;
  const qaDone = module.sections.flatMap((s) => s.qas).filter((q) => q.isKnown).length;
  const qaTotal = module.sections.reduce((s, sec) => s + sec.qas.length, 0);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Link href="/" className="text-sm text-fg-muted hover:text-accent">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-semibold text-fg">{module.title}</h1>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Theory" done={theoryDone} total={module.theory.length} />
        <Stat label="Exercises" done={exDone} total={module.exercises.length} />
        <Stat label="Q&A" done={qaDone} total={qaTotal} />
      </div>

      {module.theory.length > 0 && (
        <Section title="Theory">
          <div className="divide-y divide-border rounded-lg border border-border bg-bg-card">
            {module.theory.map((t) => (
              <div key={t.id} className="flex items-center gap-4 px-4 py-3">
                <ToggleTheoryRead id={t.id} initial={t.isRead} />
                <Link href={`/modules/${slug}/theory/${t.slug}`} className="flex-1 hover:text-accent">
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-fg-subtle">{t.slug}.md</div>
                </Link>
              </div>
            ))}
          </div>
        </Section>
      )}

      {module.exercises.length > 0 && (
        <Section title="Exercises">
          <div className="divide-y divide-border rounded-lg border border-border bg-bg-card">
            {module.exercises.map((e) => (
              <div key={e.id} className="flex items-center gap-4 px-4 py-3">
                <ToggleExerciseRead id={e.id} initial={e.isRead} />
                <Link href={`/modules/${slug}/exercises/${e.slug}`} className="flex-1 hover:text-accent">
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-fg-subtle font-mono">{e.slug}.{e.language === 'kotlin' ? 'kt' : 'java'}</div>
                </Link>
              </div>
            ))}
          </div>
        </Section>
      )}

      {qaTotal > 0 && (
        <Section title="Interview Q&A" right={<Link href={`/modules/${slug}/qa`} className="text-sm text-accent hover:underline">Open browser →</Link>}>
          <div className="grid gap-2 sm:grid-cols-2">
            {module.sections.map((s) => {
              const done = s.qas.filter((q) => q.isKnown).length;
              return (
                <Link
                  key={s.id}
                  href={`/modules/${slug}/qa#section-${s.id}`}
                  className="rounded border border-border bg-bg-card p-3 hover:border-accent/50"
                >
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{s.title}</span>
                    <span className="text-xs text-fg-subtle tabular-nums">{done}/{s.qas.length}</span>
                  </div>
                  <ProgressBar done={done} total={s.qas.length} />
                </Link>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-fg-subtle">{label}</span>
        <span className="text-sm font-mono tabular-nums text-fg">{done}/{total}</span>
      </div>
      <ProgressBar done={done} total={total} />
    </div>
  );
}
