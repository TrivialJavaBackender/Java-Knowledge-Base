/**
 * Чистые форматтеры для дашборда: русская плюрализация и текст строки
 * «дальше: …» в карточке модуля. Никакого React — переиспользуется и
 * серверным `app/page.tsx`, и клиентскими компонентами дашборда.
 */

/** Стандартный выбор формы по числу: [1, 2, 5] → одна/две/пять. */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return forms[1];
  return forms[2];
}

/** «7 вопросов открыто» / «8 вопросов открыто» / «31 вопрос открыт». */
export function questionsOpenLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вопрос открыт`;
  return `${n} ${pluralRu(n, ['вопрос', 'вопроса', 'вопросов'])} открыто`;
}

export interface NextLabelInput {
  theoryDone: number;
  theoryTotal: number;
  qaDone: number;
  qaTotal: number;
  firstUnreadTitle: string | null;
}

/**
 * Строка «дальше: …» карточки модуля:
 *  - теория не начата → «не начат · N тем в роадмапе»
 *  - теория прочитана целиком → «всё прочитано · N вопросов открыто»
 *  - иначе → «дальше: <заголовок первого непрочитанного документа>»
 */
export function nextLabel({ theoryDone, theoryTotal, qaDone, qaTotal, firstUnreadTitle }: NextLabelInput): string {
  if (theoryTotal === 0) {
    return firstUnreadTitle ? `дальше: ${firstUnreadTitle}` : 'нет теории';
  }
  if (theoryDone === 0) {
    return `не начат · ${theoryTotal} ${pluralRu(theoryTotal, ['тема', 'темы', 'тем'])} в роадмапе`;
  }
  if (theoryDone >= theoryTotal) {
    return `всё прочитано · ${questionsOpenLabel(Math.max(0, qaTotal - qaDone))}`;
  }
  return firstUnreadTitle ? `дальше: ${firstUnreadTitle}` : 'в процессе';
}
