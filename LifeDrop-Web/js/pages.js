
(function () {
  function q(id) { return document.getElementById(id); }
  function text(id, value) { const el = q(id); if (el) el.textContent = value; }
  function html(id, value) { const el = q(id); if (el) el.innerHTML = value; }
  function fmtNumber(value) { return Number(value || 0).toLocaleString(); }
  function fmtDate(value) { return new Date(value).toLocaleString(); }
  function priorityClass(priority) {
    const p = (priority || '').toLowerCase();
    if (p === 'critical') return 'dash-badge--critical';
    if (p === 'urgent') return 'dash-badge--urgent';
    return 'dash-badge--normal';
  }
  function severityClass(severity) {
    const s = (severity || '').toLowerCase();
    if (s === 'critical') return 'is-danger';
    if (s === 'warning') return 'is-warning';
    return 'is-success';
  }
  function showError(targetId, message) {
    html(targetId, `<div class="dash-card"><div class="dash-card__body"><strong>API connection failed.</strong><p class="dash-subtitle">${message}</p><p class="dash-subtitle">Make sure the ASP.NET API is running on https://localhost:7001.</p></div></div>`);
  }

  // ── Enum label helpers (enums serialised as ints by the backend) ─────────────
  // BloodType:       0=O+ 1=O- 2=A+ 3=A- 4=B+ 5=B- 6=AB+ 7=AB-
  // UrgencyLevel:    0=Normal 1=Urgent 2=Critical
  // RequestStatus:   0=Active 1=Fulfilled 2=Cancelled 3=Expired
  // AcceptanceStatus:0=Accepted 1=Fulfilled 2=CancelledByDonor 3=NoShow
  const BT  = ['O+','O-','A+','A-','B+','B-','AB+','AB-'];
  const URG = ['Normal','Urgent','Critical'];
  const RST = ['Active','Fulfilled','Cancelled','Expired'];
  const AST = ['Accepted','Fulfilled','Cancelled by Donor','No-Show'];
  // Reverse maps for form → int
  const BT_VAL  = {'O+':0,'O-':1,'A+':2,'A-':3,'B+':4,'B-':5,'AB+':6,'AB-':7};
  const URG_VAL = {'Normal':0,'Urgent':1,'Critical':2};

  function fmtBT(v)  { return BT[v]  ?? String(v); }
  function fmtUrg(v) { return URG[v] ?? String(v); }
  function fmtRSt(v) { return RST[v] ?? String(v); }
  function fmtASt(v) { return AST[v] ?? String(v); }
  function urgClass(v) {
    if (v === 2) return 'dash-badge--critical';
    if (v === 1) return 'dash-badge--urgent';
    return 'dash-badge--normal';
  }

  async function initDashboardOverview() {
    // GET /api/Hospitals/dashboard/overview → DashboardOverviewDto
    // Real fields: activeRequestsCount, fulfilledRequestsCount, canceledRequestsCount,
    //              completionRate, totalBloodBagsCollected,
    //              activeRequestsProgress[], recentActivities[]
    // NOT in DTO: critical, urgent, activeHospitals, activeDonors
    try {
      const data = await LifeDropApi.getDashboardOverview() || {};

      text('ov-active',    fmtNumber(data.activeRequestsCount));
      text('ov-fulfilled', fmtNumber(data.fulfilledRequestsCount));
      text('ov-cancelled', fmtNumber(data.canceledRequestsCount));
      text('ov-completion', `${Number(data.completionRate || 0).toFixed(1)}%`);
      text('ov-bags',      fmtNumber(data.totalBloodBagsCollected));

      // Active requests progress mini-list
      const progress = data.activeRequestsProgress || [];
      html('ov-progress-list', progress.length
        ? progress.map(r => {
            const pct = Math.min(Math.round(r.progressPercentage || 0), 100);
            return `<div style="display:flex; flex-direction:column; gap:8px; padding:12px; border:1px solid var(--border); border-radius:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <strong>${r.bloodType}</strong>
                <a class="dash-link-alert" href="request-details.html?id=${r.requestId}">View</a>
              </div>
              <div style="display:flex; flex-direction:column; gap:6px;">
                <span class="dash-muted" style="font-size:0.85em;">${r.currentFulfilledAcceptances}/${r.targetQuota} units</span>
                <div class="dash-progress">
                  <div class="dash-progress__bar ${pct < 35 ? 'is-danger' : pct >= 100 ? 'is-success' : ''}" style="width:${pct}%"></div>
                </div>
              </div>
            </div>`;
          }).join('')
        : '<div class="dash-muted">No active requests.</div>'
      );

      // Recent activity feed
      const activities = data.recentActivities || [];
      html('overview-feed', activities.length
        ? activities.map(item => `
            <div class="dash-feed-item">
              <span class="dash-feed-dot ${item.activityType === 'DonationFulfilled' ? 'is-success' : 'is-warning'}"></span>
              <div>
                <strong>${item.activityType === 'DonationFulfilled' ? 'Donation Fulfilled' : 'Request Created'}</strong>
                <div class="dash-muted">${item.description}</div>
                <div class="dash-admin-title">${fmtDate(item.timestamp)}</div>
              </div>
            </div>`).join('')
        : '<div class="dash-muted">No recent activity.</div>'
      );
    } catch (error) {
      showError('overview-feed-wrap', error.message);
    }
    
    const user = window.LifeDropApi && window.LifeDropApi.getCurrentUser();
    if (user && user.role === 'HospitalAdmin') {
      const el = q('ha-employee-placeholder');
      if (el) {
        el.style.display = 'block';
        initEmployeeManagement();
      }
    }

    function initEmployeeManagement() {
      let currentPage = 1;
      let pageSize = 5;
      let currentSearch = '';
      let searchTimeout = null;

      const tbody = q('emp-table-body');
      const searchInput = q('emp-search');
      const prevBtn = q('emp-prev-btn');
      const nextBtn = q('emp-next-btn');
      const pageIndicator = q('emp-page-indicator');
      const modal = q('emp-details-modal');
      const modalClose = q('emp-modal-close');
      const modalContent = q('emp-modal-content');

      if (modalClose) {
        modalClose.addEventListener('click', () => modal.close());
      }

      async function loadData() {
        try {
          if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="dash-muted" style="text-align: center; padding: 24px;">Loading employees...</td></tr>';
          
          const response = await LifeDropApi.getEmployees(currentPage, pageSize, currentSearch);
          const items = (response && response.data) || [];
          const totalPages = response ? response.totalPages : 1;
          const pageNum = response ? response.pageNumber : 1;

          if (pageIndicator) pageIndicator.textContent = `Page ${pageNum} of ${totalPages || 1}`;
          
          if (prevBtn) prevBtn.disabled = pageNum <= 1;
          if (nextBtn) nextBtn.disabled = pageNum >= totalPages;

          if (!items.length) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="dash-muted" style="text-align: center; padding: 24px;">No employees found.</td></tr>';
            return;
          }

          if (tbody) {
            tbody.innerHTML = items.map(emp => {
              const activeClass = emp.isActive ? 'dash-badge--normal' : 'dash-badge--critical';
              const activeLabel = emp.isActive ? 'Active' : 'Inactive';
              const toggleBtnLabel = emp.isActive ? 'Deactivate' : 'Activate';
              const toggleBtnClass = emp.isActive ? 'dash-btn--danger' : 'dash-btn--success';
              return `<tr>
                <td><strong>${emp.firstName} ${emp.lastName}</strong></td>
                <td>${emp.email}</td>
                <td>${emp.phoneNumber || '--'}</td>
                <td>${emp.role}</td>
                <td><span class="dash-badge ${activeClass}">${activeLabel}</span></td>
                <td>${fmtDate(emp.createdOn)}</td>
                <td style="display:flex; gap:8px;">
                  <button class="dash-btn dash-btn--secondary dash-btn--xs view-emp-btn" data-id="${emp.employeeProfileId}">View</button>
                  <button class="dash-btn ${toggleBtnClass} dash-btn--xs toggle-emp-btn" data-id="${emp.employeeProfileId}" data-active="${emp.isActive}">${toggleBtnLabel}</button>
                </td>
              </tr>`;
            }).join('');

            document.querySelectorAll('.view-emp-btn').forEach(btn => {
              btn.addEventListener('click', () => openDetails(btn.dataset.id));
            });
            document.querySelectorAll('.toggle-emp-btn').forEach(btn => {
              btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                const isActive = e.target.dataset.active === 'true';
                try {
                  e.target.disabled = true;
                  if (isActive) {
                    await LifeDropApi.deactivateEmployee(id);
                  } else {
                    await LifeDropApi.activateEmployee(id);
                  }
                  loadData();
                } catch (error) {
                  alert(error.message);
                  e.target.disabled = false;
                }
              });
            });
          }
        } catch (error) {
          if (tbody) {
            let displayMsg = error.message;
            if (displayMsg.includes('401')) displayMsg = 'Unauthorized. Please login again.';
            else if (displayMsg.includes('403')) displayMsg = 'Forbidden. You do not have access to view employees.';
            else if (displayMsg.includes('404')) displayMsg = 'Employees not found.';
            else if (displayMsg.includes('429')) displayMsg = 'Too many requests. Please try again later.';
            tbody.innerHTML = `<tr><td colspan="7" class="dash-muted is-danger" style="text-align: center; padding: 24px;">${displayMsg}</td></tr>`;
          }
        }
      }

      async function openDetails(id) {
        if (!modal) return;
        modal.showModal();
        modalContent.innerHTML = '<div class="dash-muted">Loading details...</div>';
        try {
          const emp = await LifeDropApi.getEmployee(id);
          const activeClass = emp.isActive ? 'is-success' : 'is-danger';
          const activeLabel = emp.isActive ? 'Active' : 'Inactive';
          const emailVerified = emp.emailVerified ? 'Yes' : 'No';
          modalContent.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div><strong>Name:</strong> ${emp.firstName} ${emp.lastName}</div>
              <div><strong>Email:</strong> ${emp.email}</div>
              <div><strong>Phone:</strong> ${emp.phoneNumber || '--'}</div>
              <div><strong>Role:</strong> ${emp.role}</div>
              <div><strong>Active Status:</strong> <span class="dash-row"><span class="dash-dot ${activeClass}"></span>${activeLabel}</span></div>
              <div><strong>Email Verified:</strong> ${emailVerified}</div>
              <div><strong>Date of Birth:</strong> ${emp.dateOfBirth ? new Date(emp.dateOfBirth).toLocaleDateString() : '--'}</div>
              <div><strong>Created On:</strong> ${fmtDate(emp.createdOn)}</div>
              <div><strong>Modified On:</strong> ${emp.modifiedOn ? fmtDate(emp.modifiedOn) : '--'}</div>
            </div>
          `;
        } catch (error) {
          let displayMsg = error.message;
          if (displayMsg.includes('401')) displayMsg = 'Unauthorized. Please login again.';
          else if (displayMsg.includes('403')) displayMsg = 'Forbidden. You do not have access to view details.';
          else if (displayMsg.includes('404')) displayMsg = 'Employee not found.';
          else if (displayMsg.includes('429')) displayMsg = 'Too many requests. Please try again later.';
          modalContent.innerHTML = `<div class="dash-muted is-danger">Failed to load details: ${displayMsg}</div>`;
        }
      }

      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          currentSearch = e.target.value;
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            currentPage = 1;
            loadData();
          }, 300);
        });
      }

      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          if (currentPage > 1) {
            currentPage--;
            loadData();
          }
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          currentPage++;
          loadData();
        });
      }

      loadData();
    }
  }



  async function initRequestManagement() {
    async function loadTable() {
      try {
        // Response shape: ApiResponse<PagedResponse<HospitalRequestSummaryDto>>
        // api.js unwraps ApiResponse.data → PagedResponse; items are in PagedResponse.data
        const paged = await LifeDropApi.getRequests();
        const reqs  = (paged && paged.data) || [];

        // Stats derived from real fields
        const activeCount   = reqs.filter(r => r.status === 0).length;           // RequestStatus.Active = 0
        const criticalCount = reqs.filter(r => r.urgency === 2).length;          // UrgencyLevel.Critical = 2
        const avgProgress   = reqs.length
          ? Math.round(reqs.reduce((s, r) => s + (r.fulfillmentPercentage || 0), 0) / reqs.length)
          : 0;
        text('rm-active-count', activeCount);
        text('rm-avg-progress', `${avgProgress}%`);
        text('rm-critical-gap', criticalCount);

        if (!reqs.length) {
          html('requests-table-body', '<tr><td colspan="7" class="dash-muted">No requests found.</td></tr>');
        } else {
          html('requests-table-body', reqs.map(req => {
            const pct = Math.min(req.fulfillmentPercentage || 0, 100);
            return `
            <tr>
              <td class="dash-muted" style="font-size:0.75em;">${req.requestId.slice(0,8)}…</td>
              <td><strong>${fmtBT(req.bloodType)}</strong><div class="dash-muted">${fmtRSt(req.status)}</div></td>
              <td><span class="dash-badge ${urgClass(req.urgency)}">${fmtBT(req.bloodType)}</span></td>
              <td><span class="dash-badge ${urgClass(req.urgency)}">${fmtUrg(req.urgency)}</span></td>
              <td><strong>${req.currentFulfilledAcceptances}/${req.targetQuota}</strong>
                <div class="dash-progress"><div class="dash-progress__bar ${pct < 35 ? 'is-danger' : pct >= 100 ? 'is-success' : ''}" style="width:${pct}%"></div></div>
              </td>
              <td>${fmtDate(req.createdAt)}</td>
              <td><a class="dash-link-alert" href="request-details.html?id=${req.requestId}">View</a></td>
            </tr>`;
          }).join(''));
        }
      } catch (error) {
        showError('requests-table-wrap', error.message);
      }
    }

    await loadTable();

    // Auto-open inline form if navigated here with ?new=1 (e.g. from dashboard)
    if (new URLSearchParams(location.search).get('new') === '1') {
      const panel = q('rm-new-request-panel');
      if (panel) panel.setAttribute('open', '');
    }

    // Wire inline new-request form — on success close panel and refresh table
    await initNewRequestForm('rm-new-request-form', async function () {
      const panel = q('rm-new-request-panel');
      if (panel) panel.removeAttribute('open');
      await loadTable();
    });
  }

  // ── Shared new-request form logic (used from standalone page AND inline panel) ─
  async function initNewRequestForm(formId, onSuccess) {
    const form = q(formId);
    if (!form) return;

    const govSelect  = form.querySelector('[data-role="governorate"]');
    const distSelect = form.querySelector('[data-role="districts"]');
    const btSelect   = form.querySelector('[data-role="blood-type"]');
    const urgSelect  = form.querySelector('[data-role="urgency"]');
    const quotaInput = form.querySelector('[data-role="quota"]');
    const statusEl   = form.querySelector('[data-role="status"]');

    function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

    // ── Populate governorates ──────────────────────────────────────────────────
    if (govSelect) {
      try {
        const govs = await LifeDropApi.getGovernorates();
        const list  = Array.isArray(govs) ? govs : (govs && govs.data ? govs.data : []);
        govSelect.innerHTML = '<option value="">— Select Governorate —</option>' +
          list.map(g => `<option value="${g.id}">${g.nameEn || g.name}</option>`).join('');
      } catch (_) {
        govSelect.innerHTML = '<option value="">Failed to load governorates</option>';
      }
    }

    // ── Load districts when governorate changes ───────────────────────────────
    if (govSelect && distSelect) {
      govSelect.addEventListener('change', async function () {
        const govId = this.value;
        distSelect.innerHTML = '<option>Loading districts…</option>';
        distSelect.disabled  = true;
        if (!govId) { distSelect.innerHTML = ''; distSelect.disabled = false; return; }
        try {
          const dists = await LifeDropApi.getDistricts(govId);
          const list  = Array.isArray(dists) ? dists : (dists && dists.data ? dists.data : []);
          distSelect.innerHTML = list.map(d =>
            `<option value="${d.id}">${d.nameEn || d.name}</option>`).join('');
          distSelect.disabled = false;
        } catch (_) {
          distSelect.innerHTML = '<option>Failed to load districts</option>';
          distSelect.disabled  = false;
        }
      });
    }

    // ── Submit ─────────────────────────────────────────────────────────────────
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, true);
      setStatus('Submitting…');
      try {
        const profile    = await LifeDropApi.getHospitalProfile();
        const hospitalId = profile && profile.hospitalId;
        if (!hospitalId) throw new Error('Cannot determine hospital ID from profile.');

        const selectedDistricts = distSelect
          ? Array.from(distSelect.selectedOptions).map(o => o.value).filter(Boolean)
          : [];
        if (!selectedDistricts.length) throw new Error('Please select at least one district.');

        // Exact payload required by CreateDonationRequestCommand:
        //   hospitalId (Guid), bloodType (int 0–7), targetQuota (int >0),
        //   urgency (int 0–2), targetDistrictIds (Guid[] ≥1), expiryDate (DateTime? UTC)
        const payload = {
          hospitalId:        hospitalId,
          bloodType:         BT_VAL[btSelect   ? btSelect.value   : 'O+']     ?? 0,
          targetQuota:       Number(quotaInput  ? quotaInput.value : 1)        || 1,
          urgency:           URG_VAL[urgSelect  ? urgSelect.value  : 'Normal'] ?? 0,
          targetDistrictIds: selectedDistricts,
          expiryDate:        null
        };

        const result = await LifeDropApi.createRequest(payload);
        if (window.LifeDropUi) window.LifeDropUi.showToast('Request created successfully.', 'success');
        setStatus('Request created.');
        form.reset();
        if (distSelect) { distSelect.innerHTML = ''; distSelect.disabled = true; }
        if (typeof onSuccess === 'function') onSuccess(result);
      } catch (error) {
        if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
        setStatus(error.message);
      } finally {
        if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, false);
      }
    });
  }

  async function initNewRequest() {
    await initNewRequestForm('new-request-form', function (result) {
      const newId = result && result.requestId;
      window.location.href = newId
        ? `request-details.html?id=${newId}`
        : 'request-management.html';
    });
  }


  async function initRequestDetails() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) {
      showError('rd-content', 'No request ID in URL. Navigate here from Request Management.');
      return;
    }

    async function loadDetails() {
      // Response shape: ApiResponse<HospitalRequestDetailsDto>
      const req = await LifeDropApi.getRequest(id);
      if (!req) throw new Error('Request details empty.');

      // Real field names from HospitalRequestDetailsDto
      const urgencyLabel = fmtUrg(req.urgency);          // int enum
      const bloodLabel   = fmtBT(req.bloodType);         // int enum
      const statusLabel  = fmtRSt(req.status);           // int enum: 0=Active 1=Fulfilled 2=Cancelled 3=Expired
      const pct = req.targetQuota > 0
        ? Math.round((req.currentFulfilledAcceptances / req.targetQuota) * 100)
        : 0;

      // Request is closed if not Active (0)
      const isClosed = req.status !== 0;

      text('rd-priority', `${urgencyLabel} Urgency`);
      text('rd-title',    `${bloodLabel} Request`);
      // No patientName/department/requestCode in DTO — use hospitalName + address + id prefix
      text('rd-subtitle', `${req.hospitalName} • ${req.hospitalAddress || ''} • ID: ${id.slice(0,8)}…`);
      text('rd-progress-value', `${pct}%`);
      text('rd-progress-copy', `${req.currentFulfilledAcceptances} / ${req.targetQuota} units`);
      text('rd-status', statusLabel);

      // acceptances[] — each has its own acceptanceId (NOT a top-level field)
      const acceptances = req.acceptances || [];

      // Cancel button HTML (rendered once, in the first row or empty-state row)
      const cancelHtml = isClosed
        ? `<button class="dash-btn dash-btn--danger dash-btn--xs" disabled type="button">Cancel Request</button>`
        : `<button class="dash-btn dash-btn--danger dash-btn--xs" id="rd-cancel-btn" type="button">Cancel Request</button>`;

      if (!acceptances.length) {
        html('rd-donor-table', `
          <tr>
            <td colspan="4"><span class="dash-muted">No donors have accepted this request yet.</span></td>
            <td>${cancelHtml}</td>
          </tr>`);
      } else {
        // One row per acceptance — AcceptanceStatus: 0=Accepted (actionable), 1=Fulfilled, 2=CancelledByDonor, 3=NoShow
        html('rd-donor-table', acceptances.map((a, i) => {
          const canAct = (a.status === 0) && !isClosed; // only Accepted status is actionable
          return `
            <tr>
              <td><strong>${a.donorName}</strong><div class="dash-muted">${a.phoneNumber}</div></td>
              <td><span class="dash-badge ${urgClass(req.urgency)}">${fmtBT(a.bloodType)}</span></td>
              <td><span class="dash-row"><span class="dash-dot"></span>${fmtASt(a.status)}</span></td>
              <td>${fmtDate(a.acceptedAt)}</td>
              <td style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <a class="dash-btn dash-btn--secondary dash-btn--xs ${!canAct ? 'dash-btn--disabled' : ''}" 
                   href="donor-verification.html?requestId=${id}&acceptanceId=${a.acceptanceId}" 
                   ${!canAct ? 'onclick="event.preventDefault();"' : ''}>Verify</a>
                <button class="dash-btn dash-btn--primary dash-btn--xs"
                  data-fulfill="${a.acceptanceId}" type="button" ${canAct ? '' : 'disabled'}>Fulfill</button>
                <button class="dash-btn dash-btn--secondary dash-btn--xs"
                  data-noshow="${a.acceptanceId}"  type="button" ${canAct ? '' : 'disabled'}>No-show</button>
                ${i === 0 ? cancelHtml : ''}
              </td>
            </tr>`;
        }).join(''));
      }

      // Wire fulfill buttons (data-fulfill attribute carries acceptanceId)
      document.querySelectorAll('[data-fulfill]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const aId = btn.dataset.fulfill;
          if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(btn, true);
          try {
            await LifeDropApi.fulfillAcceptance(aId);
            if (window.LifeDropUi) window.LifeDropUi.showToast('Donation fulfilled.', 'success');
            await loadDetails();
          } catch (err) {
            if (window.LifeDropUi) window.LifeDropUi.showToast(err.message, 'error');
          } finally {
            if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(btn, false);
          }
        });
      });

      // Wire no-show buttons (data-noshow attribute carries acceptanceId)
      document.querySelectorAll('[data-noshow]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const aId = btn.dataset.noshow;
          if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(btn, true);
          try {
            await LifeDropApi.markAcceptanceNoShow(aId);
            if (window.LifeDropUi) window.LifeDropUi.showToast('Donor marked as no-show.', 'success');
            await loadDetails();
          } catch (err) {
            if (window.LifeDropUi) window.LifeDropUi.showToast(err.message, 'error');
          } finally {
            if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(btn, false);
          }
        });
      });

      // Wire cancel request button
      const cancelBtn = q('rd-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(cancelBtn, true);
          try {
            await LifeDropApi.cancelDonationRequest(id);
            if (window.LifeDropUi) window.LifeDropUi.showToast('Request cancelled.', 'success');
            await loadDetails();
          } catch (err) {
            if (window.LifeDropUi) window.LifeDropUi.showToast(err.message, 'error');
          } finally {
            if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(cancelBtn, false);
          }
        });
      }
    }

    try {
      await loadDetails();
    } catch (error) {
      showError('rd-content', error.message);
    }
  }

  async function initReportsAnalytics() {
    try {
      const data = await LifeDropApi.getReports() || {};

      const monthly = data.monthlyDonationStats || [];
      const btDist = data.bloodTypeDistribution || [];
      const avgMin = data.averageResponseTimeInMinutes;

      // Show empty state if there is completely no data
      if (monthly.length === 0 && btDist.length === 0 && (avgMin === null || avgMin === undefined || avgMin === 0)) {
        const errWrap = q('reports-error');
        const mainWrap = q('reports-content-main');
        const subWrap = q('reports-content-sub');
        if (errWrap) errWrap.style.display = 'block';
        if (mainWrap) mainWrap.style.display = 'none';
        if (subWrap) subWrap.style.display = 'none';
        return;
      }

      // ── Monthly donation bar chart ──────────────────────────────────────────
      if (monthly.length) {
        const max = Math.max(...monthly.map(m => m.donationCount), 1);
        html('reports-bars', monthly.map((m, i) => {
          const pct = Math.max(5, Math.round((m.donationCount / max) * 100));
          const isLast = i === monthly.length - 1;
          return `<div class="dash-chart-col">
            <div class="dash-chart-stack">
              <div class="dash-bar ${isLast ? 'dash-bar--primary' : 'dash-bar--soft'}" style="height:${pct}%" title="${m.donationCount} units"></div>
            </div>
            <div class="dash-chart-day">${m.month}</div>
          </div>`;
        }).join(''));
      } else {
        html('reports-bars', '<div class="dash-muted" style="padding:16px 0;">No monthly data.</div>');
      }

      // ── Summary metrics ─────────────────────────────────────────────────────
      text('reports-response', avgMin != null ? `${Number(avgMin).toFixed(1)} min` : '--');

      // ── Blood type distribution ─────────────────────────────────────────────
      html('reports-mix', btDist.length
        ? btDist.map(b => `<div class="dash-metric-item"><strong>${b.bloodType}</strong><span>${b.count} (${Number(b.percentage).toFixed(1)}%)</span></div>`).join('')
        : '<div class="dash-muted">No blood type data available.</div>'
      );

    } catch (error) {
      showError('reports-root', error.message);
    }
  }

  async function initHospitalManagement() {
    try {
      const data = await LifeDropApi.getHospitals() || {};
      text('hm-total', data.totalFacilities || 0);
      text('hm-active', data.activeNow || 0);
      text('hm-pending', data.pendingActivation || 0);
      text('hm-suspended', data.suspendedNodes || 0);
      const items = data.items || [];
      html('hospital-table-body', items.length ? items.map(h => `<tr><td><strong>${h.name}</strong></td><td>${h.code}</td><td>${h.adminEmail}</td><td>${h.city}</td><td><span class="dash-badge ${h.status === 'Active' ? 'dash-badge--normal' : h.status === 'Suspended' ? 'dash-badge--critical' : 'dash-badge--urgent'}">${h.status}</span></td><td>${h.responseTimeMs}ms</td></tr>`).join('') : '<tr><td colspan="6" class="dash-muted">No hospitals found.</td></tr>');
    } catch (error) {
      showError('hospital-table-wrap', error.message);
    }
  }

  function initGlobalSettings() {
    // Backend endpoint does not exist — no /Admin/settings controller implemented.
    showError('global-settings-root', 'Global Settings: backend endpoint not yet implemented. This page will be enabled once the API is available.');
  }

  function initAuditLogs() {
    // Backend endpoint does not exist — no /AuditLogs controller implemented.
    showError('audit-root', 'Audit Logs: backend endpoint not yet implemented. This page will be enabled once the API is available.');
    // Disable the filter button to prevent further errors
    const btn = q('audit-filter-btn');
    if (btn) btn.disabled = true;
  }

  async function initGlobalOperations() {
    try {
      const data = await LifeDropApi.getOperationsGlobal() || {};
      text('go-donors', fmtNumber(data.donors));
      text('go-hospitals', fmtNumber(data.hospitals));
      text('go-critical', fmtNumber(data.criticalRequests));
      text('go-response', `${data.responseRate || 0}%`);
      const feed = data.feed || [];
      const regions = data.regions || [];
      html('go-feed', feed.length ? feed.map(item => `<div class="dash-feed-item"><span class="dash-feed-dot ${severityClass(item.severity)}"></span><div><strong>${item.title}</strong><div class="dash-muted">${item.description}</div><div class="dash-admin-title">${fmtDate(item.at)}</div></div></div>`).join('') : '<div class="dash-muted">No operations recorded.</div>');
      html('go-regions', regions.length ? regions.map(r => `<span class="dash-world-map__chip">${r}</span>`).join('') : '<span class="dash-world-map__chip">None</span>');
    } catch (error) {
      showError('global-operations-root', error.message);
    }
  }

  async function initSystemAdminDashboard() {
    try {
      const data = await LifeDropApi.getOperationsGlobal() || {};
      text('sa-donors', fmtNumber(data.totalDonors || 0));
      text('sa-hospitals', fmtNumber(data.totalHospitals || 0));
      text('sa-critical', fmtNumber(data.totalDonationRequests || 0));
      text('sa-response', fmtNumber(data.totalBloodBagsCollected || 0));
      const regions = data.requestsByGovernorate || [];
      html('sa-feed', '<div class="dash-muted">Activity feed not supported by backend yet.</div>');
      html('sa-regions', regions.length ? regions.map(r => `
        <div class="sa-region-row">
          <div class="sa-region-name" dir="auto">${r.governorateName}</div>
          <div class="sa-region-meta">Requests: ${r.requestCount}</div>
        </div>
      `).join('') : '<div class="dash-muted">No active regions yet.</div>');
    } catch (error) {
      showError('sa-dashboard-root', error.message);
    }

    const saHospitalsTbody = document.getElementById('sa-hospitals-tbody');
    const saEmpModal = document.getElementById('sa-emp-modal');
    const saEmpModalClose = document.getElementById('sa-emp-modal-close');
    const saEmpTbody = document.getElementById('sa-emp-tbody');

    if (saEmpModalClose) saEmpModalClose.addEventListener('click', () => saEmpModal.close());

    async function loadAdminHospitals() {
      if (!saHospitalsTbody) return;
      try {
        const hospitals = await LifeDropApi.getHospitals() || [];
        if (!hospitals.length) {
          saHospitalsTbody.innerHTML = '<tr><td colspan="4" class="dash-muted" style="text-align: center; padding: 24px;">No hospitals found.</td></tr>';
          return;
        }

        saHospitalsTbody.innerHTML = hospitals.map(h => {
          const activeClass = h.isActive ? 'dash-badge--normal' : 'dash-badge--critical';
          const activeLabel = h.isActive ? 'Active' : 'Inactive';
          const toggleBtnLabel = h.isActive ? 'Deactivate' : 'Activate';
          const toggleBtnClass = h.isActive ? 'dash-btn--danger' : 'dash-btn--success';
          return `<tr>
            <td><strong>${h.name}</strong></td>
            <td>${h.address}</td>
            <td><span class="dash-badge ${activeClass}">${activeLabel}</span></td>
            <td style="display:flex; gap:8px;">
              <button class="dash-btn dash-btn--secondary dash-btn--xs sa-view-emps-btn" data-id="${h.hospitalId}" data-name="${h.name}">Employees</button>
              <button class="dash-btn ${toggleBtnClass} dash-btn--xs sa-toggle-hosp-btn" data-id="${h.hospitalId}" data-active="${h.isActive}">${toggleBtnLabel}</button>
            </td>
          </tr>`;
        }).join('');

        document.querySelectorAll('.sa-view-emps-btn').forEach(btn => {
          btn.addEventListener('click', () => openAdminHospitalEmployees(btn.dataset.id, btn.dataset.name));
        });

        document.querySelectorAll('.sa-toggle-hosp-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            const isActive = e.target.dataset.active === 'true';
            try {
              e.target.disabled = true;
              if (isActive) await LifeDropApi.deactivateHospital(id);
              else await LifeDropApi.activateHospital(id);
              loadAdminHospitals();
            } catch (error) {
              alert(error.message);
              e.target.disabled = false;
            }
          });
        });
      } catch (error) {
        saHospitalsTbody.innerHTML = `<tr><td colspan="4" class="dash-muted is-danger" style="text-align: center; padding: 24px;">Error: ${error.message}</td></tr>`;
      }
    }

    async function openAdminHospitalEmployees(hospitalId, hospitalName) {
      if (!saEmpModal) return;
      saEmpModal.showModal();
      const titleEl = document.getElementById('sa-emp-modal-title');
      if (titleEl) titleEl.textContent = `${hospitalName} - Employees`;
      saEmpTbody.innerHTML = '<tr><td colspan="5" class="dash-muted" style="text-align: center; padding: 24px;">Loading employees...</td></tr>';
      
      try {
        const employees = await LifeDropApi.getHospitalEmployeesAdmin(hospitalId) || [];
        if (!employees.length) {
          saEmpTbody.innerHTML = '<tr><td colspan="5" class="dash-muted" style="text-align: center; padding: 24px;">No employees found.</td></tr>';
          return;
        }

        const renderEmployees = () => {
          saEmpTbody.innerHTML = employees.map(emp => {
            const activeClass = emp.isActive ? 'dash-badge--normal' : 'dash-badge--critical';
            const activeLabel = emp.isActive ? 'Active' : 'Inactive';
            const toggleBtnLabel = emp.isActive ? 'Deactivate' : 'Activate';
            const toggleBtnClass = emp.isActive ? 'dash-btn--danger' : 'dash-btn--success';
            return `<tr>
              <td><strong>${emp.firstName} ${emp.lastName}</strong></td>
              <td>${emp.email}</td>
              <td>${emp.role}</td>
              <td><span class="dash-badge ${activeClass}">${activeLabel}</span></td>
              <td style="display:flex; gap:8px;">
                <button class="dash-btn ${toggleBtnClass} dash-btn--xs sa-toggle-emp-btn" data-id="${emp.employeeProfileId}" data-active="${emp.isActive}">${toggleBtnLabel}</button>
              </td>
            </tr>`;
          }).join('');

          document.querySelectorAll('.sa-toggle-emp-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              const id = e.target.dataset.id;
              const isActive = e.target.dataset.active === 'true';
              try {
                e.target.disabled = true;
                if (isActive) await LifeDropApi.deactivateEmployeeAdmin(id);
                else await LifeDropApi.activateEmployeeAdmin(id);
                // Update local state and re-render
                const updatedEmp = employees.find(x => x.employeeProfileId === id);
                if (updatedEmp) updatedEmp.isActive = !isActive;
                renderEmployees();
              } catch (error) {
                alert(error.message);
                e.target.disabled = false;
              }
            });
          });
        };
        renderEmployees();

      } catch (error) {
        saEmpTbody.innerHTML = `<tr><td colspan="5" class="dash-muted is-danger" style="text-align: center; padding: 24px;">Error: ${error.message}</td></tr>`;
      }
    }

    loadAdminHospitals();
  }

  function initSystemAdminCreateHospital() {
    const form = q('create-hospital-form');
    if (!form) return;
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, true);
      
      const payload = {
        name: q('hosp-name').value.trim(),
        address: q('hosp-address').value.trim(),
        latitude: Number(q('hosp-lat').value || 0),
        longitude: Number(q('hosp-lng').value || 0)
      };

      try {
        const result = await LifeDropApi.createHospital(payload);
        if (window.LifeDropUi) window.LifeDropUi.showToast('Hospital created successfully.', 'success');
        html('ch-result', `<div class="dash-card dash-card--success" style="margin-top:16px;padding:16px;"><strong>Created:</strong> ${result.name}<br/><strong>ID:</strong> ${result.hospitalId}</div>`);
        form.reset();
      } catch (error) {
        if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
        html('ch-result', `<div class="dash-card dash-card--danger" style="margin-top:16px;padding:16px;">Error: ${error.message}</div>`);
      } finally {
        if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, false);
      }
    });
  }

  function initSystemAdminCreateHospitalAdmin() {
    const form = q('create-hospital-admin-form');
    if (!form) return;
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, true);
      
      const payload = {
        email: q('ha-email').value.trim(),
        password: q('ha-password').value,
        firstName: q('ha-firstname').value.trim(),
        lastName: q('ha-lastname').value.trim(),
        hospitalId: q('ha-hospitalid').value.trim()
      };

      try {
        const result = await LifeDropApi.createHospitalAdmin(payload);
        if (window.LifeDropUi) window.LifeDropUi.showToast('Hospital Admin created successfully.', 'success');
        html('cha-result', `<div class="dash-card dash-card--success" style="margin-top:16px;padding:16px;"><strong>Admin Created:</strong> ${result.email}<br/><strong>User ID:</strong> ${result.userId}<br/><strong>Hospital ID:</strong> ${result.hospitalId}</div>`);
        form.reset();
      } catch (error) {
        if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
        html('cha-result', `<div class="dash-card dash-card--danger" style="margin-top:16px;padding:16px;">Error: ${error.message}</div>`);
      } finally {
        if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, false);
      }
    });
  }

  async function initEmployeeOnboarding() {
    // No GET /staff endpoint exists in the backend — staff list panel is intentionally left blank.
    const listEl = q('staff-list');
    if (listEl) listEl.innerHTML = '<div class="dash-muted" style="padding:8px 0;">Staff list not available — no backend list endpoint.</div>';

    const form = q('staff-form');
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, true);
      try {
        const password = q('staff-password').value;
        const confirmPassword = q('staff-confirm-password').value;

        if (password !== confirmPassword) {
          if (window.LifeDropUi) window.LifeDropUi.showToast('Passwords do not match.', 'error');
          if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, false);
          return;
        }

        const profile = await LifeDropApi.getHospitalProfile();
        const fullName = q('staff-full-name').value.trim();
        const parts = fullName.split(' ');
        
        const payload = {
          email: q('staff-email').value.trim(),
          password: password,
          firstName: parts[0] || 'Unknown',
          lastName: parts.slice(1).join(' ') || 'Unknown',
          hospitalId: profile.hospitalId
        };
        await LifeDropApi.createStaff(payload);
        if (window.LifeDropUi) window.LifeDropUi.showToast('Employee account created successfully.', 'success');
        form.reset();
      } catch (error) {
        if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
      } finally {
        if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, false);
      }
    });
  }

  async function initDonorCommunication() {
    try {
      const data = await LifeDropApi.getDonorCommunication();
      // data.items is list of DonorInteractionDto
      const listEl = q('dc-chat-list');
      if (!listEl) return;
      if (!data.items || data.items.length === 0) {
        listEl.innerHTML = '<div class="dash-muted">No donor communications found.</div>';
      } else {
        listEl.innerHTML = data.items.map(d => `<div class="dash-chat-bubble"><strong>${d.fullName}</strong><div class="dash-muted">Blood Type: ${d.bloodType} | Status: ${d.lastStatus}</div><div>Last Interaction: ${d.lastInteractionDate ? fmtDate(d.lastInteractionDate) : 'Never'}</div></div>`).join('');
      }
    } catch (error) {
      showError('dc-chat-list', error.message);
    }
  }

  async function initDonorVerification() {
    const params = new URLSearchParams(location.search);
    const requestId = params.get('requestId');
    const acceptanceId = params.get('acceptanceId');

    const errWrap = q('dv-error');
    const errText = q('dv-error-text');
    const content = q('dv-content');
    const footer = q('dv-footer');

    function showErrorMsg(msg) {
      if (errText) errText.textContent = msg;
      if (errWrap) errWrap.style.display = 'block';
      if (content) content.style.display = 'none';
      if (footer) footer.style.display = 'none';
      text('dv-acceptance-id', 'Error');
    }

    if (!requestId || !acceptanceId) {
      showErrorMsg('Missing requestId or acceptanceId in URL. Please navigate here from Request Details.');
      return;
    }

    try {
      const req = await LifeDropApi.getRequest(requestId);
      if (!req || !req.acceptances) throw new Error('Request details empty or missing acceptances.');

      const acceptance = req.acceptances.find(a => a.acceptanceId === acceptanceId);
      if (!acceptance) throw new Error('Acceptance not found in this request.');

      text('dv-acceptance-id', acceptanceId.slice(0, 8) + '...');
      text('dv-donor-name', acceptance.donorName);
      text('dv-phone-number', acceptance.phoneNumber);
      text('dv-blood-type', fmtBT(acceptance.bloodType));
      text('dv-status', fmtASt(acceptance.status));
      text('dv-accepted-at', fmtDate(acceptance.acceptedAt));
      text('dv-avatar', (acceptance.donorName || '?').substring(0, 2).toUpperCase());

      if (errWrap) errWrap.style.display = 'none';
      if (content) content.style.display = 'grid';
      if (footer) footer.style.display = 'flex';

      // Submit button remains disabled because we lack DonorUserId
      const btn = q('verify-submit-btn');
      if (btn) {
        btn.disabled = true;
        btn.classList.add('dash-btn--disabled');
        btn.title = 'Cannot verify: DonorUserId missing from API';
      }

    } catch (error) {
      showErrorMsg(error.message);
    }
  }

  async function initSettingsProfile() {
    const user = LifeDropApi.getCurrentUser();
    if (!user) return;

    try {
      // 1. Populate current user in the card
      text('sp-user-name', user.email || 'Admin User');
      text('sp-user-role', user.role === 'HospitalAdmin' ? 'Hospital Administrator' : user.role);
      text('sp-avatar', (user.email || 'A').substring(0, 1).toUpperCase());

      // 2. Fetch hospital profile
      const profile = await LifeDropApi.getHospitalProfile();
      if (!profile) throw new Error('Could not load hospital profile.');

      // 3. Populate read-only fields
      const nameInput = q('field-1');
      const addressInput = q('field-address');
      const latInput = q('field-2');
      const lonInput = q('field-3');

      if (nameInput) nameInput.value = profile.name || '';
      if (addressInput) addressInput.value = profile.address || 'Address not provided';
      if (latInput) latInput.value = profile.latitude || 0;
      if (lonInput) lonInput.value = profile.longitude || 0;

      text('sp-hospital-name', profile.name || 'Hospital Profile');

    } catch (error) {
      if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
    }
  }

  async function renderSidebar() {
    const nav = document.querySelector('.dash-nav');
    if (!nav) return;

    // Do not alter SystemAdmin pages
    const page = document.body.dataset.page || '';
    if (page.startsWith('system-admin')) return;

    const user = window.LifeDropApi && window.LifeDropApi.getCurrentUser();
    if (!user) return;

    const role = user.role;
    if (role === 'SystemAdmin') return;

    // ── 1. Role chip ──────────────────────────────────────────────────────────
    const chip = document.querySelector('.dash-user-chip');
    if (chip) chip.textContent = role === 'HospitalAdmin' ? 'Hospital Admin' : 'Employee';

    // ── 2. Brand subtitle: hospital name from API ─────────────────────────────
    const brandSubtitle = document.querySelector('.dash-brand__subtitle');
    if (brandSubtitle) {
      brandSubtitle.textContent = 'Loading…';
      try {
        const profile = await LifeDropApi.getHospitalProfile();
        brandSubtitle.textContent = (profile && profile.name) ? profile.name : 'Hospital Portal';
      } catch (_) {
        brandSubtitle.textContent = 'Hospital Portal';
      }
    }

    // ── 3. Hide dead Emergency buttons (TODO: wire to Critical request flow) ──
    document.querySelectorAll('.dash-btn--danger').forEach(function (btn) {
      if (btn.textContent.trim() === 'Emergency') {
        // TODO: Wire Emergency to inline Critical request creation when form is merged into request-management
        btn.style.display = 'none';
      }
    });

    // ── 4. Build nav per role ─────────────────────────────────────────────────
    const p = window.location.pathname;

    let navHtml = `
      <a class="dash-nav__item ${p.includes('dashboard-overview.html') ? 'is-active' : ''}" href="../requester/dashboard-overview.html">Dashboard</a>
      <a class="dash-nav__item ${p.includes('request-management.html') ? 'is-active' : ''}" href="../requester/request-management.html">Request Management</a>
    `;

    if (p.includes('request-details.html')) {
      navHtml += `<a class="dash-nav__item is-active" href="#">Request Details</a>`;
    }

    navHtml += `<a class="dash-nav__item ${p.includes('donor-verification.html') ? 'is-active' : ''}" href="../requester/donor-verification.html">Donor Verification</a>`;

    if (role === 'HospitalAdmin') {
      navHtml += `
        <a class="dash-nav__item ${p.includes('reports-analytics.html') ? 'is-active' : ''}" href="../requester/reports-analytics.html">Reports</a>
        <a class="dash-nav__item ${p.includes('settings-profile.html') ? 'is-active' : ''}" href="../requester/settings-profile.html">Settings / Profile</a>
        <div style="margin:16px 12px 8px;font-size:0.75rem;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:0.06em;">Admin</div>
        <a class="dash-nav__item ${p.includes('employee-onboarding.html') ? 'is-active' : ''}" href="../hospital-admin/employee-onboarding.html">Employee Onboarding</a>
      `;
    }

    nav.innerHTML = navHtml;

    // ── 5. Wire Logout ────────────────────────────────────────────────────────
    const logoutBtn = document.getElementById('sidebar-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function (e) {
        e.preventDefault();
        LifeDropApi.clearTokens();
        window.location.href = '../auth/login.html';
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const page = document.body.dataset.page;
    renderSidebar(); // async — runs concurrently with page init; no await needed here

    if (page === 'dashboard-overview') initDashboardOverview();
    if (page === 'request-management') initRequestManagement();
    if (page === 'new-request') initNewRequest();
    if (page === 'request-details') initRequestDetails();
    if (page === 'reports-analytics') initReportsAnalytics();
    if (page === 'hospital-management') initHospitalManagement();
    if (page === 'global-settings') initGlobalSettings();
    if (page === 'audit-logs') initAuditLogs();
    if (page === 'global-operations') initGlobalOperations();
    if (page === 'employee-onboarding') initEmployeeOnboarding();
    if (page === 'donor-communication') initDonorCommunication();
    if (page === 'donor-verification') initDonorVerification();
    if (page === 'settings-profile') initSettingsProfile();

    if (page === 'system-admin-dashboard') initSystemAdminDashboard();
    if (page === 'system-admin-create-hospital') initSystemAdminCreateHospital();
    if (page === 'system-admin-create-hospital-admin') initSystemAdminCreateHospitalAdmin();
  });
})();
