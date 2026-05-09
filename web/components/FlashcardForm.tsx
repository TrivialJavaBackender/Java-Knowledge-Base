'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createManualFlashcard, updateManualFlashcard } from '@/lib/actions';

export interface ModuleOption {
  id: number;
  title: string;
}

export function FlashcardForm({
  modules,
  initial,
}: {
  modules: ModuleOption[];
  initial?: { id: number; front: string; back: string; tags: string; moduleId: number | null };
}) {
  const router = useRouter();
  const [front, setFront] = useState(initial?.front ?? '');
  const [back, setBack] = useState(initial?.back ?? '');
  const [tags, setTags] = useState(initial?.tags ?? '');
  const [moduleId, setModuleId] = useState<string>(
    initial?.moduleId != null ? String(initial.moduleId) : '',
  );
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!front.trim() || !back.trim()) return;
    startTransition(async () => {
      const payload = {
        front: front.trim(),
        back: back.trim(),
        tags: tags.trim(),
        moduleId: moduleId ? parseInt(moduleId, 10) : null,
      };
      if (initial) {
        await updateManualFlashcard(initial.id, payload);
      } else {
        await createManualFlashcard(payload);
      }
      router.push('/flashcards/manage');
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Front (вопрос)">
        <textarea
          value={front}
          onChange={(e) => setFront(e.target.value)}
          rows={3}
          required
          className="w-full rounded border border-border bg-bg-card p-3 text-fg focus:border-accent focus:outline-none"
        />
      </Field>

      <Field label="Back (ответ)">
        <textarea
          value={back}
          onChange={(e) => setBack(e.target.value)}
          rows={6}
          required
          className="w-full rounded border border-border bg-bg-card p-3 text-fg focus:border-accent focus:outline-none"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tags (через запятую)">
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full rounded border border-border bg-bg-card p-2 text-fg focus:border-accent focus:outline-none"
          />
        </Field>

        <Field label="Module">
          <select
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
            className="w-full rounded border border-border bg-bg-card p-2 text-fg focus:border-accent focus:outline-none"
          >
            <option value="">— none —</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-accent/60 bg-accent/10 px-4 py-2 text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {pending ? 'Сохраняю…' : initial ? 'Сохранить' : 'Создать карточку'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-border bg-bg-card px-4 py-2 text-fg hover:text-fg"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
