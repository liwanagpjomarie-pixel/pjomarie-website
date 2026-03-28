// ============================================================
// dashboard.js — DTIM v2.1
// Role dashboards: Staff | TeamLeader | Management | Admin
//
// MANAGEMENT RULE: Only shows weekly reports with
//   Weekly Report Status = 'Submitted' (i.e., submitted by Friday EOD)
//   If TL missed deadline → status = 'Late' → hidden from Management
// ============================================================

const Dashboard = {
  _view: 'dashboard',

  async renderForRole() {
    this._renderSidebar();
    await this.switchView('dashboard');
  },

  async switchView(viewId) {
    this._view = viewId;
    this._updateNav(viewId);
    showLoading('main-content', 'Loading...');
    try {
      const role = AppState.currentUser.role;
      switch (role) {
        case 'Staff':      await this._staff(viewId);   break;
        case 'TeamLeader': await this._tl(viewId);      break;
        case 'Management': await this._mgmt(viewId);    break;
        case 'Admin':      await this._admin(viewId);   break;
        default: document.getElementById('main-content').innerHTML =
          '<div class="empty-state"><span class="empty-icon">⚠️</span><p>Unknown role.</p></div>';
      }
    } catch (err) {
      console.error('Dashboard error:', err);
      document.getElementById('main-content').innerHTML = `
        <div class="error-state">
          <span class="error-icon">🔌</span>
          <h3>Connection Error</h3>
          <p>${escapeHtml(err.message || 'Could not load data. Check your internet connection.')}</p>
          <button class="btn btn-primary mt-16" onclick="Dashboard.refreshCurrent()">🔄 Try Again</button>
        </div>`;
    }
  },

  refreshCurrent() { this.switchView(this._view); },

  scrollToFinalize() {
    hideModal();
    this.switchView('dashboard');
    setTimeout(() => {
      const el = document.getElementById('btn-finalize-day');
      if (el) { el.scrollIntoView({ behavior:'smooth' }); el.classList.add('pulse-once'); }
    }, 400);
  },

  // ============================================================
  // SIDEBAR
  // ============================================================

  _renderSidebar() {
    const u    = AppState.currentUser;
    const nav  = {
      Staff:      [
        { id:'dashboard',   icon:'🏠', label:'Dashboard' },
        { id:'my-tasks',    icon:'✅', label:'My Tasks' },
        { id:'my-reports',  icon:'📈', label:'My Reports' },
      ],
      TeamLeader: [
        { id:'dashboard',    icon:'🏠', label:'Dashboard' },
        { id:'my-tasks',     icon:'✅', label:'My Tasks' },
        { id:'dept-tasks',   icon:'👥', label:'Team Tasks' },
        { id:'weekly-report',icon:'📊', label:'Weekly Report' },
      ],
      Management: [
        { id:'dashboard',    icon:'🏠', label:'Overview' },
        { id:'weekly-report',icon:'📊', label:'Weekly Reports' },
      ],
      Admin: [
        { id:'dashboard',    icon:'🏠', label:'Overview' },
        { id:'all-tasks',    icon:'✅', label:'All Tasks' },
        { id:'employees',    icon:'👥', label:'Employees' },
        { id:'all-reports',  icon:'📊', label:'All Reports' },
        { id:'travel-orders',icon:'✈️', label:'Travel Orders' },
      ],
    };

    const su = document.getElementById('sidebar-user');
    if (su) {
      su.innerHTML = `
        <div class="su-avatar">${getInitials(u.name)}</div>
        <div class="su-info">
          <strong>${escapeHtml(u.name)}</strong>
          ${getRoleBadge(u.role)}
          <small>${escapeHtml(u.department)}</small>
        </div>`;
    }

    const sn = document.getElementById('sidebar-nav');
    if (sn) {
      sn.innerHTML = (nav[u.role] || []).map(l => `
        <button class="nav-item" data-view="${l.id}" onclick="Dashboard.switchView('${l.id}')">
          <span class="nav-icon">${l.icon}</span>
          <span>${l.label}</span>
        </button>`).join('');
    }
  },

  _updateNav(viewId) {
    document.querySelectorAll('.nav-item[data-view]').forEach(b =>
      b.classList.toggle('active', b.dataset.view === viewId));
  },

  // ============================================================
  // ── STAFF DASHBOARD ──
  // ============================================================

  async _staff(view) {
    const user = AppState.currentUser;
    await Tasks.loadForUser(user.name);
    await Reports.loadDailyReports({ employeeName: user.name });
    const today      = getTodayDate();
    const todayTasks = AppState.tasks.filter(t => (t['Date Created']||'').startsWith(today));
    const main       = document.getElementById('main-content');

    switch (view) {

      case 'my-tasks': {
        const all = [...AppState.tasks].sort((a,b)=>new Date(b['Date Created'])-new Date(a['Date Created']));
        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title">
              <h2>My Tasks</h2>
              <p class="page-sub">${all.length} task${all.length!==1?'s':''} total</p>
            </div>
            <button class="btn btn-primary" onclick="Tasks.showCreateForm()">
              <span>＋</span> New Task
            </button>
          </div>
          <div class="filter-bar">
            <button class="filter-pill active" onclick="filterTaskList('all',this)">All <span class="pill-count">${all.length}</span></button>
            <button class="filter-pill" onclick="filterTaskList('Not Started',this)">Not Started</button>
            <button class="filter-pill" onclick="filterTaskList('In Progress',this)">▶ Running</button>
            <button class="filter-pill" onclick="filterTaskList('Paused',this)">⏸ Paused</button>
            <button class="filter-pill" onclick="filterTaskList('Completed',this)">✅ Completed</button>
          </div>
          <div class="task-list" id="task-list-container">
            ${all.length ? all.map(t => Tasks.buildCard(t)).join('') :
              this._emptyTask('No tasks yet. Click "+ New Task" to get started.')}
          </div>`;
        Tasks.restoreRunningTimers();
        break;
      }

      case 'my-reports': {
        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title"><h2>My Reports</h2><p class="page-sub">Your personal work history</p></div>
          </div>
          <div class="two-col-layout">
            <div>
              <h3 class="section-title">📅 This Week</h3>
              ${Reports.buildWeeklySummaryWidget()}
            </div>
            <div>
              ${Reports.buildDailySummaryWidget()}
            </div>
          </div>
          <div class="section-card mt-20">
            <div class="sc-head">
              <h3>Daily Report History</h3>
              <span class="badge bg-slate">${AppState.dailyReports.length} reports</span>
            </div>
            ${Reports.buildDailyReportTable(AppState.dailyReports)}
          </div>`;
        break;
      }

      default: { // dashboard
        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title">
              <h2>Good ${_greeting()}, ${escapeHtml(user.name.split(' ')[0])}! 👋</h2>
              <p class="page-sub">${formatDate(today)} · ${escapeHtml(user.department)}</p>
            </div>
            <button class="btn btn-primary" onclick="Tasks.showCreateForm()">
              <span>＋</span> New Task
            </button>
          </div>
          <div class="dash-layout">
            <div class="dash-main">
              <div class="section-card">
                <div class="sc-head">
                  <h3>Today's Tasks</h3>
                  <div class="sc-head-actions">
                    <span class="badge bg-blue">${todayTasks.length} tasks</span>
                    <button class="btn btn-sm btn-ghost" onclick="Dashboard.switchView('my-tasks')">View All →</button>
                  </div>
                </div>
                <div class="task-list">
                  ${todayTasks.length ? todayTasks.map(t=>Tasks.buildCard(t)).join('') :
                    this._emptyTask('No tasks today. Create your first task to get started.')}
                </div>
              </div>
            </div>
            <div class="dash-side">
              ${Reports.buildDailySummaryWidget()}
              ${Reports.buildWeeklySummaryWidget()}
            </div>
          </div>`;
        Tasks.restoreRunningTimers();
      }
    }
  },

  // ============================================================
  // ── TEAM LEADER DASHBOARD ──
  // ============================================================

  async _tl(view) {
    const tl = AppState.currentUser;
    await Tasks.loadForUser(tl.name);
    await Tasks.loadForDept(tl.department);
    await Reports.loadWeeklyForTL();
    const today    = getTodayDate();
    const weekStart = getWeekStart();
    const main     = document.getElementById('main-content');

    switch (view) {

      case 'my-tasks': {
        const all = [...AppState.tasks].sort((a,b)=>new Date(b['Date Created'])-new Date(a['Date Created']));
        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title"><h2>My Tasks</h2><p class="page-sub">${all.length} tasks</p></div>
            <button class="btn btn-primary" onclick="Tasks.showCreateForm()">＋ New Task</button>
          </div>
          <div class="filter-bar">
            <button class="filter-pill active" onclick="filterTaskList('all',this)">All <span class="pill-count">${all.length}</span></button>
            <button class="filter-pill" onclick="filterTaskList('In Progress',this)">▶ Running</button>
            <button class="filter-pill" onclick="filterTaskList('Paused',this)">⏸ Paused</button>
            <button class="filter-pill" onclick="filterTaskList('Completed',this)">✅ Done</button>
          </div>
          <div class="task-list">
            ${all.length ? all.map(t=>Tasks.buildCard(t)).join('') : this._emptyTask()}
          </div>`;
        Tasks.restoreRunningTimers();
        break;
      }

      case 'dept-tasks': {
        const dept  = AppState.deptTasks || [];
        const byEmp = {};
        dept.forEach(t => {
          const n = t['Employee Name'];
          if (!byEmp[n]) byEmp[n] = [];
          byEmp[n].push(t);
        });
        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title">
              <h2>Team Tasks</h2>
              <p class="page-sub">${escapeHtml(tl.department)} Department · ${dept.length} total tasks</p>
            </div>
          </div>
          ${Object.entries(byEmp).map(([name, tasks]) => {
            const todayT = tasks.filter(t=>(t['Date Created']||'').startsWith(today));
            const running = todayT.filter(t=>t['Status']==='In Progress').length;
            return `
              <div class="member-section">
                <div class="member-section-header">
                  <div class="member-identity">
                    <div class="member-avatar-lg">${getInitials(name)}</div>
                    <div>
                      <strong>${escapeHtml(name)}</strong>
                      <small>${tasks.length} total tasks · ${todayT.length} today</small>
                    </div>
                  </div>
                  <div class="member-badges">
                    ${running > 0 ? `<span class="badge bg-blue">▶ ${running} running</span>` : ''}
                    <span class="badge bg-slate">${todayT.length} today</span>
                  </div>
                </div>
                <div class="task-list nested">
                  ${todayT.length ? todayT.map(t=>Tasks.buildCard(t)).join('') :
                    `<p class="no-tasks-today">No tasks today for this member.</p>`}
                </div>
              </div>`;
          }).join('') || `<div class="empty-state"><span class="empty-icon">👥</span><p>No team tasks found.</p></div>`}`;
        break;
      }

      case 'weekly-report': {
        const ws  = Reports.computeWeekState();
        const all = AppState.weeklyReports || [];
        const past = all.filter(r => r['Week Start'] !== weekStart);

        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title">
              <h2>Weekly Report</h2>
              <p class="page-sub">${escapeHtml(tl.department)} Department</p>
            </div>
            ${!ws.existingWR && ws.deptDR.length > 0 ? `
              <button class="btn btn-primary" onclick="Reports.finalizeWeekly()">
                🚀 Submit Weekly Report
              </button>` : ''}
          </div>

          ${ws.existingWR
            ? `<div class="submitted-banner">
                <span>✅ Submitted</span>
                <span>This week's report has been submitted. ${ws.existingWR['Weekly Report Status'] === 'Late' ? '<strong>Marked as Late.</strong>' : 'Visible to Management.'}</span>
              </div>
              ${Reports.buildWeeklyReportCard(ws.existingWR)}`
            : Reports.buildWeeklyProgressCard(ws)}

          ${past.length > 0 ? `
            <div class="section-card mt-20">
              <div class="sc-head">
                <h3>Past Weekly Reports</h3>
                <span class="badge bg-slate">${past.length} reports</span>
              </div>
              <div class="past-wr-list">
                ${past.sort((a,b)=>new Date(b['Week Start'])-new Date(a['Week Start']))
                      .map(wr => Reports.buildWeeklyReportCard(wr)).join('')}
              </div>
            </div>` : ''}`;
        break;
      }

      default: { // TL dashboard
        const todayTasks = AppState.tasks.filter(t=>(t['Date Created']||'').startsWith(today));
        const deptToday  = (AppState.deptTasks||[]).filter(t=>(t['Date Created']||'').startsWith(today)&&t['Employee Name']!==tl.name);
        const ws         = Reports.computeWeekState();
        const running    = deptToday.filter(t=>t['Status']==='In Progress').length;

        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title">
              <h2>Good ${_greeting()}, ${escapeHtml(tl.name.split(' ')[0])}! 👋</h2>
              <p class="page-sub">${formatDate(today)} · ${escapeHtml(tl.department)} · Team Leader</p>
            </div>
            <button class="btn btn-primary" onclick="Tasks.showCreateForm()">＋ New Task</button>
          </div>

          ${_tlWeeklyStatusBanner(ws)}

          <div class="dash-layout">
            <div class="dash-main">
              <div class="section-card">
                <div class="sc-head">
                  <h3>My Tasks Today</h3>
                  <div class="sc-head-actions">
                    <span class="badge bg-blue">${todayTasks.length}</span>
                    <button class="btn btn-sm btn-ghost" onclick="Dashboard.switchView('my-tasks')">All Tasks →</button>
                  </div>
                </div>
                <div class="task-list">
                  ${todayTasks.length ? todayTasks.map(t=>Tasks.buildCard(t)).join('') : this._emptyTask('No tasks today.')}
                </div>
              </div>
              <div class="section-card mt-16">
                <div class="sc-head">
                  <h3>Team Activity Today</h3>
                  <div class="sc-head-actions">
                    <span class="badge bg-blue">${deptToday.length} tasks</span>
                    ${running > 0 ? `<span class="badge bg-green">▶ ${running} running</span>` : ''}
                    <button class="btn btn-sm btn-ghost" onclick="Dashboard.switchView('dept-tasks')">Full View →</button>
                  </div>
                </div>
                <div class="task-list">
                  ${deptToday.length ? deptToday.slice(0,4).map(t=>Tasks.buildCard(t,true)).join('') + (deptToday.length>4?`<button class="btn btn-sm btn-ghost btn-full mt-8" onclick="Dashboard.switchView('dept-tasks')">View ${deptToday.length-4} more tasks →</button>`:'') :
                    `<div class="empty-state sm"><span class="empty-icon">👥</span><p>No team activity today.</p></div>`}
                </div>
              </div>
            </div>
            <div class="dash-side">
              ${Reports.buildDailySummaryWidget()}
              ${this._tlTeamStatusWidget(ws)}
            </div>
          </div>`;
        Tasks.restoreRunningTimers();
      }
    }
  },

  _tlTeamStatusWidget(ws) {
    const hoursLeft = ws.hoursLeft;
    const isLate    = ws.isPastDeadline;
    return `
      <div class="widget-card">
        <div class="wc-header">
          <div class="wc-icon-wrap ${isLate ? 'red' : 'violet'}"><span>${isLate ? '⏰' : '📊'}</span></div>
          <div>
            <h4>Weekly Report</h4>
            <small>${isLate ? 'Deadline Passed' : hoursLeft <= 24 ? `${hoursLeft}h remaining` : `Due Friday EOD`}</small>
          </div>
        </div>
        <div class="team-stats-row">
          <div class="tsr-item"><span>${Object.keys(ws.memberMap).length}</span><small>Reported</small></div>
          <div class="tsr-item warn"><span>${Object.keys(ws.missing).length}</span><small>Missing</small></div>
          <div class="tsr-item"><span>${ws.deptDR.length}</span><small>Daily Reports</small></div>
        </div>
        ${ws.existingWR
          ? `<div class="wc-status ${ws.existingWR['Weekly Report Status']==='Submitted'?'done':'late'}">
              <span>${ws.existingWR['Weekly Report Status']==='Submitted'?'✅':'⏰'}</span>
              <span>${ws.existingWR['Weekly Report Status']==='Submitted'?'Report submitted on time':'Report submitted late'}</span>
            </div>`
          : `<button class="btn btn-primary btn-sm btn-full mt-8" onclick="Dashboard.switchView('weekly-report')">
              View Weekly Report →
            </button>`}
      </div>`;
  },

  // ============================================================
  // ── MANAGEMENT DASHBOARD ──
  // RULE: Only show Weekly Reports with status = 'Submitted'
  //       (submitted on or before Friday EOD)
  //       Late / Draft / missing → hidden from Management
  // ============================================================

  async _mgmt(view) {
    const main = document.getElementById('main-content');
    await Reports.loadWeeklyReports();
    await Reports.loadDailyReports({ finalized: true });

    // ── CRITICAL FILTER: Only 'Submitted' (on-time) reports ──────
    const visibleWR = (AppState.weeklyReports || []).filter(r =>
      r['Weekly Report Status'] === 'Submitted'
    );

    switch (view) {
      case 'weekly-report': {
        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title">
              <h2>Department Weekly Reports</h2>
              <p class="page-sub">Only on-time submissions are displayed</p>
            </div>
            <span class="badge bg-green">${visibleWR.length} submitted</span>
          </div>
          ${visibleWR.length
            ? visibleWR.sort((a,b)=>new Date(b['Week Start'])-new Date(a['Week Start']))
                       .map(wr => Reports.buildWeeklyReportCard(wr, true)).join('')
            : `<div class="empty-callout">
                <div class="ec-icon">📭</div>
                <h3>No Reports Available</h3>
                <p>No weekly reports have been submitted on time by Team Leaders yet.</p>
                <p class="ec-note">Reports only appear here when Team Leaders submit by Friday end of day.</p>
              </div>`}`;
        break;
      }

      default: { // mgmt overview
        const byDept = {};
        visibleWR.forEach(wr => {
          if (!byDept[wr['Department']]) byDept[wr['Department']] = [];
          byDept[wr['Department']].push(wr);
        });
        const totalHrs  = visibleWR.reduce((s,r)=>s+parseFloat(r['Total Hours']||0),0);
        const deptCount = Object.keys(byDept).length;

        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title">
              <h2>Management Overview</h2>
              <p class="page-sub">${formatDate(getTodayDate())}</p>
            </div>
          </div>
          <div class="mgmt-kpi-row">
            <div class="kpi-card">
              <div class="kpi-icon blue">📊</div>
              <div class="kpi-body">
                <strong>${visibleWR.length}</strong>
                <span>Reports Submitted</span>
              </div>
            </div>
            <div class="kpi-card">
              <div class="kpi-icon green">🏢</div>
              <div class="kpi-body">
                <strong>${deptCount}</strong>
                <span>Active Departments</span>
              </div>
            </div>
            <div class="kpi-card">
              <div class="kpi-icon violet">⏱</div>
              <div class="kpi-body">
                <strong>${totalHrs.toFixed(1)}h</strong>
                <span>Total Hours Logged</span>
              </div>
            </div>
          </div>

          ${deptCount === 0
            ? `<div class="empty-callout">
                <div class="ec-icon">📭</div>
                <h3>No Departments Have Submitted Yet</h3>
                <p>Reports appear here once Team Leaders submit their weekly report by Friday.</p>
              </div>`
            : `<div class="dept-report-grid">
                ${Object.entries(byDept).map(([dept, wrs]) => {
                  const latest  = wrs.sort((a,b)=>new Date(b['Week Start'])-new Date(a['Week Start']))[0];
                  const deptHrs = wrs.reduce((s,r)=>s+parseFloat(r['Total Hours']||0),0);
                  return `<div class="dept-report-card" onclick="Dashboard.switchView('weekly-report')">
                    <div class="drc-top">
                      <div class="drc-icon">${escapeHtml((dept||'?').charAt(0))}</div>
                      <div>
                        <h4>${escapeHtml(dept)}</h4>
                        <small>Latest: ${formatDateShort(latest['Week Start'])} week</small>
                      </div>
                    </div>
                    <div class="drc-stats">
                      <div><span>${wrs.length}</span><small>Reports</small></div>
                      <div><span>${deptHrs.toFixed(1)}h</span><small>Total</small></div>
                      <div><span>${latest['Total Staff']}</span><small>Members</small></div>
                    </div>
                    <div class="drc-footer">
                      <span class="badge bg-green">✅ On Time</span>
                      <span>View Reports →</span>
                    </div>
                  </div>`;
                }).join('')}
              </div>
              <div class="section-card mt-20">
                <div class="sc-head">
                  <h3>All Submitted Reports</h3>
                  <span class="badge bg-slate">${visibleWR.length}</span>
                </div>
                ${visibleWR.map(wr => Reports.buildWeeklyReportCard(wr, true)).join('')}
              </div>`}`;
      }
    }
  },

  // ============================================================
  // ── ADMIN DASHBOARD ──
  // ============================================================

  async _admin(view) {
    const main = document.getElementById('main-content');
    await Tasks.loadAll();
    await Reports.loadDailyReports();
    await Reports.loadWeeklyReports();
    const employees = AppState.employees || [];
    const allTasks  = AppState.allTasks  || [];
    const today     = getTodayDate();

    switch (view) {

      case 'all-tasks': {
        const sorted = [...allTasks].sort((a,b)=>new Date(b['Date Created'])-new Date(a['Date Created']));
        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title"><h2>All Tasks</h2><p class="page-sub">${sorted.length} total across all departments</p></div>
          </div>
          <div class="filter-bar">
            <button class="filter-pill active" onclick="filterTaskList('all',this)">All</button>
            <button class="filter-pill" onclick="filterTaskList('In Progress',this)">▶ Running</button>
            <button class="filter-pill" onclick="filterTaskList('Paused',this)">⏸ Paused</button>
            <button class="filter-pill" onclick="filterTaskList('Completed',this)">✅ Done</button>
            <button class="filter-pill" onclick="filterTaskList('Not Started',this)">⭕ Not Started</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Employee</th><th>Task</th><th>Dept</th><th>Type</th><th>Date</th><th>Status</th><th>Priority</th><th>Mode</th></tr></thead>
              <tbody class="task-list" id="task-list-container">
                ${sorted.map(t=>`<tr class="task-card" data-task-id="${t['Task ID']}">
                  <td><span class="mini-avatar">${getInitials(t['Employee Name'])}</span> ${escapeHtml(t['Employee Name'])}</td>
                  <td class="td-taskname">${escapeHtml(t['Task Name'])}</td>
                  <td>${escapeHtml(t['Department'])}</td>
                  <td>${escapeHtml(t['Task Type'])}</td>
                  <td>${formatDateShort(t['Date Created'])}</td>
                  <td>${getStatusBadge(t['Status'])}</td>
                  <td>${getPriorityBadge(t['Priority'])}</td>
                  <td>${getWorkModeBadge(t['Work Mode'])}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
        break;
      }

      case 'employees': {
        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title"><h2>Employees</h2><p class="page-sub">${employees.length} active members</p></div>
          </div>
          <div class="employee-grid">
            ${employees.map(e => {
              const role   = mapPositionToRole(e['Position']);
              const empT   = allTasks.filter(t=>t['Employee Name']===e['Employee Name']&&(t['Date Created']||'').startsWith(today));
              const active = empT.filter(t=>t['Status']==='In Progress').length;
              return `<div class="emp-card">
                <div class="emp-card-top">
                  <div class="emp-avatar">${getInitials(e['Employee Name'])}</div>
                  <div>
                    <h4>${escapeHtml(e['Employee Name'])}</h4>
                    <small>${escapeHtml(e['Position'])}</small>
                  </div>
                </div>
                <div class="emp-card-meta">
                  <span class="badge bg-slate">${escapeHtml(e['Department'])}</span>
                  ${getRoleBadge(role)}
                </div>
                <div class="emp-card-footer">
                  <span>${escapeHtml(e['Email'])}</span>
                  <span>${active > 0 ? `<span class="badge bg-blue">▶ ${active} active</span>` : `${empT.length} tasks today`}</span>
                </div>
              </div>`;
            }).join('')}
          </div>`;
        break;
      }

      case 'all-reports': {
        const allDR = AppState.dailyReports  || [];
        const allWR = AppState.weeklyReports || [];
        // Admin sees ALL weekly reports including Late
        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title"><h2>All Reports</h2><p class="page-sub">Full visibility — all statuses</p></div>
          </div>
          <div class="section-card">
            <div class="sc-head">
              <h3>Daily Reports</h3>
              <span class="badge bg-slate">${allDR.length}</span>
            </div>
            ${Reports.buildDailyReportTable(allDR)}
          </div>
          <div class="section-card mt-20">
            <div class="sc-head">
              <h3>Weekly Reports</h3>
              <span class="badge bg-slate">${allWR.length} total</span>
              <div class="sc-head-actions">
                <span class="badge bg-green">${allWR.filter(r=>r['Weekly Report Status']==='Submitted').length} submitted</span>
                <span class="badge bg-red">${allWR.filter(r=>r['Weekly Report Status']==='Late').length} late</span>
              </div>
            </div>
            ${allWR.length
              ? allWR.sort((a,b)=>new Date(b['Week Start'])-new Date(a['Week Start']))
                     .map(wr=>Reports.buildWeeklyReportCard(wr, false)).join('')
              : '<p class="text-muted">No weekly reports yet.</p>'}
          </div>`;
        break;
      }

      case 'travel-orders': {
        const orders = await API.getTravelOrders();
        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title"><h2>Travel Orders</h2><p class="page-sub">${orders.length} total</p></div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Employee</th><th>Destination</th><th>Date</th><th>Purpose</th><th>Budget</th><th>TL Approval</th><th>Finance</th><th>Status</th></tr></thead>
              <tbody>
                ${orders.map(o=>`<tr>
                  <td><span class="mini-avatar">${getInitials(o['Employee Name'])}</span> ${escapeHtml(o['Employee Name'])}</td>
                  <td>${escapeHtml(o['Destination'])}</td>
                  <td>${formatDateShort(o['Date'])}</td>
                  <td class="td-summary">${escapeHtml(o['Purpose'])}</td>
                  <td>${o['Budget']?`₱${Number(o['Budget']).toLocaleString()}`:'—'}</td>
                  <td>${getStatusBadge(o['Team Leader Approval']||'Pending')}</td>
                  <td>${getStatusBadge(o['Finance Approval']||'Pending')}</td>
                  <td>${getStatusBadge(o['Status']||'Pending')}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
        break;
      }

      default: { // admin overview
        const running  = allTasks.filter(t=>t['Status']==='In Progress').length;
        const todayT   = allTasks.filter(t=>(t['Date Created']||'').startsWith(today)).length;
        const allWR    = AppState.weeklyReports || [];
        const lateWR   = allWR.filter(r=>r['Weekly Report Status']==='Late').length;
        const submWR   = allWR.filter(r=>r['Weekly Report Status']==='Submitted').length;

        main.innerHTML = `
          <div class="page-header">
            <div class="ph-title"><h2>System Overview</h2><p class="page-sub">Full admin access · All data visible</p></div>
            <span class="badge bg-red">System Admin</span>
          </div>
          <div class="admin-kpi-grid">
            <div class="akpi blue"><div class="akpi-icon">👥</div><strong>${employees.length}</strong><small>Employees</small></div>
            <div class="akpi green"><div class="akpi-icon">✅</div><strong>${allTasks.length}</strong><small>Total Tasks</small></div>
            <div class="akpi orange"><div class="akpi-icon">▶</div><strong>${running}</strong><small>Running Now</small></div>
            <div class="akpi purple"><div class="akpi-icon">📋</div><strong>${todayT}</strong><small>Tasks Today</small></div>
            <div class="akpi teal"><div class="akpi-icon">📈</div><strong>${(AppState.dailyReports||[]).length}</strong><small>Daily Reports</small></div>
            <div class="akpi green"><div class="akpi-icon">📊</div><strong>${submWR}</strong><small>Submitted WR</small></div>
            <div class="akpi red"><div class="akpi-icon">⏰</div><strong>${lateWR}</strong><small>Late WR</small></div>
            <div class="akpi slate"><div class="akpi-icon">✈️</div><strong>—</strong><small>Travel Orders</small></div>
          </div>
          <div class="admin-two-col">
            <div class="section-card">
              <div class="sc-head">
                <h3>Employee Status Today</h3>
                <button class="btn btn-sm btn-ghost" onclick="Dashboard.switchView('employees')">View All →</button>
              </div>
              <div class="emp-status-list">
                ${employees.slice(0, 8).map(e => {
                  const empT = allTasks.filter(t=>t['Employee Name']===e['Employee Name']&&(t['Date Created']||'').startsWith(today));
                  const act  = empT.filter(t=>t['Status']==='In Progress').length;
                  return `<div class="emp-status-row">
                    <div class="mini-avatar">${getInitials(e['Employee Name'])}</div>
                    <div class="esr-info">
                      <strong>${escapeHtml(e['Employee Name'])}</strong>
                      <small>${escapeHtml(e['Department'])}</small>
                    </div>
                    <div>${act > 0
                      ? `<span class="status-dot active"></span><span class="esr-status active">${act} active task${act>1?'s':''}</span>`
                      : empT.length > 0
                        ? `<span class="status-dot idle"></span><span class="esr-status">Idle</span>`
                        : `<span class="status-dot none"></span><span class="esr-status muted">No tasks</span>`}
                    </div>
                  </div>`;
                }).join('')}
                ${employees.length > 8 ? `<p class="text-muted" style="padding:8px;font-size:.8rem">+ ${employees.length-8} more employees</p>` : ''}
              </div>
            </div>
            <div class="section-card">
              <div class="sc-head">
                <h3>Weekly Report Status</h3>
                <button class="btn btn-sm btn-ghost" onclick="Dashboard.switchView('all-reports')">View All →</button>
              </div>
              ${allWR.length === 0
                ? `<div class="empty-state sm"><span class="empty-icon">📊</span><p>No weekly reports yet.</p></div>`
                : allWR.slice(0, 4).map(wr => `
                    <div class="wr-mini-row">
                      <div class="wrmr-left">
                        <strong>${escapeHtml(wr['Department'])}</strong>
                        <small>${formatDateShort(wr['Week Start'])} week · by ${escapeHtml(wr['Team Leader'])}</small>
                      </div>
                      ${Reports._wrStatusBadge(wr['Weekly Report Status'])}
                    </div>`).join('')}
            </div>
          </div>`;
        Tasks.restoreRunningTimers();
      }
    }
  },

  // ---- Shared helpers ----------------------------------------
  _emptyTask(msg = 'No tasks found.') {
    return `<div class="empty-state sm"><span class="empty-icon">✅</span><p>${msg}</p></div>`;
  },
};

// ---- Module-level helpers ----------------------------------

function _greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function _tlWeeklyStatusBanner(ws) {
  if (!ws) return '';
  if (ws.existingWR) {
    const onTime = ws.existingWR['Weekly Report Status'] === 'Submitted';
    return `<div class="tl-banner ${onTime ? 'banner-ok' : 'banner-late'}">
      <span>${onTime ? '✅' : '⏰'}</span>
      <div>
        <strong>${onTime ? 'Weekly report submitted on time.' : 'Weekly report was submitted late.'}</strong>
        <span>${onTime ? 'Visible to Management.' : 'Management cannot see this report.'}</span>
      </div>
    </div>`;
  }
  if (ws.isPastDeadline) {
    return `<div class="tl-banner banner-late">
      <span>⏰</span>
      <div>
        <strong>Deadline passed — Friday EOD has ended.</strong>
        <span>Submitting now will be marked <strong>Late</strong> and hidden from Management.</span>
      </div>
      <button class="btn btn-sm btn-danger" onclick="Dashboard.switchView('weekly-report')">Submit (Late)</button>
    </div>`;
  }
  if (ws.hoursLeft <= 8) {
    return `<div class="tl-banner banner-urgent">
      <span>⚡</span>
      <div>
        <strong>Weekly report due in ${ws.hoursLeft}h!</strong>
        <span>Submit before Friday EOD to be visible to Management.</span>
      </div>
      <button class="btn btn-sm btn-primary" onclick="Dashboard.switchView('weekly-report')">Submit Now →</button>
    </div>`;
  }
  return '';
}

// Global task list filter
function filterTaskList(status, btn) {
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('[data-task-id]').forEach(c => {
    const id = c.dataset.taskId;
    const t  = (AppState.tasks||[]).find(x=>x['Task ID']===id)
            || (AppState.deptTasks||[]).find(x=>x['Task ID']===id)
            || (AppState.allTasks||[]).find(x=>x['Task ID']===id);
    if (!t) return;
    c.style.display = (!status || status==='all' || t['Status']===status) ? '' : 'none';
  });
}
