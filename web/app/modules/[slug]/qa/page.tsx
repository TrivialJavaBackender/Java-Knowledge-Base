import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { ProgressBar } from '@/components/ProgressBar';
import { QAItem } from '@/components/QAItem';

export const dynamic = 'force-dynamic';

export default async function QAPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const module = await prisma.module.findUnique({
    where: { slug },
    include: {
      sections: {
        orderBy: { order: 'asc' },
        include: { qas: { orderBy: { qNumber: 'asc' } } },
      },
    },
  });
  if (!module) notFound();

  const allQas = module.sections.flatMap((s) => s.qas);
  const done = allQas.filter((q) => q.isKnown).length;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Link href={`/modules/${slug}`} className="text-sm text-fg-muted hover:text-accent">
          ← {module.title}
        </Link>
        <h1 className="text-2xl font-semibold text-fg">Interview Q&A — {module.title}</h1>
        <ProgressBar done={done} total={allQas.length} />
      </header>

      {module.sections.map((s) => {
        const sDone = s.qas.filter((q) => q.isKnown).length;
        return (
          <section key={s.id} id={`section-${s.id}`} className="space-y-3 scroll-mt-20">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-fg">
                {s.title}
              </h2>
              <span className="font-mono text-xs text-fg-subtle">{sDone}/{s.qas.length}</span>
            </div>
            <div className="space-y-2">
              {s.qas.map((q) => (
                <QAItem
                  key={q.id}
                  id={q.id}
                  qNumber={q.qNumber}
                  question={q.question}
                  answer={q.answer}
                  sourceRef={q.sourceRef}
                  initialKnown={q.isKnown}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
