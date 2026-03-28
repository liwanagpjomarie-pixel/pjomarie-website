// ============================================================
// utils.js — DTIM v2.3
// ============================================================

// ---- Local Date Helper (CRITICAL: uses local timezone, NOT UTC) ----
// Returns YYYY-MM-DD in the user's LOCAL timezone.
// toISOString() returns UTC which is WRONG for UTC+8 (Philippines):
//   e.g. Friday Mar 27 12:00 AM Manila = Thursday Mar 26 4:00 PM UTC
//   → toISOString gives "2026-03-26" instead of "2026-03-27"
function localDateISO(d) {
  const dt = d || new Date();
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ---- Readable ID Generation --------------------------------
// Format: TASK-20260326-0001
function generateId(prefix = 'ID') {
  const today   = localDateISO().replace(/-/g, ''); // local timezone
  const key     = `dtim_cnt_${prefix}_${today}`;
  let   counter = parseInt(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, counter.toString());
  return `${prefix}-${today}-${String(counter).padStart(4, '0')}`;
}

// ---- Duration Formatting ------------------------------------
function formatDuration(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
}

function formatDurationShort(ms) {
  if (!ms || ms < 0) return '0h 0m';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function msToHoursDecimal(ms) { return (ms / 3600000).toFixed(2); }

// ---- Display Formatters (UI only) --------------------------

// Safely parse ANY date string:
//   "2026-03-27"           → works (ISO date)
//   "2026-03-27T05:35:00Z" → works (ISO datetime)
//   "Mar 27, 2026"         → works (readable date from DB)
//   "Mar 27, 2026 5:35 PM" → works (readable timestamp from DB)
//   "2026-03-27T00:00:00"  → works (local ISO)
// NEVER append T00:00:00 to already-readable strings like "Mar 27, 2026"
function _parseAnyDate(str) {
  if (!str || str === 'null') return null;
  const s = String(str).trim();
  // Try direct parse first (handles "Mar 27, 2026", "Mar 27, 2026 5:35 PM", ISO strings)
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // Only append T00:00:00 for pure YYYY-MM-DD (10-char ISO date)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    d = new Date(s + 'T00:00:00');
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === 'null') return '—';
  const d = _parseAnyDate(dateStr);
  if (!d) return String(dateStr); // return as-is if unparseable
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr || dateStr === 'null') return '—';
  const d = _parseAnyDate(dateStr);
  if (!d) return String(dateStr); // return as-is if unparseable
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTime(str) {
  if (!str || str === 'null') return '—';
  const d = _parseAnyDate(str);
  if (!d) return String(str);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// ---- DB Write Helpers (readable format) --------------------
function nowReadable() {
  return new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function todayReadable() {
  return new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function dateReadable(isoDate) {
  if (!isoDate) return todayReadable();
  try {
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return isoDate; }
}

// ---- YYYY-MM-DD for comparisons (NOT stored in DB) ---------
// Uses LOCAL timezone (not UTC) — critical for UTC+8 Philippines
function getTodayDate() { return localDateISO(); }
function todayStr()     { return localDateISO(); }
function nowISO()       { return new Date().toISOString(); }

// Compares a DB date string (any format) with a YYYY-MM-DD string.
// Handles: ISO "2026-03-27", readable "Mar 27, 2026", timestamp "Mar 27, 2026 5:35 PM"
function matchesDate(dbDate, isoDate) {
  if (!dbDate || !isoDate || dbDate === 'null') return false;
  // Fast path: ISO prefix match
  if (String(dbDate).startsWith(isoDate)) return true;
  // Parse and compare using LOCAL date (not UTC)
  const d = _parseAnyDate(dbDate);
  if (d) return localDateISO(d) === isoDate;
  return false;
}

// ---- Week Helpers ------------------------------------------
// All use localDateISO() to avoid UTC offset bug (UTC+8 = Philippines)

function getWeekStart(dateStr) {
  // Use local date, never toISOString() which gives UTC
  const d   = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat (local timezone)
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return localDateISO(monday); // LOCAL date string, not UTC
}

function getWeekDays(weekStart) {
  // Returns Mon–Fri as YYYY-MM-DD local date strings
  const days  = [];
  const start = new Date(weekStart + 'T00:00:00');
  for (let i = 0; i < 5; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(localDateISO(d)); // LOCAL date, not UTC
  }
  return days;
}

// Friday 5:00 PM deadline
function getWeekDeadline(weekStart) {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + 4); // Mon + 4 = Fri
  d.setHours(17, 0, 0, 0);   // 5:00 PM
  return d;
}

function isBeforeWeekDeadline(weekStart) { return new Date() <= getWeekDeadline(weekStart); }

function isSubmittedOnTime(weekStart, submittedAt) {
  if (!submittedAt) return false;
  return new Date(submittedAt) <= getWeekDeadline(weekStart);
}

function deadlineDisplay(weekStart) {
  const deadline = getWeekDeadline(weekStart);
  const datePart = deadline.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });
  return `${datePart} · 5:00 PM`;
}

function hoursUntilDeadline(weekStart) {
  return Math.round((getWeekDeadline(weekStart) - new Date()) / 3600000);
}

function getDayName(dateStr) {
  if (!dateStr) return '';
  // Use _parseAnyDate to handle both ISO and readable formats
  const d = _parseAnyDate(dateStr);
  if (!d) {
    // Fallback: try YYYY-MM-DD + T12:00:00 (noon avoids any off-by-one from midnight UTC shifts)
    try {
      const dt = new Date(String(dateStr).substring(0, 10) + 'T12:00:00');
      if (!isNaN(dt)) return dt.toLocaleDateString('en-US', { weekday: 'long' });
    } catch { /* ignore */ }
    return '';
  }
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

// ---- Timer State -------------------------------------------
function getElapsedMs(timerData) {
  if (!timerData) return 0;
  const base = timerData.accumulatedMs || 0;
  if (timerData.status === 'running' && timerData.sessionStartMs) {
    return base + (Date.now() - timerData.sessionStartMs);
  }
  return base;
}
function saveTimerState(taskId, data) {
  const all = loadAllTimerStates();
  all[taskId] = data;
  localStorage.setItem('dtim_v2_timers', JSON.stringify(all));
}
function loadAllTimerStates() {
  try { return JSON.parse(localStorage.getItem('dtim_v2_timers') || '{}'); } catch { return {}; }
}
function clearTimerState(taskId) {
  const all = loadAllTimerStates();
  delete all[taskId];
  localStorage.setItem('dtim_v2_timers', JSON.stringify(all));
}

// ---- Toast -------------------------------------------------
function showToast(message, type = 'info', duration = 3800) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success:'✓', error:'✕', warning:'⚠', info:'ℹ' };
  const toast  = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ'}</span><span class="toast-msg">${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 350); }, duration);
}

// ---- Modal -------------------------------------------------
function showModal(title, bodyHTML, actions = []) {
  const overlay  = document.getElementById('modal-overlay');
  const elTitle  = document.getElementById('modal-title');
  const elBody   = document.getElementById('modal-body');
  const elFooter = document.getElementById('modal-footer');
  if (!overlay) return;
  elTitle.textContent = title;
  elBody.innerHTML    = bodyHTML;
  elFooter.innerHTML  = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className   = `btn btn-${a.type || 'ghost'}`;
    btn.textContent = a.label;
    btn.onclick     = () => { if (a.callback) a.callback(); if (a.close !== false) hideModal(); };
    elFooter.appendChild(btn);
  });
  overlay.classList.remove('hidden');
}
function hideModal() { const o = document.getElementById('modal-overlay'); if (o) o.classList.add('hidden'); }
function confirmAction(msg, onConfirm, label = 'Confirm', type = 'danger') {
  showModal('Kumpirumahin', `<p class="confirm-msg">${msg}</p>`, [
    { label: 'Cancel', type: 'ghost' },
    { label, type, callback: onConfirm },
  ]);
}

// ---- Badges ------------------------------------------------
function getStatusBadge(status) {
  const cls = {
    'Not Started':'bg-slate', 'In Progress':'bg-blue', 'Paused':'bg-amber',
    'Completed':'bg-green', 'Cancelled':'bg-red-dim', 'Finalized':'bg-violet',
    'Pending Proof':'bg-orange', 'Submitted':'bg-green', 'Late':'bg-red',
    'Draft':'bg-slate', 'Pending':'bg-amber',
  };
  return `<span class="badge ${cls[status]||'bg-slate'}">${escapeHtml(status||'—')}</span>`;
}
function getPriorityBadge(p) {
  const cls = { Low:'bg-slate', Medium:'bg-amber', High:'bg-orange', Urgent:'bg-red' };
  return `<span class="badge ${cls[p]||'bg-slate'}">${escapeHtml(p||'—')}</span>`;
}
function getWorkModeBadge(m) {
  const cls = { Office:'bg-blue', Remote:'bg-teal', Field:'bg-orange' };
  return `<span class="badge ${cls[m]||'bg-slate'}">${escapeHtml(m||'—')}</span>`;
}
function getRoleBadge(role) {
  const cls   = { Staff:'bg-slate', TeamLeader:'bg-blue', Management:'bg-violet', Admin:'bg-red' };
  const label = { Staff:'Staff', TeamLeader:'Team Leader', Management:'Management', Admin:'Admin' };
  return `<span class="badge ${cls[role]||'bg-slate'}">${label[role]||escapeHtml(role)}</span>`;
}

// ---- Form Helpers ------------------------------------------
function getFormValue(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setFormValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function toggleEl(id, show) { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; }
function buildOptions(arr, sel = '') {
  return (arr||[]).map(v =>
    `<option value="${escapeHtml(v)}"${v===sel?' selected':''}>${escapeHtml(v)}</option>`
  ).join('');
}

// ---- Loading / Empty States --------------------------------
function showLoading(id, msg = 'Loading...') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>${escapeHtml(msg)}</p></div>`;
}
function showEmpty(id, msg = 'Walang data.', icon = '📋') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="empty-state"><span class="empty-icon">${icon}</span><p>${escapeHtml(msg)}</p></div>`;
}

// ---- Security ----------------------------------------------
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function normalizeEmail(email) { return (email||'').toLowerCase().trim(); }

// ---- Role Mapping ------------------------------------------
function mapPositionToRole(position) {
  if (!position) return 'Staff';
  const p = position.toLowerCase().trim();
  if (p.includes('admin'))        return 'Admin';
  if (p.includes('management'))   return 'Management';
  if (p.includes('team leader'))  return 'TeamLeader';
  return 'Staff';
}

// ---- Field Work Helpers ------------------------------------
function isFieldTask(task) {
  return (task['Work Mode'] || '').toLowerCase() === 'field';
}

function fieldTaskHasProof(task) {
  const proof = task['Proof Link'];
  return proof && proof !== 'null' && proof.trim() !== '';
}

/**
 * Get the "display date" of a task for dashboard filtering.
 * Field tasks use their Scheduled Field Date (stored in Date Started at creation).
 * Regular tasks use Date Created.
 */
function getTaskDisplayDate(task) {
  if (isFieldTask(task) && task['Date Started'] && task['Date Started'] !== 'null') {
    return task['Date Started'];
  }
  return task['Date Created'];
}

// ---- PDF Export --------------------------------------------
function printToPDF(title, contentHTML) {
  const pw = window.open('', '_blank');
  if (!pw) { showToast('Popup blocked — allow popups and try again.', 'warning'); return; }
  pw.document.write(`<!DOCTYPE html><html><head>
    <title>${escapeHtml(title)}</title>
    <style>
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;padding:28px;color:#1e293b;font-size:13px}
      h1{font-size:18px;margin-bottom:4px;color:#0f172a}p.meta{color:#64748b;font-size:12px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;margin:12px 0}
      th,td{border:1px solid #cbd5e1;padding:7px 10px;text-align:left;font-size:12px}
      th{background:#f1f5f9;font-weight:600}tr:nth-child(even) td{background:#f8fafc}
      .stats{display:flex;gap:12px;margin:12px 0}
      .stat{flex:1;background:#f1f5f9;padding:12px;border-radius:6px;text-align:center}
      .stat strong{display:block;font-size:20px;font-weight:700;color:#2563eb}
      .summary-box{background:#eff6ff;border-left:3px solid #2563eb;padding:10px 14px;margin:12px 0;font-style:italic}
      .no-print{display:none}
    </style>
  </head><body>
    <button class="no-print" onclick="window.print()"
      style="margin-bottom:16px;padding:7px 16px;cursor:pointer;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:13px">
      🖨 Print / Save as PDF
    </button>
    ${contentHTML}
    <p class="meta" style="margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px">
      Generated by DTIM · ${nowReadable()}
    </p>
  </body></html>`);
  pw.document.close();
}

// ---- Misc --------------------------------------------------
function getInitials(name) {
  if (!name) return '?';
  return name.trim().split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
