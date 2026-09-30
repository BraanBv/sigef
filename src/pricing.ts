import { PlanId, VehicleType } from './types';

/** Tarifas de pago por uso (MXN) — según el plan de negocios */
export const PRICES: Record<VehicleType, { per30: number; hour: number; day: number; night: number }> = {
  auto: { per30: 15, hour: 25, day: 120, night: 80 },
  moto: { per30: 6, hour: 10, day: 50, night: 35 },
  bici: { per30: 0, hour: 0, day: 0, night: 0 },
};

/** Membresías (MXN). Anual = 10 mensualidades (ahorra 2 meses) */
export const PLANS: Record<PlanId, { name: string; monthly: number; annual: number; spaces: number; seats: number; blurb: string }> = {
  basico: { name: 'Básico', monthly: 499, annual: 4990, spaces: 1, seats: 1, blurb: 'Espacio fijo asegurado para una persona' },
  plus: { name: 'Plus', monthly: 799, annual: 7990, spaces: 1, seats: 2, blurb: 'Un espacio fijo compartido entre 2 personas' },
  corporativo: { name: 'Corporativo', monthly: 5999, annual: 59990, spaces: 10, seats: 10, blurb: '10 espacios fijos, facturación consolidada' },
};

export const GRACE_MIN = 10;           // minutos de tolerancia antes de cobrar exceso
export const OVERTIME_SURCHARGE = 0.2; // recargo sobre la tarifa por exceso de tiempo
export const EXPIRING_MIN = 15;        // aviso previo al vencimiento
export const NIGHT_START = 20;
export const NIGHT_END = 8;

/** Costo por tiempo (minutos) con tope diario por cada bloque de 12 h */
export function quoteHourly(type: VehicleType, minutes: number): number {
  const p = PRICES[type];
  if (minutes <= 0) return 0;
  const cost = (m: number) => (m <= 30 ? p.per30 : Math.min(p.day, Math.ceil(m / 60) * p.hour));
  const full = Math.floor(minutes / 720);
  const rem = minutes - full * 720;
  return full * p.day + (rem > 0 ? cost(rem) : 0);
}
export const isNight = (d: Date) => d.getHours() >= NIGHT_START || d.getHours() < NIGHT_END;
export function nextNightEnd(d: Date): Date {
  const e = new Date(d); e.setHours(NIGHT_END, 0, 0, 0);
  if (e <= d) e.setDate(e.getDate() + 1);
  return e;
}
export function endOfDay(d: Date): Date { const e = new Date(d); e.setHours(23, 59, 59, 0); return e; }
