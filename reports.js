// ============================================================
// reports.js — DTIM v2.2
// CHANGES:
//   1. finalizeDay() — NEW LOGIC:
//        - Button disabled if ALL tasks are Completed (nothing to do)
//        - Button clickable only if: at least one "In Progress" or "Paused" task
//        - Pending / Not Started tasks are IGNORED entirely
//        - Field work included if proof is uploaded (status = Completed)
//        - Field work NOT included if no proof yet
//   2. Weekly report deadline = Friday 5:00 PM (was EOD)
//   3. Finalize Report button now appears on TL weekly-report page
//      (this is the action that sends the report to Management)
//   4. buildDailySummaryWidget() — button disabled/hidden if no active tasks
// ============================================================

const Reports = {

  // ============================================================
  // LOAD
  // ============================================================

  async loadDailyReports(filters = {}) {
    AppState.dailyReports = await API.getDailyReports(filters);
    return AppState.dailyReports;
  },

  async loadWeeklyReports(filters = {}) {
    AppState.weeklyReports = await API.getWeeklyReports(filters);
    return AppState.weeklyReports;
  },

  // ============================================================
  // FINALIZE DAY — REVISED LOGIC
  //
  // RULE 1: Only consider tasks that have actual activity:
  //         Status = "In Progress", "Paused", or "Completed"
  //         (Ignore "Not Started" and "Pending Proof")
  //
  // RULE 2: If all relevant tasks are "Completed" → button is DISABLED
  //         (Nothing to finalize — work is already done)
  //
  // RULE 3: Button is only ACTIVE if:
  //         - at least one task is "In Progress" or "Paused"
  //
  // RULE 4: Field work = Completed if proofLink exists
  //         Field work with no proof = excluded from report
  //
  // RULE 5: Cannot finalize while any task is "In Progress"
  //         (must end/pause it first)
  // ============================================================

  async finalizeDay() {
    const user  = AppState.currentUser;
    const today = getTodayDate();

    // Get today's tasks for this user
    const todayTasks = AppState.tasks.filter(t => {
      const created   = (t['Date Created'] || '').startsWith(today);
      const fieldToday = t['Work Mode'] === 'Field' &&
                         (t['Scheduled Field Date'] || '').startsWith(today);
      return created || fieldToday;
    });

    // ONLY tasks that have had actual work done (exclude Not Started & Pending Proof without proof)
    const workedTasks = todayTasks.filter(t => {
      if (t['Status'] === 'Not Started')  return false; // Never touched — ignore
      if (t['Work Mode'] === 'Field') {
        // Field work only counts if proof was uploaded (= Completed)
        return t['Status'] === 'Completed' && t['Proof Link'];
      }
      // Office/Remote: include if In Progress, Paused, or Completed
      return ['In Progress', 'Paused', 'Completed'].includes(t['Status']);
    });

    // Check if there's anything to finalize
    if (workedTasks.length === 0) {
      showToast('Walang aktibidad ngayon para i-finalize. Magsimula ng task muna.', 'warning');
      return;
    }

    // Check: all tasks already completed → nothing to do
    const allDone   = workedTasks.every(t => t['Status'] === 'Completed');
    const hasActive = workedTasks.some(t => t['Status'] === 'In Progress' || t['Status'] === 'Paused');

    if (allDone && !hasActive) {
      showToast('Lahat ng tasks ay Completed na. Ang daily report ay maaari nang i-finalize.', 'info');
      // Still allow finalization if there's completed work — fall through to modal
    }

    // Block if any task is still actively running (In Progress without being paused)
    const running = workedTasks.filter(t => t['Status'] === 'In Progress');
    if (running.length > 0) {
      showToast(`${running.length} task pa ang tumatakbo. I-end o i-pause muna bago mag-finalize.`, 'error');
      return;
    }

    // Check if already finalized today
    const already = (AppState.dailyReports || []).find(r =>
      r['Employee Name'] === user.name &&
      (r['Report Date'] || '').startsWith(today) &&
      (r['Daily report Status'] === 'Finalized' || r['Daily Report Status'] === 'Finalized')
    );
    if (already) {
      showToast('Na-finalize na ang iyong day report ngayon.', 'info');
      return;
    }

    // Build report data
    const completedTasks = workedTasks.filter(t => t['Status'] === 'Completed');
    const ongoingTasks   = workedTasks.filter(t => t['Status'] === 'Paused');

    // Total time: sum elapsed for non-field tasks; field tasks have no timer
    const totalMs = workedTasks
      .filter(t => t['Work Mode'] !== 'Field')
      .reduce((s, t) => s + Tasks.getElapsed(t['Task ID']), 0);

    const completedNames = completedTasks.map(t => t['Task Name']).join(', ');
    const ongoingNames   = ongoingTasks.map(t => t['Task Name']).join(', ');

    showModal('✅ Finalize My Day', `
      <div class="finalize-preview">
        <div class="fp-date-banner">
          <span>📅</span>
          <div>
            <strong>${formatDate(today)}</strong>
            <small>${getDayName(today)}</small>
          </div>
        </div>
        <div class="fin-stats">
          <div class="fin-stat">
            <span>${workedTasks.length}</span><small>Worked Tasks</small>
          </div>
          <div class="fin-stat highlight">
            <span>${formatDurationShort(totalMs)}</span><small>Total Time</small>
          </div>
          <div class="fin-stat success">
            <span>${completedTasks.length}</span><small>Completed</small>
          </div>
        </div>
        ${completedNames ? `<div class="fp-section"><label>✅ Completed Tasks</label><p>${escapeHtml(completedNames)}</p></div>` : ''}
        ${ongoingNames   ? `<div class="fp-section"><label>⏸ Paused / Ongoing Tasks</label><p>${escapeHtml(ongoingNames)}</p></div>` : ''}
        <div class="form-group" style="margin-top:14px">
          <label>Daily Summary <span class="req">*</span></label>
          <textarea id="f-daily-summary" class="form-control" rows="3"
            placeholder="Ibahagi ang iyong kabuuang progress ngayon..."></textarea>
        </div>
        <div class="fin-notice">⚠️ Hindi na mababago ang report pagkatapos ma-finalize.</div>
      </div>
    `, [
      { label: 'Cancel', type: 'ghost' },
      { label: '✅ Finalize Day', type: 'primary', close: false,
        callback: () => this._doFinalizeDay(user, today, workedTasks, totalMs, completedNames, ongoingNames) },
    ]);
  },

  async _doFinalizeDay(user, today, tasks, totalMs, completedNames, ongoingNames) {
    const summary = getFormValue('f-daily-summary');
    if (!summary) { showToast('Mangyaring isulat ang daily summary.', 'error'); return; }
    hideModal();
    showToast('Sine-save ang daily report...', 'info', 2000);
    try {
      const reportData = {
        employeeName:  user.name,
        date:          today,
        totalHours:    msToHoursDecimal(totalMs),
        tasksWorkedOn: tasks.map(t => t['Task Name']).join(', '),
        completedTasks: completedNames || null,
        ongoingTasks:   ongoingNames   || null,
        pauseReasons:   null,
        summary,
      };
      await API.createDailyReport(reportData);
      if (!AppState.dailyReports) AppState.dailyReports = [];
      AppState.dailyReports.unshift({
        'Report ID':           generateId('DR'),
        'Employee Name':       user.name,
        'Report Date':         today,
        'Total Active Hours':  reportData.totalHours,
        'Tasks Worked On':     reportData.tasksWorkedOn,
        'Completed Tasks':     completedNames,
        'Ongoing Tasks':       ongoingNames,
        'Daily Summary':       summary,
        'Finalized At':        formatDateTime(new Date().toISOString()),
        'Daily report Status': 'Finalized',
        'Daily Report Status': 'Finalized',
      });
      showToast('Daily report finalized! 🎉', 'success');
      Dashboard.refreshCurrent();
    } catch (err) {
      showToast('Error saving report. Please try again.', 'error');
      console.error(err);
    }
  },

  // ============================================================
  // WEEKLY REPORT — TEAM LEADER
  // ============================================================
  // Deadline : Friday 5:00 PM (configured in utils.js)
  // Status   : 'Submitted' if on time → visible to Management
  //            'Late' if past deadline → hidden from Management
  // TL can submit ANYTIME — it's flexible.
  //    If submitted before Friday 5PM → Submitted
  //    If submitted after             → Late (but still stored)
  // ============================================================

  async loadWeeklyForTL() {
    const tl = AppState.currentUser;
    await this.loadDailyReports({ department: tl.department });
    await this.loadWeeklyReports({ department: tl.department });
  },

  computeWeekState() {
    const tl             = AppState.currentUser;
    const weekStart      = getWeekStart();
    const weekDays       = getWeekDays(weekStart); // Mon–Fri
    const dept           = tl.department;
    const deadline       = getWeekDeadline(weekStart);
    const isPastDeadline = new Date() > deadline;
    const hoursLeft      = hoursUntilDeadline(weekStart);

    const deptDR = (AppState.dailyReports || []).filter(r =>
      r['Department'] === dept &&
      weekDays.includes((r['Report Date'] || '').substring(0, 10)) &&
      (r['Daily report Status'] === 'Finalized' || r['Daily Report Status'] === 'Finalized')
    );

    const memberMap = {};
    deptDR.forEach(r => {
      const n = r['Employee Name'];
      if (!memberMap[n]) memberMap[n] = { days: 0, hours: 0, dates: [] };
      memberMap[n].days++;
      memberMap[n].hours += parseFloat(r['Total Active Hours'] || 0);
      memberMap[n].dates.push((r['Report Date'] || '').substring(0, 10));
    });

    const deptEmployees = (AppState.employees || []).filter(e =>
      e['Department'] === dept &&
      e['Is Active'] !== 'false' &&
      mapPositionToRole(e['Position']) !== 'Management' &&
      mapPositionToRole(e['Position']) !== 'Admin'
    );

    const missing = {};
    deptEmployees.forEach(e => {
      const name  = e['Employee Name'];
      const filed = memberMap[name]?.dates || [];
      const missed = weekDays.filter(d => !filed.includes(d));
      if (missed.length > 0) missing[name] = missed;
    });

    const totalHours  = Object.values(memberMap).reduce((s, m) => s + m.hours, 0);
    const memberCount = Object.keys(memberMap).length;
    const existingWR  = (AppState.weeklyReports || []).find(r =>
      r['Department'] === dept && r['Week Start'] === weekStart
    );

    return {
      weekStart, weekDays, dept, deadline,
      isPastDeadline, hoursLeft,
      deptDR, memberMap, missing,
      totalHours, memberCount,
      existingWR,
      totalMs:   totalHours * 3600000,
      canSubmit: deptDR.length > 0, // TL can always submit if there are reports
    };
  },

  // ── "Finalize Report" button action — sends report to Management ──────
  // This is the official submit action. Before this, report stays TL-side only.
  async finalizeWeekly() {
    if (!Auth.can('finalize_weekly')) return;
    const ws = this.computeWeekState();

    if (ws.existingWR) {
      showToast(`Na-${ws.existingWR['Weekly Report Status'] || 'finalize'} na ang weekly report para sa linggong ito.`, 'info');
      return;
    }
    if (ws.deptDR.length === 0) {
      showToast('Walang finalized na daily reports para sa linggong ito.', 'warning');
      return;
    }

    // Deadline banner — informational only. TL can still submit.
    const deadlineBanner = ws.isPastDeadline
      ? `<div class="deadline-banner late">
          ⏰ <strong>Past deadline</strong> — Friday 5:00 PM has passed.
          This report will be marked <strong>Late</strong> and will NOT be visible to Management.
          You can still submit for records.
         </div>`
      : ws.hoursLeft <= 4
      ? `<div class="deadline-banner warning">
          ⚡ <strong>${ws.hoursLeft}h remaining</strong> until Friday 5:00 PM deadline.
         </div>`
      : `<div class="deadline-banner ok">
          ✅ Submission is on time. Deadline: <strong>${deadlineDisplay(ws.weekStart)}</strong>
         </div>`;

    const memberRows = Object.entries(ws.memberMap).map(([name, m]) =>
      `<tr><td>${escapeHtml(name)}</td><td>${m.days}/5 days</td><td><strong>${m.hours.toFixed(2)}h</strong></td></tr>`
    ).join('');

    const missingSection = Object.keys(ws.missing).length > 0
      ? `<div class="missing-section">
          <label>⚠️ Missing Daily Reports</label>
          ${Object.entries(ws.missing).map(([name, dates]) =>
            `<div class="missing-row">
              <span>${escapeHtml(name)}</span>
              <span>${dates.map(d => getDayName(d).slice(0,3) + ' ' + formatDateShort(d)).join(', ')}</span>
            </div>`
          ).join('')}
        </div>`
      : '';

    showModal('📊 Finalize & Submit Weekly Report', `
      <div class="finalize-preview">
        ${deadlineBanner}
        <div class="fp-date-banner" style="margin-top:12px">
          <span>📊</span>
          <div>
            <strong>${escapeHtml(ws.dept)} Department</strong>
            <small>Week of ${formatDate(ws.weekStart)} – ${formatDateShort(ws.weekDays[4])}</small>
          </div>
        </div>
        <table class="mini-table">
          <thead><tr><th>Member</th><th>Days Reported</th><th>Total Hours</th></tr></thead>
          <tbody>${memberRows}</tbody>
        </table>
        ${missingSection}
        <div class="fin-stats">
          <div class="fin-stat"><span>${ws.memberCount}</span><small>Members</small></div>
          <div class="fin-stat highlight"><span>${formatDurationShort(ws.totalMs)}</span><small>Dept Total</small></div>
        </div>
        <div class="form-group" style="margin-top:14px">
          <label>Weekly Summary <span class="req">*</span></label>
          <textarea id="f-weekly-summary" class="form-control" rows="3"
            placeholder="Overall summary for the week..."></textarea>
        </div>
        <div class="form-group">
          <label>Recommendations (optional)</label>
          <textarea id="f-weekly-reco" class="form-control" rows="2"
            placeholder="Mga rekomendasyon para sa susunod na linggo..."></textarea>
        </div>
        <div class="fin-notice">
          ⚠️ Once you click <strong>Finalize Report</strong>, this report will be sent to Management and cannot be changed.
        </div>
      </div>
    `, [
      { label: 'Cancel', type: 'ghost' },
      { label: '🚀 Finalize Report', type: 'primary', close: false,
        callback: () => this._doFinalizeWeekly(ws) },
    ]);
  },

  async _doFinalizeWeekly(ws) {
    const summary = getFormValue('f-weekly-summary');
    const reco    = getFormValue('f-weekly-reco');
    if (!summary) { showToast('Mangyaring isulat ang weekly summary.', 'error'); return; }
    hideModal();
    showToast('Sine-save ang weekly report...', 'info', 2000);

    const submittedAt = new Date().toISOString();
    const onTime      = isSubmittedOnTime(ws.weekStart, submittedAt);
    const status      = onTime ? 'Submitted' : 'Late';

    const completed = ws.deptDR.flatMap(r => (r['Completed Tasks'] || '').split(',').map(s => s.trim()).filter(Boolean));
    const ongoing   = ws.deptDR.flatMap(r => (r['Ongoing Tasks']   || '').split(',').map(s => s.trim()).filter(Boolean));

    try {
      const wrData = {
        department:      ws.dept,
        teamLeaderName:  AppState.currentUser.name,
        weekStart:       ws.weekStart,
        weekEnd:         ws.weekDays[4],
        totalStaff:      ws.memberCount,
        totalHours:      ws.totalHours.toFixed(2),
        completedTasks:  [...new Set(completed)].join(', ') || null,
        ongoingTasks:    [...new Set(ongoing)].join(', ')   || null,
        pauseReasons:    null,
        summary,
        recommendations: reco || null,
        weeklyStatus:    status,
      };
      await API.createWeeklyReport(wrData);

      if (!AppState.weeklyReports) AppState.weeklyReports = [];
      AppState.weeklyReports.unshift({
        'Report ID':            generateId('WR'),
        'Department':           ws.dept,
        'Team Leader':          AppState.currentUser.name,
        'Week Start':           ws.weekStart,
        'Week End':             ws.weekDays[4],
        'Total Staff':          ws.memberCount,
        'Total Hours':          ws.totalHours.toFixed(2),
        'Completed Tasks':      wrData.completedTasks,
        'Ongoing Tasks':        wrData.ongoingTasks,
        'WeeklySummary':        summary,
        'Recommendations':      reco,
        'Finalized At':         formatDateTime(submittedAt),
        'Weekly Report Status': status,
      });

      const msg = onTime
        ? '✅ Weekly report finalized! Now visible to Management.'
        : '⚠️ Weekly report saved but marked Late (past Friday 5:00 PM). Management will not see this.';
      showToast(msg, onTime ? 'success' : 'warning', 5000);
      Dashboard.refreshCurrent();
    } catch (err) {
      showToast('Error saving weekly report. Please try again.', 'error');
      console.error(err);
    }
  },

  // ============================================================
  // WIDGETS
  // ============================================================

  buildDailySummaryWidget() {
    const user   = AppState.currentUser;
    const today  = getTodayDate();

    const todayTasks = AppState.tasks.filter(t => {
      const created    = (t['Date Created'] || '').startsWith(today);
      const fieldToday = t['Work Mode'] === 'Field' &&
                         (t['Scheduled Field Date'] || '').startsWith(today);
      return created || fieldToday;
    });

    // Worked tasks: In Progress / Paused / Completed (not Not Started or Pending Proof without proof)
    const workedTasks = todayTasks.filter(t => {
      if (t['Status'] === 'Not Started') return false;
      if (t['Work Mode'] === 'Field') return t['Status'] === 'Completed' && t['Proof Link'];
      return ['In Progress', 'Paused', 'Completed'].includes(t['Status']);
    });

    const totalMs   = workedTasks
      .filter(t => t['Work Mode'] !== 'Field')
      .reduce((s, t) => s + Tasks.getElapsed(t['Task ID']), 0);

    const report = (AppState.dailyReports || []).find(r =>
      r['Employee Name'] === user.name &&
      (r['Report Date'] || '').startsWith(today) &&
      (r['Daily report Status'] === 'Finalized' || r['Daily Report Status'] === 'Finalized')
    );

    const running   = workedTasks.filter(t => t['Status'] === 'In Progress').length;
    const done      = workedTasks.filter(t => t['Status'] === 'Completed').length;
    const paused    = workedTasks.filter(t => t['Status'] === 'Paused').length;

    // Button logic:
    //   - Show disabled if all tasks completed (still allow click to finalize)
    //   - Show active if at least one In Progress or Paused
    //   - Hide if no worked activity at all
    const hasWorked  = workedTasks.length > 0;
    const hasActive  = running > 0 || paused > 0;
    const allDone    = hasWorked && done === workedTasks.length;
    const btnDisabled = running > 0; // Can't finalize while task is running

    return `
      <div class="widget-card">
        <div class="wc-header">
          <div class="wc-icon-wrap blue"><span>📊</span></div>
          <div>
            <h4>Today's Summary</h4>
            <small>${getDayName(today)}, ${formatDateShort(today)}</small>
          </div>
        </div>
        <div class="wc-stats-row">
          <div class="wcs"><span class="wcs-val">${todayTasks.length}</span><span class="wcs-lbl">Tasks</span></div>
          <div class="wcs"><span class="wcs-val blue">${running}</span><span class="wcs-lbl">Running</span></div>
          <div class="wcs"><span class="wcs-val green">${done}</span><span class="wcs-lbl">Done</span></div>
          <div class="wcs"><span class="wcs-val amber">${paused}</span><span class="wcs-lbl">Paused</span></div>
        </div>
        <div class="wc-time-bar">
          <span class="wc-time-label">Total Active Time</span>
          <span class="wc-time-val">${formatDuration(totalMs)}</span>
        </div>
        ${report
          ? `<div class="wc-status done"><span>✅</span><span>Day finalized at ${formatDateTime(report['Finalized At'])}</span></div>`
          : !hasWorked
            ? `<div class="wc-status neutral"><span>💡</span><span>No active tasks yet today.</span></div>`
            : btnDisabled
              ? `<button class="btn btn-primary btn-full mt-8" id="btn-finalize-day" disabled title="End or pause all running tasks first">
                  ⏱ Finalize My Day (running tasks — end first)
                 </button>`
              : `<button class="btn btn-primary btn-full mt-8" id="btn-finalize-day" onclick="Reports.finalizeDay()">
                  ✅ Finalize My Day
                 </button>`
        }
      </div>`;
  },

  buildWeeklySummaryWidget() {
    const user      = AppState.currentUser;
    const weekStart = getWeekStart();
    const weekDays  = getWeekDays(weekStart);
    const myDR      = (AppState.dailyReports || []).filter(r =>
      r['Employee Name'] === user.name &&
      weekDays.includes((r['Report Date'] || '').substring(0, 10)) &&
      (r['Daily report Status'] === 'Finalized' || r['Daily Report Status'] === 'Finalized')
    );
    const totalMs  = myDR.reduce((s, r) => s + (parseFloat(r['Total Active Hours'] || 0) * 3600000), 0);
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    return `
      <div class="widget-card">
        <div class="wc-header">
          <div class="wc-icon-wrap violet"><span>📅</span></div>
          <div>
            <h4>This Week</h4>
            <small>${formatDateShort(weekStart)} – ${formatDateShort(weekDays[4])}</small>
          </div>
        </div>
        <div class="week-grid-v2">
          ${weekDays.map((d, i) => {
            const dr   = myDR.find(r => (r['Report Date'] || '').startsWith(d));
            const past = new Date(d + 'T23:59:59') < new Date();
            return `<div class="wgv2-day ${dr ? 'filed' : past ? 'missed' : 'upcoming'}">
              <span class="wgv2-name">${dayNames[i]}</span>
              <span class="wgv2-date">${formatDateShort(d).replace(/[A-Za-z]+\s/,'')}</span>
              ${dr ? `<span class="wgv2-hrs">${parseFloat(dr['Total Active Hours']||0).toFixed(1)}h</span>`
                   : `<span class="wgv2-hrs">${past ? '—' : '·'}</span>`}
            </div>`;
          }).join('')}
        </div>
        <div class="wc-footer-row">
          <span>${myDR.length}/5 days filed</span>
          <strong>${formatDurationShort(totalMs)}</strong>
        </div>
      </div>`;
  },

  // ── Weekly Report Card (used in TL and Mgmt views) ──────────
  buildWeeklyReportCard(wr, forManagement = false) {
    const status   = wr['Weekly Report Status'] || 'Submitted';
    const totalMs  = parseFloat(wr['Total Hours'] || 0) * 3600000;
    const onTime   = status === 'Submitted';
    const canExport = Auth.can('export_pdf');

    return `
      <div class="wr-card-v2 ${onTime ? '' : 'wr-late'}">
        <div class="wr2-header">
          <div class="wr2-dept-icon">${escapeHtml((wr['Department'] || '?').charAt(0))}</div>
          <div class="wr2-title">
            <h4>${escapeHtml(wr['Department'])} Department</h4>
            <p>${formatDate(wr['Week Start'])} – ${formatDateShort(wr['Week End'])} (Mon–Fri)</p>
          </div>
          <div class="wr2-status-wrap">
            ${this._wrStatusBadge(status)}
            ${!onTime && !forManagement ? `<span class="wr-hidden-note">Hidden from Management</span>` : ''}
          </div>
        </div>
        <div class="wr2-stats">
          <div class="wr2-stat"><strong>${wr['Total Staff']}</strong><small>Members</small></div>
          <div class="wr2-stat primary"><strong>${formatDurationShort(totalMs)}</strong><small>Total Time</small></div>
          <div class="wr2-stat"><strong>${parseFloat(wr['Total Hours'] || 0).toFixed(2)}h</strong><small>Decimal Hrs</small></div>
        </div>
        ${wr['WeeklySummary'] ? `
          <div class="wr2-summary">
            <span>📝</span>
            <p>${escapeHtml(wr['WeeklySummary'])}</p>
          </div>` : ''}
        ${wr['Completed Tasks'] ? `
          <div class="wr2-detail-row">
            <span class="wr2-detail-label">✅ Completed</span>
            <span>${escapeHtml(wr['Completed Tasks'])}</span>
          </div>` : ''}
        ${wr['Ongoing Tasks'] ? `
          <div class="wr2-detail-row">
            <span class="wr2-detail-label">🔄 Ongoing</span>
            <span>${escapeHtml(wr['Ongoing Tasks'])}</span>
          </div>` : ''}
        <div class="wr2-footer">
          <span>Submitted by ${escapeHtml(wr['Team Leader'])} · ${formatDateTime(wr['Finalized At'])}</span>
          ${canExport ? `<button class="btn btn-sm btn-ghost" onclick="Reports.exportWeeklyPDF('${wr['Report ID']}')">⬇ Export PDF</button>` : ''}
        </div>
      </div>`;
  },

  _wrStatusBadge(status) {
    const map = {
      'Submitted': '<span class="badge bg-green">✅ Submitted</span>',
      'Late':      '<span class="badge bg-red">⏰ Late</span>',
      'Draft':     '<span class="badge bg-slate">📝 Draft</span>',
      'Finalized': '<span class="badge bg-green">✅ Submitted</span>',
    };
    return map[status] || `<span class="badge bg-slate">${escapeHtml(status)}</span>`;
  },

  // ── TL Weekly Progress Card ──────────────────────────────────
  buildWeeklyProgressCard(ws) {
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const { memberMap, missing, weekDays } = ws;

    const deadline  = getWeekDeadline(ws.weekStart);
    const now       = new Date();
    const isLate    = now > deadline;
    const h         = ws.hoursLeft;
    const urgency   = isLate ? 'late' : h <= 4 ? 'urgent' : h <= 24 ? 'soon' : 'ok';

    const deadlineCls = { late:'deadline-chip late', urgent:'deadline-chip urgent', soon:'deadline-chip soon', ok:'deadline-chip ok' }[urgency];
    const deadlineMsg = isLate
      ? '⏰ Deadline passed — Friday 5:00 PM — submission will be marked Late'
      : h <= 4 ? `⚡ ${h}h remaining until Friday 5:00 PM`
      : h <= 24 ? `🕐 ${h}h remaining until deadline`
      : `✅ Deadline: ${deadlineDisplay(ws.weekStart)}`;

    return `
      <div class="weekly-progress-card">
        <div class="wpc-top">
          <div>
            <h3>Weekly Report — ${escapeHtml(ws.dept)}</h3>
            <p>${formatDate(ws.weekStart)} – ${formatDateShort(ws.weekDays[4])}</p>
          </div>
          <span class="${deadlineCls}">${deadlineMsg}</span>
        </div>

        <div class="wpc-coverage">
          ${weekDays.map((d, i) => {
            const dayReports = ws.deptDR.filter(r => (r['Report Date'] || '').startsWith(d));
            const past       = new Date(d + 'T23:59:59') < now;
            return `<div class="wpc-day ${dayReports.length > 0 ? 'has-reports' : past ? 'no-reports' : 'future'}">
              <span class="wpc-dayname">${dayNames[i]}</span>
              <span class="wpc-daydate">${formatDateShort(d)}</span>
              <span class="wpc-count">${dayReports.length > 0 ? `${dayReports.length} rpt${dayReports.length > 1 ? 's' : ''}` : past ? 'None' : '—'}</span>
            </div>`;
          }).join('')}
        </div>

        <div class="wpc-members">
          <div class="wpc-members-header">
            <span>Team Members (${Object.keys(memberMap).length} reported)</span>
            ${Object.keys(missing).length > 0 ? `<span class="badge bg-amber">${Object.keys(missing).length} missing</span>` : '<span class="badge bg-green">All reported</span>'}
          </div>
          ${Object.entries(memberMap).map(([name, m]) => `
            <div class="wpc-member-row ok">
              <div class="mini-avatar">${getInitials(name)}</div>
              <div class="wpc-member-info">
                <strong>${escapeHtml(name)}</strong>
                <span>${m.days}/5 days · ${m.hours.toFixed(2)}h</span>
              </div>
              <span class="badge bg-green">✓ Reported</span>
            </div>`).join('')}
          ${Object.entries(missing).map(([name, dates]) => `
            <div class="wpc-member-row missing">
              <div class="mini-avatar">${getInitials(name)}</div>
              <div class="wpc-member-info">
                <strong>${escapeHtml(name)}</strong>
                <span>Missing: ${dates.map(d => getDayName(d).slice(0, 3)).join(', ')}</span>
              </div>
              <span class="badge bg-amber">⚠ Incomplete</span>
            </div>`).join('')}
        </div>

        <div class="wpc-totals">
          <div class="wpc-total-stat"><span>${ws.deptDR.length}</span><small>Daily Reports</small></div>
          <div class="wpc-total-stat highlight"><span>${formatDurationShort(ws.totalMs)}</span><small>Total Time</small></div>
          <div class="wpc-total-stat"><span>${ws.totalHours.toFixed(2)}h</span><small>Decimal Hours</small></div>
        </div>

        <!-- FINALIZE REPORT BUTTON — Official action to send to Management -->
        ${ws.deptDR.length > 0 ? `
        <div class="wpc-submit-section">
          <p class="wpc-submit-note">
            Click <strong>Finalize Report</strong> to officially send this weekly report to Management.
            <br>Once submitted, it will be visible in the Management dashboard.
          </p>
          <button class="btn btn-primary btn-lg btn-full" onclick="Reports.finalizeWeekly()">
            🚀 Finalize Report
          </button>
        </div>` : `
        <div class="wpc-submit-section disabled">
          <p class="wpc-submit-note text-muted">No finalized daily reports yet this week. Staff must finalize their daily reports before the weekly report can be submitted.</p>
        </div>`}
      </div>`;
  },

  // ============================================================
  // REPORT TABLE
  // ============================================================

  buildDailyReportTable(reports) {
    if (!reports || reports.length === 0) {
      return `<div class="empty-state"><span class="empty-icon">📋</span><p>Walang daily reports.</p></div>`;
    }
    const sorted = [...reports].sort((a, b) => new Date(b['Report Date']) - new Date(a['Report Date']));
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Tasks</th>
              <th>Active Hours</th>
              <th>Status</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(r => `<tr>
              <td>
                <div class="date-cell">
                  <strong>${formatDateShort(r['Report Date'])}</strong>
                  <small>${getDayName((r['Report Date'] || '').substring(0, 10))}</small>
                </div>
              </td>
              <td>
                <div class="emp-cell">
                  <span class="mini-avatar">${getInitials(r['Employee Name'])}</span>
                  ${escapeHtml(r['Employee Name'])}
                </div>
              </td>
              <td>${(r['Tasks Worked On'] || '').split(',').filter(Boolean).length} task(s)</td>
              <td><strong>${parseFloat(r['Total Active Hours'] || 0).toFixed(2)}h</strong></td>
              <td>${getStatusBadge(r['Daily report Status'] || r['Daily Report Status'] || 'Finalized')}</td>
              <td class="td-summary">${escapeHtml((r['Daily Summary'] || '').substring(0, 60))}${(r['Daily Summary'] || '').length > 60 ? '…' : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  },

  // ============================================================
  // PDF EXPORT
  // ============================================================

  exportWeeklyPDF(reportId) {
    const wr = (AppState.weeklyReports || []).find(r => r['Report ID'] === reportId);
    if (!wr) return;
    const totalMs = parseFloat(wr['Total Hours'] || 0) * 3600000;
    const title   = `${wr['Department']} Weekly Report — ${formatDate(wr['Week Start'])}`;
    const html    = `
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">Department: <strong>${escapeHtml(wr['Department'])}</strong> &nbsp;|&nbsp;
        Team Leader: <strong>${escapeHtml(wr['Team Leader'])}</strong> &nbsp;|&nbsp;
        Status: <strong>${escapeHtml(wr['Weekly Report Status'])}</strong></p>
      <div class="stats">
        <div class="stat"><strong>${wr['Total Staff']}</strong><small>Members</small></div>
        <div class="stat"><strong>${formatDurationShort(totalMs)}</strong><small>Total Time</small></div>
        <div class="stat"><strong>${parseFloat(wr['Total Hours'] || 0).toFixed(2)}h</strong><small>Decimal Hours</small></div>
      </div>
      ${wr['WeeklySummary'] ? `<div class="summary-box">"${escapeHtml(wr['WeeklySummary'])}"</div>` : ''}
      <table>
        <thead><tr><th>Field</th><th>Details</th></tr></thead>
        <tbody>
          <tr><td>Coverage</td><td>${formatDate(wr['Week Start'])} – ${formatDate(wr['Week End'])} (Mon–Fri)</td></tr>
          <tr><td>Completed Tasks</td><td>${escapeHtml(wr['Completed Tasks'] || '—')}</td></tr>
          <tr><td>Ongoing Tasks</td><td>${escapeHtml(wr['Ongoing Tasks'] || '—')}</td></tr>
          <tr><td>Recommendations</td><td>${escapeHtml(wr['Recommendations'] || '—')}</td></tr>
          <tr><td>Submitted At</td><td>${formatDateTime(wr['Finalized At'])}</td></tr>
          <tr><td>Submission Status</td><td>${escapeHtml(wr['Weekly Report Status'])}</td></tr>
        </tbody>
      </table>
      ${wr['Recommendations'] ? `<h2 style="margin-top:16px">Recommendations</h2><p>${escapeHtml(wr['Recommendations'])}</p>` : ''}`;
    printToPDF(title, html);
  },
};
