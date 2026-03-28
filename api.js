// ============================================================
// api.js — DTIM v2.3
// Changes:
//  • createTask(): Field work uses Date Started = Scheduled Field Date
//  • submitFieldProof(): new method — submits proof URL → marks Completed
//  • Updated FALLBACK_DD from screenshot (added Switched Task, Partial End, Executive)
// ============================================================

const USE_MOCK_DATA = false;

const GAS_URL = 'https://script.google.com/macros/s/AKfycbzyzrjegaFS5MziHKDrmuXnQfUY5XyhnCbRmMy6EcxZ33H1Owfks1SNP23OkKORDBds/exec';

const GAS_TIMEOUT_MS = 20000;

// ---- Transport ----------------------------------------------
async function _gasGet(params = {}) {
  const url        = GAS_URL + '?' + new URLSearchParams(params).toString();
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
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
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
  return _gasPost({ action: 'appendRow', sheet: sheetName, data: _nullify(data) });
}

async function _updateRow(sheetName, idColumn, idValue, data) {
  if (USE_MOCK_DATA) return _mockUpdateRow(sheetName, idColumn, idValue, data);
  return _gasPost({ action: 'updateRow', sheet: sheetName, idColumn, idValue, data: _nullify(data) });
}

// Convert empty/null/undefined → 'null' string for clean DB storage
function _nullify(obj) {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    out[k] = (v === null || v === undefined || v === '') ? 'null' : v;
  });
  return out;
}

// ============================================================
// API METHODS
// ============================================================
const API = {

  // ── EMPLOYEES ──────────────────────────────────────────────
  async getEmployees() {
    if (USE_MOCK_DATA) { await _delay(); return _mockStore['EMPLOYEE LIST'] || []; }
    const res = await _gasGet({ action: 'getSheet', sheet: 'EMPLOYEE LIST' });
    return (res.data || []).filter(e => e['Is Active'] !== 'false' && e['Is Active'] !== false);
  },

  async getEmployeeByEmail(email) {
    if (USE_MOCK_DATA) {
      await _delay(300);
      const n = normalizeEmail(email);
      return (_mockStore['EMPLOYEE LIST'] || []).find(e => normalizeEmail(e['Email']) === n) || null;
    }
    try { const res = await _gasGet({ action: 'getEmployeeByEmail', email }); return res.data || null; }
    catch { return null; }
  },

  // ── DROPDOWNS ──────────────────────────────────────────────
  async getDropdowns() {
    if (USE_MOCK_DATA) return deepClone(FALLBACK_DD);
    try {
      const res  = await _gasGet({ action: 'getReferenceData' });
      const data = res.data || {};
      return {
        status:       data.statuses     || FALLBACK_DD.status,
        actionTypes:  data.actionTypes  || FALLBACK_DD.actionTypes,
        pauseReasons: data.pauseReasons || FALLBACK_DD.pauseReasons,
        priorities:   data.priorities   || FALLBACK_DD.priorities,
        taskTypes:    data.taskTypes    || FALLBACK_DD.taskTypes,
        access:       data.access       || FALLBACK_DD.access,
        departments:  data.departments  || FALLBACK_DD.departments,
        workModes:    data.workModes    || FALLBACK_DD.workModes,
      };
    } catch { return deepClone(FALLBACK_DD); }
  },

  // ── TASKS ──────────────────────────────────────────────────
  async getTasks(filters = {}) {
    const res   = await _getSheet('TASKS');
    let   tasks = res.data || [];
    if (filters.employeeName)
      tasks = tasks.filter(t => t['Employee Name'] === filters.employeeName);
    if (filters.department)
      tasks = tasks.filter(t => t['Department'] === filters.department);
    if (filters.status)
      tasks = tasks.filter(t => t['Status'] === filters.status);
    // Date filter: checks BOTH Date Created (regular) and Date Started (field tasks scheduled)
    if (filters.date) {
      tasks = tasks.filter(t => {
        const displayDate = getTaskDisplayDate(t);
        return matchesDate(displayDate, filters.date);
      });
    }
    return tasks;
  },

  async createTask(data) {
    // For FIELD tasks:
    //   Date Created = today (filing date)
    //   Date Started = scheduledFieldDate (the actual field day — used for dashboard filtering)
    //   Status       = 'Pending Proof'
    //   Is Active    = 'true' (appears in task list)
    // For regular tasks:
    //   Date Started = 'null' (set later when task is actually started)

    const isField = data.workMode === 'Field';

    return _appendRow('TASKS', {
      'Task ID':               data.taskId,
      'Employee Name':         data.employeeName,
      'Task Name':             data.taskName,
      'Task Description':      data.taskDescription || null,
      'Department':            data.department,
      'Task Type':             data.taskType,
      'Status':                isField ? 'Pending Proof' : 'Not Started',
      'Priority':              data.priority,
      'Date Created':          todayReadable(),
      // Field tasks: store scheduled date in Date Started at creation
      'Date Started':          isField ? (data.scheduledFieldDate || todayReadable()) : null,
      'Date Completed':        null,
      'Latest Update':         nowReadable(),
      'Is Active':             'true',
      'Daily Accomplishment':  null,
      'Blockers/Issue':        null,
      'Next Step':             null,
      'Work Mode':             data.workMode,
      'Event / Shoot Details': data.eventDetails || null,
      'Location / Venue':      data.location     || null,
      'Proof Link':            null, // Proof submitted later via submitFieldProof
    });
  },

  async updateTask(taskId, updates) {
    return _updateRow('TASKS', 'Task ID', taskId, { ...updates, 'Latest Update': nowReadable() });
  },

  // ── FIELD WORK: SUBMIT PROOF ────────────────────────────────
  // When employee submits proof link → task auto-completes
  async submitFieldProof(taskId, proofLink, employeeName) {
    if (USE_MOCK_DATA) {
      await _delay(300);
      const task = (_mockStore['TASKS'] || []).find(t => t['Task ID'] === taskId);
      if (task) {
        task['Proof Link']    = proofLink;
        task['Status']        = 'Completed';
        task['Is Active']     = 'false';
        task['Date Completed']= nowReadable();
        task['Latest Update'] = nowReadable();
      }
      return { success: true };
    }
    return _gasPost({
      action:       'submitFieldProof',
      taskId,
      proofLink,
      employeeName,
    });
  },

  // ── TASK SESSIONS ──────────────────────────────────────────
  async logSession(data) {
    return _appendRow('TASK SESSIONS', {
      'Session ID':    generateId('SES'),
      'Task ID':       data.taskId,
      'Employee Name': data.employeeName,
      'Date':          todayReadable(),
      'Action Type':   data.actionType,
      'Timestamp':     nowReadable(),
      'Pause Reason':  data.pauseReason || null,
      'Action Notes':  data.notes       || null,
    });
  },

  // ── DAILY REPORTS ──────────────────────────────────────────
  async getDailyReports(filters = {}) {
    const res  = await _getSheet('DAILY REPORTS');
    let   rpts = res.data || [];
    if (filters.employeeName)
      rpts = rpts.filter(r => r['Employee Name'] === filters.employeeName);
    if (filters.date)
      rpts = rpts.filter(r => matchesDate(r['Report Date'], filters.date));
    if (filters.finalized)
      rpts = rpts.filter(r =>
        r['Daily report Status']  === 'Finalized' ||
        r['Daily Report Status']  === 'Finalized'
      );
    return rpts;
  },

  async getDailyReportsByDept(department) {
    const deptEmp = (AppState.employees || [])
      .filter(e => e['Department'] === department)
      .map(e => e['Employee Name']);
    const res = await _getSheet('DAILY REPORTS');
    return (res.data || []).filter(r => deptEmp.includes(r['Employee Name']));
  },

  async createDailyReport(data) {
    return _appendRow('DAILY REPORTS', {
      'Report ID':           generateId('DR'),
      'Employee Name':       data.employeeName,
      'Report Date':         todayReadable(),
      'Total Active Hours':  data.totalHours,
      'Tasks Worked On':     data.tasksWorkedOn  || null,
      'Completed Tasks':     data.completedTasks || null,
      'Ongoing Tasks':       data.ongoingTasks   || null,
      'Pause Reasons':       data.pauseReasons   || null,
      'Daily Summary':       data.summary,
      'Finalized At':        nowReadable(),
      'Daily report Status': 'Finalized',
    });
  },

  // ── WEEKLY REPORTS ─────────────────────────────────────────
  async getWeeklyReports(filters = {}) {
    const res  = await _getSheet('WEEKLY REPORTS');
    let   rpts = res.data || [];
    if (filters.department)
      rpts = rpts.filter(r => r['Department'] === filters.department);
    if (filters.weekStart)
      rpts = rpts.filter(r => matchesDate(r['Week Start'], filters.weekStart));
    // Management filter: only 'Submitted' (on-time)
    if (filters.finalized)
      rpts = rpts.filter(r =>
        r['Weekly Report Status'] === 'Submitted' ||
        r['Weekly Report Status'] === 'Finalized'
      );
    return rpts;
  },

  async createWeeklyReport(data) {
    return _appendRow('WEEKLY REPORTS', {
      'Report ID':            generateId('WR'),
      'Department':           data.department,
      'Team Leader':          data.teamLeaderName,
      'Week Start':           data.weekStart,
      'Week End':             data.weekEnd,
      'Total Staff':          data.totalStaff,
      'Total Hours':          data.totalHours,
      'Completed Tasks':      data.completedTasks || null,
      'Ongoing Tasks':        data.ongoingTasks   || null,
      'Pause Reasons':        null,
      'WeeklySummary':        data.summary,
      'Recommendations':      data.recommendations || null,
      'Finalized At':         nowReadable(),
      'Weekly Report Status': data.weeklyStatus || 'Submitted',
      'PDF Link':             null,
    });
  },

  // ── TRAVEL ORDERS ──────────────────────────────────────────
  async getTravelOrders(filters = {}) {
    const res    = await _getSheet('TRAVEL ORDERS');
    let   orders = res.data || [];
    if (filters.employeeName)
      orders = orders.filter(o => o['Employee Name'] === filters.employeeName);
    return orders;
  },

  async createTravelOrder(data) {
    return _appendRow('TRAVEL ORDERS', {
      'Travel Order ID':      generateId('TO'),
      'Employee Name':        data.employeeName,
      'Position':             data.position     || null,
      'Department':           data.department   || null,
      'Destination':          data.destination,
      'Date':                 data.date || todayReadable(),
      'Purpose':              data.purpose,
      'Budget':               data.budget       || null,
      'Funding Source':       data.fundingSource|| null,
      'Team Leader Approval': 'Pending',
      'Finance Approval':     'Pending',
      'Status':               'Pending',
      'Attachment/PDF Link':  null,
    });
  },
};

// ============================================================
// FALLBACK DROPDOWN VALUES
// Matches screenshot of DROPDOWN sheet (Image 6)
// ============================================================
const FALLBACK_DD = {
  status:       ['Not Started', 'In Progress', 'Paused', 'Completed', 'Cancelled', 'Pending Proof'],
  actionTypes:  ['Start', 'Pause', 'Resume', 'End'],
  pauseReasons: ['Break', 'Lunch', 'Waiting for Approval', 'Waiting for Files',
                 'Meeting', 'Coordination', 'System Issue', 'Personal Reason',
                 'Switched Task', 'Partial End'],
  priorities:   ['Low', 'Medium', 'High', 'Urgent'],
  taskTypes:    ['Admin Operations', 'HR Operations', 'IT Operations',
                 'Finance Operations', 'System Development', 'SOP Creation',
                 'Support Task', 'Coordination', 'System Monitoring'],
  access:       ['Admin Access', 'Team Leader', 'Staff', 'Management'],
  departments:  ['Admin Operations', 'Nexis', 'Main Campaign',
                 'Community Builder', 'IT Operations', 'Finance Operations', 'Executive'],
  workModes:    ['Office', 'Remote', 'Field'],
};

// ============================================================
// MOCK MODE
// ============================================================
const _mockStore = {
  'EMPLOYEE LIST': [
    { 'Employee ID':'20240107', 'Employee Name':'LIWANAG, PJOMARIE D.', 'Department':'IT Operations',
      'Email':'pjomarieliwanag.rdr@gmail.com', 'Position':'Staff', 'Assigned Team Leader / Reports To':'DELOBERJES, ANGELOKING A.', 'Is Active':'true' },
    { 'Employee ID':'20240101', 'Employee Name':'DELOBERJES, ANGELOKING A.', 'Department':'IT Operations',
      'Email':'angelokingdeloberjes.rdr@gmail.com', 'Position':'Team Leader', 'Assigned Team Leader / Reports To':'', 'Is Active':'true' },
    { 'Employee ID':'20210002', 'Employee Name':'DELOS REYES, MARIA THERESA L.', 'Department':'Executive',
      'Email':'mariatheresadelosreyes.rdr@gmail.com', 'Position':'Management', 'Assigned Team Leader / Reports To':'', 'Is Active':'true' },
    { 'Employee ID':'ADM001', 'Employee Name':'Admin User', 'Department':'Admin Operations',
      'Email':'admin@company.ph', 'Position':'Admin Access', 'Assigned Team Leader / Reports To':'', 'Is Active':'true' },
  ],
  'TASKS':          [],
  'TASK SESSIONS':  [],
  'DAILY REPORTS':  [],
  'WEEKLY REPORTS': [],
  'TRAVEL ORDERS':  [],
};

function _delay(ms = 150) { return new Promise(r => setTimeout(r, ms)); }
function _mockGetSheet(n) { return Promise.resolve({ success:true, data: deepClone(_mockStore[n]||[]) }); }
function _mockAppendRow(n, data) { if (!_mockStore[n]) _mockStore[n]=[]; _mockStore[n].push(data); return Promise.resolve({success:true}); }
function _mockUpdateRow(n, idCol, idVal, updates) {
  if (!_mockStore[n]) return Promise.resolve({success:false});
  const idx = _mockStore[n].findIndex(r => r[idCol]===idVal);
  if (idx>=0) _mockStore[n][idx] = { ..._mockStore[n][idx], ...updates };
  return Promise.resolve({success:true});
}
