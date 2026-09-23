(() => {
  'use strict';

  const frame = document.getElementById('appFrame');
  if (!frame) return;

  const DB='QuestoesInterativasDB', STORE='kv', LP='QuestoesInterativasDB:';
  const MODE_KEY='studyHighlighterEnabled';
  const COLORS={
    yellow:'#fff1a8',
    green:'#d7f0d3',
    blue:'#d9ebff',
    pink:'#f7d9e2',
    purple:'#e8def7'
  };

  let enabled=false;
  try{ enabled=localStorage.getItem(MODE_KEY)==='1'; }catch(_){}
  let observer=null, enhanceScheduled=false, suppressNextClick=false, popover=null;
  const excludedCache=new Map(), excludedLoads=new Map(), highlightCache=new Map();

  function openDb(){
    return new Promise((ok,no)=>{
      try{
        const r=indexedDB.open(DB,1);
        r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};
        r.onsuccess=()=>ok(r.result);
        r.onerror=()=>no(r.error);
      }catch(e){no(e)}
    });
  }
  async function get(k){
    try{
      const d=await openDb();
      const v=await new Promise((ok,no)=>{const r=d.transaction(STORE,'readonly').objectStore(STORE).get(k);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
      d.close();
      if(v!==undefined)return v;
    }catch(_){}
    try{const x=localStorage.getItem(LP+k);if(x!==null)return JSON.parse(x)}catch(_){}
  }
  async function set(k,v){
    try{
      const d=await openDb();
      await new Promise((ok,no)=>{const t=d.transaction(STORE,'readwrite');t.objectStore(STORE).put(v,k);t.oncomplete=ok;t.onerror=()=>no(t.error)});
      d.close();
      return;
    }catch(_){}
    try{localStorage.setItem(LP+k,JSON.stringify(v))}catch(_){}
  }

  const hKey=qid=>'highlight:'+qid;
  const xKey=qid=>'excluded:'+qid;
  async function getRecord(qid){
    if(highlightCache.has(qid))return highlightCache.get(qid);
    const v=await get(hKey(qid));
    const rec=(!v||typeof v!=='object')
      ?{items:[],updatedAt:0}
      :{items:Array.isArray(v.items)?v.items:[],updatedAt:Number(v.updatedAt||0)};
    highlightCache.set(qid,rec);
    return rec;
  }
  async function saveRecord(qid,items){
    const rec={items,updatedAt:Date.now()};
    highlightCache.set(qid,rec);
    await set(hKey(qid),rec);
    window.dispatchEvent(new CustomEvent('studyHighlightChanged',{detail:{questionId:qid}}));
    return rec;
  }

  function doc(){return frame.contentDocument}
  function qCard(){return doc()?.querySelector('.question-card[data-question-id]')||null}

  function toast(msg){
    const d=doc(); if(!d)return;
    d.querySelector('.study-feature-toast')?.remove();
    const n=d.createElement('div');
    n.className='study-feature-toast';
    n.textContent=msg;
    d.body.appendChild(n);
    setTimeout(()=>n.remove(),1800);
  }

  async function copyText(text){
    try{
      await navigator.clipboard.writeText(text);
      return true;
    }catch(_){
      try{
        const d=doc()||document;
        const ta=d.createElement('textarea');
        ta.value=text;ta.style.position='fixed';ta.style.opacity='0';ta.style.pointerEvents='none';
        d.body.appendChild(ta);ta.focus();ta.select();
        const ok=d.execCommand('copy');ta.remove();return ok;
      }catch(_){return false}
    }
  }

  function injectStyle(){
    const d=doc(); if(!d||d.getElementById('studyFeaturesStyle'))return;
    const s=d.createElement('style');
    s.id='studyFeaturesStyle';
    s.textContent=`
      .study-marker-toggle{display:flex;align-items:center;gap:9px;margin-left:auto;padding:7px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:12.5px;color:var(--muted);white-space:nowrap}
      .study-switch{position:relative;width:36px;height:20px;display:inline-block;flex:0 0 auto}
      .study-switch input{opacity:0;width:0;height:0;position:absolute}
      .study-switch-track{position:absolute;inset:0;border-radius:999px;background:#cfd7e5;transition:.18s;cursor:pointer}
      .study-switch-track:before{content:"";position:absolute;width:16px;height:16px;left:2px;top:2px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:.18s}
      .study-switch input:checked + .study-switch-track{background:#7187d9}
      .study-switch input:checked + .study-switch-track:before{transform:translateX(16px)}
      .study-copy-row{display:flex;justify-content:flex-end;margin-top:9px}
      .study-copy-question{border:0;background:transparent;color:var(--muted);font-size:12px;cursor:pointer;padding:5px 2px;text-decoration:none}
      .study-copy-question:hover{color:var(--accent);text-decoration:underline}
      mark.study-highlight{padding:0 .03em;border-radius:3px;color:inherit;cursor:pointer;box-decoration-break:clone;-webkit-box-decoration-break:clone}
      .study-highlight-pop{position:fixed;z-index:9999;background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:12px;padding:8px;box-shadow:0 10px 28px rgba(0,0,0,.18);display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:310px}
      .study-color{width:25px;height:25px;border-radius:50%;border:1px solid rgba(0,0,0,.12);cursor:pointer;padding:0}
      .study-pop-action{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:8px;padding:6px 8px;font-size:12px;cursor:pointer}
      .study-pop-action.danger{color:#b42318}
      .study-feature-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;background:rgba(30,41,59,.94);color:#fff;padding:8px 12px;border-radius:9px;font:500 12.5px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.2);pointer-events:none;animation:studyFade .18s}
      @keyframes studyFade{from{opacity:0;transform:translate(-50%,6px)}}
      .study-option-row{display:grid;grid-template-columns:minmax(0,1fr) 25px;gap:24px;align-items:center}
      .study-option-row .option{width:100%;box-sizing:border-box}
      .study-option-exclude{position:static;width:25px;height:25px;border-radius:50%;border:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:18px;line-height:21px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;opacity:.72;transition:opacity .16s,background .16s,color .16s,border-color .16s;margin:0;padding:0}
      .study-option-exclude:hover{opacity:1;background:rgba(100,116,139,.09);color:var(--text)}
      .study-option-exclude.is-excluded{opacity:1;background:rgba(100,116,139,.12);color:var(--text)}
      .option.study-option-excluded{opacity:.72}
      .option.study-option-excluded > span:nth-child(2){text-decoration:line-through;text-decoration-thickness:1.5px;text-decoration-color:rgba(71,85,105,.72)}
      :root[data-theme="dark"] mark.study-highlight{color:#111827}
      :root[data-theme="dark"] .option.study-option-excluded{opacity:.76}
      :root[data-theme="dark"] .option.study-option-excluded > span:nth-child(2){text-decoration-color:rgba(203,213,225,.78)}
      :root[data-theme="dark"] .study-option-exclude:hover{background:rgba(226,232,240,.10)}
      :root[data-theme="dark"] .study-option-exclude.is-excluded{background:rgba(226,232,240,.12)}
      :root[data-theme="dark"] .study-switch-track{background:#48566c}
      @media(max-width:850px){.study-option-row{gap:18px}}
      @media(max-width:760px){.study-marker-toggle{width:max-content;margin:8px 0 0 0}.exam-head{flex-wrap:wrap}.study-copy-row{justify-content:flex-start}}
    `;
    d.head.appendChild(s);
  }

  function ensureToggle(){
    const d=doc(); if(!d)return;
    const head=d.querySelector('.exam-head');
    if(!head)return;
    let box=d.getElementById('studyMarkerToggle');
    if(box)return;
    box=d.createElement('label');
    box.className='study-marker-toggle';
    box.id='studyMarkerToggle';
    box.title='Quando ativado, selecionar uma palavra ou frase cria um destaque.';
    box.innerHTML='<span>Marca-texto</span><span class="study-switch"><input id="studyMarkerInput" type="checkbox"><span class="study-switch-track"></span></span>';
    const input=box.querySelector('input');
    input.checked=enabled;
    input.addEventListener('change',()=>{
      enabled=!!input.checked;
      try{localStorage.setItem(MODE_KEY,enabled?'1':'0')}catch(_){}
      toast(enabled?'Marca-texto ativado':'Marca-texto desativado');
      if(!enabled) closePopover();
    });
    head.appendChild(box);
  }

  async function getExcluded(qid){
    if(excludedCache.has(qid))return excludedCache.get(qid);
    if(excludedLoads.has(qid))return excludedLoads.get(qid);
    const load=(async()=>{
      const v=await get(xKey(qid));
      const items=Array.isArray(v)?v.map(String):[];
      excludedCache.set(qid,items);
      excludedLoads.delete(qid);
      return items;
    })();
    excludedLoads.set(qid,load);
    return load;
  }

  async function setExcluded(qid,letters){
    const items=[...new Set(letters.map(String))];
    excludedCache.set(qid,items);
    await set(xKey(qid),items);
  }

  function ensureOptionExcludes(){
    const d=doc(),card=qCard(); if(!d||!card)return;
    const qid=card.dataset.questionId;if(!qid)return;
    const cached=excludedCache.get(qid);
    const setExcludedNow=new Set(cached||[]);
    for(const opt of card.querySelectorAll('.option')){
      const letter=opt.querySelector('.letter')?.textContent?.trim()||'';
      if(!letter)continue;
      if(cached)opt.classList.toggle('study-option-excluded',setExcludedNow.has(letter));
      let row=opt.closest('.study-option-row');
      if(!row){
        row=d.createElement('div');
        row.className='study-option-row';
        opt.parentNode.insertBefore(row,opt);
        row.appendChild(opt);
      }
      let b=row.querySelector('.study-option-exclude');
      if(!b){
        b=d.createElement('button');
        b.type='button';
        b.className='study-option-exclude';
        b.textContent='×';
        b.title='Excluir alternativa';
        b.setAttribute('aria-label','Excluir alternativa '+letter);
        b.addEventListener('click',async e=>{
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const current=await getExcluded(qid);
          const s=new Set(current);
          if(s.has(letter))s.delete(letter);else s.add(letter);
          const isExcluded=s.has(letter);
          excludedCache.set(qid,[...s]);
          opt.classList.toggle('study-option-excluded',isExcluded);
          b.classList.toggle('is-excluded',isExcluded);
          b.title=isExcluded?'Restaurar alternativa':'Excluir alternativa';
          b.setAttribute('aria-label',(isExcluded?'Restaurar alternativa ':'Excluir alternativa ')+letter);
          await setExcluded(qid,[...s]);
        });
        row.appendChild(b);
      }
      if(cached){
        const isExcluded=setExcludedNow.has(letter);
        b.classList.toggle('is-excluded',isExcluded);
        b.title=isExcluded?'Restaurar alternativa':'Excluir alternativa';
        b.setAttribute('aria-label',(isExcluded?'Restaurar alternativa ':'Excluir alternativa ')+letter);
      }
    }
    if(!cached&&!excludedLoads.has(qid)){
      getExcluded(qid).then(()=>{
        if(qCard()?.dataset.questionId===qid)ensureOptionExcludes();
      });
    }
  }

  function ensureCopy(){
    const d=doc(); if(!d)return;
    const card=qCard(); if(!card||card.querySelector('.study-copy-question'))return;
    const row=d.createElement('div');
    row.className='study-copy-row';
    const b=d.createElement('button');
    b.className='study-copy-question';
    b.type='button';
    b.textContent='⧉ Copiar questão';
    b.addEventListener('click',async e=>{
      e.preventDefault();e.stopPropagation();
      const prompt=card.querySelector('.prompt')?.textContent?.trim()||'';
      const qn=card.querySelector('.qmeta .pill')?.textContent?.trim()||card.querySelector('.qtitle')?.textContent?.trim()||'Questão';
      const opts=[...card.querySelectorAll('.option')].map(o=>{
        const l=o.querySelector('.letter')?.textContent?.trim()||'';
        const t=o.querySelector(':scope > span:nth-child(2)')?.textContent?.trim()||'';
        return (l?l.toLowerCase()+') ':'')+t;
      }).filter(Boolean);
      const text=[qn,'',prompt,'',...opts].join('\n').trim();
      if(await copyText(text)) toast('Copiado para área de transferência');
      else toast('Não foi possível copiar automaticamente');
    });
    row.appendChild(b);
    const actions=card.querySelector('.answer-actions');
    if(actions)actions.insertAdjacentElement('afterend',row);else card.appendChild(row);
  }

  function unwrap(card){
    card.querySelectorAll('mark.study-highlight').forEach(m=>{
      const p=m.parentNode;if(!p)return;
      p.replaceChild((doc()||document).createTextNode(m.textContent||''),m);
      p.normalize();
    });
  }

  function targetEl(card,target){
    if(target==='prompt')return card.querySelector('.prompt');
    if(target.startsWith('option:')){
      const l=target.slice(7);
      const opt=[...card.querySelectorAll('.option')].find(o=>(o.querySelector('.letter')?.textContent||'').trim()===l);
      return opt?.querySelector(':scope > span:nth-child(2)')||null;
    }
    return null;
  }

  function pointAt(root,offset){
    const d=doc(); if(!d)return null;
    const w=d.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let n,seen=0,last=null;
    while((n=w.nextNode())){
      last=n;const len=n.nodeValue?.length||0;
      if(offset<=seen+len)return {node:n,offset:Math.max(0,offset-seen)};
      seen+=len;
    }
    return last?{node:last,offset:last.nodeValue?.length||0}:null;
  }

  async function applyHighlights(force=false){
    const card=qCard(); if(!card)return;
    const qid=card.dataset.questionId;if(!qid)return;
    const rec=await getRecord(qid);
    const sig=String(rec.updatedAt)+':'+rec.items.length;
    if(!force&&card.dataset.studyHighlightSig===sig)return;
    unwrap(card);
    const items=[...rec.items].sort((a,b)=>{
      if(a.target===b.target)return Number(b.start)-Number(a.start);
      return String(a.target).localeCompare(String(b.target));
    });
    for(const item of items){
      const root=targetEl(card,String(item.target||''));if(!root)continue;
      const start=Math.max(0,Number(item.start||0)),end=Math.max(start,Number(item.end||0));
      const a=pointAt(root,start),b=pointAt(root,end);if(!a||!b||end<=start)continue;
      try{
        const r=doc().createRange();r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);
        const m=doc().createElement('mark');
        m.className='study-highlight';
        m.dataset.highlightId=String(item.id||'');
        m.dataset.color=COLORS[item.color]?item.color:'yellow';
        m.style.background=COLORS[m.dataset.color];
        r.surroundContents(m);
      }catch(_){}
    }
    card.dataset.studyHighlightSig=sig;
  }

  function selectionTarget(node){
    const d=doc(); if(!d||!node)return null;
    const el=node.nodeType===Node.TEXT_NODE?node.parentElement:node;
    if(!el?.closest)return null;
    const prompt=el.closest('.prompt');
    if(prompt)return {el:prompt,key:'prompt'};
    const opt=el.closest('.option');
    if(opt){
      const t=opt.querySelector(':scope > span:nth-child(2)');
      if(t&&(t===el||t.contains(el))){
        const l=opt.querySelector('.letter')?.textContent?.trim()||'';
        if(l)return {el:t,key:'option:'+l};
      }
    }
    return null;
  }

  function offsetWithin(root,node,offset){
    const d=doc();const r=d.createRange();r.selectNodeContents(root);r.setEnd(node,offset);return r.toString().length;
  }

  async function highlightSelection(){
    if(!enabled)return;
    const d=doc(),card=qCard();if(!d||!card)return;
    const sel=d.getSelection();if(!sel||sel.rangeCount!==1||sel.isCollapsed)return;
    const r=sel.getRangeAt(0);
    const a=selectionTarget(r.startContainer),b=selectionTarget(r.endContainer);
    if(!a||!b||a.el!==b.el)return;
    let start=offsetWithin(a.el,r.startContainer,r.startOffset);
    let end=offsetWithin(a.el,r.endContainer,r.endOffset);
    if(end<start)[start,end]=[end,start];
    const full=a.el.textContent||'';
    const raw=full.slice(start,end);
    const lead=(raw.match(/^\s*/)||[''])[0].length;
    const trail=(raw.match(/\s*$/)||[''])[0].length;
    start+=lead;end-=trail;
    const text=full.slice(start,end);
    if(!text||end<=start)return;
    const qid=card.dataset.questionId;if(!qid)return;
    const rec=await getRecord(qid);
    if(rec.items.some(x=>x.target===a.key&&Math.max(start,Number(x.start||0))<Math.min(end,Number(x.end||0)))){
      toast('Esse trecho já possui destaque');
      sel.removeAllRanges();return;
    }
    rec.items.push({
      id:(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)),
      target:a.key,start,end,color:'yellow',text
    });
    await saveRecord(qid,rec.items);
    sel.removeAllRanges();
    suppressNextClick=true;
    setTimeout(()=>{suppressNextClick=false},250);
    card.dataset.studyHighlightSig='';
    await applyHighlights(true);
  }

  function closePopover(){popover?.remove();popover=null}

  async function openPopover(mark){
    closePopover();
    const d=doc(),card=qCard();if(!d||!card)return;
    const qid=card.dataset.questionId,id=mark.dataset.highlightId;if(!qid||!id)return;
    const p=d.createElement('div');
    p.className='study-highlight-pop';
    p.addEventListener('click',ev=>ev.stopPropagation());
    Object.entries(COLORS).forEach(([name,color])=>{
      const b=d.createElement('button');b.type='button';b.className='study-color';b.style.background=color;b.title='Alterar cor';
      b.addEventListener('click',async()=>{
        const rec=await getRecord(qid);const item=rec.items.find(x=>String(x.id)===id);if(!item)return;
        item.color=name;await saveRecord(qid,rec.items);closePopover();card.dataset.studyHighlightSig='';await applyHighlights(true);
      });p.appendChild(b);
    });
    const cp=d.createElement('button');cp.type='button';cp.className='study-pop-action';cp.textContent='Copiar';
    cp.addEventListener('click',async()=>{if(await copyText(mark.textContent||''))toast('Copiado para área de transferência');closePopover()});
    const rm=d.createElement('button');rm.type='button';rm.className='study-pop-action danger';rm.textContent='Excluir';
    rm.addEventListener('click',async()=>{
      const rec=await getRecord(qid);rec.items=rec.items.filter(x=>String(x.id)!==id);
      await saveRecord(qid,rec.items);closePopover();card.dataset.studyHighlightSig='';await applyHighlights(true);
    });
    p.append(cp,rm);d.body.appendChild(p);popover=p;
    const rr=mark.getBoundingClientRect(),pr=p.getBoundingClientRect();
    const left=Math.min(Math.max(8,rr.left),Math.max(8,d.documentElement.clientWidth-pr.width-8));
    let top=rr.bottom+8;if(top+pr.height>d.documentElement.clientHeight-8)top=Math.max(8,rr.top-pr.height-8);
    p.style.left=left+'px';p.style.top=top+'px';
  }

  function scheduleEnhance(){
    if(enhanceScheduled)return;
    enhanceScheduled=true;
    queueMicrotask(()=>{
      enhanceScheduled=false;
      injectStyle();
      ensureToggle();
      ensureCopy();
      ensureOptionExcludes();
      applyHighlights(false);
    });
  }

  function attach(){
    const d=doc();if(!d)return;
    observer?.disconnect();
    injectStyle();scheduleEnhance();
    observer=new MutationObserver(scheduleEnhance);
    observer.observe(d.body,{childList:true,subtree:true});

    d.addEventListener('mouseup',()=>setTimeout(highlightSelection,0),true);
    d.addEventListener('touchend',()=>setTimeout(highlightSelection,0),true);
    d.addEventListener('click',e=>{
      const mark=e.target?.closest?.('mark.study-highlight');
      if(mark){e.preventDefault();e.stopImmediatePropagation();openPopover(mark);return}
      if(suppressNextClick){e.preventDefault();e.stopImmediatePropagation();suppressNextClick=false;return}
      if(popover&&!e.target?.closest?.('.study-highlight-pop'))closePopover();
    },true);
  }

  frame.addEventListener('load',attach);
  window.addEventListener('studyHighlightsApplied',()=>{const c=qCard();if(c)c.dataset.studyHighlightSig='';scheduleEnhance()});
  if(frame.contentDocument?.readyState==='complete'||frame.contentDocument?.readyState==='interactive')setTimeout(attach,0);
})();