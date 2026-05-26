
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
    html(targetId, `<div class="dash-card"><div class="dash-card__body"><strong>Could not load this section.</strong><p class="dash-subtitle">${message}</p><p class="dash-subtitle">Please try again in a moment.</p></div></div>`);
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

  function normalizeToken(value) {
    return String(value ?? '').replace(/_/g, '').replace(/\s+/g, '').replace(/-/g, '').toLowerCase();
  }
  function fmtBT(v)  { return BT[v]  ?? String(v ?? '--').replace('_Positive', '+').replace('_Negative', '-'); }
  function fmtUrg(v) { return URG[v] ?? String(v ?? '--'); }
  function fmtRSt(v) { return RST[v] ?? String(v ?? '--'); }
  function fmtASt(v) { return AST[v] ?? String(v ?? '--'); }
  function urgClass(v) {
    const n = normalizeToken(v);
    if (v === 2 || n === 'critical') return 'dash-badge--critical';
    if (v === 1 || n === 'urgent') return 'dash-badge--urgent';
    return 'dash-badge--normal';
  }
  function statusClass(v) {
    const n = normalizeToken(v);
    if (n === 'cancelled' || n === 'canceled' || n === 'expired' || n === 'inactive') return 'dash-badge--critical';
    if (n === 'fulfilled' || n === 'active') return 'dash-badge--success';
    return 'dash-badge--normal';
  }
  function isActiveStatus(v) { return v === 0 || normalizeToken(v) === 'active'; }
  function isCriticalUrgency(v) { return v === 2 || normalizeToken(v) === 'critical'; }
  function requestRow(req) {
    const pct = Math.min(Math.round(req.fulfillmentPercentage || 0), 100);
    const id = req.requestId || '';
    const shortId = id ? `${id.slice(0, 8)}...` : '--';
    return `
      <tr>
        <td class="dash-muted" style="font-size:0.75em;">${shortId}</td>
        <td><strong>${fmtBT(req.bloodType)}</strong><div class="dash-muted">${fmtRSt(req.status)}</div></td>
        <td><span class="dash-badge ${urgClass(req.urgency)}">${fmtBT(req.bloodType)}</span></td>
        <td><span class="dash-badge ${urgClass(req.urgency)}">${fmtUrg(req.urgency)}</span></td>
        <td><strong>${req.currentFulfilledAcceptances || 0}/${req.targetQuota || 0}</strong>
          <div class="dash-progress"><div class="dash-progress__bar ${pct < 35 ? 'is-danger' : pct >= 100 ? 'is-success' : ''}" style="width:${pct}%"></div></div>
        </td>
        <td>${req.createdAt ? fmtDate(req.createdAt) : '--'}</td>
        <td><a class="dash-link-alert" href="request-details.html?id=${id}">View</a></td>
      </tr>`;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function safeRatio(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }
  const chartInstances = {};
  function destroyChart(key) {
    if (chartInstances[key]) {
      chartInstances[key].destroy();
      chartInstances[key] = null;
    }
  }
  function hasChartJs() {
    return typeof window.Chart !== 'undefined';
  }
  function setIndicator(id, ratio, tone) {
    const el = q(id);
    if (!el) return;
    const width = safeRatio(ratio);
    el.style.width = `${width}%`;
    el.className = tone ? `is-${tone}` : '';
  }
  function debounce(fn, wait) {
    let timer = null;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, arguments), wait);
    };
  }
  function hasHospitalAdminEmployeeActivation() {
    if (!window.LifeDropApi) return false;
    const activate = window.LifeDropApi.activateEmployee;
    const deactivate = window.LifeDropApi.deactivateEmployee;
    if (typeof activate !== 'function' || typeof deactivate !== 'function') return false;
    return !/Promise\.reject/.test(String(activate)) && !/Promise\.reject/.test(String(deactivate));
  }

  async function initDashboardOverview() {
    // GET /api/Hospitals/dashboard/overview → DashboardOverviewDto
    // Real fields: activeRequestsCount, fulfilledRequestsCount, canceledRequestsCount,
    //              completionRate, totalBloodBagsCollected,
    //              activeRequestsProgress[], recentActivities[]
    // NOT in DTO: critical, urgent, activeHospitals, activeDonors
    async function loadOverviewData() {
      const data = await LifeDropApi.getDashboardOverview() || {};

      text('ov-active',    fmtNumber(data.activeRequestsCount));
      text('ov-fulfilled', fmtNumber(data.fulfilledRequestsCount));
      text('ov-cancelled', fmtNumber(data.canceledRequestsCount));
      text('ov-completion', `${Number(data.completionRate || 0).toFixed(1)}%`);
      text('ov-bags',      fmtNumber(data.totalBloodBagsCollected));
      const totalRequestsBase = Number(data.activeRequestsCount || 0) + Number(data.fulfilledRequestsCount || 0) + Number(data.canceledRequestsCount || 0);
      setIndicator('ov-active-ind', totalRequestsBase > 0 ? (Number(data.activeRequestsCount || 0) / totalRequestsBase) * 100 : 0, 'normal');
      setIndicator('ov-fulfilled-ind', totalRequestsBase > 0 ? (Number(data.fulfilledRequestsCount || 0) / totalRequestsBase) * 100 : 0, 'success');
      setIndicator('ov-cancelled-ind', totalRequestsBase > 0 ? (Number(data.canceledRequestsCount || 0) / totalRequestsBase) * 100 : 0, 'danger');
      setIndicator('ov-completion-ind', safeRatio(Number(data.completionRate || 0)), 'success');
      setIndicator('ov-bags-ind', safeRatio((Number(data.totalBloodBagsCollected || 0) / Math.max(1, totalRequestsBase)) * 20), 'normal');

      const chartAvailable = hasChartJs();
      const reports = await LifeDropApi.getReports().catch(() => null);
      const monthlyRaw = reports && Array.isArray(reports.monthlyDonationStats) ? reports.monthlyDonationStats : [];
      const monthly = monthlyRaw.slice(-6);
      const monthlyChartHost = q('ov-chart-bars');
      const monthlyChartCard = monthlyChartHost && monthlyChartHost.closest('article');
      if (!monthly.length) {
        destroyChart('ov-monthly');
        if (monthlyChartHost) monthlyChartHost.innerHTML = '<div class="dash-empty-inline">No monthly trend data available.</div>';
      } else if (chartAvailable) {
        if (monthlyChartHost && !q('ov-monthly-chart')) monthlyChartHost.innerHTML = '<canvas id="ov-monthly-chart" aria-label="Monthly donation trend chart"></canvas>';
        const ctx = q('ov-monthly-chart');
        if (ctx) {
          destroyChart('ov-monthly');
          const labels = monthly.map(m => String(m.month || '--'));
          const values = monthly.map(m => Number(m.donationCount || 0));
          chartInstances['ov-monthly'] = new window.Chart(ctx, {
            type: 'bar',
            data: {
              labels,
              datasets: [{
                label: 'Donations',
                data: values,
                borderRadius: 8,
                borderSkipped: false,
                backgroundColor: 'rgba(13, 86, 166, 0.78)',
                hoverBackgroundColor: 'rgba(13, 86, 166, 0.95)'
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { grid: { display: false }, ticks: { color: '#7c8aa0' } },
                y: { beginAtZero: true, ticks: { precision: 0, color: '#7c8aa0' }, grid: { color: 'rgba(124,138,160,0.18)' } }
              },
              plugins: { legend: { display: false } }
            }
          });
        }
      } else if (monthlyChartHost) {
        monthlyChartHost.innerHTML = '<div class="dash-empty-inline">Chart library unavailable.</div>';
      }

      const mixRaw = reports && Array.isArray(reports.bloodTypeDistribution) ? reports.bloodTypeDistribution : [];
      const mix = mixRaw.slice(0, 8);
      const mixHost = q('ov-blood-mix');
      const mixChartCard = mixHost && mixHost.closest('aside');
      const legendHost = q('ov-blood-mix-legend');
      if (!mix.length) {
        destroyChart('ov-blood');
        if (mixHost) mixHost.innerHTML = '<div class="dash-empty-inline">No blood type distribution data available.</div>';
        if (legendHost) legendHost.innerHTML = '';
      } else if (chartAvailable) {
        if (mixHost && !q('ov-blood-chart')) mixHost.innerHTML = '<canvas id="ov-blood-chart" aria-label="Blood type mix chart"></canvas>';
        const ctx = q('ov-blood-chart');
        if (ctx) {
          destroyChart('ov-blood');
          const labels = mix.map(item => fmtBT(item.bloodType));
          const values = mix.map(item => Number(item.count || 0));
          const colors = ['#0d56a6', '#5f8fd2', '#1f9d7a', '#c96a14', '#c91726', '#7a57d1', '#0f766e', '#64748b'];
          chartInstances['ov-blood'] = new window.Chart(ctx, {
            type: 'doughnut',
            data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 1, borderColor: '#ffffff' }] },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              cutout: '62%',
              plugins: { legend: { display: false } }
            }
          });
          if (legendHost) {
            legendHost.innerHTML = mix.map((item, idx) => {
              const bloodType = fmtBT(item.bloodType);
              const count = Number(item.count || 0);
              const pctValue = Number(item.percentage);
              return `<div class="dash-metric-item dash-metric-item--chart">
                <div class="dash-metric-item__top">
                  <strong><span class="dash-dot-swatch" style="background:${colors[idx % colors.length]}"></span>${escapeHtml(bloodType)}</strong>
                  <span>${fmtNumber(count)}${Number.isFinite(pctValue) ? ` (${pctValue.toFixed(1)}%)` : ''}</span>
                </div>
              </div>`;
            }).join('');
          }
        }
      } else {
        if (mixHost) mixHost.innerHTML = '<div class="dash-empty-inline">Chart library unavailable.</div>';
        if (legendHost) legendHost.innerHTML = '';
      }

      const hasMonthlyAnalytics = monthly.length > 0;
      const hasBloodMixAnalytics = mix.length > 0;
      const optionalAnalyticsWrap = q('overview-feed-wrap');
      if (monthlyChartCard) monthlyChartCard.style.display = hasMonthlyAnalytics ? '' : 'none';
      if (mixChartCard) mixChartCard.style.display = hasBloodMixAnalytics ? '' : 'none';
      if (optionalAnalyticsWrap) optionalAnalyticsWrap.style.display = (hasMonthlyAnalytics || hasBloodMixAnalytics) ? '' : 'none';

      const statusWrap = q('ov-status-wrap');
      const statusValues = [
        Number(data.activeRequestsCount || 0),
        Number(data.fulfilledRequestsCount || 0),
        Number(data.canceledRequestsCount || 0)
      ];
      const hasStatusData = statusValues.some(v => v > 0);
      if (!hasStatusData) {
        destroyChart('ov-status');
        if (statusWrap) statusWrap.innerHTML = '<div class="dash-empty-inline">No request status data available.</div>';
      } else if (chartAvailable) {
        if (statusWrap && !q('ov-status-chart')) statusWrap.innerHTML = '<canvas id="ov-status-chart" aria-label="Request status overview chart"></canvas>';
        const statusCtx = q('ov-status-chart');
        if (statusCtx) {
          destroyChart('ov-status');
          chartInstances['ov-status'] = new window.Chart(statusCtx, {
            type: 'pie',
            data: {
              labels: ['Active', 'Fulfilled', 'Canceled'],
              datasets: [{ data: statusValues, backgroundColor: ['#0d56a6', '#1f9d7a', '#c91726'] }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: 'bottom' }, tooltip: { enabled: true } }
            }
          });
        }
      } else if (statusWrap) {
        statusWrap.innerHTML = '<div class="dash-empty-inline">Chart library unavailable.</div>';
      }

      const completionWrap = q('ov-completion-wrap');
      const completionLabel = q('ov-completion-gauge-label');
      const completionRate = safeRatio(Number(data.completionRate || 0));
      if (completionLabel) completionLabel.textContent = `${completionRate.toFixed(1)}%`;
      if (completionRate <= 0 && totalRequestsBase <= 0) {
        destroyChart('ov-completion');
        if (completionWrap) completionWrap.innerHTML = '<div class="dash-empty-inline">No completion data available.</div>';
      } else if (chartAvailable) {
        if (completionWrap && !q('ov-completion-chart')) {
          completionWrap.innerHTML = '<canvas id="ov-completion-chart" aria-label="Completion rate gauge chart"></canvas><div class="dash-gauge-center" id="ov-completion-gauge-label"></div>';
          const rebuiltLabel = q('ov-completion-gauge-label');
          if (rebuiltLabel) rebuiltLabel.textContent = `${completionRate.toFixed(1)}%`;
        }
        const completionCtx = q('ov-completion-chart');
        if (completionCtx) {
          destroyChart('ov-completion');
          chartInstances['ov-completion'] = new window.Chart(completionCtx, {
            type: 'doughnut',
            data: {
              labels: ['Completed', 'Remaining'],
              datasets: [{
                data: [completionRate, Math.max(0, 100 - completionRate)],
                backgroundColor: ['#1f9d7a', 'rgba(124, 138, 160, 0.22)'],
                borderWidth: 0
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              cutout: '74%',
              rotation: -90,
              circumference: 180,
              plugins: { legend: { display: false }, tooltip: { enabled: true } }
            }
          });
        }
      } else if (completionWrap) {
        completionWrap.innerHTML = '<div class="dash-empty-inline">Chart library unavailable.</div>';
      }

      const recentPaged = await LifeDropApi.getRequests(1, 5).catch(() => null);
      const recentRequests = (recentPaged && recentPaged.data) || [];
      html('overview-requests-body', recentRequests.length
        ? recentRequests.map(requestRow).join('')
        : '<tr><td colspan="7" class="dash-muted">No recent requests.</td></tr>');
    }

    try {
      await loadOverviewData();
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

    if (window.LifeDropRealtime && user && (user.role === 'HospitalAdmin' || user.role === 'HospitalEmployee')) {
      const refreshDebounced = debounce(async function () {
        try { await loadOverviewData(); } catch (_) {}
      }, 500);
      window.LifeDropRealtime.start();
      window.LifeDropRealtime.on('DashboardUpdated', function (payload) {
        if (!payload) return;
        text('ov-active', fmtNumber(payload.activeRequests));
        text('ov-fulfilled', fmtNumber(payload.fulfilledRequests));
        text('ov-cancelled', fmtNumber(payload.canceledRequests));
        text('ov-completion', `${Number(payload.completionRate || 0).toFixed(1)}%`);
        text('ov-bags', fmtNumber(payload.totalBags));
        if (window.LifeDropUi && window.LifeDropUi.showToast) {
          window.LifeDropUi.showToast('Dashboard updated.', 'success');
        }
        refreshDebounced();
      });
      window.LifeDropRealtime.on('RequestAccepted', function (payload) {
        if (window.LifeDropUi && window.LifeDropUi.showToast) {
          window.LifeDropUi.showToast(`Donor accepted request ${String(payload && payload.requestId || '').slice(0, 8)}...`, 'success');
        }
        refreshDebounced();
      });
      window.LifeDropRealtime.on('RequestUpdated', function () {
        if (window.LifeDropUi && window.LifeDropUi.showToast) {
          window.LifeDropUi.showToast('Request updated.', 'success');
        }
        refreshDebounced();
      });
      window.LifeDropRealtime.on('AcceptanceUpdated', function () {
        if (window.LifeDropUi && window.LifeDropUi.showToast) {
          window.LifeDropUi.showToast('Acceptance status updated.', 'success');
        }
        refreshDebounced();
      });
    }

    function initEmployeeManagement() {
      let currentPage = 1;
      let pageSize = 5;
      let currentSearch = '';
      let searchTimeout = null;
      let showPhoneColumn = false;

      const tbody = q('emp-table-body');
      const table = tbody ? tbody.closest('table') : null;
      const phoneHeader = table ? table.querySelector('[data-col="phone"]') : null;
      const searchInput = q('emp-search');
      const prevBtn = q('emp-prev-btn');
      const nextBtn = q('emp-next-btn');
      const pageIndicator = q('emp-page-indicator');
      const modal = q('emp-details-modal');
      const modalClose = q('emp-modal-close');
      const modalContent = q('emp-modal-content');
      const activationNote = q('emp-activation-note');
      const activationAvailable = hasHospitalAdminEmployeeActivation();

      if (activationNote) {
        activationNote.textContent = activationAvailable ? '' : 'Employee activation controls are currently unavailable for hospital administrators.';
      }

      if (modalClose && modal) {
        modalClose.setAttribute('type', 'button');
        modalClose.addEventListener('click', () => modal.close());
      }

      if (modal) {
        modal.addEventListener('click', function (event) {
          const rect = modal.getBoundingClientRect();
          const inside =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;
          if (!inside) modal.close();
        });
      }

      function hasPhoneField(item) {
        return item && Object.prototype.hasOwnProperty.call(item, 'phoneNumber');
      }

      function applyPhoneColumnVisibility() {
        if (phoneHeader) phoneHeader.style.display = showPhoneColumn ? '' : 'none';
        if (!tbody) return;
        tbody.querySelectorAll('.emp-phone-cell').forEach(cell => {
          cell.style.display = showPhoneColumn ? '' : 'none';
        });
      }

      async function loadData() {
        try {
          if (tbody) tbody.innerHTML = `<tr><td colspan="${showPhoneColumn ? 7 : 6}" class="dash-muted" style="text-align: center; padding: 24px;">Loading employees...</td></tr>`;
          
          const response = await LifeDropApi.getEmployees(currentPage, pageSize, currentSearch);
          const items = (response && response.data) || [];
          const totalPages = response ? response.totalPages : 1;
          const pageNum = response ? response.pageNumber : 1;
          showPhoneColumn = items.some(hasPhoneField);

          if (pageIndicator) pageIndicator.textContent = `Page ${pageNum} of ${totalPages || 1}`;
          
          if (prevBtn) prevBtn.disabled = pageNum <= 1;
          if (nextBtn) nextBtn.disabled = pageNum >= totalPages;

          if (!items.length) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="${showPhoneColumn ? 7 : 6}" class="dash-muted" style="text-align: center; padding: 24px;">No employees found.</td></tr>`;
            applyPhoneColumnVisibility();
            return;
          }

          if (tbody) {
            tbody.innerHTML = items.map(emp => {
              const activeClass = emp.isActive ? 'dash-badge--normal' : 'dash-badge--critical';
              const activeLabel = emp.isActive ? 'Active' : 'Inactive';
              return `<tr>
                <td><strong>${emp.firstName} ${emp.lastName}</strong></td>
                <td>${emp.email}</td>
                <td class="emp-phone-cell">${emp.phoneNumber || '--'}</td>
                <td>${emp.role}</td>
                <td><span class="dash-badge ${activeClass}">${activeLabel}</span></td>
                <td>${fmtDate(emp.createdOn)}</td>
                <td style="display:flex; gap:8px;">
                  <button class="dash-btn dash-btn--secondary dash-btn--xs view-emp-btn" data-id="${emp.employeeProfileId}">View</button>
                </td>
              </tr>`;
            }).join('');
            applyPhoneColumnVisibility();

            document.querySelectorAll('.view-emp-btn').forEach(btn => {
              btn.addEventListener('click', () => openDetails(btn.dataset.id));
            });
          }
        } catch (error) {
          if (tbody) {
            let displayMsg = error.message;
            if (displayMsg.includes('401')) displayMsg = 'Unauthorized. Please login again.';
            else if (displayMsg.includes('403')) displayMsg = 'Forbidden. You do not have access to view employees.';
            else if (displayMsg.includes('404')) displayMsg = 'Employees not found.';
            else if (displayMsg.includes('429')) displayMsg = 'Too many requests. Please try again later.';
            tbody.innerHTML = `<tr><td colspan="${showPhoneColumn ? 7 : 6}" class="dash-muted is-danger" style="text-align: center; padding: 24px;">${displayMsg}</td></tr>`;
            applyPhoneColumnVisibility();
          }
        }
      }

      async function openDetails(id) {
        if (!modal) return;
        if (!modal.open) {
          if (typeof modal.showModal === 'function') modal.showModal();
          else modal.setAttribute('open', 'open');
        }
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
    const showAllBtn = q('rm-show-all-btn');
    let showAllRequests = false;

    async function loadTable() {
      try {
        const paged = await LifeDropApi.getRequests();
        const reqs  = (paged && paged.data) || [];
        const visibleReqs = showAllRequests ? reqs : reqs.slice(0, 5);

        const activeCount = reqs.filter(r => isActiveStatus(r.status)).length;
        const criticalCount = reqs.filter(r => isCriticalUrgency(r.urgency)).length;
        const avgProgress = reqs.length
          ? Math.round(reqs.reduce((sum, r) => sum + (r.fulfillmentPercentage || 0), 0) / reqs.length)
          : 0;
        text('rm-active-count', activeCount);
        text('rm-avg-progress', `${avgProgress}%`);
        text('rm-critical-gap', criticalCount);

        html('requests-table-body', visibleReqs.length
          ? visibleReqs.map(requestRow).join('')
          : '<tr><td colspan="7" class="dash-muted">No requests found.</td></tr>');
        if (showAllBtn) {
          showAllBtn.style.display = reqs.length > 5 ? 'inline-flex' : 'none';
          showAllBtn.textContent = showAllRequests ? 'Show less' : `Show all (${reqs.length})`;
        }
      } catch (error) {
        showError('requests-table-wrap', error.message);
      }
    }

    await loadTable();

    if (new URLSearchParams(location.search).get('new') === '1') {
      const panel = q('rm-new-request-panel');
      if (panel) panel.setAttribute('open', '');
    }

    await initNewRequestForm('rm-new-request-form', async function () {
      const panel = q('rm-new-request-panel');
      if (panel) panel.removeAttribute('open');
      await loadTable();
    });

    if (showAllBtn) {
      showAllBtn.addEventListener('click', async function () {
        showAllRequests = !showAllRequests;
        await loadTable();
      });
    }

    const user = window.LifeDropApi && window.LifeDropApi.getCurrentUser();
    if (window.LifeDropRealtime && user && (user.role === 'HospitalAdmin' || user.role === 'HospitalEmployee')) {
      const refreshDebounced = debounce(loadTable, 500);
      window.LifeDropRealtime.start();
      window.LifeDropRealtime.on('RequestAccepted', function () {
        if (window.LifeDropUi && window.LifeDropUi.showToast) window.LifeDropUi.showToast('Donor accepted a request.', 'success');
        refreshDebounced();
      });
      window.LifeDropRealtime.on('RequestUpdated', function () {
        if (window.LifeDropUi && window.LifeDropUi.showToast) window.LifeDropUi.showToast('Request updated.', 'success');
        refreshDebounced();
      });
      window.LifeDropRealtime.on('AcceptanceUpdated', function () {
        if (window.LifeDropUi && window.LifeDropUi.showToast) window.LifeDropUi.showToast('Acceptance updated.', 'success');
        refreshDebounced();
      });
    }
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

    const user = window.LifeDropApi && window.LifeDropApi.getCurrentUser();
    if (window.LifeDropRealtime && user && (user.role === 'HospitalAdmin' || user.role === 'HospitalEmployee')) {
      const refreshDebounced = debounce(async function () {
        try { await loadDetails(); } catch (_) {}
      }, 400);
      window.LifeDropRealtime.start();
      const requestIdLower = String(id).toLowerCase();
      window.LifeDropRealtime.on('RequestAccepted', function (payload) {
        if (!payload || String(payload.requestId || '').toLowerCase() !== requestIdLower) return;
        if (window.LifeDropUi && window.LifeDropUi.showToast) window.LifeDropUi.showToast('Donor accepted this request.', 'success');
        refreshDebounced();
      });
      window.LifeDropRealtime.on('RequestUpdated', function (payload) {
        if (!payload || String(payload.requestId || '').toLowerCase() !== requestIdLower) return;
        if (window.LifeDropUi && window.LifeDropUi.showToast) window.LifeDropUi.showToast('This request was updated.', 'success');
        refreshDebounced();
      });
      window.LifeDropRealtime.on('AcceptanceUpdated', function (payload) {
        if (!payload || String(payload.requestId || '').toLowerCase() !== requestIdLower) return;
        if (window.LifeDropUi && window.LifeDropUi.showToast) window.LifeDropUi.showToast('Acceptance changed on this request.', 'success');
        refreshDebounced();
      });
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
    showError('global-settings-root', 'Global settings are currently unavailable.');
  }

  function initAuditLogs() {
    // Backend endpoint does not exist — no /AuditLogs controller implemented.
    showError('audit-root', 'Audit logs are currently unavailable.');
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
      const donors = Number(data.totalDonors || 0);
      const hospitalsTotal = Number(data.totalHospitals || 0);
      const requestsTotal = Number(data.totalDonationRequests || 0);
      const bagsTotal = Number(data.totalBloodBagsCollected || 0);
      const maxBase = Math.max(donors, hospitalsTotal, requestsTotal, bagsTotal, 1);
      setIndicator('sa-donors-ind', (donors / maxBase) * 100, 'normal');
      setIndicator('sa-hospitals-ind', (hospitalsTotal / maxBase) * 100, 'normal');
      setIndicator('sa-requests-ind', (requestsTotal / maxBase) * 100, 'danger');
      setIndicator('sa-bags-ind', (bagsTotal / maxBase) * 100, 'success');
      const regions = Array.isArray(data.requestsByGovernorate) ? data.requestsByGovernorate : [];
      const sortedRegions = regions
        .map(r => ({ governorateName: r.governorateName || '--', requestCount: Number(r.requestCount || 0) }))
        .sort((a, b) => b.requestCount - a.requestCount);
      const maxRegionCount = sortedRegions.reduce((max, r) => Math.max(max, r.requestCount), 0);
      html('sa-regions', sortedRegions.length ? sortedRegions.map((r, idx) => {
        const barWidth = maxRegionCount > 0 ? safeRatio((r.requestCount / maxRegionCount) * 100) : 0;
        return `
          <div class="sa-region-row">
            <div class="sa-region-head">
              <div class="sa-region-name" dir="auto">${escapeHtml(r.governorateName)}</div>
              <div class="sa-region-count">${fmtNumber(r.requestCount)}</div>
            </div>
            <div class="sa-region-bar"><span style="width:${barWidth}%;"></span></div>
            <div class="sa-region-meta">Rank #${idx + 1}</div>
          </div>
        `;
      }).join('') : '<div class="dash-empty-inline">No governorate request data available.</div>');

      const regionsChartWrap = q('sa-regions-chart') ? q('sa-regions-chart').parentElement : null;
      const regionsChartEl = q('sa-regions-chart');
      if (hasChartJs() && regionsChartEl) {
        destroyChart('sa-regions');
        if (sortedRegions.length) {
          chartInstances['sa-regions'] = new window.Chart(regionsChartEl, {
            type: 'bar',
            data: {
              labels: sortedRegions.slice(0, 8).map(r => r.governorateName),
              datasets: [{
                label: 'Requests',
                data: sortedRegions.slice(0, 8).map(r => r.requestCount),
                backgroundColor: 'rgba(13, 86, 166, 0.78)',
                borderRadius: 8,
                borderSkipped: false
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { display: false }, ticks: { color: '#7c8aa0' } },
                y: { beginAtZero: true, ticks: { precision: 0, color: '#7c8aa0' }, grid: { color: 'rgba(124,138,160,0.18)' } }
              }
            }
          });
        } else if (regionsChartWrap) {
          regionsChartWrap.innerHTML = '<div class="dash-empty-inline">No region distribution data available.</div>';
        }
      } else if (regionsChartWrap) {
        regionsChartWrap.innerHTML = '<div class="dash-empty-inline">Chart library unavailable.</div>';
      }

      const mixChartWrap = q('sa-mix-chart') ? q('sa-mix-chart').parentElement : null;
      const mixChartEl = q('sa-mix-chart');
      if (hasChartJs() && mixChartEl) {
        destroyChart('sa-mix');
        if (donors || hospitalsTotal || requestsTotal || bagsTotal) {
          chartInstances['sa-mix'] = new window.Chart(mixChartEl, {
            type: 'doughnut',
            data: {
              labels: ['Donors', 'Hospitals', 'Requests', 'Bags'],
              datasets: [{
                data: [donors, hospitalsTotal, requestsTotal, bagsTotal],
                backgroundColor: ['#0d56a6', '#5f8fd2', '#c91726', '#1f9d7a'],
                borderColor: '#ffffff',
                borderWidth: 1
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              cutout: '64%',
              plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } } }
            }
          });
        } else if (mixChartWrap) {
          mixChartWrap.innerHTML = '<div class="dash-empty-inline">No system mix data available.</div>';
        }
      } else if (mixChartWrap) {
        mixChartWrap.innerHTML = '<div class="dash-empty-inline">Chart library unavailable.</div>';
      }
    } catch (error) {
      showError('sa-dashboard-root', error.message);
    }

    const saHospitalsTbody = q('sa-hospitals-tbody');
    const showAllBtn = q('sa-show-all-hospitals');
    let hospitals = [];
    let showAllHospitals = false;

    function renderAdminHospitals() {
      if (!saHospitalsTbody) return;
      if (!hospitals.length) {
        saHospitalsTbody.innerHTML = '<tr><td colspan="4" class="dash-muted" style="text-align:center;padding:24px;">No hospitals found.</td></tr>';
        if (showAllBtn) showAllBtn.style.display = 'none';
        return;
      }

      const visibleHospitals = showAllHospitals ? hospitals : hospitals.slice(0, 5);
      saHospitalsTbody.innerHTML = visibleHospitals.map(h => {
        const activeClass = h.isActive ? 'dash-badge--normal' : 'dash-badge--critical';
        const activeLabel = h.isActive ? 'Active' : 'Inactive';
        const toggleBtnLabel = h.isActive ? 'Deactivate' : 'Activate';
        const toggleBtnClass = h.isActive ? 'dash-btn--danger' : 'dash-btn--success';
        return `<tr>
          <td><strong>${h.name}</strong><div class="dash-muted">${h.hospitalId}</div></td>
          <td>${h.address || '--'}</td>
          <td><span class="dash-badge ${activeClass}">${activeLabel}</span></td>
          <td class="dash-table-actions">
            <a class="dash-btn dash-btn--primary dash-btn--xs" href="create-hospital-admin.html?hospitalId=${encodeURIComponent(h.hospitalId)}">Create Admin</a>
            <a class="dash-btn dash-btn--secondary dash-btn--xs" href="hospital-employees.html?hospitalId=${h.hospitalId}&name=${encodeURIComponent(h.name || '')}">Employees</a>
            <button class="dash-btn ${toggleBtnClass} dash-btn--xs sa-toggle-hosp-btn" data-id="${h.hospitalId}" data-active="${h.isActive}">${toggleBtnLabel}</button>
          </td>
        </tr>`;
      }).join('');

      if (showAllBtn) {
        showAllBtn.style.display = hospitals.length > 5 ? 'inline-flex' : 'none';
        showAllBtn.textContent = showAllHospitals ? 'Show less' : `Show all (${hospitals.length})`;
      }

      document.querySelectorAll('.sa-toggle-hosp-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const button = e.currentTarget;
          const id = button.dataset.id;
          const isActive = button.dataset.active === 'true';
          try {
            button.disabled = true;
            if (isActive) await LifeDropApi.deactivateHospital(id);
            else await LifeDropApi.activateHospital(id);
            const updated = hospitals.find(h => h.hospitalId === id);
            if (updated) updated.isActive = !isActive;
            renderAdminHospitals();
          } catch (error) {
            alert(error.message);
            button.disabled = false;
          }
        });
      });
    }

    async function loadAdminHospitals() {
      if (!saHospitalsTbody) return;
      try {
        hospitals = await LifeDropApi.getHospitals() || [];
        renderAdminHospitals();
      } catch (error) {
        saHospitalsTbody.innerHTML = `<tr><td colspan="4" class="dash-muted is-danger" style="text-align:center;padding:24px;">Error: ${error.message}</td></tr>`;
      }
    }

    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        showAllHospitals = !showAllHospitals;
        renderAdminHospitals();
      });
    }

    loadAdminHospitals();
  }

  async function initSystemAdminHospitalEmployees() {
    const params = new URLSearchParams(location.search);
    const hospitalId = params.get('hospitalId');
    const hospitalName = params.get('name') || 'Hospital';
    const tbody = q('sa-hospital-employees-tbody');
    const titleEl = q('sa-hospital-employees-title');
    const subtitleEl = q('sa-hospital-employees-subtitle');
    const showAllBtn = q('sa-show-all-employees');
    let employees = [];
    let showAllEmployees = false;

    if (titleEl) titleEl.textContent = `${hospitalName} Employees`;
    if (subtitleEl) subtitleEl.textContent = hospitalId ? `Hospital ID: ${hospitalId}` : 'Missing hospital ID.';

    if (!hospitalId) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="dash-muted is-danger" style="text-align:center;padding:24px;">Missing hospitalId in the URL. Return to the dashboard and open employees from a hospital row.</td></tr>';
      return;
    }

    function renderEmployees() {
      if (!tbody) return;
      if (!employees.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="dash-muted" style="text-align:center;padding:24px;">No employees found.</td></tr>';
        if (showAllBtn) showAllBtn.style.display = 'none';
        return;
      }

      const visibleEmployees = showAllEmployees ? employees : employees.slice(0, 5);
      tbody.innerHTML = visibleEmployees.map(emp => {
        const activeClass = emp.isActive ? 'dash-badge--normal' : 'dash-badge--critical';
        const activeLabel = emp.isActive ? 'Active' : 'Inactive';
        const toggleBtnLabel = emp.isActive ? 'Deactivate' : 'Activate';
        const toggleBtnClass = emp.isActive ? 'dash-btn--danger' : 'dash-btn--success';
        return `<tr>
          <td><strong>${emp.firstName} ${emp.lastName}</strong></td>
          <td>${emp.email}</td>
          <td>${emp.role || '--'}</td>
          <td><span class="dash-badge ${activeClass}">${activeLabel}</span></td>
          <td class="dash-table-actions"><button class="dash-btn ${toggleBtnClass} dash-btn--xs sa-toggle-emp-btn" data-id="${emp.employeeProfileId}" data-active="${emp.isActive}">${toggleBtnLabel}</button></td>
        </tr>`;
      }).join('');

      document.querySelectorAll('.sa-toggle-emp-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const button = e.currentTarget;
          const id = button.dataset.id;
          const isActive = button.dataset.active === 'true';
          try {
            button.disabled = true;
            if (isActive) await LifeDropApi.deactivateEmployeeAdmin(id);
            else await LifeDropApi.activateEmployeeAdmin(id);
            const updated = employees.find(x => x.employeeProfileId === id);
            if (updated) updated.isActive = !isActive;
            renderEmployees();
          } catch (error) {
            alert(error.message);
            button.disabled = false;
          }
        });
      });

      if (showAllBtn) {
        showAllBtn.style.display = employees.length > 5 ? 'inline-flex' : 'none';
        showAllBtn.textContent = showAllEmployees ? 'Show less' : `Show all (${employees.length})`;
      }
    }

    try {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="dash-muted" style="text-align:center;padding:24px;">Loading employees...</td></tr>';
      employees = await LifeDropApi.getHospitalEmployeesAdmin(hospitalId) || [];
      renderEmployees();
    } catch (error) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="dash-muted is-danger" style="text-align:center;padding:24px;">Error: ${error.message}</td></tr>`;
    }

    if (showAllBtn) {
      showAllBtn.addEventListener('click', function () {
        showAllEmployees = !showAllEmployees;
        renderEmployees();
      });
    }
  }
  function initSystemAdminCreateHospital() {
    const form = q('create-hospital-form');
    if (!form) return;
    const latInput = q('hosp-lat');
    const lngInput = q('hosp-lng');
    const mapEl = q('hospital-map');
    const mapStatus = q('hospital-map-status');

    if (mapEl && window.L) {
      try {
        const map = L.map(mapEl).setView([31.9539, 35.9106], 8);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
        let marker = null;
        map.on('click', function (event) {
          const lat = Number(event.latlng.lat.toFixed(6));
          const lng = Number(event.latlng.lng.toFixed(6));
          if (latInput) latInput.value = lat;
          if (lngInput) lngInput.value = lng;
          if (marker) marker.setLatLng(event.latlng);
          else marker = L.marker(event.latlng).addTo(map);
          if (mapStatus) mapStatus.textContent = `Selected ${lat}, ${lng}`;
        });
        if (mapStatus) mapStatus.textContent = 'Click the map to fill latitude and longitude.';
      } catch (_) {
        if (mapStatus) mapStatus.textContent = 'Map failed to load. Enter coordinates manually.';
      }
    } else if (mapStatus) {
      mapStatus.textContent = 'Map unavailable. Enter coordinates manually.';
    }

    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, true);
      
      const payload = {
        name: q('hosp-name').value.trim(),
        address: q('hosp-address').value.trim(),
        phoneNumber: q('hosp-phone').value.trim(),
        latitude: Number(q('hosp-lat').value || 0),
        longitude: Number(q('hosp-lng').value || 0)
      };

      try {
        const result = await LifeDropApi.createHospital(payload);
        if (window.LifeDropUi) window.LifeDropUi.showToast('Hospital created successfully.', 'success');
        const hospitalId = result && result.hospitalId;
        window.location.href = hospitalId
          ? `create-hospital-admin.html?hospitalId=${encodeURIComponent(hospitalId)}`
          : 'create-hospital-admin.html';
      } catch (error) {
        if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
        html('ch-result', `<div class="dash-card dash-card--danger" style="margin-top:16px;padding:16px;">Error: ${error.message}</div>`);
      } finally {
        if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, false);
      }
    });
  }

  async function initSystemAdminCreateHospitalAdmin() {
    const form = q('create-hospital-admin-form');
    if (!form) return;
    const hospitalSelect = q('ha-hospitalid');
    const requestedHospitalId = new URLSearchParams(location.search).get('hospitalId');

    if (hospitalSelect) {
      try {
        const hospitals = await LifeDropApi.getHospitals() || [];
        hospitalSelect.innerHTML = '<option value="">Select hospital</option>' +
          hospitals.map(h => `<option value="${h.hospitalId}">${h.name} - ${h.address || h.hospitalId}</option>`).join('');
        if (requestedHospitalId) {
          const hasRequested = hospitals.some(h => String(h.hospitalId) === String(requestedHospitalId));
          if (hasRequested) hospitalSelect.value = requestedHospitalId;
        }
      } catch (error) {
        hospitalSelect.innerHTML = '<option value="">Failed to load hospitals</option>';
        if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
      }
    }

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
    const listEl = q('staff-list');
    const tbody = q('staff-table-body');
    const phoneHeader = q('staff-phone-header');
    const phoneFieldWrap = q('staff-phone-field');
    const activationNote = q('staff-activation-note');
    const showAllBtn = q('staff-show-all-btn');
    const activationAvailable = hasHospitalAdminEmployeeActivation();
    let allEmployees = [];
    let showAllEmployees = false;
    let supportsPhoneNumber = false;

    function setPhoneUi(visible) {
      if (phoneHeader) phoneHeader.style.display = visible ? '' : 'none';
      if (phoneFieldWrap) phoneFieldWrap.style.display = visible ? '' : 'none';
      if (!tbody) return;
      tbody.querySelectorAll('.staff-phone-cell').forEach(cell => {
        cell.style.display = visible ? '' : 'none';
      });
    }

    function renderStaffRows() {
      if (!tbody) return;
      const visibleEmployees = showAllEmployees ? allEmployees : allEmployees.slice(0, 5);
      tbody.innerHTML = visibleEmployees.length ? visibleEmployees.map(emp => {
        const activeClass = emp.isActive ? 'dash-badge--normal' : 'dash-badge--critical';
        const activeLabel = emp.isActive ? 'Active' : 'Inactive';
        return `<tr>
          <td><strong>${emp.firstName} ${emp.lastName}</strong></td>
          <td>${emp.email}</td>
          <td class="staff-phone-cell">${emp.phoneNumber || '--'}</td>
          <td>${emp.role || '--'}</td>
          <td><span class="dash-badge ${activeClass}">${activeLabel}</span></td>
        </tr>`;
      }).join('') : `<tr><td colspan="${supportsPhoneNumber ? 5 : 4}" class="dash-muted" style="text-align:center;padding:24px;">No employees found.</td></tr>`;
      setPhoneUi(supportsPhoneNumber);
      if (showAllBtn) {
        showAllBtn.style.display = allEmployees.length > 5 ? 'inline-flex' : 'none';
        showAllBtn.textContent = showAllEmployees ? 'Show less' : `Show all (${allEmployees.length})`;
      }
    }

    async function loadEmployees() {
      try {
        const response = await LifeDropApi.getEmployees(1, 50, '');
        allEmployees = (response && response.data) || [];
        const totalCount = response && response.totalCount ? response.totalCount : allEmployees.length;
        supportsPhoneNumber = allEmployees.some(emp => emp && Object.prototype.hasOwnProperty.call(emp, 'phoneNumber'));
        setPhoneUi(supportsPhoneNumber);
        if (listEl) {
          listEl.innerHTML = `<div class="dash-muted" style="padding:8px 0;">${fmtNumber(totalCount)} employees loaded.</div>`;
        }
        renderStaffRows();
      } catch (error) {
        if (listEl) listEl.innerHTML = `<div class="dash-muted is-danger" style="padding:8px 0;">${error.message}</div>`;
        if (tbody) tbody.innerHTML = `<tr><td colspan="${supportsPhoneNumber ? 5 : 4}" class="dash-muted is-danger" style="text-align:center;padding:24px;">${error.message}</td></tr>`;
        setPhoneUi(supportsPhoneNumber);
      }
    }

    await loadEmployees();

    if (activationNote) {
      activationNote.textContent = activationAvailable ? '' : 'Employee activation controls are currently unavailable for hospital administrators.';
    }
    if (showAllBtn) {
      showAllBtn.addEventListener('click', function () {
        showAllEmployees = !showAllEmployees;
        renderStaffRows();
      });
    }

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
        if (supportsPhoneNumber) {
          const phoneInput = q('staff-phone');
          const phoneNumber = phoneInput ? phoneInput.value.trim() : '';
          if (phoneNumber) payload.phoneNumber = phoneNumber;
        }
        await LifeDropApi.createStaff(payload);
        if (window.LifeDropUi) window.LifeDropUi.showToast('Employee account created successfully.', 'success');
        form.reset();
        await loadEmployees();
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
        btn.title = 'Verification is not available for this record yet.';
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
    // ── 4. Build nav per role ─────────────────────────────────────────────────
    const p = window.location.pathname;

    let navHtml = `
      <a class="dash-nav__item ${p.includes('dashboard-overview.html') ? 'is-active' : ''}" href="../requester/dashboard-overview.html">Dashboard</a>
      <a class="dash-nav__item ${p.includes('request-management.html') ? 'is-active' : ''}" href="../requester/request-management.html">Request Management</a>
    `;

    if (p.includes('request-details.html')) {
      navHtml += `<a class="dash-nav__item is-active" href="#">Request Details</a>`;
    }

    if (role === 'HospitalAdmin') {
      navHtml += `
        <div style="margin:16px 12px 8px;font-size:0.75rem;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:0.06em;">Admin</div>
        <a class="dash-nav__item ${p.includes('employee-onboarding.html') ? 'is-active' : ''}" href="../hospital-admin/employee-onboarding.html">Employees</a>
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
    if (page === 'hospital-management') initHospitalManagement();
    if (page === 'global-settings') initGlobalSettings();
    if (page === 'audit-logs') initAuditLogs();
    if (page === 'global-operations') initGlobalOperations();
    if (page === 'employee-onboarding') initEmployeeOnboarding();
    if (page === 'donor-communication') initDonorCommunication();
    if (page === 'donor-verification') initDonorVerification();
    if (page === 'system-admin-dashboard') initSystemAdminDashboard();
    if (page === 'system-admin-hospital-employees') initSystemAdminHospitalEmployees();
    if (page === 'system-admin-create-hospital') initSystemAdminCreateHospital();
    if (page === 'system-admin-create-hospital-admin') initSystemAdminCreateHospitalAdmin();
  });
})();
