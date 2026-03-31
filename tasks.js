// ============================================================
// tasks.js — DTIM v2.2
// CHANGES:
//   - Field work: NO timer. Completed by proof document upload.
//   - Field work filed in advance with Scheduled Field Date.
//   - Field work appears on its scheduled date in dashboard.
//   - _actionBtns() — field tasks show "Upload Proof" button instead of timer controls.
//   - buildCard()   — field tasks show proof upload section.
//   - showCreateForm() — field work form includes Scheduled Field Date (required).
//   - uploadFieldWorkProof() — uploads proof, auto-marks task Completed.
// ============================================================

const Tasks = {

  // ============================================================
  // LOAD
  // ============================================================

  async loadForUser(employeeName) {
    const today = getTodayDate();
    // Load personal tasks AND field tasks scheduled for today
    const allTasks = await API.getTasks({ employeeName, includeFieldForDate: today });
    AppState.tasks = allTasks;
    Tasks.restoreRunningTimers();
  },

  async loadForDept(department) {
    AppState.deptTasks = await API.getTasks({ department });
  },

  async loadAll() {
    AppState.allTasks = await API.getTasks();
  },

  // ============================================================
  // TIMER ACTIONS (Office / Remote only — NOT for Field work)
  // ============================================================

  async startTask(taskId) {
    const task = _findTask(taskId);
    if (!task) return;
    // Block timer actions on field tasks
    if (task['Work Mode'] === 'Field') {
      showToast('Field work tasks do not use a timer. Please upload proof to complete.', 'info'); return;
    }
    if (task['Status'] !== 'Not Started' && task['Status'] !== 'Paused') return;

    const now    = Date.now();
    const isNew  = task['Status'] === 'Not Started';
    const tdOld  = AppState.taskTimerData[taskId] || { accumulatedMs: 0 };
    const tdata  = { status: 'running', accumulatedMs: tdOld.accumulatedMs || 0, sessionStartMs: now };
    AppState.taskTimerData[taskId] = tdata;
    saveTimerState(taskId, tdata);

    const actionType = isNew ? 'Start' : 'Resume';
    task['Status']    = 'In Progress';
    task['Is Active'] = 'true';
    if (isNew) task['Date Started'] = formatDate(getTodayDate());

    try {
      await Promise.all([
        API.updateTask(taskId, { 'Status': 'In Progress', 'Is Active': 'true', ...(isNew ? { 'Date Started': formatDate(getTodayDate()) } : {}) }),
        API.logSession({ taskId, employeeName: AppState.currentUser.name, actionType }),
      ]);
    } catch (e) { console.error('startTask API error:', e); }

    this._startInterval(taskId);
    showToast(`${isNew ? 'Task started' : 'Task resumed'}: ${task['Task Name']}`, 'success');
    Dashboard.refreshCurrent();
  },

  async pauseTask(taskId) {
    const task = _findTask(taskId);
    if (!task || task['Status'] !== 'In Progress') return;
    if (task['Work Mode'] === 'Field') return; // Field tasks have no timer

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
          <textarea id="pause-notes" class="form-control" rows="2" placeholder="Dagdag na detalye..."></textarea>
        </div>
      </div>
    `, [
      { label: 'Cancel', type: 'ghost' },
      { label: 'Confirm Pause', type: 'warning', close: false, callback: () => this._doPause(taskId) },
    ]);
  },

  async _doPause(taskId) {
    const reason = getFormValue('pause-reason-select');
    const notes  = getFormValue('pause-notes');
    if (!reason) { showToast('Pumili ng dahilan ng pause.', 'error'); return; }
    hideModal();

    const task    = _findTask(taskId);
    if (!task) return;
    const tdata   = AppState.taskTimerData[taskId];
    const now     = Date.now();
    const elapsed = now - (tdata?.sessionStartMs || now);
    const accum   = (tdata?.accumulatedMs || 0) + elapsed;

    const newTdata = { status: 'paused', accumulatedMs: accum, sessionStartMs: null };
    AppState.taskTimerData[taskId] = newTdata;
    saveTimerState(taskId, newTdata);
    task['Status'] = 'Paused';

    this._clearInterval(taskId);

    try {
      await Promise.all([
        API.updateTask(taskId, { 'Status': 'Paused' }),
        API.logSession({ taskId, employeeName: AppState.currentUser.name, actionType: 'Pause', pauseReason: reason, notes }),
      ]);
    } catch (e) { console.error('pauseTask API error:', e); }

    showToast(`Task paused: ${task['Task Name']} (${reason})`, 'warning');
    Dashboard.refreshCurrent();
  },

  async endTask(taskId) {
    const task = _findTask(taskId);
    if (!task || task['Status'] === 'Completed' || task['Status'] === 'Not Started') return;
    if (task['Work Mode'] === 'Field') {
      showToast('Field work tasks are completed by uploading proof. Please use "Upload Proof" button.', 'info'); return;
    }

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

    const finalTdata = { status: 'ended', accumulatedMs: accum, sessionStartMs: null };
    AppState.taskTimerData[taskId] = finalTdata;
    saveTimerState(taskId, finalTdata);
    this._clearInterval(taskId);
    task['Status'] = 'Completed';

    try {
      await Promise.all([
        API.updateTask(taskId, { 'Status': 'Completed', 'Is Active': 'false', 'Date Completed': formatDate(getTodayDate()) }),
        API.logSession({ taskId, employeeName: AppState.currentUser.name, actionType: 'End' }),
      ]);
    } catch (e) { console.error('endTask API error:', e); }

    showToast(`Task completed: ${task['Task Name']}`, 'success');
    Dashboard.refreshCurrent();
  },

  // ============================================================
  // FIELD WORK — PROOF UPLOAD
  // Uploading proof auto-completes the field work task.
  // ============================================================

  showProofUpload(taskId) {
    const task = _findTask(taskId);
    if (!task) return;
    if (task['Work Mode'] !== 'Field') return;

    showModal('📎 Upload Field Work Proof', `
      <div class="form-grid">
        <div class="form-group fg-full">
          <label>Task</label>
          <p class="form-static"><strong>${escapeHtml(task['Task Name'])}</strong></p>
        </div>
        <div class="form-group fg-full">
          <p class="info-note">
            📌 Upload your proof document (Google Drive link, photo, or any file link).
            <br>Once uploaded, the task will automatically be marked as <strong>Completed</strong>.
          </p>
        </div>
        <div class="form-group fg-full">
          <label>Proof Document Link <span class="req">*</span></label>
          <input id="f-proof-link" type="url" class="form-control"
            placeholder="https://drive.google.com/..."
            value="${escapeHtml(task['Proof Link'] || '')}">
          <small class="form-hint">Paste a link to your proof document, photo, or output.</small>
        </div>
      </div>
    `, [
      { label: 'Cancel', type: 'ghost' },
      { label: '✅ Upload & Complete Task', type: 'success', close: false,
        callback: () => this._doUploadProof(taskId) },
    ]);
  },

  async _doUploadProof(taskId) {
    const proofLink = getFormValue('f-proof-link');
    if (!proofLink) { showToast('Please enter a valid proof link.', 'error'); return; }
    if (!proofLink.startsWith('http')) { showToast('Please enter a valid URL (starts with https://).', 'error'); return; }
    hideModal();

    const task = _findTask(taskId);
    if (!task) return;

    try {
      showToast('Uploading proof and completing task...', 'info', 2000);
      await API.uploadFieldWorkProof(taskId, proofLink, AppState.currentUser.name);

      // Update local state
      task['Proof Link']     = proofLink;
      task['Status']         = 'Completed';
      task['Is Active']      = 'false';
      task['Date Completed'] = formatDate(getTodayDate());

      showToast(`Field work completed: ${task['Task Name']} ✅`, 'success');
      Dashboard.refreshCurrent();
    } catch (e) {
      showToast('Error uploading proof. Please try again.', 'error');
      console.error(e);
    }
  },

  // ============================================================
  // TIMER INTERVALS (Office / Remote only)
  // ============================================================

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
  // ============================================================

  showCreateForm() {
    const dd   = AppState.dropdowns || FALLBACK_DD;
    const user = AppState.currentUser;
    showModal('Gumawa ng Bagong Task', `
      <div class="form-grid">
        <div class="form-group fg-full">
          <label>Task Name <span class="req">*</span></label>
          <input id="f-taskName" type="text" class="form-control" placeholder="e.g. Prepare monthly report">
        </div>
        <div class="form-group fg-full">
          <label>Task Description <span class="req">*</span></label>
          <textarea id="f-taskDesc" class="form-control" rows="3" placeholder="Ilarawan ang task..."></textarea>
        </div>
        <div class="form-group">
          <label>Department <span class="req">*</span></label>
          <select id="f-dept" class="form-control">
            <option value="">— Pumili —</option>
            ${buildOptions(dd.departments || FALLBACK_DD.departments, user.department)}
          </select>
        </div>
        <div class="form-group">
          <label>Task Type <span class="req">*</span></label>
          <select id="f-taskType" class="form-control">
            <option value="">— Pumili —</option>
            ${buildOptions(dd.taskTypes || FALLBACK_DD.taskTypes)}
          </select>
        </div>
        <div class="form-group">
          <label>Priority <span class="req">*</span></label>
          <select id="f-priority" class="form-control">
            <option value="">— Pumili —</option>
            ${buildOptions(dd.priorities || FALLBACK_DD.priorities)}
          </select>
        </div>
        <div class="form-group">
          <label>Work Mode <span class="req">*</span></label>
          <select id="f-workMode" class="form-control" onchange="Tasks._toggleFieldWork(this.value)">
            <option value="">— Pumili —</option>
            ${buildOptions(dd.workModes || FALLBACK_DD.workModes)}
          </select>
        </div>

        <!-- FIELD WORK SECTION — shown only when Work Mode = Field -->
        <div id="fieldwork-section" class="fg-full fieldwork-section" style="display:none">
          <div class="fg-divider fg-full">
            <span>🌍 Field Work Details</span>
          </div>
          <div class="field-work-notice fg-full">
            <span class="fw-notice-icon">📌</span>
            <div>
              <strong>Field Work Rules:</strong>
              <ul>
                <li>No timer — completed by uploading proof document.</li>
                <li>Must be filed <strong>in advance</strong> (for a future/scheduled date).</li>
                <li>Task will appear on the <strong>Scheduled Field Date</strong>.</li>
              </ul>
            </div>
          </div>
          <div class="form-group">
            <label>Scheduled Field Date <span class="req">*</span></label>
            <input id="f-fieldDate" type="date" class="form-control"
              min="${getTodayDate()}"
              placeholder="Select date of field work">
            <small class="form-hint">Must be today or a future date. The task will appear on this date.</small>
          </div>
          <div class="form-group">
            <label>Location / Venue <span class="req">*</span></label>
            <input id="f-location" type="text" class="form-control" placeholder="e.g. Makati City Hall">
          </div>
          <div class="form-group fg-full">
            <label>Event / Shoot Details <span class="req">*</span></label>
            <textarea id="f-eventDetails" class="form-control" rows="2" placeholder="Details about the event or shoot..."></textarea>
          </div>
          <div class="form-group fg-full">
            <label>Proof Document Link</label>
            <input id="f-proofLink" type="url" class="form-control" placeholder="https://drive.google.com/... (can be added later)">
            <small class="form-hint">You can upload proof on the actual field work date.</small>
          </div>

          <div class="fg-divider fg-full"><span>✈️ Travel Order (required for field work)</span></div>
          <div class="form-group">
            <label>Destination <span class="req">*</span></label>
            <input id="f-to-dest" type="text" class="form-control" placeholder="Destination">
          </div>
          <div class="form-group">
            <label>Purpose <span class="req">*</span></label>
            <input id="f-to-purpose" type="text" class="form-control" placeholder="Layunin ng travel">
          </div>
          <div class="form-group">
            <label>Budget (PHP)</label>
            <input id="f-to-budget" type="number" class="form-control" placeholder="0.00" min="0">
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
      { label: '+ Gumawa ng Task', type: 'primary', close: false, callback: () => this._submitCreate() },
    ]);
  },

  _toggleFieldWork(mode) {
    toggleEl('fieldwork-section', mode === 'Field');
    // Set min date for fieldDate input
    if (mode === 'Field') {
      const fd = document.getElementById('f-fieldDate');
      if (fd) fd.min = getTodayDate();
    }
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

    const data = {
      taskId:          generateId('TASK'),
      employeeName:    AppState.currentUser.name,
      taskName, taskDescription: taskDesc, department, taskType, priority, workMode,
    };

    // Field work extra fields
    if (workMode === 'Field') {
      const scheduledFieldDate = getFormValue('f-fieldDate');
      const location           = getFormValue('f-location');
      const eventDetails       = getFormValue('f-eventDetails');
      const proofLink          = getFormValue('f-proofLink');
      const destination        = getFormValue('f-to-dest');
      const purpose            = getFormValue('f-to-purpose');

      if (!scheduledFieldDate || !location || !eventDetails || !destination || !purpose) {
        showToast('Punan ang lahat ng Field Work required fields (*).', 'error'); return;
      }

      // Must be filed for today or future date
      if (scheduledFieldDate < getTodayDate()) {
        showToast('Scheduled Field Date must be today or a future date.', 'error'); return;
      }

      data.scheduledFieldDate = scheduledFieldDate;
      data.location           = location;
      data.eventDetails       = eventDetails;
      data.proofLink          = proofLink || null;
      data._travelOrder       = {
        destination,
        purpose,
        budget:        getFormValue('f-to-budget'),
        fundingSource: getFormValue('f-to-funding'),
        date:          scheduledFieldDate,
      };
    }

    hideModal();
    showToast('Ginagawa ang task...', 'info', 1500);

    try {
      await API.createTask(data);

      // Create travel order if field work
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
      const localTask = {
        'Task ID':              data.taskId,
        'Employee Name':        data.employeeName,
        'Task Name':            data.taskName,
        'Task Description':     data.taskDescription,
        'Department':           data.department,
        'Task Type':            data.taskType,
        'Status':               workMode === 'Field' ? 'Pending Proof' : 'Not Started',
        'Priority':             data.priority,
        'Date Created':         formatDate(getTodayDate()),
        'Work Mode':            data.workMode,
        'Scheduled Field Date': data.scheduledFieldDate || null,
        'Location / Venue':     data.location      || null,
        'Event / Shoot Details':data.eventDetails  || null,
        'Proof Link':           data.proofLink      || null,
        'Is Active':            'true',
      };
      AppState.tasks.unshift(localTask);

      const successMsg = workMode === 'Field'
        ? `Field work task filed for ${formatDate(data.scheduledFieldDate)}! ✅`
        : `Task created: ${data.taskName}`;
      showToast(successMsg, 'success');
      Dashboard.refreshCurrent();
    } catch (err) {
      showToast('Error creating task. Please try again.', 'error');
      console.error(err);
    }
  },

  // ============================================================
  // TASK CARD HTML
  // ============================================================

  buildCard(task, showEmp = false) {
    const taskId    = task['Task ID'];
    const tdata     = AppState.taskTimerData[taskId];
    const elapsed   = this.getElapsed(taskId);
    const status    = task['Status'];
    const isField   = task['Work Mode'] === 'Field';
    const isRunning = status === 'In Progress';
    const canAct    = Auth.canCreateTask() && AppState.currentUser.name === task['Employee Name'] || Auth.isAdmin();

    return `
      <div class="task-card ${isRunning ? 'task-running' : ''} ${isField ? 'task-field' : ''}" data-task-id="${taskId}">
        <div class="tc-top">
          <div class="tc-info">
            ${showEmp ? `<span class="tc-emp">${escapeHtml(task['Employee Name'])}</span>` : ''}
            <h4 class="tc-name">${escapeHtml(task['Task Name'])}</h4>
            <p class="tc-desc">${escapeHtml(task['Task Description'] || '')}</p>
          </div>
          <div class="tc-badges">
            ${getStatusBadge(status)}
            ${getPriorityBadge(task['Priority'])}
            ${getWorkModeBadge(task['Work Mode'])}
          </div>
        </div>
        <div class="tc-meta">
          <span>🗂 ${escapeHtml(task['Task Type'] || '—')}</span>
          <span>🏢 ${escapeHtml(task['Department'] || '—')}</span>
          <span>📅 ${task['Scheduled Field Date']
            ? `Field: ${formatDate(task['Scheduled Field Date'])}`
            : formatDate(task['Date Created'])}</span>
          ${task['Location / Venue'] ? `<span>📍 ${escapeHtml(task['Location / Venue'])}</span>` : ''}
        </div>

        ${isField ? `
        <!-- FIELD WORK: No timer, show proof upload section -->
        <div class="tc-field-footer">
          ${task['Proof Link']
            ? `<div class="tc-proof-done">
                <span class="proof-badge">📎 Proof Submitted</span>
                <a href="${escapeHtml(task['Proof Link'])}" target="_blank" rel="noopener" class="btn btn-sm btn-ghost">View Proof</a>
               </div>`
            : status !== 'Completed'
              ? `<div class="tc-proof-pending">
                  <span class="proof-pending-lbl">⏳ Pending proof document</span>
                  ${canAct ? `<button class="btn btn-sm btn-primary" onclick="Tasks.showProofUpload('${taskId}')">📎 Upload Proof</button>` : ''}
                 </div>`
              : ''
          }
          ${canAct && status !== 'Completed' ? `
            <div class="tc-actions tc-field-actions">
              <button class="btn btn-sm btn-primary" onclick="Tasks.showProofUpload('${taskId}')">📎 Upload Proof & Complete</button>
            </div>` : ''}
        </div>
        ` : `
        <!-- OFFICE / REMOTE: Timer controls -->
        <div class="tc-footer">
          <div class="tc-timer">
            <span class="timer-lbl">${isRunning ? '⏱ Live' : status === 'Completed' ? '✅ Total' : '⏸ Time'}</span>
            <span class="timer-val ${isRunning ? 'timer-live' : ''}" data-timer="${taskId}">
              ${formatDuration(elapsed)}
            </span>
          </div>
          ${canAct ? `<div class="tc-actions">${this._actionBtns(task)}</div>` : ''}
        </div>
        `}
      </div>
    `;
  },

  _actionBtns(task) {
    const id = task['Task ID'];
    const st = task['Status'];
    // Field work never gets timer buttons — handled in buildCard
    if (task['Work Mode'] === 'Field') return '';
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
  return (AppState.tasks     || []).find(t => t['Task ID'] === taskId)
      || (AppState.deptTasks || []).find(t => t['Task ID'] === taskId)
      || (AppState.allTasks  || []).find(t => t['Task ID'] === taskId);
}

// Global filter for task list
function filterTaskList(status, btn) {
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.task-card').forEach(c => {
    const id = c.dataset.taskId;
    const t  = _findTask(id);
    if (!t) return;
    c.style.display = (!status || status === 'all' || t['Status'] === status) ? '' : 'none';
  });
}
