'use strict';
/* ───────── Utilidades ───────── */
const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n).toLocaleString('es-MX');
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };
const TYPE = { auto: 'Auto', moto: 'Moto', bici: 'Bicicleta' };
const dur = m => { m = Math.abs(Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h${r ? ' ' + r + ' min' : ''}` : `${r} min`; };
const clock = iso => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

let token = store.get('token', null), user = null, membership = null, pricing = null;
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error inesperado');
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3500); }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
async function loadMe() {
  user = membership = null;
  if (!token) return;
  try { const r = await api('/me'); user = r.user; membership = r.membership; } catch { token = null; store.set('token', null); }
}
function setAuth(r) { token = r.token; store.set('token', token); }

/* ───────── Navegación ───────── */
const ROUTES = { '': ['Estacionarse', park], planes: ['Planes y tarifas', plans], cuenta: ['Mi cuenta', account], admin: ['Administración', adminView] };
let current = null, timer = null;
async function route() {
  const key = location.hash.replace(/^#\/?/, '');
  const [, view] = ROUTES[key] || ROUTES[''];
  await loadMe();
  $('#nav').innerHTML = Object.entries(ROUTES).map(([k, [name]]) => `<a href="#/${k}" class="${k === key ? 'on' : ''}">${name}</a>`).join('');
  current = view; clearInterval(timer);
  await view.mount();
  timer = setInterval(() => guard(() => current.tick && current.tick())(), 10000);
}
window.addEventListener('hashchange', route);

/* ───────── Piezas compartidas ───────── */
function lotHTML(bays, { admin = false, selected = null } = {}) {
  const groups = [['auto', 'G', 'Autos'], ['auto', 'M', 'Espacios fijos de membresía'], ['moto', 'G', 'Motos'], ['bici', 'B', 'Bicicletas']];
  const tip = b => `${b.label}: ${{ free: 'libre', busy: 'ocupado', soon: 'se libera pronto', overtime: 'tiempo excedido', reserved: 'reservado (membresía)' }[b.status]}${b.minutesLeft !== null ? ' · ' + (b.minutesLeft >= 0 ? 'quedan ' + dur(b.minutesLeft) : 'excedido ' + dur(b.minutesLeft)) : ''}`;
  return groups.map(([t, z, title]) => {
    const list = bays.filter(b => b.type === t && b.zone === z);
    return `<section class="lot"><h3>${title}</h3><div class="bays">${list.map(b => `<div class="bay ${b.status} ${selected === b.id ? 'sel' : ''}" title="${esc(tip(b))}" ${admin ? `data-bay="${b.id}" tabindex="0"` : ''}>${b.label.split('-')[1]}</div>`).join('')}</div></section>`;
  }).join('') + `<div class="legend" style="background:var(--asphalt);padding:.6rem 1rem;border-radius:6px">
    <span><i style="border:2px solid #2E7A56"></i>Libre</span><span><i style="background:#8593A0"></i>Ocupado</span><span><i style="background:var(--warn)"></i>Vence en ≤15 min</span><span><i style="background:var(--bad)"></i>Tiempo excedido</span><span><i style="border:2px dashed #6E7C89"></i>Membresía</span></div>`;
}
function statsHTML(s) {
  const one = (label, g) => `<div class="stat ${g.free === 0 ? 'zero' : ''}"><b>${g.free}</b><span>${label} libres de ${g.total}${g.freeing60 ? ` · ${g.freeing60} se liberan en 1 h` : ''}</span></div>`;
  return one('Autos', s.auto) + one('Motos', s.moto) + one('Bicicletas', s.bici);
}
const qrCache = new Map();
async function qrFor(code) { if (!qrCache.has(code)) qrCache.set(code, (await api(`/sessions/${code}/qr`)).dataUrl); return qrCache.get(code); }

function ticketHTML(v) {
  const label = { ok: 'En curso', expiring: 'Por vencer', overtime: 'Tiempo excedido', member: 'Membresía' }[v.state];
  const time = v.state === 'member' ? `<div class="timer">${dur(v.elapsedMinutes)}</div><div class="muted small">dentro del estacionamiento</div>`
    : v.minutesLeft >= 0 ? `<div class="timer">${dur(v.minutesLeft)}</div><div class="muted small">restantes · vence ${clock(v.paidUntil)}</div>`
      : `<div class="timer" style="color:var(--bad)">+${dur(v.minutesLeft)}</div><div class="muted small">de exceso · a pagar en salida: <b>${money(v.amountDue)}</b></div>`;
  return `<div class="ticket" data-code="${v.code}" style="margin-bottom:1rem">
    <div class="head"><span>${TYPE[v.type]} · ${esc(v.plate)}</span><span>Espacio ${v.spaceLabel}</span></div>
    <div class="body"><img alt="Código QR ${v.code}" data-qr="${v.code}" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
      <div style="flex:1;min-width:190px"><div class="code">${v.code}</div><span class="pill ${v.state}">${label}</span>${time}
        <div class="muted small">Pagado: ${money(v.paid)}${v.userId ? ' · Muestra el QR al salir' : ' · Conserva este folio para salir'}</div></div></div>
    ${v.canExtend ? `<div class="row" style="padding:0 1rem 1rem"><span class="small muted">Agregar tiempo:</span>${[30, 60, 120].map(m => `<button class="sec" data-extend="${m}">+${dur(m)}</button>`).join('')}</div>` : ''}</div>`;
}
function hydrateQR(root) { root.querySelectorAll('img[data-qr]').forEach(async img => { try { img.src = await qrFor(img.dataset.qr); } catch {} }); }

document.addEventListener('click', guard(async e => {
  const ext = e.target.closest('[data-extend]');
  if (!ext) return;
  const code = ext.closest('[data-code]').dataset.code, m = Number(ext.dataset.extend);
  const q = await api(`/sessions/${code}/extend-quote?minutes=${m}`);
  if (!confirm(`Agregar ${dur(m)} por ${money(q.amount)}?`)) return;
  const r = await api(`/sessions/${code}/extend`, { method: 'POST', body: { minutes: m } });
  toast(`Tiempo extendido. Cargo: ${money(r.charged)}`);
  current.tick && current.tick();
}));

/* Formulario de compra reutilizable (usuario y ventanilla) */
function buyForm(prefix, { admin = false } = {}) {
  return `<label>Tipo de vehículo</label><div class="seg" id="${prefix}-type">${['auto', 'moto', ...(admin ? [] : ['bici'])].map((t, i) => `<button type="button" data-v="${t}" class="${i ? '' : 'on'}">${TYPE[t]}</button>`).join('')}</div>
    <label for="${prefix}-plate" id="${prefix}-plate-l">Placa</label><input id="${prefix}-plate" autocomplete="off" placeholder="ABC-123" maxlength="12">
    <div id="${prefix}-time"><label for="${prefix}-plan">Tarifa</label><select id="${prefix}-plan"><option value="hourly">Por tiempo</option><option value="night">Nocturna (20:00–08:00)</option></select>
    <label for="${prefix}-min">Tiempo</label><select id="${prefix}-min">${[30, 60, 90, 120, 180, 240, 360, 480, 720].map(m => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${dur(m)}</option>`).join('')}</select></div>
    <p class="small muted" id="${prefix}-note"></p>
    <div class="row spread" style="margin-top:.5rem"><div><span class="muted small">Total</span> <span class="price" id="${prefix}-total">$25</span></div><button id="${prefix}-go">${admin ? 'Vender espacio' : 'Comprar espacio'}</button></div><p class="err" id="${prefix}-err"></p>`;
}
function wireBuy(prefix, { onDone, admin = false }) {
  let type = 'auto';
  const seg = $(`#${prefix}-type`);
  const refresh = guard(async () => {
    const bike = type === 'bici', night = $(`#${prefix}-plan`).value === 'night';
    $(`#${prefix}-time`).hidden = bike; $(`#${prefix}-min`).disabled = night;
    $(`#${prefix}-plate-l`).textContent = bike ? 'Folio de tarjeta de movilidad' : 'Placa';
    const q = await api(`/quote?type=${type}&plan=${night ? 'night' : 'hourly'}&minutes=${$(`#${prefix}-min`).value}`);
    $(`#${prefix}-total`).textContent = money(q.amount);
    $(`#${prefix}-note`).textContent = bike ? 'Gratis. Requiere cuenta; máximo 2 bicicletas por tarjeta y retiro el mismo día.' : (q.note || (token || admin ? '' : 'Sin cuenta recibes un ticket con folio. Con cuenta obtienes un QR para salir.'));
  });
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; type = b.dataset.v; seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); refresh(); });
  $(`#${prefix}-plan`).addEventListener('change', refresh); $(`#${prefix}-min`).addEventListener('change', refresh);
  $(`#${prefix}-go`).addEventListener('click', async () => {
    $(`#${prefix}-err`).textContent = '';
    try {
      const body = { type, plate: $(`#${prefix}-plate`).value, plan: $(`#${prefix}-plan`).value, minutes: Number($(`#${prefix}-min`).value) };
      const v = await api(admin ? '/admin/sell' : '/sessions', { method: 'POST', body });
      $(`#${prefix}-plate`).value = ''; await onDone(v);
    } catch (e) { $(`#${prefix}-err`).textContent = e.message; }
  });
  refresh();
}

/* ───────── Vista: Estacionarse ───────── */
async function park() {
  $('#view').innerHTML = `<h1>Estacionamiento de la estación</h1><p class="muted">Consulta disponibilidad en tiempo real, compra tu espacio antes de llegar y controla tu tiempo desde aquí.</p>
    <div class="stats" id="stats"></div>
    <div class="grid cols2"><div><div class="card"><h2>Comprar espacio</h2>${buyForm('b')}</div><div id="lotwrap" style="margin-top:1.25rem"></div></div>
    <div><h2>Mis tickets</h2><div id="tickets"></div></div></div>`;
  wireBuy('b', { onDone: async v => { const l = store.get('tickets', []); store.set('tickets', [v.code, ...l]); toast(`Espacio ${v.spaceLabel} asignado. Folio ${v.code}`); await park.tick(); } });
  await park.tick();
}
park.mount = park;
park.tick = async () => {
  const a = await api('/availability');
  $('#stats').innerHTML = statsHTML(a.summary);
  $('#lotwrap').innerHTML = lotHTML(a.bays.filter(b => b.zone !== 'M'));
  let list = [];
  const saved = store.get('tickets', []);
  for (const c of saved) { try { list.push(await api('/sessions/' + c)); } catch { /* ticket inexistente */ } }
  if (token) list = list.concat((await api('/me/sessions')).active);
  const seen = new Set(); list = list.filter(v => v.status === 'active' && !seen.has(v.code) && seen.add(v.code));
  store.set('tickets', saved.filter(c => list.some(v => v.code === c)));
  $('#tickets').innerHTML = list.length ? list.map(ticketHTML).join('') : `<div class="card muted">No tienes tickets activos. Compra un espacio para generar tu QR o folio.</div>`;
  hydrateQR($('#tickets'));
  const bad = list.filter(v => v.state === 'overtime'), soon = list.filter(v => v.state === 'expiring');
  const b = $('#banner');
  if (bad.length || soon.length) { b.hidden = false; b.className = 'banner' + (bad.length ? ' overtime' : ''); b.textContent = bad.length ? `Tu tiempo se agotó en ${bad.map(v => v.spaceLabel).join(', ')}. Agrega tiempo para evitar recargos.` : `Tu ticket de ${soon[0].spaceLabel} vence en ${dur(soon[0].minutesLeft)}. Puedes extenderlo sin penalización.`; }
  else b.hidden = true;
};

/* ───────── Vista: Planes y tarifas ───────── */
async function plans() {
  pricing = pricing || await api('/pricing');
  const { plans: P, prices: R } = pricing;
  $('#view').innerHTML = `<h1>Planes y tarifas</h1><p class="muted">Paga solo cuando lo uses o asegura tu espacio con una membresía.</p><h2>Membresías</h2>
    <div class="grid cols2">${Object.entries(P).map(([id, p]) => `<div class="card plan"><h3>${p.name}</h3><div class="price">${money(p.monthly)}<span class="small muted"> /mes</span></div><p class="small">o ${money(p.annual)} al año (2 meses gratis)</p><p>${p.blurb}. ${p.spaces} espacio(s) fijo(s), hasta ${p.seats} persona(s), usos ilimitados.</p><a class="btn" href="#/cuenta">Contratar</a></div>`).join('')}</div>
    <h2 style="margin-top:2rem">Pago por uso</h2><div class="card tablewrap"><table><tr><th>Vehículo</th><th>30 min</th><th>Por hora</th><th>Tope 12 h</th><th>Nocturno 20:00–08:00</th><th>Registro</th></tr>
    ${['auto', 'moto', 'bici'].map(t => `<tr><td>${TYPE[t]}</td>${t === 'bici' ? '<td colspan="4"><b>Gratis</b></td><td>Obligatorio</td>' : `<td>${money(R[t].per30)}</td><td>${money(R[t].hour)}</td><td>${money(R[t].day)}</td><td>${money(R[t].night)}</td><td>No</td>`}</tr>`).join('')}</table>
    <p class="small muted">Tolerancia de ${pricing.graceMin} min al vencer. Después se cobra el tiempo excedido con ${pricing.overtimeSurcharge * 100}% de recargo al salir.</p></div>`;
}
plans.mount = plans;

/* ───────── Vista: Mi cuenta ───────── */
function authForms(demo) {
  return `<div class="grid cols2"><div class="card"><h2>Iniciar sesión</h2><label for="li-e">Correo</label><input id="li-e" type="email" value="${demo || ''}"><label for="li-p">Contraseña</label><input id="li-p" type="password"><p class="small muted">Demo: demo@sigef.mx / demo123 · Admin: admin@sigef.mx / admin123</p><p class="err" id="li-err"></p><button id="li-go">Entrar</button></div>
    <div class="card"><h2>Crear cuenta</h2><label for="rg-n">Nombre</label><input id="rg-n"><label for="rg-e">Correo</label><input id="rg-e" type="email"><label for="rg-p">Contraseña (mín. 6)</label><input id="rg-p" type="password"><p class="err" id="rg-err"></p><button id="rg-go">Registrarme</button></div></div>`;
}
function wireAuth() {
  const go = async (path, body, err) => { try { setAuth(await api(path, { method: 'POST', body })); await route(); } catch (e) { $(err).textContent = e.message; } };
  $('#li-go').onclick = () => go('/auth/login', { email: $('#li-e').value, password: $('#li-p').value }, '#li-err');
  $('#rg-go').onclick = () => go('/auth/register', { name: $('#rg-n').value, email: $('#rg-e').value, password: $('#rg-p').value }, '#rg-err');
}
async function account() {
  if (!user) { $('#view').innerHTML = `<h1>Mi cuenta</h1>${authForms()}`; wireAuth(); return; }
  pricing = pricing || await api('/pricing');
  const m = membership;
  $('#view').innerHTML = `<div class="row spread"><h1>Hola, ${esc(user.name)}</h1><button class="sec" id="out">Cerrar sesión</button></div>
    <div class="grid cols2"><div>${m ? `<div class="card plan"><h2>Membresía ${esc(pricing.plans[m.plan].name)}</h2><p>Espacio fijo: <b>${m.spaceIds.join(', ')}</b><br>Placas: <b>${m.plates.map(esc).join(', ')}</b><br>Vigente hasta ${new Date(m.expiresAt).toLocaleDateString('es-MX', { dateStyle: 'long' })}</p>
      <label for="ci-p">Registrar entrada</label><div class="row"><input id="ci-p" style="flex:1" placeholder="Placa"><button id="ci-go">Entrar</button></div><p class="err" id="ci-err"></p></div>`
      : `<div class="card"><h2>Contratar membresía</h2><label for="m-plan">Plan</label><select id="m-plan">${Object.entries(pricing.plans).map(([k, p]) => `<option value="${k}">${p.name} — ${money(p.monthly)}/mes</option>`).join('')}</select>
      <label for="m-bill">Pago</label><select id="m-bill"><option value="anual">Anual (2 meses gratis)</option><option value="mensual">Mensual</option></select>
      <label for="m-pl">Placas (separadas por coma)</label><input id="m-pl" placeholder="ABC-123, XYZ-987"><p class="err" id="m-err"></p><button id="m-go">Contratar</button></div>`}
      <div class="card" style="margin-top:1.25rem"><h2>Registrar bicicleta</h2>${'' }<label for="bk-f">Folio de tarjeta de movilidad</label><input id="bk-f" maxlength="12"><p class="err" id="bk-err"></p><button id="bk-go">Registrar (gratis)</button></div></div>
    <div><h2>Mis sesiones</h2><div id="mine"></div></div></div>`;
  $('#out').onclick = () => { token = null; store.set('token', null); route(); };
  if (m) $('#ci-go').onclick = async () => { try { await api('/me/checkin', { method: 'POST', body: { plate: $('#ci-p').value } }); toast('Entrada registrada'); account.tick(); } catch (e) { $('#ci-err').textContent = e.message; } };
  else $('#m-go').onclick = async () => { try { await api('/memberships', { method: 'POST', body: { plan: $('#m-plan').value, billing: $('#m-bill').value, plates: $('#m-pl').value.split(',').map(s => s.trim()) } }); toast('Membresía activa'); route(); } catch (e) { $('#m-err').textContent = e.message; } };
  $('#bk-go').onclick = async () => { try { await api('/sessions', { method: 'POST', body: { type: 'bici', plate: $('#bk-f').value } }); toast('Bicicleta registrada'); account.tick(); } catch (e) { $('#bk-err').textContent = e.message; } };
  await account.tick();
}
account.mount = account;
account.tick = async () => {
  if (!user) return;
  const r = await api('/me/sessions');
  $('#mine').innerHTML = (r.active.length ? r.active.map(ticketHTML).join('') : '<div class="card muted">Sin sesiones activas.</div>')
    + (r.history.length ? `<h3>Historial reciente</h3><div class="card tablewrap"><table><tr><th>Fecha</th><th>Vehículo</th><th>Duración</th><th>Pagado</th></tr>${r.history.map(h => `<tr><td>${new Date(h.startAt).toLocaleDateString('es-MX')}</td><td>${esc(h.plate)}</td><td>${dur(h.elapsedMinutes)}</td><td>${money(h.paid + h.overdueCharge)}</td></tr>`).join('')}</table></div>` : '');
  hydrateQR($('#mine'));
};

/* ───────── Vista: Administración ───────── */
let selBay = null, lastOverview = null;
async function adminView() {
  if (!user || user.role !== 'admin') {
    $('#view').innerHTML = `<h1>Administración</h1><p class="muted">Acceso solo para personal autorizado.</p>${authForms('admin@sigef.mx')}`; wireAuth(); return;
  }
  $('#view').innerHTML = `<div class="row spread"><h1>Panel de operación</h1><div class="small muted" id="clk"></div></div>
    <div class="stats" id="stats"></div>
    <div class="grid cols2"><div><div id="lotwrap"></div><div class="card" id="detail" hidden style="margin-top:1rem"></div></div>
    <div><div class="card"><h2>Alertas</h2><div id="alerts"></div></div>
    <div class="card" style="margin-top:1.25rem"><h2>Por desocuparse (próxima hora)</h2><div id="upcoming" class="tablewrap"></div></div></div></div>
    <div class="grid cols2" style="margin-top:1.25rem">
      <div class="card"><h2>Vender espacio</h2>${buyForm('s', { admin: true })}<div id="sold" style="margin-top:1rem"></div></div>
      <div class="card"><h2>Validar salida</h2><label for="x-code">Folio / QR</label><input id="x-code" placeholder="SGF-XXXXXX" autocomplete="off">
        <label for="x-plate">o placa (solo tickets sin cuenta)</label><input id="x-plate" autocomplete="off" placeholder="ABC-123"><p class="err" id="x-err"></p><button id="x-go" class="dark">Revisar salida</button><div id="x-res" style="margin-top:1rem"></div></div></div>
    <div class="card" style="margin-top:1.25rem"><h2>Analítica</h2><div id="ana"></div></div>
    <div class="card" style="margin-top:1.25rem"><h2>Simulador de tiempo (demo)</h2><p class="small muted">Adelanta el reloj del sistema para ver cómo cambian alertas, vencimientos y cobros.</p><div class="row"><button class="sec" data-adv="15">+15 min</button><button class="sec" data-adv="30">+30 min</button><button class="sec" data-adv="60">+1 h</button><button class="sec" id="clk-reset">Regresar a la hora real</button></div></div>`;
  wireBuy('s', { admin: true, onDone: async v => { $('#sold').innerHTML = ticketHTML(v).replace(/<div class="row"[\s\S]*$/, '</div>'); hydrateQR($('#sold')); await adminView.tick(); } });
  $('#lotwrap').onclick = e => { const b = e.target.closest('[data-bay]'); if (b) { selBay = b.dataset.bay; renderDetail(); $('#lotwrap').innerHTML = lotHTML(lastOverview.bays, { admin: true, selected: selBay }); } };
  $('#x-go').onclick = () => exitFlow(false);
  document.querySelectorAll('[data-adv]').forEach(b => b.onclick = guard(async () => { await api('/admin/clock/advance', { method: 'POST', body: { minutes: Number(b.dataset.adv) } }); await adminView.tick(); }));
  $('#clk-reset').onclick = guard(async () => { await api('/admin/clock/reset', { method: 'POST' }); await adminView.tick(); });
  await adminView.tick();
}
adminView.mount = adminView;
function renderDetail() {
  const b = lastOverview.bays.find(x => x.id === selBay), d = $('#detail');
  if (!b) { d.hidden = true; return; }
  d.hidden = false;
  d.innerHTML = `<h3>Espacio ${b.label}</h3>` + (b.session ? `<p>${TYPE[b.session.type]} <b>${esc(b.session.plate)}</b> · folio ${b.session.code}<br>Entró ${clock(b.session.startAt)} · ${b.session.state === 'member' ? 'Membresía' : b.minutesLeft >= 0 ? 'quedan ' + dur(b.minutesLeft) : 'excedido ' + dur(b.minutesLeft) + ' · a cobrar ' + money(b.session.amountDue)}</p>` : `<p class="muted">${b.status === 'reserved' ? 'Reservado para una membresía.' : 'Libre.'}</p>`);
}
adminView.tick = async () => {
  if (!user || user.role !== 'admin') return;
  const o = lastOverview = await api('/admin/overview');
  $('#clk').textContent = `Hora del sistema ${clock(o.now)}${o.offsetMinutes ? ` (simulada +${dur(o.offsetMinutes)})` : ''}`;
  $('#stats').innerHTML = statsHTML(o.summary) + `<div class="stat ${o.overtime.length ? 'zero' : ''}"><b>${o.overtime.length}</b><span>con tiempo excedido</span></div>`;
  $('#lotwrap').innerHTML = lotHTML(o.bays, { admin: true, selected: selBay }); renderDetail();
  const row = v => `<tr><td>${v.spaceLabel}</td><td>${esc(v.plate)}</td><td>${v.code}</td><td>${v.minutesLeft >= 0 ? dur(v.minutesLeft) : '+' + dur(v.minutesLeft)}</td>`;
  $('#alerts').innerHTML = (o.overtime.length || o.expiring.length) ? `<div class="tablewrap"><table><tr><th>Espacio</th><th>Vehículo</th><th>Folio</th><th>Tiempo</th><th>A cobrar</th></tr>${o.overtime.map(v => row(v) + `<td><span class="pill overtime">${money(v.amountDue)}</span></td></tr>`).join('')}${o.expiring.map(v => row(v) + '<td><span class="pill expiring">por vencer</span></td></tr>').join('')}</table></div>` : '<p class="muted">Sin alertas.</p>';
  $('#upcoming').innerHTML = o.upcoming.length ? `<table><tr><th>Espacio</th><th>Vehículo</th><th>Folio</th><th>Libera en</th></tr>${o.upcoming.map(v => row(v) + '</tr>').join('')}</table>` : '<p class="muted">Ningún espacio se libera en la próxima hora.</p>';
  const a = await api('/admin/analytics'), mx = Math.max(...a.byHour, 1);
  $('#ana').innerHTML = `<div class="stats"><div class="stat"><b>${a.occupancyPct}%</b><span>ocupación actual</span></div><div class="stat"><b>${dur(a.avgMinutes)}</b><span>estancia promedio</span></div><div class="stat"><b>${money(a.revenue.total)}</b><span>ingresos (uso ${money(a.revenue.usage)} · membresías ${money(a.revenue.memberships)})</span></div><div class="stat"><b>${money(a.revenue.overdue)}</b><span>cobrado por exceso de tiempo</span></div></div>
    <div class="muted small">Entradas por hora del día (pico: ${a.peakHour}:00 h)</div><div class="bars">${a.byHour.map((n, h) => `<div class="${h === a.peakHour ? 'pk' : ''}" style="height:${Math.round((n / mx) * 100)}%" title="${h}:00 — ${n} entradas"></div>`).join('')}</div><div class="hours">${a.byHour.map((_, h) => `<span>${h % 3 ? '' : h}</span>`).join('')}</div>`;
};
async function exitFlow(confirmIt) {
  $('#x-err').textContent = '';
  try {
    const body = { code: $('#x-code').value.trim() || undefined, plate: $('#x-plate').value.trim() || undefined, confirm: confirmIt };
    const r = await api('/admin/exit', { method: 'POST', body }), s = r.session;
    if (r.closed) {
      $('#x-res').innerHTML = `<p><b>Salida registrada.</b> Espacio ${s.spaceLabel} liberado.</p>`; $('#x-code').value = $('#x-plate').value = '';
      await adminView.tick(); return;
    }
    $('#x-res').innerHTML = `<div class="card" style="background:var(--paper)"><p>${TYPE[s.type]} <b>${esc(s.plate)}</b> · ${s.spaceLabel}<br>Estancia: ${dur(s.elapsedMinutes)} · ${s.state === 'overtime' ? 'excedido ' + dur(s.minutesLeft) : s.state === 'member' ? 'membresía' : 'dentro del tiempo pagado'}</p>
      <p class="price">${s.amountDue ? 'Cobrar ' + money(s.amountDue) : 'Sin adeudo'}</p><button id="x-ok">${s.amountDue ? 'Cobrado, permitir salida' : 'Permitir salida'}</button></div>`;
    $('#x-ok').onclick = () => exitFlow(true);
  } catch (e) { $('#x-err').textContent = e.message; $('#x-res').innerHTML = ''; }
}

route();
