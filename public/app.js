// Clause — frontend controller.
// Vanilla ES module. Talks to POST /review and renders the result as a
// marked-up "paper" with risk annotations in the margin.

const $ = (sel) => document.querySelector(sel);

const els = {
  // sections
  landing: $('#landing'),
  loading: $('#loading'),
  results: $('#results'),
  error: $('#error'),
  // landing
  form: $('#inputForm'),
  textInput: $('#textInput'),
  fileInput: $('#fileInput'),
  contractName: $('#contractName'),
  dropOverlay: $('#dropOverlay'),
  dropHint: $('#dropHint'),
  wordCount: $('#wordCount'),
  loadSample: $('#loadSample'),
  runBtn: $('#runBtn'),
  paperInput: document.querySelector('.paper--input'),
  // top bar
  llmState: $('#llmState'),
  // loading
  phases: $('#phases'),
  loadingName: $('#loadingName'),
  // results
  contractTitle: $('#contractTitle'),
  contractMeta: $('#contractMeta'),
  scoreNum: $('#scoreNum'),
  summaryChips: $('#summaryChips'),
  contractView: $('#contractView'),
  detail: $('#detail'),
  newReview: $('#newReview'),
  // error
  errorMsg: $('#errorMsg'),
  errorBack: $('#errorBack'),
  // brand
  brandHome: $('#brandHome'),
};

const SAMPLE_NDA = `MUTUAL NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement is entered into between Acme Corp ("Disclosing Party") and the undersigned recipient ("Receiving Party").

1. DEFINITION OF CONFIDENTIAL INFORMATION
Confidential Information means any non-public information disclosed by one party to the other, whether orally or in writing, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information.

2. OBLIGATIONS OF THE RECEIVING PARTY
The Receiving Party shall protect the Disclosing Party's Confidential Information using reasonable care and shall use it solely to evaluate the proposed business relationship between the parties.

3. TERM OF CONFIDENTIALITY
The Receiving Party's obligations under this Agreement shall survive termination indefinitely and the duty of confidentiality is perpetual and shall never expire.

4. LIMITATION OF LIABILITY
The Receiving Party agrees to accept unlimited liability for any disclosure of Confidential Information, and there shall be no limitation of liability of any kind under this Agreement.

5. INDEMNIFICATION
The Receiving Party shall indemnify and hold harmless from any and all claims, losses, damages, and expenses the Disclosing Party, its officers, and its affiliates, without limitation and regardless of cause.

6. RETURN OF MATERIALS
Upon written request, the Receiving Party shall promptly return or destroy all materials containing Confidential Information within thirty (30) days.

7. GOVERNING LAW
This Agreement shall be governed by the laws of the State of Delaware, and the parties submit to the non-exclusive jurisdiction of its courts.`;

// ── view router ────────────────────────────────────────────────
function show(view) {
  for (const v of [els.landing, els.loading, els.results, els.error]) {
    v.classList.add('hidden');
  }
  view.classList.remove('hidden');
}

// ── word counter ───────────────────────────────────────────────
function updateWordCount() {
  const w = els.textInput.value.trim().match(/\S+/g) || [];
  els.wordCount.textContent = w.length;
}
els.textInput.addEventListener('input', updateWordCount);

// ── sample ─────────────────────────────────────────────────────
els.loadSample.addEventListener('click', () => {
  els.textInput.value = SAMPLE_NDA;
  els.contractName.value = 'Sample Mutual NDA';
  updateWordCount();
  els.textInput.focus();
});

// ── file pickers / drop ────────────────────────────────────────
els.paperInput.addEventListener('click', (e) => {
  // clicking the cream sheet (but not the textarea itself) opens the file picker
  if (e.target === els.textInput) return;
  if (e.target.closest('.btn')) return;
  // honor double-purpose: only trigger if shift or no text yet
  if (e.target.closest('.paper__footer')) els.fileInput.click();
});

els.dropHint.addEventListener('click', () => els.fileInput.click());

els.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  els.contractName.value = els.contractName.value || file.name.replace(/\.(pdf|txt)$/i, '');
  // for .txt we can preview the text in the textarea
  if (file.name.toLowerCase().endsWith('.txt')) {
    els.textInput.value = await file.text();
    updateWordCount();
    els._pendingFile = null;
  } else {
    // PDFs are uploaded on submit — we just stash the file
    els._pendingFile = file;
    els.textInput.value = `[PDF attached] ${file.name}\n\n(${(file.size / 1024).toFixed(1)} KB — will be parsed server-side on submit.)`;
    updateWordCount();
  }
});

['dragenter', 'dragover'].forEach((evt) => {
  els.paperInput.addEventListener(evt, (e) => {
    e.preventDefault();
    els.paperInput.classList.add('is-drag');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  els.paperInput.addEventListener(evt, (e) => {
    e.preventDefault();
    els.paperInput.classList.remove('is-drag');
  });
});
els.paperInput.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  els.fileInput.files = e.dataTransfer.files;
  els.fileInput.dispatchEvent(new Event('change'));
});

// ── submit ─────────────────────────────────────────────────────
els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await runReview();
});

els.newReview.addEventListener('click', () => {
  show(els.landing);
  void'ready';
});

els.errorBack.addEventListener('click', () => show(els.landing));

// Brand mark acts as "back to home" from any view.
els.brandHome.addEventListener('click', () => show(els.landing));

async function runReview() {
  const text = els.textInput.value.trim();
  const file = els._pendingFile;
  if (!text && !file) {
    flashError('Paste a contract or drop a file first.');
    return;
  }

  const name = els.contractName.value.trim() || (file ? file.name : 'Untitled Contract');
  els.loadingName.textContent = name;
  show(els.loading);
  startPhaseAnimation();
  void'reviewing…';

  try {
    let res;
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('contractName', name);
      res = await fetch('/review', { method: 'POST', body: fd });
    } else {
      res = await fetch('/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, contractName: name }),
      });
    }
    const data = await res.json();
    if (data.status !== 'success') {
      throw new Error(data.message || 'Review failed.');
    }
    await finishPhaseAnimation();
    renderResults(data);
    show(els.results);
    void`done · ${data.processingTimeMs}ms · ${data.contractId}`;
  } catch (err) {
    stopPhaseAnimation();
    flashError(String(err.message || err));
  }
}

function flashError(msg) {
  els.errorMsg.textContent = msg;
  show(els.error);
  void'error';
}

// ── phase animation ────────────────────────────────────────────
let _phaseTimer = null;
function startPhaseAnimation() {
  const items = [...els.phases.querySelectorAll('li')];
  items.forEach((li) => { li.classList.remove('is-active', 'is-done'); });
  let i = 0;
  items[0].classList.add('is-active');
  _phaseTimer = setInterval(() => {
    if (i >= items.length - 1) return;       // hold on the last
    items[i].classList.remove('is-active');
    items[i].classList.add('is-done');
    i++;
    items[i].classList.add('is-active');
  }, 160);
}
function stopPhaseAnimation() {
  if (_phaseTimer) clearInterval(_phaseTimer);
  _phaseTimer = null;
}
async function finishPhaseAnimation() {
  stopPhaseAnimation();
  const items = [...els.phases.querySelectorAll('li')];
  items.forEach((li, k) => {
    setTimeout(() => {
      items.forEach((x) => x.classList.remove('is-active'));
      li.classList.add('is-done');
    }, k * 40);
  });
  await new Promise((r) => setTimeout(r, items.length * 40 + 220));
}

// ── results render ─────────────────────────────────────────────
function renderResults(data) {
  els.contractTitle.textContent = data.contractName;
  els.contractMeta.textContent =
    `${data.totalClauses} clauses · ${data.wordCount ?? '—'} words · `
    + `${data.processingTimeMs}ms · ${data.contractId}`;

  // summary chips
  els.summaryChips.innerHTML = '';
  const order = [
    ['low', 'Low', 'chip--low'],
    ['medium', 'Medium', 'chip--medium'],
    ['high', 'High', 'chip--high'],
    ['critical', 'Critical', 'chip--critical'],
  ];
  for (const [key, label, cls] of order) {
    const count = data.summary?.[key] ?? 0;
    const chip = document.createElement('div');
    chip.className = `chip ${cls}`;
    chip.setAttribute('role', 'listitem');
    chip.innerHTML = `<span class="chip__count">${count}</span><span class="chip__label">${label}</span>`;
    els.summaryChips.appendChild(chip);
  }

  // animated overall score
  animateNumber(els.scoreNum, 0, data.overallRiskScore, 700);

  // clauses on paper
  els.contractView.innerHTML = '';
  data.clauses.forEach((c, idx) => {
    const el = document.createElement('section');
    el.className = 'clause';
    el.style.setProperty('--i', idx);
    el.dataset.position = c.position;

    const levelClass = c.riskLevel.toLowerCase();
    el.innerHTML = `
      <div class="clause__gutter">
        <span class="clause__num">${String(c.position).padStart(2, '0')}</span>
        <span class="badge badge--${levelClass}">${shortLevel(c.riskLevel)}</span>
        ${c.vetoActive ? '<span class="veto-stamp">VETO</span>' : ''}
      </div>
      <div class="clause__main">
        <p class="clause__kicker">${c.type} <span class="clause__kicker-sep">·</span> ${String(c.position).padStart(2, '0')}</p>
        <p class="clause__body">${escapeHtml(c.text)}</p>
      </div>
      <span class="clause__inspect">inspect →</span>
    `;
    el.addEventListener('click', () => selectClause(c, el));
    els.contractView.appendChild(el);
  });

  // auto-select the highest-risk clause
  const first = data.clauses
    .slice()
    .sort((a, b) => b.riskScore - a.riskScore)[0];
  if (first) {
    const el = els.contractView.querySelector(`[data-position="${first.position}"]`);
    setTimeout(() => selectClause(first, el), 300);
  }
}

function selectClause(clause, el) {
  els.contractView.querySelectorAll('.clause').forEach((n) => n.classList.remove('is-selected'));
  if (el) el.classList.add('is-selected');

  const levelClass = clause.riskLevel.toLowerCase();
  const barColor = `var(--risk-${levelClass})`;
  const fillPct = Math.max(2, clause.riskScore) + '%';

  const termsHtml = (clause.riskyTermsFound && clause.riskyTermsFound.length)
    ? `<ul class="terms">${clause.riskyTermsFound.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : '<p class="detail__body" style="color:var(--text-dim)">None detected.</p>';

  const rewriteHtml = clause.rewriteSuggestion
    ? `<p class="rewrite">${escapeHtml(clause.rewriteSuggestion)}</p>`
    : '<p class="detail__body" style="color:var(--text-dim)">No rewrite required at this risk level.</p>';

  els.detail.innerHTML = `
    <div class="detail__head">
      <span class="detail__pos">Clause ${String(clause.position).padStart(2, '0')}</span>
      <span class="detail__type">${clause.type}</span>
    </div>

    <div class="detail__score">
      <span class="detail__score-num" style="color:${barColor}">${clause.riskScore}</span>
      <span class="detail__score-level" style="color:${barColor}">${clause.riskLevel}</span>
    </div>
    <div class="detail__bar"><div class="detail__bar-fill" style="background:${barColor}; width:${fillPct};"></div></div>
    ${clause.vetoActive ? '<div class="veto-stamp-dark">Veto active</div>' : ''}

    <div class="detail__section">
      <span class="detail__label">Original clause</span>
      <p class="detail__body">${escapeHtml(clause.text)}</p>
    </div>

    <div class="detail__section">
      <span class="detail__label">Reasoning</span>
      <p class="detail__body">${escapeHtml(clause.reasoning || '—')}</p>
    </div>

    <div class="detail__section">
      <span class="detail__label">Risky terms</span>
      ${termsHtml}
    </div>

    <div class="detail__section">
      <span class="detail__label">Suggested rewrite</span>
      ${rewriteHtml}
    </div>

    <div class="detail__section">
      <span class="detail__label">Confidence</span>
      <p class="detail__body mono" style="letter-spacing:0.12em; text-transform:uppercase;">
        ${escapeHtml(clause.confidence || 'LOW')}
      </p>
    </div>
  `;
}

// ── utilities ──────────────────────────────────────────────────
function shortLevel(l) {
  return { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' }[l] || l.toLowerCase();
}
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function animateNumber(el, from, to, ms) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── boot: probe /health for LLM state ─────────────────────────
(async () => {
  try {
    const r = await fetch('/health');
    const j = await r.json();
    els.llmState.textContent = j.llm === 'enabled' ? 'on' : 'off';
  } catch {
    els.llmState.textContent = '—';
  }
})();
