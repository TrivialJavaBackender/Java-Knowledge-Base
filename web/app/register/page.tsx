import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { hashPassword, signSession, setSessionCookie } from '@/lib/auth';

async function register(formData: FormData) {
  'use server';
  const username = (formData.get('username') as string).trim();
  const password = formData.get('password') as string;
  const confirm = formData.get('confirm') as string;

  if (!username || !password) redirect('/register?error=empty');
  if (password !== confirm) redirect('/register?error=mismatch');
  if (password.length < 6) redirect('/register?error=short');

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) redirect('/register?error=taken');

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { username, passwordHash } });

  const token = await signSession(user.id);
  await setSessionCookie(token);
  redirect('/');
}

const ERRORS: Record<string, string> = {
  empty: 'Заполни все поля',
  mismatch: 'Пароли не совпадают',
  short: 'Пароль минимум 6 символов',
  taken: 'Такой логин уже занят',
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg-card p-8 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-fg">Регистрация</h1>
        <form action={register} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-fg-muted" htmlFor="username">Логин</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-fg-muted" htmlFor="password">Пароль</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-fg-muted" htmlFor="confirm">Повтори пароль</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
            />
          </div>
          {error && <p className="text-sm text-warn">{ERRORS[error] ?? 'Ошибка'}</p>}
          <button
            type="submit"
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            Создать аккаунт
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-fg-muted">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-accent hover:underline">Войти</Link>
        </p>
      </div>
    </div>
    </div>
  );
}
