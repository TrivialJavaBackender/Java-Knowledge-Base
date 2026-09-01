import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { MiniBar } from '@/components/module/MiniBar';
import { AnchoredQuestionCard, type QaCard } from '@/components/qa/QuestionCard';
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
        include: {
          qas: {
            orderBy: { qNumber: 'asc' },
            // leitnerStates отфильтрованы по пользователю — из них берётся бейдж «box N»,
            // тот же, что показывает панель вопросов в читалке.
            include: { flashcard: { include: { leitnerStates: { where: { userId } } } } },
          },
        },
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

  const answerHtmls = await Promise.all(allQas.map((q) => renderMarkdown(q.answer)));
  const answerHtmlById = new Map(allQas.map((q, i) => [q.id, answerHtmls[i]]));

  const cardsBySection = new Map<number, QaCard[]>(
    module.sections.map((s) => [
      s.id,
      s.qas.map((q) => ({
        id: q.id,
        qNumber: q.qNumber,
        // Заголовок секции уже стоит над списком, поэтому здесь бейдж нужен
        // только когда вопрос привязан к разделу теории.
        sectionLabel: q.refSection != null ? `§${q.refSection}` : '',
        box: q.flashcard?.leitnerStates[0]?.box ?? null,
        question: q.question,
        answerHtml: answerHtmlById.get(q.id) ?? '',
        sourceRef: q.sourceRef,
        isKnown: knownMap.get(q.id) ?? false,
      })),
    ]),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
        <Link href="/" className="text-fg-muted hover:text-accent">
          Dashboard
        </Link>
        <span>/</span>
        <Link href={`/modules/${slug}`} className="text-fg-muted hover:text-accent">
          {module.title}
        </Link>
        <span>/</span>
        <span>Вопросы</span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Вопросы к собеседованию</h1>
        <span className="font-mono text-[12.5px] text-fg-muted">
          знаю {done} из {allQas.length}
        </span>
      </div>
      <div className="mt-2.5">
        <MiniBar pct={allQas.length === 0 ? 0 : (done / allQas.length) * 100} />
      </div>

      {module.sections.length === 0 && (
        <div className="mt-5 rounded-[10px] border border-dashed border-border p-6 text-center text-sm text-fg-muted">
          В этом модуле пока нет вопросов.
        </div>
      )}

      <div className="mt-5 space-y-3.5">
        {module.sections.map((s) => {
          const sDone = s.qas.filter((q) => knownMap.get(q.id)).length;
          return (
            <section
              key={s.id}
              id={`section-${s.id}`}
              className="scroll-mt-20 overflow-hidden rounded-[10px] border border-border bg-bg-card"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-bg-soft px-3.5 py-2.5">
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-fg">{s.title}</span>
                <span className="flex-none font-mono text-[11px] text-fg-subtle">
                  {sDone}/{s.qas.length}
                </span>
                <div className="w-full sm:w-[84px] sm:flex-none">
                  <MiniBar pct={s.qas.length === 0 ? 0 : (sDone / s.qas.length) * 100} />
                </div>
              </div>

              <div className="space-y-2 p-2.5">
                {(cardsBySection.get(s.id) ?? []).map((q) => (
                  <AnchoredQuestionCard key={q.id} q={q} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
