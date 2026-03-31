// ============================================================
// api.js — DTIM v2.2
// CHANGES:
//   - createTask()       → saves null for blank fields (not empty string)
//   - logSession()       → saves null for blank fields
//   - createDailyReport()→ saves null for blank fields; human-readable dates
//   - createWeeklyReport()→ saves null for blank fields
//   - createTravelOrder()→ saves null for blank fields
//   - generateId()       → now uses readable format from utils.js
//   - Added uploadFieldWorkProof() action
//   - Timestamps stored as "Mar 26, 2026 5:35 PM" instead of ISO
// ============================================================

const USE_MOCK_DATA = false; // ← false = real API | true = mock

// ── Real Google Apps Script endpoint ─────────────────────────
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzH0q6gZFr-2q2g-eio3wfkiG4w46laFF33o5mr_zGrueP_xu-RmIjcfF0ipknu3R0q/exec';

const GAS_TIMEOUT_MS = 20000;

// ============================================================
// GAS TRANSPORT LAYER
// ============================================================

async function _gasGet(params = {}) {
  const url        = GAS_URL + '?' + new URLSearchParams({ ...params }).toString();
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), GAS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Request timed out. Check your internet connection.');
    throw e;
  }
}

async function _gasPost(body = {}) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), GAS_TIMEOUT_MS);
  try {
    const res = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Request timed out. Check your internet connection.');
    throw e;
  }
}

async function _getSheet(sheetName) {
  if (USE_MOCK_DATA) return _mockGetSheet(sheetName);
  return _gasGet({ action: 'getSheet', sheet: sheetName });
}

async function _appendRow(sheetName, data) {
  if (USE_MOCK_DATA) return _mockAppendRow(sheetName, data);
  return _gasPost({ action: 'appendRow', sheet: sheetName, data });
}

async function _updateRow(sheetName, idColumn, idValue, data) {
  if (USE_MOCK_DATA) return _mockUpdateRow(sheetName, idColumn, idValue, data);
  return _gasPost({ action: 'updateRow', sheet: sheetName, idColumn, idValue, data });
}

// ---- Helper: null if blank ─────────────────────────────────
function _n(v) {
  // Returns null for blank/undefined so the sheet stores "null" not empty string
  if (v === null || v === undefined || v === '') return null;
  return v;
}

// ---- Human-readable timestamp for storage ──────────────────
// Stored as "Mar 26, 2026 5:35 PM" — easier to read in sheets
function _ts() { return formatDateTime(new Date().toISOString()); }
function _td() { return formatDate(getTodayDate()); }

// ============================================================
// API METHODS
// ============================================================
const API = {

  // ── EMPLOYEE LIST ──────────────────────────────────────────
  async getEmployees() {
    const res = await _getSheet('EMPLOYEE LIST');
    return (res.data || []).filter(e => e['Is Active'] !== 'false' && e['Is Active'] !== false);
  },

  async getEmployeeByEmail(email) {
    const normalized = normalizeEmail(email);
    const employees  = await this.getEmployees();
    return employees.find(e => normalizeEmail(e['Email']) === normalized) || null;
  },

  // ── DROPDOWN ───────────────────────────────────────────────
  async getDropdowns() {
    if (USE_MOCK_DATA) return _mockDropdowns();
    const res  = await _getSheet('DROPDOWN');
    const rows = res.data || [];
    return {
      status:       _extractColumn(rows, 'Status')       || FALLBACK_DD.status,
      actionTypes:  _extractColumn(rows, 'Action Type')  || FALLBACK_DD.actionTypes,
      pauseReasons: _extractColumn(rows, 'Pause Reason') || FALLBACK_DD.pauseReasons,
      priorities:   _extractColumn(rows, 'Priority')     || FALLBACK_DD.priorities,
      taskTypes:    _extractColumn(rows, 'Task Type')     || FALLBACK_DD.taskTypes,
      access:       _extractColumn(rows, 'Access')        || FALLBACK_DD.access,
      departments:  _extractColumn(rows, 'Departments')   || FALLBACK_DD.departments,
      workModes:    _extractColumn(rows, 'Work Mode')     || FALLBACK_DD.workModes,
    };
  },

  // ── TASKS ──────────────────────────────────────────────────
  async getTasks(filters = {}) {
    const res   = await _getSheet('TASKS');
    let   tasks = res.data || [];
    if (filters.employeeName) tasks = tasks.filter(t => t['Employee Name'] === filters.employeeName);
    if (filters.department)   tasks = tasks.filter(t => t['Department']    === filters.department);
    if (filters.date)         tasks = tasks.filter(t => (t['Date Created'] || '').startsWith(filters.date));
    if (filters.status)       tasks = tasks.filter(t => t['Status']        === filters.status);
    // For field work: also include tasks where Scheduled Field Date === today
    if (filters.includeFieldForDate) {
      const fDate = filters.includeFieldForDate;
      const fieldToday = (res.data || []).filter(t =>
        t['Work Mode'] === 'Field' &&
        t['Scheduled Field Date'] === fDate &&
        !tasks.find(x => x['Task ID'] === t['Task ID'])
      );
      tasks = [...tasks, ...fieldToday];
    }
    return tasks;
  },

  // ── Creates a task. Field work saved with Scheduled Field Date.
  // All blank optional fields saved as null.
  async createTask(data) {
    const isField = data.workMode === 'Field';
    return _appendRow('TASKS', {
      'Task ID':               data.taskId,
      'Employee Name':         data.employeeName,
      'Task Name':             data.taskName,
      'Task Description':      data.taskDescription,
      'Department':            data.department,
      'Task Type':             data.taskType,
      // Field work starts as "Pending Proof", others "Not Started"
      'Status':                isField ? 'Pending Proof' : 'Not Started',
      'Priority':              data.priority,
      'Date Created':          _td(),
      'Date Started':          null,
      'Date Completed':        null,
      'Latest Update':         _ts(),
      'Is Active':             'true',
      'Daily Accomplishment':  null,
      'Blockers/Issue':        null,
      'Next Step':             null,
      'Work Mode':             data.workMode,
      // Field work fields
      'Scheduled Field Date':  isField ? (data.scheduledFieldDate || _n(data.fieldDate)) : null,
      'Event / Shoot Details': _n(data.eventDetails),
      'Location / Venue':      _n(data.location),
      'Proof Link':            _n(data.proofLink),
    });
  },

  async updateTask(taskId, updates) {
    return _updateRow('TASKS', 'Task ID', taskId, {
      ...updates,
      'Latest Update': _ts(),
    });
  },

  // ── Upload proof for field work → auto-complete the task
  async uploadFieldWorkProof(taskId, proofLink, employeeName) {
    // Update task: set Proof Link, Status = Completed, Date Completed
    return _updateRow('TASKS', 'Task ID', taskId, {
      'Proof Link':       proofLink,
      'Status':           'Completed',
      'Date Completed':   _td(),
      'Is Active':        'false',
      'Latest Update':    _ts(),
    });
  },

  // ── TASK SESSIONS ──────────────────────────────────────────
  async logSession(data) {
    return _appendRow('TASK SESSIONS', {
      'Session ID':    generateId('SES'),
      'Task ID':       data.taskId,
      'Employee Name': data.employeeName,
      'Date':          _td(),
      'Action Type':   data.actionType,
      'Timestamp':     _ts(),
      'Pause Reason':  _n(data.pauseReason),
      'Action Notes':  _n(data.notes),
    });
  },

  async getSessionsByTask(taskId) {
    const res = await _getSheet('TASK SESSIONS');
    return (res.data || []).filter(s => s['Task ID'] === taskId);
  },

  // ── DAILY REPORTS ──────────────────────────────────────────
  async getDailyReports(filters = {}) {
    const res  = await _getSheet('DAILY REPORTS');
    let   rpts = res.data || [];
    if (filters.employeeName) rpts = rpts.filter(r => r['Employee Name'] === filters.employeeName);
    if (filters.department)   rpts = rpts.filter(r => r['Department']    === filters.department);
    if (filters.date)         rpts = rpts.filter(r => (r['Report Date']  || '').startsWith(filters.date));
    if (filters.finalized)    rpts = rpts.filter(r => r['Daily Report Status'] === 'Finalized');
    return rpts;
  },

  async createDailyReport(data) {
    return _appendRow('DAILY REPORTS', {
      'Report ID':           generateId('DR'),
      'Employee Name':       data.employeeName,
      'Report Date':         _td(),
      'Total Active Hours':  data.totalHours,
      'Tasks Worked On':     _n(data.tasksWorkedOn),
      'Completed Tasks':     _n(data.completedTasks),
      'Ongoing Tasks':       _n(data.ongoingTasks),
      'Pause Reasons':       _n(data.pauseReasons),
      'Daily Summary':       data.summary,
      'Finalized At':        _ts(),
      'Daily report Status': 'Finalized',
    });
  },

  // ── WEEKLY REPORTS ─────────────────────────────────────────
  async getWeeklyReports(filters = {}) {
    const res  = await _getSheet('WEEKLY REPORTS');
    let   rpts = res.data || [];
    if (filters.department) rpts = rpts.filter(r => r['Department']           === filters.department);
    if (filters.weekStart)  rpts = rpts.filter(r => r['Week Start']           === filters.weekStart);
    if (filters.finalized)  rpts = rpts.filter(r => r['Weekly Report Status'] === 'Finalized');
    return rpts;
  },

  async createWeeklyReport(data) {
    // Status logic:
    //   'Submitted' = submitted on/before Friday 5:00 PM → visible to Management
    //   'Late'      = submitted after deadline → hidden from Management
    const submittedAt = new Date().toISOString();
    const status      = (data.weeklyStatus) || (isSubmittedOnTime(data.weekStart, submittedAt) ? 'Submitted' : 'Late');

    return _appendRow('WEEKLY REPORTS', {
      'Report ID':             generateId('WR'),
      'Department':            data.department,
      'Team Leader':           data.teamLeaderName,
      'Week Start':            formatDate(data.weekStart),
      'Week End':              formatDate(data.weekEnd),
      'Total Staff':           data.totalStaff,
      'Total Hours':           data.totalHours,
      'Completed Tasks':       _n(data.completedTasks),
      'Ongoing Tasks':         _n(data.ongoingTasks),
      'Pause Reasons':         _n(data.pauseReasons),
      'WeeklySummary':         data.summary,
      'Recommendations':       _n(data.recommendations),
      'Finalized At':          _ts(),
      'Weekly Report Status':  status,
      'PDF Link':              null,
    });
  },

  // ── TRAVEL ORDERS ──────────────────────────────────────────
  async getTravelOrders(filters = {}) {
    const res    = await _getSheet('TRAVEL ORDERS');
    let   orders = res.data || [];
    if (filters.employeeName) orders = orders.filter(o => o['Employee Name'] === filters.employeeName);
    return orders;
  },

  async createTravelOrder(data) {
    const budget    = parseFloat(data.budget) || 0;
    const finAppr   = budget > 0 ? 'Pending' : 'N/A';
    return _appendRow('TRAVEL ORDERS', {
      'Travel Order ID':      generateId('TO'),
      'Employee Name':        data.employeeName,
      'Position':             _n(data.position),
      'Department':           _n(data.department),
      'Destination':          data.destination,
      'Date':                 formatDate(data.date || getTodayDate()),
      'Purpose':              data.purpose,
      'Budget':               budget || null,
      'Funding Source':       _n(data.fundingSource),
      'Team Leader Approval': 'Pending',
      'Finance Approval':     finAppr,
      'Status':               'Pending',
      'Attachment/PDF Link':  null,
    });
  },
};

// ============================================================
// HELPERS
// ============================================================

function _extractColumn(rows, colName) {
  const vals = rows.map(r => r[colName]).filter(v => v != null && v !== '');
  return vals.length > 0 ? vals : null;
}

// ============================================================
// FALLBACK DROPDOWN VALUES
// ============================================================
const FALLBACK_DD = {
  status:       ['Not Started', 'In Progress', 'Paused', 'Completed', 'Cancelled', 'Pending Proof'],
  actionTypes:  ['Start', 'Pause', 'Resume', 'End'],
  pauseReasons: ['Break', 'Lunch', 'Waiting for Approval', 'Waiting for Files', 'Meeting', 'Coordination', 'System Issue', 'Personal Reason'],
  priorities:   ['Low', 'Medium', 'High', 'Urgent'],
  taskTypes:    ['Admin Operations', 'HR Operations', 'IT Operations', 'Finance Operations', 'System Development', 'SOP Creation', 'Support Task', 'Coordination', 'System Monitoring'],
  access:       ['Admin Access', 'Team Leader', 'Staff', 'Management'],
  departments:  ['Admin Operations', 'Nexis', 'Main Campaign', 'Community Builder', 'IT Operations', 'Finance Operations'],
  workModes:    ['Office', 'Remote', 'Field'],
};

// ============================================================
// MOCK MODE
// ============================================================

function _mockDropdowns() { return FALLBACK_DD; }

const _mockStore = {
  'EMPLOYEE LIST': [
    { 'Employee ID':'1', 'Employee Name':'Pjomarie Liwanag', 'Department':'IT Operations', 'Email':'pjomarieliwanag.rdr@gmail.com', 'Position':'Staff',       'Assigned Team Leader / Reports To':'Bongbong Marcos', 'Is Active':'true' },
    { 'Employee ID':'2', 'Employee Name':'Juan Dela Cruz',   'Department':'IT Operations', 'Email':'jdc@gmail.com',                 'Position':'Management', 'Assigned Team Leader / Reports To':'',                'Is Active':'true' },
    { 'Employee ID':'3', 'Employee Name':'Bongbong Marcos',  'Department':'IT Operations', 'Email':'bbm@gmail.com',                 'Position':'Team Leader','Assigned Team Leader / Reports To':'',                'Is Active':'true' },
    { 'Employee ID':'4', 'Employee Name':'Admin User',       'Department':'Admin Operations','Email':'admin@gmail.com',            'Position':'Admin Access','Assigned Team Leader / Reports To':'',                'Is Active':'true' },
  ],
  'TASKS':          [],
  'TASK SESSIONS':  [],
  'DAILY REPORTS':  [],
  'WEEKLY REPORTS': [],
  'TRAVEL ORDERS':  [],
};

function _mockGetSheet(name)    { return Promise.resolve({ success: true, data: _mockStore[name] || [] }); }
function _mockAppendRow(n, d)   { if (!_mockStore[n]) _mockStore[n] = []; _mockStore[n].push(d); return Promise.resolve({ success: true }); }
function _mockUpdateRow(n, c, v, u) {
  if (!_mockStore[n]) return Promise.resolve({ success: false });
  const i = _mockStore[n].findIndex(r => r[c] === v);
  if (i >= 0) _mockStore[n][i] = { ..._mockStore[n][i], ...u };
  return Promise.resolve({ success: true });
}
