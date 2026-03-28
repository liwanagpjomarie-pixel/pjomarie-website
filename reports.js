// ============================================================
// reports.js — DTIM v2.3
// Finalize Day logic:
//  • Only non-field + field-with-proof tasks are "active worked tasks"
//  • Button DISABLED if all active tasks are Completed (no running work)
//  • Button ENABLED  if at least 1 In Progress or Paused task
//  • Field tasks count as Completed (for report) ONLY if they have proof
//  • Field tasks without proof are excluded from the daily report
// ============================================================

const Reports = {

  async loadDailyReports(filters = {}) {
    AppState.dailyReports = await API.getDailyReports(filters);
    return AppState.dailyReports;
  },

  async loadWeeklyReports(filters = {}) {
    AppState.weeklyReports = await API.getWeeklyReports(filters);
    return AppState.weeklyReports;
  },

  async loadWeeklyForTL() {
    const tl = AppState.currentUser;
    const allDR = await API.getDailyReportsByDept(tl.department);
    AppState.dailyReports = allDR;
    await this.loadWeeklyReports({ department: tl.department });
  },

  // ============================================================
  // FINALIZE DAY
  //
  // ACTIVE tasks (for report) = tasks worked on today that are:
  //   - Office/Remote: In Progress, Paused, or Completed
  //   - Field: ONLY if Completed (proof uploaded)
  //
  // BUTTON logic:
  //   - ENABLED:  at least 1 In Progress or Paused (non-field) task today
  //   - DISABLED: all active tasks are Completed (nothing actively running)
  //   - HIDDEN:   no active tasks at all (nothing worked on)
  // ============================================================

  async finalizeDay() {
    const user  = AppState.currentUser;
    const today = getTodayDate();

    const todayAll = AppState.tasks.filter(t => {
      const displayDate = getTaskDisplayDate(t);
      return matchesDate(displayDate, today);
    });

    // Active (reportable) tasks:
    //   - Non-field: In Progress, Paused, or Completed (not Not Started)
    //   - Field: only if Completed (has proof)
    const activeTasks = todayAll.filter(t => {
      if (isFieldTask(t)) return t['Status'] === 'Completed' && fieldTaskHasProof(t);
      return t['Status'] !== 'Not Started' && t['Status'] !== 'Cancelled';
    });

    if (activeTasks.length === 0) {
      showToast('Walang aktibidad ngayon para i-finalize.', 'warning'); return;
    }

    // Check already finalized
    const already = (AppState.dailyReports || []).find(r =>
      r['Employee Name'] === user.name &&
      matchesDate(r['Report Date'], today) &&
      (r['Daily report Status'] === 'Finalized' || r['Daily Report Status'] === 'Finalized')
    );
    if (already) { showToast('Na-finalize na ang iyong day report ngayon.', 'info'); return; }

    // Active check (must have at least 1 In Progress or Paused non-field task)
    const inProgressTasks = activeTasks.filter(t =>
      !isFieldTask(t) && (t['Status'] === 'In Progress' || t['Status'] === 'Paused')
    );
    if (inProgressTasks.length === 0) {
      showToast('Lahat ng tasks ay Completed na. Walang aktibong task para i-finalize.', 'info');
      return;
    }

    const totalMs   = activeTasks.reduce((s, t) => s + (isFieldTask(t) ? 0 : Tasks.getElapsed(t['Task ID'])), 0);
    const completed = activeTasks.filter(t => t['Status'] === 'Completed').map(t => t['Task Name']).join(', ');
    const ongoing   = inProgressTasks.map(t => t['Task Name']).join(', ');
    const fieldDone = activeTasks.filter(t => isFieldTask(t) && t['Status'] === 'Completed');

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
          <div class="fin-stat"><span>${activeTasks.length}</span><small>Tasks</small></div>
          <div class="fin-stat highlight"><span>${formatDurationShort(totalMs)}</span><small>Active Time</small></div>
          <div class="fin-stat success"><span>${activeTasks.filter(t=>t['Status']==='Completed').length}</span><small>Completed</small></div>
          ${fieldDone.length ? `<div class="fin-stat"><span>${fieldDone.length}</span><small>Field Done</small></div>` : ''}
        </div>
        ${completed ? `<div class="fp-section"><label>✅ Completed Tasks</label><p>${escapeHtml(completed)}</p></div>` : ''}
        ${ongoing   ? `<div class="fp-section"><label>🔄 In Progress / Paused</label><p>${escapeHtml(ongoing)}</p></div>` : ''}
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
        callback: () => this._doFinalizeDay(user, today, activeTasks, totalMs, completed, ongoing) },
    ]);
  },

  async _doFinalizeDay(user, today, tasks, totalMs, completed, ongoing) {
    const summary = getFormValue('f-daily-summary');
    if (!summary) { showToast('Mangyaring isulat ang daily summary.', 'error'); return; }
    hideModal();
    showToast('Sine-save ang daily report...', 'info', 2000);

    try {
      await API.createDailyReport({
        employeeName:   user.name,
        department:     user.department,
        date:           todayReadable(),
        totalHours:     msToHoursDecimal(totalMs),
        tasksWorkedOn:  tasks.map(t => t['Task Name']).join(', '),
        completedTasks: completed || null,
        ongoingTasks:   ongoing   || null,
        pauseReasons:   null,
        summary,
      });

      if (!AppState.dailyReports) AppState.dailyReports = [];
      AppState.dailyReports.unshift({
        'Report ID':           generateId('DR'),
        'Employee Name':       user.name,
        'Department':          user.department,
        'Report Date':         todayReadable(),
        'Total Active Hours':  msToHoursDecimal(totalMs),
        'Tasks Worked On':     tasks.map(t => t['Task Name']).join(', '),
        'Completed Tasks':     completed || 'null',
        'Ongoing Tasks':       ongoing   || 'null',
        'Daily Summary':       summary,
        'Finalized At':        nowReadable(),
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
  // WEEKLY REPORT — Mon–Fri, Friday 5:00 PM deadline
  // ============================================================

  computeWeekState() {
    const tl         = AppState.currentUser;
    const weekStart  = getWeekStart();
    const weekDays   = getWeekDays(weekStart);
    const dept       = tl.department;
    const deadline   = getWeekDeadline(weekStart);
    const now        = new Date();
    const isPastDeadline = now > deadline;
    const hoursLeft  = hoursUntilDeadline(weekStart);

    const deptDR = (AppState.dailyReports || []).filter(r => {
      const isThisWeek  = weekDays.some(d => matchesDate(r['Report Date'], d));
      const isFinalized = r['Daily report Status'] === 'Finalized' || r['Daily Report Status'] === 'Finalized';
      const empRecord   = (AppState.employees || []).find(e => e['Employee Name'] === r['Employee Name']);
      const empDept     = empRecord ? empRecord['Department'] : dept;
      return isThisWeek && isFinalized && empDept === dept;
    });

    const memberMap = {};
    deptDR.forEach(r => {
      const n = r['Employee Name'];
      if (!memberMap[n]) memberMap[n] = { days:0, hours:0, dates:[] };
      memberMap[n].days++;
      memberMap[n].hours += parseFloat(r['Total Active Hours']||0);
      memberMap[n].dates.push(r['Report Date']);
    });

    const deptEmployees = (AppState.employees||[]).filter(e =>
      e['Department'] === dept && e['Is Active'] !== 'false' &&
      mapPositionToRole(e['Position']) !== 'Management' && mapPositionToRole(e['Position']) !== 'Admin'
    );
    const missing = {};
    deptEmployees.forEach(e => {
      const name  = e['Employee Name'];
      const filed = memberMap[name]?.dates || [];
      const missed = weekDays.filter(d => !filed.some(fd => matchesDate(fd, d)));
      if (missed.length > 0) missing[name] = missed;
    });

    const totalHours  = Object.values(memberMap).reduce((s,m) => s+m.hours, 0);
    const memberCount = Object.keys(memberMap).length;
    const existingWR  = (AppState.weeklyReports||[]).find(r =>
      r['Department'] === dept && matchesDate(r['Week Start'], weekStart)
    );

    return {
      weekStart, weekDays, dept, deadline, isPastDeadline, hoursLeft,
      deptDR, memberMap, missing, totalHours, memberCount, existingWR,
      totalMs: totalHours * 3600000, canSubmit: !existingWR,
    };
  },

  async finalizeWeekly() {
    if (!Auth.can('finalize_weekly')) return;
    const ws = this.computeWeekState();

    if (ws.existingWR) {
      showToast(`Na-${ws.existingWR['Weekly Report Status']||'submit'} na ang weekly report para sa linggong ito.`, 'info');
      return;
    }
    if (ws.deptDR.length === 0) {
      showToast('Walang finalized na daily reports para sa linggong ito.', 'warning'); return;
    }

    const isLate = ws.isPastDeadline;
    const h      = ws.hoursLeft;
    const deadlineBanner = isLate
      ? `<div class="deadline-banner late">⏰ LATE — Ang deadline (Friday 5:00 PM) ay lumipas na. Ang report ay markahang <strong>Late</strong> at hindi makikita ng Management.</div>`
      : h <= 2
        ? `<div class="deadline-banner warning">⚡ ${h}h na lang bago mag-deadline! Mag-submit na.</div>`
        : `<div class="deadline-banner ok">✅ On-time · Deadline: ${deadlineDisplay(ws.weekStart)}</div>`;

    const memberRows = Object.entries(ws.memberMap).map(([name, m]) =>
      `<tr><td>${escapeHtml(name)}</td><td>${m.days}/5 days</td><td><strong>${m.hours.toFixed(2)}h</strong></td></tr>`
    ).join('');

    const missingSection = Object.keys(ws.missing).length > 0 ? `
      <div class="missing-section">
        <label>⚠️ Missing Daily Reports</label>
        ${Object.entries(ws.missing).map(([name, dates]) => `
          <div class="missing-row"><span>${escapeHtml(name)}</span>
          <span>${dates.map(d => getDayName(d).slice(0,3)).join(', ')}</span></div>`).join('')}
      </div>` : '';

    showModal('📊 Finalize & Submit Weekly Report', `
      <div class="finalize-preview">
        ${deadlineBanner}
        <div class="fp-date-banner" style="margin-top:12px">
          <span>📊</span>
          <div>
            <strong>${escapeHtml(ws.dept)} Department</strong>
            <small>Week of ${formatDate(ws.weekStart)} – ${formatDateShort(ws.weekDays[4])} (Mon–Fri)</small>
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
        <div class="fin-notice">⚠️ Once submitted, this report will be visible to Management.</div>
      </div>
    `, [
      { label: 'Cancel', type: 'ghost' },
      { label: isLate ? '⏰ Submit (Late)' : '🚀 Finalize & Submit Report',
        type: 'primary', close: false, callback: () => this._doFinalizeWeekly(ws) },
    ]);
  },

  async _doFinalizeWeekly(ws) {
    const summary = getFormValue('f-weekly-summary');
    const reco    = getFormValue('f-weekly-reco');
    if (!summary) { showToast('Mangyaring isulat ang weekly summary.', 'error'); return; }
    hideModal();
    showToast('Sine-save ang weekly report...', 'info', 2000);

    const submittedAt = nowISO();
    const onTime      = isSubmittedOnTime(ws.weekStart, submittedAt);
    const status      = onTime ? 'Submitted' : 'Late';

    const completed = ws.deptDR.flatMap(r => (r['Completed Tasks']||'').split(',').map(s=>s.trim()).filter(Boolean));
    const ongoing   = ws.deptDR.flatMap(r => (r['Ongoing Tasks']  ||'').split(',').map(s=>s.trim()).filter(Boolean));

    try {
      const wrData = {
        department:     ws.dept,
        teamLeaderName: AppState.currentUser.name,
        weekStart:      formatDate(ws.weekStart),
        weekEnd:        formatDate(ws.weekDays[4]),
        totalStaff:     ws.memberCount,
        totalHours:     ws.totalHours.toFixed(2),
        completedTasks: [...new Set(completed)].join(', ') || null,
        ongoingTasks:   [...new Set(ongoing)].join(', ')   || null,
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
        'Week Start':           wrData.weekStart,
        'Week End':             wrData.weekEnd,
        'Total Staff':          ws.memberCount,
        'Total Hours':          ws.totalHours.toFixed(2),
        'Completed Tasks':      wrData.completedTasks||'null',
        'Ongoing Tasks':        wrData.ongoingTasks||'null',
        'WeeklySummary':        summary,
        'Recommendations':      reco||'null',
        'Finalized At':         nowReadable(),
        'Weekly Report Status': status,
      });

      showToast(onTime
        ? '✅ Weekly report submitted! Now visible to Management.'
        : '⚠️ Report saved but marked Late — Management cannot see this.',
        onTime ? 'success' : 'warning', 5000);
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
    const user       = AppState.currentUser;
    const today      = getTodayDate();

    // All tasks visible today (using scheduled date for field tasks)
    const todayAll = AppState.tasks.filter(t => {
      const displayDate = getTaskDisplayDate(t);
      return matchesDate(displayDate, today);
    });

    // Active tasks for reporting
    const activeTasks = todayAll.filter(t => {
      if (isFieldTask(t)) return t['Status'] === 'Completed' && fieldTaskHasProof(t);
      return t['Status'] !== 'Not Started' && t['Status'] !== 'Cancelled';
    });

    const inProgress = activeTasks.filter(t => !isFieldTask(t) && (t['Status']==='In Progress'||t['Status']==='Paused'));
    const completed  = activeTasks.filter(t => t['Status'] === 'Completed');
    const allDone    = activeTasks.length > 0 && inProgress.length === 0;
    const totalMs    = activeTasks.reduce((s,t) => s + (isFieldTask(t) ? 0 : Tasks.getElapsed(t['Task ID'])), 0);

    // Field tasks pending proof (shown separately)
    const fieldPending = todayAll.filter(t => isFieldTask(t) && t['Status'] !== 'Completed');

    const report = (AppState.dailyReports||[]).find(r =>
      r['Employee Name'] === user.name &&
      matchesDate(r['Report Date'], today) &&
      (r['Daily report Status']==='Finalized' || r['Daily Report Status']==='Finalized')
    );

    let actionHTML = '';
    if (report) {
      actionHTML = `<div class="wc-status done"><span>✅</span>
        <span>Day finalized at ${formatDateTime(report['Finalized At'])}</span></div>`;
    } else if (activeTasks.length === 0 && fieldPending.length === 0) {
      actionHTML = `<div class="wc-status neutral"><span>💡</span>
        <span>No activity yet today.</span></div>`;
    } else if (allDone) {
      actionHTML = `
        <div class="finalize-disabled-note">
          <span>ℹ️</span>
          <span>All tasks completed. An active (In Progress) task is required to finalize.</span>
        </div>
        <button class="btn btn-primary btn-full mt-8" disabled
          title="Need at least 1 In Progress task to finalize">✅ Finalize My Day</button>`;
    } else {
      actionHTML = `<button class="btn btn-primary btn-full mt-8" id="btn-finalize-day"
        onclick="Reports.finalizeDay()">✅ Finalize My Day</button>`;
    }

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
          <div class="wcs"><span class="wcs-val">${todayAll.length}</span><span class="wcs-lbl">Tasks</span></div>
          <div class="wcs"><span class="wcs-val blue">${inProgress.length}</span><span class="wcs-lbl">Active</span></div>
          <div class="wcs"><span class="wcs-val green">${completed.length}</span><span class="wcs-lbl">Done</span></div>
          <div class="wcs"><span class="wcs-val purple">${formatDurationShort(totalMs)}</span><span class="wcs-lbl">Time</span></div>
        </div>
        ${fieldPending.length > 0 ? `
          <div class="field-pending-note">
            <span>🗺️</span>
            <span>${fieldPending.length} field task${fieldPending.length>1?'s':''} awaiting proof</span>
          </div>` : ''}
        <div class="wc-time-bar">
          <span class="wc-time-label">Total Active Time</span>
          <span class="wc-time-val">${formatDuration(totalMs)}</span>
        </div>
        ${actionHTML}
      </div>`;
  },

  buildWeeklySummaryWidget() {
    const user      = AppState.currentUser;
    const weekStart = getWeekStart();
    const weekDays  = getWeekDays(weekStart);
    const myDR      = (AppState.dailyReports||[]).filter(r =>
      r['Employee Name'] === user.name &&
      weekDays.some(d => matchesDate(r['Report Date'], d)) &&
      (r['Daily report Status']==='Finalized'||r['Daily Report Status']==='Finalized')
    );
    const totalMs  = myDR.reduce((s,r) => s+(parseFloat(r['Total Active Hours']||0)*3600000), 0);
    const dayNames = ['Mon','Tue','Wed','Thu','Fri'];
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
          ${weekDays.map((d,i) => {
            const dr   = myDR.find(r => matchesDate(r['Report Date'], d));
            const past = new Date(d+'T23:59:59') < new Date();
            return `<div class="wgv2-day ${dr?'filed':past?'missed':'upcoming'}">
              <span class="wgv2-name">${dayNames[i]}</span>
              <span class="wgv2-date">${formatDateShort(d).replace(/[A-Za-z]+\s/,'')}</span>
              ${dr ? `<span class="wgv2-hrs">${parseFloat(dr['Total Active Hours']||0).toFixed(1)}h</span>`
                   : `<span class="wgv2-hrs">${past?'—':'·'}</span>`}
            </div>`;
          }).join('')}
        </div>
        <div class="wc-footer-row">
          <span>${myDR.length}/5 days filed</span>
          <strong>${formatDurationShort(totalMs)}</strong>
        </div>
      </div>`;
  },

  buildWeeklyReportCard(wr, forManagement = false) {
    const status  = wr['Weekly Report Status']||'Submitted';
    const totalMs = parseFloat(wr['Total Hours']||0)*3600000;
    const onTime  = status==='Submitted'||status==='Finalized';
    return `
      <div class="wr-card-v2 ${onTime?'':'wr-late'}">
        <div class="wr2-header">
          <div class="wr2-dept-icon">${escapeHtml((wr['Department']||'?').charAt(0))}</div>
          <div class="wr2-title">
            <h4>${escapeHtml(wr['Department'])} Department</h4>
            <p>${escapeHtml(wr['Week Start'])} – ${escapeHtml(wr['Week End'])} (Mon–Fri)</p>
          </div>
          <div class="wr2-status-wrap">
            ${this._wrStatusBadge(status)}
            ${!onTime&&!forManagement ? `<span class="wr-hidden-note">Hidden from Management</span>` : ''}
          </div>
        </div>
        <div class="wr2-stats">
          <div class="wr2-stat"><strong>${wr['Total Staff']}</strong><small>Members</small></div>
          <div class="wr2-stat primary"><strong>${formatDurationShort(totalMs)}</strong><small>Total Time</small></div>
          <div class="wr2-stat"><strong>${parseFloat(wr['Total Hours']||0).toFixed(2)}h</strong><small>Decimal Hrs</small></div>
        </div>
        ${wr['WeeklySummary']&&wr['WeeklySummary']!=='null' ? `
          <div class="wr2-summary"><span>📝</span><p>${escapeHtml(wr['WeeklySummary'])}</p></div>` : ''}
        ${wr['Completed Tasks']&&wr['Completed Tasks']!=='null' ? `
          <div class="wr2-detail-row"><span class="wr2-detail-label">✅ Completed</span>
          <span>${escapeHtml(wr['Completed Tasks'])}</span></div>` : ''}
        <div class="wr2-footer">
          <span>Submitted by ${escapeHtml(wr['Team Leader'])} · ${formatDateTime(wr['Finalized At'])}</span>
          ${Auth.can('export_pdf') ? `<button class="btn btn-sm btn-ghost"
            onclick="Reports.exportWeeklyPDF('${wr['Report ID']}')">⬇ Export PDF</button>` : ''}
        </div>
      </div>`;
  },

  _wrStatusBadge(status) {
    const map = {
      'Submitted':'<span class="badge bg-green">✅ Submitted</span>',
      'Late':'<span class="badge bg-red">⏰ Late</span>',
      'Draft':'<span class="badge bg-slate">📝 Draft</span>',
      'Finalized':'<span class="badge bg-green">✅ Submitted</span>',
    };
    return map[status] || `<span class="badge bg-slate">${escapeHtml(status)}</span>`;
  },

  buildWeeklyProgressCard(ws) {
    const dayNames = ['Mon','Tue','Wed','Thu','Fri'];
    const {memberMap, missing, weekDays} = ws;
    const isLate   = ws.isPastDeadline;
    const h        = ws.hoursLeft;
    const urgency  = isLate?'late':h<=2?'urgent':h<=8?'soon':'ok';
    const dcls     = {late:'deadline-chip late',urgent:'deadline-chip urgent',soon:'deadline-chip soon',ok:'deadline-chip ok'}[urgency];
    const dmsg     = isLate ? '⏰ Deadline passed (Friday 5:00 PM)' :
      h<=2 ? `⚡ ${h}h remaining` : h<=8 ? `🕐 ${h}h left` : `✅ Deadline: ${deadlineDisplay(ws.weekStart)}`;

    return `
      <div class="weekly-progress-card">
        <div class="wpc-top">
          <div>
            <h3>Weekly Report — ${escapeHtml(ws.dept)}</h3>
            <p>${formatDate(ws.weekStart)} – ${formatDateShort(ws.weekDays[4])} (Mon–Fri)</p>
          </div>
          <span class="${dcls}">${dmsg}</span>
        </div>
        <div class="wpc-coverage">
          ${weekDays.map((d,i) => {
            const dayRpts = ws.deptDR.filter(r => matchesDate(r['Report Date'],d));
            const past    = new Date(d+'T23:59:59') < new Date();
            return `<div class="wpc-day ${dayRpts.length>0?'has-reports':past?'no-reports':'future'}">
              <span class="wpc-dayname">${dayNames[i]}</span>
              <span class="wpc-daydate">${formatDateShort(d)}</span>
              <span class="wpc-count">${dayRpts.length>0?`${dayRpts.length} rpt`:past?'None':'—'}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="wpc-members">
          <div class="wpc-members-header">
            <span>Team Members (${Object.keys(memberMap).length} reported)</span>
            ${Object.keys(missing).length>0 ? `<span class="badge bg-amber">${Object.keys(missing).length} missing</span>`
              : '<span class="badge bg-green">All reported</span>'}
          </div>
          ${Object.entries(memberMap).map(([name,m]) => `
            <div class="wpc-member-row ok">
              <div class="mini-avatar">${getInitials(name)}</div>
              <div class="wpc-member-info"><strong>${escapeHtml(name)}</strong>
                <span>${m.days}/5 days · ${m.hours.toFixed(2)}h</span></div>
              <span class="badge bg-green">✓ Reported</span>
            </div>`).join('')}
          ${Object.entries(missing).map(([name,dates]) => `
            <div class="wpc-member-row missing">
              <div class="mini-avatar">${getInitials(name)}</div>
              <div class="wpc-member-info"><strong>${escapeHtml(name)}</strong>
                <span>Missing: ${dates.map(d => getDayName(d).slice(0,3)).join(', ')}</span></div>
              <span class="badge bg-amber">⚠ Incomplete</span>
            </div>`).join('')}
        </div>
        <div class="wpc-totals">
          <div class="wpc-total-stat"><span>${ws.deptDR.length}</span><small>Daily Reports</small></div>
          <div class="wpc-total-stat highlight"><span>${formatDurationShort(ws.totalMs)}</span><small>Total Time</small></div>
          <div class="wpc-total-stat"><span>${ws.totalHours.toFixed(2)}h</span><small>Decimal Hours</small></div>
        </div>
        <div class="finalize-report-action">
          <button class="btn btn-primary btn-full btn-lg" onclick="Reports.finalizeWeekly()"
            ${ws.deptDR.length===0 ? 'disabled' : ''}>
            🚀 Finalize &amp; Submit Report to Management
          </button>
          <p class="finalize-hint">
            ${isLate ? '⏰ Late — Management will not see this report.'
              : `Submit before ${deadlineDisplay(ws.weekStart)} to be visible to Management.`}
          </p>
        </div>
      </div>`;
  },

  buildDailyReportTable(reports) {
    if (!reports || reports.length === 0)
      return `<div class="empty-state"><span class="empty-icon">📋</span><p>Walang daily reports.</p></div>`;
    const sorted = [...reports].sort((a,b) => new Date(b['Report Date'])-new Date(a['Report Date']));
    return `
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Employee</th><th>Tasks</th><th>Active Hours</th><th>Status</th><th>Summary</th></tr></thead>
        <tbody>${sorted.map(r => `<tr>
          <td><div class="date-cell"><strong>${escapeHtml(r['Report Date']||'—')}</strong></div></td>
          <td><div class="emp-cell"><span class="mini-avatar">${getInitials(r['Employee Name'])}</span>${escapeHtml(r['Employee Name'])}</div></td>
          <td>${(r['Tasks Worked On']||'').split(',').filter(Boolean).length} task(s)</td>
          <td><strong>${parseFloat(r['Total Active Hours']||0).toFixed(2)}h</strong></td>
          <td>${getStatusBadge(r['Daily report Status']||r['Daily Report Status']||'Finalized')}</td>
          <td class="td-summary">${escapeHtml((r['Daily Summary']||'').substring(0,60))}${(r['Daily Summary']||'').length>60?'…':''}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  },

  exportWeeklyPDF(reportId) {
    const wr = (AppState.weeklyReports||[]).find(r => r['Report ID']===reportId);
    if (!wr) return;
    const totalMs = parseFloat(wr['Total Hours']||0)*3600000;
    const title   = `${wr['Department']} Weekly Report — ${wr['Week Start']}`;
    printToPDF(title, `
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">Dept: <b>${escapeHtml(wr['Department'])}</b> | TL: <b>${escapeHtml(wr['Team Leader'])}</b> | Status: <b>${escapeHtml(wr['Weekly Report Status'])}</b></p>
      <div class="stats">
        <div class="stat"><strong>${wr['Total Staff']}</strong><small>Members</small></div>
        <div class="stat"><strong>${formatDurationShort(totalMs)}</strong><small>Total Time</small></div>
        <div class="stat"><strong>${parseFloat(wr['Total Hours']||0).toFixed(2)}h</strong><small>Decimal Hours</small></div>
      </div>
      ${wr['WeeklySummary']&&wr['WeeklySummary']!=='null' ? `<div class="summary-box">"${escapeHtml(wr['WeeklySummary'])}"</div>` : ''}
      <table><thead><tr><th>Field</th><th>Details</th></tr></thead><tbody>
        <tr><td>Coverage</td><td>${escapeHtml(wr['Week Start'])} – ${escapeHtml(wr['Week End'])} (Mon–Fri)</td></tr>
        <tr><td>Completed Tasks</td><td>${escapeHtml(wr['Completed Tasks']!=='null'?wr['Completed Tasks']:'—')}</td></tr>
        <tr><td>Submitted At</td><td>${formatDateTime(wr['Finalized At'])}</td></tr>
      </tbody></table>`);
  },
};
