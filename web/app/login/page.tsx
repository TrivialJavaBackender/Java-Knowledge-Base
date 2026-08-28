import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { verifyPassword, signSession, setSessionCookie } from '@/lib/auth';

async function login(formData: FormData) {
  'use server';
  const username = formData.get('username') as string;
  const password = formData.get('password') as string;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    redirect('/login?error=1');
  }

  const token = await signSession(user.id);
  await setSessionCookie(token);
  redirect('/');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg-card p-8 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-fg">Interview Prep</h1>
        <form action={login} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-fg-muted" htmlFor="username">
              Логин
            </label>
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
            <label className="mb-1 block text-sm text-fg-muted" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
            />
          </div>
          {error === '1' && (
            <p className="text-sm text-warn">Неверный логин или пароль</p>
          )}
          <button
            type="submit"
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            Войти
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-fg-muted">
          Нет аккаунта?{' '}
          <Link href="/register" className="text-accent hover:underline">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
    </div>
  );
}
