/* Principia demo overlay: sheets as images, claims as SVG boxes, the beam as a BFS over support
   edges, the trace drawn on the pipes themselves. Reads ui/out/first_pass.json and moc.json via server.py. */
const SHEETS = ["MM0011","MM0012","MM0013","MM0014","MM0015","MM0016","MM0017"];
const RANK = {refuted:5, open:4, obligated:3, derived:2, asserted:1};
const EXTRA_ANCHORS = {
  '16"-E4B-CO-1004': {MM0011:[2230,760,230,48], MM0012:[380,745,260,48]},
  '16"-E4B-CO-1005': {MM0012:[760,460,250,48], MM0013:[380,700,250,48]},
  '16"-E4B-CO-1006': {MM0012:[760,1035,250,48], MM0013:[380,1275,250,48]},
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
  if (!S.booted) { S.booted = true; openGrid('lopa'); }
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
const FEAT = { qra:'From an open LOPA row to a scoped QRA', pid:'Interactive P&IDs', grid:'Smart saves that mitigate PHA fatigue' };
function setMode(m){ S.mode = m; $('#demoTitle').innerHTML = FEAT[m]; $$('#demo .feat').forEach(f=>f.classList.toggle('cur', f.dataset.f===m)); }
function openSheet(name){
  closeQra(); setMode('pid');
  S.sheet = name; $('#sheet').classList.add('on'); $('#strip').style.display='none'; closeGrid();
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
    const [x0,y0,w0,h0] = box.map(Number); const inset = (w0<=60 && h0<=60) ? 6 : 2;
    const x = x0+inset, y = y0+inset, w = w0-2*inset, h = h0-2*inset;
    const extra = (S.focus.includes(subj) ? ' focus' : '') + (S.hlKind && kindPrefix(subj)===S.hlKind ? ' hl' : '');
    out += `<rect class="box ${st}${extra}" data-subj="${esc(subj)}" x="${x}" y="${y}" width="${w}" height="${h}" style="color:${st==='refuted'?'var(--bad)':st==='derived'?'var(--ok)':'var(--warn)'}"><title>${subj}: ${st} · click for dependencies</title></rect>`;
    if (st!=='asserted') {
      const fs = findingsFor(subj); const rules = [...new Set(fs.map(f=>f.rule))].join(' ');
      const txt = st==='refuted' ? `✕ ${labelTag} ${rules}` : st==='open' ? `? ${labelTag} ${rules||'question'}` : st==='obligated' ? `… ${labelTag}` : `✓ ${labelTag} ${rules}`;
      out += `<text class="callout ${st}" x="${x+w+10}" y="${y-6}">${txt}</text>`;
    }
  };
  for (const t of S.index.filter(t=>t.sheet===name)) draw(t.tag, [t.x,t.y,t.w,t.h], t.tag);
  for (const [subj, per] of Object.entries(EXTRA_ANCHORS)) if (per[name]) draw(subj, per[name], subj);
  if (S.phase==='moc') for (const [tag] of (STOPS[name]||[])) if (subjectStatus(tag,bySubj,overrides)==='open') {
    const t = S.index.find(t=>t.tag===tag && t.sheet===name); if (!t) continue; const x = +t.x, y = +t.y, w = +t.w, h = +t.h;
    out += `<text class="stoplbl" x="${x+w+4}" y="${y+h+16}">documents run out here</text>`;
  }
  // trace on the pipes (e): only after the MOC, drawn last so it always sits on top of the boxes
  if (S.phase==='moc' && PIPES[name]) {
    const sc = sheetColor(name, bySubj); const col = sc==='red'?'red':sc==='green'?'green':'amber';
    for (const r of PIPES[name]) out += `<polyline class="trace ${col}" points="${r.map(p=>p.join(',')).join(' ')}"/>`;
  }
  svg.innerHTML = out;
  svg.querySelectorAll('rect.box').forEach(r=>r.onclick=e=>{ e.stopPropagation(); const c = claimForSubject(r.dataset.subj); if (c) deps(c.id); });
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
  if (String(p.doc||'').startsWith('synthetic')) return `${String(p.doc).replace(/^synthetic /,'')} row ${p.row}` + (p.span?` (${p.span})`:'');
  if (p.doc==='solver') return 'decided by the solver';
  return [p.doc, p.clause||p.row].filter(Boolean).join(' ');
}
function claimLine(id){ const c = (S.data.claims||[]).find(c=>c.id===id); if (!c) return `<div class="prov">${id}</div>`;
  return `<div class="prov"><b>${c.subject}</b> ${c.body||''}<br>${prov(c.provenance)}${c.provenance?.span?` — “${String(c.provenance.span).slice(0,140)}”`:''}</div>`; }
function diffCount(d){ const byIdF = Object.fromEntries((d.findings||[]).map(f=>[f.id,f])); return k => dedupe(((d.diff||{})[k]||[]).map(i=>byIdF[i]).filter(Boolean)).length; }
function dedupe(list){ const seen = new Map(); for (const f of list) { const k = (f.body||f.subgoal||'')+'|'+f.status; if (seen.has(k)) seen.get(k).also.push(f.scenario_id||f.subject); else seen.set(k, Object.assign({}, f, {also: []})); } return [...seen.values()]; }
function card(f){
  const st = f.status==='holds'?'derived':f.status;
  const sup = (f.core && f.core.length ? f.core : (f.support||[])).slice(0,6).map(claimLine).join('');
  const model = f.model && Object.keys(f.model).length ? `<div class="prov">counterexample: ${Object.entries(f.model).map(([k,v])=>k+'='+v).join(', ')}</div>` : '';
  const q = f.question ? `<div class="prov">→ question to <b>${f.question.to_role}</b>: ${f.question.text}</div>` : '';
  const also = f.also && f.also.length ? `<div class="prov">same result for ${f.also.map(esc).join(', ')}</div>` : '';
  return `<div class="card" data-f="${f.id||''}"><div class="head"><span class="st ${st}">${f.status}</span><span class="tag">${f.rule} · ${esc(f.subject||'')}${f.scenario_id?' · '+esc(f.scenario_id):''}</span></div><div class="body">${f.body||f.subgoal||''}</div>${sup}${model}${q}${also}</div>`;
}
function esc(s){ return String(s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function renderPanelBeam(n, subj){ $('#panel').innerHTML = `<h2>Committing MOC-001</h2><div class="empty">Propagating along “rests on” edges… ${n} subjects obligated so far.</div><div class="card"><div class="head"><span class="st obligated">obligated</span><span class="tag">${esc(subj)}</span></div><div class="body">Every claim that rests on ${esc(subj)} is now an obligation to re-derive.</div></div>`; }
function legendHtml(){
  return `<div id="legend" class="${S.legendOn?'on':''}"><table class="h"><tr><th>tag</th><th>component</th><th>role in this review</th></tr>${LEGEND.map(([k,n,r])=>`<tr data-k="${k.split(' ')[0]}"><td class="k">${k}</td><td>${n}</td><td>${r}</td></tr>`).join('')}</table><div class="prov">click a row to highlight that component type on the sheet · <b>✕</b> refuted: a rule the rows contradict · <b>✓</b> re-derived: proved from the rows · <b>?</b> open: a question with a name on it · <b>…</b> obligated: rests on something that changed</div></div>`;
}
function renderPanel(){
  buildGraph(); GRID.tables = null; GRID.edits = {};
  const d = S.data; if (!d || d.error) { $('#panel').innerHTML = `<div class="empty">${d?.error||'no data'}</div>`; return; }
  const F = dedupe(d.findings||[]); const refuted = F.filter(f=>f.status==='refuted'); const open = F.filter(f=>f.status==='open'); const ok = F.filter(f=>f.status==='holds'||f.status==='derived');
  const qs = d.questions||[];
  let h = `<h2>${S.phase==='moc' ? 'After MOC-001' : 'First pass, before the MOC'}</h2>
  <div class="tag">ledger totals · all ${F.length} findings ${S.phase==='moc' ? 'after' : 'before'} MOC-001</div>
  <div class="kpi"><div class="r" data-st="refuted" title="list them"><b>${refuted.length}</b><span>refuted</span></div><div class="a" data-st="open" title="list them"><b>${open.length||qs.length}</b><span>open</span></div><div class="g" data-st="holds" title="list them"><b>${ok.length}</b><span>re-derived</span></div></div>` + legendHtml();
  if (S.phase==='moc' && d.diff) { const df = d.diff; const cnt = diffCount(d); const re = ['refuted','re_derived','opened','unchanged'].reduce((a,k)=>a+cnt(k),0);
    h += `<div class="prov"><b>This transition (MOC-001)</b> · ${(d.obligated||[]).length} claims obligated · ${re} findings re-decided: ${cnt('refuted')} newly refuted · ${cnt('re_derived')} newly re-derived · ${cnt('opened')} newly opened · ${cnt('unchanged')} unchanged</div>`; }
  h += `<h3>Refuted</h3>` + (refuted.length ? refuted.map(card).join('') : `<div class="empty">nothing refuted</div>`);
  h += `<h3>Open · to whom</h3>`;
  const openCards = open.map(card).join('');
  const qCards = qs.filter(q=>q.status!=='answered').map(q=>`<div class="card" data-c="${q.claim_id}"><div class="head"><span class="st open">question</span><span class="tag">${q.id}</span></div><div class="body">${q.text}</div><div class="prov">to <b>${q.to_role}</b></div>
     <div class="q"><input id="ans-${q.id}" placeholder="answer as ${q.to_role.split(' (')[0]} (e.g. 1650 psig)"><button data-q="${q.id}" class="ansbtn">Answer</button></div></div>`).join('');
  const answered = qs.filter(q=>q.status==='answered').map(q=>`<div class="card" data-c="${q.claim_id}"><div class="head"><span class="st derived">answered</span><span class="tag">${q.id}</span></div><div class="body">${q.text}</div><div class="prov">axiom entered by <b>${q.by_role||q.to_role}</b>: ${q.answer||''}</div></div>`).join('');
  h += (openCards+qCards+answered) || `<div class="empty">no open questions</div>`;
  if (d.historian && d.historian.length) {
    h += `<h3>Historian evidence</h3><table class="h"><tr><th>excursion</th><th>tag</th><th>rise psi/min</th><th>basis</th></tr>`;
    const seen = new Set(); for (const r of d.historian) { if (seen.has(r.excursion_id)) continue; seen.add(r.excursion_id);
      const basis = S.phase==='moc' ? 12 : 5; const v = +r.rise_rate_psi_min;
      h += `<tr><td>${r.excursion_id}</td><td>${r.tag}</td><td>${v}</td><td style="color:${v>basis?'#ffb3bb':'var(--faint)'}">${v>basis?'exceeds':'within'} ${basis}</td></tr>`; }
    h += `</table><div class="prov">data refutes a rate basis; it never proves one.</div>`;
  }
  h += `<h3>Re-derived</h3>` + (ok.length ? ok.map(card).join('') : `<div class="empty">none yet</div>`);
  h += `<div class="limits"><b>Limits.</b> ${esc(d.limits||'')}</div>`;
  $('#panel').innerHTML = h;
  $('#panel').querySelectorAll('.kpi [data-st]').forEach(t=>t.onclick=()=>depsList(t.dataset.st));
  $('#panel').querySelectorAll('.card[data-f] .head').forEach(h=>h.onclick=()=>deps(h.parentElement.dataset.f));
  $('#panel').querySelectorAll('.card[data-c] .head').forEach(h=>h.onclick=()=>deps(h.parentElement.dataset.c));
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
  st.addEventListener('mousedown', e=>{ if(!S.sheet || e.target.closest('#dialog,#sheetbar,#deps,#grid')) return; drag={x:e.clientX,y:e.clientY,tx:S.tx,ty:S.ty}; });
  window.addEventListener('mousemove', e=>{ if(!drag) return; S.tx=drag.tx+(e.clientX-drag.x); S.ty=drag.ty+(e.clientY-drag.y); applyT(); });
  window.addEventListener('mouseup', ()=>drag=null);
  st.addEventListener('wheel', e=>{ if(!S.sheet || e.target.closest('#dialog,#deps,#grid')) return; e.preventDefault(); const r=st.getBoundingClientRect(); const mx=e.clientX-r.left, my=e.clientY-r.top;
    const k = Math.exp(-e.deltaY*0.0015); const ns = Math.min(3, Math.max(0.2, S.scale*k)); S.tx = mx-(mx-S.tx)*(ns/S.scale); S.ty = my-(my-S.ty)*(ns/S.scale); S.scale=ns; applyT(); }, {passive:false});
  window.addEventListener('resize', ()=>{ if(S.sheet) fit(); });
})();
$('#btnStrip').onclick = ()=>{ closeQra(); setMode('pid'); $('#sheet').classList.remove('on'); closeGrid(); $('#strip').style.display='grid'; S.sheet=null; if (S.follow) follow(); };
$('#btnCommit').onclick = commit;
$('#btnFollow').onclick = follow;
$('#btnLegend').onclick = ()=>{ S.legendOn = !S.legendOn; const l = $('#legend'); if (l) l.classList.toggle('on', S.legendOn); };
$('#btnReset').onclick = async()=>{ $('#btnReset').disabled=true; const r = await getJSON('/api/reset',{method:'POST',body:'{}'}); $('#btnReset').disabled=false;
  if (r.error) return alert(r.error); S.data=r; S.phase='first_pass'; $('#phase').textContent='phase: first pass (before the MOC)';
  $('#btnCommit').disabled=false; $('#btnCommit').textContent='Commit MOC-001'; $('#btnFollow').disabled=true; if (S.follow) follow(); S.focus=[];
  $('#dlog').innerHTML = '<div class="empty">Press “Ask as the engineer”.</div>'; GRID.edits = {}; $('#grid .ggate').classList.remove('on'); $('#deps').classList.remove('on'); DEP.cur = null; if ($('#grid').classList.contains('on')) renderGrid(); renderStrip(); renderPanel(); if (S.sheet) renderSheet(S.sheet); emit('loaded'); };


/* ---------- dependency click (amendment 01, feature 1): a traversal of the support edges, both ways ---------- */
const DEP = { up:{}, down:{}, byId:{}, open:new Set(), cur:null };
const DEP_DEPTH = 3, DEP_CAP = 200;
function buildGraph(){
  DEP.up = {}; DEP.down = {}; DEP.byId = {};
  for (const c of (S.data?.claims||[])) DEP.byId[c.id] = c;
  for (const [a,b] of (S.data?.support||[])) { (DEP.up[a] ||= []).push(b); (DEP.down[b] ||= []).push(a); }
}
function hasDoc(c){ const p = c.provenance||{}; return !!(p.sheet || p.page || p.doc); }
function stOf(c){ return c.status==='holds' ? 'derived' : (c.status||'asserted'); }
function claimForSubject(subj){ return DEP.byId['tag-'+subj] || (S.data?.claims||[]).find(c=>c.subject===subj) || null; }
function whereOf(c){ const p=c.provenance||{}; if (c.type==='derived') return 'findings'; return p.sheet ? `sheet ${p.sheet}` : p.doc ? String(p.doc).replace(/^synthetic /,'') : 'no document'; }
function nodeHtml(id, depth, dir, counter, path){
  const c = DEP.byId[id]; if (!c) return `<div class="dn"><span class="st amber">?</span> ${esc(id)} <span class="dp">not in the ledger</span></div>`;
  if (path.has(id)) return '';
  if (counter.n++ >= DEP_CAP) { counter.cut = true; return ''; }
  const kids = (dir==='up' ? DEP.up : DEP.down)[id] || [];
  const amber = !hasDoc(c); const st = amber ? 'amber' : stOf(c);
  const key = dir+':'+id; const openNow = depth < DEP_DEPTH || DEP.open.has(key);
  let h = `<div class="dn"><div class="dl"><span class="st ${st}">${amber?'no source':esc(c.status||'asserted')}</span><span class="dt">${esc(c.type||'')}</span> <a class="dgo" data-id="${esc(id)}" title="go to it">${esc(c.subject||'')}</a> <span class="db">${esc((c.body||'').slice(0,120))}</span><span class="dp">${amber?'no document states this.':esc(prov(c.provenance))}</span></div>`;
  if (kids.length) {
    const p2 = new Set(path); p2.add(id);
    if (openNow) h += `<div class="dk">${kids.map(k=>nodeHtml(k, depth+1, dir, counter, p2)).join('')}</div>`;
    else h += `<a class="dx" data-key="${esc(key)}">expand · ${kids.length} beneath</a>`;
  }
  return h + `</div>`;
}
function deps(id){ if (!DEP.byId[id]) buildGraph(); if (!DEP.byId[id]) return; DEP.cur = id; DEP.open = new Set(); renderDeps(); }
function renderDeps(){
  const id = DEP.cur; const c = DEP.byId[id]; const el = $('#deps'); if (!c) { el.classList.remove('on'); return; }
  const up = DEP.up[id]||[], down = DEP.down[id]||[];
  const cu = {n:0,cut:false}, cd = {n:0,cut:false}; const root = new Set([id]);
  const upHtml = up.length ? up.map(k=>nodeHtml(k,1,'up',cu,root)).join('') : `<div class="empty">a leaf: nothing in the ledger beneath it</div>`;
  const groups = {}; for (const k of down) { const kc = DEP.byId[k]; const g = kc ? whereOf(kc) : 'unknown'; (groups[g] ||= []).push(k); }
  const downHtml = down.length ? Object.entries(groups).map(([g,ids])=>`<div class="dg"><div class="dgh">${esc(g)} · ${ids.length}</div>${ids.map(k=>nodeHtml(k,1,'down',cd,root)).join('')}</div>`).join('') : `<div class="empty">nothing in the ledger rests on this</div>`;
  const others = (S.data.claims||[]).filter(x=>x.id!==id && (x.subject===c.subject || (ALIAS[x.subject]||[]).includes(c.subject) || (ALIAS[c.subject]||[]).includes(x.subject))).slice(0,8);
  const amber = !hasDoc(c);
  const src = String(S.data.limits||'').replace(/^Phase:[^.]*\.\s*/,'').split(' Claims:')[0];
  const limits = `Traversal of ${(S.data.support||[]).length} support edges in the ledger, both directions, depth ${DEP_DEPTH} by default${cu.cut?'; upstream truncated at '+DEP_CAP+' nodes':''}${cd.cut?'; downstream truncated at '+DEP_CAP+' nodes':''}. No new reasoning: an edge appears only if the ledger recorded it; an edge the ledger lacks is a gap, not an absence. ${esc(src)}`;
  el.innerHTML = `<div class="dh"><b>Dependencies</b> · ${esc(c.subject||'')} <span class="st ${amber?'amber':stOf(c)}">${amber?'no source':esc(c.status||'asserted')}</span><div class="spacer"></div><button id="dclose" title="close">×</button></div>
  <div class="dbody">
    <div class="dhead"><span class="dt">${esc(c.type||'')}</span> ${esc(c.body||'')}<div class="dp">${amber?'no document states this.':esc(prov(c.provenance))}${c.provenance?.span?` — “${esc(String(c.provenance.span).slice(0,160))}”`:''}</div>
      ${others.length?`<div class="chips">also about this: ${others.map(o=>`<a class="chip" data-id="${esc(o.id)}">${esc(o.type)} · ${esc(o.id)}</a>`).join('')}</div>`:''}</div>
    <h3>Rests on · ${up.length}</h3>${upHtml}
    <h3>Depended on by · ${down.length}</h3>${downHtml}
    <div class="limits"><b>Limits.</b> ${limits}</div>
  </div>`;
  el.classList.add('on');
  el.querySelector('#dclose').onclick = ()=>{ el.classList.remove('on'); DEP.cur=null; };
  el.querySelectorAll('.dx').forEach(a=>a.onclick=()=>{ DEP.open.add(a.dataset.key); renderDeps(); });
  el.querySelectorAll('.chip').forEach(a=>a.onclick=()=>deps(a.dataset.id));
  el.querySelectorAll('.dgo').forEach(a=>a.onclick=()=>goTo(a.dataset.id));
}
function depsList(status){
  const el = $('#deps'); const F = dedupe(S.data.findings||[]).filter(f => status==='holds' ? (f.status==='holds'||f.status==='derived') : f.status===status);
  const qs = status==='open' ? (S.data.questions||[]).filter(q=>q.status!=='answered') : [];
  el.innerHTML = `<div class="dh"><b>${F.length+qs.length} ${esc(status==='holds'?'re-derived':status)}</b> · the findings behind the tile<div class="spacer"></div><button id="dclose">×</button></div><div class="dbody">
    ${F.map(f=>`<div class="dn"><div class="dl"><span class="st ${stOf(f)}">${esc(f.status)}</span><span class="dt">${esc(f.rule)}</span> <a class="dgo" data-id="${esc(f.id)}">${esc(f.subject||'')}${f.scenario_id?' · '+esc(f.scenario_id):''}</a> <span class="db">${esc((f.body||f.subgoal||'').slice(0,140))}</span>${f.also&&f.also.length?`<span class="dp">same result for ${esc(f.also.join(', '))}</span>`:''}</div></div>`).join('')}
    ${qs.map(q=>`<div class="dn"><div class="dl"><span class="st open">question</span> <a class="dgo" data-id="${esc(q.claim_id)}">${esc(q.id)}</a> <span class="db">${esc(q.text)}</span><span class="dp">to ${esc(q.to_role)}</span></div></div>`).join('')}
    <div class="limits"><b>Limits.</b> The ledger's distinct findings with this status; a finding that holds for more than one scenario is listed once and names the others. The count is a total, not a diff.</div></div>`;
  el.classList.add('on');
  el.querySelector('#dclose').onclick = ()=>el.classList.remove('on');
  el.querySelectorAll('.dgo').forEach(a=>a.onclick=()=>goTo(a.dataset.id));
}
function panTo(bbox){
  const [x,y,w,h] = bbox.map(Number); const st = $('#stage').getBoundingClientRect();
  S.scale = Math.max(S.scale, 1); S.tx = st.width/2 - (x+w/2)*S.scale; S.ty = st.height/2 - (y+h/2)*S.scale; applyT();
}
function goTo(id){
  const c = DEP.byId[id]; if (!c) return;
  const p = c.provenance||{};
  if (p.sheet) { openSheet(p.sheet); focus([c.subject]); const t = S.index.find(t=>t.tag===c.subject); const bb = p.bbox || (t ? [t.x,t.y,t.w,t.h] : null); if (bb) panTo(bb); }
  const f = (S.data.findings||[]).find(f=>f.id===id); if (f) highlightFinding(f);
  if (!p.sheet && !f) { const g = GRID.tables && Object.entries(GRID.tables).find(([k,t])=>t.rows.some(r=>r.id===id)); if (g) { openGrid(g[0]); const td = $(`#grid tr[data-id="${CSS.escape(id)}"]`); if (td) { td.scrollIntoView({block:'center'}); td.classList.add('hl'); setTimeout(()=>td.classList.remove('hl'), 2500); } } }
  deps(id);
}

/* ---------- the grid (amendment 01, feature 3): the ledger's document tables as a spreadsheet ---------- */
const $$ = s => document.querySelectorAll(s);
const GRID = { tables:null, tab:'madb', edits:{}, prefs:{}, menu:false };
const GRID_TABLES = [['lopa','LOPA','synthetic lopa'],['srs','SRS','synthetic srs'],['madb','Alarm DB (MADB)','synthetic madb'],['dcs','DCS alarms','synthetic dcs'],['ce','Cause & effect','synthetic ce_matrix'],['index','Instrument index','tag-']];
function loadPrefs(){ try { GRID.prefs = JSON.parse(localStorage.getItem('tundra.grid.v1')||'{}') || {}; } catch (e) { GRID.prefs = {}; } }
function savePrefs(){ try { localStorage.setItem('tundra.grid.v1', JSON.stringify(GRID.prefs)); } catch (e) {} }
function buildTables(){
  GRID.tables = {};
  for (const [key, title, sel] of GRID_TABLES) {
    const rows = (S.data?.claims||[]).filter(c => sel.endsWith('-') ? c.id.startsWith(sel) : String(c.provenance?.doc||'')===sel);
    const cols = []; for (const r of rows) for (const k of Object.keys(r.attrs||{})) if (!cols.includes(k)) cols.push(k);
    GRID.tables[key] = { title, rows, cols:['subject', ...cols, 'status', 'provenance'] };
  }
}
function cellVal(r, col){
  const e = GRID.edits[r.id+'|'+col]; if (e) return e.after;
  if (col==='subject') return r.subject; if (col==='status') return r.status; if (col==='provenance') return prov(r.provenance);
  const v = (r.attrs||{})[col]; return v==null ? '' : (typeof v==='object' ? JSON.stringify(v) : String(v));
}
const gridMode = () => GRID.tab==='lopa' ? 'qra' : 'grid';
function openGrid(tab){
  if (tab) GRID.tab = tab;
  setMode(gridMode());
  if (!GRID.tables) { buildGraph(); buildTables(); loadPrefs(); }
  $('#sheet').classList.remove('on'); $('#strip').style.display='none'; $('#grid').classList.add('on'); S.sheet = null; if (S.follow) follow();
  renderGrid();
}
function closeGrid(){ $('#grid').classList.remove('on'); }

/* ---------- QRA scoping (amendment 01, feature 2): the structure a QRA would need, drawn from the ledger. Never a risk result. ---------- */
const AMBER = 'no document states this';
function scenarioStatus(sc){ const F = (S.data?.findings||[]).filter(f => f.scenario_id===sc || f.subject===sc); return F.some(f=>f.status==='refuted') ? 'refuted' : F.some(f=>f.status==='open') ? 'open' : F.length ? 'holds' : 'none'; }
function qraEligible(sc){ const st = scenarioStatus(sc); return st==='refuted' || st==='open'; }
const CHW = { ql: 7.0, qs: 6.4 };
function wrapLine(text, maxChars){
  const words = String(text).split(/\s+/); const out = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > maxChars && cur) { out.push(cur); cur = w; } else cur = (cur ? cur + ' ' : '') + w; }
  if (cur) out.push(cur); return out.length ? out : [''];
}
function boxLines(w, lines){ return lines.flatMap((l,i) => wrapLine(l, Math.floor((w-20)/(i?CHW.qs:CHW.ql))).map(t => ({t, cls: i?'qs':'ql'}))); }
function boxH(w, lines){ return 14 + boxLines(w, lines).length*15 + 4; }
function svgBox(x,y,w,h,lines,cls,id){
  const ls = boxLines(w, lines); const hh = h || (14 + ls.length*15 + 4);
  const t = ls.map((l,i)=>`<text x="${x+10}" y="${y+18+i*15}" class="${l.cls}">${esc(l.t)}</text>`).join('');
  return `<g class="qn ${cls||''}" ${id?`data-id="${esc(id)}"`:''}><rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="8"/>${t}</g>`;
}
function svgLine(x1,y1,x2,y2,cls){ return `<path d="M${x1},${y1} L${x2},${y2}" class="qe ${cls||''}"/>`; }
function gate(x,y,kind){ return `<g class="qg"><circle cx="${x}" cy="${y}" r="13"/><text x="${x}" y="${y+4}" text-anchor="middle">${kind}</text></g>`; }
function findClaim(pred){ return (S.data?.claims||[]).find(pred); }
function openQra(sc){
  buildGraph();
  const rows = (S.data.claims||[]).filter(c => c.id.startsWith('lopa-') && c.attrs?.scenario_id===sc);
  if (!rows.length) return;
  const hz = DEP.byId['hazop-'+rows[0].attrs.hazop_cause_id] || null;
  const consequence = rows[0].attrs.consequence || hz?.attrs?.consequence || AMBER;
  const findings = (S.data.findings||[]).filter(f => f.scenario_id===sc || f.subject===sc);
  const shared = [...new Set(findings.filter(f=>f.shared_component).map(f=>f.shared_component))];
  // initiating events: the LOPA row's IE source, and the HAZOP cause it derives from
  const ies = [{ id: rows[0].id, label: rows[0].attrs.ief_source || 'initiating event', ief: rows[0].attrs.ief_per_yr, hz: hz }];
  const layers = rows.map(r => {
    const srs = r.attrs.ipl_type==='SIF' ? findClaim(c => c.id.startsWith('srs-') && c.attrs?.sensor===r.attrs.sensor) : null;
    const lam = findClaim(c => /lambda|λ|dangerous undetected/i.test(String(c.body||'')) && c.subject===(srs?.subject||r.attrs.sensor)) || null;
    return { id: r.id, ipl: r.attrs.ipl_id||r.subject, desc: r.attrs.ipl_description, pfd: r.attrs.pfd, sensor: r.attrs.sensor, srs, lam, sharedWith: shared.filter(s => s===r.attrs.sensor) };
  });
  // ---- fault tree ----
  const W = 980; let ft = '';
  const topL = ['TOP EVENT · '+sc, consequence]; const topW = 420, topH = boxH(topW, topL);
  ft += svgBox(W/2-topW/2, 16, topW, 0, topL, 'top', rows[0].id);
  const orY = 16 + topH + 26; ft += svgLine(W/2, 16+topH, W/2, orY-13) + gate(W/2, orY, 'OR');
  const ieW = 360, ieY = orY + 30; const ieXs = ies.map((_,i) => W/2 - (ies.length*ieW + (ies.length-1)*40)/2 + i*(ieW+40));
  let ieH = 0; const ieLs = ies.map(ie => ['INITIATING EVENT', ie.label, `IEF ${ie.ief}/yr (LOPA row)${ie.hz?' · HAZOP cause: '+ie.hz.attrs.cause:''}`]);
  ies.forEach((ie,i) => { const x = ieXs[i]; const h = boxH(ieW, ieLs[i]); ieH = Math.max(ieH, h); ft += svgLine(W/2, orY+13, x+ieW/2, ieY) + svgBox(x, ieY, ieW, h, ieLs[i], 'ie', ie.id); });
  const andY = ieY + ieH + 28; ft += svgLine(ieXs[0]+ieW/2, ieY+ieH, ieXs[0]+ieW/2, andY-13) + gate(ieXs[0]+ieW/2, andY, 'AND');
  const lw = 440, ly = andY + 32; const lxs = layers.map((_,i) => W/2 - (layers.length*lw + (layers.length-1)*30)/2 + i*(lw+30));
  const layLs = layers.map(L => {
    const l2 = L.srs ? `voting ${L.srs.attrs.voting} · proof test ${L.srs.attrs.pst_interval_yr} yr · SIL target ${L.srs.attrs.sil_target} (SRS)` : rows.find(r=>r.id===L.id).attrs.ipl_type==='SIF' ? 'SRS row: '+AMBER : 'operator layer: no SRS row applies';
    const l3 = L.lam ? `PFD(t) ≈ λ_DU·t` : `PFD(t) ≈ λ_DU·t: λ_DU ${AMBER}`;
    return [`${L.ipl} · must fail`, L.desc||'', `PFD ${L.pfd} (LOPA row) · sensor ${L.sensor}`, l2, l3];
  });
  let lh = 0; layLs.forEach(ls => lh = Math.max(lh, boxH(lw, ls)));
  layers.forEach((L,i) => { const x = lxs[i]; ft += svgLine(ieXs[0]+ieW/2, andY+13, x+lw/2, ly) + svgBox(x, ly, lw, lh, layLs[i], L.lam ? 'layer' : 'layer amberline', L.id); });
  let shY = ly+lh+48; const shW = 420; const shLs = ['', 'one node feeding every gate it serves (structural rule R1)']; const shH = boxH(shW, shLs);
  shared.forEach((s, k) => { const sc_ = claimForSubject(s); const x = W/2-shW/2, y = shY + k*(shH+24);
    ft += svgBox(x, y, shW, shH, [`SHARED COMPONENT · ${s}`, shLs[1]], 'shared', sc_?.id);
    layers.forEach((L,i) => { if (L.sharedWith.includes(s)) ft += svgLine(x+shW/2, y, lxs[i]+lw/2, ly+lh, 'shared'); });
    ft += svgLine(x+shW/2, y, ieXs[0]+ieW/2, ieY+ieH, 'shared');
  });
  const ftH = shY + shared.length*(shH+24) + 10;
  // ---- event tree ----
  const words = consequence.toLowerCase();
  const outcomes = []; if (/overpressure/.test(words)) outcomes.push('Overpressure of piping'); if (/release/.test(words)) outcomes.push('Release'); if (/ignit|fire/.test(words)) outcomes.push('Ignition'); if (/injur|exposure|asphyx/.test(words)) outcomes.push('Exposure of people');
  const fluid = findClaim(c => c.id==='tag-TP-01')?.attrs?.service; const dp = findClaim(c => c.id==='limit-MS-1001-design_pressure'); const op = DEP.byId['rate_basis'];
  const inputs = [
    ['fluid', fluid ? 'CO2, dense phase ('+fluid+')' : null, fluid ? 'tag-TP-01' : null],
    ['inventory between isolations', null, null],
    ['hole size / release case', null, null],
    ['pressure at release', dp ? (dp.body||'').slice(0,70) : null, dp ? dp.id : null],
    [`operating pressure (rate basis, ${S.phase==='moc' ? 'after' : 'before'} MOC-001)`, op ? `${op.attrs?.ccs_discharge_psig} psig · rise ${op.attrs?.rise_rate_psi_min} psi/min` : null, op ? 'rate_basis' : null],
    ['temperature', null, null],
    ['weather set', null, null],
    ['congestion / layout', null, null],
    ['population / occupancy', null, null],
  ];
  const cases = outcomes.map((o,i) => ({ name: o, amber: inputs.filter(x=>!x[1]).map(x=>x[0]) }));
  let et = ''; const cx = 20, cy = 60; et += svgBox(cx, cy-24, 190, 48, ['TOP EVENT', sc+' occurs'], 'top', rows[0].id);
  const step = Math.max(190, Math.floor((W-240)/Math.max(1,cases.length)));
  const caseLs = cases.map(c => [c.name.toUpperCase(), c.amber.length ? `${c.amber.length} inputs: ${AMBER}` : 'inputs on record']);
  let ch = 48; caseLs.forEach(ls => ch = Math.max(ch, boxH(step-30, ls)));
  cases.forEach((c,i) => { const x = cx+210+i*step, y = cy-24; et += svgLine(x-20, cy, x, cy) + svgBox(x, y, step-30, ch, caseLs[i], c.amber.length ? 'amber' : 'ok');
    et += svgLine(x+(step-30)/2, y+ch, x+(step-30)/2, y+ch+24) + `<text x="${x+(step-30)/2}" y="${y+ch+38}" class="qs" text-anchor="middle">yes / no</text>`; });
  const etH = cy-24+ch+78;
  et += `<text x="${cx}" y="${etH-14}" class="qs">Branch probabilities on every node: ${AMBER}. The branches are the outcomes the HAZOP consequence names, in the order it names them.</text>`;
  // ---- inputs ledger + amber list ----
  const led = inputs.map(([k,v,id]) => { const c = id ? DEP.byId[id] : null; return `<tr class="${v?'':'amb'}"><td>${esc(k)}</td><td>${v?esc(v):'<span class="st amber">'+AMBER+'</span>'}</td><td class="mono">${c?`<a class="dgo" data-id="${esc(id)}">${esc(id)}</a> · ${esc(prov(c.provenance))}`:'—'}</td></tr>`; }).join('');
  const lamRows = layers.map(L => `<tr class="${L.lam?'':'amb'}"><td>λ_DU for ${esc(L.ipl)} (${esc(L.sensor)})</td><td>${L.lam?esc(L.lam.body):'<span class="st amber">'+AMBER+'</span>'}</td><td class="mono">${L.lam?esc(L.lam.id):'—'}</td></tr>`).join('');
  const amberList = [...inputs.filter(x=>!x[1]).map(x=>x[0]), ...layers.filter(L=>!L.lam).map(L=>`λ_DU for ${L.ipl} (${L.sensor})` + (L.srs?.attrs?.pst_interval_yr ? ` over the ${L.srs.attrs.pst_interval_yr} yr test interval` : ', and a test interval: none on record for this layer')), 'branch probabilities for each event-tree node', ...(outcomes.length?[]:['the outcome set: the HAZOP consequence names no outcome'])];
  const src = String(S.data.limits||'').replace(/^Phase:[^.]*\.\s*/,'').split(' Claims:')[0];
  $('#qra').innerHTML = `<div class="dh"><b>QRA scoping</b> · ${esc(sc)} <span class="st ${scenarioStatus(sc)}">${esc(scenarioStatus(sc))}</span><div class="spacer"></div><button id="qclose">×</button></div>
  <div class="qbody">
    <p class="gline">The structure a QRA of ${esc(sc)} would need, read off the ledger. No risk result is computed or shown here: no frequency of harm, no contour, no F–N curve.</p>
    <h3>1 · Fault tree for the top event</h3>
    <svg viewBox="0 0 ${W} ${ftH}" class="qsvg" style="height:${ftH}px">${ft}</svg>
    <h3>2 · Event tree from the top event</h3>
    <svg viewBox="0 0 ${W} ${etH}" class="qsvg" style="height:${etH}px">${et}</svg>
    <h3>3 · Inputs ledger</h3>
    <table class="h qt"><tr><th>input</th><th>value on record</th><th>provenance</th></tr>${led}${lamRows}</table>
    <h3>4 · What a QRA would still have to measure</h3>
    <textarea class="qcopy" readonly>${esc(amberList.map(x=>'- '+x).join('\n'))}</textarea>
    <div class="limits"><b>Limits.</b> Trees are the support graph re-drawn with gates: initiating events and layers from the LOPA rows, voting and test interval from the SRS row, the shared component from the structural finding R1. Every amber item is a gap, not an estimate; nothing is filled in. No fault-tree solving, no minimal cut sets, no branch probabilities. ${esc(src)}</div>
  </div>`;
  $('#qra').classList.add('on'); setMode('qra');
  $('#qra #qclose').onclick = ()=>{ closeQra(); setMode($('#grid').classList.contains('on') ? gridMode() : 'pid'); };
  $$('#qra .qn[data-id], #qra .dgo').forEach(n => n.onclick = () => deps(n.dataset.id));
}
function closeQra(){ $('#qra').classList.remove('on'); }

function renderGrid(){
  const t = GRID.tables[GRID.tab]; const pf = GRID.prefs[GRID.tab] ||= {order:null, hidden:[], filter:''};
  let order = (pf.order||[]).filter(c=>t.cols.includes(c)); for (const c of t.cols) if (!order.includes(c)) order.push(c);
  const vis = order.filter(c=>!pf.hidden.includes(c));
  const q = (pf.filter||'').toLowerCase();
  const rows = t.rows.filter(r => !q || vis.some(c => cellVal(r,c).toLowerCase().includes(q)));
  $('#grid .gtabs').innerHTML = GRID_TABLES.map(([k,title])=>`<span class="pill ${k===GRID.tab?'cur':''}" data-t="${k}">${title} <i>${GRID.tables[k].rows.length}</i></span>`).join('');
  $('#grid .gfilter').value = pf.filter||'';
  const nEdits = Object.keys(GRID.edits).length; $('#grid .gsave').disabled = !nEdits; $('#grid .gsave').textContent = nEdits ? `Save ${nEdits} edit${nEdits>1?'s':''}` : 'Save';
  $('#grid .gcolmenu').innerHTML = order.map(c=>`<label><input type="checkbox" data-c="${esc(c)}" ${pf.hidden.includes(c)?'':'checked'}> ${esc(c)}</label>`).join('');
  $('#grid .gcolmenu').style.display = GRID.menu ? 'flex' : 'none';
  const qcol = GRID.tab==='lopa';
  const th = (qcol?'<th>QRA</th>':'') + vis.map((c,i)=>`<th><span class="mv" data-c="${esc(c)}" data-d="-1" title="move left">‹</span>${esc(c)}<span class="mv" data-c="${esc(c)}" data-d="1" title="move right">›</span></th>`).join('');
  const editable = c => !['subject','status','provenance'].includes(c);
  const body = rows.map(r=>`<tr data-id="${esc(r.id)}">${qcol?`<td class="act">${qraEligible(r.attrs?.scenario_id)?`<button class="qbtn" data-s="${esc(r.attrs.scenario_id)}">Scope a QRA</button>`:`<span class="tag">${esc(scenarioStatus(r.attrs?.scenario_id))}</span>`}</td>`:''}${vis.map(c=>{ const k=r.id+'|'+c; const ed = GRID.edits[k]; return `<td class="${c==='status'?'st-'+stOf(r):''} ${ed?'edited':''} ${editable(c)?'ed':''}" data-id="${esc(r.id)}" data-col="${esc(c)}" title="${ed?('was '+esc(ed.before)+' · '):''}${GRID.tab==='index'?'reference row':'click: what this rests on and what rests on it'} · double-click: edit">${esc(cellVal(r,c))}</td>`; }).join('')}</tr>`).join('');
  $('#grid table').innerHTML = `<thead><tr>${th}</tr></thead><tbody>${body || `<tr><td class="empty">no rows match</td></tr>`}</tbody>`;
  $('#grid .gcount').textContent = `${rows.length} of ${t.rows.length} rows · ${GRID.tab==='index' ? 'reference rows from the drawings' : 'click any cell for what it rests on and what rests on it'} · double-click to edit · column layout is kept in this browser only`;
  $$('#grid .gtabs .pill').forEach(p=>p.onclick=()=>{ GRID.tab = p.dataset.t; setMode(gridMode()); renderGrid(); });
  $('#grid .gfilter').oninput = e => { pf.filter = e.target.value; savePrefs(); renderGrid(); $('#grid .gfilter').focus(); };
  $$('#grid .gcolmenu input').forEach(i=>i.onchange=()=>{ pf.hidden = pf.hidden.filter(c=>c!==i.dataset.c); if (!i.checked) pf.hidden.push(i.dataset.c); savePrefs(); renderGrid(); });
  $$('#grid th .mv').forEach(m=>m.onclick=()=>{ const i = order.indexOf(m.dataset.c), j = i + (+m.dataset.d); if (j<0||j>=order.length) return; [order[i],order[j]]=[order[j],order[i]]; pf.order = order; savePrefs(); renderGrid(); });
  $$('#grid .qbtn').forEach(b=>b.onclick=e=>{ e.stopPropagation(); openQra(b.dataset.s); });
  $$('#grid td[data-id]').forEach(td=>{ td.onclick = ()=>{ if (td.querySelector('input') || GRID.tab==='index') return; deps(td.dataset.id); }; if (td.classList.contains('ed')) td.ondblclick = ()=>startEdit(td); });
}
function startEdit(td){
  if (td.querySelector('input')) return td.querySelector('input');
  const r = DEP.byId[td.dataset.id]; const col = td.dataset.col; const cur = cellVal(r, col);
  td.innerHTML = `<input value="${esc(cur)}">`; const inp = td.querySelector('input'); inp.focus(); inp.select();
  inp.onkeydown = e => { if (e.key==='Enter') commitEdit(td); if (e.key==='Escape') renderGrid(); };
  inp.onblur = () => { if (td.querySelector('input')) commitEdit(td); };
  return inp;
}
function commitEdit(td){
  const inp = td.querySelector('input'); if (!inp) return; const r = DEP.byId[td.dataset.id]; const col = td.dataset.col; const k = r.id+'|'+col;
  const before = GRID.edits[k] ? GRID.edits[k].before : cellVal(r, col); const after = inp.value;
  if (after === before) delete GRID.edits[k]; else GRID.edits[k] = { id:r.id, col, before, after };
  renderGrid();
}
function obligatedBy(ids){
  const seen = new Set(ids); let frontier = [...ids]; const order = [];
  while (frontier.length) { const next = []; for (const id of frontier) for (const c of (DEP.down[id]||[])) if (!seen.has(c)) { seen.add(c); next.push(c); order.push(c); } frontier = next; }
  return order;
}
function showGate(){
  const edits = Object.values(GRID.edits); if (!edits.length) return;
  const ids = [...new Set(edits.map(e=>e.id))]; const obl = obligatedBy(ids);
  const findings = obl.filter(id => (S.data.findings||[]).some(f=>f.id===id));
  const qs = (S.data.questions||[]).filter(q => q.status!=='answered' && obl.includes(q.claim_id));
  const line = id => { const c = DEP.byId[id]; return `<div class="dn"><div class="dl"><span class="st ${stOf(c)}">${esc(c.status)}</span><span class="dt">${esc(c.type)}</span> <a class="dgo" data-id="${esc(id)}">${esc(c.subject)}</a> <span class="db">${esc((c.body||'').slice(0,120))}</span><span class="dp">${esc(prov(c.provenance))}</span></div></div>`; };
  const byStatus = st => findings.filter(id => (DEP.byId[id].status||'')===st).length;
  const rowsTouched = ids.map(i => DEP.byId[i]).map(c => `${c.subject} in the ${whereOf(c).replace(/^sheet /,'sheet ')}`);
  $('#grid .ggate').innerHTML = `<div class="dh"><b>Before you save</b> · ${edits.length} edit${edits.length>1?'s':''} · ${obl.length} claims rest on ${ids.length>1?'these rows':'this row'}<div class="spacer"></div><button class="gtoggle" title="collapse">—</button></div><div class="dbody">
    <div class="dhead">${edits.map(e=>`<div><b>${esc(DEP.byId[e.id].subject)}</b> · ${esc(e.col.replace(/_/g,' '))}: <s>${esc(e.before)}</s> → <b>${esc(e.after)}</b> <span class="dp">${esc(rowsTouched[ids.indexOf(e.id)]||'')}</span></div>`).join('')}</div>
    <p class="gline">State of the PHA against this row: <b>${obl.length}</b> claims rest on it. <b>${findings.length}</b> of them are findings, currently <b>${byStatus('refuted')}</b> refuted, <b>${byStatus('holds')+byStatus('derived')}</b> re-derived and <b>${byStatus('open')}</b> open${qs.length?`, and <b>${qs.length}</b> rest on a question nobody has answered yet`:''}. Saving re-decides every one of them. Until it is re-decided, each is an obligation, not a result.</p>
    <h3>Findings that will be re-decided · ${findings.length}</h3>${findings.map(line).join('') || '<div class="empty">none</div>'}
    ${qs.length?`<h3>Rest on an unanswered question · ${qs.length}</h3>${qs.map(q=>`<div class="dn"><div class="dl"><span class="st open">question</span> <a class="dgo" data-id="${esc(q.claim_id)}">${esc(q.id)}</a> <span class="db">${esc(q.text)}</span><span class="dp">to ${esc(q.to_role)}</span></div></div>`).join('')}`:''}
    <div class="gbtns"><button disabled title="available once the re-decision has run">Acknowledge and save</button><button disabled title="available once the re-decision has run">Pin for later</button><button class="gcancel">Cancel · revert the edit</button></div>
    <div class="limits"><b>Limits.</b> Obligation is a walk over ${(S.data.support||[]).length} recorded support edges from the edited row; it names what will be re-decided, not the outcome. This static build does not carry the solver, so the re-decision does not run here, nothing is saved, and Acknowledge and Pin stay disabled.</div></div>`;
  $('#grid .ggate').classList.add('on'); $('#grid .ggate').classList.remove('collapsed');
  $('#grid .ggate .gtoggle').onclick = ()=>{ const g = $('#grid .ggate'); g.classList.toggle('collapsed'); $('#grid .ggate .gtoggle').textContent = g.classList.contains('collapsed') ? '+' : '—'; };
  $('#grid .ggate .gcancel').onclick = ()=>{ GRID.edits = {}; $('#grid .ggate').classList.remove('on'); renderGrid(); };
  $$('#grid .ggate .dgo').forEach(a=>a.onclick=()=>deps(a.dataset.id));
}
const sleepMs = ms => new Promise(r=>setTimeout(r, ms));
async function editAsEngineer(){
  const b = $('#btnEdit'); b.disabled = true;
  openGrid('madb'); $('#grid .ggate').classList.remove('on'); GRID.edits = {}; renderGrid(); await sleepMs(700);
  const td = $(`#grid td[data-id="madb-PAH-1001"][data-col="setpoint_psig"]`); if (!td) { b.disabled=false; return; }
  td.classList.add('hl'); await sleepMs(600);
  const inp = startEdit(td); inp.onblur = null; inp.value = '';
  for (const ch of '1725') { inp.value += ch; await sleepMs(170); }
  await sleepMs(600); commitEdit(td); await sleepMs(900);
  $('#grid .gsave').classList.add('hl'); await sleepMs(500); showGate(); $('#grid .gsave').classList.remove('hl');
  b.disabled = false;
}
$('#btnGrid').onclick = ()=>{ closeQra(); openGrid(); };
const FEAT_GO = {
  pid: ()=>{ closeQra(); closeGrid(); setMode('pid'); openSheet('MM0012'); focus(['PIT-1001']); const c = claimForSubject('PIT-1001'); if (c) { deps(c.id); const t = S.index.find(t=>t.tag==='PIT-1001'); if (t) panTo([t.x,t.y,t.w,t.h]); } },
  grid: ()=>{ closeQra(); $('#deps').classList.remove('on'); editAsEngineer(); },
  qra: ()=>{ $('#deps').classList.remove('on'); closeQra(); $('#grid .ggate').classList.remove('on'); openGrid('lopa'); },
};
$$('#demo .feat').forEach(f=>{ f.onclick = () => FEAT_GO[f.dataset.f](); });
$('#btnEdit').onclick = editAsEngineer;
$('#grid .gsave').onclick = showGate;
$('#grid .gcols').onclick = ()=>{ GRID.menu = !GRID.menu; renderGrid(); };

window.P = { state: S, load, openSheet, commit, follow, prov, focus, highlightFinding, dedupe, diffCount, deps, depsList, openGrid, editAsEngineer, qra: openQra, on: (ev, fn) => (listeners[ev] ||= []).push(fn) };
load('first_pass');
