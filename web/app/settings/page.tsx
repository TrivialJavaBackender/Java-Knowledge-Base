import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { isPushConfigured } from '@/lib/push';
import { NotificationSettings } from '@/components/settings/NotificationSettings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const userId = await requireUser();

  const [user, activeSubscriptions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        username: true,
        remindersEnabled: true,
        reminderTime: true,
        timezone: true,
        lastReminderSentAt: true,
      },
    }),
    prisma.pushSubscription.count({ where: { userId, active: true } }),
  ]);

  return (
    <div className="mx-auto max-w-[720px] space-y-4 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Настройки</h1>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">{user.username}</p>
      </header>

      <NotificationSettings
        data={{
          enabled: user.remindersEnabled,
          time: user.reminderTime,
          timezone: user.timezone,
          lastReminderSentAt: user.lastReminderSentAt?.toISOString() ?? null,
          activeSubscriptions,
          pushConfigured: isPushConfigured(),
          // Публичный ключ — он и должен быть в браузере: им подписывается
          // запрос к push-сервису. Приватный живёт только в lib/push.ts.
          vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
        }}
      />

      <section className="rounded-lg border border-border bg-bg-card px-4 py-3.5">
        <h2 className="text-[13.5px] font-medium text-fg">Очередь повторения</h2>
        <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-muted">
          Дневной лимит и разбор завала живут на отдельном экране — там же видно, сколько карточек
          просрочено и как они лягут по дням.
        </p>
        <Link
          href="/flashcards/triage"
          className="mt-2.5 inline-flex h-9 items-center rounded-md border border-border bg-bg-soft px-3 text-[13px] text-fg transition hover:border-accent/50"
        >
          Разбор очереди →
        </Link>
      </section>
    </div>
  );
}
