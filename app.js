const SUPABASE_URL = 'https://rtatriliypqbidkzckvn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0YXRyaWxpeXBxYmlka3pja3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjA4MTYsImV4cCI6MjA5NDMzNjgxNn0.d6w6WW7B0dqw7MHUhEiD4HKkWB4n3cjN_Ie-5NzLdaY';

const CAP = 110;
const COLORES = ['#D85A30','#1D9E75','#378ADD','#BA7517','#D4537E','#639922','#534AB7','#5F5E5A'];
const FABRICA_DIR = 'Panz Panificadora, Córdoba, Argentina';

let modo = 'exp';
let locales = [];
let productos = [];
let pedidos = {};
let vueltas = [];
let vueltaActiva = 0;
let entregas = {};
let tiempoReal = null;
let diaId = null;

// ─── SUPABASE ───
async function sb(path, options = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': options.prefer !== undefined ? options.prefer : 'return=representation',
      ...options.headers
    },
    ...options
  });
  if (!res.ok) { console.error('Supabase error:', await res.text()); return null; }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function sbGet(t, q='') { return sb(t+(q?'?'+q:'')); }
async function sbPost(t, b) { return sb(t, {method:'POST', body:JSON.stringify(b)}); }
async function sbPatch(t, q, b) { return sb(t+'?'+q, {method:'PATCH', body:JSON.stringify(b)}); }
async function sbDelete(t, q) { return sb(t+'?'+q, {method:'DELETE', prefer:''}); }

// ─── GEOCODIFICACIÓN ───
async function geocodificar(direccion) {
  try {
    const query = encodeURIComponent(direccion + ', Argentina');
    const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=ar`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'es', 'User-Agent': 'PanzLogistica/1.0' } });
    const data = await res.json();
    if (data && data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), ok: true };
  } catch(e) { console.error('Geocodificando:', e); }
  return { lat: -31.4135 + (Math.random()-.5)*.02, lng: -64.1934 + (Math.random()-.5)*.02, ok: false };
}

// ─── GOOGLE MAPS URL ───
function buildMapsUrl(origen, paradas) {
  // Formato: /maps/dir/origen/parada1/parada2/.../destino
  const puntos = [origen, ...paradas].map(p => encodeURIComponent(p)).join('/');
  return `https://www.google.com/maps/dir/${puntos}`;
}

function abrirRutaMaps(paradas) {
  if (!paradas.length) return;
  const dirs = paradas.map(p => p.dir);
  if (dirs.length <= 10) {
    // Una sola ruta
    window.open(buildMapsUrl(FABRICA_DIR, dirs), '_blank');
  } else {
    // Dividir en dos grupos
    const mid = Math.ceil(dirs.length / 2);
    const grupo1 = dirs.slice(0, mid);
    const grupo2 = dirs.slice(mid);
    window.open(buildMapsUrl(FABRICA_DIR, grupo1), '_blank');
    setTimeout(() => window.open(buildMapsUrl(grupo1[grupo1.length-1], grupo2), '_blank'), 500);
  }
}

// ─── INIT ───
function fechaHoy() { return new Date().toISOString().slice(0,10); }

async function iniciar() {
  mostrarCargando(true);
  try {
    const prods = await sbGet('productos','order=created_at.asc');
    productos = (prods && prods.length) ? prods : [{id:'emb',nombre:'Embudo',color:'#D85A30'},{id:'ham',nombre:'Hamburguesa',color:'#1D9E75'},{id:'cha',nombre:'Chavata',color:'#378ADD'}];
    const locs = await sbGet('locales','order=nombre.asc');
    locales = locs || [];
    const hoy = fechaHoy();
    const dias = await sbGet('dias','fecha=eq.'+hoy);
    if (dias && dias.length) {
      const d=dias[0]; diaId=d.id; pedidos=d.pedidos||{}; vueltas=d.vueltas||[]; entregas=d.entregas||{}; tiempoReal=d.tiempo_real||null;
    } else {
      const nuevo = await sbPost('dias',{fecha:hoy,pedidos:{},vueltas:[],entregas:{}});
      if (nuevo&&nuevo.length) diaId=nuevo[0].id;
    }
  } catch(e) { console.error('Error iniciando:',e); }
  mostrarCargando(false);
  renderDia(); renderLocales(); renderProductos(); renderMetricas();
}

function mostrarCargando(show) {
  document.getElementById('loading').style.display = show ? 'flex' : 'none';
}

function toast(msg='Guardado') {
  const t=document.getElementById('saving-toast');
  t.innerHTML='<i class="ti ti-device-floppy"></i> '+msg;
  t.className='saving show';
  setTimeout(()=>t.className='saving',2000);
}

async function guardarDia() {
  if(!diaId) return;
  await sbPatch('dias','id=eq.'+diaId,{pedidos,vueltas,entregas,tiempo_real:tiempoReal});
  toast();
}

// ─── NAVEGACIÓN ───
function toggleModo() {
  modo=modo==='exp'?'rep':'exp';
  document.getElementById('screen-exp').className='screen'+(modo==='exp'?' active':'');
  document.getElementById('screen-rep').className='screen'+(modo==='rep'?' active':'');
  const btn=document.getElementById('modo-btn');
  btn.className='modo-badge '+modo;
  btn.innerHTML=modo==='exp'?'<i class="ti ti-building-warehouse"></i> Expedición':'<i class="ti ti-truck"></i> Repartidor';
  if(modo==='rep') renderRepartidor();
}

function showTab(pantalla,idx) {
  const counts={exp:4,rep:2};
  for(let i=0;i<counts[pantalla];i++){const el=document.getElementById(pantalla+'-tab-'+i);if(el)el.style.display=i===idx?'':'none';}
  document.querySelectorAll('#screen-'+pantalla+' .tab').forEach((t,i)=>t.className='tab'+(i===idx?' active':''));
  if(pantalla==='exp'){if(idx===0)renderDia();if(idx===1)renderLocales();if(idx===2)renderProductos();if(idx===3)renderMetricas();}
  if(pantalla==='rep'&&idx===0)renderRepartidor();
}

// ─── UTILS ───
function totalCajones(vals){return Object.values(vals||{}).reduce((s,v)=>s+v,0);}
function tMin(t){const[h,m]=t.split(':').map(Number);return h*60+m;}
function dist(a,b){const dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180,x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function mTime(m){const h=Math.floor(m/60)%24,mn=m%60;return String(h).padStart(2,'0')+':'+String(mn).padStart(2,'0');}

// ─── DÍA ─── (Expedición)
function generarVueltas() {
  const ids=Object.keys(pedidos).map(Number);
  if(!ids.length){alert('Tileá al menos un local con pedido.');return;}
  const lista=ids.map(id=>{
    const loc=locales.find(l=>l.id===id);
    return{...loc,cajones:totalCajones(pedidos[id])};
  });
  vueltas=[];
  let rest=[...lista];
  while(rest.length){
    let vuelta=[],cap=0;
    const sorted=[...rest].sort((a,b)=>b.cajones-a.cajones);
    for(const l of sorted){if(cap+l.cajones<=CAP){vuelta.push(l);cap+=l.cajones;}}
    if(!vuelta.length){vuelta.push(rest[0]);cap=rest[0].cajones;}
    vueltas.push({paradas:vuelta,cajones:cap});
    const usados=new Set(vuelta.map(l=>l.id));
    rest=rest.filter(l=>!usados.has(l.id));
  }
  entregas={};tiempoReal=null;
  guardarDia();renderDia();
}

function renderDia(){
  const ids=Object.keys(pedidos).map(Number);
  const totalCaj=ids.reduce((s,id)=>s+totalCajones(pedidos[id]),0);
  document.getElementById('st-caj').textContent=totalCaj;
  document.getElementById('st-loc').textContent=ids.length;
  const nv=Math.ceil(totalCaj/CAP)||0;
  document.getElementById('st-vueltas').textContent=nv===0?'—':nv===1?'1 vuelta estimada':nv+' vueltas estimadas';
  document.getElementById('exp-alertas').innerHTML=totalCaj>CAP?`<div class="alert alert-w"><i class="ti ti-alert-triangle"></i> ${totalCaj} cajones — se necesitan ${nv} vueltas</div>`:'';

  const vc=document.getElementById('vueltas-exp');vc.innerHTML='';
  if(vueltas.length){
    vueltas.forEach((v,i)=>{
      const h=v.paradas.filter(p=>entregas[p.id]).length,pct=v.paradas.length?Math.round(h/v.paradas.length*100):0;
      vc.innerHTML+=`<div class="vuelta-hdr"><div><div class="vuelta-title"><i class="ti ti-truck"></i> Vuelta ${i+1}</div><div class="vuelta-sub">${v.paradas.length} paradas · ${v.cajones} cajones</div></div><span class="badge badge-o">${pct}% entregado</span></div><div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>`;
    });
  }

  const lista=document.getElementById('lista-dia');
  if(!locales.length){lista.innerHTML='<div class="empty">Primero agregá locales en la pestaña Locales</div>';return;}
  if(!productos.length){lista.innerHTML='<div class="empty">Configurá los tipos de cajón en la pestaña Cajones</div>';return;}
  lista.innerHTML='';
  locales.forEach(loc=>{
    const act=pedidos[loc.id],vals=act||{},n=productos.length,c=n<=3?n:n<=4?2:3;
    lista.innerHTML+=`<div class="card" style="${act?'border-color:var(--o);background:var(--ol)':''}">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <input type="checkbox" style="width:22px;height:22px;accent-color:var(--o);cursor:pointer;margin-top:2px;flex-shrink:0" ${act?'checked':''} onchange="togglePedido(${loc.id})">
        <div style="flex:1">
          <div class="card-nombre">${loc.nombre}</div>
          <div class="card-sub"><i class="ti ti-map-pin"></i> ${loc.dir}</div>
          <div class="card-sub"><i class="ti ti-clock"></i> ${loc.abre}–${loc.cierra}</div>
          ${loc.deuda>0?`<span class="badge badge-r" style="margin-top:5px;display:inline-block">${loc.deuda} cajones adeudados</span>`:''}
          ${act?`<div class="caja-grid" style="grid-template-columns:repeat(${c},1fr);margin-top:12px">${productos.map(p=>`<div class="caja-wrap"><div class="caja-label" style="color:${p.color}">${p.nombre}</div><input class="caja-input" type="number" min="0" value="${vals[p.id]||0}" onchange="setCajon(${loc.id},'${p.id}',this.value)"></div>`).join('')}</div>`:''}
        </div>
      </div>
    </div>`;
  });
}

function togglePedido(id){
  if(pedidos[id]){delete pedidos[id];}
  else{const v={};productos.forEach(p=>v[p.id]=0);pedidos[id]=v;}
  guardarDia();renderDia();
}
function setCajon(id,pid,val){
  if(!pedidos[id]){const v={};productos.forEach(p=>v[p.id]=0);pedidos[id]=v;}
  pedidos[id][pid]=parseInt(val)||0;
  document.getElementById('st-caj').textContent=Object.keys(pedidos).reduce((s,i)=>s+totalCajones(pedidos[i]),0);
  guardarDia();
}

// ─── LOCALES ───
function renderLocales(){
  const lista=document.getElementById('lista-locales');
  if(!locales.length){lista.innerHTML='<div class="empty">No hay locales aún.<br>Tocá "+ Nuevo local" para empezar.</div>';return;}
  lista.innerHTML=locales.map(l=>`<div class="card">
    <div class="card-nombre">${l.nombre}</div>
    <div class="card-sub"><i class="ti ti-map-pin"></i> ${l.dir}</div>
    <div class="card-sub"><i class="ti ti-phone"></i> ${l.tel||'—'}</div>
    <div class="card-sub"><i class="ti ti-clock"></i> ${l.abre}–${l.cierra}</div>
    ${l.deuda>0?`<div style="margin-top:6px"><span class="badge badge-r">${l.deuda} cajones adeudados</span></div>`:''}
    <div class="card-actions">
      <button class="btn-sm" onclick="abrirModalLocal(${l.id})"><i class="ti ti-edit"></i> Editar</button>
      <button class="btn-sm btn-danger" onclick="eliminarLocal(${l.id})"><i class="ti ti-trash"></i></button>
    </div>
  </div>`).join('');
}

function abrirModalLocal(id){
  if(id){
    const l=locales.find(x=>x.id===id);
    document.getElementById('ml-title').textContent='Editar local';
    document.getElementById('ml-id').value=id;
    document.getElementById('ml-nombre').value=l.nombre;
    document.getElementById('ml-dir').value=l.dir;
    document.getElementById('ml-tel').value=l.tel||'';
    document.getElementById('ml-abre').value=l.abre;
    document.getElementById('ml-cierra').value=l.cierra;
    document.getElementById('ml-deuda').value=l.deuda||0;
  } else {
    document.getElementById('ml-title').textContent='Nuevo local';
    document.getElementById('ml-id').value='';
    ['ml-nombre','ml-dir','ml-tel'].forEach(f=>document.getElementById(f).value='');
    document.getElementById('ml-abre').value='08:00';
    document.getElementById('ml-cierra').value='14:00';
    document.getElementById('ml-deuda').value='0';
  }
  document.getElementById('modal-local').className='modal-overlay open';
}

async function guardarLocal(){
  const id=document.getElementById('ml-id').value;
  const nombre=document.getElementById('ml-nombre').value.trim();
  const dir=document.getElementById('ml-dir').value.trim();
  if(!nombre||!dir){alert('Nombre y dirección son obligatorios.');return;}
  const btn=document.querySelector('#modal-local .btn-p');
  btn.textContent='Buscando ubicación...';btn.disabled=true;
  const coords=await geocodificar(dir);
  const d={nombre,dir,tel:document.getElementById('ml-tel').value,abre:document.getElementById('ml-abre').value,cierra:document.getElementById('ml-cierra').value,deuda:parseInt(document.getElementById('ml-deuda').value)||0,lat:coords.lat,lng:coords.lng};
  if(id){await sbPatch('locales','id=eq.'+id,d);locales=locales.map(l=>l.id===Number(id)?{...l,...d}:l);}
  else{const res=await sbPost('locales',d);if(res&&res.length)locales.push(res[0]);}
  btn.textContent='Guardar';btn.disabled=false;
  cerrarModal('local');toast(coords.ok?'Local guardado ✓':'Local guardado');renderLocales();renderDia();
}

async function eliminarLocal(id){
  if(!confirm('¿Eliminar este local?'))return;
  await sbDelete('locales','id=eq.'+id);
  locales=locales.filter(l=>l.id!==id);delete pedidos[id];
  guardarDia();renderLocales();renderDia();
}

// ─── PRODUCTOS ───
function renderProductos(){
  const lista=document.getElementById('lista-productos');
  if(!productos.length){lista.innerHTML='<div class="empty">No hay tipos de cajón.</div>';return;}
  lista.innerHTML=productos.map(p=>`<div class="prod-item"><div class="prod-color" style="background:${p.color}"></div><div class="prod-nombre">${p.nombre}</div><div class="card-actions"><button class="btn-sm" onclick="abrirModalProducto('${p.id}')"><i class="ti ti-edit"></i></button><button class="btn-sm btn-danger" onclick="eliminarProducto('${p.id}')"><i class="ti ti-trash"></i></button></div></div>`).join('');
}

function abrirModalProducto(id){
  const picker=document.getElementById('color-picker');
  picker.innerHTML=COLORES.map(c=>`<div onclick="selColor('${c}')" id="cp-${c.replace('#','')}" style="width:32px;height:32px;border-radius:50%;background:${c};cursor:pointer;border:3px solid transparent;transition:border .15s"></div>`).join('');
  if(id){const p=productos.find(x=>x.id===id);document.getElementById('mp-title').textContent='Editar tipo de cajón';document.getElementById('mp-id').value=id;document.getElementById('mp-nombre').value=p.nombre;document.getElementById('mp-color').value=p.color;selColor(p.color);}
  else{document.getElementById('mp-title').textContent='Nuevo tipo de cajón';document.getElementById('mp-id').value='';document.getElementById('mp-nombre').value='';document.getElementById('mp-color').value=COLORES[0];selColor(COLORES[0]);}
  document.getElementById('modal-producto').className='modal-overlay open';
}
function selColor(c){document.getElementById('mp-color').value=c;COLORES.forEach(col=>{const el=document.getElementById('cp-'+col.replace('#',''));if(el)el.style.border=col===c?'3px solid #1a1a1a':'3px solid transparent';});}

async function guardarProducto(){
  const id=document.getElementById('mp-id').value,nombre=document.getElementById('mp-nombre').value.trim(),color=document.getElementById('mp-color').value;
  if(!nombre){alert('El nombre es obligatorio.');return;}
  if(id){await sbPatch('productos','id=eq.'+id,{nombre,color});productos=productos.map(p=>p.id===id?{...p,nombre,color}:p);}
  else{const newId='prod_'+Date.now();await sbPost('productos',{id:newId,nombre,color});productos.push({id:newId,nombre,color});}
  cerrarModal('producto');toast('Cajón guardado');renderProductos();renderDia();
}

async function eliminarProducto(id){
  if(productos.length<=1){alert('Debe haber al menos un tipo de cajón.');return;}
  if(!confirm('¿Eliminar este tipo de cajón?'))return;
  await sbDelete('productos','id=eq.'+id);
  productos=productos.filter(p=>p.id!==id);
  Object.keys(pedidos).forEach(lid=>{if(pedidos[lid])delete pedidos[lid][id];});
  guardarDia();renderProductos();renderDia();
}

function cerrarModal(tipo){document.getElementById('modal-'+tipo).className='modal-overlay';}

// ─── REPARTIDOR ───
function renderRepartidor(){
  const hdr=document.getElementById('rep-hdr'),prog=document.getElementById('rep-prog'),par=document.getElementById('rep-paradas');

  if(!vueltas.length){
    hdr.innerHTML='';prog.innerHTML='';
    par.innerHTML='<div class="empty">Expedición aún no generó las vueltas del día.<br><br>Tileá los locales y tocá "Generar vueltas".</div>';
    return;
  }

  const v=vueltas[vueltaActiva];
  const paradasHechas=v.paradas.filter(p=>entregas[p.id]).length;
  const pct=Math.round(paradasHechas/v.paradas.length*100);
  const todasListas=v.paradas.every(p=>!entregas[p.id]);

  // Header con botón de Maps
  const dirs=v.paradas.map(p=>p.dir);
  let mapsBtn='';
  if(dirs.length<=10){
    const url=buildMapsUrl(FABRICA_DIR,dirs);
    mapsBtn=`<a href="${url}" target="_blank"><button class="btn-v btn-sm"><i class="ti ti-map-2"></i> Abrir ruta en Maps</button></a>`;
  } else {
    const mid=Math.ceil(dirs.length/2);
    const url1=buildMapsUrl(FABRICA_DIR,dirs.slice(0,mid));
    const url2=buildMapsUrl(FABRICA_DIR,dirs.slice(mid));
    mapsBtn=`
      <a href="${url1}" target="_blank"><button class="btn-v btn-sm"><i class="ti ti-map-2"></i> Maps — Parte 1</button></a>
      <a href="${url2}" target="_blank"><button class="btn-v btn-sm"><i class="ti ti-map-2"></i> Maps — Parte 2</button></a>`;
  }

  hdr.innerHTML=`
    <div class="vuelta-hdr">
      <div>
        <div class="vuelta-title"><i class="ti ti-truck"></i> Vuelta ${vueltaActiva+1} de ${vueltas.length}</div>
        <div class="vuelta-sub">${v.paradas.length} paradas · ${v.cajones} cajones · Salida 11:00</div>
      </div>
      ${vueltas.length>1?`<button class="btn-sm" onclick="cambiarVuelta()">Vuelta ${vueltaActiva===0?2:1}</button>`:''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${mapsBtn}</div>`;

  prog.innerHTML=`<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text2);margin-bottom:4px"><span>${paradasHechas} de ${v.paradas.length} entregadas</span><span>${pct}%</span></div><div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>`;

  par.innerHTML=v.paradas.map((p,i)=>{
    const done=entregas[p.id],ent=done||{};
    const totalEnt=done?Object.values(ent.entregados||{}).reduce((s,v)=>s+v,0):0;
    const totalRec=done?Object.values(ent.recuperados||{}).reduce((s,v)=>s+v,0):0;
    return `<div class="parada-row" style="${done?'opacity:.55':''}">
      <div class="parada-num ${done?'done':''}">${done?'<i class="ti ti-check"></i>':i+1}</div>
      <div class="parada-body">
        <div class="parada-nombre">${p.nombre}</div>
        <div class="parada-sub"><i class="ti ti-map-pin"></i> ${p.dir}</div>
        <div class="parada-sub"><i class="ti ti-phone"></i> <a href="tel:${p.tel}" style="color:var(--o);font-weight:600">${p.tel||'—'}</a></div>
        <div class="parada-sub"><i class="ti ti-clock"></i> ${p.abre}–${p.cierra}</div>
        ${done?`<div style="margin-top:6px;font-size:13px;color:var(--v);font-weight:500"><i class="ti ti-check"></i> Entregados: ${totalEnt} · Recuperados: ${totalRec}</div>`:''}
        <div class="card-actions" style="margin-top:10px">
          ${!done?`<button class="btn-v btn-sm" onclick="abrirEntrega(${p.id})"><i class="ti ti-package"></i> Registrar entrega</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function cambiarVuelta(){vueltaActiva=vueltaActiva===0?1:0;renderRepartidor();}

function abrirEntrega(localId){
  const loc=locales.find(l=>l.id===localId);
  document.getElementById('me-title').textContent='Entrega: '+loc.nombre;
  document.getElementById('me-id').value=localId;
  const pedido=pedidos[localId]||{},n=productos.length,c=n<=3?n:n<=4?2:3;
  const mkGrid=(pre,vals)=>productos.map(p=>`<div class="caja-wrap"><div class="caja-label" style="color:${p.color}">${p.nombre}</div><input class="caja-input" type="number" min="0" id="${pre}-${p.id}" value="${vals[p.id]||0}"></div>`).join('');
  document.getElementById('me-entregados').style.cssText=`grid-template-columns:repeat(${c},1fr)`;
  document.getElementById('me-entregados').innerHTML=mkGrid('e',pedido);
  document.getElementById('me-recuperados').style.cssText=`grid-template-columns:repeat(${c},1fr)`;
  document.getElementById('me-recuperados').innerHTML=mkGrid('r',{});
  document.getElementById('modal-entrega').className='modal-overlay open';
}

async function confirmarEntrega(){
  const id=Number(document.getElementById('me-id').value);
  const entregados={},recuperados={};
  productos.forEach(p=>{entregados[p.id]=parseInt(document.getElementById('e-'+p.id).value)||0;recuperados[p.id]=parseInt(document.getElementById('r-'+p.id).value)||0;});
  const totalEnt=Object.values(entregados).reduce((s,v)=>s+v,0);
  const totalRec=Object.values(recuperados).reduce((s,v)=>s+v,0);
  entregas[id]={entregados,recuperados};
  const diff=totalEnt-totalRec,idx=locales.findIndex(l=>l.id===id);
  if(idx>=0){locales[idx].deuda=Math.max(0,(locales[idx].deuda||0)+diff);await sbPatch('locales','id=eq.'+id,{deuda:locales[idx].deuda});}
  cerrarModal('entrega');await guardarDia();renderRepartidor();renderDia();
}

async function cerrarVuelta(){
  const hora=document.getElementById('hora-llegada').value;
  const durReal=tMin(hora)-tMin('11:00');tiempoReal=durReal;
  const v=vueltas[vueltaActiva],ultima=v.paradas[v.paradas.length-1];
  const durEst=120; // estimado fijo base hasta tener historial
  const efic=Math.round(durEst/durReal*100);
  document.getElementById('cierre-resultado').innerHTML=`<div class="alert alert-v" style="margin-top:12px"><i class="ti ti-check"></i> Vuelta cerrada · Tiempo real: ${durReal} min · Eficiencia registrada: ${efic}%</div>`;
  await guardarDia();renderMetricas();
}

// ─── MÉTRICAS ───
function renderMetricas(){
  let ent=0,rec=0;
  Object.values(entregas).forEach(e=>{ent+=Object.values(e.entregados||{}).reduce((s,v)=>s+v,0);rec+=Object.values(e.recuperados||{}).reduce((s,v)=>s+v,0);});
  document.getElementById('m-ent').textContent=ent;
  document.getElementById('m-rec').textContent=rec;
  document.getElementById('m-test').textContent='—';
  document.getElementById('m-treal').textContent=tiempoReal?tiempoReal+' min':'—';
  if(tiempoReal)document.getElementById('m-efic').textContent='Tiempo registrado';
  const deudas=locales.filter(l=>l.deuda>0);
  document.getElementById('m-deudas').innerHTML=deudas.length
    ?deudas.map(l=>`<div class="card" style="display:flex;justify-content:space-between;align-items:center"><div><div class="card-nombre">${l.nombre}</div><div class="card-sub">${l.tel||'—'}</div></div><span class="badge badge-r">${l.deuda} cajones</span></div>`).join('')
    :'<div class="empty" style="padding:20px">Sin adeudos pendientes</div>';
}

iniciar();
