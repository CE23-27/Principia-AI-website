/* Principia demo overlay: sheets as images, claims as SVG boxes, the beam as a BFS over support
   edges, the trace drawn on the pipes themselves. Reads ui/out/first_pass.json and moc.json via server.py. */
const SHEETS = ["MM0011","MM0012","MM0013","MM0014","MM0015","MM0016","MM0017"];
const RANK = {refuted:5, open:4, obligated:3, derived:2, asserted:1};
const EXTRA_ANCHORS = {
  '16"-E4B-CO-1004': {MM0011:[2230,760,230,48], MM0012:[380,745,260,48]},
  '16"-E4B-CO-1005': {MM0012:[760,460,250,48], MM0013:[380,700,250,48]},
  '16"-E4B-CO-1006': {MM0012:[760,1035,250,48], MM0013:[380,1275,250,48]},
  'MS-1001': {MM0011:[1180,55,290,95]},
  'rate_basis': {MM0011:[2230,820,230,48]},
};
const ALIAS = { 'SIF-101':['PS-1001','MOV-1001'], 'SIF-104':['PS-1004','MOV-1004'], 'PAH-1001':['PIT-1001'],
  'PAL-1004':['PIT-1005'], 'S-1.5.2':['PS-1001'], 'S-1.5.1':['PS-1001'], 'S-1.2.2':['PSV-1001'], 'S-1.7.1':['TP-01'],
  'PSHH-1001':['PS-1001'], 'PSLL-1004':['PS-1004'], 'IPL-2':['PIT-1001'], 'IPL-1':['PS-1001'] };
/* Pipe routes follow the drawn process lines on the 2600x1682 renders; signal routes are the dashed
   instrument stems (process line -> transmitter -> controller). */
const PIPES = {
  MM0011: [[[335,787],[845,787]], [[845,633],[845,939]], [[845,633],[2250,633]], [[845,939],[2250,939]], [[2250,633],[2250,939]], [[2250,787],[2464,787]]],
  MM0012: [[[215,777],[660,777]], [[660,484],[660,1056]], [[660,484],[2457,484]], [[660,1056],[2457,1056]]],
  MM0013: [[[215,735],[1894,735]], [[1894,735],[1894,494]], [[728,494],[2457,491]]],
  MM0014: [[[215,387],[2162,387]], [[2162,387],[2162,589]], [[2162,589],[2457,589]], [[215,855],[2162,855]], [[2162,855],[2162,1095]], [[2162,1095],[2457,1095]]],
};
const SIGNALS = {
  MM0011: [[[471,787],[471,740]], [[614,776],[614,740]]],
  MM0012: [[[1399,484],[1399,464]], [[1399,439],[1399,322]], [[1399,1056],[1399,1036]], [[1399,1011],[1399,894]]],
  MM0013: [[[848,494],[848,342]]],
  MM0014: [[[480,387],[480,374]]],
};
const STOPS = { MM0012:[['PIC-1001',[1374,271]],['PIC-1002',[1374,843]]], MM0013:[['PSV-1002',[848,291]]] };
const LEGEND = [
  ['PS','Pressure switch','trip input to a shutdown function (SIF sensor)'], ['PIT','Pressure transmitter','alarm and control input; the component layers can share'],
  ['PIC','Pressure controller','basic process control (BPCS) override on the FCV'], ['FCV','Flow control valve','BPCS final element'],
  ['MOV','Motor-operated valve','SIF final element; closes on trip'], ['XV','Solenoid valve','actuator pilot for the MOV'],
  ['PSV','Relief valve','last layer; set pressure must be on record'], ['FIT / FE','Flow transmitter / orifice','custody metering; mass-balance leak detection'],
  ['ZSO / ZSC','Limit switches','valve position proof'], ['PI / TI','Local gauges','no credit; indication only'],
  ['PAH','High-pressure alarm','operator-response layer; credited only if independent and in time'], ['SIF','Safety instrumented function','sensor → logic → final element, with trip, response time, PST'],
];

const S = { phase:'first_pass', data:null, index:[], sheet:null, scale:0.5, tx:0, ty:0, follow:null, focus:[], hlKind:null };
const $ = s => document.querySelector(s);
const listeners = {};
const emit = (ev) => (listeners[ev]||[]).forEach(fn => fn());

/* Static mode: when no server answers the API, every call maps to a pre-computed file produced by the
   same pipeline (make run + the answer flow). Lets the demo be hosted as plain files under /demo/. */
const STATIC = {
  '/api/state?phase=first_pass': 'out/static/first_pass.json', '/api/state?phase=moc': 'out/static/moc.json',
  '/api/index': 'out/static/index.json', '/api/moc': 'out/static/moc_def.json', '/api/doc?name=lopa': 'out/static/lopa.json',
  '/api/commit': 'out/static/moc.json', '/api/answer': 'out/static/answered.json', '/api/reset': 'out/static/first_pass.json',
};
let STATIC_MODE = false;
async function getJSON(u, opt){
  if (!STATIC_MODE) {
    try { const r = await fetch(u, opt); if (r.ok) { const j = await r.json(); if (!j.error) return j; } } catch (e) {}
    STATIC_MODE = true;
  }
  const f = STATIC[u.split('#')[0]] || STATIC[u]; if (!f) return {error: 'no static file for ' + u};
  const r = await fetch(f, {cache: 'no-store'}); const j = await r.json();
  if (u === '/api/answer') { await new Promise(res => setTimeout(res, 900)); }
  return j;
}
async function load(phase){
  S.index = await getJSON('/api/index');
  S.data = await getJSON('/api/state?phase='+phase);
  S.phase = phase;
  $('#phase').textContent = 'phase: ' + (phase==='moc' ? 'after MOC-001' : 'first pass (before the MOC)');
  renderStrip(); renderPanel(); if (S.sheet) renderSheet(S.sheet);
  emit('loaded');
}

/* ---------- status per subject ---------- */
function claimsBySubject(){ const m = {}; for (const c of (S.data?.claims||[])) (m[c.subject] ||= []).push(c); return m; }
function subjectStatus(subj, bySubj, overrides){
  let best = null;
  const list = [subj, ...Object.entries(ALIAS).filter(([k,v])=>v.includes(subj)).map(([k])=>k)];
  for (const s of list) {
    if (overrides && overrides[s]) { if (!best || RANK[overrides[s]]>RANK[best]) best = overrides[s]; }
    for (const c of (bySubj[s]||[])) { const st = c.status==='holds'?'derived':c.status; if (RANK[st] && (!best || RANK[st]>RANK[best])) best = st; }
  }
  return best || 'asserted';
}
function sheetColor(sheet, bySubj){
  let worst = 0;
  for (const t of S.index.filter(t=>t.sheet===sheet)) worst = Math.max(worst, RANK[subjectStatus(t.tag, bySubj)]||0);
  for (const [subj, per] of Object.entries(EXTRA_ANCHORS)) if (per[sheet]) worst = Math.max(worst, RANK[subjectStatus(subj, bySubj)]||0);
  return worst>=5?'red':worst>=3?'amber':worst===2?'green':'';
}

/* ---------- strip (a) ---------- */
function renderStrip(){
  const bySubj = claimsBySubject();
  $('#strip').innerHTML = SHEETS.map(s=>`<div class="thumb ${sheetColor(s,bySubj)}" data-s="${s}"><img src="sheets/${s}.png" alt="${s}"><div class="dot"></div><div class="lbl">${s}</div></div>`).join('');
  $('#strip').querySelectorAll('.thumb').forEach(el=>el.onclick=()=>openSheet(el.dataset.s));
}

/* ---------- sheet (b, d, e) ---------- */
function openSheet(name){
  S.sheet = name; $('#sheet').classList.add('on'); $('#strip').style.display='none';
  $('#img').src = `sheets/${name}.png`;
  fit(); renderSheet(name);
}
function fit(){
  const st = $('#stage').getBoundingClientRect();
  S.scale = Math.min(st.width/2600, st.height/1682)*0.98; S.tx = (st.width-2600*S.scale)/2; S.ty = (st.height-1682*S.scale)/2; applyT();
}
function applyT(){ $('#canvas').style.transform = `translate(${S.tx}px,${S.ty}px) scale(${S.scale})`; }
function kindPrefix(tag){ return String(tag).split('-')[0].replace(/[0-9]/g,''); }
function renderSheet(name, overrides){
  const bySubj = claimsBySubject();
  const svg = $('#overlay'); let out = '';
  const findingsFor = subj => (S.data?.findings||[]).filter(f => f.subject===subj || (f.subgoal||'').includes(subj));
  const draw = (subj, box, labelTag) => {
    const st = subjectStatus(subj, bySubj, overrides);
    const [x,y,w,h] = box.map(Number);
    const extra = (S.focus.includes(subj) ? ' focus' : '') + (S.hlKind && kindPrefix(subj)===S.hlKind ? ' hl' : '');
    out += `<rect class="box ${st}${extra}" x="${x-8}" y="${y-8}" width="${w+16}" height="${h+16}" style="color:${st==='refuted'?'var(--bad)':st==='derived'?'var(--ok)':'var(--warn)'}"><title>${subj}: ${st}</title></rect>`;
    if (st!=='asserted') {
      const fs = findingsFor(subj); const rules = [...new Set(fs.map(f=>f.rule))].join(' ');
      const txt = st==='refuted' ? `✕ ${labelTag} ${rules}` : st==='open' ? `? ${labelTag} ${rules||'question'}` : st==='obligated' ? `… ${labelTag}` : `✓ ${labelTag} ${rules}`;
      out += `<text class="callout ${st}" x="${x+w+14}" y="${y-10}">${txt}</text>`;
    }
  };
  // trace on the pipes (e): only after the MOC; pipes thick, instrument signals dashed
  if (S.phase==='moc' && PIPES[name]) {
    const sc = sheetColor(name, bySubj); const col = sc==='red'?'red':sc==='green'?'green':'amber';
    for (const r of PIPES[name]) out += `<polyline class="trace ${col}" points="${r.map(p=>p.join(',')).join(' ')}"/>`;
    for (const r of (SIGNALS[name]||[])) out += `<polyline class="trace signal ${col}" points="${r.map(p=>p.join(',')).join(' ')}"/>`;
  }
  for (const t of S.index.filter(t=>t.sheet===name)) draw(t.tag, [t.x,t.y,t.w,t.h], t.tag);
  for (const [subj, per] of Object.entries(EXTRA_ANCHORS)) if (per[name]) draw(subj, per[name], subj);
  if (S.phase==='moc') for (const [tag,[x,y]] of (STOPS[name]||[])) if (subjectStatus(tag,bySubj,overrides)==='open') {
    out += `<circle class="stop" cx="${x+25}" cy="${y+25}" r="48"/><text class="stoplbl" x="${x+90}" y="${y+70}">documents run out here</text>`;
  }
  svg.innerHTML = out;
  $('#sheetbar').innerHTML = SHEETS.map(s=>`<span class="pill ${s===name?'cur':''}" data-s="${s}">${s}</span>`).join('');
  $('#sheetbar').querySelectorAll('.pill').forEach(el=>el.onclick=()=>openSheet(el.dataset.s));
  $('#strip').querySelectorAll('.thumb').forEach(el=>{ el.className = 'thumb ' + sheetColor(el.dataset.s, bySubj); });
}

/* ---------- beam (c): BFS over support edges, one second per hop, at least five seconds ---------- */
async function commit(){
  $('#btnCommit').disabled = true; $('#btnCommit').textContent = 'Committing…';
  const moc = await getJSON('/api/moc');
  const touched = new Set(moc.touches||[]);
  const claims = S.data?.claims||[]; const support = S.data?.support||[];
  const restsOn = {}; for (const [c, r] of support) (restsOn[r] ||= []).push(c);
  const byId = Object.fromEntries(claims.map(c=>[c.id,c]));
  let frontier = claims.filter(c=>touched.has(c.subject)).map(c=>c.id);
  const seen = new Set(frontier); const layers = [];
  while (frontier.length) { layers.push(frontier); const next = []; for (const id of frontier) for (const c of (restsOn[id]||[])) if (!seen.has(c)) { seen.add(c); next.push(c); } frontier = next; }
  // split layers into per-subject steps so the amber visibly walks the graph
  const steps = []; for (const layer of layers) { const subs = [...new Set(layer.map(id=>byId[id]?.subject).filter(Boolean))]; for (const s of subs) steps.push(s); }
  const delay = Math.max(1000, Math.floor(5000 / Math.max(1, steps.length)));
  if (!S.sheet) openSheet('MM0011');
  const overrides = {}; let n = 0;
  for (const subj of steps) {
    overrides[subj] = 'obligated'; n++;
    const where = S.index.find(t=>t.tag===subj)?.sheet || Object.keys(EXTRA_ANCHORS[subj]||{})[0];
    if (where && where !== S.sheet) openSheet(where);
    renderSheet(S.sheet, overrides); renderPanelBeam(n, subj);
    await new Promise(r=>setTimeout(r, delay));
  }
  const res = await getJSON('/api/commit', {method:'POST', body:'{}'});
  if (res.error) { alert(res.error); $('#btnCommit').disabled=false; return; }
  S.data = res; S.phase = 'moc'; $('#phase').textContent = 'phase: after MOC-001';
  openSheet('MM0011'); renderStrip(); renderPanel();
  $('#btnCommit').textContent = 'MOC-001 committed'; $('#btnFollow').disabled = false;
  emit('committed');
}

/* ---------- follow the line (e) ---------- */
function follow(){
  if (S.follow) { clearInterval(S.follow); S.follow=null; $('#btnFollow').textContent='Follow the line'; return; }
  const order = ['MM0011','MM0012','MM0013','MM0014']; let i = 0; openSheet(order[0]);
  $('#btnFollow').textContent = 'Stop following';
  S.follow = setInterval(()=>{ i = (i+1) % order.length; openSheet(order[i]); }, 2200);
}

/* ---------- panel (f) ---------- */
function prov(p){
  if (!p) return '';
  if (p.doc==='engineer') return `engineer answer (${p.by_role||'engineer'})`;
  if (p.sheet) return `sheet ${p.sheet}${p.zone?' zone '+p.zone:''}${p.text_layer===false?' · drawing, no text layer':''}`;
  if (p.doc==='tundra_pdf' || p.page) return `hazop p.${p.page}${p.row?' row '+p.row:''}${p.verified==='literal'?' · span verified':''}`;
  if (String(p.doc||'').startsWith('synthetic')) return `${p.doc} row ${p.row}` + (p.span?` (${p.span})`:'');
  if (p.doc==='solver') return `decided by ${p.solver||'cvc5'}`;
  return [p.doc, p.clause||p.row].filter(Boolean).join(' ');
}
function claimLine(id){ const c = (S.data.claims||[]).find(c=>c.id===id); if (!c) return `<div class="prov">${id}</div>`;
  return `<div class="prov"><b>${c.subject}</b> ${c.body||''}<br>${prov(c.provenance)}${c.provenance?.span?` — “${String(c.provenance.span).slice(0,140)}”`:''}</div>`; }
function card(f){
  const st = f.status==='holds'?'derived':f.status;
  const sup = (f.core && f.core.length ? f.core : (f.support||[])).slice(0,6).map(claimLine).join('');
  const model = f.model && Object.keys(f.model).length ? `<div class="prov">counterexample: ${Object.entries(f.model).map(([k,v])=>k+'='+v).join(', ')}</div>` : '';
  const q = f.question ? `<div class="prov">→ question to <b>${f.question.to_role}</b>: ${f.question.text}</div>` : '';
  const smt = f.smtlib ? `<details><summary>SMT-LIB sent to cvc5</summary><pre>${esc(f.smtlib)}</pre></details>` : '';
  return `<div class="card" data-f="${f.id||''}"><div class="head"><span class="st ${st}">${f.status}</span><span class="tag">${f.rule} · ${esc(f.subject||'')}</span></div><div class="body">${f.body||f.subgoal||''}</div>${sup}${model}${q}${smt}</div>`;
}
function esc(s){ return String(s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function renderPanelBeam(n, subj){ $('#panel').innerHTML = `<h2>Committing MOC-001</h2><div class="empty">Propagating along “rests on” edges… ${n} subjects obligated so far.</div><div class="card"><div class="head"><span class="st obligated">obligated</span><span class="tag">${esc(subj)}</span></div><div class="body">Every claim that rests on ${esc(subj)} is now an obligation to re-derive.</div></div>`; }
function legendHtml(){
  return `<div id="legend" class="${S.legendOn?'on':''}"><table class="h"><tr><th>tag</th><th>component</th><th>role in this review</th></tr>${LEGEND.map(([k,n,r])=>`<tr data-k="${k.split(' ')[0]}"><td class="k">${k}</td><td>${n}</td><td>${r}</td></tr>`).join('')}</table><div class="prov">click a row to highlight that component type on the sheet · <b>✕</b> refuted: a rule the rows contradict · <b>✓</b> re-derived: proved from the rows · <b>?</b> open: a question with a name on it · <b>…</b> obligated: rests on something that changed</div></div>`;
}
function renderPanel(){
  const d = S.data; if (!d || d.error) { $('#panel').innerHTML = `<div class="empty">${d?.error||'no data'}</div>`; return; }
  const F = d.findings||[]; const refuted = F.filter(f=>f.status==='refuted'); const open = F.filter(f=>f.status==='open'); const ok = F.filter(f=>f.status==='holds'||f.status==='derived');
  const qs = d.questions||[];
  let h = `<h2>${S.phase==='moc' ? 'After MOC-001' : 'First pass, before the MOC'}</h2>
  <div class="kpi"><div class="r"><b>${refuted.length}</b><span>refuted</span></div><div class="a"><b>${open.length||qs.length}</b><span>open</span></div><div class="g"><b>${ok.length}</b><span>re-derived</span></div></div>` + legendHtml();
  if (S.phase==='moc' && d.diff) h += `<div class="prov">obligated ${ (d.obligated||[]).length } claims · re-derived ${ (d.diff.re_derived||[]).length } · refuted ${ (d.diff.refuted||[]).length } · opened ${ (d.diff.opened||[]).length }</div>`;
  h += `<h3>Refuted</h3>` + (refuted.length ? refuted.map(card).join('') : `<div class="empty">nothing refuted</div>`);
  h += `<h3>Open · to whom</h3>`;
  const openCards = open.map(card).join('');
  const qCards = qs.filter(q=>q.status!=='answered').map(q=>`<div class="card"><div class="head"><span class="st open">question</span><span class="tag">${q.id}</span></div><div class="body">${q.text}</div><div class="prov">to <b>${q.to_role}</b></div>
     <div class="q"><input id="ans-${q.id}" placeholder="answer as ${q.to_role.split(' (')[0]} (e.g. 1650 psig)"><button data-q="${q.id}" class="ansbtn">Answer</button></div></div>`).join('');
  const answered = qs.filter(q=>q.status==='answered').map(q=>`<div class="card"><div class="head"><span class="st derived">answered</span><span class="tag">${q.id}</span></div><div class="body">${q.text}</div><div class="prov">axiom entered by <b>${q.by_role||q.to_role}</b>: ${q.answer||''}</div></div>`).join('');
  h += (openCards+qCards+answered) || `<div class="empty">no open questions</div>`;
  if (d.historian && d.historian.length) {
    h += `<h3>Historian evidence (synthetic)</h3><table class="h"><tr><th>excursion</th><th>tag</th><th>rise psi/min</th><th>basis</th></tr>`;
    const seen = new Set(); for (const r of d.historian) { if (seen.has(r.excursion_id)) continue; seen.add(r.excursion_id);
      const basis = S.phase==='moc' ? 12 : 5; const v = +r.rise_rate_psi_min;
      h += `<tr><td>${r.excursion_id}</td><td>${r.tag}</td><td>${v}</td><td style="color:${v>basis?'#ffb3bb':'var(--faint)'}">${v>basis?'exceeds':'within'} ${basis}</td></tr>`; }
    h += `</table><div class="prov">data refutes a rate basis; it never proves one.</div>`;
  }
  h += `<h3>Re-derived</h3>` + (ok.length ? ok.slice(0,8).map(card).join('') : `<div class="empty">none yet</div>`);
  h += `<div class="limits"><b>Limits.</b> ${esc(d.limits||'')}</div>`;
  $('#panel').innerHTML = h;
  $('#panel').querySelectorAll('#legend tr[data-k]').forEach(tr=>tr.onclick=()=>{ S.hlKind = S.hlKind===tr.dataset.k ? null : tr.dataset.k; if (S.sheet) renderSheet(S.sheet); });
  $('#panel').querySelectorAll('.ansbtn').forEach(b=>b.onclick=async()=>{
    const id = b.dataset.q; const text = $('#ans-'+id).value.trim(); if (!text) return; b.disabled = true; b.textContent='re-deriving…';
    const res = await getJSON('/api/answer', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({question_id:id, text})});
    if (res.error) { alert(res.error); b.disabled=false; return; }
    S.data = res; S.phase='moc'; renderPanel(); renderStrip(); if (S.sheet) renderSheet(S.sheet); emit('loaded');
  });
}
function highlightFinding(f){
  const el = [...document.querySelectorAll('#panel .card')].find(c => c.dataset.f && c.dataset.f===f.id);
  if (el) { const a = $('#panel'); a.scrollTo({top: el.offsetTop - a.offsetTop - 60, behavior:'smooth'}); el.style.boxShadow='0 0 0 2px rgba(63,208,201,.6)'; setTimeout(()=>el.style.boxShadow='', 2500); }
}
function focus(subjects){ S.focus = subjects || []; if (S.sheet) renderSheet(S.sheet); }

/* ---------- pan / zoom ---------- */
(function(){
  const st = $('#stage'); let drag=null;
  st.addEventListener('mousedown', e=>{ if(!S.sheet || e.target.closest('#dialog,#sheetbar')) return; drag={x:e.clientX,y:e.clientY,tx:S.tx,ty:S.ty}; });
  window.addEventListener('mousemove', e=>{ if(!drag) return; S.tx=drag.tx+(e.clientX-drag.x); S.ty=drag.ty+(e.clientY-drag.y); applyT(); });
  window.addEventListener('mouseup', ()=>drag=null);
  st.addEventListener('wheel', e=>{ if(!S.sheet || e.target.closest('#dialog')) return; e.preventDefault(); const r=st.getBoundingClientRect(); const mx=e.clientX-r.left, my=e.clientY-r.top;
    const k = Math.exp(-e.deltaY*0.0015); const ns = Math.min(3, Math.max(0.2, S.scale*k)); S.tx = mx-(mx-S.tx)*(ns/S.scale); S.ty = my-(my-S.ty)*(ns/S.scale); S.scale=ns; applyT(); }, {passive:false});
  window.addEventListener('resize', ()=>{ if(S.sheet) fit(); });
})();
$('#btnStrip').onclick = ()=>{ $('#sheet').classList.remove('on'); $('#strip').style.display='grid'; S.sheet=null; if (S.follow) follow(); };
$('#btnCommit').onclick = commit;
$('#btnFollow').onclick = follow;
$('#btnLegend').onclick = ()=>{ S.legendOn = !S.legendOn; const l = $('#legend'); if (l) l.classList.toggle('on', S.legendOn); };
$('#btnReset').onclick = async()=>{ $('#btnReset').disabled=true; const r = await getJSON('/api/reset',{method:'POST',body:'{}'}); $('#btnReset').disabled=false;
  if (r.error) return alert(r.error); S.data=r; S.phase='first_pass'; $('#phase').textContent='phase: first pass (before the MOC)';
  $('#btnCommit').disabled=false; $('#btnCommit').textContent='Commit MOC-001'; $('#btnFollow').disabled=true; if (S.follow) follow(); S.focus=[];
  $('#dlog').innerHTML = '<div class="empty">Press “Ask as the engineer”.</div>'; renderStrip(); renderPanel(); if (S.sheet) renderSheet(S.sheet); emit('loaded'); };

window.P = { state: S, load, openSheet, commit, follow, prov, focus, highlightFinding, on: (ev, fn) => (listeners[ev] ||= []).push(fn) };
load('first_pass');
