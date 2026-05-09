import Link from 'next/link';
import { prisma } from '@/lib/db';
import { FlashcardForm } from '@/components/FlashcardForm';

export const dynamic = 'force-dynamic';

export default async function NewFlashcardPage() {
  const modules = await prisma.module.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, title: true },
  });
  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/flashcards/manage" className="text-sm text-fg-muted hover:text-accent">
        ← Manage
      </Link>
      <h1 className="text-2xl font-semibold text-fg">Новая карточка</h1>
      <FlashcardForm modules={modules} />
    </div>
  );
}
