import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { MarkdownView } from '@/lib/markdown';
import { ToggleTheoryRead } from '@/components/ToggleProgress';
import { OpenInIde } from '@/components/OpenInIde';
import { MermaidInit } from '@/components/MermaidInit';

export const dynamic = 'force-dynamic';

export default async function TheoryPage({
  params,
}: {
  params: Promise<{ slug: string; doc: string }>;
}) {
  const { slug, doc } = await params;
  const module = await prisma.module.findUnique({ where: { slug } });
  if (!module) notFound();
  const theory = await prisma.theoryDoc.findUnique({
    where: { moduleId_slug: { moduleId: module.id, slug: doc } },
  });
  if (!theory) notFound();

  // Build sibling list for prev/next navigation
  const siblings = await prisma.theoryDoc.findMany({
    where: { moduleId: module.id },
    orderBy: [{ order: 'asc' }, { slug: 'asc' }],
    select: { slug: true, title: true },
  });
  const idx = siblings.findIndex((s) => s.slug === doc);
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
            <OpenInIde filePath={theory.filePath} />
            <ToggleTheoryRead id={theory.id} initial={theory.isRead} label="Прочитано" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-fg">{theory.title}</h1>
        <div className="text-xs text-fg-subtle font-mono">{theory.filePath}</div>
      </header>

      <MarkdownView source={theory.body} moduleSlug={slug} />
      <MermaidInit />

      <nav className="flex items-center justify-between border-t border-border pt-4 text-sm">
        {prev ? (
          <Link href={`/modules/${slug}/theory/${prev.slug}`} className="text-fg-muted hover:text-accent">
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/modules/${slug}/theory/${next.slug}`} className="text-fg-muted hover:text-accent text-right">
            {next.title} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}
