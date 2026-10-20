(() => {
/* Story page: carousels, the engineer dialog (typewriter over real findings), the across-documents cards,
   the caught-vs-missed table and the plain-LLM contrast. Relies on window.P from overlay.js. */
const SHEET_CAPS = {
  MM0011: ['Orifice meter skid MS-1001', 'Main meter station. Two Senior Daniel orifice runs, PS-1001 high-high switch closing MOV-1001 on the inlet, PSV-1001 on the analyzer take-off set at 80 psig. Design pressure 1,800 psig on the skid note.'],
  MM0012: ['Flow control valve skids', 'Two legs, each FCV with a flow controller and a pressure-override controller through a low select. Both override setpoints read “SET @ XXX PSIG” on the drawing.'],
  MM0013: ['Pig launcher skids', 'PL-1001 and PL-1002. Each barrel has a 1×1 thermal relief valve whose set pressure is blank on the drawing.'],
  MM0014: ['Pig receiver skids, well pads 1 and 2', 'PS-1004 and PS-1005 low-low switches closing MOV-1004 and MOV-1005; receiver relief valves PSV-1004/1005, set pressure blank.'],
  MM0015: ['Orifice meter skid MS-1002', 'Well pad 1 metering. Shown as an image; minimal hand-entered claims.'],
  MM0016: ['Orifice meter skid MS-1003', 'Well pad 2 metering. Shown as an image; minimal hand-entered claims.'],
  MM0017: ['RTUs and analyzer', 'Analyzer building and RTU panels; the heat-traced tubing from MM0011 lands here.'],
};
const DIALOG = [
  {q: 'Is PAH-1001 actually set below the SIF-101 trip in the DCS, not just in the alarm database?', rule: 'R8', subject: 'PAH-1001', match: 'DCS', sheet: 'MM0012', focus: ['PIT-1001']},
  {q: 'Do the alarm database, the SRS and the DCS agree on PAH-1001?', rule: 'R16', subject: 'PAH-1001', sheet: 'MM0012', focus: ['PIT-1001']},
  {q: 'Can I take operator response to PAH-1001 as an independent layer in the blocked-outlet scenario 1.5.2?', rule: 'R1', subject: 'IPL-2', match: 'S-1.5.2', sheet: 'MM0012', focus: ['PIT-1001', 'PIC-1001']},
  {q: 'With that credit gone, does scenario 1.5.2 still meet the 1e-4 per year target?', rule: 'R13', match: 'S-1.5.2', match2: 'after R1', sheet: 'MM0011', focus: ['PS-1001', 'MOV-1001']},
  {q: 'What is the pressure-override setpoint on PIC-1001? I need it for the FCV skid review.', rule: 'RMAWP', subject: 'PIC-1001', sheet: 'MM0012', focus: ['PIC-1001']},
  {q: 'Does SIF-101 trip before the station piping exceeds the 1,800 psig design pressure?', rule: 'RMAWP', subject: 'SIF-101', sheet: 'MM0011', focus: ['PS-1001', 'MOV-1001', 'MS-1001']},
];
const POST_MOC = {q: 'After MOC-001, does the operator still have ten minutes between PAH-1001 and the SIF-101 trip?', rule: 'R9', subject: 'PAH-1001', sheet: 'MM0012', focus: ['PIT-1001']};

const CAUGHT = [
  ['DCS copy of PAH-1001 drifted above the SIF-101 trip', 'R8 refuted; R16 refuted, DCS row named in the core', 'Alarm rationalization checks the MADB; the DCS export is a separate file', 'madb, dcs_alarms, srs'],
  ['Operator-response credit shares PIT-1001 with the PIC-1001 override', 'R1 refuted; counterexample names the transmitter', 'LOPA worksheet flag “independent = true”; the P&ID is not re-opened', 'lopa, sheet MM0012, CCPS independence'],
  ['Scenario 1.5.2 exceeds TMEL once the shared credit is removed', 'R13 refuted after R1', 'LOPA shows 1e-4 with both credits; passes', 'lopa, site procedure §1'],
  ['PIC-1001 override setpoint blank on the drawing', 'Open question to the process engineer of record', 'Blank stays blank; nothing downstream is flagged', 'sheet MM0012 zone B9'],
  ['PSV-1002 set pressure blank on the drawing', 'Open question to the process engineer of record', 'Not in LOPA scope', 'sheet MM0013 zone B5'],
  ['MOC-001: operator window between alarm and trip shrinks to 4.2 min at 12 psi/min', 'R9 refuted after the transition, with the rate basis in the core', 'The MOC form does not link to the LOPA; the credit is not re-derived', 'moc, madb, srs, site procedure §2'],
  ['SIF-101 trip plus overshoot within 1,800 psig', 'RMAWP holds before and after, decided by the solver', 'Assumed from the design pressure', 'srs, moc, sheet MM0011 skid note'],
];

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

/* ---------- carousels ---------- */
function carousel(el, slides) {
  let i = 0;
  el.innerHTML = `<div class="counter">1 / ${slides.length}</div><div class="arrow l">‹</div><div class="arrow r">›</div>
    <div class="slides">${slides.map((s, k) => `<div class="slide ${k===0?'cur':''}"><div class="img ${s.doc?'doc':''}">${s.html || `<img src="${s.src}" alt="">`}</div><div class="cap">${s.badge||''}<h4>${s.title}</h4><div>${s.text}</div></div></div>`).join('')}</div>
    <div class="thumbs">${slides.map((s, k) => `<div class="${k===0?'cur':''} ${s.doc?'doc':''}" data-k="${k}" title="${esc(s.title)}">${s.src ? `<img src="${s.src}" alt="">` : esc(s.title).slice(0,18)}</div>`).join('')}</div>`;
  const go = n => { i = (n + slides.length) % slides.length; el.querySelectorAll('.slide').forEach((sl, k) => sl.classList.toggle('cur', k === i));
    el.querySelectorAll('.thumbs div').forEach((d, k) => d.classList.toggle('cur', k === i)); el.querySelector('.counter').textContent = `${i+1} / ${slides.length}`;
    const strip = el.querySelector('.thumbs'); const t = strip.children[i];
    if (t) strip.scrollTo({left: t.offsetLeft - strip.clientWidth/2 + t.offsetWidth/2, behavior:'smooth'});
    el.scrollLeft = 0; el.querySelector('.slides').scrollLeft = 0; };
  el.querySelector('.arrow.l').onclick = () => go(i - 1); el.querySelector('.arrow.r').onclick = () => go(i + 1);
  el.querySelectorAll('.thumbs div').forEach(d => d.onclick = () => go(+d.dataset.k));
  el.tabIndex = 0; el.addEventListener('keydown', e => { if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); });
}
async function buildCarousels() {
  const moc = await getJSON('/api/moc');
  const R = '<span class="real-badge">REAL</span>', S = '<span class="synth-badge">SYNTHETIC</span>';
  const docs = Object.entries(SHEET_CAPS).map(([s, [t, x]]) => ({src: `sheets/${s}.png`, title: `${s} · ${t}`, text: x, badge: R}));
  docs.push({src: 'story/hazop_p16.png', title: 'HAZOP worksheet, node 1, page 1 of 8', text: 'Less/No Flow and More Flow. Safeguards as the team wrote them: MOV-1001 closes on loss of flow; PSV-1001 set at 80 psig.', badge: R});
  docs.push({src: 'story/hazop_p18.png', title: 'HAZOP worksheet, node 1, page 3 of 8', text: 'Higher Pressure 1.5.1 and 1.5.2: “PS-1001 on inlet of facility closes MOV-1001” and “PIT monitoring pressure in multiple areas, operator response.” Rated A2 = 6. Recommendation 15: add PAH/PAHH alarms on the station PITs.', badge: R});
  docs.push({src: 'story/recs_p11.png', title: 'Recommendations 12–21', text: 'Rec 14: assure overpressure protection set at proper setpoints. Rec 16: consider a PSLL to close the valve upstream of the meter station.', badge: R});
  docs.push({src: 'story/matrix_p41.png', title: '5×5 risk matrix', text: 'Severity A to E, likelihood 1 to 5. The matrix has no tolerable line; the site procedure we wrote sets it at 6.', badge: R});
  docs.push({doc: true, html: `<div style="padding:26px;font-size:14px;color:var(--muted);max-width:720px"><div class="tag">MOC-001 · ${esc(moc.title)}</div><p style="color:var(--text);font-size:17px;line-height:1.5">${esc(moc.description)}</p><table class="t"><tr><td>Touches</td><td class="mono">${moc.touches.map(esc).join(', ')}</td></tr><tr><td>Before</td><td class="mono">${esc(JSON.stringify(moc.before))}</td></tr><tr><td>After</td><td class="mono">${esc(JSON.stringify(moc.after))}</td></tr><tr><td>Sign-offs</td><td>${moc.sign_offs.map(esc).join(' · ')}</td></tr></table></div>`, title: 'The change request', text: 'A transition on the ledger: every claim whose support reaches a touched subject becomes obligated and is re-decided.', badge: S});
  docs.push({doc: true, html: `<div class="brief"><div class="tag">What the engineer asks</div>
<p>I am the process safety engineer for the Project Tundra CO<sub>2</sub> meter station. Dense-phase CO<sub>2</sub> arrives from the CCS facility at the main meter station MS-1001 and goes on to the well-pad stations. The station is 16-inch ANSI 900 piping, design pressure 1,800 psig, 12,980 ton/day. The HAZOP is the February 2021 study: three nodes, 35 recommendations, a 5×5 matrix. Our site procedure sets the tolerable line at a matrix score of 6. Anything at or above it carries a LOPA, and severity A scenarios have a target of 1e-4 per year. Operator response to an alarm counts as a layer only if it is independent of the initiating cause and the operator has at least ten minutes.</p>
<p>CCS has submitted MOC-001: raise the normal discharge pressure delivered to the station from 1,500 to 1,650 psig to meet injection targets. Their compressor curve at the new operating point moves the blocked-outlet pressure-rise basis from 5 to 12 psi/min.</p>
<p>Before this goes to the sign-off meeting, run a consistency check on MOC-001 against the HAZOP, the LOPA, the SRS for SIF-101 and SIF-104, the master alarm database and the DCS alarm export, the historian excursions and the site procedure. For every claim the change touches, tell me whether it still holds, what it rests on, and where the documents run out. I will take it from there.</p>
<p class="note">What comes back is not a verdict. Every finding is a proof, a refutation with the rows it rests on, or an open question with a role on it. The engineer then works the results: asks what each one rests on, pushes on the ones that look wrong, and signs off themselves.</p></div>`, title: 'The engineer’s prompt', text: 'The same request in both halves of this page. One side reads the documents one at a time; the other re-derives every claim the change touches, and the engineer reasons over what comes back.', badge: ''});
  carousel($('#carDocs'), docs);

  let lopa = await getJSON('/api/doc?name=lopa').catch(() => []); if (!Array.isArray(lopa)) lopa = [];
  const lopaHtml = lopa.length ? `<table class="t lopa"><tr><th>scenario</th><th>IEF /yr</th><th>IPL</th><th>PFD</th><th>indep.</th><th>TMEL</th></tr>${lopa.map(r => `<tr><td>${esc(r.scenario_id)}</td><td>${esc(r.ief_per_yr)}</td><td>${esc(r.ipl_description)}</td><td>${esc(r.pfd)}</td><td class="${r.independent==='true'?'good':'badc'}">${esc(r.independent)}</td><td>${esc(r.tmel_per_yr)}</td></tr>`).join('')}</table>` : '<div class="empty">lopa.csv not served</div>';
  const today = [
    {src: 'story/hazop_p18.png', title: 'The worksheet row', text: 'The engineer reads “PIT monitoring … operator response” and credits it. Which PIT, and what else that PIT feeds, is on a drawing two documents away.', badge: R},
    {doc: true, html: `<div style="padding:22px">${lopaHtml}<p class="tag" style="margin-top:10px">Every row says independent = true. Nothing in the worksheet can know that IPL-2 and the control loop share PIT-1001.</p></div>`, title: 'The LOPA worksheet as filled in', text: 'This is the calculation that changes, or does not, when the MOC is approved. It is a spreadsheet; it does not know about MM0012.', badge: S},
  ];
  carousel($('#carToday'), today);
}

/* ---------- engineer dialog ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function typeInto(el, text, cps) {
  el.classList.add('cursor');
  for (let i = 0; i < text.length; i++) { el.textContent += text[i]; if (i % 2 === 0) await sleep(1000 / cps); el.parentElement.scrollTop = 1e9; }
  el.classList.remove('cursor');
}
function pickFinding(spec) {
  const F = (P.state.data?.findings) || [];
  return F.find(f => f.rule === spec.rule && (!spec.subject || f.subject === spec.subject) && (!spec.match || (f.subgoal||'').includes(spec.match)) && (!spec.match2 || (f.subgoal||'').includes(spec.match2)))
      || F.find(f => f.rule === spec.rule && (!spec.match || (f.subgoal||'').includes(spec.match)));
}
function answerText(f) {
  if (!f) return {status: 'open', text: 'No subgoal in the ledger matches that question yet.', prov: []};
  const st = f.status === 'holds' ? 'holds' : f.status;
  const claims = P.state.data.claims || [];
  const ids = (f.core && f.core.length ? f.core : f.support || []).slice(0, 4);
  const prov = ids.map(id => { const c = claims.find(x => x.id === id); return c ? `${c.subject} · ${P.prov(c.provenance)}` : id; });
  let text = f.body || f.subgoal;
  if (f.model && Object.keys(f.model).length) text += `\nCounterexample: ${Object.entries(f.model).map(([k, v]) => k + '=' + v).join(', ')}`;
  if (f.question) text += `\n→ Question to ${f.question.to_role}: ${f.question.text}`;
  return {status: st, text, prov};
}
async function ask(spec, qcps = 28, acps = 90) {
  const log = $('#dlog'); if (log.querySelector('.empty')) log.innerHTML = '';
  const q = document.createElement('div'); q.className = 'msg eng'; log.appendChild(q);
  $('#dstate').textContent = 'engineer typing…';
  await typeInto(q, spec.q, qcps);
  await sleep(350);
  if (spec.sheet) { P.openSheet(spec.sheet); P.focus(spec.focus || []); }
  const f = pickFinding(spec); const a = answerText(f);
  const m = document.createElement('div'); m.className = 'msg sys';
  const pill = document.createElement('span'); pill.className = `st ${a.status}`; pill.textContent = a.status; m.appendChild(pill);
  const body = document.createElement('span'); m.appendChild(body); log.appendChild(m);
  $('#dstate').textContent = `deciding ${spec.rule}…`;
  await sleep(500);
  await typeInto(body, a.text, acps);
  for (const p of a.prov) { const pv = document.createElement('span'); pv.className = 'pv'; pv.textContent = p; m.appendChild(pv); }
  if (f) P.highlightFinding(f);
  log.scrollTop = 1e9; $('#dstate').textContent = 'idle';
  await sleep(spec.pause || 1600);
}
let dialogRunning = false;
async function runDialog() {
  if (dialogRunning) return; dialogRunning = true; $('#btnDialog').disabled = true;
  for (const spec of DIALOG) await ask(spec);
  const note = document.createElement('div'); note.className = 'msg sys'; note.textContent = 'Six questions, six solver results, each resting on named rows. Now commit MOC-001 and watch what they rest on move.';
  $('#dlog').appendChild(note); $('#dlog').scrollTop = 1e9;
  dialogRunning = false; $('#btnDialog').disabled = false;
}
async function afterCommitDialog() { await sleep(600); await ask(POST_MOC, 28, 90); }

/* ---------- across / caught / contrast ---------- */
function statusOf(ruleSubjectMatch) {
  const F = (P.state.data?.findings) || [];
  const f = F.find(f => ruleSubjectMatch(f)); return f ? f.status : null;
}
function renderAcross() {
  const d = P.state.data; if (!d || !d.findings) return;
  const picks = d.findings.filter(f => f.status !== 'holds').slice(0, 9);
  $('#acrossCards').innerHTML = picks.map(f => `<div class="card"><div class="head"><span class="st ${f.status==='holds'?'derived':f.status}">${f.status}</span> <span class="tag">${f.rule} · ${esc(f.subject||'')}</span></div><div class="body" style="margin-top:6px">${esc(f.body||f.subgoal)}</div><div class="prov">${(f.core&&f.core.length?f.core:f.support||[]).slice(0,4).map(id => { const c = d.claims.find(x => x.id===id); return c ? `<b>${esc(c.subject)}</b> ${esc(P.prov(c.provenance))}` : esc(id); }).join('<br>')}</div></div>`).join('');
}
function renderCaught() {
  const tb = $('#caughtTable tbody');
  tb.innerHTML = CAUGHT.map(r => `<tr><td>${esc(r[0])}</td><td class="good">${esc(r[1])}</td><td class="badc">${esc(r[2])}</td><td class="mono">${esc(r[3])}</td></tr>`).join('');
}
let baseline, mocDef;
async function renderContrast() {
  if (baseline === undefined) baseline = await fetch('out/llm_baseline.json').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!mocDef) mocDef = await getJSON('/api/moc').catch(() => null);
  const b = baseline;
  $('#llmModel').textContent = b ? 'no ledger, no solver' : '';
  const d = P.state.data; if (!d || !d.findings) return;
  const F = d.findings, after = P.state.phase === 'moc';
  const n = st => F.filter(f => f.status === st).length;
  const r9 = F.find(f => f.rule === 'R9' && f.subject === 'PAH-1001');
  const r16 = F.find(f => f.rule === 'R16' && f.subject === 'PAH-1001');
  const claim = id => d.claims.find(x => x.id === id);
  const claimRow = id => { const c = claim(id); return c ? `<b>${esc(c.subject)}</b> ${esc(c.body||'')}<br><span class="id">${esc(id)} · ${esc(P.prov(c.provenance))}</span>` : esc(id); };
  const none = why => `<span class="st open">no answer</span><div class="why">${why}</div>`;
  const row = (q, plain, ours) => `<tr><td>${q}</td><td>${plain}</td><td>${ours}</td></tr>`;

  const plain = b ? `<div class="llm">${esc(b.answer).replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--text)">$1</b>')}</div>` : '<div class="empty">llm_baseline.json not present (run tools/llm_baseline.py).</div>';
  const ours1 = `<div class="kpi"><div class="r"><b>${n('refuted')}</b><span>refuted</span></div><div class="a"><b>${n('open')}</b><span>open, with a name</span></div><div class="g"><b>${n('holds')}</b><span>proved</span></div></div>
    <div class="tag">ledger totals, all ${F.length} findings, ${after ? 'after' : 'before'} MOC-001 · no verdict; the sign-off stays with the engineer</div>
    ${r9 ? `<div class="card"><div class="head"><span class="st ${r9.status}">${r9.status}</span><span class="tag">R9 · PAH-1001</span></div><div class="body">${esc(r9.body)}</div>${r9.model && Object.keys(r9.model).length ? `<div class="prov">counterexample: ${Object.entries(r9.model).map(([k, v]) => k + '=' + v).join(', ')}</div>` : ''}</div>` : ''}`;

  const rests = r9 ? (r9.core && r9.core.length ? r9.core : r9.support || []).slice(0, 5) : [];
  const ours2 = rests.length ? `<div class="prov">${rests.map(claimRow).join('<br>')}</div>` + (r16 ? `<div class="prov" style="margin-top:8px">The MADB-vs-DCS split is a finding of its own, R16: ${esc(r16.body)}</div>` : '') : '<div class="empty">no R9 finding in this state</div>';
  const plain2 = none(`None are named. The text gives setpoints and rates with no row, page or sheet behind them, so any line could be wrong and nothing in the answer would show it. One already is: it puts PAH-1001 at <b>1,750 psig in the MADB</b>. The MADB row says 1,700; it is the DCS copy that reads 1,750.`);

  const plain3 = none(`The answer is a one-time reading. Ask again after the next change and you get a new text with no relation to this one. Nothing marks which of these lines rested on the 12 psi/min figure.`);
  const diff = d.diff || {};
  const touched = (mocDef && mocDef.touches || []).map(esc).join(', ');
  const ours3 = after && d.diff
    ? `<div class="prov">MOC-001 is a transition on the ledger. <b>${(d.obligated||[]).length}</b> claims rested on what it touched${touched ? ` (${touched})` : ''} and were obligated. Of the ${['refuted','re_derived','opened','unchanged'].reduce((a, k) => a + (diff[k]||[]).length, 0)} findings re-decided: <b>${(diff.refuted||[]).length}</b> newly refuted · <b>${(diff.re_derived||[]).length}</b> newly proved · <b>${(diff.opened||[]).length}</b> newly opened · <b>${(diff.unchanged||[]).length}</b> unchanged. Change the rate basis again and the same walk runs over the same edges.</div>`
    : `<div class="prov">Commit MOC-001 above. Every claim whose support reaches ${touched || 'a touched subject'} becomes an obligation and is re-decided, and the counts appear here.</div>`;

  const plain4 = none(`It lists items the engineer should still look at, which is useful. It cannot say what it read, which rules it applied, or where its own reading stopped.`);
  const ours4 = `<div class="limits">${esc(d.limits||'')}</div>`;

  $('#cmpTable tbody').innerHTML = [
    row('Is MOC-001 acceptable?', plain, ours1),
    row('Which rows does this rest on?', plain2, ours2),
    row('What happens when the rate changes again?', plain3, ours3),
    row('What did it not check?', plain4, ours4),
  ].join('');
}

/* ---------- wiring ---------- */
$('#btnDialog').onclick = runDialog;
$('#dtoggle').onclick = () => { const d = $('#dialog'); d.classList.toggle('collapsed'); $('#dtoggle').textContent = d.classList.contains('collapsed') ? '+' : '—'; };
P.on('loaded', () => { renderAcross(); renderCaught(); renderContrast(); });
P.on('committed', () => { renderContrast(); afterCommitDialog(); });
buildCarousels();

})();
