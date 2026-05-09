'use client';

import { Checkbox } from './Checkbox';
import {
  toggleTheoryRead,
  toggleExerciseRead,
  toggleQAKnown,
} from '@/lib/actions';

export function ToggleTheoryRead({ id, initial, label }: { id: number; initial: boolean; label?: string }) {
  return <Checkbox initial={initial} label={label} onToggle={(v) => toggleTheoryRead(id, v)} />;
}

export function ToggleExerciseRead({ id, initial, label }: { id: number; initial: boolean; label?: string }) {
  return <Checkbox initial={initial} label={label} onToggle={(v) => toggleExerciseRead(id, v)} />;
}

export function ToggleQAKnown({ id, initial, size = 'sm' }: { id: number; initial: boolean; size?: 'sm' | 'md' }) {
  return <Checkbox initial={initial} size={size} onToggle={(v) => toggleQAKnown(id, v)} />;
}
