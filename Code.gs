// ============================================================
// DTIM v2.2 — Code.gs
// Deploy: Execute as Me | Who has access: Anyone
//
// CHANGES IN v2.2 vs v2.1:
//
// 1. FINALIZE MY DAY LOGIC
//    - Pending / Not Started tasks are IGNORED
//    - Report only finalizes if there's In Progress, Paused, or Completed tasks
//    - Field work: counted as Completed only when proofLink is uploaded
//
// 2. WEEKLY REPORT DEADLINE
//    - Changed from Friday 23:59:59 to Friday 17:00:00 (5:00 PM)
//    - TL can still submit anytime — flexible submission
//    - On-time = submitted before/on Friday 5:00 PM
//
// 3. FINALIZE REPORT BUTTON
//    - finalizeWeeklyReport() now exposed as distinct POST action
//    - Before clicking, report stays TL-side only
//    - After clicking, report becomes visible in Management POV
//
// 4. NULL HANDLING
//    - All optional/blank fields saved as literal null (not empty string)
//    - Applies to: tasks, sessions, daily reports, weekly reports, travel orders
//
// 5. DATE / TIMESTAMP FORMAT
//    - Dates stored as "Mar 26, 2026" (human readable)
//    - Times stored as "Mar 26, 2026 5:35 PM"
//    - Session timestamps stored as readable datetime
//
// 6. UNIQUE ID FORMAT
//    - Changed from PREFIX_timestamp_random to PREFIX-YYYYMMDD-NNN
//    - Examples: TASK-20260326-001, SES-20260326-001, DR-20260326-001
//
// 7. FIELD WORK LOGIC
//    - Field work has NO running timer
//    - Field work completed by proof document upload
//    - Field work filed in advance with Scheduled Field Date
//    - Field work appears on dashboard on its scheduled date
//    - uploadFieldWorkProof() action auto-completes the task
//
// ── ACTUAL SHEET COLUMN ORDERS ────────────────────────────────
//
// EMPLOYEE LIST (Col A blank, data starts B):
//   B(1)=Employee ID  C(2)=Employee Name  D(3)=Department
//   E(4)=Email  F(5)=Position
//   G(6)=Assigned Team Leader / Reports To  H(7)=Is Active
//
// TASKS (A-U = 21 cols — added Scheduled Field Date at col 20):
//   0=Task ID  1=Employee Name  2=Task Name  3=Task Description
//   4=Department  5=Task Type  6=Status  7=Priority
//   8=Date Created  9=Date Started  10=Date Completed
//   11=Latest Update  12=Is Active  13=Daily Accomplishment
//   14=Blockers/Issue  15=Next Step  16=Work Mode
//   17=Event / Shoot Details  18=Location / Venue  19=Proof Link
//   20=Scheduled Field Date
//
// TASK SESSIONS (A-H):
//   0=Session ID  1=Task ID  2=Employee Name  3=Date
//   4=Action Type  5=Timestamp  6=Pause Reason  7=Action Notes
//
// DAILY REPORTS (A-K = 11 cols, NO Department):
//   0=Report ID  1=Employee Name  2=Report Date
//   3=Total Active Hours  4=Tasks Worked On  5=Completed Tasks
//   6=Ongoing Tasks  7=Pause Reasons  8=Daily Summary
//   9=Finalized At  10=Daily report Status
//
// WEEKLY REPORTS (A-O = 15 cols):
//   0=Report ID  1=Department  2=Team Leader  3=Week Start
//   4=Week End  5=Total Staff  6=Total Hours  7=Completed Tasks
//   8=Ongoing Tasks  9=Pause Reasons  10=WeeklySummary
//   11=Recommendations  12=Finalized At  13=Weekly Report Status
//   14=PDF Link
//
// TRAVEL ORDERS (A-M = 13 cols):
//   0=Travel Order ID  1=Employee Name  2=Position  3=Department
//   4=Destination  5=Date  6=Purpose  7=Budget  8=Funding Source
//   9=Team Leader Approval  10=Finance Approval  11=Status
//   12=Attachment/PDF Link
// ============================================================

var TZ           = Session.getScriptTimeZone();
var SH_TASKS     = 'TASKS';
var SH_SESSIONS  = 'TASK SESSIONS';
var SH_REPORTS   = 'DAILY REPORTS';
var SH_WEEKLY    = 'WEEKLY REPORTS';
var SH_DROPDOWN  = 'DROPDOWN';
var SH_EMPLOYEES = 'EMPLOYEE LIST';
var SH_TRAVEL    = 'TRAVEL ORDERS';

// ============================================================
// ENTRY POINTS
// ============================================================

function doGet(e) {
  e = e || {}; e.parameter = e.parameter || {};
  var action = e.parameter.action || '';
  var p      = e.parameter;
  try {
    switch (action) {
      case 'getSheet':                  return ok(getSheetData(p));
      case 'ping':                      return ok({ message: 'DTIM v2.2 online', time: nowReadable() });
      case 'getEmployeeByEmail':        return ok(getEmployeeByEmail(p));
      case 'getReferenceData':          return ok(getReferenceData());
      case 'getTasks':                  return ok(getTasksGET(p));
      case 'getActiveTask':             return ok(getActiveTask(p));
      case 'getPausedTasks':            return ok(getPausedTasks(p));
      case 'getTodaySessions':          return ok(getTodaySessions(p));
      case 'getTodaySummary':           return ok(getTodaySummary(p));
      case 'getReportHistory':          return ok(getReportHistory(p));
      case 'getWeeklySummary':          return ok(getWeeklySummary(p));
      case 'hasTodayReport':            return ok(hasTodayReport(p));
      case 'getTeamLeaderWeekly':       return ok(getTeamLeaderWeekly(p));
      case 'getFinalizedWeeklyReports': return ok(getFinalizedWeeklyReports(p));
      case 'getStaffForTeamLeader':     return ok(getStaffForTeamLeader(p));
      case 'getAdminDashboard':         return ok(getAdminDashboard(p));
      case 'getAllDeptsSummary':         return ok(getAllDeptsSummary(p));
      case 'getTravelOrders':           return ok(getTravelOrdersGET(p));
      default: return err('Unknown GET action: ' + action);
    }
  } catch (e2) { logErr('doGet', action, e2); return err(e2.message); }
}

function doPost(e) {
  e = e || {};
  var body = {};
  try { body = JSON.parse((e.postData && e.postData.contents) ? e.postData.contents : '{}'); }
  catch (_) { return err('Invalid JSON in request body.'); }
  var action = body.action || '';
  try {
    switch (action) {
      case 'appendRow':              return ok(appendRowToSheet(body));
      case 'updateRow':              return ok(updateRowInSheet(body));
      case 'createTask':             return ok(createTask(body));
      case 'startTask':              return ok(startTask(body));
      case 'pauseTask':              return ok(pauseTask(body));
      case 'resumeTask':             return ok(resumeTask(body));
      case 'endTask':                return ok(endTask(body));
      case 'uploadFieldWorkProof':   return ok(uploadFieldWorkProof(body));
      case 'finalizeDailyReport':    return ok(finalizeDailyReport(body));
      case 'finalizeWeeklyReport':   return ok(finalizeWeeklyReport(body));
      case 'createTravelOrder':      return ok(createTravelOrder(body));
      case 'approveTravelOrder':     return ok(approveTravelOrder(body));
      default: return err('Unknown POST action: ' + action);
    }
  } catch (e2) { logErr('doPost', action, e2); return err(e2.message); }
}

function ok(data) {
  var out = { success: true };
  if (data && typeof data === 'object') {
    Object.keys(data).forEach(function (k) { out[k] = data[k]; });
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
function err(msg) {
  return ContentService.createTextOutput(JSON.stringify({ success: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
function logErr(fn, action, e2) {
  console.error('[DTIM] ' + fn + ' | action=' + action + ' | ' + e2.message);
}

// ============================================================
// DATE / ID HELPERS
// ============================================================

// "yyyy-MM-dd" — internal use only (comparisons)
function todayStr()  { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

// Human-readable: "Mar 26, 2026"
function dateReadable(d) {
  var dt = (d instanceof Date) ? d : new Date();
  return Utilities.formatDate(dt, TZ, 'MMM dd, yyyy');
}

// Human-readable: "Mar 26, 2026 5:35 PM"
function nowReadable() {
  return Utilities.formatDate(new Date(), TZ, 'MMM dd, yyyy h:mm a');
}

// Store dates as human-readable
function todayReadable() { return dateReadable(new Date()); }

function cellDate(val) {
  if (!val || val === '') return null;
  if (val instanceof Date) return Utilities.formatDate(val, TZ, 'yyyy-MM-dd');
  return String(val).substring(0, 10);
}

function cellTs(val) {
  if (!val || val === '') return null;
  if (val instanceof Date) return Utilities.formatDate(val, TZ, 'MMM dd, yyyy h:mm a');
  return String(val);
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  var d = new Date(val); return isNaN(d.getTime()) ? null : d;
}

function sessionDate(s) {
  var ts = parseDate(s['Timestamp'] || s.timestamp);
  if (ts) return Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
  return (s['Date'] || s.date || '').substring(0, 10);
}

function resolveDate(p) {
  if (p && p.date && String(p.date).length >= 8) return String(p.date).substring(0, 10);
  return todayStr();
}

function addDays(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

// ── READABLE ID FORMAT: PREFIX-YYYYMMDD-NNN ──────────────────
// Examples: TASK-20260326-001, SES-20260326-002, DR-20260326-001
var _idCounters_ = {};
function generateId(prefix) {
  var today = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  var key   = (prefix || 'ID') + '_' + today;
  _idCounters_[key] = (_idCounters_[key] || 0) + 1;
  var seq   = String(_idCounters_[key]);
  while (seq.length < 3) seq = '0' + seq;
  return (prefix || 'ID') + '-' + today + '-' + seq;
}

function empMatch(a, b) {
  if (!b) return true;
  return String(a || '').trim() === String(b || '').trim();
}

// ── null helper — returns null for blank values ───────────────
function n(v) {
  if (v === null || v === undefined || v === '') return null;
  return v;
}

// ── Weekly deadline: Friday 5:00 PM ──────────────────────────
function getFridayDeadline(weekStartStr) {
  // weekStartStr is a Monday yyyy-MM-dd
  var d = new Date(weekStartStr + 'T00:00:00');
  d.setDate(d.getDate() + 4); // Friday
  d.setHours(17, 0, 0, 0);   // 5:00 PM
  return d;
}

function isOnTime(weekStartStr, submittedAt) {
  if (!submittedAt) return false;
  var deadline = getFridayDeadline(weekStartStr);
  var subDate  = parseDate(submittedAt);
  return subDate && subDate <= deadline;
}

// ============================================================
// SHEET HELPERS
// ============================================================

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    if (name === SH_WEEKLY) {
      sh = ss.insertSheet(name);
      sh.appendRow(['Report ID','Department','Team Leader','Week Start','Week End',
        'Total Staff','Total Hours','Completed Tasks','Ongoing Tasks','Pause Reasons',
        'WeeklySummary','Recommendations','Finalized At','Weekly Report Status','PDF Link']);
      return sh;
    }
    if (name === SH_TRAVEL) {
      sh = ss.insertSheet(name);
      sh.appendRow(['Travel Order ID','Employee Name','Position','Department','Destination',
        'Date','Purpose','Budget','Funding Source','Team Leader Approval',
        'Finance Approval','Status','Attachment/PDF Link']);
      return sh;
    }
    throw new Error('Sheet not found: ' + name);
  }
  return sh;
}

function sheetToObjects(sheetName) {
  var sh   = getSheet(sheetName);
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var hdrs = data[0].map(function (h) { return String(h).trim(); });
  return data.slice(1)
    .filter(function (row) {
      return row.some(function (c) { return c !== '' && c !== null && c !== undefined; });
    })
    .map(function (row) {
      var obj = {};
      hdrs.forEach(function (h, i) {
        var c = row[i];
        obj[h] = c instanceof Date
          ? Utilities.formatDate(c, TZ, 'MMM dd, yyyy h:mm a')
          : (c === null || c === undefined || c === '' ? null : c);
      });
      return obj;
    });
}

function getHeaders(sheetName) {
  var sh = getSheet(sheetName);
  if (sh.getLastColumn() === 0) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
}

function readDropdownCol(sh, col) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, col, last - 1, 1).getValues()
    .map(function (r) { return String(r[0]); })
    .filter(function (v) { return v && v !== 'undefined' && v !== 'false' && v.trim() !== ''; });
}

// ============================================================
// getSheet — primary read handler
// ============================================================

function getSheetData(p) {
  var name = p.sheet || '';
  if (!name) throw new Error('sheet parameter is required.');
  return { data: sheetToObjects(name) };
}

// ============================================================
// appendRow — writes null for blank fields
// ============================================================

function appendRowToSheet(body) {
  var sheetName = body.sheet || '';
  var rowData   = body.data  || {};
  if (!sheetName) throw new Error('sheet is required.');

  var sh   = getSheet(sheetName);
  var hdrs = getHeaders(sheetName);
  if (hdrs.length === 0) throw new Error('Sheet has no header row: ' + sheetName);

  var row = hdrs.map(function (h) {
    var v = rowData[h];
    if (v === undefined) return null;
    return (v === null || v === '') ? null : v;
  });

  sh.appendRow(row);
  return { sheet: sheetName, appended: true };
}

// ============================================================
// updateRow
// ============================================================

function updateRowInSheet(body) {
  var sheetName = body.sheet    || '';
  var idColumn  = body.idColumn || '';
  var idValue   = body.idValue  || '';
  var updates   = body.data     || {};
  if (!sheetName) throw new Error('sheet is required.');
  if (!idColumn)  throw new Error('idColumn is required.');
  if (!idValue)   throw new Error('idValue is required.');

  var sh   = getSheet(sheetName);
  var data = sh.getDataRange().getValues();
  var hdrs = data[0].map(function (h) { return String(h).trim(); });
  var cIdx = hdrs.indexOf(idColumn);
  if (cIdx < 0) throw new Error('Column not found: "' + idColumn + '" in ' + sheetName);

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][cIdx]).trim() !== String(idValue).trim()) continue;
    var rowNum = i + 1;
    Object.keys(updates).forEach(function (key) {
      var kIdx = hdrs.indexOf(key);
      if (kIdx >= 0) {
        var v = updates[key];
        sh.getRange(rowNum, kIdx + 1).setValue((v === null || v === undefined || v === '') ? null : v);
      }
    });
    return { sheet: sheetName, updated: true, row: rowNum };
  }
  return { sheet: sheetName, updated: false, idColumn: idColumn, idValue: idValue };
}

// ============================================================
// EMPLOYEE LOOKUP
// ============================================================

function getEmployeeByEmail(p) {
  var email = String(p.email || '').toLowerCase().trim();
  if (!email) throw new Error('email parameter is required.');

  var sh   = getSheet(SH_EMPLOYEES);
  var data = sh.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var row      = data[i];
    var rowEmail = String(row[4] || '').toLowerCase().trim();
    if (rowEmail !== email) continue;

    var rawActive = row[7];
    var isActive  = (rawActive === true || rawActive === 'TRUE' ||
                     String(rawActive).toLowerCase() === 'true' ||
                     rawActive === 1 ||
                     rawActive === '' || rawActive === null || rawActive === undefined);
    if (!isActive) throw new Error('Account is inactive. Contact your admin.');

    return {
      data: {
        'Employee ID':                       String(row[1] || ''),
        'Employee Name':                     String(row[2] || ''),
        'Department':                        String(row[3] || ''),
        'Email':                             String(row[4] || ''),
        'Position':                          String(row[5] || ''),
        'Assigned Team Leader / Reports To': String(row[6] || ''),
        'Is Active': true
      }
    };
  }
  throw new Error('Email not found in Employee List.');
}

// ============================================================
// REFERENCE / DROPDOWN DATA
// ============================================================

function getReferenceData() {
  var sh = getSheet(SH_DROPDOWN);
  return {
    data: {
      statuses:     readDropdownCol(sh, 1),
      actionTypes:  readDropdownCol(sh, 2),
      pauseReasons: readDropdownCol(sh, 3),
      priorities:   readDropdownCol(sh, 5),
      taskTypes:    readDropdownCol(sh, 6),
      access:       readDropdownCol(sh, 7),
      departments:  readDropdownCol(sh, 8),
      workModes:    readDropdownCol(sh, 9)
    }
  };
}

// ============================================================
// ROW MAPPERS
// ============================================================

function mapTask(row) {
  return {
    'Task ID':               String(row[0]  || ''),
    'Employee Name':         String(row[1]  || ''),
    'Task Name':             String(row[2]  || ''),
    'Task Description':      String(row[3]  || ''),
    'Department':            String(row[4]  || ''),
    'Task Type':             String(row[5]  || ''),
    'Status':                String(row[6]  || ''),
    'Priority':              String(row[7]  || ''),
    'Date Created':          cellDate(row[8]),
    'Date Started':          cellDate(row[9]),
    'Date Completed':        cellDate(row[10]),
    'Latest Update':         cellTs(row[11]),
    'Is Active':             (row[12] === true || String(row[12]).toLowerCase() === 'true') ? 'true' : 'false',
    'Daily Accomplishment':  n(String(row[13] || '')),
    'Blockers/Issue':        n(String(row[14] || '')),
    'Blockers / Issues':     n(String(row[14] || '')), // alias
    'Next Step':             n(String(row[15] || '')),
    'Work Mode':             String(row[16] || 'Office'),
    'Event / Shoot Details': n(String(row[17] || '')),
    'Location / Venue':      n(String(row[18] || '')),
    'Proof Link':            n(String(row[19] || '')),
    'Scheduled Field Date':  n(String(row[20] || '')) // NEW: col 20
  };
}

function mapSession(row) {
  return {
    'Session ID':    String(row[0] || ''),
    'Task ID':       String(row[1] || ''),
    'Employee Name': String(row[2] || ''),
    'Date':          cellDate(row[3]),
    'Action Type':   String(row[4] || ''),
    'Timestamp':     cellTs(row[5]),
    'Pause Reason':  n(String(row[6] || '')),
    'Action Notes':  n(String(row[7] || ''))
  };
}

function mapReport(row) {
  return {
    'Report ID':           String(row[0]  || ''),
    'Employee Name':       String(row[1]  || ''),
    'Report Date':         cellDate(row[2]),
    'Total Active Hours':  String(row[3]  || '0'),
    'Tasks Worked On':     n(String(row[4]  || '')),
    'Completed Tasks':     n(String(row[5]  || '')),
    'Ongoing Tasks':       n(String(row[6]  || '')),
    'Pause Reasons':       n(String(row[7]  || '')),
    'Daily Summary':       String(row[8]  || ''),
    'Finalized At':        cellTs(row[9]),
    'Daily report Status': String(row[10] || 'Finalized'),
    'Daily Report Status': String(row[10] || 'Finalized') // alias
  };
}

// ============================================================
// ACTIVE TIME COMPUTATION
// ============================================================

function computeActiveMs(sessions) {
  var sorted = sessions.slice().sort(function (a, b) {
    return new Date(a['Timestamp'] || a.timestamp || 0) -
           new Date(b['Timestamp'] || b.timestamp || 0);
  });
  var total = 0, seg = null;
  for (var i = 0; i < sorted.length; i++) {
    var s  = sorted[i];
    var at = parseDate(s['Timestamp'] || s.timestamp);
    var t  = String(s['Action Type'] || s.actionType || '').toLowerCase();
    if (t === 'start' || t === 'resume')  { seg = at; }
    else if ((t === 'pause' || t === 'end') && seg && at) {
      total += Math.max(0, at.getTime() - seg.getTime());
      seg = null;
    }
  }
  if (seg) total += Math.max(0, Date.now() - seg.getTime());
  return total;
}

function fmtMs(ms) {
  if (!ms || ms <= 0) return '0m';
  var s = Math.floor(ms / 1000);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  return h > 0 ? (h + 'h ' + (m < 10 ? '0' : '') + m + 'm') : m + 'm';
}

// ============================================================
// GET TASKS
// ============================================================

function getTasksGET(p) {
  var emp    = p.employeeName || p.employee || '';
  var dept   = p.department   || '';
  var st     = p.status       || '';
  var fDate  = p.fieldDate    || ''; // date to check for field work scheduled
  var sh     = getSheet(SH_TASKS);
  var data   = sh.getDataRange().getValues();
  var out    = [];
  var today  = fDate || todayStr();

  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var t = mapTask(data[i]);

    // Standard filters
    if (emp  && !empMatch(t['Employee Name'], emp)) continue;
    if (dept && t['Department'] !== dept)           continue;
    if (st   && t['Status']     !== st)             continue;

    // Include field work tasks scheduled for 'today' even if created on a different day
    if (t['Work Mode'] === 'Field' && t['Scheduled Field Date']) {
      var sfd = String(t['Scheduled Field Date']).substring(0, 10);
      // Always include field tasks where scheduled date matches today
      if (emp && sfd === today) { out.push(t); continue; }
    }

    out.push(t);
  }
  return { data: out };
}

function getSessionsForTask(taskId) {
  var sh   = getSheet(SH_SESSIONS);
  var data = sh.getDataRange().getValues();
  var out  = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && String(data[i][1]) === String(taskId)) out.push(mapSession(data[i]));
  }
  return out;
}

// ============================================================
// GET ACTIVE TASK
// ============================================================

function getActiveTask(p) {
  var emp  = p.employeeName || '';
  var sh   = getSheet(SH_TASKS);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var t = mapTask(data[i]);
    if (t['Status'] !== 'In Progress' || !empMatch(t['Employee Name'], emp)) continue;
    if (t['Work Mode'] === 'Field') continue; // Field tasks never have running timer
    var ts = getSessionsForTask(t['Task ID']);
    ts.sort(function (a, b) { return new Date(a['Timestamp']) - new Date(b['Timestamp']); });
    var lastStart = null;
    for (var k = ts.length - 1; k >= 0; k--) {
      var typ = String(ts[k]['Action Type'] || '').toLowerCase();
      if (typ === 'start' || typ === 'resume') { lastStart = ts[k]; break; }
    }
    return { data: { task: t, timerStartedAt: lastStart ? lastStart['Timestamp'] : null, activeMs: computeActiveMs(ts) } };
  }
  return { data: null };
}

// ============================================================
// GET PAUSED TASKS
// ============================================================

function getPausedTasks(p) {
  var emp  = p.employeeName || '';
  var sh   = getSheet(SH_TASKS);
  var data = sh.getDataRange().getValues();
  var out  = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var t = mapTask(data[i]);
    if (t['Status'] !== 'Paused' || !empMatch(t['Employee Name'], emp)) continue;
    var ts = getSessionsForTask(t['Task ID']);
    ts.sort(function (a, b) { return new Date(a['Timestamp']) - new Date(b['Timestamp']); });
    var lastReason = null;
    for (var k = ts.length - 1; k >= 0; k--) {
      if (String(ts[k]['Action Type'] || '').toLowerCase() === 'pause') {
        lastReason = ts[k]['Pause Reason'] || null; break;
      }
    }
    out.push({ task: t, lastPauseReason: lastReason, activeMs: computeActiveMs(ts) });
  }
  return { data: out };
}

// ============================================================
// GET TODAY SESSIONS
// ============================================================

function getTodaySessions(p) {
  var emp   = p.employeeName || '';
  var fDate = resolveDate(p);
  var sSh   = getSheet(SH_SESSIONS);
  var sData = sSh.getDataRange().getValues();
  var tSh   = getSheet(SH_TASKS);
  var tDat  = tSh.getDataRange().getValues();
  var tMap  = {};
  for (var j = 1; j < tDat.length; j++) {
    if (tDat[j][0]) tMap[String(tDat[j][0])] = {
      name:     String(tDat[j][2]  || ''),
      workMode: String(tDat[j][16] || '')
    };
  }
  var out = [];
  for (var i = 1; i < sData.length; i++) {
    if (!sData[i][0]) continue;
    var s = mapSession(sData[i]);
    if (sessionDate(s) !== fDate || !empMatch(s['Employee Name'], emp)) continue;
    s.taskName = (tMap[s['Task ID']] || {}).name     || s['Task ID'];
    s.workMode = (tMap[s['Task ID']] || {}).workMode || '';
    out.push(s);
  }
  out.sort(function (a, b) { return new Date(a['Timestamp']) - new Date(b['Timestamp']); });
  return { data: out };
}

// ============================================================
// GET TODAY SUMMARY
// ============================================================

function getTodaySummary(p) {
  var emp   = p.employeeName || '';
  var fDate = resolveDate(p);
  var sSh   = getSheet(SH_SESSIONS);
  var sData = sSh.getDataRange().getValues();
  var sess  = [];
  for (var i = 1; i < sData.length; i++) {
    if (!sData[i][0]) continue;
    var s = mapSession(sData[i]);
    if (sessionDate(s) === fDate && empMatch(s['Employee Name'], emp)) sess.push(s);
  }
  var taskIds = [];
  sess.forEach(function (s) { if (taskIds.indexOf(s['Task ID']) === -1) taskIds.push(s['Task ID']); });

  var tSh  = getSheet(SH_TASKS);
  var tDat = tSh.getDataRange().getValues();
  var tMap = {};
  for (var j = 1; j < tDat.length; j++) { if (tDat[j][0]) tMap[String(tDat[j][0])] = mapTask(tDat[j]); }

  // Also include field work tasks scheduled for today (even if no sessions)
  for (var k = 1; k < tDat.length; k++) {
    if (!tDat[k][0]) continue;
    var ft = mapTask(tDat[k]);
    if (ft['Work Mode'] !== 'Field') continue;
    var sfd = String(ft['Scheduled Field Date'] || '').substring(0, 10);
    if (sfd !== fDate) continue;
    if (!empMatch(ft['Employee Name'], emp)) continue;
    if (taskIds.indexOf(ft['Task ID']) === -1) taskIds.push(ft['Task ID']);
  }

  var totalMs = 0, breakdown = [], completed = [], ongoing = [], pauseCount = {};
  taskIds.forEach(function (tid) {
    var ts   = sess.filter(function (s) { return s['Task ID'] === tid; });
    var task = tMap[tid] || { 'Task Name': tid, 'Status': '?', 'Department': '', 'Priority': '', 'Work Mode': '' };

    var ms = 0;
    if (task['Work Mode'] !== 'Field') {
      // Only compute time for non-field tasks
      ms = computeActiveMs(ts);
      totalMs += ms;
    }

    breakdown.push({
      taskId:    tid,
      taskName:  task['Task Name'],
      department:task['Department'],
      priority:  task['Priority'],
      status:    task['Status'],
      workMode:  task['Work Mode'],
      activeMs:  ms,
      proofLink: task['Proof Link']
    });

    // Completed field work counts only if proof uploaded
    if (task['Status'] === 'Completed' && task['Work Mode'] === 'Field' && task['Proof Link']) {
      completed.push(task['Task Name']);
    } else if (task['Status'] === 'Completed' && task['Work Mode'] !== 'Field') {
      completed.push(task['Task Name']);
    } else if (task['Status'] === 'In Progress' || task['Status'] === 'Paused') {
      ongoing.push(task['Task Name']);
    }

    ts.forEach(function (s) {
      if (String(s['Action Type'] || '').toLowerCase() === 'pause' && s['Pause Reason'])
        pauseCount[s['Pause Reason']] = (pauseCount[s['Pause Reason']] || 0) + 1;
    });
  });

  var pauses = sess.filter(function (s) { return String(s['Action Type'] || '').toLowerCase() === 'pause'; }).length;
  return {
    data: {
      date: fDate, employeeName: emp, totalMs: totalMs,
      totalHoursLabel: fmtMs(totalMs),
      taskCount: taskIds.length, completedCount: completed.length, ongoingCount: ongoing.length,
      pauseCount: pauses, taskBreakdown: breakdown,
      completedTasks: completed, ongoingTasks: ongoing,
      pauseReasonCount: pauseCount, hasSessions: sess.length > 0
    }
  };
}

// ============================================================
// HAS TODAY REPORT
// ============================================================

function hasTodayReport(p) {
  var emp     = p.employeeName || '';
  var fDate   = resolveDate(p);
  var rSh     = getSheet(SH_REPORTS);
  var rData   = rSh.getDataRange().getValues();
  var hasReport = false, isFinalized = false, reportId = '';

  for (var i = 1; i < rData.length; i++) {
    if (!rData[i][0]) continue;
    if (empMatch(String(rData[i][1]), emp) && cellDate(rData[i][2]) === fDate) {
      hasReport   = true;
      reportId    = String(rData[i][0]);
      isFinalized = String(rData[i][10] || '').toLowerCase() === 'finalized';
      break;
    }
  }

  var sSh   = getSheet(SH_SESSIONS);
  var sDat  = sSh.getDataRange().getValues();
  var hasSessions = false;
  for (var j = 1; j < sDat.length; j++) {
    if (!sDat[j][0]) continue;
    var s = mapSession(sDat[j]);
    if (sessionDate(s) === fDate && empMatch(s['Employee Name'], emp)) { hasSessions = true; break; }
  }
  return { data: { hasReport: hasReport, isFinalized: isFinalized, hasSessions: hasSessions, reportId: reportId } };
}

// ============================================================
// GET REPORT HISTORY
// ============================================================

function getReportHistory(p) {
  var emp    = p.employeeName || '';
  var period = p.period       || 'week';
  var rSh    = getSheet(SH_REPORTS);
  var rData  = rSh.getDataRange().getValues();
  var cutoff = new Date();
  if (period === 'week')       cutoff.setDate(cutoff.getDate() - 7);
  else if (period === 'month') cutoff.setDate(cutoff.getDate() - 30);
  else                         cutoff = new Date('2000-01-01');
  var reps = [];
  for (var i = 1; i < rData.length; i++) {
    if (!rData[i][0]) continue;
    var r = mapReport(rData[i]);
    var d = parseDate(r['Report Date']);
    if (d && d >= cutoff && (!emp || empMatch(r['Employee Name'], emp))) reps.push(r);
  }
  reps.sort(function (a, b) { return new Date(b['Report Date']) - new Date(a['Report Date']); });
  return { data: reps };
}

// ============================================================
// STAFF FOR TEAM LEADER
// ============================================================

function getStaffForTeamLeader(p) {
  var tlName   = p.teamLeaderName || '';
  var dept     = p.department     || '';
  var sh       = getSheet(SH_EMPLOYEES);
  var data     = sh.getDataRange().getValues();
  var assigned = [], sameDept = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][2]) continue;
    var emp    = String(data[i][2] || '');
    var pos    = String(data[i][5] || '');
    var rto    = String(data[i][6] || '');
    var d      = String(data[i][3] || '');
    var rawAct = data[i][7];
    var active = (rawAct === true || rawAct === 'TRUE' ||
                  String(rawAct).toLowerCase() === 'true' ||
                  rawAct === '' || rawAct === null || rawAct === undefined);
    if (!active) continue;
    var isStaff = (pos === 'Staff' || pos === '' ||
                  (pos !== 'Team Leader' && pos !== 'Management' &&
                   pos !== 'Admin Access' && pos !== 'System Admin'));
    if (isStaff) {
      if (tlName && rto === tlName) assigned.push(emp);
      if (dept   && d  === dept)   sameDept.push(emp);
    }
  }
  var result = assigned.length ? assigned : sameDept;
  return { data: { staff: result, source: assigned.length ? 'assigned' : 'department' } };
}

// ============================================================
// GET WEEKLY SUMMARY
// ============================================================

function getWeeklySummary(p) {
  var weekStart   = p.weekStart  || todayStr();
  var dept        = p.department || '';
  var tlName      = p.teamLeader || '';
  var monStr      = weekStart.substring(0, 10);
  var friStr      = addDays(monStr, 4);
  var allowedEmps = null;
  if (tlName) {
    var st = getStaffForTeamLeader({ teamLeaderName: tlName, department: dept }).data;
    allowedEmps = st.staff || [];
    if (allowedEmps.indexOf(tlName) === -1) allowedEmps.push(tlName);
  }
  var rSh   = getSheet(SH_REPORTS);
  var rData = rSh.getDataRange().getValues();
  var weekReps = [];
  for (var i = 1; i < rData.length; i++) {
    if (!rData[i][0]) continue;
    var r = mapReport(rData[i]);
    if (!r['Report Date'] || r['Report Date'] < monStr || r['Report Date'] > friStr) continue;
    if (dept && !tlName && r['Department'] !== dept) continue;
    if (allowedEmps && allowedEmps.indexOf(r['Employee Name']) === -1) continue;
    weekReps.push(r);
  }
  var byEmp = {};
  weekReps.forEach(function (r) {
    var nm = r['Employee Name'] || '?';
    if (!byEmp[nm]) byEmp[nm] = [];
    byEmp[nm].push(r);
  });
  var summaries = Object.keys(byEmp).map(function (nm) {
    return { employeeName: nm, dailyReports: byEmp[nm], activeDays: byEmp[nm].length };
  });
  var sSh   = getSheet(SH_SESSIONS);
  var sDat  = sSh.getDataRange().getValues();
  var pauseBreakdown = {};
  for (var j = 1; j < sDat.length; j++) {
    if (!sDat[j][0]) continue;
    var s = mapSession(sDat[j]);
    if (String(s['Action Type'] || '').toLowerCase() !== 'pause') continue;
    var sd = sessionDate(s);
    if (sd < monStr || sd > friStr || !s['Pause Reason']) continue;
    if (allowedEmps && allowedEmps.indexOf(s['Employee Name']) === -1) continue;
    pauseBreakdown[s['Pause Reason']] = (pauseBreakdown[s['Pause Reason']] || 0) + 1;
  }
  var days = [];
  for (var di = 0; di < 5; di++) {
    var ds = addDays(monStr, di);
    days.push({ date: ds, reports: weekReps.filter(function (r) { return r['Report Date'].substring(0, 10) === ds; }) });
  }
  return { data: { weekStart: monStr, summaries: summaries, pauseBreakdown: pauseBreakdown, days: days, totalReports: weekReps.length } };
}

// ============================================================
// GET TEAM LEADER WEEKLY (Mon–Fri)
// ============================================================

function getTeamLeaderWeekly(p) {
  var dept      = p.department || '';
  var weekStart = p.weekStart  || todayStr();
  var tlName    = p.teamLeader || '';
  var monStr    = weekStart.substring(0, 10);
  var friStr    = addDays(monStr, 4);
  var allowedEmps = null;
  if (tlName) {
    var st = getStaffForTeamLeader({ teamLeaderName: tlName, department: dept }).data;
    allowedEmps = st.staff || [];
    if (allowedEmps.indexOf(tlName) === -1) allowedEmps.push(tlName);
  } else if (dept) {
    var eSh  = getSheet(SH_EMPLOYEES);
    var eDat = eSh.getDataRange().getValues();
    allowedEmps = [];
    for (var i = 1; i < eDat.length; i++) {
      if (eDat[i][2] && String(eDat[i][3] || '') === dept) allowedEmps.push(String(eDat[i][2]));
    }
  }
  var rSh  = getSheet(SH_REPORTS);
  var rDat = rSh.getDataRange().getValues();
  var reps = [];
  for (var j = 1; j < rDat.length; j++) {
    if (!rDat[j][0]) continue;
    var r = mapReport(rDat[j]);
    if (!r['Report Date'] || r['Report Date'] < monStr || r['Report Date'] > friStr) continue;
    if (allowedEmps && allowedEmps.indexOf(r['Employee Name']) === -1) continue;
    reps.push(r);
  }
  var totalTasks = 0, totalDone = 0, totalOngoing = 0;
  reps.forEach(function (r) {
    var tCount   = parseInt(r['Tasks Worked On'], 10);
    totalTasks   += isNaN(tCount) ? (r['Tasks Worked On'] || '').split(',').filter(Boolean).length : tCount;
    totalDone    += parseInt(r['Completed Tasks'] || 0, 10) || 0;
    totalOngoing += parseInt(r['Ongoing Tasks']   || 0, 10) || 0;
  });
  return { data: { weekStart: monStr, department: dept, reports: reps, totalReports: reps.length, totalTasks: totalTasks, totalCompleted: totalDone, totalOngoing: totalOngoing } };
}

// ============================================================
// GET FINALIZED WEEKLY REPORTS (Management view)
// Only shows reports with status = 'Submitted' (on time by Friday 5PM)
// ============================================================

function getFinalizedWeeklyReports(p) {
  var dept = p.department || '';
  try {
    var data = sheetToObjects(SH_WEEKLY);
    data = data.filter(function (r) {
      var st = String(r['Weekly Report Status'] || '').toLowerCase();
      return st === 'submitted';  // Only on-time submissions visible to Management
    });
    if (dept) data = data.filter(function (r) { return r['Department'] === dept; });
    data.sort(function (a, b) { return new Date(b['Week Start'] || '') - new Date(a['Week Start'] || ''); });
    return { data: data };
  } catch (_) { return { data: [] }; }
}

// ============================================================
// ADMIN DASHBOARD
// ============================================================

function getAdminDashboard(p) {
  var fDate  = resolveDate(p);
  var deptF  = p.department || '';
  var tSh    = getSheet(SH_TASKS);
  var tDat   = tSh.getDataRange().getValues();
  var sSh    = getSheet(SH_SESSIONS);
  var sDat   = sSh.getDataRange().getValues();
  var empMap = {};
  function rec(name) {
    if (!empMap[name]) empMap[name] = { employeeName: name, department: '', status: 'Idle', activeTask: null, pausedTasks: [], todayMs: 0, taskCount: 0, pauseCount: 0, lastActivity: null, timerStartedAt: null };
    return empMap[name];
  }
  var sessByEmp = {};
  for (var i = 1; i < sDat.length; i++) {
    if (!sDat[i][0]) continue;
    var s = mapSession(sDat[i]);
    if (sessionDate(s) !== fDate) continue;
    var se = s['Employee Name'];
    if (!sessByEmp[se]) sessByEmp[se] = [];
    sessByEmp[se].push(s);
    var er = rec(se);
    if (!er.lastActivity || new Date(s['Timestamp']) > new Date(er.lastActivity)) er.lastActivity = s['Timestamp'];
  }
  for (var j = 1; j < tDat.length; j++) {
    if (!tDat[j][0]) continue;
    var t = mapTask(tDat[j]);
    if (!t['Employee Name']) continue;
    if (deptF && t['Department'] !== deptF) continue;
    var er2 = rec(t['Employee Name']);
    er2.department = t['Department'];
    if (t['Status'] === 'In Progress' && t['Work Mode'] !== 'Field') er2.activeTask = t;
    else if (t['Status'] === 'Paused') er2.pausedTasks.push(t);
  }
  Object.keys(empMap).forEach(function (name) {
    var er3  = empMap[name];
    var sess = sessByEmp[name] || [];
    var tids = [];
    sess.forEach(function (s) { if (tids.indexOf(s['Task ID']) === -1) tids.push(s['Task ID']); });
    er3.taskCount = tids.length;
    var tot = 0;
    tids.forEach(function (tid) { tot += computeActiveMs(sess.filter(function (s) { return s['Task ID'] === tid; })); });
    er3.todayMs         = tot;
    er3.todayHoursLabel = fmtMs(tot);
    er3.pauseCount      = sess.filter(function (s) { return String(s['Action Type'] || '').toLowerCase() === 'pause'; }).length;
    er3.status          = er3.activeTask ? 'Active' : er3.pausedTasks.length > 0 ? 'Paused' : 'Idle';
    if (er3.activeTask) {
      var ts2 = sess.filter(function (s) { return s['Task ID'] === er3.activeTask['Task ID']; });
      ts2.sort(function (a, b) { return new Date(a['Timestamp']) - new Date(b['Timestamp']); });
      for (var k = ts2.length - 1; k >= 0; k--) {
        var typ = String(ts2[k]['Action Type'] || '').toLowerCase();
        if (typ === 'start' || typ === 'resume') { er3.timerStartedAt = ts2[k]['Timestamp']; break; }
      }
    }
  });
  var list = Object.keys(empMap).map(function (nm) { return empMap[nm]; });
  var pri  = { Active: 0, Paused: 1, Idle: 2 };
  list.sort(function (a, b) { return (pri[a.status] || 2) - (pri[b.status] || 2); });
  return { data: { date: fDate, employees: list,
    totalActive: list.filter(function (e) { return e.status === 'Active'; }).length,
    totalPaused: list.filter(function (e) { return e.status === 'Paused'; }).length,
    totalIdle:   list.filter(function (e) { return e.status === 'Idle';   }).length,
    generatedAt: nowReadable() } };
}

// ============================================================
// ALL DEPARTMENTS SUMMARY
// ============================================================

function getAllDeptsSummary(p) {
  var fDate = resolveDate(p);
  var tSh   = getSheet(SH_TASKS);
  var tDat  = tSh.getDataRange().getValues();
  var sSh   = getSheet(SH_SESSIONS);
  var sDat  = sSh.getDataRange().getValues();
  var dMap  = {};
  for (var i = 1; i < tDat.length; i++) {
    if (!tDat[i][0]) continue;
    var t = mapTask(tDat[i]);
    var d = t['Department']; if (!d) continue;
    if (!dMap[d]) dMap[d] = { department: d, activeCount: 0, totalStaff: 0, completedTasks: 0, totalMs: 0, _e: {} };
    if (!dMap[d]._e[t['Employee Name']]) { dMap[d]._e[t['Employee Name']] = true; dMap[d].totalStaff++; }
    if (t['Status'] === 'In Progress' && t['Work Mode'] !== 'Field') dMap[d].activeCount++;
    if (t['Status'] === 'Completed') dMap[d].completedTasks++;
  }
  var tDeptMap = {};
  for (var j = 1; j < tDat.length; j++) { if (tDat[j][0]) tDeptMap[String(tDat[j][0])] = String(tDat[j][4] || ''); }
  var dSess = {};
  for (var k = 1; k < sDat.length; k++) {
    if (!sDat[k][0]) continue;
    var s = mapSession(sDat[k]);
    if (sessionDate(s) !== fDate) continue;
    var dp = tDeptMap[s['Task ID']] || ''; if (!dp) continue;
    if (!dSess[dp]) dSess[dp] = [];
    dSess[dp].push(s);
  }
  Object.keys(dSess).forEach(function (dept) {
    var ss2 = dSess[dept], tids2 = [];
    ss2.forEach(function (s) { if (tids2.indexOf(s['Task ID']) === -1) tids2.push(s['Task ID']); });
    var tot2 = 0;
    tids2.forEach(function (tid) { tot2 += computeActiveMs(ss2.filter(function (s) { return s['Task ID'] === tid; })); });
    if (dMap[dept]) { dMap[dept].totalMs = tot2; dMap[dept].totalHours = fmtMs(tot2); }
  });
  var res = Object.keys(dMap).map(function (d) { var r = dMap[d]; delete r._e; return r; });
  res.sort(function (a, b) { return b.activeCount - a.activeCount; });
  return { data: res };
}

// ============================================================
// TRAVEL ORDERS GET
// ============================================================

function getTravelOrdersGET(p) {
  var emp = p.employeeName || '', st = p.status || '';
  try {
    var data = sheetToObjects(SH_TRAVEL);
    if (emp) data = data.filter(function (o) { return empMatch(o['Employee Name'], emp); });
    if (st)  data = data.filter(function (o) { return o['Status'] === st; });
    return { data: data };
  } catch (_) { return { data: [] }; }
}

// ============================================================
// TASK LIFECYCLE POST HANDLERS
// ============================================================

function createTask(body) {
  var name = body.taskName || '';
  var emp  = body.employeeName || '';
  if (!name) throw new Error('taskName is required.');
  if (!emp)  throw new Error('employeeName is required.');

  var sh      = getSheet(SH_TASKS);
  var taskId  = body.taskId || generateId('TASK');
  var isField = (body.workMode || 'Office') === 'Field';
  var status  = isField ? 'Pending Proof' : 'Not Started';

  sh.appendRow([
    taskId,                                             // 0  Task ID
    emp,                                                // 1  Employee Name
    name,                                               // 2  Task Name
    body.taskDesc || body.taskDescription || null,      // 3  Task Description
    body.department || null,                            // 4  Department
    body.taskType   || null,                            // 5  Task Type
    status,                                             // 6  Status
    body.priority   || 'Medium',                        // 7  Priority
    todayReadable(),                                    // 8  Date Created (readable)
    null,                                               // 9  Date Started
    null,                                               // 10 Date Completed
    nowReadable(),                                      // 11 Latest Update
    'FALSE',                                            // 12 Is Active
    null,                                               // 13 Daily Accomplishment
    null,                                               // 14 Blockers/Issue
    null,                                               // 15 Next Step
    body.workMode || 'Office',                          // 16 Work Mode
    n(body.eventDetails)  || null,                      // 17 Event/Shoot Details
    n(body.location || body.locationVenue) || null,     // 18 Location/Venue
    n(body.proofLink) || null,                          // 19 Proof Link
    isField ? (n(body.scheduledFieldDate) || n(body.fieldDate)) : null  // 20 Scheduled Field Date
  ]);
  return { data: { taskId: taskId, taskName: name, status: status, workMode: body.workMode || 'Office' } };
}

function startTask(body) {
  var taskId = String(body.taskId || '');
  var emp    = body.employeeName || '';
  if (!taskId) throw new Error('taskId is required.');
  if (!emp)    throw new Error('employeeName is required.');
  var sh = getSheet(SH_TASKS), data = sh.getDataRange().getValues(), row = -1, task = null;
  for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === taskId) { row = i + 1; task = mapTask(data[i]); break; } }
  if (!task) throw new Error('Task not found: ' + taskId);
  if (task['Work Mode'] === 'Field') throw new Error('Field work tasks cannot be started with a timer. Upload proof to complete.');
  if (task['Status'] === 'In Progress') throw new Error('Task is already In Progress.');
  if (task['Status'] === 'Completed' || task['Status'] === 'Cancelled') throw new Error('Cannot start a ' + task['Status'] + ' task.');
  for (var j = 1; j < data.length; j++) {
    if (!data[j][0]) continue;
    var ot = mapTask(data[j]);
    if (ot['Status'] === 'In Progress' && empMatch(ot['Employee Name'], emp) && ot['Task ID'] !== taskId)
      throw new Error('Another task is running: "' + ot['Task Name'] + '". Pause it first.');
  }
  var now = nowReadable();
  sh.getRange(row, 7).setValue('In Progress');
  if (!task['Date Started']) sh.getRange(row, 10).setValue(todayReadable());
  sh.getRange(row, 12).setValue(now);
  sh.getRange(row, 13).setValue('TRUE');
  var sid = generateId('SES');
  getSheet(SH_SESSIONS).appendRow([sid, taskId, emp, todayReadable(), 'Start', now, null, null]);
  return { data: { taskId: taskId, sessionId: sid, timestamp: now, status: 'In Progress' } };
}

function pauseTask(body) {
  var taskId = String(body.taskId || '');
  var emp    = body.employeeName || '';
  var reason = body.pauseReason  || '';
  if (!taskId) throw new Error('taskId is required.');
  if (!emp)    throw new Error('employeeName is required.');
  if (!reason) throw new Error('Pause reason is required.');
  var sh = getSheet(SH_TASKS), data = sh.getDataRange().getValues(), row = -1, task = null;
  for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === taskId) { row = i + 1; task = mapTask(data[i]); break; } }
  if (!task) throw new Error('Task not found.');
  if (task['Status'] !== 'In Progress') throw new Error('Task is not In Progress (current: ' + task['Status'] + ').');
  var now = nowReadable();
  sh.getRange(row, 7).setValue('Paused');
  sh.getRange(row, 12).setValue(now);
  sh.getRange(row, 13).setValue('FALSE');
  var sid = generateId('SES');
  getSheet(SH_SESSIONS).appendRow([sid, taskId, emp, todayReadable(), 'Pause', now, reason, n(body.notes)]);
  return { data: { taskId: taskId, sessionId: sid, timestamp: now, status: 'Paused' } };
}

function resumeTask(body) {
  var taskId = String(body.taskId || '');
  var emp    = body.employeeName || '';
  if (!taskId) throw new Error('taskId is required.');
  if (!emp)    throw new Error('employeeName is required.');
  var sh = getSheet(SH_TASKS), data = sh.getDataRange().getValues(), row = -1, task = null;
  for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === taskId) { row = i + 1; task = mapTask(data[i]); break; } }
  if (!task) throw new Error('Task not found.');
  if (task['Status'] !== 'Paused') throw new Error('Task is not Paused (current: ' + task['Status'] + ').');
  for (var j = 1; j < data.length; j++) {
    if (!data[j][0]) continue;
    var ot = mapTask(data[j]);
    if (ot['Status'] === 'In Progress' && empMatch(ot['Employee Name'], emp) && ot['Task ID'] !== taskId)
      throw new Error('Another task is running: "' + ot['Task Name'] + '". Pause it first.');
  }
  var now = nowReadable();
  sh.getRange(row, 7).setValue('In Progress');
  sh.getRange(row, 12).setValue(now);
  sh.getRange(row, 13).setValue('TRUE');
  var sid = generateId('SES');
  getSheet(SH_SESSIONS).appendRow([sid, taskId, emp, todayReadable(), 'Resume', now, null, n(body.notes)]);
  return { data: { taskId: taskId, sessionId: sid, timestamp: now, status: 'In Progress' } };
}

function endTask(body) {
  var taskId = String(body.taskId || '');
  var emp    = body.employeeName || '';
  if (!taskId) throw new Error('taskId is required.');
  if (!emp)    throw new Error('employeeName is required.');
  var sh = getSheet(SH_TASKS), data = sh.getDataRange().getValues(), row = -1, task = null;
  for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === taskId) { row = i + 1; task = mapTask(data[i]); break; } }
  if (!task) throw new Error('Task not found.');
  if (task['Work Mode'] === 'Field') throw new Error('Field work tasks are completed by uploading proof, not by ending a timer.');
  if (task['Status'] !== 'In Progress' && task['Status'] !== 'Paused')
    throw new Error('Task is not active or paused (current: ' + task['Status'] + ').');
  var now = nowReadable();
  sh.getRange(row, 7).setValue('Completed');
  if (!task['Date Started']) sh.getRange(row, 10).setValue(todayReadable());
  sh.getRange(row, 11).setValue(todayReadable());
  sh.getRange(row, 12).setValue(now);
  sh.getRange(row, 13).setValue('FALSE');
  if (body.proofLink)      sh.getRange(row, 20).setValue(body.proofLink);
  if (body.accomplishment) sh.getRange(row, 14).setValue(body.accomplishment);
  var sid = generateId('SES');
  getSheet(SH_SESSIONS).appendRow([sid, taskId, emp, todayReadable(), 'End', now, null, n(body.endNotes || body.notes)]);
  return { data: { taskId: taskId, sessionId: sid, timestamp: now, status: 'Completed' } };
}

// ============================================================
// UPLOAD FIELD WORK PROOF — Auto-completes field work task
// POST { action:'uploadFieldWorkProof', taskId, proofLink, employeeName }
// ============================================================

function uploadFieldWorkProof(body) {
  var taskId    = String(body.taskId    || '');
  var proofLink = String(body.proofLink || '');
  var emp       = body.employeeName || '';
  if (!taskId)    throw new Error('taskId is required.');
  if (!proofLink) throw new Error('proofLink is required.');
  if (!emp)       throw new Error('employeeName is required.');

  var sh = getSheet(SH_TASKS), data = sh.getDataRange().getValues(), row = -1, task = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === taskId) { row = i + 1; task = mapTask(data[i]); break; }
  }
  if (!task) throw new Error('Task not found: ' + taskId);
  if (task['Work Mode'] !== 'Field') throw new Error('This action is only for Field work tasks.');

  var now = nowReadable();
  sh.getRange(row, 7).setValue('Completed');           // Status
  sh.getRange(row, 11).setValue(todayReadable());      // Date Completed
  sh.getRange(row, 12).setValue(now);                  // Latest Update
  sh.getRange(row, 13).setValue('FALSE');              // Is Active
  sh.getRange(row, 20).setValue(proofLink);            // Proof Link

  // Log a "Proof Uploaded" session entry for record
  var sid = generateId('SES');
  getSheet(SH_SESSIONS).appendRow([
    sid, taskId, emp, todayReadable(), 'Proof Uploaded', now, null, 'Field work proof uploaded — task auto-completed'
  ]);

  return { data: { taskId: taskId, sessionId: sid, timestamp: now, status: 'Completed', proofLink: proofLink } };
}

// ============================================================
// FINALIZE DAILY REPORT
// NOTE: Pending / Not Started tasks are ignored.
//       Only In Progress, Paused, Completed tasks are counted.
//       Field work: only if proofLink uploaded.
// ============================================================

function finalizeDailyReport(body) {
  var emp     = body.employeeName || '';
  var date    = resolveDate(body);
  var summary = body.accomplishment || body.summary || body.summaryNote || '';
  if (!emp)     throw new Error('employeeName is required.');
  if (!summary) throw new Error('Daily summary is required.');

  var s     = getTodaySummary({ employeeName: emp, date: date }).data;
  var pc    = s.pauseReasonCount || {}, pauseStr = null;
  var pKeys = Object.keys(pc);
  if (pKeys.length > 0) {
    pauseStr = pKeys.map(function (k) { return k + ' (' + pc[k] + 'x)'; }).join(', ');
  }

  var rSh   = getSheet(SH_REPORTS);
  var rData = rSh.getDataRange().getValues();
  var existRow = -1, existId = '';
  for (var j = 1; j < rData.length; j++) {
    if (!rData[j][0]) continue;
    if (empMatch(String(rData[j][1]), emp) && cellDate(rData[j][2]) === date) {
      existRow = j + 1; existId = String(rData[j][0]); break;
    }
  }

  var reportId = existId || generateId('DR');
  var now      = nowReadable();

  var completedNames = s.completedTasks && s.completedTasks.length > 0 ? s.completedTasks.join(', ') : null;
  var ongoingNames   = s.ongoingTasks   && s.ongoingTasks.length   > 0 ? s.ongoingTasks.join(', ')   : null;
  var workedNames    = s.taskBreakdown  && s.taskBreakdown.length   > 0
    ? s.taskBreakdown.map(function (t) { return t.taskName; }).join(', ')
    : null;

  // Row: 11 columns — NO Department
  var row = [
    reportId,                 // 0  Report ID
    emp,                      // 1  Employee Name
    date,                     // 2  Report Date
    s.totalHoursLabel,        // 3  Total Active Hours
    workedNames,              // 4  Tasks Worked On
    completedNames,           // 5  Completed Tasks
    ongoingNames,             // 6  Ongoing Tasks
    pauseStr,                 // 7  Pause Reasons
    summary,                  // 8  Daily Summary
    now,                      // 9  Finalized At
    'Finalized'               // 10 Daily report Status
  ];

  if (existRow > 0) rSh.getRange(existRow, 1, 1, row.length).setValues([row]);
  else              rSh.appendRow(row);

  return { data: { reportId: reportId, employeeName: emp, date: date, summary: s, finalizedAt: now, status: 'Finalized' } };
}

// ============================================================
// FINALIZE WEEKLY REPORT
// Deadline: Friday 5:00 PM
// Status: 'Submitted' if on time → visible to Management
//         'Late' if after deadline → NOT visible to Management
// TL can submit anytime — flexible submission always supported.
// ============================================================

function finalizeWeeklyReport(body) {
  var dept   = body.department || '';
  var tl     = body.teamLeader || '';
  var monStr = (body.weekStart || todayStr()).substring(0, 10);
  var friStr = addDays(monStr, 4);
  if (!dept) throw new Error('department is required.');
  if (!tl)   throw new Error('teamLeader is required.');

  var compiled   = getTeamLeaderWeekly({ department: dept, weekStart: monStr, teamLeader: tl }).data;
  var staffNames = [];
  compiled.reports.forEach(function (r) {
    if (staffNames.indexOf(r['Employee Name']) === -1) staffNames.push(r['Employee Name']);
  });

  var wSh   = getSheet(SH_WEEKLY);
  var wData = wSh.getDataRange().getValues();
  var wHdrs = wData.length > 0 ? wData[0].map(function (h) { return String(h).trim(); }) : [];
  var dIdx  = wHdrs.indexOf('Department');
  var wsIdx = wHdrs.indexOf('Week Start');
  var existRow = -1, existId = '';
  for (var i = 1; i < wData.length; i++) {
    var rDept = dIdx  >= 0 ? String(wData[i][dIdx]  || '') : '';
    var rWS   = wsIdx >= 0 ? cellDate(wData[i][wsIdx]) : '';
    if (rDept === dept && rWS === monStr) { existRow = i + 1; existId = String(wData[i][0] || ''); break; }
  }

  // Determine on-time status — deadline is Friday 5:00 PM
  var now         = new Date();
  var submittedAt = now.toISOString();
  var status      = isOnTime(monStr, submittedAt) ? 'Submitted' : 'Late';

  var reportId      = existId || generateId('WR');
  var nowStr_r      = nowReadable();
  var totalHoursArr = compiled.reports.map(function (r) { return r['Total Active Hours'] || '0'; });

  var completedNames = null, ongoingNames = null;
  var completed = [], ongoing = [];
  compiled.reports.forEach(function (r) {
    if (r['Completed Tasks']) r['Completed Tasks'].split(',').forEach(function (s) { var t = s.trim(); if (t && completed.indexOf(t) === -1) completed.push(t); });
    if (r['Ongoing Tasks'])   r['Ongoing Tasks'].split(',').forEach(function (s) { var t = s.trim(); if (t && ongoing.indexOf(t)   === -1) ongoing.push(t);   });
  });
  if (completed.length > 0) completedNames = completed.join(', ');
  if (ongoing.length   > 0) ongoingNames   = ongoing.join(', ');

  var row = [
    reportId,                                        // 0  Report ID
    dept,                                            // 1  Department
    tl,                                              // 2  Team Leader
    dateReadable(new Date(monStr + 'T00:00:00')),    // 3  Week Start
    dateReadable(new Date(friStr + 'T00:00:00')),    // 4  Week End
    staffNames.length,                               // 5  Total Staff
    totalHoursArr.join(' | '),                       // 6  Total Hours
    completedNames,                                  // 7  Completed Tasks
    ongoingNames,                                    // 8  Ongoing Tasks
    null,                                            // 9  Pause Reasons
    n(body.summaryNote || body.summary),             // 10 WeeklySummary
    n(body.recommendations),                         // 11 Recommendations
    nowStr_r,                                        // 12 Finalized At
    status,                                          // 13 Weekly Report Status
    null                                             // 14 PDF Link
  ];

  if (existRow > 0) wSh.getRange(existRow, 1, 1, row.length).setValues([row]);
  else              wSh.appendRow(row);

  return { data: {
    reportId:     reportId,
    department:   dept,
    teamLeader:   tl,
    weekStart:    monStr,
    status:       status,
    onTime:       status === 'Submitted',
    totalReports: compiled.reports.length,
    finalizedAt:  nowStr_r
  }};
}

// ============================================================
// TRAVEL ORDERS POST
// ============================================================

function createTravelOrder(body) {
  var emp = body.employeeName || '';
  if (!emp) throw new Error('employeeName is required.');
  var budget = parseFloat(body.budget) || 0;
  var fin    = budget > 0 ? 'Pending' : 'N/A';
  var sh     = getSheet(SH_TRAVEL);
  var toId   = generateId('TO');
  sh.appendRow([
    toId,                      // 0  Travel Order ID
    emp,                       // 1  Employee Name
    n(body.position),          // 2  Position
    n(body.department),        // 3  Department
    body.destination || null,  // 4  Destination
    n(body.date) || todayReadable(), // 5  Date
    body.purpose   || null,    // 6  Purpose
    budget || null,            // 7  Budget
    n(body.fundingSource),     // 8  Funding Source
    'Pending',                 // 9  Team Leader Approval
    fin,                       // 10 Finance Approval
    'Pending',                 // 11 Status
    null                       // 12 Attachment/PDF Link
  ]);
  return { data: { travelOrderId: toId, status: 'Pending', financeApproval: fin } };
}

function approveTravelOrder(body) {
  var toId     = body.travelOrderId || '';
  var role     = body.role          || '';
  var decision = body.decision      || 'Approved';
  if (!toId) throw new Error('travelOrderId is required.');
  var sh   = getSheet(SH_TRAVEL);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== toId) continue;
    var rn = i + 1;
    if (role === 'TeamLeader') sh.getRange(rn, 10).setValue(decision);
    else if (role === 'Finance') sh.getRange(rn, 11).setValue(decision);
    var tla  = String(sh.getRange(rn, 10).getValue() || '');
    var fin2 = String(sh.getRange(rn, 11).getValue() || '');
    var overall = (tla === 'Approved' && (fin2 === 'Approved' || fin2 === 'N/A')) ? 'Approved' : 'Pending';
    if (tla === 'Rejected' || fin2 === 'Rejected') overall = 'Rejected';
    sh.getRange(rn, 12).setValue(overall);
    return { data: { travelOrderId: toId, status: overall } };
  }
  throw new Error('Travel Order not found: ' + toId);
}
