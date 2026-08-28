import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ProgressBar } from '@/components/ProgressBar';
import { QAItem } from '@/components/QAItem';
import { renderMarkdown } from '@/lib/markdown';

export const dynamic = 'force-dynamic';

export default async function QAPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const userId = await requireUser();

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

  const qaProgress = await prisma.userQAProgress.findMany({
    where: { userId, qaId: { in: allQas.map((q) => q.id) } },
    select: { qaId: true, isKnown: true },
  });
  const knownMap = new Map(qaProgress.map((p) => [p.qaId, p.isKnown]));

  const done = allQas.filter((q) => knownMap.get(q.id)).length;

  const answerHtmlMap = new Map(
    await Promise.all(allQas.map(async (q) => [q.id, await renderMarkdown(q.answer)] as const))
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <div className="space-y-8">
      <header className="space-y-2">
        <Link href={`/modules/${slug}`} className="text-sm text-fg-muted hover:text-accent">
          ← {module.title}
        </Link>
        <h1 className="text-2xl font-semibold text-fg">Interview Q&A — {module.title}</h1>
        <ProgressBar done={done} total={allQas.length} />
      </header>

      {module.sections.map((s) => {
        const sDone = s.qas.filter((q) => knownMap.get(q.id)).length;
        return (
          <section key={s.id} id={`section-${s.id}`} className="space-y-3 scroll-mt-20">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-fg">{s.title}</h2>
              <span className="font-mono text-xs text-fg-subtle">{sDone}/{s.qas.length}</span>
            </div>
            <div className="space-y-2">
              {s.qas.map((q) => (
                <QAItem
                  key={q.id}
                  id={q.id}
                  qNumber={q.qNumber}
                  question={q.question}
                  answerHtml={answerHtmlMap.get(q.id) ?? ''}
                  sourceRef={q.sourceRef}
                  initialKnown={knownMap.get(q.id) ?? false}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
    </div>
  );
}
