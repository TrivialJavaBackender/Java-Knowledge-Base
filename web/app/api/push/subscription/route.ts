/**
 * Приём и снятие подписки на Web Push.
 *
 * Единственное, что здесь делает фронт, — сообщает свою подписку. Отправлять
 * уведомления он не может: ни этот роут, ни какой-либо другой не принимает
 * чужой `userId` — он всегда берётся из сессии.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IncomingSubscription {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

function parseSubscription(body: IncomingSubscription): {
  endpoint: string;
  p256dh: string;
  auth: string;
} | null {
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : '';
  if (!endpoint || !p256dh || !auth) return null;
  // Endpoint — это URL push-сервиса, куда сервер потом постучится. Проверяем
  // схему, чтобы в базу не легло что-то, чем нельзя воспользоваться.
  if (!endpoint.startsWith('https://')) return null;
  return { endpoint, p256dh, auth };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: IncomingSubscription;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const sub = parseSubscription(body);
  if (!sub) return NextResponse.json({ error: 'incomplete subscription' }, { status: 400 });

  // Upsert по endpoint, а не create: браузер выдаёт новую подписку после сброса
  // разрешений или переустановки PWA, и без этого в базе копились бы дубли, на
  // половину из которых push уже не доходит. `userId` пишется и при обновлении —
  // устройство могло сменить хозяина.
  const saved = await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      userId: session.userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      userAgent: req.headers.get('user-agent')?.slice(0, 255) ?? null,
      active: true,
    },
    update: {
      userId: session.userId,
      p256dh: sub.p256dh,
      auth: sub.auth,
      userAgent: req.headers.get('user-agent')?.slice(0, 255) ?? null,
      active: true,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: saved.id });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let endpoint = '';
  try {
    const body = await req.json();
    endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });

  // `userId` в условии обязателен: без него можно было бы погасить чужую
  // подписку, зная её endpoint.
  const { count } = await prisma.pushSubscription.updateMany({
    where: { endpoint, userId: session.userId },
    data: { active: false },
  });

  return NextResponse.json({ ok: true, deactivated: count });
}
