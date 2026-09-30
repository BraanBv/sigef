import { load, save } from './db';

/** Reloj del sistema con desfase persistente: permite simular el paso del tiempo en demos. */
export const now = (): Date => new Date(Date.now() + load().meta.clockOffsetMs);
export function advanceClock(minutes: number) { load().meta.clockOffsetMs += minutes * 60000; save(); }
export function resetClock() { load().meta.clockOffsetMs = 0; save(); }
export const clockOffsetMinutes = () => Math.round(load().meta.clockOffsetMs / 60000);
