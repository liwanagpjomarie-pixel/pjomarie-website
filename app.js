// ============================================================
// app.js — DTIM v2 | Main Application Controller
// ============================================================

// ── Global Application State ─────────────────────────────────
const AppState = {
  currentUser:   null,
  tasks:         [],     // current user's tasks
  deptTasks:     [],     // department tasks (Team Leader)
  allTasks:      [],     // all tasks (Admin)
  dailyReports:  [],
  weeklyReports: [],
  employees:     [],     // all employees
  dropdowns:     {},     // dropdown values from DROPDOWN sheet
  activeTimers:  {},     // taskId → intervalId
  taskTimerData: {},     // taskId → { status, accumulatedMs, sessionStartMs }
};

// ── App Controller ───────────────────────────────────────────
const App = {

  async init() {
    console.log('[DTIM v2] Starting...');
    this._bindModalClose();
    this._bindKeyboard();

    // Load shared resources with error tolerance
    try {
      AppState.dropdowns = await API.getDropdowns();
    } catch (e) {
      console.warn('[DTIM] Could not load dropdowns, using fallback:', e);
      AppState.dropdowns = FALLBACK_DD;
    }

    try {
      AppState.employees = await API.getEmployees();
    } catch (e) {
      console.warn('[DTIM] Could not load employees:', e);
      AppState.employees = [];
    }

    // Try restore session
    if (Auth.restoreSession()) {
      console.log('[DTIM] Session restored:', AppState.currentUser.name);
      await this._enterApp();
    } else {
      this.showView('login');
    }
  },

  async _enterApp() {
    this.showView('app');
    Dashboard._renderSidebar(AppState.currentUser.role);
    await Dashboard.renderForRole();
  },

  // ── View Switcher ─────────────────────────────────────────

  showView(viewId) {
    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('active', v.id === `view-${viewId}`);
    });
  },

  // ── Email Login ───────────────────────────────────────────

  async handleLogin() {
    const email  = document.getElementById('login-email')?.value || '';
    const errEl  = document.getElementById('login-error');
    const btn    = document.getElementById('btn-login');

    if (!email.trim()) {
      if (errEl) errEl.textContent = 'Please enter your work email.';
      return;
    }

    if (!email.includes('@')) {
      if (errEl) errEl.textContent = 'Please enter a valid email address.';
      return;
    }

    if (btn) { btn.textContent = 'Checking...'; btn.disabled = true; }
    if (errEl) errEl.textContent = '';

    try {
      const user = await Auth.loginWithEmail(email);

      if (!user) {
        if (errEl) errEl.textContent = 'Email not found in the employee list. Please contact your admin.';
        if (btn) { btn.textContent = 'Sign In'; btn.disabled = false; }
        return;
      }

      showToast(`Welcome, ${user.name}! 👋`, 'success');
      await this._enterApp();

    } catch (err) {
      console.error('[DTIM] Login error:', err);
      if (errEl) errEl.textContent = 'Connection error. Please check your internet and try again.';
      if (btn) { btn.textContent = 'Sign In'; btn.disabled = false; }
    }
  },

  // ── Modal close on overlay click ─────────────────────────
  _bindModalClose() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) hideModal(); });
  },

  _bindKeyboard() {
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideModal(); });
  },
};

// ── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
