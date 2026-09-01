/**
 * Русская плюрализация — одна на приложение. До этого копий было шесть:
 * dashboard/format.ts, flashcards/format.ts, module/pluralize.ts и три
 * локальных `pluralizeSections`/`pluralizeDays`/`pluralizeQuestion` внутри
 * компонентов. Комментарии в копиях ссылались на «чужую зону», но ограничение
 * Tailwind JIT касается литеральных строк классов, а не импортов TS.
 */

/** Выбор формы по числу: [1, 2, 5] → одна / две / пять. */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return forms[1];
  return forms[2];
}

export const FORMS = {
  section: ['раздел', 'раздела', 'разделов'],
  question: ['вопрос', 'вопроса', 'вопросов'],
  card: ['карточка', 'карточки', 'карточек'],
  day: ['день', 'дня', 'дней'],
  step: ['шаг', 'шага', 'шагов'],
  deck: ['колода', 'колоды', 'колод'],
  module: ['модуль', 'модуля', 'модулей'],
  topic: ['тема', 'темы', 'тем'],
} satisfies Record<string, [string, string, string]>;

/** `plural(11, 'section')` → «разделов». */
export function plural(n: number, kind: keyof typeof FORMS): string {
  return pluralRu(n, FORMS[kind]);
}

/** «11 разделов» — число и форма вместе, самый частый случай. */
export function countOf(n: number, kind: keyof typeof FORMS): string {
  return `${n} ${plural(n, kind)}`;
}
