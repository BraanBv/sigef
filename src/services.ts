import { load, save } from './db';
import { now } from './clock';
import { DB, Membership, PlanId, Session, VehicleType } from './types';
import { EXPIRING_MIN, GRACE_MIN, OVERTIME_SURCHARGE, PLANS, PRICES, endOfDay, isNight, nextNightEnd, quoteHourly } from './pricing';
import { HttpError, normPlate, ticketCode, uid } from './util';

const MIN = 60000;
const minsBetween = (a: Date | string, b: Date | string) => (new Date(b).getTime() - new Date(a).getTime()) / MIN;

export const activeSessions = () => load().sessions.filter(s => s.status === 'active');
export const isMembershipActive = (m: Membership) => new Date(m.expiresAt) > now();
export const activeMembershipOf = (userId: string) => load().memberships.find(m => m.userId === userId && isMembershipActive(m));

/** Cobro por exceso de tiempo: tarifa normal + recargo, después de la tolerancia */
export function overdueCharge(s: Session): number {
  if (s.kind === 'member' || !s.paidUntil) return 0;
  const over = minsBetween(s.paidUntil, now());
  if (over <= GRACE_MIN) return 0;
  return Math.round(quoteHourly(s.type, over) * (1 + OVERTIME_SURCHARGE));
}

export function sessionView(s: Session) {
  const sp = load().spaces.find(x => x.id === s.spaceId)!;
  const t = now();
  let minutesLeft: number | null = null;
  let state: 'ok' | 'expiring' | 'overtime' | 'member' = 'ok';
  if (s.kind === 'member') state = 'member';
  else {
    minutesLeft = Math.floor(minsBetween(t, s.paidUntil!));
    if (minutesLeft < 0) state = 'overtime';
    else if (minutesLeft <= EXPIRING_MIN) state = 'expiring';
  }
  return {
    ...s, spaceLabel: sp.label, zone: sp.zone, minutesLeft, state,
    elapsedMinutes: Math.round(minsBetween(s.startAt, s.exitAt ?? t)),
    amountDue: s.status === 'active' ? overdueCharge(s) : s.overdueCharge,
    canExtend: s.status === 'active' && (s.kind === 'hourly'),
  };
}

function freeSpace(type: VehicleType, zone: 'G' | 'B') {
  const busy = new Set(activeSessions().map(s => s.spaceId));
  const sp = load().spaces.find(x => x.type === type && x.zone === zone && !busy.has(x.id));
  if (!sp) throw new HttpError(409, `No hay espacios disponibles para ${type === 'auto' ? 'autos' : type === 'moto' ? 'motos' : 'bicicletas'} en este momento`);
  return sp;
}
function ensureNotParked(plate: string) {
  if (activeSessions().some(s => s.plate === plate)) throw new HttpError(409, 'Ese vehículo ya tiene una sesión activa en el estacionamiento');
}

export function quote(type: VehicleType, plan: 'hourly' | 'night', minutes: number) {
  if (!PRICES[type]) throw new HttpError(400, 'Tipo de vehículo inválido');
  if (type === 'bici') return { amount: 0, minutes: 0, note: 'Gratis con registro' };
  if (plan === 'night') return { amount: PRICES[type].night, minutes: Math.round(minsBetween(now(), nextNightEnd(now()))), note: 'Tarifa nocturna hasta las 08:00' };
  validateMinutes(minutes);
  return { amount: quoteHourly(type, minutes), minutes, note: '' };
}
function validateMinutes(m: number) {
  if (!Number.isInteger(m) || m < 30 || m > 1440 || m % 30 !== 0) throw new HttpError(400, 'El tiempo debe ser múltiplo de 30 minutos (máximo 24 h)');
}

interface BuyInput { type: VehicleType; plate: string; plan: 'hourly' | 'night'; minutes: number; userId: string | null; soldBy?: string | null }
export function buySpace(inp: BuyInput) {
  const db = load();
  if (!PRICES[inp.type]) throw new HttpError(400, 'Tipo de vehículo inválido');
  const plate = normPlate(inp.plate);
  ensureNotParked(plate);
  const t = now();
  let paidUntil: Date, paid: number, kind: Session['kind'];
  if (inp.type === 'bici') {
    if (!inp.userId) throw new HttpError(401, 'Las bicicletas requieren una cuenta registrada');
    const mine = activeSessions().filter(s => s.userId === inp.userId && s.type === 'bici').length;
    if (mine >= 2) throw new HttpError(409, 'Cada tarjeta de movilidad admite máximo 2 bicicletas');
    paidUntil = endOfDay(t); paid = 0; kind = 'bike';
  } else if (inp.plan === 'night') {
    if (!isNight(t)) throw new HttpError(400, 'La tarifa nocturna solo se vende de 20:00 a 08:00');
    paidUntil = nextNightEnd(t); paid = PRICES[inp.type].night; kind = 'night';
  } else {
    validateMinutes(inp.minutes);
    paidUntil = new Date(t.getTime() + inp.minutes * MIN); paid = quoteHourly(inp.type, inp.minutes); kind = 'hourly';
  }
  const space = freeSpace(inp.type, inp.type === 'bici' ? 'B' : 'G');
  const s: Session = {
    id: uid('ses'), code: ticketCode(), spaceId: space.id, type: inp.type, plate, kind, userId: inp.userId, membershipId: null,
    soldBy: inp.soldBy ?? null, startAt: t.toISOString(), paidUntil: paidUntil.toISOString(), paid, extensions: [],
    status: 'active', exitAt: null, overdueCharge: 0,
  };
  db.sessions.push(s); save();
  return sessionView(s);
}

export function getByCode(code: string) {
  const s = load().sessions.find(x => x.code === String(code).trim().toUpperCase());
  if (!s) throw new HttpError(404, 'Ticket no encontrado');
  return s;
}

export function extendSession(code: string, minutes: number) {
  const s = getByCode(code);
  if (s.status !== 'active') throw new HttpError(409, 'Esta sesión ya terminó');
  if (s.kind !== 'hourly') throw new HttpError(400, 'Este tipo de ticket no admite extensión de tiempo');
  validateMinutes(minutes);
  const newUntil = new Date(new Date(s.paidUntil!).getTime() + minutes * MIN);
  const total = minsBetween(s.startAt, newUntil);
  const newCost = quoteHourly(s.type, total);
  const amount = Math.max(0, newCost - s.paid);
  s.extensions.push({ at: now().toISOString(), minutes, amount });
  s.paid = newCost; s.paidUntil = newUntil.toISOString();
  save();
  return { ...sessionView(s), charged: amount };
}

export function extensionQuote(code: string, minutes: number) {
  const s = getByCode(code);
  validateMinutes(minutes);
  const total = minsBetween(s.startAt, new Date(new Date(s.paidUntil!).getTime() + minutes * MIN));
  return { amount: Math.max(0, quoteHourly(s.type, total) - s.paid) };
}

// ───────── Membresías ─────────
export function contractMembership(userId: string, plan: PlanId, billing: 'mensual' | 'anual', platesIn: string[]) {
  const db = load();
  const def = PLANS[plan];
  if (!def) throw new HttpError(400, 'Plan inválido');
  if (billing !== 'mensual' && billing !== 'anual') throw new HttpError(400, 'Facturación inválida');
  if (activeMembershipOf(userId)) throw new HttpError(409, 'Ya cuentas con una membresía vigente');
  const plates = [...new Set((platesIn || []).filter(Boolean).map(normPlate))];
  if (plates.length < 1 || plates.length > def.seats) throw new HttpError(400, `El plan ${def.name} admite de 1 a ${def.seats} placa(s)`);
  const taken = new Set(db.memberships.filter(isMembershipActive).flatMap(m => m.spaceIds));
  const free = db.spaces.filter(s => s.zone === 'M' && !taken.has(s.id));
  if (free.length < def.spaces) throw new HttpError(409, 'No hay espacios fijos disponibles para este plan');
  const t = now(); const exp = new Date(t);
  if (billing === 'anual') exp.setFullYear(exp.getFullYear() + 1); else exp.setMonth(exp.getMonth() + 1);
  const m: Membership = {
    id: uid('mem'), userId, plan, billing, price: billing === 'anual' ? def.annual : def.monthly, plates,
    spaceIds: free.slice(0, def.spaces).map(s => s.id), startedAt: t.toISOString(), expiresAt: exp.toISOString(),
  };
  db.memberships.push(m); save();
  return m;
}

export function memberCheckIn(userId: string, plateIn: string) {
  const db = load();
  const m = activeMembershipOf(userId);
  if (!m) throw new HttpError(403, 'Necesitas una membresía vigente');
  const plate = normPlate(plateIn);
  if (!m.plates.includes(plate)) throw new HttpError(403, 'Esa placa no está vinculada a tu membresía');
  ensureNotParked(plate);
  const busy = new Set(activeSessions().map(s => s.spaceId));
  const spaceId = m.spaceIds.find(id => !busy.has(id));
  if (!spaceId) throw new HttpError(409, m.plan === 'plus' ? 'Tu espacio ya está en uso (1 vehículo a la vez)' : 'Todos tus espacios están en uso');
  const s: Session = {
    id: uid('ses'), code: ticketCode(), spaceId, type: 'auto', plate, kind: 'member', userId, membershipId: m.id, soldBy: null,
    startAt: now().toISOString(), paidUntil: null, paid: 0, extensions: [], status: 'active', exitAt: null, overdueCharge: 0,
  };
  db.sessions.push(s); save();
  return sessionView(s);
}

// ───────── Salida (administrador) ─────────
export function findForExit(code?: string, plate?: string) {
  const act = activeSessions();
  let s: Session | undefined;
  if (code) s = act.find(x => x.code === String(code).trim().toUpperCase());
  else if (plate) {
    s = act.find(x => x.plate === normPlate(plate));
    if (s?.userId) throw new HttpError(403, 'Este vehículo pertenece a una cuenta: se requiere mostrar el QR para salir');
  } else throw new HttpError(400, 'Escanea el QR o captura el folio o la placa');
  if (!s) throw new HttpError(404, 'No hay una sesión activa con esos datos');
  return s;
}
export function closeSession(s: Session) {
  s.overdueCharge = overdueCharge(s); s.exitAt = now().toISOString(); s.status = 'closed';
  save();
  return sessionView(s);
}

// ───────── Disponibilidad y panel ─────────
export function bays() {
  const db = load();
  const bySpace = new Map(activeSessions().map(s => [s.spaceId, s]));
  const reserved = new Set(db.memberships.filter(isMembershipActive).flatMap(m => m.spaceIds));
  return db.spaces.map(sp => {
    const s = bySpace.get(sp.id);
    let status: 'free' | 'busy' | 'soon' | 'overtime' | 'reserved' = sp.zone === 'M' && reserved.has(sp.id) ? 'reserved' : 'free';
    let minutesLeft: number | null = null;
    if (s) {
      const v = sessionView(s); minutesLeft = v.minutesLeft;
      status = v.state === 'overtime' ? 'overtime' : v.state === 'expiring' ? 'soon' : 'busy';
    }
    return { ...sp, status, minutesLeft, session: s ? sessionView(s) : null };
  });
}

export function availability() {
  const all = bays();
  const sum = (f: (b: (typeof all)[number]) => boolean) => {
    const g = all.filter(f);
    return {
      total: g.length,
      free: g.filter(b => b.status === 'free').length,
      freeing60: g.filter(b => b.session && b.minutesLeft !== null && b.minutesLeft <= 60).length,
    };
  };
  return {
    summary: {
      auto: sum(b => b.type === 'auto' && b.zone === 'G'),
      moto: sum(b => b.type === 'moto'),
      bici: sum(b => b.type === 'bici'),
      fijos: { total: all.filter(b => b.zone === 'M').length, free: all.filter(b => b.zone === 'M' && b.status === 'free').length, freeing60: 0 },
    },
    // Vista pública: sin placas ni folios
    bays: all.map(({ session, ...b }) => b),
  };
}

export function adminOverview() {
  const all = bays();
  const views = activeSessions().map(sessionView);
  return {
    ...availability(),
    bays: all,
    upcoming: views.filter(v => v.minutesLeft !== null && v.minutesLeft >= 0 && v.minutesLeft <= 60).sort((a, b) => a.minutesLeft! - b.minutesLeft!),
    overtime: views.filter(v => v.state === 'overtime').sort((a, b) => a.minutesLeft! - b.minutesLeft!),
    expiring: views.filter(v => v.state === 'expiring'),
    activeCount: views.length,
  };
}

export function analytics() {
  const db: DB = load();
  const nonMember = db.sessions.filter(s => s.kind !== 'member');
  const byHour = Array.from({ length: 24 }, () => 0);
  nonMember.forEach(s => byHour[new Date(s.startAt).getHours()]++);
  const closed = nonMember.filter(s => s.status === 'closed');
  const avg = closed.length ? Math.round(closed.reduce((a, s) => a + minsBetween(s.startAt, s.exitAt!), 0) / closed.length) : 0;
  const usage = closed.reduce((a, s) => a + s.paid + s.overdueCharge, 0) + activeSessions().reduce((a, s) => a + s.paid, 0);
  const overdueTotal = closed.reduce((a, s) => a + s.overdueCharge, 0);
  const memRev = db.memberships.filter(isMembershipActive).reduce((a, m) => a + m.price, 0);
  const g = db.spaces.filter(s => s.zone !== 'M').length;
  const occupied = activeSessions().filter(s => s.kind !== 'member').length;
  const peak = byHour.indexOf(Math.max(...byHour));
  return {
    byHour, peakHour: peak, avgMinutes: avg, sessions: nonMember.length,
    revenue: { usage, overdue: overdueTotal, memberships: memRev, total: usage + memRev },
    occupancyPct: Math.round((occupied / g) * 100),
    memberships: db.memberships.filter(isMembershipActive).length,
  };
}
