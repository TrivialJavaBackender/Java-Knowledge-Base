/**
 * Three-column file header — "Какую проблему решает / Кому это надо / Когда
 * НЕ надо" — parsed by `extractContractHeader` (lib/markdown.tsx) from the
 * file's leading blockquote. Present in 61/199 theory files; page.tsx only
 * renders this when parsing succeeded, so no empty-state handling here.
 *
 * Plain function component (no hooks) — rendered directly from the server
 * page; the three fields arrive pre-rendered to HTML via `renderMarkdown`.
 */
export function ContractHeaderCards({
  problemHtml,
  whoHtml,
  whenNotHtml,
}: {
  problemHtml: string;
  whoHtml: string;
  whenNotHtml: string;
}) {
  return (
    <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
      <Card label="Какую проблему решает" labelClass="text-accent" html={problemHtml} />
      <Card label="Кому это надо" labelClass="text-fg-muted" html={whoHtml} />
      <Card label="Когда НЕ надо" labelClass="text-warn" html={whenNotHtml} />
    </div>
  );
}

function Card({ label, labelClass, html }: { label: string; labelClass: string; html: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-soft p-3">
      <span className={`lbl ${labelClass}`}>{label}</span>
      <div
        className="prose prose-sm max-w-none text-fg-muted [&_p]:mb-0 [&_p]:text-[12.5px] [&_p]:leading-[1.5]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
