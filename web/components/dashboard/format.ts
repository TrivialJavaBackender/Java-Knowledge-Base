/**
 * Текстовые форматтеры дашборда. Плюрализация — из lib/plural.ts (одна на
 * приложение), здесь остались только специфичные для дашборда строки.
 */
import { pluralRu, countOf } from '@/lib/plural';

export { pluralRu };

/** «7 вопросов открыто» / «31 вопрос открыт». */
export function questionsOpenLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вопрос открыт`;
  return `${countOf(n, 'question')} открыто`;
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
    return `не начат · ${countOf(theoryTotal, 'topic')} в роадмапе`;
  }
  if (theoryDone >= theoryTotal) {
    return `всё прочитано · ${questionsOpenLabel(Math.max(0, qaTotal - qaDone))}`;
  }
  return firstUnreadTitle ? `дальше: ${firstUnreadTitle}` : 'в процессе';
}
