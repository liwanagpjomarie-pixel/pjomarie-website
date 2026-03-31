// ============================================================
// utils.js — DTIM v2.4  (DATE FIX)
//
// ROOT CAUSES FIXED:
//
// 1. "Invalid Date" on task cards
//    OLD: new Date('Mar 26, 2026' + 'T00:00:00') = Invalid Date
//         because 'Mar 26, 2026T00:00:00' is not a valid format
//    FIX: formatDate() / formatDateShort() now detect readable format
//         and parse it directly WITHOUT appending 'T00:00:00'
//
// 2. Tasks not appearing on dashboard / today's list
//    OLD: (t['Date Created']||'').startsWith(today)
//         where today = '2026-03-27' and Date Created = 'Mar 27, 2026 5:35 PM'
//         → 'Mar 27, 2026 5:35 PM'.startsWith('2026-03-27') = FALSE!
//    FIX: Use matchesDate() everywhere for today-filtering.
//         matchesDate() now uses local date parts (not .toISOString()) to
//         avoid UTC timezone shift.
//
// 3. matchesDate() timezone shift
//    OLD: new Date(dbDate).toISOString().split('T')[0]
//         UTC conversion shifts 'Mar 26, 2026' (local midnight) back to
//         Mar 25 in UTC+8! (Mar 26 00:00 PH = Mar 25 16:00 UTC)
//    FIX: Use d.getFullYear(), d.getMonth(), d.getDate() (LOCAL parts)
//         to build the yyyy-MM-dd string. No UTC shift.
//
// 4. Weekly days misalignment
//    OLD: getWeekStart() uses new Date() then .toISOString() which
//         can return yesterday in UTC+8
//    FIX: getWeekStart() and getWeekDays() use local date parts only
//
// ============================================================

// ---- Readable ID Generation --------------------------------
function generateId(prefix = 'ID') {
  const now     = new Date();
  const today   = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const key     = `dtim_cnt_${prefix}_${today}`;
  let   counter = parseInt(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, counter.toString());
  return `${prefix}-${today}-${String(counter).padStart(4, '0')}`;
}

// ---- Duration Formatting -----------------------------------
function formatDuration(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const s   = Math.floor(ms / 1000);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
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

// ============================================================
// CORE DATE PARSER — timezone-safe
// Parses ANY date string (ISO or readable) using LOCAL date parts.
// Never uses .toISOString() which would shift to UTC.
// ============================================================
function _parseToLocal(str) {
  if (!str || str === 'null' || str === '—') return null;
  const s = String(str).trim();
  // Already ISO: "2026-03-26" or "2026-03-26T..."
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    // Parse date-only as local midnight (no T suffix risk)
    const parts = s.substring(0, 10).split('-');
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  // Readable: "Mar 26, 2026" or "Mar 26, 2026 5:35 PM"
  // new Date() handles this correctly as LOCAL time
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Returns "yyyy-MM-dd" from any date string using LOCAL date parts
function toLocalISO(str) {
  const d = _parseToLocal(str);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---- Display Formatters (UI only) --------------------------

// FIX: Do NOT append 'T00:00:00' to readable dates like 'Mar 26, 2026'
// That creates 'Mar 26, 2026T00:00:00' which is Invalid Date!
function formatDate(dateStr) {
  if (!dateStr || dateStr === 'null' || dateStr === '—') return '—';
  try {
    const d = _parseToLocal(String(dateStr));
    if (!d) return String(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return String(dateStr); }
}

function formatDateShort(dateStr) {
  if (!dateStr || dateStr === 'null' || dateStr === '—') return '—';
  try {
    const d = _parseToLocal(String(dateStr));
    if (!d) return String(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return String(dateStr); }
}

function formatDateTime(str) {
  if (!str || str === 'null' || str === '—') return '—';
  try {
    const d = _parseToLocal(String(str));
    if (!d) return String(str);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return String(str); }
}

// ---- DB Write Helpers (readable format for Sheets) ---------
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
    const d = _parseToLocal(isoDate);
    if (!d) return isoDate;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return isoDate; }
}

// ---- Current Date (yyyy-MM-dd, LOCAL) ----------------------
// FIX: Do NOT use .toISOString() which returns UTC and may be yesterday!
// Use local date parts directly.
function getTodayDate() {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  const d   = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function todayStr() { return getTodayDate(); }
function nowISO()   { return new Date().toISOString(); }

// ============================================================
// matchesDate — timezone-safe comparison
// Compares a DB date string (any format) with a yyyy-MM-dd string.
// FIX: Uses local date parts (not .toISOString()) to prevent UTC shift.
// ============================================================
function matchesDate(dbDate, isoDate) {
  if (!dbDate || !isoDate || dbDate === 'null' || dbDate === '—') return false;
  // Fast path: if dbDate starts with yyyy-MM-dd prefix (ISO stored dates)
  if (String(dbDate).startsWith(isoDate)) return true;
  // General path: parse to local and compare local parts
  const localISO = toLocalISO(String(dbDate));
  return localISO === isoDate;
}

// ---- Week Helpers (all using LOCAL date parts) -------------

// FIX: use local date parts, not .toISOString(), to avoid UTC shift
function getTodayLocalISO() {
  return getTodayDate(); // already local
}

function getWeekStart(dateStr) {
  let d;
  if (dateStr) {
    d = _parseToLocal(dateStr);
    if (!d) d = new Date();
  } else {
    d = new Date();
  }
  const day  = d.getDay(); // 0=Sun, 1=Mon, ...6=Sat
  const diff = (day === 0) ? -6 : 1 - day; // shift to Monday
  const mon  = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  const y    = mon.getFullYear();
  const m    = String(mon.getMonth() + 1).padStart(2, '0');
  const day2 = String(mon.getDate()).padStart(2, '0');
  return `${y}-${m}-${day2}`;
}

function getWeekDays(weekStart) {
  // Returns Mon–Fri as ['yyyy-MM-dd', ...]
  const days  = [];
  const parts = weekStart.split('-').map(Number);
  const start = new Date(parts[0], parts[1] - 1, parts[2]); // local midnight
  for (let i = 0; i < 5; i++) {
    const d   = new Date(parts[0], parts[1] - 1, parts[2] + i);
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${day}`);
  }
  return days;
}

// Friday 5:00 PM deadline (LOCAL time)
function getWeekDeadline(weekStart) {
  const parts = weekStart.split('-').map(Number);
  // Monday + 4 = Friday
  const fri = new Date(parts[0], parts[1] - 1, parts[2] + 4, 17, 0, 0, 0);
  return fri;
}

function isBeforeWeekDeadline(weekStart) { return new Date() <= getWeekDeadline(weekStart); }

function isSubmittedOnTime(weekStart, submittedAt) {
  if (!submittedAt) return false;
  const d = _parseToLocal(submittedAt);
  if (!d) return false;
  return d <= getWeekDeadline(weekStart);
}

function deadlineDisplay(weekStart) {
  const dl = getWeekDeadline(weekStart);
  return dl.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' · 5:00 PM';
}

function hoursUntilDeadline(weekStart) {
  return Math.round((getWeekDeadline(weekStart) - new Date()) / 3600000);
}

// FIX: Use timeZone: 'UTC' only when the input is a raw ISO yyyy-MM-dd
// For readable dates ('Mar 26, 2026'), use default local timezone
function getDayName(dateStr) {
  if (!dateStr || dateStr === 'null') return '';
  try {
    const d = _parseToLocal(dateStr);
    if (!d) return '';
    // Use local weekday name from local date parts
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  } catch { return ''; }
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
 * Get the "display date" of a task for today-filtering.
 * Field tasks: use Date Started (= Scheduled Field Date stored at creation)
 * Regular tasks: use Date Created
 */
function getTaskDisplayDate(task) {
  if (isFieldTask(task) && task['Date Started'] && task['Date Started'] !== 'null') {
    return task['Date Started'];
  }
  return task['Date Created'];
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
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
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
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function normalizeEmail(email) { return (email||'').toLowerCase().trim(); }

// ---- Role Mapping ------------------------------------------
function mapPositionToRole(position) {
  if (!position) return 'Staff';
  const p = position.toLowerCase().trim();
  if (p.includes('admin'))       return 'Admin';
  if (p.includes('management'))  return 'Management';
  if (p.includes('team leader')) return 'TeamLeader';
  return 'Staff';
}

// ---- PDF Export --------------------------------------------
function printToPDF(title, contentHTML) {
  const pw = window.open('', '_blank');
  if (!pw) { showToast('Popup blocked — allow popups and try again.', 'warning'); return; }
  pw.document.write(`<!DOCTYPE html><html><head>
    <title>${escapeHtml(title)}</title>
    <style>
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;padding:28px;color:#1e293b;font-size:13px}
      h1{font-size:18px;margin-bottom:4px}p.meta{color:#64748b;font-size:12px;margin-bottom:16px}
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
    <button class="no-print" onclick="window.print()" style="margin-bottom:16px;padding:7px 16px;cursor:pointer;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:13px">🖨 Print / Save as PDF</button>
    ${contentHTML}
    <p class="meta" style="margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px">Generated by DTIM · ${nowReadable()}</p>
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
