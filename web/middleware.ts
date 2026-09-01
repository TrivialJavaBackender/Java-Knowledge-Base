import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// `/api/reminders` — вход для Netlify Scheduled Function. Сессии у cron'а нет,
// поэтому здесь он проходит без куки, а свой общий секрет проверяет сам роут
// (`app/api/reminders/run/route.ts`).
const PUBLIC = ['/login', '/register', '/api/reminders'];

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) return null;
  return new TextEncoder().encode(s);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get('session')?.value;
  const key = secret();

  if (token && key) {
    try {
      await jwtVerify(token, key);
      return NextResponse.next();
    } catch {}
  }

  // API отвечает статусом, а не редиректом: fetch из браузера прошёл бы по
  // редиректу и получил HTML страницы логина, на котором `res.json()` падает с
  // ошибкой разбора — вместо внятного «сессия истекла». Страницы по-прежнему
  // редиректим, там это правильное поведение.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('from', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // `search-index.json` is excluded so it is served as a plain CDN asset from
  // an edge near the reader instead of a function next to the database. It
  // holds only headings and concept names — no article bodies.
  //
  // Ресурсы PWA исключены по другой причине: браузер запрашивает манифест и
  // иконки без учётных данных, а service worker обновляет себя вне контекста
  // страницы. Редирект на `/login` вместо манифеста ломает установку на
  // Android — Chrome просто не считает приложение устанавливаемым. Секретов в
  // этих файлах нет: манифест, статичные PNG и код воркера.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|search-index.json|sw\\.js|manifest\\.webmanifest|icons/).*)',
  ],
};
