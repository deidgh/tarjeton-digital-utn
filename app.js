/* Tarjetón UTN - frontend sin secretos. Seguridad real: Supabase RLS + Edge Functions. */
'use strict';
const $=s=>document.querySelector(s);
const clean=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cfg=window.TARJETON_CONFIG||{};
const live=Boolean(cfg.supabaseUrl&&cfg.supabasePublishableKey);
const demo=cfg.demo===true&&!live;
let api=null;
const DEMO_KEY='utn_permisos_demo_v3';
const demoBase=[
 {id:'demo01',owner_id:'demo-student',folio:'DEMO-0243',full_name:'Estudiante de prueba',enrollment:'202600243',department:'Tecnologías de la Información',category:'Estudiante',vehicle_make:'Honda',vehicle_model:'CB190R',license_plate:'ABC-123-D',expires_on:'2027-08-31',status:'vigente'},
 {id:'demo02',owner_id:'demo-other',folio:'DEMO-0168',full_name:'Usuario de ejemplo',enrollment:'202600168',department:'Mecatrónica',category:'Estudiante',vehicle_make:'Italika',vehicle_model:'FT150',license_plate:'XYZ-789-A',expires_on:'2027-08-31',status:'suspendido'}
];
let demoRecords=(()=>{try{let d=JSON.parse(localStorage.getItem(DEMO_KEY));return Array.isArray(d)&&d.length?d:structuredClone(demoBase)}catch{return structuredClone(demoBase)}})();
let state={user:null,profile:null,demoRole:null,selectedRole:null,tab:'permisos',qr:null,qrTick:null,qrNext:null,scanner:null,scanFrame:null,tokenIssuedAt:0,qrRetryAt:0,qrRequest:null,route:0};
function saveDemo(){localStorage.setItem(DEMO_KEY,JSON.stringify(demoRecords))}
function notify(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.classList.remove('show'),3600)}
function dateMX(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function validPermit(p){return p&&p.status==='vigente'&&p.expires_on>=dateMX()}
function statusOf(p){if(!p)return 'No encontrado';return p.status==='vigente'&&p.expires_on<dateMX()?'Vencido':({vigente:'Vigente',vencido:'Vencido',inactivo:'Inactivo',suspendido:'Suspendido',cancelado:'Cancelado'}[p.status]||'No disponible')}
function statusLabel(p){const s=statusOf(p);return `<span class="pill ${s==='Vigente'?'good':'bad'}"><span class="dot"></span>${clean(s)}</span>`}
function put(html){$('#root').innerHTML=html}
function spinner(){put('<div class="loading"><div class="spinner"></div><p>Consultando información...</p></div>')}
function stopQr(){if(state.qrTick){clearInterval(state.qrTick);state.qrTick=null}state.qr=null;state.tokenIssuedAt=0;state.qrRetryAt=0;state.qrRequest=null}
function stopScan(){if(state.scanFrame){cancelAnimationFrame(state.scanFrame);state.scanFrame=null}if(state.scanner){state.scanner.getTracks().forEach(t=>t.stop());state.scanner=null}}
function cleanup(){stopQr();stopScan()}
function footerStatus(){const b=$('#modeBadge');b.classList.toggle('live',!!api);b.textContent=api?'CONECTADO A SUPABASE':live?'SIN CONEXIÓN A SUPABASE':demo?'MODO DEMOSTRACIÓN':'SERVICIO SIN CONFIGURAR'}
function bird(){return `<svg class="bird" viewBox="0 0 140 140" aria-hidden="true"><path fill="#e3c393" d="M36 24 69 36l54-29-29 48 17 15-39 18-17 42-18-31L6 73l44 6-14-55Zm30 39-13 14 15 20 12-30-14-4Z"/><circle cx="78" cy="55" r="5" fill="#fff4e4"/></svg>`}
function cardMarkup(p,compact=false){const s=statusOf(p);return `<article class="permit-card" aria-label="Tarjetón de estacionamiento: ${clean(p.folio)}">
 <div class="card-top"><div class="card-logo"><img src="./assets/logo-small.png" alt="Escudo UTN"><strong>UNIVERSIDAD TECNOLÓGICA<br>DE NEZAHUALCÓYOTL</strong></div><span>ESTACIONAMIENTO</span></div>
 <div class="decor"></div><div class="permit-title">TARJETÓN DIGITAL · FOLIO</div><div class="folio">${clean(p.folio)}</div>
 <div class="permit-identity">
 <div class="permit-portrait">${p.photo_url? `<img src="${clean(p.photo_url)}" alt="Fotografía del titular">` : '<span>Sin foto</span>'}</div>
 <div><div class="permit-owner">${clean(p.full_name||'Información protegida')}</div>
 <div class="permit-meta">${clean([p.category,p.department].filter(Boolean).join(' · '))}</div>
 <div class="permit-meta">Matrícula o ID ${clean(p.enrollment||'—')}</div></div></div>
 <div class="permit-bottom"><div><small>Vehículo</small><strong>${clean([p.vehicle_make,p.vehicle_model].filter(Boolean).join(' ')||'Información reservada')}</strong></div><div><small>Placas</small><strong>${clean(p.license_plate||p.plate_mask||'••••')}</strong></div><div><small>Vigencia hasta</small><strong>${clean(p.expires_on||'—')}</strong></div><div><small>Estado actual</small><strong>${clean(s)}</strong></div></div>
 ${p.folio?.startsWith('DEMO-')?'<div class="watermark">DEMOSTRACIÓN</div>':''}${bird()}<div class="card-foot"><span>Estado de México · UTN</span><b>${compact?'VALIDACIÓN':'CREDENCIAL DIGITAL'}</b></div>
 </article>`}
function sessionRole(){return state.demoRole||(state.profile?.active?state.profile.role:null)}
function logged(){return !!sessionRole()}
function roleName(role){return {student:'Titular',guard:'Vigilancia',admin:'Administración'}[role]||'Usuario'}
function sessionHeading(title,desc){return `<div class="dashboard-top"><div><div class="eyebrow">PLATAFORMA ACADÉMICA · ${clean(roleName(sessionRole()))}</div><h1>${clean(title)}</h1><p>${clean(desc)}</p></div><div class="dashboard-actions"><button id="homeBtn" class="outline-btn">Inicio</button><button id="signOut" class="soft-btn">Cerrar sesión</button></div></div>`}
function wireSession(){const so=$('#signOut');if(so)so.onclick=signOut;const h=$('#homeBtn');if(h)h.onclick=()=>{location.hash='#/inicio';renderRoute()}}
// La pantalla de selección es SIEMPRE la portada; la URL de verificación QR es una excepción.
const entryRoles=[
 {id:'student',symbol:'🎓',title:'Voy a ingresar al estacionamiento',subtitle:'Alumno o docente con tarjetón autorizado',action:'Mostrar mi tarjetón'},
 {id:'guard',symbol:'🛡️',title:'Soy personal de vigilancia',subtitle:'Verificar códigos QR y vigencias de los permisos',action:'Verificar un tarjetón'},
 {id:'admin',symbol:'⚙️',title:'Soy administrador',subtitle:'Registrar personas, vehículos y controlar accesos',action:'Administrar el sistema'}
];
function home(){
 put(`<section class="entry-shell" aria-labelledby="entry-title"><div class="entry-heading"><img class="entry-logo" src="./assets/logo-utn.png" alt="Escudo de la Universidad Tecnológica de Nezahualcóyotl"><div class="eyebrow">UNIVERSIDAD TECNOLÓGICA DE NEZAHUALCÓYOTL</div><h1 id="entry-title">Bienvenido al sistema de estacionamiento</h1><p>Selecciona cómo vas a utilizar el tarjetón digital.</p><div class="entry-caption">ACCESO INSTITUCIONAL · PROTOTIPO ACADÉMICO</div></div>
 <div class="entry-role-grid">${entryRoles.map(r=>`<button type="button" class="entry-role" data-pick-role="${r.id}"><span class="entry-role-symbol" aria-hidden="true">${r.symbol}</span><span class="entry-role-copy"><strong>${clean(r.title)}</strong><small>${clean(r.subtitle)}</small><span class="entry-role-action">${clean(r.action)} <span aria-hidden="true">→</span></span></span></button>`).join('')}</div>
 <p class="entry-notice">${live?'El acceso a cada perfil se valida con una cuenta autorizada.':demo?'Estás explorando una demostración. Los perfiles y tarjetones son ficticios.':'El servicio de inicio de sesión está pendiente de configuración.'}</p>
 ${api&&state.user?'<div class="entry-existing">Hay una sesión iniciada. Si necesitas utilizar otra cuenta, <button type="button" class="link-button" id="entrySignOut">cierra la sesión</button>.</div>':''}
 </section>`);
 document.querySelectorAll('[data-pick-role]').forEach(b=>b.addEventListener('click',()=>chooseRole(b.dataset.pickRole)));
 const so=$('#entrySignOut');if(so)so.onclick=signOut;
}
function chooseRole(role){
 if(!entryRoles.some(r=>r.id===role))return;
 state.selectedRole=role;
 if(!demo){
  if(!api){notify('El acceso con cuenta aún no está configurado.');return}
  if(state.user&&state.profile?.active){
   if(state.profile.role===role){location.hash='#/panel';renderRoute();return}
   notify('Tu sesión tiene otro perfil. Cierra sesión para ingresar con otra cuenta.');return;
  }
  location.hash='#/ingresar';renderRoute();return;
 }
 state.demoRole=role;state.tab='permisos';location.hash='#/panel';renderRoute();
}
function loginForm(inline=false,role=state.selectedRole){
 const spec=entryRoles.find(r=>r.id===role)||entryRoles[1];
 return `<section class="${inline?'':'login-panel'} panel login-entry"><div class="eyebrow">ACCESO AL SISTEMA · ${clean(roleName(spec.id))}</div><div class="login-role-head"><span class="login-role-symbol">${spec.symbol}</span><div><h2>${clean(spec.title)}</h2><p>${api?'Ingresa con las credenciales que te proporcionó la administración.':'Selecciona un perfil para continuar en el prototipo.'}</p></div></div>
 ${api?`<form id="loginForm"><div class="field"><label class="label" for="email">Correo electrónico</label><input id="email" type="email" autocomplete="username" placeholder="correo@ejemplo.com" required></div><div class="field"><label class="label" for="password">Contraseña</label><input id="password" type="password" autocomplete="current-password" required minlength="6"></div><button class="primary-btn btn-block" type="submit">Ingresar como ${clean(roleName(spec.id))}</button><div id="loginMessage" role="alert"></div></form>`:
 `<div class="role-actions"><button type="button" data-role="${clean(spec.id)}">Entrar en modo demostración</button></div><div class="message warn">Modo de prueba sin autenticación. No ingreses datos personales.</div>`}
 ${inline?'':'<button type="button" id="backToRoles" class="outline-btn btn-block login-back">← Elegir otro perfil</button>'}
 </section>`
}
function showLogin(role=state.selectedRole){
 if(!entryRoles.some(r=>r.id===role)){home();return}
 state.selectedRole=role;
 const heading=`<div class="page-heading login-heading"><div class="eyebrow">IDENTIFICACIÓN DE USUARIO</div><h1>Inicio de sesión</h1><p>El acceso está limitado a personas autorizadas por la universidad.</p></div>`;
 put(heading+loginForm(false,role));bindLogin(role);
 const back=$('#backToRoles');if(back)back.onclick=()=>{state.selectedRole=null;location.hash='#/inicio';renderRoute()};
}
function bindLogin(role=state.selectedRole){
 const allowed=entryRoles.find(r=>r.id===role)?.id||'guard';
 if(api){
  const f=$('#loginForm');if(!f)return;
  f.onsubmit=async e=>{
   e.preventDefault();const btn=f.querySelector('button[type=submit]');btn.disabled=true;
   try{
    const {data,error}=await api.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
    if(error)throw error;
    state.user=data.user;await fetchProfile();
    if(!state.profile?.active||(state.profile.role!==allowed&&!(allowed==='guard'&&state.profile.role==='admin'&&location.hash.startsWith('#/verificar/')))){
     await api.auth.signOut();state.user=null;state.profile=null;
     throw Error('Tu cuenta no tiene permiso para ingresar con este perfil.');
    }
    if(location.hash.startsWith('#/verificar/')){renderRoute()}
    else{location.hash='#/panel';renderRoute()}
   }catch(e){const msg=$('#loginMessage');if(msg)msg.innerHTML='<div class="message error">'+clean(e.message||'No se pudo iniciar sesión.')+'</div>'}
   finally{btn.disabled=false}
  };
 }else{
  document.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>{
   state.demoRole=b.dataset.role;state.selectedRole=b.dataset.role;state.tab='permisos';
   if(location.hash.startsWith('#/verificar/'))renderRoute();
   else{location.hash='#/panel';renderRoute()}
  });
 }
}
async function invoke(name, body){
 const {data,error}=await api.functions.invoke(name,{body});
 if(error){
  const detail=await error.context?.json?.().catch(()=>null);
  throw Error(detail?.error||'Servicio temporalmente no disponible.');
 }
 return data;
}
async function fetchProfile(){if(!api||!state.user){state.profile=null;return}const {data,error}=await api.from('profiles').select('id,full_name,email,role,active,enrollment,department').eq('id',state.user.id).maybeSingle();state.profile=error?null:data}
async function signOut(){cleanup();if(api)await api.auth.signOut();state.user=null;state.profile=null;state.demoRole=null;state.selectedRole=null;location.hash='#/inicio';renderRoute()}
async function getMyPermits(){
 if(!api)return demoRecords.filter(permit=>permit.owner_id==='demo-student');
 const {data,error}=await api.from('permits').select('*').eq('owner_id',state.user.id)
  .order('created_at',{ascending:false});
 if(error)throw error;
 return data;
}
async function studentPanel(){
 const route=state.route;
 spinner();
 try{
  const permits=await getMyPermits();
  let photo;
  if(api&&permits.length){
   const {data}=await api.storage.from('permit-portraits').createSignedUrl(state.user.id+'.webp',60);
   photo=data?.signedUrl;
  }
  if(route!==state.route)return;
  if(!permits.length){
   put(sessionHeading('Mi tarjetón','Estacionamiento UTN')+'<div class="panel empty">Aún no tienes un tarjetón asignado. Contacta a administración.</div>');
   wireSession();
   return;
  }
  const initial=permits.find(validPermit)||permits[0];
  showStudentPermit(permits,initial,photo);
 }catch{
  if(route!==state.route)return;
  put(sessionHeading('Mi tarjetón','Estacionamiento UTN')+'<div class="message error">No se pudo consultar la base de datos.</div>');
  wireSession();
 }
}
async function showStudentPermit(permits, selected, photo){
 stopQr();
 const route=state.route;
 const permit={...selected,photo_url:photo};
 if(api)Object.assign(permit,{
  full_name:state.profile.full_name,enrollment:state.profile.enrollment,department:state.profile.department,
 });
 put(`${sessionHeading('Mi tarjetón digital','Muestra tu credencial al personal de vigilancia.')}
  ${permits.length>1?`<label class="field"><span class="label">Elegir tarjetón</span>
   <select id="myPermit">${permits.map(p=>`<option value="${clean(p.id)}" ${p.id===permit.id?'selected':''}>${clean(p.folio+' · '+p.license_plate)}</option>`).join('')}</select></label>`:''}
  <div class="layout-two"><div>${cardMarkup(permit)}</div>
  <section class="panel qr-panel"><h2>Código QR temporal</h2><p>Vigilancia puede escanearlo con la cámara de su teléfono.</p>
  <div class="qr-box" id="qrBox"><span class="helper">Generando…</span></div>
  <div class="countdown" id="qrCountdown">—</div><p class="qr-caption">Tiempo de vigencia</p>
  <div class="progress"><span id="qrProgress"></span></div><button class="soft-btn btn-block" id="refreshQr">Actualizar código</button>
  <p id="qrMessage" class="helper" role="status"></p></section></div>`);
 wireSession();
 const select=$('#myPermit');
 if(select)select.onchange=()=>showStudentPermit(permits,permits.find(p=>p.id===select.value),photo);
 const button=$('#refreshQr');
 button.onclick=()=>issueQr(permit);
 if(!validPermit(permit)){
  $('#qrBox').textContent='Permiso sin vigencia';
  $('#qrCountdown').textContent='No disponible';
  button.disabled=true;
  return;
 }
 startQrTimer(permit);
 if(route!==state.route)stopQr();
}
function drawQr(url){const target=$('#qrBox');if(!target)return;target.innerHTML='';if(window.QRCode){new window.QRCode(target,{text:url,width:174,height:174,colorDark:'#142a27',colorLight:'#ffffff',correctLevel:window.QRCode.CorrectLevel.M})}else{const s=document.createElement('div');s.className='helper';s.innerHTML='No se pudo cargar el generador QR.<br>Abre el enlace de verificación:';target.append(s);const a=document.createElement('a');a.href=url;a.textContent='Abrir verificación';a.style.overflowWrap='anywhere';target.append(a)}}
async function issueQr(permit){
 if(state.qrRequest)return;
 const request={};
 const startedAt=Date.now();
 state.qrRequest=request;
 const button=$('#refreshQr');
 if(button)button.disabled=true;
 try{
  const data=api?await invoke('permit-qr',{action:'issue',permit_id:permit.id}):{
   token:`demo~${encodeURIComponent(permit.folio)}~${Date.now()+90000}`,
   expires_at:new Date(Date.now()+90000).toISOString(),issued_at:new Date().toISOString(),
  };
  if(state.qrRequest!==request)return;
  const duration=Date.parse(data.expires_at)-Date.parse(data.issued_at);
  state.qr={expiresAt:startedAt+duration};
  state.tokenIssuedAt=startedAt;
  state.qrRetryAt=0;
  const url=new URL(window.location.href);
  url.search='';
  url.hash='#/verificar/'+encodeURIComponent(data.token);
  drawQr(url.toString());
  $('#qrMessage').textContent=api?'Código emitido por el servidor.':'Código de demostración.';
 }catch(e){
  if(state.qrRequest!==request)return;
  state.qrRetryAt=Date.now()+5000;
  $('#qrMessage').textContent=e.message;
 }finally{
  if(state.qrRequest===request)state.qrRequest=null;
  if(button)button.disabled=false;
 }
}
function startQrTimer(permit){
 const tick=()=>{
  const countdown=$('#qrCountdown');
  if(!countdown)return;
  const now=Date.now();
  const remaining=Math.max(0,Math.ceil(((state.qr?.expiresAt||0)-now)/1000));
  countdown.textContent=remaining?`${remaining} s`:'Sin código vigente';
  countdown.classList.toggle('danger',remaining<20);
  $('#qrProgress').style.width=`${remaining/90*100}%`;
  if(!remaining)$('#qrBox').textContent='Esperando un código vigente…';
  if(now>=state.qrRetryAt&&now-state.tokenIssuedAt>=60000)issueQr(permit);
 };
 tick();
 state.qrTick=setInterval(tick,1000);
}
async function guardPanel(){put(`${sessionHeading('Verificar un tarjetón','Escanea el código del estudiante o introduce el token que aparece en su enlace de verificación.')}<div class="layout-two"><section class="panel"><div class="eyebrow">CONTROL DE ACCESO</div><h2>Verificación en tiempo real</h2><p>Un permiso suspendido, vencido o con QR caducado debe rechazarse.</p><form id="verifyForm"><div class="field"><label class="label" for="verifyToken">Token del QR o enlace</label><input id="verifyToken" placeholder="Pega el código o el enlace de verificación" required></div><div class="flex"><button class="primary-btn" type="submit">Consultar permiso</button><button class="outline-btn" id="startCamera" type="button">Usar cámara</button></div></form><video class="scanner-video" id="scannerVideo" playsinline muted hidden></video><div id="cameraNote" class="helper" style="margin-top:10px"></div><div class="message">También puedes usar la cámara normal del teléfono: al leer un QR, abrirá esta aplicación directamente en la página de validación.</div></section><section class="panel"><h2>Resultado</h2><div id="guardResult" class="empty">Aquí aparecerá la información verificada.</div></section></div>`);
 wireSession();$('#verifyForm').onsubmit=async e=>{e.preventDefault();const raw=$('#verifyToken').value.trim();let token=raw;try{if(raw.includes('#/verificar/'))token=decodeURIComponent(raw.split('#/verificar/')[1].split('?')[0])}catch{}await checkToken(token,'#guardResult')};$('#startCamera').onclick=scanCamera}
async function scanCamera(){
 const note=$('#cameraNote'), video=$('#scannerVideo'), button=$('#startCamera');
 if(!navigator.mediaDevices?.getUserMedia){
  note.textContent='Usa la cámara del teléfono o pega el enlace del QR.';
  return;
 }
 if(state.scanner){
  stopScan();
  video.hidden=true;
  button.textContent='Usar cámara';
  note.textContent='';
  return;
 }
 const route=state.route;
 button.disabled=true;
 try{
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  if(route!==state.route){stream.getTracks().forEach(track=>track.stop());return;}
  state.scanner=stream;
  video.srcObject=stream;
  video.hidden=false;
  await video.play();
  const canvas=document.createElement('canvas'), context=canvas.getContext('2d',{willReadFrequently:true});
  let lastFrame=0;
  button.textContent='Detener cámara';
  note.textContent='Apunta la cámara hacia el QR.';
  const scan=async time=>{
   if(state.scanner!==stream)return;
   if(time-lastFrame>=180&&video.videoWidth){
    lastFrame=time;
    const scale=Math.min(1,640/video.videoWidth);
    canvas.width=Math.round(video.videoWidth*scale);
    canvas.height=Math.round(video.videoHeight*scale);
    context.drawImage(video,0,0,canvas.width,canvas.height);
    const frame=context.getImageData(0,0,canvas.width,canvas.height);
    const raw=window.UTN?.scanQR(frame.data,frame.width,frame.height)?.data;
    let token=raw;
    try{if(raw?.includes('#/verificar/'))token=decodeURIComponent(raw.split('#/verificar/')[1])}catch{}
    if(token&&(/^[a-f0-9]{64}$/.test(token)||(demo&&token.startsWith('demo~')))){
     stopScan();
     video.hidden=true;
     button.textContent='Usar cámara';
     note.textContent='Código leído.';
     $('#verifyToken').value=token;
     await checkToken(token,'#guardResult');
     return;
    }
   }
   state.scanFrame=requestAnimationFrame(scan);
  };
  state.scanFrame=requestAnimationFrame(scan);
 }catch{
  if(route===state.route){stopScan();video.hidden=true;note.textContent='No se pudo abrir la cámara. Revisa sus permisos.';}
 }finally{button.disabled=false;}
}
async function checkToken(token,selector){const t=$(selector);if(!t)return;t.innerHTML='<div class="loading"><div class="spinner"></div><p>Validando en el sistema...</p></div>';let v;try{if(api){v=await invoke('permit-qr',{action:'verify',token})}else{const parts=token.split('~');const exp=Number(parts[2]);const folio=decodeURIComponent(parts[1]||'');const p=demoRecords.find(x=>x.folio===folio);v=parts[0]==='demo'&&Number.isFinite(exp)&&exp>Date.now()&&p?{found:true,valid:validPermit(p),status:statusOf(p).toLowerCase(),permit:{...p},demo:true}:{found:false,valid:false,error:'QR no encontrado o caducado',demo:true}}
 }catch(e){t.innerHTML='<div class="message error">No fue posible consultar el servicio de verificación. '+clean(e.message)+'</div>';return}
 if(!v?.found){t.innerHTML='<div class="message error"><strong>QR inválido o vencido</strong><br>Solicita al estudiante abrir su aplicación y generar un nuevo código.</div>';return}
 const p=v.permit||{};const vStatus=v.valid?'vigente':(v.status||'suspendido');const complete=!!p.full_name;t.innerHTML=`<div class="result-card"><div class="result-top"><h3>${v.valid?'Permiso verificado':'Permiso no autorizado'}</h3><span class="pill ${v.valid?'good':'bad'}"><span class="dot"></span>${v.valid?'Vigente':clean(vStatus)}</span></div><p class="helper">${v.demo?'SIMULACIÓN — NO VÁLIDA PARA INGRESAR.':'Resultado consultado al servidor. No se basa en capturas de pantalla.'}</p><div class="details-grid">${[['Folio',p.folio],['Nombre',p.full_name||'Acceso reservado a vigilancia'],['Vehículo',[p.vehicle_make,p.vehicle_model].filter(Boolean).join(' ')||'Acceso reservado'],['Placas',p.license_plate||p.plate_mask||'Reservadas'],['Vigencia',p.expires_on||'—'],['Estado',vStatus]].map(([label,val])=>`<div><small>${clean(label)}</small><strong>${clean(val)}</strong></div>`).join('')}</div></div>${complete?`<div style="margin-top:15px">${cardMarkup({...p,status:vStatus},true)}</div>`:''}${!complete?'<div class="message">Por privacidad, inicia sesión como vigilante para ver todos los datos del tarjetón.</div>':''}`;
}
async function verificationPage(token){
 const staff=['guard','admin'].includes(sessionRole());
 const actions=staff?`<button class="outline-btn" id="reloadVerify">Volver a comprobar</button>
  <button class="soft-btn" id="signOut">Cerrar sesión</button>`:logged()?
  '<button class="soft-btn" id="switchStaff">Cerrar sesión para entrar como vigilante</button>':loginForm(true,'guard');
 put(`<div class="page-heading"><h1>Verificación del tarjetón</h1><p>Consulta para vigilancia y administración.</p></div>
  <div class="layout-two"><section class="panel" id="publicResult">${staff?'Consultando…':'Inicia sesión para consultar este código.'}</section>
  <div>${actions}</div></div>`);
 if(staff){
  wireSession();
  $('#reloadVerify').onclick=()=>checkToken(token,'#publicResult');
  await checkToken(token,'#publicResult');
 }else if(logged()){
  $('#switchStaff').onclick=async()=>{
   if(api)await api.auth.signOut({scope:'local'});
   state.user=null;state.profile=null;state.demoRole=null;
   renderRoute();
  };
 }else if(api||demo)bindLogin('guard');
}
const permitFields=[
 ['folio','Folio del tarjetón físico','text',30],
 ['vehicle_make','Marca del vehículo','text',60],
 ['vehicle_model','Modelo del vehículo','text',60],
 ['license_plate','Placas','text',30],
 ['expires_on','Vigencia hasta','date'],
];
const profileFields=[
 ['full_name','Nombre completo','text',100],
 ['enrollment','Matrícula o identificador','text',70],
 ['department','Carrera o departamento','text',100],
];
function fieldsMarkup(fields, values={}){
 return fields.map(([name,label,type,max])=>`<label class="field"><span class="label">${label}</span>
  <input name="${name}" type="${type}" ${max?`maxlength="${max}"`:''} value="${clean(values[name]||'')}" required></label>`).join('');
}
function permitFieldsMarkup(permit={}){
 return `<div class="field-group">${fieldsMarkup(permitFields,permit)}
  <label class="field"><span class="label">Tipo de permiso</span><select name="category">
  <option>Estudiante</option><option ${permit.category==='Docente'?'selected':''}>Docente</option></select></label>
  </div>`;
}
function portraitMarkup(){
 return '<label class="field"><span class="label">Fotografía del titular</span><input type="file" name="portrait" accept="image/jpeg,image/png,image/webp"></label>';
}
function permitValues(form){
 return {
  folio:form.get('folio').trim().toUpperCase(),
  vehicle_make:form.get('vehicle_make').trim(), vehicle_model:form.get('vehicle_model').trim(),
  license_plate:form.get('license_plate').trim().toUpperCase(), expires_on:form.get('expires_on'),
  category:form.get('category'),
 };
}
async function savePortrait(accountId,file){
 if(!file?.size)return;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024){
  throw Error('Selecciona una foto JPG, PNG o WebP de hasta 8 MB.');
 }
 const image=await createImageBitmap(file);
 const canvas=document.createElement('canvas');
 const ratio=Math.min(1,480/Math.max(image.width,image.height));
 canvas.width=Math.max(1,Math.round(image.width*ratio));
 canvas.height=Math.max(1,Math.round(image.height*ratio));
 canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
 image.close();
 const photo=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.86));
 if(photo?.type!=='image/webp')throw Error('No se pudo procesar la fotografía.');
 const {error}=await api.storage.from('permit-portraits').upload(accountId+'.webp',photo,{
  upsert:true,contentType:'image/webp',cacheControl:'0',
 });
 if(error)throw Error('No se pudo guardar la fotografía.');
}
function renderPermitEditor(permit, owner){
 const target=$('#adminEditor');
 target.innerHTML=`<section class="panel edit-panel"><h2>${permit?'Editar tarjetón': 'Asignar tarjetón'} · ${clean(owner.full_name||'Titular')}</h2>
  <form>${permitFieldsMarkup(permit||{})}${api?portraitMarkup():''}
  <button class="primary-btn">Guardar tarjetón</button><p role="alert"></p></form></section>`;
 target.scrollIntoView({block:'nearest'});
 const form=target.querySelector('form');
 form.onsubmit=async event=>{
  event.preventDefault();
  const data=new FormData(form);
  const fields=permitValues(data);
  const button=form.querySelector('button');
  button.disabled=true;
  try{
   if(api){
    const query=api.from('permits');
    const change=permit?query.update(fields).eq('id',permit.id):query.insert({...fields,owner_id:owner.id});
    const {error}=await change.select('id').single();
    if(error)throw Error(error.code==='23505'?'El folio o las placas ya existen.':error.message);
    try{await savePortrait(owner.id,data.get('portrait'));}
    catch(error){notify('Tarjetón guardado. '+error.message);adminPanel();return;}
   }else{
    Object.assign(permit,fields);
    saveDemo();
   }
   notify('Tarjetón guardado.');
   adminPanel();
  }catch(error){form.querySelector('p').textContent=error.message;}
  finally{button.disabled=false;}
 };
}
function renderProfileEditor(profile){
 const target=$('#adminEditor');
 target.innerHTML=`<section class="panel edit-panel"><h2>Editar cuenta</h2><form>
  <div class="field-group">${fieldsMarkup(profileFields,profile)}</div>
  ${profile.role==='admin'?'':`<label class="field"><input type="checkbox" name="active" ${profile.active?'checked':''}> Cuenta habilitada</label>`}
  ${profile.role==='student'?portraitMarkup():''}
  <button class="primary-btn">Guardar cuenta</button><p role="alert"></p></form></section>`;
 target.scrollIntoView({block:'nearest'});
 const form=target.querySelector('form');
 form.onsubmit=async event=>{
  event.preventDefault();
  const button=form.querySelector('button');
  button.disabled=true;
  const data=new FormData(form);
  const fields=Object.fromEntries(profileFields.map(([name])=>[name,data.get(name).trim()]));
  if(profile.role!=='admin')fields.active=data.has('active');
  try{
   const {error}=await api.from('profiles').update(fields).eq('id',profile.id).select('id').single();
   if(error)throw Error(error.code==='23505'?'La matrícula ya está registrada.':error.message);
   try{await savePortrait(profile.id,data.get('portrait'));}
   catch(error){notify('Cuenta guardada. '+error.message);adminPanel();return;}
   notify('Cuenta guardada.');
   adminPanel();
  }catch(error){form.querySelector('p').textContent=error.message;}
  finally{button.disabled=false;}
 };
}
async function adminPanel(){
 const route=state.route, tab=state.tab;
 const request={};
 state.adminRequest=request;
 let records=demoRecords, profiles=[], events=[];
 spinner();
 try{
  if(api){
   const [permits,people,history]=await Promise.all([
    api.from('permits').select('*').order('created_at',{ascending:false}),
    api.from('profiles').select('id,full_name,email,enrollment,role,active,department').order('full_name'),
    tab==='historial'?api.from('verification_events').select('id,result,checked_at,permit_id,actor_id')
      .order('checked_at',{ascending:false}).limit(100):{data:[]},
   ]);
   const error=permits.error||people.error||history.error;
   if(error)throw error;
   records=permits.data;
   profiles=people.data;
   events=history.data;
  }
 }catch(error){
  if(route!==state.route||request!==state.adminRequest)return;
  put(sessionHeading('Administración de permisos','Consulta de registros')+`<div class="message error">${clean(error.message)}</div>`);
  wireSession();
  return;
 }
 if(route!==state.route||request!==state.adminRequest)return;
 const owners=new Map(profiles.map(profile=>[profile.id,profile]));
 const folios=new Map(records.map(permit=>[permit.id,permit.folio]));
 const tabs=[['permisos','Tarjetones'],['altas','Registrar usuario']];
 if(api)tabs.push(['usuarios','Usuarios'],['historial','Verificaciones']);
 let body;
 if(tab==='permisos'){
  body=`<h2>Directorio de tarjetones</h2>${records.length?`<div class="table-scroll"><table class="records">
   <thead><tr><th>Folio</th><th>Titular</th><th>Vehículo y placas</th><th>Vigencia</th><th>Estado</th><th>Acciones</th></tr></thead>
   <tbody>${records.map(permit=>{
    const owner=owners.get(permit.owner_id)||permit;
    return `<tr><td><b>${clean(permit.folio)}</b></td><td>${clean(owner.full_name||'—')}<br><small>${clean(owner.enrollment||'')}</small></td>
     <td>${clean(permit.vehicle_make+' '+permit.vehicle_model)}<br><small>${clean(permit.license_plate)}</small></td>
     <td>${clean(permit.expires_on)}</td><td>${statusLabel(owner.active===false?{...permit,status:'inactivo'}:permit)}</td>
     <td><div class="flex"><select aria-label="Estado de ${clean(permit.folio)}" data-state-id="${clean(permit.id)}">
     ${[['vigente','Vigente'],['suspendido','Suspendido'],['cancelado','Cancelado']].map(([value,label])=>
       `<option value="${value}" ${permit.status===value?'selected':''}>${label}</option>`).join('')}
     </select><button class="outline-btn btn-sm" data-edit-permit="${clean(permit.id)}">Editar</button></div></td></tr>`;
   }).join('')}</tbody></table></div>`:'<p>Aún no hay tarjetones registrados.</p>'}`;
 }else if(tab==='usuarios'){
  body=`<h2>Usuarios autorizados</h2><div class="table-scroll"><table class="records">
   <thead><tr><th>Nombre</th><th>Correo</th><th>Perfil</th><th>Cuenta</th><th>Acciones</th></tr></thead>
   <tbody>${profiles.map(profile=>`<tr><td>${clean(profile.full_name)}</td><td>${clean(profile.email)}</td>
   <td>${roleName(profile.role)}</td><td>${profile.active?'Habilitada':'Deshabilitada'}</td>
   <td><div class="flex"><button class="outline-btn btn-sm" data-edit-profile="${clean(profile.id)}">Editar cuenta</button>
   ${profile.role==='student'?`<button class="outline-btn btn-sm" data-assign="${clean(profile.id)}">Asignar tarjetón</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`;
 }else if(tab==='historial'){
  const format=new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'medium',timeZone:'America/Mexico_City'});
  body=`<h2>Verificaciones</h2><p>Últimas 100 consultas de códigos reconocidos.</p>
   ${events.length?`<div class="table-scroll"><table class="records">
   <thead><tr><th>Fecha y hora de México</th><th>Folio</th><th>Verificó</th><th>Resultado</th></tr></thead>
   <tbody>${events.map(event=>`<tr><td>${format.format(new Date(event.checked_at))}</td>
   <td>${clean(folios.get(event.permit_id)||'—')}</td><td>${clean(owners.get(event.actor_id)?.full_name||'—')}</td>
   <td>${clean(statusOf({status:event.result}))}</td></tr>`).join('')}</tbody></table></div>`:'<p>Sin verificaciones registradas.</p>'}`;
 }else{
  body=`<h2>Registrar usuario</h2><p>${api?'La persona recibirá una invitación para crear su contraseña.':'Registro local de demostración.'}</p>
   <form id="registerForm"><div class="field-group">${fieldsMarkup([...profileFields,['email','Correo electrónico','email',180]])}
   <label class="field"><span class="label">Perfil</span><select name="role"><option value="student">Titular</option><option value="guard">Vigilante</option></select></label></div>
   <label class="field" id="assignNow"><input type="checkbox" name="assign" checked> Asignar un tarjetón ahora</label>
   <fieldset id="initialPermit"><legend>Tarjetón</legend>${permitFieldsMarkup()}</fieldset>
   <div id="initialPhoto">${api?portraitMarkup():''}</div>
   <button class="primary-btn" type="submit">${api?'Enviar invitación':'Registrar en demostración'}</button><p id="formStatus" role="alert"></p></form>`;
 }
 put(`${sessionHeading('Administración de estacionamiento','Gestiona cuentas, tarjetones y verificaciones.')}
  <nav class="tabs" aria-label="Administración">${tabs.map(([id,label])=>`<button class="tab ${tab===id?'selected':''}" data-tab="${id}">${label}</button>`).join('')}</nav>
  <section class="panel">${body}</section><div id="adminEditor"></div>`);
 wireSession();
 document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{state.tab=button.dataset.tab;adminPanel();});
 document.querySelectorAll('[data-edit-permit]').forEach(button=>button.onclick=()=>{
  const permit=records.find(item=>item.id===button.dataset.editPermit);
  renderPermitEditor(permit,owners.get(permit.owner_id)||permit);
 });
 document.querySelectorAll('[data-edit-profile]').forEach(button=>button.onclick=()=>renderProfileEditor(owners.get(button.dataset.editProfile)));
 document.querySelectorAll('[data-assign]').forEach(button=>button.onclick=()=>renderPermitEditor(null,owners.get(button.dataset.assign)));
 document.querySelectorAll('[data-state-id]').forEach(select=>select.onchange=async()=>{
  const id=select.dataset.stateId, status=select.value;
  select.disabled=true;
  if(api){
   const {error}=await api.from('permits').update({status}).eq('id',id).select('id').single();
   notify(error?'No se pudo actualizar el permiso.':'Estado actualizado.');
  }else{
   demoRecords.find(item=>item.id===id).status=status;
   saveDemo();
   notify('Estado actualizado en demostración.');
  }
  if(route===state.route&&request===state.adminRequest)adminPanel();
 });
 if(tab==='altas'){
  const form=$('#registerForm');
  const sync=()=>{
   const holder=form.elements.role.value==='student';
   const assign=holder&&form.elements.assign.checked;
   $('#assignNow').hidden=!holder;
   $('#initialPhoto').hidden=!holder;
   $('#initialPermit').hidden=!assign;
   $('#initialPermit').disabled=!assign;
  };
  form.onchange=sync;
  sync();
  form.onsubmit=submitNew;
 }
}
async function submitNew(event){
 event.preventDefault();
 const form=event.currentTarget, button=form.querySelector('button');
 const values=new FormData(form);
 const role=values.get('role');
 const assign=role==='student'&&values.has('assign');
 const data={
  name:values.get('full_name').trim(), email:values.get('email').trim(),
  enrollment:values.get('enrollment').trim(), department:values.get('department').trim(),
  role, assign, ...(assign?permitValues(values):{}),
 };
 const status=form.querySelector('#formStatus');
 button.disabled=true;
 try{
  if(api){
   const result=await invoke('admin-invite',data);
   status.textContent=result.folio?`Invitación enviada. Folio ${result.folio} asignado.`:'Invitación enviada.';
   if(role==='student'){
    try{await savePortrait(result.account_id,values.get('portrait'));}
    catch(error){status.textContent+=' '+error.message+' Puedes cargarla desde Usuarios.';}
   }
  }else{
   if(assign){
    if(demoRecords.some(permit=>permit.folio===data.folio))throw Error('Ese folio ya existe.');
    const id=crypto.randomUUID();
    demoRecords.push({...permitValues(values),id,owner_id:id,full_name:data.name,
     department:data.department,enrollment:data.enrollment,status:'vigente'});
    saveDemo();
   }
   status.textContent='Registro guardado en la demostración.';
  }
  form.reset();
  form.dispatchEvent(new Event('change'));
 }catch(error){status.textContent=error.message;}
 finally{button.disabled=false;}
}
async function renderRoute(){state.route++;cleanup();footerStatus();if(live&&!api){put('<section class="panel login-panel"><div class="eyebrow">SIN CONEXIÓN</div><h2>No se pudo cargar Supabase</h2><p>Comprueba tu conexión a internet, la URL y la clave publicable de <code>config.js</code>. No se mostrarán datos de demostración como si fueran reales.</p><a class="outline-btn" href="./">Reintentar</a></section>');return}let hash;try{hash=decodeURIComponent(location.hash||'#/inicio')}catch{hash='#/inicio'};const role=sessionRole();if(hash.startsWith('#/verificar/')&&(api||demo)){const token=hash.slice('#/verificar/'.length).split('/')[0];await verificationPage(token);return}if(hash==='#/verificar'){if(role==='guard'||role==='admin'){await guardPanel()}else if(api){showLogin('guard')}else{home()}return}if(hash==='#/ingresar'){showLogin();return}if(hash==='#/panel'){if(!role){home();return}if(role==='student'){await studentPanel();return}if(role==='guard'){await guardPanel();return}if(role==='admin'){await adminPanel();return}}home()}
let installPrompt=null;
const installButton=$('#installBtn');
installButton.onclick=async()=>{
 if(installPrompt){await installPrompt.prompt();installPrompt=null;return;}
 const dialog=$('#installGuide');
 if(!dialog.open)dialog.showModal();
};
window.addEventListener('beforeinstallprompt',event=>{
 event.preventDefault();
 installPrompt=event;
});
window.addEventListener('appinstalled',()=>notify('Aplicación instalada'));
window.addEventListener('hashchange',renderRoute);

async function activateInvitation(parameters){
 const token=parameters.get('token_hash');
 history.replaceState(null,'',location.pathname);
 const {data,error}=await api.auth.verifyOtp({token_hash:token,type:'invite'});
 if(error||!data.user){home();notify('La invitación es inválida o expiró. Contacta a administración.');return;}
 await completeInvitation(data.user);
}
async function completeInvitation(user){
 history.replaceState(null,'',location.pathname);
 state.user=user;
 await fetchProfile();
 if(!state.profile?.active){await signOut();notify('La cuenta aún requiere autorización.');return;}
 put(`<section class="panel login-panel"><h1>Activa tu cuenta</h1><form id="activation">
  <div class="field"><label class="label" for="newPassword">Crea una contraseña de al menos 12 caracteres</label>
  <input id="newPassword" type="password" autocomplete="new-password" minlength="12" required></div>
  <button class="primary-btn">Guardar contraseña</button><p id="activationStatus" role="alert"></p></form></section>`);
 $('#activation').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget, button=form.querySelector('button');
  button.disabled=true;
  const {error:updateError}=await api.auth.updateUser({password:$('#newPassword').value});
  if(updateError){$('#activationStatus').textContent=updateError.message;button.disabled=false;return;}
  await signOut();
  notify('Contraseña guardada. Ingresa con tu correo.');
 };
}

(async()=>{
 if(live&&window.UTN){
  api=window.UTN.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
   auth:{storageKey:'tarjeton-utn-auth',detectSessionInUrl:false},
  });
  const parameters=new URLSearchParams(location.search);
  if(parameters.has('token_hash')&&parameters.get('type')==='invite'){
   await activateInvitation(parameters);
   return;
  }
  // Supabase también puede redirigir invitaciones con tokens en el fragmento URL.
  const fragment=new URLSearchParams((location.hash||'').replace(/^#/,''));
  if(fragment.get('type')==='invite'&&fragment.has('access_token')&&fragment.has('refresh_token')){
   const {data,error}=await api.auth.setSession({
     access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token')
   });
   if(error||!data.user){home();notify('La invitación caducó o no es válida.');return;}
   await completeInvitation(data.user);
   return;
  }
  if(!navigator.onLine)notify('Conéctate a internet para validar tu sesión.');
  if(location.hash.startsWith('#/verificar/')){
   const {data}=await api.auth.getUser();
   state.user=data?.user||null;
   if(state.user)await fetchProfile();
  }else{
   history.replaceState(null,'',location.pathname);
   renderRoute();
   const route=state.route;
   const {data}=await api.auth.getUser();
   if(route===state.route&&data?.user){
    state.user=data.user;
    await fetchProfile();
    if(route===state.route)home();
   }
  }
  api.auth.onAuthStateChange(event=>{
   if(event==='SIGNED_OUT'){state.user=null;state.profile=null;renderRoute();}
  });
 }
 if(!live||!api||location.hash.startsWith('#/verificar/'))await renderRoute();
 if('serviceWorker' in navigator&&window.isSecureContext){
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
 }
})();
