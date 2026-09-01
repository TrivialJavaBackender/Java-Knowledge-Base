/**
 * Генерация PNG-иконок PWA из `app/icon.svg`.
 *
 * Android при установке требует именно растр 192 и 512; SVG он для этого не
 * принимает. Скрипт разовый — результат коммитится в `public/icons/`, — но
 * оставлен в репозитории, чтобы после правки исходной иконки не пришлось
 * вспоминать размеры и отступы:
 *
 *   node_modules/.bin/tsx scripts/gen-icons.ts
 *
 * Три роли, три файла:
 *  - `icon-192/512` — обычная иконка, показывается как есть;
 *  - `icon-maskable-512` — под маску лаунчера (круг, сквиркл, капля). Система
 *    обрезает всё за пределами центральных 80%, поэтому рисунок ужат, а фон
 *    растянут на весь холст: иначе у круглой маски отъело бы углы плашки;
 *  - `badge-96` — монохромный значок в статусбаре Android. Используется только
 *    альфа-канал, цвет системный, поэтому здесь белый силуэт на прозрачном.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const WEB_ROOT = resolve(__dirname, '..');
const SOURCE = resolve(WEB_ROOT, 'app/icon.svg');
const OUT_DIR = resolve(WEB_ROOT, 'public/icons');

/** Доля холста под рисунок в maskable-варианте: 80% — safe zone спецификации. */
const MASKABLE_SAFE_RATIO = 0.8;
/** Фон плашки — тот же, что в app/icon.svg, и он же theme_color манифеста. */
const BRAND = '#0969da';

/** Силуэт для значка в статусбаре: без плашки, белым по прозрачному. */
const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="6" width="22" height="20" rx="3"/>
    <line x1="13.5" y1="6" x2="13.5" y2="26"/>
  </g>
</svg>`;

async function renderPlain(svg: Buffer, size: number, out: string): Promise<void> {
  // density поднимаем под целевой размер: sharp растрирует SVG исходя из неё, и
  // на дефолтных 72 dpi иконка 32×32 превратилась бы в мыло при апскейле.
  const density = Math.round((72 * size) / 32);
  await sharp(svg, { density }).resize(size, size).png().toFile(out);
  console.log(`  ${out.replace(WEB_ROOT + '/', '')}  ${size}×${size}`);
}

async function renderMaskable(svg: Buffer, size: number, out: string): Promise<void> {
  const inner = Math.round(size * MASKABLE_SAFE_RATIO);
  const density = Math.round((72 * inner) / 32);
  const glyph = await sharp(svg, { density }).resize(inner, inner).png().toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BRAND },
  })
    .composite([{ input: glyph, gravity: 'center' }])
    .png()
    .toFile(out);
  console.log(`  ${out.replace(WEB_ROOT + '/', '')}  ${size}×${size} (safe zone ${inner})`);
}

async function main(): Promise<void> {
  const svg = await readFile(SOURCE);
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Иконки из ${SOURCE.replace(WEB_ROOT + '/', '')}:`);
  await renderPlain(svg, 192, resolve(OUT_DIR, 'icon-192.png'));
  await renderPlain(svg, 512, resolve(OUT_DIR, 'icon-512.png'));
  await renderMaskable(svg, 512, resolve(OUT_DIR, 'icon-maskable-512.png'));

  const badgeSvg = Buffer.from(BADGE_SVG);
  await writeFile(resolve(OUT_DIR, 'badge.svg'), badgeSvg);
  await renderPlain(badgeSvg, 96, resolve(OUT_DIR, 'badge-96.png'));

  console.log('Готово.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
