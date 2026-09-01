'use client';

import { useEffect, useState, useTransition } from 'react';
import { clearLastReminderSentAt, setReminderSettings } from '@/lib/reminder-actions';

export interface NotificationSettingsData {
  enabled: boolean;
  /** «HH:MM» в зоне пользователя. */
  time: string;
  timezone: string;
  /** ISO или null — когда последний раз уходило напоминание. */
  lastReminderSentAt: string | null;
  activeSubscriptions: number;
  /** Заданы ли VAPID-ключи на сервере. Без них подписываться бессмысленно. */
  pushConfigured: boolean;
  /** Совпадают ли серверный и браузерный публичные ключи; null — сравнить нечем. */
  vapidKeysMatch: boolean | null;
  vapidPublicKey: string;
}

/**
 * VAPID-ключ приходит в base64url, а `applicationServerKey` принимает только
 * сырые байты. Ручная распаковка нужна потому, что `atob` понимает лишь
 * обычный base64: `-` и `_` он не примет, а хвостовые `=` в ключе опущены.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

/** Что именно недоступно — сообщение должно отличать «нельзя» от «запрещено». */
type Support = 'checking' | 'ok' | 'no-push' | 'denied';

export function NotificationSettings({ data }: { data: NotificationSettingsData }) {
  const [enabled, setEnabled] = useState(data.enabled);
  const [time, setTime] = useState(data.time);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [support, setSupport] = useState<Support>('checking');
  const [browserTimezone, setBrowserTimezone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setBrowserTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);

    const hasPush =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;

    if (!hasPush) {
      setSupport('no-push');
      return;
    }
    setSupport(Notification.permission === 'denied' ? 'denied' : 'ok');
  }, []);

  const busy = pending || status.kind === 'busy';

  async function currentSubscription(): Promise<PushSubscription | null> {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  /**
   * Подписка браузера. Если подписка уже есть, но выдана под другой
   * VAPID-ключ (ключи поменяли на сервере), `subscribe` бросит
   * InvalidStateError — такую подписку сначала отзываем.
   */
  async function subscribeBrowser(): Promise<PushSubscription> {
    const reg = await navigator.serviceWorker.ready;
    const applicationServerKey = urlBase64ToUint8Array(data.vapidPublicKey);

    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      const sameKey =
        existing.options.applicationServerKey != null &&
        new Uint8Array(existing.options.applicationServerKey as ArrayBuffer).every(
          (b, i) => b === applicationServerKey[i],
        );
      if (sameKey) return existing;
      await existing.unsubscribe();
    }

    return reg.pushManager.subscribe({
      // Обязательно true: браузеры не выдают подписку под «тихой» доставкой.
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as BufferSource,
    });
  }

  async function saveSubscription(sub: PushSubscription): Promise<void> {
    const res = await fetch('/api/push/subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
    if (!res.ok) throw new Error(`Сервер не принял подписку (${res.status})`);
  }

  async function enable(): Promise<void> {
    setStatus({ kind: 'busy', text: 'Запрашиваю разрешение…' });

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setSupport(permission === 'denied' ? 'denied' : 'ok');
      setStatus({ kind: 'error', text: 'Разрешение на уведомления не выдано.' });
      return;
    }

    setStatus({ kind: 'busy', text: 'Подписываю браузер…' });
    const sub = await subscribeBrowser();
    await saveSubscription(sub);

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await setReminderSettings({ enabled: true, time, timezone });

    setEnabled(true);
    setBrowserTimezone(timezone);
    setStatus({ kind: 'ok', text: 'Напоминания включены.' });
  }

  async function disable(): Promise<void> {
    setStatus({ kind: 'busy', text: 'Отключаю…' });

    // Сначала настройка, потом отписка: если отписка сорвётся, рассылка всё
    // равно уже выключена. Обратный порядок оставил бы включённые напоминания
    // без подписки.
    await setReminderSettings({
      enabled: false,
      time,
      timezone: browserTimezone ?? data.timezone,
    });
    setEnabled(false);

    const sub = await currentSubscription();
    if (sub) {
      await fetch('/api/push/subscription', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }

    setStatus({ kind: 'ok', text: 'Напоминания выключены.' });
  }

  function toggle() {
    startTransition(async () => {
      try {
        await (enabled ? disable() : enable());
      } catch (err) {
        console.error(err);
        setStatus({ kind: 'error', text: (err as Error).message });
      }
    });
  }

  function saveTime(next: string) {
    setTime(next);
    startTransition(async () => {
      try {
        await setReminderSettings({
          enabled,
          time: next,
          timezone: browserTimezone ?? data.timezone,
        });
        setStatus({ kind: 'ok', text: `Время напоминания — ${next}.` });
      } catch (err) {
        setStatus({ kind: 'error', text: (err as Error).message });
      }
    });
  }

  function syncTimezone() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    startTransition(async () => {
      try {
        await setReminderSettings({ enabled, time, timezone });
        setBrowserTimezone(timezone);
        setStatus({ kind: 'ok', text: `Часовой пояс — ${timezone}.` });
      } catch (err) {
        setStatus({ kind: 'error', text: (err as Error).message });
      }
    });
  }

  function sendTest() {
    startTransition(async () => {
      setStatus({ kind: 'busy', text: 'Отправляю…' });
      try {
        const res = await fetch('/api/push/test', { method: 'POST' });
        if (res.status === 401) {
          setStatus({ kind: 'error', text: 'Сессия истекла — войдите заново.' });
          return;
        }
        const body = await res.json();
        if (!res.ok) {
          setStatus({ kind: 'error', text: body.error ?? `Ошибка ${res.status}` });
          return;
        }
        setStatus({ kind: 'ok', text: `Отправлено на ${body.sent} устройств(о). Проверьте шторку.` });
      } catch (err) {
        setStatus({ kind: 'error', text: (err as Error).message });
      }
    });
  }

  function resetSentMark() {
    startTransition(async () => {
      try {
        await clearLastReminderSentAt();
        setStatus({ kind: 'ok', text: 'Отметка сброшена — сегодня напоминание придёт снова.' });
      } catch (err) {
        setStatus({ kind: 'error', text: (err as Error).message });
      }
    });
  }

  const timezoneMismatch = browserTimezone !== null && browserTimezone !== data.timezone;
  const lastSent = data.lastReminderSentAt ? new Date(data.lastReminderSentAt) : null;

  return (
    <section className="rounded-lg border border-border bg-bg-card">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-semibold text-fg">Уведомления</h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">
          Одно напоминание в день, только если есть что повторять.
        </p>
      </header>

      {!data.pushConfigured && (
        <Notice>
          На сервере не заданы ключи VAPID. Нужны переменные окружения{' '}
          <code className="font-mono text-[12px]">VAPID_PUBLIC_KEY</code>,{' '}
          <code className="font-mono text-[12px]">VAPID_PRIVATE_KEY</code> и{' '}
          <code className="font-mono text-[12px]">VAPID_SUBJECT</code> — см. README.
        </Notice>
      )}
      {data.pushConfigured && data.vapidKeysMatch === false && (
        <Notice>
          <code className="font-mono text-[12px]">VAPID_PUBLIC_KEY</code> и{' '}
          <code className="font-mono text-[12px]">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> не совпадают:
          браузер подпишется одним ключом, а сервер будет подписывать запрос другим — push-сервис
          ответит 403. Обе переменные должны содержать <b>публичный</b> ключ одной и той же пары.
          После правки нужен пересбор: <code className="font-mono text-[12px]">NEXT_PUBLIC_*</code>{' '}
          вшивается в бандл на сборке.
        </Notice>
      )}
      {support === 'no-push' && (
        <Notice>
          Браузер не поддерживает Web Push. На iOS уведомления работают только после установки
          приложения на домашний экран (iOS 16.4+).
        </Notice>
      )}
      {support === 'denied' && (
        <Notice>
          Уведомления запрещены в настройках браузера для этого сайта. Включить их из приложения
          нельзя — разрешение сбрасывается только вручную, в настройках сайта.
        </Notice>
      )}

      <div className="divide-y divide-border">
        <Row
          title="Напоминания о повторении"
          note={
            enabled
              ? `Придёт в ${time}, если карточки созрели. Активных устройств: ${data.activeSubscriptions}.`
              : 'Выключены — приложение само о себе не напомнит.'
          }
        >
          <button
            type="button"
            onClick={toggle}
            disabled={busy || support !== 'ok' || !data.pushConfigured}
            aria-pressed={enabled}
            aria-label="Напоминания о повторении"
            className={`flex h-[22px] w-[38px] flex-none items-center rounded-full border p-[2px] transition disabled:opacity-50 ${
              enabled ? 'justify-end border-accent bg-accent' : 'justify-start border-border bg-bg-soft'
            }`}
          >
            <span className={`h-4 w-4 rounded-full ${enabled ? 'bg-bg-card' : 'bg-fg-subtle'}`} />
          </button>
        </Row>

        <Row
          title="Время напоминания"
          note="Локальное время. Проверка идёт раз в час, поэтому уведомление приходит в течение полутора часов после указанного момента."
        >
          <input
            type="time"
            value={time}
            disabled={busy}
            onChange={(e) => setTime(e.target.value)}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== data.time) saveTime(e.target.value);
            }}
            className="h-9 rounded-md border border-border bg-bg-soft px-2.5 font-mono text-[13px] text-fg disabled:opacity-50"
          />
        </Row>

        <Row
          title="Часовой пояс"
          note={
            timezoneMismatch
              ? `Сохранён ${data.timezone}, браузер сообщает ${browserTimezone}. Напоминания уйдут по сохранённому.`
              : `${data.timezone} — определён браузером.`
          }
        >
          {timezoneMismatch ? (
            <button
              type="button"
              onClick={syncTimezone}
              disabled={busy}
              className="h-9 flex-none rounded-md border border-accent/45 bg-accent-soft px-3 text-[13px] text-accent transition hover:bg-accent/20 disabled:opacity-50"
            >
              Обновить
            </button>
          ) : (
            <span className="font-mono text-[12.5px] text-fg-muted">{data.timezone}</span>
          )}
        </Row>

        <Row
          title="Проверка"
          note={
            lastSent
              ? `Последнее напоминание: ${lastSent.toLocaleString('ru-RU')}. Повторное в те же сутки не отправляется.`
              : 'Напоминаний ещё не было.'
          }
        >
          <div className="flex flex-none flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={sendTest}
              disabled={busy || !enabled}
              className="h-9 rounded-md border border-border bg-bg-soft px-3 text-[13px] text-fg transition hover:border-accent/50 disabled:opacity-50"
            >
              Отправить тестовое
            </button>
            {lastSent && (
              <button
                type="button"
                onClick={resetSentMark}
                disabled={busy}
                className="h-9 rounded-md border border-border bg-bg-card px-3 text-[13px] text-fg-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-50"
              >
                Сбросить отметку
              </button>
            )}
          </div>
        </Row>
      </div>

      {status.kind !== 'idle' && (
        <div
          role="status"
          className={`border-t border-border px-4 py-2.5 text-[12.5px] ${
            status.kind === 'error' ? 'text-warn' : status.kind === 'ok' ? 'text-ok' : 'text-fg-muted'
          }`}
        >
          {status.text}
        </div>
      )}
    </section>
  );
}

function Row({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
      <div className="min-w-[180px] flex-1">
        <div className="text-[13.5px] font-medium text-fg">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-muted">{note}</div>
      </div>
      {children}
    </div>
  );
}

/**
 * Класс цвета — литералом: Tailwind JIT сканирует исходник по строкам, и
 * собранное через шаблон `text-${tone}` имя в бандл не попадёт.
 */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-4 py-2.5 text-[12.5px] leading-[1.55] text-warn">
      {children}
    </div>
  );
}
