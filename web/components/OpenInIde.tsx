'use client';

import { useState } from 'react';

export function OpenInIde({ filePath }: { filePath: string }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'ok' | 'err'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setStatus('pending');
    setError(null);
    try {
      const r = await fetch('/api/open-in-ide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${r.status}`);
        setStatus('err');
        return;
      }
      setStatus('ok');
      setTimeout(() => setStatus('idle'), 1200);
    } catch (e) {
      setError((e as Error).message);
      setStatus('err');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={open}
        disabled={status === 'pending'}
        className={`rounded border px-2.5 py-1 text-xs transition ${
          status === 'ok'
            ? 'border-ok/40 bg-ok/10 text-ok'
            : status === 'err'
              ? 'border-warn/40 bg-warn/10 text-warn'
              : 'border-border bg-bg-card text-fg-muted hover:text-fg hover:border-accent/50'
        } disabled:opacity-50`}
        title="Открыть в IntelliJ IDEA"
      >
        {status === 'pending' ? 'Opening…' : status === 'ok' ? '✓ Opened' : status === 'err' ? 'Failed' : 'Open in IDE'}
      </button>
      {error && (
        <span
          className="text-xs text-warn"
          title={error}
        >
          {error.length > 60 ? error.slice(0, 60) + '…' : error}
        </span>
      )}
    </div>
  );
}
