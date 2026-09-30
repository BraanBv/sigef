import { DB, Session, Space, VehicleType } from './types';
import { hashPassword, ticketCode, uid } from './util';
import { PLANS, quoteHourly, endOfDay } from './pricing';

const MIN = 60000;

export function buildSeed(): DB {
  const spaces: Space[] = [];
  const add = (n: number, prefix: string, type: VehicleType, zone: 'G' | 'M' | 'B') => {
    for (let i = 1; i <= n; i++) spaces.push({ id: `${prefix}${String(i).padStart(2, '0')}`, label: `${prefix}-${String(i).padStart(2, '0')}`, type, zone });
  };
  add(41, 'A', 'auto', 'G');
  add(30, 'F', 'auto', 'M'); // F = fijos (membresías)
  add(30, 'M', 'moto', 'G');
  add(20, 'B', 'bici', 'B');

  const t0 = Date.now();
  const admin = { id: uid('usr'), name: 'Administrador SIGEF', email: 'admin@sigef.mx', passHash: hashPassword('admin123'), role: 'admin' as const };
  const demo = { id: uid('usr'), name: 'Ana Ramírez', email: 'demo@sigef.mx', passHash: hashPassword('demo123'), role: 'user' as const };

  const memId = uid('mem');
  const memberships = [{
    id: memId, userId: demo.id, plan: 'basico' as const, billing: 'anual' as const, price: PLANS.basico.annual,
    plates: ['ABC-123'], spaceIds: ['F01'], startedAt: new Date(t0 - 30 * 86400000).toISOString(),
    expiresAt: new Date(t0 + 335 * 86400000).toISOString(),
  }];

  const sessions: Session[] = [];
  const used = new Set<string>();
  const pick = (type: VehicleType) => spaces.find(s => s.type === type && s.zone !== 'M' && !used.has(s.id))!.id;
  const mk = (type: VehicleType, agoMin: number, boughtMin: number, plate: string, extra: Partial<Session> = {}) => {
    const spaceId = pick(type); used.add(spaceId);
    const start = new Date(t0 - agoMin * MIN);
    const bike = type === 'bici';
    sessions.push({
      id: uid('ses'), code: ticketCode(), spaceId, type, plate, kind: bike ? 'bike' : 'hourly', userId: null, membershipId: null, soldBy: null,
      startAt: start.toISOString(), paidUntil: (bike ? endOfDay(start) : new Date(start.getTime() + boughtMin * MIN)).toISOString(),
      paid: bike ? 0 : quoteHourly(type, boughtMin), extensions: [], status: 'active', exitAt: null, overdueCharge: 0, ...extra,
    });
  };
  // Sesiones activas con distintos estados (vencidas, por vencer, en curso)
  mk('auto', 145, 120, 'KLM-482');  // vencida hace 25 min
  mk('auto', 65, 60, 'TRN-901');    // vencida hace 5 min (tolerancia)
  mk('auto', 52, 60, 'QRO-334');    // vence en 8 min
  mk('auto', 48, 60, 'MEX-207');    // vence en 12 min
  mk('auto', 35, 60, 'PLW-118');
  mk('auto', 20, 60, 'SJR-550');
  mk('auto', 300, 360, 'HGF-762');
  mk('auto', 10, 180, 'RTY-093');
  mk('auto', 100, 240, 'ZXC-415');
  mk('moto', 40, 60, 'M-7741');
  mk('moto', 15, 30, 'M-2098');
  mk('bici', 90, 0, 'MOV-1001', { userId: demo.id });
  mk('bici', 30, 0, 'MOV-2044');
  // Demo: la usuaria demo ya está dentro con su membresía
  used.add('F01');
  sessions.push({
    id: uid('ses'), code: ticketCode(), spaceId: 'F01', type: 'auto', plate: 'ABC-123', kind: 'member', userId: demo.id, membershipId: memId,
    soldBy: null, startAt: new Date(t0 - 200 * MIN).toISOString(), paidUntil: null, paid: 0, extensions: [], status: 'active', exitAt: null, overdueCharge: 0,
  });

  // Historial (ayer y antier) para analítica: picos en horarios de trenes
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const peakHours = [6, 7, 7, 8, 8, 9, 12, 14, 17, 18, 18, 19, 20, 21];
  for (let i = 0; i < 70; i++) {
    const type: VehicleType = rnd() < 0.8 ? 'auto' : 'moto';
    const start = new Date(t0 - (rnd() < 0.5 ? 1 : 2) * 86400000);
    start.setHours(peakHours[Math.floor(rnd() * peakHours.length)], Math.floor(rnd() * 60), 0, 0);
    const bought = [60, 120, 180, 240, 360, 480][Math.floor(rnd() * 6)];
    const late = rnd() < 0.15 ? 25 : 0;
    const exit = new Date(start.getTime() + (bought + late) * MIN);
    const over = late ? Math.round(quoteHourly(type, late) * 1.2) : 0;
    const spaceId = spaces.find(s => s.type === type && s.zone === 'G')!.id;
    sessions.push({
      id: uid('ses'), code: ticketCode(), spaceId, type, plate: `H${i}${Math.floor(rnd() * 900 + 100)}`, kind: 'hourly', userId: null, membershipId: null,
      soldBy: null, startAt: start.toISOString(), paidUntil: new Date(start.getTime() + bought * MIN).toISOString(),
      paid: quoteHourly(type, bought), extensions: [], status: 'closed', exitAt: exit.toISOString(), overdueCharge: over,
    });
  }
  return { meta: { clockOffsetMs: 0, tokens: {} }, spaces, users: [admin, demo], memberships, sessions };
}
