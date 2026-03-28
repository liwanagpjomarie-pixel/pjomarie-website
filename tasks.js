// ============================================================
// tasks.js — DTIM v2.3
// Field Work overhaul:
//  • Field tasks have NO start/pause/resume/end timer controls
//  • Field tasks are filed in advance with a Scheduled Date
//  • Field tasks appear in dashboard on their Scheduled Date
//  • Proof Link submission → auto-completes the task
//  • Status: 'Pending Proof' (initial) → 'Completed' (once proof uploaded)
//
// Finalize Day button:
//  • Enabled  → at least 1 In Progress or Paused task today
//  • Disabled → all tasks are Completed or only Not Started remain
// ============================================================

const Tasks = {

  // ---- Load ------------------------------------------------
  async loadForUser(employeeName) {
    AppState.tasks = await API.getTasks({ employeeName });
    Tasks.restoreRunningTimers();
  },
  async loadForDept(department) {
    AppState.deptTasks = await API.getTasks({ department });
  },
  async loadAll() {
    AppState.allTasks = await API.getTasks();
  },

  // ---- Regular Task: Start ---------------------------------
  async startTask(taskId) {
    const task = _findTask(taskId);
    if (!task || isFieldTask(task)) return;
    if (task['Status'] !== 'Not Started' && task['Status'] !== 'Paused') return;

    const now    = Date.now();
    const isNew  = task['Status'] === 'Not Started';
    const tdOld  = AppState.taskTimerData[taskId] || { accumulatedMs: 0 };
    const tdata  = { status:'running', accumulatedMs: tdOld.accumulatedMs||0, sessionStartMs: now };
    AppState.taskTimerData[taskId] = tdata;
    saveTimerState(taskId, tdata);

    task['Status']    = 'In Progress';
    task['Is Active'] = 'true';
    if (isNew) task['Date Started'] = nowReadable();

    try {
      await Promise.all([
        API.updateTask(taskId, {
          'Status': 'In Progress', 'Is Active': 'true',
          ...(isNew ? { 'Date Started': nowReadable() } : {}),
        }),
        API.logSession({ taskId, employeeName: AppState.currentUser.name, actionType: 'Start' }),
      ]);
    } catch (e) { console.error('startTask error:', e); }

    this._startInterval(taskId);
    showToast(`${isNew ? 'Task started' : 'Task resumed'}: ${task['Task Name']}`, 'success');
    Dashboard.refreshCurrent();
  },

  // ---- Regular Task: Pause ---------------------------------
  async pauseTask(taskId) {
    const task = _findTask(taskId);
    if (!task || isFieldTask(task) || task['Status'] !== 'In Progress') return;

    const dd = AppState.dropdowns || {};
    showModal('⏸ Dahilan ng Pause', `
      <div class="pause-form">
        <p>Bakit mo ina-pause ang task na ito?</p>
        <div class="form-group">
          <label>Pause Reason <span class="req">*</span></label>
          <select id="pause-reason-select" class="form-control">
            <option value="">— Pumili ng dahilan —</option>
            ${buildOptions(dd.pauseReasons || FALLBACK_DD.pauseReasons)}
          </select>
        </div>
        <div class="form-group">
          <label>Additional Notes (optional)</label>
          <textarea id="pause-notes" class="form-control" rows="2"
            placeholder="Dagdag na detalye..."></textarea>
        </div>
      </div>
    `, [
      { label: 'Cancel', type: 'ghost' },
      { label: 'Confirm Pause', type: 'warning', close: false,
        callback: () => this._doPause(taskId) },
    ]);
  },

  async _doPause(taskId) {
    const reason = getFormValue('pause-reason-select');
    const notes  = getFormValue('pause-notes');
    if (!reason) { showToast('Pumili ng dahilan ng pause.', 'error'); return; }
    hideModal();

    const task   = _findTask(taskId);
    if (!task) return;
    const tdata  = AppState.taskTimerData[taskId];
    const now    = Date.now();
    const elapsed= now - (tdata?.sessionStartMs || now);
    const accum  = (tdata?.accumulatedMs || 0) + elapsed;

    AppState.taskTimerData[taskId] = { status: 'paused', accumulatedMs: accum, sessionStartMs: null };
    saveTimerState(taskId, AppState.taskTimerData[taskId]);
    task['Status'] = 'Paused';
    this._clearInterval(taskId);

    try {
      await Promise.all([
        API.updateTask(taskId, { 'Status': 'Paused' }),
        API.logSession({ taskId, employeeName: AppState.currentUser.name,
          actionType: 'Pause', pauseReason: reason, notes: notes || null }),
      ]);
    } catch (e) { console.error('pauseTask error:', e); }

    showToast(`Task paused: ${task['Task Name']} (${reason})`, 'warning');
    Dashboard.refreshCurrent();
  },

  // ---- Regular Task: End -----------------------------------
  async endTask(taskId) {
    const task = _findTask(taskId);
    if (!task || isFieldTask(task)) return;
    if (task['Status'] === 'Completed' || task['Status'] === 'Not Started') return;

    confirmAction(
      `I-end ang task na "<strong>${escapeHtml(task['Task Name'])}</strong>"? Hindi na ito mababago.`,
      () => this._doEnd(taskId), 'End Task', 'danger'
    );
  },

  async _doEnd(taskId) {
    const task  = _findTask(taskId);
    if (!task) return;
    const tdata = AppState.taskTimerData[taskId] || { accumulatedMs: 0 };
    const now   = Date.now();
    let   accum = tdata.accumulatedMs || 0;
    if (task['Status'] === 'In Progress' && tdata.sessionStartMs) {
      accum += now - tdata.sessionStartMs;
    }
    AppState.taskTimerData[taskId] = { status: 'ended', accumulatedMs: accum, sessionStartMs: null };
    saveTimerState(taskId, AppState.taskTimerData[taskId]);
    this._clearInterval(taskId);
    task['Status'] = 'Completed';

    try {
      await Promise.all([
        API.updateTask(taskId, {
          'Status': 'Completed', 'Is Active': 'false',
          'Date Completed': nowReadable(),
        }),
        API.logSession({ taskId, employeeName: AppState.currentUser.name, actionType: 'End' }),
      ]);
    } catch (e) { console.error('endTask error:', e); }

    showToast(`Task completed: ${task['Task Name']}`, 'success');
    Dashboard.refreshCurrent();
  },

  // ============================================================
  // FIELD WORK: SUBMIT PROOF
  // When employee uploads proof → task auto-completes
  // ============================================================

  async submitFieldProof(taskId) {
    const task = _findTask(taskId);
    if (!task || !isFieldTask(task)) return;

    showModal('📎 Submit Field Work Proof', `
      <div class="field-proof-form">
        <div class="fpf-info">
          <div class="fpf-icon">📋</div>
          <div>
            <strong>${escapeHtml(task['Task Name'])}</strong>
            <p>${escapeHtml(task['Event / Shoot Details'] || '')} ${task['Location / Venue'] && task['Location / Venue'] !== 'null' ? '· ' + escapeHtml(task['Location / Venue']) : ''}</p>
          </div>
        </div>
        <div class="fpf-rule">
          <span>📌</span>
          <span>Submitting the proof link will automatically mark this task as <strong>Completed</strong>.</span>
        </div>
        <div class="form-group">
          <label>Proof Link / Document URL <span class="req">*</span></label>
          <input id="f-proof-link" type="url" class="form-control"
            placeholder="https://drive.google.com/... or https://..."
            value="${task['Proof Link'] !== 'null' ? escapeHtml(task['Proof Link']||'') : ''}">
          <small style="color:var(--text-muted);margin-top:4px;display:block">
            Enter the Google Drive link, SharePoint link, or any URL that serves as proof.
          </small>
        </div>
      </div>
    `, [
      { label: 'Cancel', type: 'ghost' },
      { label: '✅ Submit Proof & Complete Task', type: 'primary', close: false,
        callback: () => this._doSubmitProof(taskId) },
    ]);
  },

  async _doSubmitProof(taskId) {
    const proofLink = getFormValue('f-proof-link');
    if (!proofLink) { showToast('Mangyaring ilagay ang proof link.', 'error'); return; }

    // Basic URL validation
    try { new URL(proofLink); }
    catch { showToast('Invalid URL. Please enter a valid link (https://...).', 'error'); return; }

    hideModal();
    showToast('Submitting proof...', 'info', 1500);

    const task = _findTask(taskId);
    if (!task) return;

    try {
      await API.submitFieldProof(taskId, proofLink, AppState.currentUser.name);

      // Update local state
      task['Proof Link']    = proofLink;
      task['Status']        = 'Completed';
      task['Is Active']     = 'false';
      task['Date Completed']= nowReadable();

      showToast(`Field work completed: ${task['Task Name']}`, 'success');
      Dashboard.refreshCurrent();
    } catch (err) {
      showToast('Error submitting proof. Please try again.', 'error');
      console.error(err);
    }
  },

  // ---- Timer Intervals ------------------------------------
  _startInterval(taskId) {
    this._clearInterval(taskId);
    AppState.activeTimers[taskId] = setInterval(() => {
      const tdata = AppState.taskTimerData[taskId];
      if (!tdata || tdata.status !== 'running') return;
      const el = document.querySelector(`[data-timer="${taskId}"]`);
      if (el) el.textContent = formatDuration(getElapsedMs(tdata));
    }, 1000);
  },
  _clearInterval(taskId) {
    if (AppState.activeTimers[taskId]) {
      clearInterval(AppState.activeTimers[taskId]);
      delete AppState.activeTimers[taskId];
    }
  },
  restoreRunningTimers() {
    const saved = loadAllTimerStates();
    AppState.taskTimerData = { ...AppState.taskTimerData, ...saved };
    Object.entries(saved).forEach(([tid, td]) => {
      if (td.status === 'running') this._startInterval(tid);
    });
  },
  getElapsed(taskId) {
    const td = AppState.taskTimerData[taskId];
    return td ? getElapsedMs(td) : 0;
  },

  // ============================================================
  // CREATE TASK FORM
  // Regular vs Field Work — different form sections
  // ============================================================

  showCreateForm() {
    const dd   = AppState.dropdowns || FALLBACK_DD;
    const user = AppState.currentUser;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split('T')[0];

    showModal('Gumawa ng Bagong Task', `
      <div class="form-grid">
        <div class="form-group fg-full">
          <label>Task Name <span class="req">*</span></label>
          <input id="f-taskName" type="text" class="form-control"
            placeholder="e.g. Prepare monthly report">
        </div>
        <div class="form-group fg-full">
          <label>Task Description <span class="req">*</span></label>
          <textarea id="f-taskDesc" class="form-control" rows="2"
            placeholder="Ilarawan ang task..."></textarea>
        </div>
        <div class="form-group">
          <label>Department <span class="req">*</span></label>
          <select id="f-dept" class="form-control">
            <option value="">— Pumili —</option>
            ${buildOptions(dd.departments, user.department)}
          </select>
        </div>
        <div class="form-group">
          <label>Task Type <span class="req">*</span></label>
          <select id="f-taskType" class="form-control">
            <option value="">— Pumili —</option>
            ${buildOptions(dd.taskTypes)}
          </select>
        </div>
        <div class="form-group">
          <label>Priority <span class="req">*</span></label>
          <select id="f-priority" class="form-control">
            <option value="">— Pumili —</option>
            ${buildOptions(dd.priorities)}
          </select>
        </div>
        <div class="form-group">
          <label>Work Mode <span class="req">*</span></label>
          <select id="f-workMode" class="form-control"
            onchange="Tasks._onWorkModeChange(this.value)">
            <option value="">— Pumili —</option>
            ${buildOptions(dd.workModes)}
          </select>
        </div>
      </div>

      <!-- Regular task extra (visible for Office/Remote) -->
      <div id="regular-section" style="display:none" class="section-info-box">
        <span>💼</span>
        <span>Office/Remote tasks use a timer. Click <strong>Start</strong> when ready to begin.</span>
      </div>

      <!-- Field work section -->
      <div id="fieldwork-section" style="display:none" class="fieldwork-block">
        <div class="fw-header"><span>🗺️ Field Work Details</span></div>
        <div class="field-work-notice">
          <span>📌</span>
          <div>
            <strong>No running timer for field work.</strong>
            Field work is completed by submitting a proof document after the event.
          </div>
        </div>
        <div class="form-grid">
          <div class="form-group fg-full">
            <label>Scheduled Field Date <span class="req">*</span></label>
            <input id="f-scheduledDate" type="date" class="form-control"
              value="${tomorrowISO}" min="${tomorrowISO}">
            <small style="color:var(--text-muted);margin-top:4px;display:block">
              The date the field work / event will happen. This task will appear in your dashboard on that date.
            </small>
          </div>
          <div class="form-group fg-full">
            <label>Location / Venue <span class="req">*</span></label>
            <input id="f-location" type="text" class="form-control"
              placeholder="e.g. SMX Convention Center, Manila">
          </div>
          <div class="form-group fg-full">
            <label>Event / Shoot Details <span class="req">*</span></label>
            <textarea id="f-eventDetails" class="form-control" rows="2"
              placeholder="Ilarawan ang event o shoot..."></textarea>
          </div>
          <div class="fg-divider fg-full"><span>✈️ Travel Order (optional)</span></div>
          <div class="form-group">
            <label>Destination</label>
            <input id="f-to-dest" type="text" class="form-control" placeholder="Destination">
          </div>
          <div class="form-group">
            <label>Purpose</label>
            <input id="f-to-purpose" type="text" class="form-control"
              placeholder="Layunin ng travel">
          </div>
          <div class="form-group">
            <label>Budget (PHP)</label>
            <input id="f-to-budget" type="number" class="form-control"
              placeholder="0.00" min="0">
          </div>
          <div class="form-group">
            <label>Funding Source</label>
            <select id="f-to-funding" class="form-control">
              <option value="">— Pumili —</option>
              <option>Company Budget</option>
              <option>Project Fund</option>
              <option>Client Reimbursement</option>
              <option>Petty Cash</option>
            </select>
          </div>
        </div>
      </div>
    `, [
      { label: 'Cancel', type: 'ghost' },
      { label: '+ Create Task', type: 'primary', close: false,
        callback: () => this._submitCreate() },
    ]);
  },

  _onWorkModeChange(mode) {
    toggleEl('regular-section',  mode === 'Office' || mode === 'Remote');
    toggleEl('fieldwork-section', mode === 'Field');
  },

  async _submitCreate() {
    const taskName   = getFormValue('f-taskName');
    const taskDesc   = getFormValue('f-taskDesc');
    const department = getFormValue('f-dept');
    const taskType   = getFormValue('f-taskType');
    const priority   = getFormValue('f-priority');
    const workMode   = getFormValue('f-workMode');

    if (!taskName || !taskDesc || !department || !taskType || !priority || !workMode) {
      showToast('Punan ang lahat ng required fields (*).', 'error'); return;
    }

    const taskId = generateId('TASK');
    const data   = {
      taskId, workMode,
      employeeName:    AppState.currentUser.name,
      taskName,
      taskDescription: taskDesc,
      department,
      taskType,
      priority,
    };

    if (workMode === 'Field') {
      const scheduledDateISO = getFormValue('f-scheduledDate');
      const location         = getFormValue('f-location');
      const eventDetails     = getFormValue('f-eventDetails');
      if (!scheduledDateISO || !location || !eventDetails) {
        showToast('Punan ang lahat ng Field Work required fields (*).', 'error'); return;
      }
      data.scheduledFieldDate = dateReadable(scheduledDateISO);
      data.location           = location;
      data.eventDetails       = eventDetails;

      // Travel order (optional for field work)
      const destination = getFormValue('f-to-dest');
      const purpose     = getFormValue('f-to-purpose');
      if (destination && purpose) {
        data._travelOrder = {
          destination, purpose,
          budget:        getFormValue('f-to-budget') || null,
          fundingSource: getFormValue('f-to-funding') || null,
          date:          data.scheduledFieldDate,
        };
      }
    }

    hideModal();
    showToast('Ginagawa ang task...', 'info', 1500);

    try {
      await API.createTask(data);

      if (data._travelOrder) {
        await API.createTravelOrder({
          ...data._travelOrder,
          employeeName: AppState.currentUser.name,
          position:     AppState.currentUser.position,
          department:   AppState.currentUser.department,
        });
        showToast('Travel Order created (Pending Approval).', 'info');
      }

      // Add to local state
      const isField = workMode === 'Field';
      AppState.tasks.unshift({
        'Task ID':              taskId,
        'Employee Name':        data.employeeName,
        'Task Name':            data.taskName,
        'Task Description':     data.taskDescription,
        'Department':           data.department,
        'Task Type':            data.taskType,
        'Status':               isField ? 'Pending Proof' : 'Not Started',
        'Priority':             data.priority,
        'Date Created':         todayReadable(),
        // Field: store scheduled date in Date Started
        'Date Started':         isField ? (data.scheduledFieldDate || todayReadable()) : 'null',
        'Date Completed':       'null',
        'Latest Update':        nowReadable(),
        'Is Active':            'true',
        'Work Mode':            workMode,
        'Event / Shoot Details':data.eventDetails   || 'null',
        'Location / Venue':     data.location       || 'null',
        'Proof Link':           'null',
        'Daily Accomplishment': 'null',
        'Blockers/Issue':       'null',
        'Next Step':            'null',
      });

      showToast(`Task created: ${data.taskName}`, 'success');
      Dashboard.refreshCurrent();
    } catch (err) {
      showToast('Error creating task. Please try again.', 'error');
      console.error(err);
    }
  },

  // ============================================================
  // TASK CARD HTML
  // Regular tasks: show timer + Start/Pause/End buttons
  // Field tasks:   show field info + Submit Proof button (no timer)
  // ============================================================

  buildCard(task, showEmp = false) {
    const taskId  = task['Task ID'];
    const status  = task['Status'];
    const canAct  = (Auth.canCreateTask() && AppState.currentUser.name === task['Employee Name'])
                    || Auth.isAdmin();

    if (isFieldTask(task)) {
      return this._buildFieldCard(task, showEmp, canAct);
    }
    return this._buildRegularCard(task, showEmp, canAct);
  },

  _buildRegularCard(task, showEmp, canAct) {
    const taskId   = task['Task ID'];
    const status   = task['Status'];
    const elapsed  = this.getElapsed(taskId);
    const isRunning = status === 'In Progress';

    return `
      <div class="task-card ${isRunning ? 'task-running' : ''}" data-task-id="${taskId}">
        <div class="tc-top">
          <div class="tc-info">
            ${showEmp ? `<span class="tc-emp">${escapeHtml(task['Employee Name'])}</span>` : ''}
            <h4 class="tc-name">${escapeHtml(task['Task Name'])}</h4>
            <p class="tc-desc">${escapeHtml(task['Task Description']||'')}</p>
          </div>
          <div class="tc-badges">
            ${getStatusBadge(status)} ${getPriorityBadge(task['Priority'])}
            ${getWorkModeBadge(task['Work Mode'])}
          </div>
        </div>
        <div class="tc-meta">
          <span>🗂 ${escapeHtml(task['Task Type']||'—')}</span>
          <span>🏢 ${escapeHtml(task['Department']||'—')}</span>
          <span>📅 ${escapeHtml(task['Date Created']||'—')}</span>
        </div>
        <div class="tc-footer">
          <div class="tc-timer">
            <span class="timer-lbl">${isRunning ? '⏱ Live' : status==='Completed' ? '✅ Total' : '⏸ Time'}</span>
            <span class="timer-val ${isRunning ? 'timer-live' : ''}" data-timer="${taskId}">
              ${formatDuration(elapsed)}
            </span>
          </div>
          ${canAct ? `<div class="tc-actions">${this._regularActionBtns(task)}</div>` : ''}
        </div>
      </div>`;
  },

  _buildFieldCard(task, showEmp, canAct) {
    const taskId   = task['Task ID'];
    const status   = task['Status'];
    const hasProof = fieldTaskHasProof(task);
    const fieldDate= task['Date Started'] && task['Date Started'] !== 'null'
      ? task['Date Started'] : '—';

    return `
      <div class="task-card field-task-card" data-task-id="${taskId}">
        <div class="field-task-banner">
          <span>🗺️ Field Work</span>
          <span class="field-task-date">📅 ${escapeHtml(fieldDate)}</span>
        </div>
        <div class="tc-top">
          <div class="tc-info">
            ${showEmp ? `<span class="tc-emp">${escapeHtml(task['Employee Name'])}</span>` : ''}
            <h4 class="tc-name">${escapeHtml(task['Task Name'])}</h4>
            ${task['Event / Shoot Details'] && task['Event / Shoot Details'] !== 'null'
              ? `<p class="tc-desc">📋 ${escapeHtml(task['Event / Shoot Details'])}</p>` : ''}
          </div>
          <div class="tc-badges">
            ${getStatusBadge(status)} ${getPriorityBadge(task['Priority'])}
          </div>
        </div>
        <div class="tc-meta">
          ${task['Location / Venue'] && task['Location / Venue'] !== 'null'
            ? `<span>📍 ${escapeHtml(task['Location / Venue'])}</span>` : ''}
          <span>🗂 ${escapeHtml(task['Task Type']||'—')}</span>
          <span>🏢 ${escapeHtml(task['Department']||'—')}</span>
        </div>
        <div class="tc-footer">
          <div class="tc-field-proof-status">
            ${hasProof
              ? `<span class="proof-ok">✅ Proof Submitted</span>
                 <a href="${escapeHtml(task['Proof Link'])}" target="_blank" rel="noopener" class="proof-link-small">🔗 View</a>`
              : `<span class="proof-missing">⚠️ Awaiting Proof</span>`}
          </div>
          ${canAct && !hasProof && status !== 'Completed'
            ? `<button class="btn btn-sm btn-primary" onclick="Tasks.submitFieldProof('${taskId}')">
                📎 Submit Proof
               </button>` : ''}
        </div>
      </div>`;
  },

  _regularActionBtns(task) {
    const id = task['Task ID'];
    const st = task['Status'];
    if (st === 'Not Started') return `<button class="btn btn-sm btn-primary" onclick="Tasks.startTask('${id}')">▶ Start</button>`;
    if (st === 'In Progress') return `
      <button class="btn btn-sm btn-warning" onclick="Tasks.pauseTask('${id}')">⏸ Pause</button>
      <button class="btn btn-sm btn-danger"  onclick="Tasks.endTask('${id}')">■ End</button>`;
    if (st === 'Paused') return `
      <button class="btn btn-sm btn-primary" onclick="Tasks.startTask('${id}')">▶ Resume</button>
      <button class="btn btn-sm btn-danger"  onclick="Tasks.endTask('${id}')">■ End</button>`;
    return '';
  },
};

// ---- Helpers -----------------------------------------------
function _findTask(taskId) {
  return (AppState.tasks    || []).find(t => t['Task ID'] === taskId)
      || (AppState.deptTasks || []).find(t => t['Task ID'] === taskId)
      || (AppState.allTasks  || []).find(t => t['Task ID'] === taskId);
}

function filterTaskList(status, btn) {
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('[data-task-id]').forEach(c => {
    const id = c.dataset.taskId;
    const t  = _findTask(id);
    if (!t) return;
    c.style.display = (!status || status === 'all' || t['Status'] === status) ? '' : 'none';
  });
}
