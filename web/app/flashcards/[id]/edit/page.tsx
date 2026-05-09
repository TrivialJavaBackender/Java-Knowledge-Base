import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { FlashcardForm } from '@/components/FlashcardForm';

export const dynamic = 'force-dynamic';

export default async function EditFlashcardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cardId = parseInt(id, 10);
  if (Number.isNaN(cardId)) notFound();

  const [card, modules] = await Promise.all([
    prisma.flashcard.findUnique({ where: { id: cardId } }),
    prisma.module.findMany({ orderBy: { order: 'asc' }, select: { id: true, title: true } }),
  ]);
  if (!card) notFound();
  if (card.source !== 'MANUAL') {
    return (
      <div className="space-y-4">
        <Link href="/flashcards/manage" className="text-sm text-fg-muted hover:text-accent">
          ← Manage
        </Link>
        <p className="text-fg">
          Авто-карточки редактируются через <code className="rounded bg-bg-card px-1.5 py-0.5">INTERVIEW_QUESTIONS.md</code> +{' '}
          <code className="rounded bg-bg-card px-1.5 py-0.5">pnpm sync</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/flashcards/manage" className="text-sm text-fg-muted hover:text-accent">
        ← Manage
      </Link>
      <h1 className="text-2xl font-semibold text-fg">Редактировать карточку</h1>
      <FlashcardForm
        modules={modules}
        initial={{
          id: card.id,
          front: card.front,
          back: card.back,
          tags: card.tags,
          moduleId: card.moduleId,
        }}
      />
    </div>
  );
}
