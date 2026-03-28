// ============================================================
// Code.gs — DTIM v2.3  (Google Apps Script Backend)
// Deploy: Execute as Me | Who has access: Anyone (anonymous)
//
// NEW in v2.3:
//  1. submitFieldProof() — new POST action
//       • Saves Proof Link to TASKS sheet
//       • Auto-marks task as Completed
//       • No timer / session logic for field tasks
//  2. createTask(): field tasks use Date Started = Scheduled Field Date
//       • Status = 'Pending Proof' (not 'Not Started')
//  3. finalizeWeeklyReport(): Week End = Friday, deadline = Friday 5:00 PM
//       • Status = 'Submitted' (on time) | 'Late' (past 5 PM)
//  4. All dates stored as readable: "Mar 26, 2026"
//  5. All timestamps stored as readable: "Mar 26, 2026 5:35 PM"
//  6. IDs: TASK-20260326-0001 format (sequential, PropertiesService)
//  7. All empty/null fields stored as 'null' string
//
// SHEET COLUMN ORDERS:
//  TASKS (20 cols): Task ID|Employee Name|Task Name|Task Desc|
//    Department|Task Type|Status|Priority|Date Created|Date Started|
//    Date Completed|Latest Update|Is Active|Daily Accomplishment|
//    Blockers/Issue|Next Step|Work Mode|Event / Shoot Details|
//    Location / Venue|Proof Link
//
//  Field task special: Date Started = Scheduled Field Date at creation
//
//  TASK SESSIONS (8 cols): Session ID|Task ID|Employee Name|Date|
//    Action Type|Timestamp|Pause Reason|Action Notes
//    (Field tasks do NOT generate sessions)
//
//  DAILY REPORTS (11 cols, NO Department): Report ID|Employee Name|
//    Report Date|Total Active Hours|Tasks Worked On|Completed Tasks|
//    Ongoing Tasks|Pause Reasons|Daily Summary|Finalized At|
//    Daily report Status
//
//  WEEKLY REPORTS (15 cols): Report ID|Department|Team Leader|
//    Week Start|Week End|Total Staff|Total Hours|Completed Tasks|
//    Ongoing Tasks|Pause Reasons|WeeklySummary|Recommendations|
//    Finalized At|Weekly Report Status|PDF Link
//
//  EMPLOYEE LIST (Col A blank, B-H):
//    B=Employee ID|C=Employee Name|D=Department|E=Email|
//    F=Position|G=Assigned TL|H=Is Active
//
//  TRAVEL ORDERS (13 cols): Travel Order ID|Employee Name|Position|
//    Department|Destination|Date|Purpose|Budget|Funding Source|
//    Team Leader Approval|Finance Approval|Status|Attachment/PDF Link
// ============================================================

var TZ          = Session.getScriptTimeZone();
var SH_TASKS    = 'TASKS';
var SH_SESSIONS = 'TASK SESSIONS';
var SH_REPORTS  = 'DAILY REPORTS';
var SH_WEEKLY   = 'WEEKLY REPORTS';
var SH_DROPDOWN = 'DROPDOWN';
var SH_EMPLOYEES= 'EMPLOYEE LIST';
var SH_TRAVEL   = 'TRAVEL ORDERS';

// ============================================================
// ENTRY POINTS
// ============================================================

function doGet(e) {
  e = e || {}; e.parameter = e.parameter || {};
  var action = e.parameter.action || '';
  var p = e.parameter;
  try {
    switch (action) {
      case 'getSheet':                  return ok(getSheetData(p));
      case 'ping':                      return ok({ message:'DTIM v2.3 online', time:nowStr() });
      case 'getEmployeeByEmail':        return ok(getEmployeeByEmail(p));
      case 'getReferenceData':          return ok(getReferenceData());
      case 'getTasks':                  return ok(getTasksGET(p));
      case 'getActiveTask':             return ok(getActiveTask(p));
      case 'getPausedTasks':            return ok(getPausedTasks(p));
      case 'getTodaySessions':          return ok(getTodaySessions(p));
      case 'getTodaySummary':           return ok(getTodaySummary(p));
      case 'getReportHistory':          return ok(getReportHistory(p));
      case 'hasTodayReport':            return ok(hasTodayReport(p));
      case 'getTeamLeaderWeekly':       return ok(getTeamLeaderWeekly(p));
      case 'getFinalizedWeeklyReports': return ok(getFinalizedWeeklyReports(p));
      case 'getStaffForTeamLeader':     return ok(getStaffForTeamLeader(p));
      case 'getTravelOrders':           return ok(getTravelOrdersGET(p));
      default: return err('Unknown GET action: ' + action);
    }
  } catch (e2) { logErr('doGet', action, e2); return err(e2.message); }
}

function doPost(e) {
  e = e || {};
  var body = {};
  try { body = JSON.parse((e.postData && e.postData.contents) ? e.postData.contents : '{}'); }
  catch (_) { return err('Invalid JSON.'); }
  var action = body.action || '';
  try {
    switch (action) {
      case 'appendRow':            return ok(appendRowToSheet(body));
      case 'updateRow':            return ok(updateRowInSheet(body));
      case 'createTask':           return ok(createTask(body));
      case 'startTask':            return ok(startTask(body));
      case 'pauseTask':            return ok(pauseTask(body));
      case 'resumeTask':           return ok(resumeTask(body));
      case 'endTask':              return ok(endTask(body));
      case 'submitFieldProof':     return ok(submitFieldProof(body));  // NEW v2.3
      case 'finalizeDailyReport':  return ok(finalizeDailyReport(body));
      case 'finalizeWeeklyReport': return ok(finalizeWeeklyReport(body));
      case 'createTravelOrder':    return ok(createTravelOrder(body));
      case 'approveTravelOrder':   return ok(approveTravelOrder(body));
      default: return err('Unknown POST action: ' + action);
    }
  } catch (e2) { logErr('doPost', action, e2); return err(e2.message); }
}

function ok(data) {
  var out = { success: true };
  if (data && typeof data === 'object')
    Object.keys(data).forEach(function(k) { out[k] = data[k]; });
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function err(msg) {
  return ContentService.createTextOutput(JSON.stringify({success:false,error:msg})).setMimeType(ContentService.MimeType.JSON);
}
function logErr(fn, action, e2) { console.error('[DTIM] '+fn+' | action='+action+' | '+e2.message); }

// ============================================================
// DATE / ID HELPERS
// ============================================================

// YYYY-MM-DD — internal comparisons only (NOT stored in DB)
function todayStr() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

// "Mar 26, 2026" — for Date-only DB fields (Date Created, Report Date, etc.)
function displayDate() { return Utilities.formatDate(new Date(), TZ, 'MMM d, yyyy'); }

// "Mar 26, 2026 5:35 PM" — for all timestamp DB fields
function nowStr() { return Utilities.formatDate(new Date(), TZ, 'MMM d, yyyy h:mm a'); }

function fmtDisplayDate(d) { return Utilities.formatDate(d, TZ, 'MMM d, yyyy'); }

// Parse any date string (ISO, readable, or Date object)
function parseDate(val) {
  if (!val || val === 'null' || val === '') return null;
  if (val instanceof Date) return val;
  var d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// Get YYYY-MM-DD from any value
function cellDate(val) {
  if (!val || val === 'null' || val === '') return '';
  if (val instanceof Date) return Utilities.formatDate(val, TZ, 'yyyy-MM-dd');
  var d = parseDate(val);
  if (d) return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  return String(val).substring(0, 10);
}

// Get readable timestamp from any value
function cellTs(val) {
  if (!val || val === 'null' || val === '') return '';
  if (val instanceof Date) return Utilities.formatDate(val, TZ, 'MMM d, yyyy h:mm a');
  return String(val);
}

function addDays(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

// Sequential readable ID: TASK-20260326-0001
function generateId(prefix) {
  var today = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  var key   = 'cnt_' + (prefix||'ID') + '_' + today;
  var props = PropertiesService.getScriptProperties();
  var n     = parseInt(props.getProperty(key) || '0') + 1;
  props.setProperty(key, String(n));
  return (prefix||'ID') + '-' + today + '-' + ('000' + n).slice(-4);
}

function empMatch(a, b) {
  if (!b) return true;
  return String(a||'').trim() === String(b||'').trim();
}

function resolveDate(p) {
  if (p && p.date) { var d = parseDate(String(p.date)); if (d) return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
  return todayStr();
}

function sessionDate(s) {
  var ts = parseDate(s['Timestamp'] || s.timestamp);
  if (ts) return Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
  return cellDate(s['Date'] || s.date || '');
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

// sheetToObjects: Date cells → readable "Mar 26, 2026 5:35 PM"
function sheetToObjects(sheetName) {
  var sh   = getSheet(sheetName);
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var hdrs = data[0].map(function(h) { return String(h).trim(); });
  return data.slice(1)
    .filter(function(row) {
      return row.some(function(c) { return c !== '' && c !== null && c !== undefined; });
    })
    .map(function(row) {
      var obj = {};
      hdrs.forEach(function(h, i) {
        var c = row[i];
        if (c instanceof Date) {
          obj[h] = Utilities.formatDate(c, TZ, 'MMM d, yyyy h:mm a');
        } else {
          obj[h] = (c === null || c === undefined || c === '') ? 'null' : c;
        }
      });
      return obj;
    });
}

function getHeaders(sheetName) {
  var sh = getSheet(sheetName);
  if (sh.getLastColumn() === 0) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim(); });
}

function readDropdownCol(sh, col) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, col, last-1, 1).getValues()
    .map(function(r) { return String(r[0]); })
    .filter(function(v) { return v && v !== 'undefined' && v !== 'false' && v.trim() !== ''; });
}

function getSheetData(p) {
  var name = p.sheet || '';
  if (!name) throw new Error('sheet parameter is required.');
  return { data: sheetToObjects(name) };
}

// appendRow: empty/null → 'null' string
function appendRowToSheet(body) {
  var sheetName = body.sheet || '';
  var rowData   = body.data  || {};
  if (!sheetName) throw new Error('sheet is required.');
  var sh   = getSheet(sheetName);
  var hdrs = getHeaders(sheetName);
  if (hdrs.length === 0) throw new Error('Sheet has no header row: ' + sheetName);
  var row = hdrs.map(function(h) {
    var v = rowData[h];
    return (v === undefined || v === null || v === '') ? 'null' : v;
  });
  sh.appendRow(row);
  return { sheet: sheetName, appended: true };
}

// updateRow: empty/null → 'null' string
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
  var hdrs = data[0].map(function(h) { return String(h).trim(); });
  var cIdx = hdrs.indexOf(idColumn);
  if (cIdx < 0) throw new Error('Column not found: "' + idColumn + '" in ' + sheetName);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][cIdx]).trim() !== String(idValue).trim()) continue;
    var rowNum = i + 1;
    Object.keys(updates).forEach(function(key) {
      var kIdx = hdrs.indexOf(key);
      if (kIdx >= 0) {
        var v = updates[key];
        sh.getRange(rowNum, kIdx+1).setValue((v===null||v===undefined||v==='')?'null':v);
      }
    });
    return { sheet: sheetName, updated: true, row: rowNum };
  }
  return { sheet: sheetName, updated: false };
}

// ============================================================
// EMPLOYEE LOOKUP
// ============================================================

function getEmployeeByEmail(p) {
  var email = String(p.email||'').toLowerCase().trim();
  if (!email) throw new Error('email parameter is required.');
  var sh   = getSheet(SH_EMPLOYEES);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var row      = data[i];
    var rowEmail = String(row[4]||'').toLowerCase().trim();
    if (rowEmail !== email) continue;
    var rawActive = row[7];
    var isActive  = (rawActive===true || rawActive==='TRUE' ||
      String(rawActive).toLowerCase()==='true' ||
      rawActive===1 || rawActive==='' || rawActive===null || rawActive===undefined);
    if (!isActive) throw new Error('Account is inactive. Contact your admin.');
    return { data: {
      'Employee ID':                       String(row[1]||''),
      'Employee Name':                     String(row[2]||''),
      'Department':                        String(row[3]||''),
      'Email':                             String(row[4]||''),
      'Position':                          String(row[5]||''),
      'Assigned Team Leader / Reports To': String(row[6]||''),
      'Is Active':                         true
    }};
  }
  throw new Error('Email not found in Employee List.');
}

// ============================================================
// DROPDOWN / REFERENCE DATA
// Columns from screenshot: A=Status B=Action Type C=Pause Reason
//   D=(blank) E=Priority F=Task Type G=Access H=Departments I=Work Mode
// ============================================================

function getReferenceData() {
  var sh = getSheet(SH_DROPDOWN);
  return { data: {
    statuses:     readDropdownCol(sh, 1),  // A
    actionTypes:  readDropdownCol(sh, 2),  // B
    pauseReasons: readDropdownCol(sh, 3),  // C
    priorities:   readDropdownCol(sh, 5),  // E
    taskTypes:    readDropdownCol(sh, 6),  // F
    access:       readDropdownCol(sh, 7),  // G
    departments:  readDropdownCol(sh, 8),  // H
    workModes:    readDropdownCol(sh, 9)   // I
  }};
}

// ============================================================
// ROW MAPPERS
// ============================================================

function mapTask(row) {
  return {
    'Task ID':               String(row[0] ||''),
    'Employee Name':         String(row[1] ||''),
    'Task Name':             String(row[2] ||''),
    'Task Description':      String(row[3] ||'null'),
    'Department':            String(row[4] ||''),
    'Task Type':             String(row[5] ||''),
    'Status':                String(row[6] ||'Not Started'),
    'Priority':              String(row[7] ||''),
    'Date Created':          cellTs(row[8]),
    'Date Started':          cellTs(row[9]),
    'Date Completed':        cellTs(row[10]),
    'Latest Update':         cellTs(row[11]),
    'Is Active':             (row[12]===true||String(row[12]).toLowerCase()==='true') ? 'true' : 'false',
    'Daily Accomplishment':  String(row[13]||'null'),
    'Blockers/Issue':        String(row[14]||'null'),
    'Blockers / Issues':     String(row[14]||'null'),
    'Next Step':             String(row[15]||'null'),
    'Work Mode':             String(row[16]||'Office'),
    'Event / Shoot Details': String(row[17]||'null'),
    'Location / Venue':      String(row[18]||'null'),
    'Proof Link':            String(row[19]||'null')
  };
}

function mapSession(row) {
  return {
    'Session ID':    String(row[0]||''),
    'Task ID':       String(row[1]||''),
    'Employee Name': String(row[2]||''),
    'Date':          String(row[3]||''),
    'Action Type':   String(row[4]||''),
    'Timestamp':     cellTs(row[5]),
    'Pause Reason':  String(row[6]||'null'),
    'Action Notes':  String(row[7]||'null')
  };
}

function mapReport(row) {
  return {
    'Report ID':           String(row[0] ||''),
    'Employee Name':       String(row[1] ||''),
    'Report Date':         String(row[2] ||''),
    'Total Active Hours':  String(row[3] ||'0'),
    'Tasks Worked On':     String(row[4] ||'null'),
    'Completed Tasks':     String(row[5] ||'null'),
    'Ongoing Tasks':       String(row[6] ||'null'),
    'Pause Reasons':       String(row[7] ||'null'),
    'Daily Summary':       String(row[8] ||''),
    'Finalized At':        cellTs(row[9]),
    'Daily report Status': String(row[10]||'Finalized'),
    'Daily Report Status': String(row[10]||'Finalized')
  };
}

// ============================================================
// ACTIVE TIME CALCULATOR
// ============================================================

function computeActiveMs(sessions) {
  var sorted = sessions.slice().sort(function(a,b) {
    var ta = parseDate(a['Timestamp']||a.timestamp);
    var tb = parseDate(b['Timestamp']||b.timestamp);
    return (ta?ta.getTime():0) - (tb?tb.getTime():0);
  });
  var total = 0, seg = null;
  for (var i = 0; i < sorted.length; i++) {
    var s  = sorted[i];
    var at = parseDate(s['Timestamp']||s.timestamp);
    var t  = String(s['Action Type']||s.actionType||'').toLowerCase();
    if (t==='start'||t==='resume') seg = at;
    else if ((t==='pause'||t==='end') && seg && at) { total += Math.max(0, at.getTime()-seg.getTime()); seg=null; }
  }
  if (seg) total += Math.max(0, Date.now()-seg.getTime());
  return total;
}

function fmtMs(ms) {
  if (!ms||ms<=0) return '0m';
  var s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60);
  return h>0 ? (h+'h '+(m<10?'0':'')+m+'m') : m+'m';
}

// ============================================================
// GET TASKS
// ============================================================

function getTasksGET(p) {
  var emp  = p.employeeName||p.employee||'';
  var dept = p.department||'';
  var st   = p.status||'';
  var sh   = getSheet(SH_TASKS);
  var data = sh.getDataRange().getValues();
  var out  = [];
  for (var i=1; i<data.length; i++) {
    if (!data[i][0]) continue;
    var t = mapTask(data[i]);
    if (emp  && !empMatch(t['Employee Name'], emp)) continue;
    if (dept && t['Department'] !== dept)            continue;
    if (st   && t['Status']     !== st)              continue;
    out.push(t);
  }
  return { data: out };
}

function getSessionsForTask(taskId) {
  var sh = getSheet(SH_SESSIONS), data = sh.getDataRange().getValues(), out = [];
  for (var i=1; i<data.length; i++)
    if (data[i][0] && String(data[i][1])===String(taskId)) out.push(mapSession(data[i]));
  return out;
}

function getActiveTask(p) {
  var emp  = p.employeeName||'';
  var sh   = getSheet(SH_TASKS);
  var data = sh.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (!data[i][0]) continue;
    var t = mapTask(data[i]);
    if (t['Status']!=='In Progress'||!empMatch(t['Employee Name'],emp)) continue;
    var ts = getSessionsForTask(t['Task ID']);
    ts.sort(function(a,b){ var ta=parseDate(a['Timestamp']),tb=parseDate(b['Timestamp']); return (ta||new Date(0)).getTime()-(tb||new Date(0)).getTime(); });
    var lastStart=null;
    for (var k=ts.length-1;k>=0;k--) { var typ=String(ts[k]['Action Type']||'').toLowerCase(); if(typ==='start'||typ==='resume'){lastStart=ts[k];break;} }
    return {data:{task:t, timerStartedAt:lastStart?lastStart['Timestamp']:null, activeMs:computeActiveMs(ts)}};
  }
  return {data:null};
}

function getPausedTasks(p) {
  var emp  = p.employeeName||'';
  var sh   = getSheet(SH_TASKS);
  var data = sh.getDataRange().getValues(), out = [];
  for (var i=1; i<data.length; i++) {
    if (!data[i][0]) continue;
    var t = mapTask(data[i]);
    if (t['Status']!=='Paused'||!empMatch(t['Employee Name'],emp)) continue;
    var ts=getSessionsForTask(t['Task ID']), lastReason='';
    for (var k=ts.length-1;k>=0;k--) { if(String(ts[k]['Action Type']||'').toLowerCase()==='pause'){lastReason=ts[k]['Pause Reason']||'';break;} }
    out.push({task:t, lastPauseReason:lastReason, activeMs:computeActiveMs(ts)});
  }
  return {data:out};
}

function getTodaySessions(p) {
  var emp=p.employeeName||'', fDate=resolveDate(p);
  var sSh=getSheet(SH_SESSIONS), sData=sSh.getDataRange().getValues();
  var tSh=getSheet(SH_TASKS),    tDat=tSh.getDataRange().getValues(), tMap={};
  for (var j=1; j<tDat.length; j++)
    if (tDat[j][0]) tMap[String(tDat[j][0])]={name:String(tDat[j][2]||''), workMode:String(tDat[j][16]||'')};
  var out=[];
  for (var i=1; i<sData.length; i++) {
    if (!sData[i][0]) continue;
    var s=mapSession(sData[i]);
    if (sessionDate(s)!==fDate||!empMatch(s['Employee Name'],emp)) continue;
    s.taskName=(tMap[s['Task ID']]||{}).name||s['Task ID'];
    s.workMode=(tMap[s['Task ID']]||{}).workMode||'';
    out.push(s);
  }
  out.sort(function(a,b){var ta=parseDate(a['Timestamp']),tb=parseDate(b['Timestamp']);return (ta||new Date(0)).getTime()-(tb||new Date(0)).getTime();});
  return {data:out};
}

function getTodaySummary(p) {
  var emp=p.employeeName||'', fDate=resolveDate(p);
  var sSh=getSheet(SH_SESSIONS), sData=sSh.getDataRange().getValues(), sess=[];
  for (var i=1; i<sData.length; i++) {
    if (!sData[i][0]) continue;
    var s=mapSession(sData[i]);
    if (sessionDate(s)===fDate&&empMatch(s['Employee Name'],emp)) sess.push(s);
  }
  var taskIds=[], tMap={};
  sess.forEach(function(s){if(taskIds.indexOf(s['Task ID'])===-1) taskIds.push(s['Task ID']);});
  var tSh=getSheet(SH_TASKS),tDat=tSh.getDataRange().getValues();
  for (var j=1;j<tDat.length;j++) if(tDat[j][0]) tMap[String(tDat[j][0])]=mapTask(tDat[j]);

  var totalMs=0, breakdown=[], completed=[], ongoing=[], pauseCount={};
  taskIds.forEach(function(tid) {
    var ts=sess.filter(function(s){return s['Task ID']===tid;}), ms=computeActiveMs(ts);
    totalMs+=ms;
    var task=tMap[tid]||{'Task Name':tid,'Status':'?','Department':'','Priority':'','Work Mode':''};
    breakdown.push({taskId:tid,taskName:task['Task Name'],department:task['Department'],priority:task['Priority'],status:task['Status'],workMode:task['Work Mode'],activeMs:ms});
    if(task['Status']==='Completed') completed.push(task['Task Name']);
    else if(task['Status']==='In Progress'||task['Status']==='Paused') ongoing.push(task['Task Name']);
    ts.forEach(function(s){
      if(String(s['Action Type']||'').toLowerCase()==='pause'&&s['Pause Reason']&&s['Pause Reason']!=='null')
        pauseCount[s['Pause Reason']]=(pauseCount[s['Pause Reason']]||0)+1;
    });
  });
  var pauses=sess.filter(function(s){return String(s['Action Type']||'').toLowerCase()==='pause';}).length;
  return {data:{date:fDate,employeeName:emp,totalMs:totalMs,totalHoursLabel:fmtMs(totalMs),
    taskCount:taskIds.length,completedCount:completed.length,ongoingCount:ongoing.length,
    pauseCount:pauses,taskBreakdown:breakdown,completedTasks:completed,ongoingTasks:ongoing,
    pauseReasonCount:pauseCount,hasSessions:sess.length>0}};
}

function hasTodayReport(p) {
  var emp=p.employeeName||'', fDate=resolveDate(p);
  var rSh=getSheet(SH_REPORTS), rData=rSh.getDataRange().getValues();
  var hasReport=false, isFinalized=false, reportId='';
  for (var j=1;j<rData.length;j++) {
    if (!rData[j][0]) continue;
    if (!empMatch(String(rData[j][1]||''),emp)||cellDate(rData[j][2])!==fDate) continue;
    hasReport=true; isFinalized=String(rData[j][10]||'').toLowerCase().includes('finalized'); reportId=String(rData[j][0]||''); break;
  }
  return {data:{hasReport:hasReport,isFinalized:isFinalized,reportId:reportId}};
}

function getReportHistory(p) {
  var emp=p.employeeName||'', rSh=getSheet(SH_REPORTS), data=rSh.getDataRange().getValues(), out=[];
  for (var j=1;j<data.length;j++) { if(!data[j][0]) continue; var r=mapReport(data[j]); if(!empMatch(r['Employee Name'],emp)) continue; out.push(r); }
  out.sort(function(a,b){var da=parseDate(a['Report Date']),db=parseDate(b['Report Date']); return (db||new Date(0)).getTime()-(da||new Date(0)).getTime();});
  return {data:out};
}

// ============================================================
// TASK ACTIONS
// ============================================================

function createTask(body) {
  var emp    = body.employeeName||'';
  if (!emp) throw new Error('employeeName is required.');
  var isField = String(body.workMode||'').toLowerCase()==='field';
  var sh     = getSheet(SH_TASKS);
  var taskId = generateId('TASK');
  var status = isField ? 'Pending Proof' : 'Not Started';

  // For field tasks, Date Started = Scheduled Field Date (for dashboard filtering)
  var dateStarted = isField ? (body.scheduledFieldDate || displayDate()) : 'null';

  sh.appendRow([
    taskId,
    emp,
    body.taskName        || '',
    body.taskDescription || 'null',
    body.department      || '',
    body.taskType        || '',
    status,
    body.priority        || 'Medium',
    displayDate(),       // Date Created — readable "Mar 26, 2026"
    dateStarted,         // Date Started — field: scheduled date; office: 'null'
    'null',              // Date Completed
    nowStr(),            // Latest Update
    'TRUE',
    'null',              // Daily Accomplishment
    'null',              // Blockers/Issue
    'null',              // Next Step
    body.workMode        || 'Office',
    body.eventDetails    || 'null',
    body.location        || 'null',
    'null'               // Proof Link — submitted later via submitFieldProof
  ]);
  return {data:{taskId:taskId, status:status, dateCreated:displayDate()}};
}

// NEW v2.3: Submit Field Work Proof → auto-mark as Completed
function submitFieldProof(body) {
  var taskId    = String(body.taskId   ||'');
  var proofLink = String(body.proofLink||'');
  var emp       = body.employeeName    ||'';
  if (!taskId)    throw new Error('taskId is required.');
  if (!proofLink) throw new Error('proofLink is required.');

  var sh   = getSheet(SH_TASKS);
  var data = sh.getDataRange().getValues();
  var hdrs = data[0].map(function(h){return String(h).trim();});
  var proofCol = hdrs.indexOf('Proof Link') + 1;  // 1-based
  var statusCol= hdrs.indexOf('Status')     + 1;
  var activeCol= hdrs.indexOf('Is Active')  + 1;
  var doneCol  = hdrs.indexOf('Date Completed') + 1;
  var updCol   = hdrs.indexOf('Latest Update')  + 1;
  var idCol    = hdrs.indexOf('Task ID');

  for (var i=1; i<data.length; i++) {
    if (String(data[i][idCol]||'') !== taskId) continue;
    var rn = i + 1;
    var now = nowStr();
    if (proofCol > 0) sh.getRange(rn, proofCol).setValue(proofLink);
    if (statusCol > 0) sh.getRange(rn, statusCol).setValue('Completed');
    if (activeCol > 0) sh.getRange(rn, activeCol).setValue('FALSE');
    if (doneCol   > 0) sh.getRange(rn, doneCol).setValue(now);
    if (updCol    > 0) sh.getRange(rn, updCol).setValue(now);
    return {data:{taskId:taskId, proofLink:proofLink, status:'Completed', completedAt:now}};
  }
  throw new Error('Task not found: ' + taskId);
}

function startTask(body) {
  var taskId=String(body.taskId||''), emp=body.employeeName||'';
  if (!taskId) throw new Error('taskId is required.');
  var sh=getSheet(SH_TASKS), data=sh.getDataRange().getValues();
  for (var i=1;i<data.length;i++) {
    if (String(data[i][0])!==taskId) continue;
    var row=i+1, task=mapTask(data[i]);
    // Field tasks cannot be started with timer
    if (String(task['Work Mode']||'').toLowerCase()==='field')
      throw new Error('Field tasks do not use timer. Use submitFieldProof instead.');
    if (task['Status']!=='Not Started'&&task['Status']!=='Paused')
      throw new Error('Task cannot be started (status: '+task['Status']+').');
    var now=nowStr();
    sh.getRange(row,7).setValue('In Progress');
    if (task['Status']==='Not Started') sh.getRange(row,10).setValue(now);
    sh.getRange(row,12).setValue(now);
    sh.getRange(row,13).setValue('TRUE');
    var sid=generateId('SES');
    getSheet(SH_SESSIONS).appendRow([sid,taskId,emp||task['Employee Name'],displayDate(),'Start',now,'null',body.notes||'null']);
    return {data:{taskId:taskId,sessionId:sid,timestamp:now,status:'In Progress'}};
  }
  throw new Error('Task not found: '+taskId);
}

function pauseTask(body) {
  var taskId=String(body.taskId||''), emp=body.employeeName||'', reason=body.pauseReason||'null';
  if (!taskId) throw new Error('taskId is required.');
  var sh=getSheet(SH_TASKS), data=sh.getDataRange().getValues();
  for (var i=1;i<data.length;i++) {
    if (String(data[i][0])!==taskId) continue;
    var row=i+1, task=mapTask(data[i]);
    if (task['Status']!=='In Progress') throw new Error('Task is not In Progress.');
    var now=nowStr();
    sh.getRange(row,7).setValue('Paused'); sh.getRange(row,12).setValue(now);
    var sid=generateId('SES');
    getSheet(SH_SESSIONS).appendRow([sid,taskId,emp||task['Employee Name'],displayDate(),'Pause',now,reason,body.notes||'null']);
    return {data:{taskId:taskId,sessionId:sid,timestamp:now,status:'Paused',pauseReason:reason}};
  }
  throw new Error('Task not found: '+taskId);
}

function resumeTask(body) {
  var taskId=String(body.taskId||''), emp=body.employeeName||'';
  if (!taskId) throw new Error('taskId is required.');
  var sh=getSheet(SH_TASKS), data=sh.getDataRange().getValues();
  for (var i=1;i<data.length;i++) {
    if (String(data[i][0])!==taskId) continue;
    var row=i+1, task=mapTask(data[i]);
    if (task['Status']!=='Paused') throw new Error('Task is not Paused.');
    var now=nowStr();
    sh.getRange(row,7).setValue('In Progress'); sh.getRange(row,12).setValue(now); sh.getRange(row,13).setValue('TRUE');
    var sid=generateId('SES');
    getSheet(SH_SESSIONS).appendRow([sid,taskId,emp||task['Employee Name'],displayDate(),'Resume',now,'null',body.notes||'null']);
    return {data:{taskId:taskId,sessionId:sid,timestamp:now,status:'In Progress'}};
  }
  throw new Error('Task not found: '+taskId);
}

function endTask(body) {
  var taskId=String(body.taskId||''), emp=body.employeeName||'';
  if (!taskId) throw new Error('taskId is required.');
  var sh=getSheet(SH_TASKS), data=sh.getDataRange().getValues();
  for (var i=1;i<data.length;i++) {
    if (String(data[i][0])!==taskId) continue;
    var row=i+1, task=mapTask(data[i]);
    if (task['Status']!=='In Progress'&&task['Status']!=='Paused')
      throw new Error('Task not active (status: '+task['Status']+').');
    var now=nowStr();
    sh.getRange(row,7).setValue('Completed');
    if (!task['Date Started']||task['Date Started']==='null') sh.getRange(row,10).setValue(now);
    sh.getRange(row,11).setValue(now);  // Date Completed
    sh.getRange(row,12).setValue(now);  // Latest Update
    sh.getRange(row,13).setValue('FALSE');
    if (body.proofLink)      sh.getRange(row,20).setValue(body.proofLink);
    if (body.accomplishment) sh.getRange(row,14).setValue(body.accomplishment);
    var sid=generateId('SES');
    getSheet(SH_SESSIONS).appendRow([sid,taskId,emp||task['Employee Name'],displayDate(),'End',now,'null',body.endNotes||body.notes||'null']);
    return {data:{taskId:taskId,sessionId:sid,timestamp:now,status:'Completed'}};
  }
  throw new Error('Task not found: '+taskId);
}

// ============================================================
// FINALIZE DAILY REPORT
// Field tasks with proof = Completed, without = excluded
// ============================================================

function finalizeDailyReport(body) {
  var emp=body.employeeName||'', date=resolveDate(body), summary=body.accomplishment||body.summary||body.summaryNote||'';
  if (!emp)     throw new Error('employeeName is required.');
  if (!summary) throw new Error('Daily summary is required.');
  var s=getTodaySummary({employeeName:emp,date:date}).data;
  var pc=s.pauseReasonCount||{}, pauseStr='';
  Object.keys(pc).forEach(function(k){if(pauseStr)pauseStr+=', ';pauseStr+=k+' ('+pc[k]+'x)';});
  var rSh=getSheet(SH_REPORTS), rData=rSh.getDataRange().getValues(), existRow=-1, existId='';
  for (var j=1;j<rData.length;j++) {
    if (!rData[j][0]) continue;
    if (empMatch(String(rData[j][1]),emp)&&cellDate(rData[j][2])===date) { existRow=j+1;existId=String(rData[j][0]);break; }
  }
  var reportId=existId||generateId('DR'), now=nowStr();
  var row=[reportId,emp,displayDate(),s.totalHoursLabel,s.taskCount,s.completedCount,s.ongoingCount,pauseStr||'null',summary,now,'Finalized'];
  if (existRow>0) rSh.getRange(existRow,1,1,row.length).setValues([row]);
  else            rSh.appendRow(row);
  return {data:{reportId:reportId,employeeName:emp,date:date,finalizedAt:now,status:'Finalized'}};
}

// ============================================================
// FINALIZE WEEKLY REPORT
// Week End = Friday (Mon + 4), Deadline = Friday 5:00 PM
// Status: 'Submitted' (on time) | 'Late' (past 5 PM)
// ============================================================

function finalizeWeeklyReport(body) {
  var dept=body.department||'', tl=body.teamLeader||'';
  var monStr=(body.weekStart||todayStr()).substring(0,10);
  var friStr=addDays(monStr,4); // Friday
  if (!dept) throw new Error('department is required.');
  if (!tl)   throw new Error('teamLeader is required.');

  // Friday 5:00 PM deadline
  var friDate=new Date(monStr+'T00:00:00'); friDate.setDate(friDate.getDate()+4); friDate.setHours(17,0,0,0);
  var submissionStatus=(new Date()<=friDate)?'Submitted':'Late';

  var compiled=getTeamLeaderWeekly({department:dept,weekStart:monStr,teamLeader:tl}).data;
  var staffNames=[];
  compiled.reports.forEach(function(r){if(staffNames.indexOf(r['Employee Name'])===-1)staffNames.push(r['Employee Name']);});

  var wSh=getSheet(SH_WEEKLY), wData=wSh.getDataRange().getValues();
  var wHdrs=wData.length>0?wData[0].map(function(h){return String(h).trim();}):[],existRow=-1,existId='';
  var dIdx=wHdrs.indexOf('Department'),wsIdx=wHdrs.indexOf('Week Start');
  for (var i=1;i<wData.length;i++) {
    var rDept=dIdx>=0?String(wData[i][dIdx]||''):'', rWS=wsIdx>=0?cellDate(wData[i][wsIdx]):'';
    if (rDept===dept&&rWS===monStr){existRow=i+1;existId=String(wData[i][0]||'');break;}
  }

  var reportId=existId||generateId('WR'), now=nowStr();
  var monDisplay=fmtDisplayDate(new Date(monStr+'T00:00:00'));
  var friDisplay=fmtDisplayDate(new Date(friStr+'T00:00:00'));
  var totalHoursArr=compiled.reports.map(function(r){return r['Total Active Hours']||'0';});

  var row=[reportId,dept,tl,monDisplay,friDisplay,staffNames.length,totalHoursArr.join(' | '),
    compiled.totalCompleted,compiled.totalOngoing,'null',
    body.summaryNote||body.summary||'',body.recommendations||'null',
    now,submissionStatus,'null'];
  if (existRow>0) wSh.getRange(existRow,1,1,row.length).setValues([row]);
  else            wSh.appendRow(row);
  return {data:{reportId:reportId,department:dept,teamLeader:tl,weekStart:monDisplay,weekEnd:friDisplay,
    finalizedAt:now,status:submissionStatus}};
}

// ============================================================
// TEAM LEADER WEEKLY VIEW
// ============================================================

function getTeamLeaderWeekly(p) {
  var dept=p.department||'', weekStr=p.weekStart||todayStr(), tl=p.teamLeader||'';
  var monDate=weekStr.substring(0,10), friDate=addDays(monDate,4);
  var rSh=getSheet(SH_REPORTS), rData=rSh.getDataRange().getValues();
  var empSh=getSheet(SH_EMPLOYEES), empData=empSh.getDataRange().getValues();
  var deptEmps=[];
  for (var e=1;e<empData.length;e++) if(String(empData[e][3]||'')===dept) deptEmps.push(String(empData[e][2]||''));
  var reports=[],totalCompleted=0,totalOngoing=0;
  for (var j=1;j<rData.length;j++) {
    if (!rData[j][0]) continue;
    var r=mapReport(rData[j]), rDate=cellDate(r['Report Date']);
    if (rDate<monDate||rDate>friDate) continue;
    if (deptEmps.indexOf(r['Employee Name'])===-1&&!empMatch(r['Employee Name'],tl)) continue;
    reports.push(r);
    totalCompleted+=parseInt(r['Completed Tasks']||0)||0;
    totalOngoing  +=parseInt(r['Ongoing Tasks']  ||0)||0;
  }
  return {data:{department:dept,weekStart:monDate,weekEnd:friDate,reports:reports,totalCompleted:totalCompleted,totalOngoing:totalOngoing,deptEmployees:deptEmps}};
}

// Management: only 'Submitted' reports
function getFinalizedWeeklyReports(p) {
  var dept=p.department||'', wSh=getSheet(SH_WEEKLY), data=wSh.getDataRange().getValues(), out=[];
  var hdrs=data.length>0?data[0].map(function(h){return String(h).trim();}):[],dIdx=hdrs.indexOf('Department'),sIdx=hdrs.indexOf('Weekly Report Status');
  for (var i=1;i<data.length;i++) {
    if (!data[i][0]) continue;
    var rStat=sIdx>=0?String(data[i][sIdx]||''):'';
    if (rStat!=='Submitted'&&rStat!=='Finalized') continue; // Only on-time submissions visible to Management
    if (dept&&(dIdx>=0?String(data[i][dIdx]||''):''!==dept)) continue;
    var obj={};
    hdrs.forEach(function(h,j){
      var v=data[i][j];
      obj[h]=v instanceof Date?Utilities.formatDate(v,TZ,'MMM d, yyyy h:mm a'):(v||'null');
    });
    out.push(obj);
  }
  return {data:out};
}

function getStaffForTeamLeader(p) {
  var dept=p.department||'', sh=getSheet(SH_EMPLOYEES), data=sh.getDataRange().getValues(), out=[];
  for (var i=1;i<data.length;i++) {
    if (!data[i][1]) continue;
    if (dept&&String(data[i][3]||'')!==dept) continue;
    var pos=String(data[i][5]||'').toLowerCase();
    if (pos.includes('team leader')||pos.includes('management')||pos.includes('admin')) continue;
    out.push({'Employee ID':String(data[i][1]||''),'Employee Name':String(data[i][2]||''),'Department':String(data[i][3]||''),'Email':String(data[i][4]||''),'Position':String(data[i][5]||'')});
  }
  return {data:out};
}

function getTravelOrdersGET(p) {
  var emp=p.employeeName||'', sh=getSheet(SH_TRAVEL), data=sh.getDataRange().getValues(), out=[];
  for (var i=1;i<data.length;i++) {
    if (!data[i][0]) continue;
    var row=data[i], obj={'Travel Order ID':String(row[0]||''),'Employee Name':String(row[1]||''),'Position':String(row[2]||'null'),'Department':String(row[3]||'null'),'Destination':String(row[4]||''),'Date':String(row[5]||''),'Purpose':String(row[6]||''),'Budget':String(row[7]||'0'),'Funding Source':String(row[8]||'null'),'Team Leader Approval':String(row[9]||'Pending'),'Finance Approval':String(row[10]||'Pending'),'Status':String(row[11]||'Pending'),'Attachment/PDF Link':String(row[12]||'null')};
    if (emp&&!empMatch(obj['Employee Name'],emp)) continue;
    out.push(obj);
  }
  return {data:out};
}

function createTravelOrder(body) {
  var emp=body.employeeName||'';
  if (!emp) throw new Error('employeeName is required.');
  var budget=parseFloat(body.budget)||0, fin=budget>0?'Pending':'N/A';
  var sh=getSheet(SH_TRAVEL), toId=generateId('TO');
  sh.appendRow([toId,emp,body.position||'null',body.department||'null',body.destination||'',body.date||displayDate(),body.purpose||'',body.budget||'0',body.fundingSource||'null','Pending',fin,'Pending','null']);
  return {data:{travelOrderId:toId,status:'Pending',financeApproval:fin}};
}

function approveTravelOrder(body) {
  var toId=body.travelOrderId||'', role=body.role||'', decision=body.decision||'Approved';
  if (!toId) throw new Error('travelOrderId is required.');
  var sh=getSheet(SH_TRAVEL), data=sh.getDataRange().getValues();
  for (var i=1;i<data.length;i++) {
    if (String(data[i][0])!==toId) continue;
    var rn=i+1;
    if (role==='TeamLeader') sh.getRange(rn,10).setValue(decision);
    else if (role==='Finance') sh.getRange(rn,11).setValue(decision);
    var tla=String(sh.getRange(rn,10).getValue()||''), fin2=String(sh.getRange(rn,11).getValue()||'');
    var overall=(tla==='Approved'&&(fin2==='Approved'||fin2==='N/A'))?'Approved':'Pending';
    if (tla==='Rejected'||fin2==='Rejected') overall='Rejected';
    sh.getRange(rn,12).setValue(overall);
    return {data:{travelOrderId:toId,status:overall}};
  }
  throw new Error('Travel Order not found: '+toId);
}
