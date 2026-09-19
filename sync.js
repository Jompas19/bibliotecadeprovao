(() => {
  'use strict';

  const ENDPOINT='https://mdksigkfkdltfthxvcxe.supabase.co/functions/v1/sync-progress';
  const DB='QuestoesInterativasDB', STORE='kv', LP='QuestoesInterativasDB:', SK='syncKey', NP='noteUpdated:';
  const resetKey=()=>key?'syncResetAt:'+key:'';

  let frame,key='',busy=false,timer=null,noteTimer=null,lastP='{}',lastN='{}';

  const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const norm=s=>String(s||'').trim().toLowerCase();
  const valid=s=>/^[a-z0-9][a-z0-9_-]{3,39}$/.test(s);

  function openDb(){return new Promise((ok,no)=>{if(!indexedDB)return no();const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
  async function get(k){try{const d=await openDb(),v=await new Promise((ok,no)=>{const r=d.transaction(STORE,'readonly').objectStore(STORE).get(k);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});d.close();if(v!==undefined)return v}catch(_){}try{const x=localStorage.getItem(LP+k);if(x!==null)return JSON.parse(x)}catch(_){}}
  async function set(k,v){try{const d=await openDb();await new Promise((ok,no)=>{const t=d.transaction(STORE,'readwrite');t.objectStore(STORE).put(v,k);t.oncomplete=ok;t.onerror=()=>no(t.error)});d.close();return}catch(_){}try{localStorage.setItem(LP+k,JSON.stringify(v))}catch(_){}}
  async function del(k){try{const d=await openDb();await new Promise((ok,no)=>{const t=d.transaction(STORE,'readwrite');t.objectStore(STORE).delete(k);t.oncomplete=ok;t.onerror=()=>no(t.error)});d.close()}catch(_){}try{localStorage.removeItem(LP+k)}catch(_){}}
  async function keys(){let a=[];try{const d=await openDb();a=await new Promise((ok,no)=>{const r=d.transaction(STORE,'readonly').objectStore(STORE).getAllKeys();r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>no(r.error)});d.close()}catch(_){}try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(LP))a.push(k.slice(LP.length))}}catch(_){}return[...new Set(a.map(String))]}

  function stripImg(h){const d=new DOMParser().parseFromString('<div id="r">'+String(h||'')+'</div>','text/html');d.querySelectorAll('img').forEach(x=>x.remove());return d.getElementById('r')?.innerHTML||''}
  function imgs(h){const d=new DOMParser().parseFromString('<div id="r">'+String(h||'')+'</div>','text/html');return[...d.querySelectorAll('#r img')].map(x=>x.outerHTML)}
  function mergeNote(remote,local){const a=imgs(local);return String(remote||'')+(a.length?'<div data-local-note-images="1">'+a.join('')+'</div>':'')}
  function canon(p){const o={};for(const[k,v]of Object.entries(p||{})){if(!v||typeof v!=='object')continue;const x={...v};delete x._syncUpdatedAt;o[k]=x}return JSON.stringify(o)}
  async function notes(){const o={};for(const k of await keys()){if(!k.startsWith('note:'))continue;const q=k.slice(5);o[q]={html:stripImg(await get(k)||''),updatedAt:Number(await get(NP+q)||0)}}return o}
  async function state(){const p=await get('progress')||{},o={};for(const[q,v]of Object.entries(p)){if(v&&typeof v==='object')o[q]={...v,_syncUpdatedAt:Number(v._syncUpdatedAt||v.confirmedAt||0)}}return{progress:o,notes:await notes()}}

  async function currentResetAt(){return key?Number(await get(resetKey())||0):0}
  async function req(action,st){
    const r=await fetch(ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,key,state:st,resetAt:await currentResetAt()})
    });
    let b={};try{b=await r.json()}catch(_){}
    if(!r.ok){const e=new Error(b.message||'Não foi possível sincronizar agora.');e.code=b.error||'sync_error';throw e}
    return b
  }

  async function clearStudyData(){
    await set('progress',{});
    await set('customExams',[]);
    for(const k of await keys()){
      if(k.startsWith('note:')||k.startsWith(NP)) await del(k);
    }
    lastP='{}';
    lastN='{}';
  }

  async function apply(st,incomingResetAt=0){
    if(!st)return false;
    let ch=false;
    const localReset=await currentResetAt();

    if(incomingResetAt>localReset){
      await clearStudyData();
      if(resetKey()) await set(resetKey(),incomingResetAt);
      ch=true;
    }

    const lp=await get('progress')||{},rp=st.progress||{};
    if(JSON.stringify(lp)!==JSON.stringify(rp)){await set('progress',rp);ch=true}

    // Remove text-only notes that disappeared remotely after a reset,
    // while preserving local-only images only when the note still exists.
    const remoteIds=new Set(Object.keys(st.notes||{}));
    for(const k of await keys()){
      if(k.startsWith('note:')&&!remoteIds.has(k.slice(5))){
        await del(k);
        await del(NP+k.slice(5));
        ch=true;
      }
    }

    for(const[q,n]of Object.entries(st.notes||{})){
      const l=await get('note:'+q)||'';
      if(stripImg(l)!==String(n?.html||'')){
        await set('note:'+q,mergeNote(n?.html||'',l));
        ch=true;
      }
      await set(NP+q,Number(n?.updatedAt||0));
    }
    return ch
  }

  function status(s,msg){
    const d=document.getElementById('cloudSyncDot'),t=document.getElementById('cloudSyncText'),b=document.getElementById('cloudSyncBtn');
    if(d)d.dataset.state=s;
    if(t)t.textContent=key?(s==='syncing'?'Sincronizando…':'Sincronização'):'Sincronizar';
    if(b)b.title=msg;
  }

  function toast(m){const d=document.createElement('div');d.className='cloud-toast';d.textContent=m;document.body.appendChild(d);setTimeout(()=>d.remove(),3000)}

  async function syncNow({reload=false,silent=false}={}){
    if(!key||busy||!navigator.onLine)return;
    busy=true;
    status('syncing','Sincronizando…');
    try{
      const r=await req('sync',await state());
      const ch=await apply(r.state,Number(r.resetAt||0));
      if(resetKey()) await set(resetKey(),Number(r.resetAt||0));
      lastP=canon(r.state?.progress||{});
      lastN=JSON.stringify(r.state?.notes||{});
      status('ok','Sincronizado');
      if(ch&&reload&&frame)frame.contentWindow.location.reload();
      else if(ch&&!silent)toast('Dados de outro dispositivo foram recebidos.');
      else if(!silent)toast('Sincronização concluída.');
    }catch(e){
      status('error',e.message);
      if(!silent)toast(e.message);
    }finally{busy=false}
  }

  function schedule(ms=800){if(!key)return;clearTimeout(timer);timer=setTimeout(()=>syncNow({silent:true}),ms)}

  async function stampProgress(){
    const p=await get('progress')||{};
    let old={};try{old=JSON.parse(lastP||'{}')}catch(_){}
    let ch=false;
    for(const[q,v]of Object.entries(p)){
      if(!v||typeof v!=='object')continue;
      const x={...v};delete x._syncUpdatedAt;
      if(JSON.stringify(x)!==JSON.stringify(old[q]||{})){
        v._syncUpdatedAt=Date.now();
        p[q]=v;
        ch=true;
      }
    }
    if(ch)await set('progress',p);
    lastP=canon(p);
    schedule();
  }

  async function stampNotes(){
    const n=await notes();
    let old={};try{old=JSON.parse(lastN||'{}')}catch(_){}
    let ch=false;
    for(const[q,v]of Object.entries(n)){
      if(String(v.html||'')!==String(old[q]?.html||'')){
        await set(NP+q,Date.now());
        ch=true;
      }
    }
    if(ch){lastN=JSON.stringify(await notes());schedule(900)}
  }

  function hook(){
    const w=frame?.contentWindow;if(!w)return;
    ['confirmQuestion','setStatus','saveOverride','removeOverride'].forEach(n=>{
      const f=w[n];
      if(typeof f!=='function'||f.__cloud)return;
      const g=async function(...a){const z=await f.apply(this,a);setTimeout(stampProgress,30);return z};
      g.__cloud=true;
      w[n]=g;
    });
    const d=frame.contentDocument;
    if(d&&!d.__cloud){
      d.__cloud=true;
      d.addEventListener('input',e=>{
        if(e.target?.id!=='noteEditor')return;
        clearTimeout(noteTimer);
        noteTimer=setTimeout(stampNotes,850);
      },true);
    }
  }

  function err(m){const e=document.getElementById('cloudSyncError');if(e)e.textContent=m||''}
  function close(){document.getElementById('cloudSyncModal')?.remove()}

  async function create(raw){
    const k=norm(raw);
    if(!valid(k))throw new Error('Use de 4 a 40 caracteres: letras, números, hífen ou sublinhado.');
    key=k;
    try{
      const r=await req('create',await state());
      await set(resetKey(),Number(r.resetAt||0));
    }catch(e){key='';throw e}
    await set(SK,k);
    status('ok','Sincronizado');
    close();
    toast('Sincronização ativada. Guarde seu ID.');
  }

  async function connect(raw){
    const k=norm(raw);
    if(!valid(k))throw new Error('Chave inválida.');
    key=k;
    try{
      const r=await req('sync',await state());
      await apply(r.state,Number(r.resetAt||0));
      await set(resetKey(),Number(r.resetAt||0));
    }catch(e){key='';throw e}
    await set(SK,k);
    status('ok','Sincronizado');
    close();
    toast('ID conectado. Atualizando seus dados…');
    frame?.contentWindow.location.reload();
  }

  async function disconnect(){
    const old=key;
    key='';
    await del(SK);
    status('local','Somente neste dispositivo');
    close();
    toast('Você parou de sincronizar neste dispositivo. Seus dados locais foram mantidos.');
    if(old) setTimeout(()=>{},0);
  }

  async function resetAll(){
    if(busy)return false;
    busy=true;
    status(key?'syncing':'local',key?'Limpando dados sincronizados…':'Limpando dados…');
    try{
      if(key&&navigator.onLine){
        const r=await req('reset',{progress:{},notes:{}});
        await clearStudyData();
        await set(resetKey(),Number(r.resetAt||Date.now()));
      }else if(key&&!navigator.onLine){
        throw new Error('Conecte-se à internet para restaurar uma conta sincronizada.');
      }else{
        await clearStudyData();
      }
      lastP='{}';lastN='{}';
      status(key?'ok':'local',key?'Sincronizado':'Somente neste dispositivo');
      close();
      toast('Todos os seus dados foram apagados. Você começou do zero.');
      if(frame)frame.contentWindow.location.reload();
      return true;
    }catch(e){
      status('error',e.message);
      toast(e.message);
      throw e;
    }finally{busy=false}
  }
  window.cloudSyncResetAll=resetAll;

  function modal(){
    document.getElementById('cloudSyncModal')?.remove();
    const on=!!key;
    document.body.insertAdjacentHTML('beforeend',
      `<div class="cloud-modal-bg" id="cloudSyncModal"><div class="cloud-modal">
        <h2>${on?'Sincronização':'Sincronizar entre dispositivos'}</h2>
        ${on?
          `<div class="cloud-okline">✓ Você está sincronizado no ID: <strong>${esc(key)}</strong></div>
           <p class="cloud-help">Use esse mesmo ID em outro dispositivo para acessar seu progresso, respostas e anotações de texto.</p>
           <div id="cloudSyncError" class="cloud-error"></div>
           <div class="cloud-actions">
             <button class="cloud-btn secondary" id="cClose">Fechar</button>
             <button class="cloud-btn danger" id="cDisc">Parar de sincronizar</button>
             <button class="cloud-btn primary" id="cNow">Sincronizar agora</button>
           </div>`:
          `<p>Escolha uma chave pessoal simples. Ela substitui e-mail e senha.</p>
           <input class="cloud-input" id="cKey" maxlength="40" autocomplete="off" placeholder="Ex.: joao-med">
           <div class="cloud-help">4–40 caracteres; letras, números, hífen ou sublinhado. Maiúsculas/minúsculas são iguais. Se a chave já existir, não será possível criá-la novamente.</div>
           <div id="cloudSyncError" class="cloud-error"></div>
           <div class="cloud-actions stacked">
             <button class="cloud-btn secondary" id="cClose">Cancelar</button>
             <button class="cloud-btn secondary" id="cUse">Usar ID existente</button>
             <button class="cloud-btn primary" id="cCreate">Criar novo ID</button>
           </div>`}
      </div></div>`
    );

    document.getElementById('cClose').onclick=close;
    if(on){
      document.getElementById('cDisc').onclick=disconnect;
      document.getElementById('cNow').onclick=async()=>{err('');await syncNow({reload:true});close()};
    }else{
      const i=document.getElementById('cKey');
      setTimeout(()=>i?.focus(),20);
      document.getElementById('cCreate').onclick=async()=>{
        err('');
        try{await create(i.value)}
        catch(e){err(e.code==='key_exists'?'Esse ID já existe. Escolha outro.':e.message)}
      };
      document.getElementById('cUse').onclick=async()=>{
        err('');
        try{await connect(i.value)}
        catch(e){err(e.code==='key_not_found'?'Esse ID não foi encontrado.':e.message)}
      };
      i.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('cCreate').click()});
    }
  }

  function ui(){
    const s=document.createElement('style');
    s.textContent=`html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#eef2f7}
#appFrame{border:0;width:100%;height:100%;display:block;background:#fff}
.cloud-float{position:fixed;right:18px;bottom:18px;z-index:1000;border:1px solid rgba(18,35,64,.16);background:#fff;color:#1c2a3d;border-radius:999px;padding:10px 14px;box-shadow:0 8px 28px rgba(24,42,70,.18);font:600 13px system-ui;cursor:pointer;display:flex;align-items:center;gap:8px}
.cloud-dot{width:9px;height:9px;border-radius:50%;background:#9aa5b4}
.cloud-dot[data-state=ok]{background:#159a5b}
.cloud-dot[data-state=syncing]{background:#d69a00}
.cloud-dot[data-state=error]{background:#ce3f3f}
.cloud-modal-bg{position:fixed;inset:0;z-index:2000;background:rgba(14,25,43,.55);display:grid;place-items:center;padding:18px;font-family:system-ui}
.cloud-modal{width:min(560px,100%);box-sizing:border-box;background:#fff;color:#182336;border-radius:18px;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.28)}
.cloud-modal h2{margin:0 0 12px;font-size:20px}
.cloud-modal p{color:#69778d;line-height:1.45}
.cloud-input{width:100%;box-sizing:border-box;border:1px solid #cad4e2;border-radius:10px;padding:12px 13px;font-size:16px}
.cloud-help{font-size:12px;color:#718096;margin-top:8px;line-height:1.4}
.cloud-okline{background:#eefaf3;border:1px solid #bfe5cf;color:#17623d;border-radius:12px;padding:13px 14px;line-height:1.45}
.cloud-key{font:700 19px ui-monospace,monospace;background:#f3f6fa;border:1px solid #d8e0eb;border-radius:10px;padding:12px;word-break:break-all}
.cloud-error{min-height:20px;color:#b42318;font-size:13px;margin-top:8px}
.cloud-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}
.cloud-btn{border:1px solid #cfd8e5;background:#fff;border-radius:9px;padding:9px 12px;font-weight:600;cursor:pointer}
.cloud-btn.primary{background:#2856c4;border-color:#2856c4;color:#fff}
.cloud-btn.danger{border-color:#f0b5b5;color:#b42318;background:#fff7f7}
.cloud-toast{position:fixed;left:50%;bottom:76px;transform:translateX(-50%);z-index:3000;background:#152033;color:#fff;padding:10px 14px;border-radius:10px;font:500 13px system-ui;box-shadow:0 10px 32px rgba(0,0,0,.2);max-width:min(560px,90vw);text-align:center}
@media(max-width:600px){.cloud-float{right:12px;bottom:12px;padding:10px 12px}.cloud-float span:last-child{display:none}.cloud-actions.stacked{flex-direction:column-reverse}.cloud-actions.stacked .cloud-btn{width:100%}}`;
    document.head.appendChild(s);
    document.body.insertAdjacentHTML('beforeend','<button class="cloud-float" id="cloudSyncBtn"><span class="cloud-dot" id="cloudSyncDot" data-state="local"></span><span>☁</span><span id="cloudSyncText">Sincronizar</span></button>');
    document.getElementById('cloudSyncBtn').onclick=modal;
  }

  async function init(){
    ui();
    frame=document.getElementById('appFrame');
    key=norm(await get(SK)||'');
    lastP=canon(await get('progress')||{});
    lastN=JSON.stringify(await notes());
    status(key?'syncing':'local',key?'Verificando dados na nuvem…':'Somente neste dispositivo');
    frame.addEventListener('load',()=>{hook();setTimeout(hook,500);setTimeout(hook,1500)});
    window.addEventListener('online',()=>key&&syncNow({reload:true,silent:true}));
    if(key)setTimeout(()=>syncNow({reload:true,silent:true}),600);
  }

  init();
})();