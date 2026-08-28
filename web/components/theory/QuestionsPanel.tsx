'use client';

import { useState } from 'react';
import { ToggleQAKnown } from '@/components/ToggleProgress';

export interface QaCard {
  id: number;
  qNumber: number;
  /** `§N` when `refSection` is set, otherwise the parent Q&A section title. */
  sectionLabel: string;
  box: number | null;
  question: string;
  answerHtml: string;
  sourceRef: string | null;
  isKnown: boolean;
}

export interface QuestionsPanelProps {
  /** Questions with `refDocSlug` pointing at the current file. */
  docQuestions: QaCard[];
  /** All Q&A of the module (superset of `docQuestions`). */
  moduleQuestions: QaCard[];
}

/**
 * Slide-out questions drawer + its own trigger button (rendered inline in the
 * reader's meta row — see page.tsx). Self-contained: owns open/scope/expanded
 * state, so it doesn't need to coordinate with the rest of the reader.
 */
export function QuestionsPanel({ docQuestions, moduleQuestions }: QuestionsPanelProps) {
  const hasDocBinding = docQuestions.length > 0;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'doc' | 'module'>(hasDocBinding ? 'doc' : 'module');
  const [openId, setOpenId] = useState<number | null>(null);

  const list = scope === 'doc' ? docQuestions : moduleQuestions;
  const knownInScope = list.filter((q) => q.isKnown).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] ${
          open
            ? 'border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] bg-accent-soft text-accent'
            : 'border-border bg-bg-card text-fg-muted hover:border-accent/50 hover:text-fg'
        }`}
      >
        <QuestionIcon />
        Вопросы
        <span className="rounded-full bg-accent-soft px-1.5 font-mono text-[11px] text-accent">
          {docQuestions.length}
        </span>
      </button>

      {open && <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setOpen(false)} aria-hidden />}

      <aside
        className={`fixed bottom-0 right-0 top-[52px] z-40 flex w-full flex-col border-l border-border bg-bg-card shadow-[-10px_0_30px_rgba(31,35,40,0.13)] transition-transform duration-200 sm:w-[420px] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex-none border-b border-border px-4 pb-3 pt-3.5">
          <div className="mb-2.5 flex items-center gap-2.5">
            <span className="flex-1 text-[15px] font-semibold text-fg">Вопросы к этому файлу</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-bg-soft text-fg-muted hover:text-fg"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ScopeButton active={scope === 'doc'} onClick={() => setScope('doc')}>
              Этот файл · {docQuestions.length}
            </ScopeButton>
            <ScopeButton active={scope === 'module'} onClick={() => setScope('module')}>
              Весь модуль · {moduleQuestions.length}
            </ScopeButton>
            <span className="flex-1" />
            <span className="font-mono text-[11px] text-fg-subtle">
              знаю {knownInScope} из {list.length}
            </span>
          </div>
          <div className="mt-2.5 flex items-start gap-2 rounded-md bg-bg-soft px-2.5 py-2">
            <span className={`mt-1 h-1.5 w-1.5 flex-none rounded-full ${hasDocBinding ? 'bg-accent' : 'bg-warn'}`} />
            <span className="flex-1 text-[11.5px] leading-[1.45] text-fg-muted">{coverageNote(docQuestions)}</span>
          </div>
        </div>

        <div className="scroll flex-1 overflow-y-auto p-3.5">
          {list.length === 0 && (
            <div className="px-2 py-6 text-center text-[13px] text-fg-subtle">Вопросов в этой области нет.</div>
          )}
          {list.map((q) => (
            <QuestionCard key={q.id} q={q} open={openId === q.id} onToggle={() => setOpenId((v) => (v === q.id ? null : q.id))} />
          ))}
        </div>
      </aside>
    </>
  );
}

function QuestionCard({ q, open, onToggle }: { q: QaCard; open: boolean; onToggle: () => void }) {
  return (
    <div className={`mb-2 overflow-hidden rounded-lg border ${open ? 'border-accent/45' : 'border-border'} bg-bg-card`}>
      <div className="flex items-start gap-2.5 p-2.5">
        <div className="mt-0.5">
          <ToggleQAKnown id={q.id} initial={q.isKnown} size="sm" />
        </div>
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10.5px] text-fg-subtle">Q{q.qNumber}</span>
            <span className="rounded border border-border bg-bg-soft px-1 font-mono text-[10px] text-fg-muted">{q.sectionLabel}</span>
            {q.box !== null && <span className="font-mono text-[10.5px] text-fg-subtle">box {q.box}</span>}
          </div>
          <div className="text-[13.5px] font-medium leading-[1.45] text-fg">{q.question}</div>
        </button>
      </div>
      {open && (
        <div className="px-2.5 pb-2.5 pl-[37px]">
          <div className="rounded-md bg-bg-soft p-2.5">
            <div
              className="prose prose-sm max-w-none text-fg [&_p]:mb-0"
              dangerouslySetInnerHTML={{ __html: q.answerHtml }}
            />
            {q.sourceRef && (
              <div className="mt-2 border-l-2 border-accent/40 pl-2.5 font-mono text-[11px] text-fg-subtle">{q.sourceRef}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[26px] rounded-full border px-2.5 text-[12px] ${
        active
          ? 'border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] bg-accent-soft text-accent'
          : 'border-border bg-bg-card text-fg-muted'
      }`}
    >
      {children}
    </button>
  );
}

function coverageNote(docQuestions: QaCard[]): string {
  if (docQuestions.length === 0) {
    return 'У вопросов этого файла нет привязки к разделам, поэтому в тексте плашек «Проверь себя» нет — они живут только здесь.';
  }
  const bound = docQuestions.filter((q) => q.sectionLabel.startsWith('§')).length;
  if (bound === docQuestions.length) {
    return `Все ${docQuestions.length} ${pluralizeQuestion(docQuestions.length)} этого файла привязаны к разделам — под каждым стоит плашка «Проверь себя».`;
  }
  return `${bound} из ${docQuestions.length} вопросов этого файла привязаны к разделам — плашки «Проверь себя» есть не под всеми.`;
}

function pluralizeQuestion(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'вопрос';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'вопроса';
  return 'вопросов';
}

function QuestionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a9 9 0 1 0 4.5 16.8L21 21l-1.2-4.5A9 9 0 0 0 12 3Z" />
      <path d="M9.6 9.4a2.4 2.4 0 1 1 3.2 2.3c-.6.2-.8.7-.8 1.3" />
      <circle cx="12" cy="16.2" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
