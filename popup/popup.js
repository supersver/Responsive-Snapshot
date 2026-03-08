/* ── Device presets ─────────────────────────────────── */
const PRESETS = {
  mobile: [
    { name: 'iPhone SE',     width: 375 },
    { name: 'iPhone 14 Pro', width: 393 },
    { name: 'Pixel 7',       width: 412 },
  ],
  tablet: [
    { name: 'iPad Mini',       width: 768 },
    { name: 'iPad Pro 11"',    width: 834 },
    { name: 'iPad Pro 12.9"',  width: 1024 },
  ],
  desktop: [
    { name: 'Laptop',      width: 1366 },
    { name: 'Desktop HD',  width: 1920 },
  ],
};

const ALL_PRESETS = [...PRESETS.mobile, ...PRESETS.tablet, ...PRESETS.desktop];

let selectedWidths = new Set();
let currentTabWidth = null;

/* ── DOM refs ───────────────────────────────────────── */
const captureBtn     = document.getElementById('captureBtn');
const captureText    = document.getElementById('captureText');
const captureSpinner = document.getElementById('captureSpinner');
const fullPageCb     = document.getElementById('fullPage');
const statusEl       = document.getElementById('status');
const progressWrap   = document.getElementById('progressWrap');
const progressFill   = document.getElementById('progressFill');
const progressLabel  = document.getElementById('progressLabel');
const progressPct    = document.getElementById('progressPct');

/* ── Detect current tab viewport width ──────────────── */
async function detectCurrentWidth() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.innerWidth,
    });
    currentTabWidth = result;
  } catch {
    currentTabWidth = null;
  }
}

/* ── Find best matching preset for a given width ────── */
function findClosestPreset(width) {
  if (!width) return null;
  let best = null, bestDiff = Infinity;
  for (const p of ALL_PRESETS) {
    const diff = Math.abs(p.width - width);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  // Only match if within 80px
  return bestDiff <= 80 ? best : null;
}

/* ── Render presets ─────────────────────────────────── */
function renderPresets() {
  for (const [category, presets] of Object.entries(PRESETS)) {
    const container = document.getElementById(`${category}Presets`);
    container.innerHTML = '';
    presets.forEach(p => {
      const isCurrent = (currentTabWidth !== null &&
        Math.abs(p.width - currentTabWidth) <= 80 &&
        findClosestPreset(currentTabWidth)?.width === p.width);
      const isSelected = selectedWidths.has(p.width);

      const chip = document.createElement('label');
      chip.className = 'preset-chip' +
        (isSelected ? ' selected' : '') +
        (isCurrent ? ' current-device' : '');
      chip.dataset.width = p.width;
      chip.innerHTML = `
        <input type="checkbox" ${isSelected ? 'checked' : ''} />
        <span class="chip-dot"></span>
        <span class="chip-label">${p.name}</span>
        <span class="chip-width">${p.width}</span>
        ${isCurrent ? '<span class="chip-badge">YOU</span>' : ''}
      `;
      const cb = chip.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) selectedWidths.add(p.width);
        else selectedWidths.delete(p.width);
        chip.classList.toggle('selected', cb.checked);
        chip.querySelector('.chip-dot').style.cssText = cb.checked
          ? '' : '';
      });
      container.appendChild(chip);
    });
  }
}

/* ── Init: detect width, default-select closest preset ─ */
(async () => {
  await detectCurrentWidth();
  const closest = findClosestPreset(currentTabWidth);
  if (closest) {
    selectedWidths.add(closest.width);
  }
  renderPresets();
})();

/* ── Select All / Deselect All ──────────────────────── */
document.getElementById('selectAll').addEventListener('click', () => {
  ALL_PRESETS.forEach(p => selectedWidths.add(p.width));
  renderPresets();
});
document.getElementById('deselectAll').addEventListener('click', () => {
  selectedWidths.clear();
  renderPresets();
});

/* ── Status helpers ─────────────────────────────────── */
function showStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
  statusEl.classList.remove('hidden');
}

function setProgress(pct, label) {
  progressWrap.classList.remove('hidden');
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
  if (label) progressLabel.textContent = label;
}

function resetUI() {
  captureBtn.disabled = false;
  captureText.textContent = 'Capture Snapshots';
  captureSpinner.classList.add('hidden');
  progressWrap.classList.add('hidden');
  progressFill.style.width = '0%';
}

/* ── Capture ────────────────────────────────────────── */
captureBtn.addEventListener('click', async () => {
  const widths = [...selectedWidths].sort((a, b) => a - b);
  if (widths.length === 0) {
    showStatus('Select at least one preset.', 'error');
    return;
  }

  captureBtn.disabled = true;
  captureText.textContent = 'Capturing…';
  captureSpinner.classList.remove('hidden');
  statusEl.classList.add('hidden');
  setProgress(0, `0 / ${widths.length}`);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({
      action: 'captureMultiple',
      tabId: tab.id,
      url: tab.url,
      widths,
      fullPage: fullPageCb.checked,
      annotate: true,          // always open annotation editor
    });

    if (response?.error) {
      showStatus(response.error, 'error');
    } else {
      showStatus(`${widths.length} snapshot(s) ready to annotate!`, 'success');
    }
  } catch (err) {
    showStatus('Capture failed: ' + err.message, 'error');
  } finally {
    resetUI();
  }
});

/* ── Progress updates from background ──────────────── */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'progress') {
    setProgress(msg.percent, `${msg.current} / ${msg.total} — ${msg.label || ''}`);
  }
});
