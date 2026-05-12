import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { CodeBlock } from '@/lib/markdown';
import { ToggleExerciseRead } from '@/components/ToggleProgress';
import { requireUser } from '@/lib/auth';
import { OpenInIde } from '@/components/OpenInIde';

export const dynamic = 'force-dynamic';

export default async function ExercisePage({
  params,
}: {
  params: Promise<{ slug: string; ex: string }>;
}) {
  const { slug, ex } = await params;
  const userId = await requireUser();
  const module = await prisma.module.findUnique({ where: { slug } });
  if (!module) notFound();
  const exercise = await prisma.exercise.findUnique({
    where: { moduleId_slug: { moduleId: module.id, slug: ex } },
  });
  if (!exercise) notFound();
  const progress = await prisma.userExerciseProgress.findUnique({
    where: { userId_exerciseId: { userId, exerciseId: exercise.id } },
  });
  const isRead = progress?.isRead ?? false;

  const siblings = await prisma.exercise.findMany({
    where: { moduleId: module.id },
    orderBy: { number: 'asc' },
    select: { slug: true, title: true, number: true },
  });
  const idx = siblings.findIndex((s) => s.slug === ex);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx < siblings.length - 1 ? siblings[idx + 1] : null;

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <Link href={`/modules/${slug}`} className="text-fg-muted hover:text-accent">
            ← {module.title}
          </Link>
          <div className="flex items-center gap-3">
            <OpenInIde filePath={exercise.filePath} />
            <ToggleExerciseRead id={exercise.id} initial={isRead} label="Сделано" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-fg">{exercise.title}</h1>
      </header>

      <CodeBlock code={exercise.body} lang={exercise.language} />

      <nav className="flex items-center justify-between border-t border-border pt-4 text-sm">
        {prev ? (
          <Link href={`/modules/${slug}/exercises/${prev.slug}`} className="text-fg-muted hover:text-accent">
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/modules/${slug}/exercises/${next.slug}`} className="text-fg-muted hover:text-accent text-right">
            {next.title} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}
