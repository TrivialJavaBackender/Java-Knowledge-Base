/**
 * Учебные треки — группировка модулей по предметной области для навигации
 * (боковая панель, цветовая маркировка). Единственный источник правды: список
 * треков, их порядок и цветовой токен. `content.config.ts` ссылается на ключи
 * отсюда при разметке модулей.
 */

export const TRACK_KEYS = ['runtime', 'data', 'architecture', 'platform', 'process'] as const;

export type TrackKey = (typeof TRACK_KEYS)[number];

export interface Track {
  key: TrackKey;
  title: string;
  /** Индекс цветового токена трека: `--t1`…`--t5` в globals.css, `track-1`…`track-5` в Tailwind. */
  color: 1 | 2 | 3 | 4 | 5;
}

/** Порядок — как в шапке модуля навигации. */
export const TRACKS: Track[] = [
  { key: 'runtime', title: 'Язык и рантайм', color: 1 },
  { key: 'data', title: 'Данные и хранение', color: 2 },
  { key: 'architecture', title: 'Архитектура и проектирование', color: 3 },
  { key: 'platform', title: 'Платформа и API', color: 4 },
  { key: 'process', title: 'Процесс и команда', color: 5 },
];

const BY_KEY = new Map(TRACKS.map((t) => [t.key, t]));

export function getTrack(key: TrackKey): Track {
  const track = BY_KEY.get(key);
  if (!track) throw new Error(`Unknown track key: ${key}`);
  return track;
}
