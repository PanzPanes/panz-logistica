const CAP = 110;
const COLORES = ['#D85A30','#1D9E75','#378ADD','#BA7517','#D4537E','#639922','#534AB7','#5F5E5A'];

let modo = 'exp';
let locales = [];
let productos = [
  { id: 'emb', nombre: 'Embudo', color: '#D85A30' },
  { id: 'ham', nombre: 'Hamburguesa', color: '#1D9E75' },
  { id: 'cha', nombre: 'Chavata', color: '#378ADD' },
];
let pedidos = {};
let vueltas = [];
let vueltaActiva = 0;
let entregas = {};
let tiempoReal = null;

// ─── STORAGE ───
function fechaHoy() { return new Date().toISOString().slice(0, 10); }

function guardarStorage() {
  try {
    localStorage.setItem('panz-locales', JSON.stringify(locales));
    localStorage.setItem('panz-productos', JSON.stringify(productos));
    localStorage.setItem('panz-dia-' + fechaHoy(), JSON.stringify({ pedidos, vueltas, entregas, tiempoReal }));
    toast();
  } catch(e) { console.error('Error guardando:', e); }
}

function cargarStorage() {
  try { const r = localStorage.getItem('panz-locales'); if (r) locales = JSON.parse(r); } catch(e) {}
  try { const r = localStorage.getItem('panz-productos'); if (r) productos = JSON.parse(r); } catch(e) {}
  try {
    const r = localStorage.getItem('panz-dia-' + fechaHoy());
    if (r) { const d = JSON.parse(r); pedidos = d.pedidos||{}; vueltas = d.vueltas||[]; entregas = d.entregas||{}; tiempoReal = d.tiempoReal||null; }
  } catch(e) {}
  renderDia(); renderLocales(); renderProductos(); renderMetricas();
}

function toast() {
  const t = document.getElementById('saving-toast');
  t.className = 'saving show';
  setTimeout(() => t.className = 'saving', 1800);
}

// ─── NAVEGACIÓN ───
function toggleModo() {
  modo = modo === 'exp' ? 'rep' : 'exp';
  document.getElementById('screen-exp').className = 'screen' + (modo === 'exp' ? ' active' : '');
  document.getElementById('screen-rep').className = 'screen' + (modo === 'rep' ? ' active' : '');
  const btn = document.getElementById('modo-btn');
  btn.className = 'modo-badge ' + modo;
  btn.innerHTML = modo === 'exp'
    ? '<i class="ti ti-building-warehouse"></i> Expedición'
    : '<i class="ti ti-truck"></i> Repartidor';
  if (modo === 'rep') renderRepartidor();
}

function showTab(pantalla, idx) {
  const counts = { exp: 4, rep: 2 };
  for (let i = 0; i < counts[pantalla]; i++) {
    const el = document.getElementById(pantalla + '-tab-' + i);
    if (el) el.style.display = i === idx ? '' : 'none';
  }
  document.querySelectorAll('#screen-' + pantalla + ' .tab').forEach((t, i) => {
    t.className = 'tab' + (i === idx ? ' active' : '');
  });
  if (pantalla === 'exp') {
    if (idx === 0) renderDia();
    if (idx === 1) renderLocales();
    if (idx === 2) renderProductos();
    if (idx === 3) renderMetricas();
  }
  if (pantalla === 'rep' && idx === 0) renderRepartidor();
}

// ─── UTILIDADES ───
function dist(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
function tMin(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }
function mTime(m) { const h = Math.floor(m/60)%24, mn = m%60; return String(h).padStart(2,'0')+':'+String(mn).padStart(2,'0'); }
function totalCajones(vals) { return Object.values(vals||{}).reduce((s,v) => s+v, 0); }

function optimizar(lista) {
  if (!lista.length) return [];
  let rest = [...lista], ruta = [], actual = { lat: -31.41, lng: -64.19 }, mins = 0;
  while (rest.length) {
    let bi = 0, bs = Infinity;
    rest.forEach((l, i) => {
      const km = dist(actual, l), t = Math.round(km/25*60)+7;
      const llega = mins+t, abre = tMin(l.abre), cierra = tMin(l.cierra);
      const espera = llega < abre ? abre-llega : 0, pen = llega > cierra ? 9999 : 0;
      if (km + espera*.5 + pen < bs) { bs = km + espera*.5 + pen; bi = i; }
    });
    const sig = rest[bi], km = dist(actual, sig), t = Math.round(km/25*60)+7;
    mins += t;
    const llegaReal = Math.max(mins, tMin(sig.abre));
    ruta.push({ ...sig, llegada: mTime(llegaReal+660), minFinal: llegaReal+660, km: km.toFixed(1) });
    actual = sig; mins = llegaReal+10; rest.splice(bi, 1);
  }
  return ruta;
}

// ─── DÍA ───
function generarVueltas() {
  const ids = Object.keys(pedidos).map(Number);
  if (!ids.length) { alert('Tileá al menos un local con pedido.'); return; }
  const lista = ids.map(id => {
    const loc = locales.find(l => l.id === id);
    return { ...loc, cajones: totalCajones(pedidos[id]), pedido: pedidos[id] };
  });
  vueltas = [];
  let rest = [...lista];
  while (rest.length) {
    let vuelta = [], cap = 0;
    const sorted = [...rest].sort((a,b) => b.cajones - a.cajones);
    for (const l of sorted) { if (cap + l.cajones <= CAP) { vuelta.push(l); cap += l.cajones; } }
    if (!vuelta.length) { vuelta.push(rest[0]); cap = rest[0].cajones; }
    vueltas.push({ paradas: optimizar(vuelta), cajones: cap });
    const usados = new Set(vuelta.map(l => l.id));
    rest = rest.filter(l => !usados.has(l.id));
  }
  entregas = {}; tiempoReal = null;
  guardarStorage(); renderDia();
}

function renderDia() {
  const ids = Object.keys(pedidos).map(Number);
  const totalCaj = ids.reduce((s,id) => s + totalCajones(pedidos[id]), 0);
  document.getElementById('st-caj').textContent = totalCaj;
  document.getElementById('st-loc').textContent = ids.length;
  const nv = Math.ceil(totalCaj / CAP) || 0;
  document.getElementById('st-vueltas').textContent = nv === 0 ? '—' : nv === 1 ? '1 vuelta estimada' : nv + ' vueltas estimadas';
  const al = document.getElementById('exp-alertas');
  al.innerHTML = totalCaj > CAP ? `<div class="alert alert-w"><i class="ti ti-alert-triangle"></i> ${totalCaj} cajones — necesitás ${nv} vueltas</div>` : '';
  const vc = document.getElementById('vueltas-exp');
  vc.innerHTML = '';
  if (vueltas.length) {
    vueltas.forEach((v, i) => {
      const h = v.paradas.filter(p => entregas[p.id]).length;
      const pct = Math.round(h / v.paradas.length * 100);
      vc.innerHTML += `<div class="vuelta-hdr"><div><div class="vuelta-title"><i class="ti ti-truck"></i> Vuelta ${i+1}</div><div class="vuelta-sub">${v.paradas.length} paradas · ${v.cajones} cajones</div></div><span class="badge badge-o">${pct}% entregado</span></div><div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>`;
    });
  }
  const lista = document.getElementById('lista-dia');
  if (!locales.length) { lista.innerHTML = '<div class="empty">Primero agregá locales en la pestaña Locales</div>'; return; }
  if (!productos.length) { lista.innerHTML = '<div class="empty">Primero configurá los tipos de cajón en la pestaña Cajones</div>'; return; }
  lista.innerHTML = '';
  locales.forEach(loc => {
    const act = pedidos[loc.id];
    const vals = act || {};
    const n = productos.length, c = n <= 3 ? n : n <= 4 ? 2 : 3;
    lista.innerHTML += `<div class="card" style="${act ? 'border-color:var(--o);background:var(--ol)' : ''}">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <input type="checkbox" style="width:22px;height:22px;accent-color:var(--o);cursor:pointer;margin-top:2px;flex-shrink:0" ${act ? 'checked' : ''} onchange="togglePedido(${loc.id})">
        <div style="flex:1">
          <div class="card-nombre">${loc.nombre}</div>
          <div class="card-sub"><i class="ti ti-clock"></i> ${loc.abre}–${loc.cierra}</div>
          ${loc.deuda > 0 ? `<span class="badge badge-r" style="margin-top:5px;display:inline-block">${loc.deuda} cajones adeudados</span>` : ''}
          ${act ? `<div class="caja-grid" style="grid-template-columns:repeat(${c},1fr);margin-top:12px">
            ${productos.map(p => `<div class="caja-wrap">
              <div class="caja-label" style="color:${p.color}">${p.nombre}</div>
              <input class="caja-input" type="number" min="0" value="${vals[p.id]||0}" onchange="setCajon(${loc.id},'${p.id}',this.value)">
            </div>`).join('')}
          </div>` : ''}
        </div>
      </div>
    </div>`;
  });
}

function togglePedido(id) {
  if (pedidos[id]) { delete pedidos[id]; }
  else { const v = {}; productos.forEach(p => v[p.id] = 0); pedidos[id] = v; }
  guardarStorage(); renderDia();
}

function setCajon(id, pid, val) {
  if (!pedidos[id]) { const v = {}; productos.forEach(p => v[p.id] = 0); pedidos[id] = v; }
  pedidos[id][pid] = parseInt(val) || 0;
  document.getElementById('st-caj').textContent = Object.keys(pedidos).reduce((s,i) => s + totalCajones(pedidos[i]), 0);
  guardarStorage();
}

// ─── LOCALES ───
function renderLocales() {
  const lista = document.getElementById('lista-locales');
  if (!locales.length) { lista.innerHTML = '<div class="empty">No hay locales aún.<br>Tocá "+ Nuevo local" para empezar.</div>'; return; }
  lista.innerHTML = locales.map(l => `<div class="card">
    <div class="card-nombre">${l.nombre}</div>
    <div class="card-sub"><i class="ti ti-map-pin"></i> ${l.dir}</div>
    <div class="card-sub"><i class="ti ti-phone"></i> ${l.tel}</div>
    <div class="card-sub"><i class="ti ti-clock"></i> ${l.abre}–${l.cierra}</div>
    ${l.deuda > 0 ? `<div style="margin-top:6px"><span class="badge badge-r">${l.deuda} cajones adeudados</span></div>` : ''}
    <div class="card-actions">
      <button class="btn-sm" onclick="abrirModalLocal(${l.id})"><i class="ti ti-edit"></i> Editar</button>
      <button class="btn-sm btn-danger" onclick="eliminarLocal(${l.id})"><i class="ti ti-trash"></i></button>
    </div>
  </div>`).join('');
}

function abrirModalLocal(id) {
  if (id) {
    const l = locales.find(x => x.id === id);
    document.getElementById('ml-title').textContent = 'Editar local';
    document.getElementById('ml-id').value = id;
    document.getElementById('ml-nombre').value = l.nombre;
    document.getElementById('ml-dir').value = l.dir;
    document.getElementById('ml-tel').value = l.tel;
    document.getElementById('ml-abre').value = l.abre;
    document.getElementById('ml-cierra').value = l.cierra;
    document.getElementById('ml-deuda').value = l.deuda || 0;
  } else {
    document.getElementById('ml-title').textContent = 'Nuevo local';
    document.getElementById('ml-id').value = '';
    ['ml-nombre','ml-dir','ml-tel'].forEach(f => document.getElementById(f).value = '');
    document.getElementById('ml-abre').value = '08:00';
    document.getElementById('ml-cierra').value = '14:00';
    document.getElementById('ml-deuda').value = '0';
  }
  document.getElementById('modal-local').className = 'modal-overlay open';
}

function guardarLocal() {
  const id = document.getElementById('ml-id').value;
  const nombre = document.getElementById('ml-nombre').value.trim();
  const dir = document.getElementById('ml-dir').value.trim();
  if (!nombre || !dir) { alert('Nombre y dirección son obligatorios.'); return; }
  const d = {
    nombre, dir,
    tel: document.getElementById('ml-tel').value,
    abre: document.getElementById('ml-abre').value,
    cierra: document.getElementById('ml-cierra').value,
    deuda: parseInt(document.getElementById('ml-deuda').value) || 0,
    lat: -31.41 + (Math.random()-.5)*.06,
    lng: -64.19 + (Math.random()-.5)*.06,
  };
  if (id) { locales = locales.map(l => l.id === Number(id) ? { ...l, ...d } : l); }
  else { locales.push({ id: Date.now(), ...d }); }
  cerrarModal('local'); guardarStorage(); renderLocales(); renderDia();
}

function eliminarLocal(id) {
  if (!confirm('¿Eliminar este local?')) return;
  locales = locales.filter(l => l.id !== id);
  delete pedidos[id];
  guardarStorage(); renderLocales(); renderDia();
}

// ─── PRODUCTOS ───
function renderProductos() {
  const lista = document.getElementById('lista-productos');
  if (!productos.length) { lista.innerHTML = '<div class="empty">No hay tipos de cajón.<br>Agregá al menos uno.</div>'; return; }
  lista.innerHTML = productos.map(p => `<div class="prod-item">
    <div class="prod-color" style="background:${p.color}"></div>
    <div class="prod-nombre">${p.nombre}</div>
    <div class="card-actions">
      <button class="btn-sm" onclick="abrirModalProducto('${p.id}')"><i class="ti ti-edit"></i></button>
      <button class="btn-sm btn-danger" onclick="eliminarProducto('${p.id}')"><i class="ti ti-trash"></i></button>
    </div>
  </div>`).join('');
}

function abrirModalProducto(id) {
  const picker = document.getElementById('color-picker');
  picker.innerHTML = COLORES.map(c => `<div onclick="selColor('${c}')" id="cp-${c.replace('#','')}" style="width:32px;height:32px;border-radius:50%;background:${c};cursor:pointer;border:3px solid transparent;transition:border .15s"></div>`).join('');
  if (id) {
    const p = productos.find(x => x.id === id);
    document.getElementById('mp-title').textContent = 'Editar tipo de cajón';
    document.getElementById('mp-id').value = id;
    document.getElementById('mp-nombre').value = p.nombre;
    document.getElementById('mp-color').value = p.color;
    selColor(p.color);
  } else {
    document.getElementById('mp-title').textContent = 'Nuevo tipo de cajón';
    document.getElementById('mp-id').value = '';
    document.getElementById('mp-nombre').value = '';
    document.getElementById('mp-color').value = COLORES[0];
    selColor(COLORES[0]);
  }
  document.getElementById('modal-producto').className = 'modal-overlay open';
}

function selColor(c) {
  document.getElementById('mp-color').value = c;
  COLORES.forEach(col => {
    const el = document.getElementById('cp-' + col.replace('#',''));
    if (el) el.style.border = col === c ? '3px solid #1a1a1a' : '3px solid transparent';
  });
}

function guardarProducto() {
  const id = document.getElementById('mp-id').value;
  const nombre = document.getElementById('mp-nombre').value.trim();
  const color = document.getElementById('mp-color').value;
  if (!nombre) { alert('El nombre es obligatorio.'); return; }
  if (id) { productos = productos.map(p => p.id === id ? { ...p, nombre, color } : p); }
  else { productos.push({ id: 'prod_' + Date.now(), nombre, color }); }
  cerrarModal('producto'); guardarStorage(); renderProductos(); renderDia();
}

function eliminarProducto(id) {
  if (productos.length <= 1) { alert('Debe haber al menos un tipo de cajón.'); return; }
  if (!confirm('¿Eliminar este tipo de cajón?')) return;
  productos = productos.filter(p => p.id !== id);
  Object.keys(pedidos).forEach(lid => { if (pedidos[lid]) delete pedidos[lid][id]; });
  guardarStorage(); renderProductos(); renderDia();
}

function cerrarModal(tipo) {
  document.getElementById('modal-' + tipo).className = 'modal-overlay';
}

// ─── REPARTIDOR ───
function renderRepartidor() {
  const hdr = document.getElementById('rep-hdr');
  const prog = document.getElementById('rep-prog');
  const par = document.getElementById('rep-paradas');
  if (!vueltas.length) {
    hdr.innerHTML = ''; prog.innerHTML = '';
    par.innerHTML = '<div class="empty">Expedición aún no generó las vueltas del día.<br><br>Tileá los locales y tocá "Generar vueltas".</div>';
    return;
  }
  const v = vueltas[vueltaActiva];
  const h = v.paradas.filter(p => entregas[p.id]).length;
  const pct = Math.round(h / v.paradas.length * 100);
  hdr.innerHTML = `<div class="vuelta-hdr"><div><div class="vuelta-title"><i class="ti ti-truck"></i> Vuelta ${vueltaActiva+1} de ${vueltas.length}</div><div class="vuelta-sub">${v.paradas.length} paradas · ${v.cajones} cajones · Salida 11:00</div></div>${vueltas.length > 1 ? `<button class="btn-sm" onclick="cambiarVuelta()">Vuelta ${vueltaActiva===0?2:1}</button>` : ''}</div>`;
  prog.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text2);margin-bottom:4px"><span>${h} de ${v.paradas.length} entregadas</span><span>${pct}%</span></div><div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>`;
  par.innerHTML = v.paradas.map((p, i) => {
    const done = entregas[p.id];
    const ent = done || {};
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.dir)}`;
    const totalEnt = done ? Object.values(ent.entregados||{}).reduce((s,v)=>s+v,0) : 0;
    const totalRec = done ? Object.values(ent.recuperados||{}).reduce((s,v)=>s+v,0) : 0;
    return `<div class="parada-row" style="${done ? 'opacity:.6' : ''}">
      <div class="parada-num ${done ? 'done' : ''}">${done ? '<i class="ti ti-check"></i>' : i+1}</div>
      <div class="parada-body">
        <div class="parada-nombre">${p.nombre}</div>
        <div class="parada-sub"><i class="ti ti-map-pin"></i> ${p.dir}</div>
        <div class="parada-sub"><i class="ti ti-phone"></i> <a href="tel:${p.tel}" style="color:var(--o);font-weight:600">${p.tel}</a></div>
        <div class="parada-sub"><i class="ti ti-clock"></i> ${p.abre}–${p.cierra}</div>
        ${done ? `<div style="margin-top:6px;font-size:13px;color:var(--v);font-weight:500"><i class="ti ti-check"></i> Entregados: ${totalEnt} · Recuperados: ${totalRec}</div>` : ''}
        <div class="card-actions" style="margin-top:10px">
          ${!done ? `<button class="btn-v btn-sm" onclick="abrirEntrega(${p.id})"><i class="ti ti-package"></i> Registrar entrega</button>` : ''}
          <a href="${mapsUrl}" target="_blank"><button class="btn-sm"><i class="ti ti-map-2"></i> Abrir Maps</button></a>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="parada-hora">${p.llegada}</div>
        <div style="font-size:12px;color:var(--text2)">${p.km} km</div>
      </div>
    </div>`;
  }).join('');
}

function cambiarVuelta() {
  vueltaActiva = vueltaActiva === 0 ? 1 : 0;
  renderRepartidor();
}

function abrirEntrega(localId) {
  const loc = locales.find(l => l.id === localId);
  document.getElementById('me-title').textContent = 'Entrega: ' + loc.nombre;
  document.getElementById('me-id').value = localId;
  const pedido = pedidos[localId] || {};
  const n = productos.length, c = n <= 3 ? n : n <= 4 ? 2 : 3;
  const colStyle = `grid-template-columns:repeat(${c},1fr)`;
  const mkGrid = (prefijo, vals) => productos.map(p => `<div class="caja-wrap">
    <div class="caja-label" style="color:${p.color}">${p.nombre}</div>
    <input class="caja-input" type="number" min="0" id="${prefijo}-${p.id}" value="${vals[p.id]||0}">
  </div>`).join('');
  document.getElementById('me-entregados').style.cssText = colStyle;
  document.getElementById('me-entregados').innerHTML = mkGrid('e', pedido);
  document.getElementById('me-recuperados').style.cssText = colStyle;
  document.getElementById('me-recuperados').innerHTML = mkGrid('r', {});
  document.getElementById('modal-entrega').className = 'modal-overlay open';
}

function confirmarEntrega() {
  const id = Number(document.getElementById('me-id').value);
  const entregados = {}, recuperados = {};
  productos.forEach(p => {
    entregados[p.id] = parseInt(document.getElementById('e-'+p.id).value) || 0;
    recuperados[p.id] = parseInt(document.getElementById('r-'+p.id).value) || 0;
  });
  const totalEnt = Object.values(entregados).reduce((s,v) => s+v, 0);
  const totalRec = Object.values(recuperados).reduce((s,v) => s+v, 0);
  entregas[id] = { entregados, recuperados };
  const diff = totalEnt - totalRec;
  const idx = locales.findIndex(l => l.id === id);
  if (idx >= 0) locales[idx].deuda = Math.max(0, (locales[idx].deuda||0) + diff);
  cerrarModal('entrega'); guardarStorage(); renderRepartidor(); renderDia();
}

function cerrarVuelta() {
  const hora = document.getElementById('hora-llegada').value;
  const durReal = tMin(hora) - tMin('11:00');
  tiempoReal = durReal;
  const v = vueltas[vueltaActiva];
  const ultima = v.paradas[v.paradas.length-1];
  const durEst = ultima ? ultima.minFinal - 660 + 15 : 0;
  const efic = Math.round(durEst / durReal * 100);
  document.getElementById('cierre-resultado').innerHTML = `<div class="alert alert-v" style="margin-top:12px"><i class="ti ti-check"></i> Vuelta cerrada · Real: ${durReal} min · Estimado: ${durEst} min · Eficiencia: ${efic}%</div>`;
  guardarStorage(); renderMetricas();
}

// ─── MÉTRICAS ───
function renderMetricas() {
  let ent = 0, rec = 0;
  Object.values(entregas).forEach(e => {
    ent += Object.values(e.entregados||{}).reduce((s,v) => s+v, 0);
    rec += Object.values(e.recuperados||{}).reduce((s,v) => s+v, 0);
  });
  document.getElementById('m-ent').textContent = ent;
  document.getElementById('m-rec').textContent = rec;
  const v = vueltas.length && vueltas[0].paradas.length ? vueltas[0].paradas[vueltas[0].paradas.length-1] : null;
  const est = v ? v.minFinal - 660 + 15 : 0;
  document.getElementById('m-test').textContent = est || '—';
  document.getElementById('m-treal').textContent = tiempoReal || '—';
  if (tiempoReal && est) {
    document.getElementById('m-efic').textContent = 'Eficiencia: ' + Math.round(est/tiempoReal*100) + '%';
  }
  const deudas = locales.filter(l => l.deuda > 0);
  document.getElementById('m-deudas').innerHTML = deudas.length
    ? deudas.map(l => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div><div class="card-nombre">${l.nombre}</div><div class="card-sub">${l.tel}</div></div>
        <span class="badge badge-r">${l.deuda} cajones</span>
      </div>`).join('')
    : '<div class="empty" style="padding:20px">Sin adeudos pendientes</div>';
}

// ─── INIT ───
cargarStorage();
