// ============================================================
// auth.js — DTIM v2
// Email-only authentication against EMPLOYEE LIST in Google Sheets.
// No password required — access is granted by email match.
// ============================================================

const Auth = {

  SESSION_KEY: 'dtim_v2_session',

  // ── Email Login ────────────────────────────────────────────
  // 1. Trim + lowercase email
  // 2. Query EMPLOYEE LIST via API
  // 3. If match found → store session, return user object
  // 4. If no match → return null (deny access)

  async loginWithEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) return null;

    const employee = await API.getEmployeeByEmail(normalized);
    if (!employee) return null;

    // Map Position → internal role
    const role = mapPositionToRole(employee['Position']);

    const user = {
      id:          employee['Employee ID'],
      name:        employee['Employee Name'],
      email:       employee['Email'],
      department:  employee['Department'],
      position:    employee['Position'],
      reportsTo:   employee['Assigned Team Leader / Reports To'],
      role,        // 'Staff' | 'TeamLeader' | 'Management' | 'Admin'
    };

    // Persist session
    AppState.currentUser = user;
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
    return user;
  },

  // ── Restore session from localStorage ────────────────────

  restoreSession() {
    try {
      const saved = localStorage.getItem(this.SESSION_KEY);
      if (saved) {
        AppState.currentUser = JSON.parse(saved);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  },

  // ── Logout ───────────────────────────────────────────────

  logout() {
    // Check for unfinalized day
    if (this._hasUnfinalizedDay()) {
      showModal('⚠️ Hindi Pa Naka-Finalize', `
        <div class="warning-banner">
          <p class="warn-title">Hindi ka pa nag-report ng Time in Motion mo ngayon.</p>
          <p>Mayroon kang mga task na hindi pa nafi-finalize ngayon. Mangyaring i-finalize muna ang iyong day bago mag-logout.</p>
        </div>
      `, [
        { label: 'Bumalik at Mag-Finalize', type: 'primary', callback: () => { hideModal(); Dashboard.switchView('dashboard'); } },
        { label: 'Mag-Logout Kahit Na',     type: 'danger',  callback: () => this._doLogout() },
      ]);
      return;
    }
    this._doLogout();
  },

  _doLogout() {
    // Stop all timers
    Object.values(AppState.activeTimers).forEach(id => clearInterval(id));
    AppState.activeTimers  = {};
    AppState.taskTimerData = {};
    AppState.tasks         = [];
    AppState.currentUser   = null;
    localStorage.removeItem(this.SESSION_KEY);
    App.showView('login');
    document.getElementById('login-email').value = '';
    document.getElementById('login-error').textContent = '';
    showToast('Successfully logged out.', 'info');
  },

  _hasUnfinalizedDay() {
    if (!AppState.currentUser) return false;
    const uid   = AppState.currentUser.name;
    const today = getTodayDate();
    const active = AppState.tasks.filter(t =>
      t['Employee Name'] === uid &&
      (t['Date Created'] || '').startsWith(today) &&
      t['Status'] !== 'Not Started'
    );
    if (active.length === 0) return false;
    const report = (AppState.dailyReports || []).find(r =>
      r['Employee Name'] === uid &&
      (r['Report Date']  || '').startsWith(today) &&
      r['Daily Report Status'] === 'Finalized'
    );
    return !report;
  },

  // ── Permissions ──────────────────────────────────────────

  PERMS: {
    Staff:      ['create_task', 'manage_own_tasks', 'finalize_day', 'view_own'],
    TeamLeader: ['create_task', 'manage_own_tasks', 'finalize_day', 'view_own',
                 'view_dept', 'finalize_weekly', 'export_pdf'],
    Management: ['view_finalized_weekly', 'export_pdf'],
    Admin:      ['*'],
  },

  can(action) {
    if (!AppState.currentUser) return false;
    const perms = this.PERMS[AppState.currentUser.role] || [];
    return perms.includes('*') || perms.includes(action);
  },

  role() { return AppState.currentUser?.role; },

  isStaff()      { return this.role() === 'Staff'; },
  isTeamLeader() { return this.role() === 'TeamLeader'; },
  isManagement() { return this.role() === 'Management'; },
  isAdmin()      { return this.role() === 'Admin'; },
  canCreateTask(){ return this.isStaff() || this.isTeamLeader() || this.isAdmin(); },
};
