import { Router } from 'express';
import QRCode from 'qrcode';
import { load, save } from './db';
import { advanceClock, clockOffsetMinutes, now, resetClock } from './clock';
import { authOptional, issueToken, me, requireAdmin, requireAuth } from './auth';
import { PLANS, PRICES, GRACE_MIN, OVERTIME_SURCHARGE } from './pricing';
import * as svc from './services';
import { HttpError, hashPassword, uid, verifyPassword } from './util';

const publicUser = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
export const api = Router();
api.use(authOptional);

// ── Público ──
api.get('/pricing', (_q, r) => r.json({ prices: PRICES, plans: PLANS, graceMin: GRACE_MIN, overtimeSurcharge: OVERTIME_SURCHARGE }));
api.get('/time', (_q, r) => r.json({ now: now().toISOString(), offsetMinutes: clockOffsetMinutes() }));
api.get('/availability', (_q, r) => r.json({ ...svc.availability(), now: now().toISOString() }));
api.get('/quote', (q, r) => r.json(svc.quote(q.query.type as any, (q.query.plan as any) || 'hourly', Number(q.query.minutes))));

// ── Autenticación ──
api.post('/auth/register', (q, r) => {
  const { name, email, password } = q.body || {};
  if (!name || !/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 6) throw new HttpError(400, 'Captura nombre, correo válido y contraseña de al menos 6 caracteres');
  const db = load();
  if (db.users.some(u => u.email === String(email).toLowerCase())) throw new HttpError(409, 'Ya existe una cuenta con ese correo');
  const u = { id: uid('usr'), name: String(name).trim(), email: String(email).toLowerCase(), passHash: hashPassword(password), role: 'user' as const };
  db.users.push(u); save();
  r.status(201).json({ token: issueToken(u.id), user: publicUser(u) });
});
api.post('/auth/login', (q, r) => {
  const { email, password } = q.body || {};
  const u = load().users.find(x => x.email === String(email || '').toLowerCase());
  if (!u || !verifyPassword(String(password || ''), u.passHash)) throw new HttpError(401, 'Correo o contraseña incorrectos');
  r.json({ token: issueToken(u.id), user: publicUser(u) });
});
api.get('/me', requireAuth, (q, r) => {
  const u = me(q)!;
  const m = svc.activeMembershipOf(u.id) || null;
  r.json({ user: publicUser(u), membership: m ? { ...m, planName: PLANS[m.plan].name, spaceLabels: m.spaceIds } : null });
});
api.get('/me/sessions', requireAuth, (q, r) => {
  const u = me(q)!;
  const list = load().sessions.filter(s => s.userId === u.id).map(svc.sessionView).sort((a, b) => b.startAt.localeCompare(a.startAt));
  r.json({ active: list.filter(s => s.status === 'active'), history: list.filter(s => s.status === 'closed').slice(0, 10) });
});

// ── Membresías ──
api.post('/memberships', requireAuth, (q, r) => {
  const { plan, billing, plates } = q.body || {};
  r.status(201).json(svc.contractMembership(me(q)!.id, plan, billing, plates));
});
api.post('/me/checkin', requireAuth, (q, r) => r.status(201).json(svc.memberCheckIn(me(q)!.id, q.body?.plate)));

// ── Compra y tickets ──
api.post('/sessions', (q, r) => {
  const { type, plate, plan, minutes } = q.body || {};
  r.status(201).json(svc.buySpace({ type, plate, plan: plan || 'hourly', minutes: Number(minutes), userId: me(q)?.id ?? null }));
});
api.get('/sessions/:code', (q, r) => r.json(svc.sessionView(svc.getByCode(q.params.code))));
api.get('/sessions/:code/qr', async (q, r, next) => {
  try {
    const s = svc.getByCode(q.params.code);
    r.json({ code: s.code, dataUrl: await QRCode.toDataURL(s.code, { margin: 1, width: 320, color: { dark: '#17212B', light: '#FFFFFF' } }) });
  } catch (e) { next(e); }
});
api.get('/sessions/:code/extend-quote', (q, r) => r.json(svc.extensionQuote(q.params.code, Number(q.query.minutes))));
api.post('/sessions/:code/extend', (q, r) => r.json(svc.extendSession(q.params.code, Number(q.body?.minutes))));

// ── Administración ──
const admin = Router();
admin.use(requireAdmin);
admin.get('/overview', (_q, r) => r.json({ ...svc.adminOverview(), now: now().toISOString(), offsetMinutes: clockOffsetMinutes() }));
admin.get('/analytics', (_q, r) => r.json(svc.analytics()));
admin.post('/sell', (q, r) => {
  const { type, plate, plan, minutes } = q.body || {};
  if (type === 'bici') throw new HttpError(400, 'Las bicicletas se registran desde la cuenta del usuario');
  r.status(201).json(svc.buySpace({ type, plate, plan: plan || 'hourly', minutes: Number(minutes), userId: null, soldBy: me(q)!.id }));
});
/** confirm=false → muestra lo que debe pagar; confirm=true → registra la salida */
admin.post('/exit', (q, r) => {
  const { code, plate, confirm } = q.body || {};
  const s = svc.findForExit(code, plate);
  r.json(confirm ? { closed: true, session: svc.closeSession(s) } : { closed: false, session: svc.sessionView(s) });
});
admin.post('/clock/advance', (q, r) => { advanceClock(Math.max(1, Math.min(1440, Number(q.body?.minutes) || 0))); r.json({ now: now().toISOString(), offsetMinutes: clockOffsetMinutes() }); });
admin.post('/clock/reset', (_q, r) => { resetClock(); r.json({ now: now().toISOString(), offsetMinutes: 0 }); });
api.use('/admin', admin);
