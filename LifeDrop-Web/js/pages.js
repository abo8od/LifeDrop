
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
  function tableMessageRow(colspan, message, isError) {
    return `<tr><td colspan="${colspan}" class="dash-muted${isError ? ' is-danger' : ''} dash-table-message">${message}</td></tr>`;
  }

  // â”€â”€ Enum label helpers (enums serialised as ints by the backend) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // BloodType:       0=O+ 1=O- 2=A+ 3=A- 4=B+ 5=B- 6=AB+ 7=AB-
  // UrgencyLevel:    0=Normal 1=Urgent 2=Critical
  // RequestStatus:   0=Active 1=Fulfilled 2=Cancelled 3=Expired
  // AcceptanceStatus:0=Accepted 1=Fulfilled 2=CancelledByDonor 3=NoShow
  const BT  = ['O+','O-','A+','A-','B+','B-','AB+','AB-'];
  const URG = ['Normal','Urgent','Critical'];
  const RST = ['Active','Fulfilled','Cancelled','Expired'];
  const AST = ['Accepted','Fulfilled','Cancelled by Donor','No-Show'];
  // Reverse maps for form â†’ int
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
        <td class="dash-muted dash-table-id">${shortId}</td>
        <td><strong>${fmtBT(req.bloodType)}</strong><div class="dash-muted">${fmtRSt(req.status)}</div></td>
        <td><span class="dash-badge ${urgClass(req.urgency)}">${fmtBT(req.bloodType)}</span></td>
        <td><span class="dash-badge ${urgClass(req.urgency)}">${fmtUrg(req.urgency)}</span></td>
        <td><strong>${req.currentFulfilledAcceptances || 0}/${req.targetQuota || 0}</strong>
          <div class="dash-progress"><div class="dash-progress__bar ${pct < 35 ? 'is-danger' : pct >= 100 ? 'is-success' : ''}" style="width:${pct}%"></div></div>
        </td>
        <td>${req.createdAt ? fmtDate(req.createdAt) : '--'}</td>
        <td class="dash-table-cell-actions"><a class="dash-link-alert" href="request-details.html?id=${id}">View</a></td>
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

  function employeeProfileKey(emp) {
    return String((emp && (emp.employeeProfileId || emp.id || emp.userId)) || '');
  }

  function employeeActivationButton(emp, className) {
    const id = employeeProfileKey(emp);
    const isActive = !!(emp && emp.isActive);
    const label = isActive ? 'Deactivate' : 'Activate';
    const tone = isActive ? 'dash-btn--danger' : 'dash-btn--success';
    if (!id) return '';
    return `<button class="dash-btn ${tone} dash-btn--xs ${className}" data-id="${id}" data-active="${isActive}" type="button">${label}</button>`;
  }

  function updateEmployeeActivationRow(button, isActive) {
    const row = button.closest('tr');
    if (!row) return;
    const badge = row.querySelector('[data-role="employee-active-badge"]');
    if (badge) {
      badge.classList.toggle('dash-badge--normal', isActive);
      badge.classList.toggle('dash-badge--critical', !isActive);
      badge.textContent = isActive ? 'Active' : 'Inactive';
    }
    button.dataset.active = String(isActive);
    button.textContent = isActive ? 'Deactivate' : 'Activate';
    button.classList.toggle('dash-btn--danger', isActive);
    button.classList.toggle('dash-btn--success', !isActive);
  }

  async function toggleHospitalEmployeeActivation(button, employees) {
    const id = button.dataset.id;
    const isActive = button.dataset.active === 'true';
    if (!id) {
      if (window.LifeDropUi && window.LifeDropUi.showToast) window.LifeDropUi.showToast('Employee profile ID is missing.', 'error');
      return;
    }

    if (window.LifeDropUi && window.LifeDropUi.setLoadingState) {
      window.LifeDropUi.setLoadingState(button, true);
    } else {
      button.disabled = true;
    }

    let succeeded = false;
    try {
      if (isActive) await LifeDropApi.deactivateEmployee(id);
      else await LifeDropApi.activateEmployee(id);

      const nextActive = !isActive;
      const updated = (employees || []).find(emp => employeeProfileKey(emp) === String(id));
      if (updated) updated.isActive = nextActive;
      succeeded = true;

      if (window.LifeDropUi && window.LifeDropUi.setLoadingState) {
        window.LifeDropUi.setLoadingState(button, false);
      } else {
        button.disabled = false;
      }
      updateEmployeeActivationRow(button, nextActive);
      button.dataset.defaultText = button.innerHTML;

      if (window.LifeDropUi && window.LifeDropUi.showToast) {
        window.LifeDropUi.showToast(nextActive ? 'Employee activated.' : 'Employee deactivated.', 'success');
      }
    } catch (error) {
      if (window.LifeDropUi && window.LifeDropUi.showToast) window.LifeDropUi.showToast(error.message, 'error');
    } finally {
      if (succeeded) return;
      if (window.LifeDropUi && window.LifeDropUi.setLoadingState) {
        window.LifeDropUi.setLoadingState(button, false);
      } else {
        button.disabled = false;
      }
    }
  }

  function systemAdminNav(pageKey) {
    return `
      <a class="dash-nav__item dash-nav__item--admin ${pageKey === 'dashboard' ? 'is-active' : ''}" href="dashboard.html">Dashboard</a>
      <a class="dash-nav__item dash-nav__item--admin ${pageKey === 'hospitals' ? 'is-active' : ''}" href="create-hospital.html">Create Hospital</a>
    `;
  }

  function wireSimpleLogout(id, target) {
    const logoutBtn = q(id);
    if (!logoutBtn) return;
    logoutBtn.addEventListener('click', function (e) {
      e.preventDefault();
      LifeDropApi.clearTokens();
      window.location.href = target || '../auth/login.html';
    });
  }

  function hospitalLabel(hospital) {
    if (!hospital) return 'Select hospital';
    const location = hospital.address || hospital.hospitalId || '';
    return `${hospital.name || 'Hospital'}${location ? ` - ${location}` : ''}`;
  }

  function ensureCreateAdminModal(hospitals) {
    let modal = q('sa-create-admin-modal');
    if (!modal) {
      modal = document.createElement('dialog');
      modal.className = 'dash-modal';
      modal.id = 'sa-create-admin-modal';
      modal.innerHTML = `
        <div class="dash-modal__card dash-modal__card--wide">
          <div class="dash-modal__header">
            <h3 class="dash-modal__title">Create Admin</h3>
            <button class="dash-modal__close" id="sa-create-admin-close" type="button" aria-label="Close create admin modal">X</button>
          </div>
          <div class="dash-modal__body">
            <form data-api-form id="sa-create-admin-form" class="dash-stack-5">
              <div class="dash-form-grid dash-form-grid--2">
                <div class="dash-field">
                  <label class="dash-label" for="sa-admin-firstname">First Name</label>
                  <input class="dash-input" id="sa-admin-firstname" required type="text"/>
                </div>
                <div class="dash-field">
                  <label class="dash-label" for="sa-admin-lastname">Last Name</label>
                  <input class="dash-input" id="sa-admin-lastname" required type="text"/>
                </div>
                <div class="dash-field">
                  <label class="dash-label" for="sa-admin-email">Email Address</label>
                  <input class="dash-input" id="sa-admin-email" required type="email"/>
                </div>
                <div class="dash-field">
                  <label class="dash-label" for="sa-admin-password">Password</label>
                  <input class="dash-input" id="sa-admin-password" required type="password"/>
                </div>
                <div class="dash-field dash-grid-span-full">
                  <label class="dash-label" for="sa-admin-hospitalid">Hospital</label>
                  <select class="dash-input" id="sa-admin-hospitalid" required></select>
                </div>
              </div>
              <div class="dash-row-between">
                <button class="dash-btn dash-btn--secondary" id="sa-create-admin-cancel" type="button">Cancel</button>
                <button class="dash-btn dash-btn--primary" data-loading-text="Creating..." type="submit">Create Admin</button>
              </div>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const close = q('sa-create-admin-close');
      const cancel = q('sa-create-admin-cancel');
      if (close) close.addEventListener('click', () => modal.close());
      if (cancel) cancel.addEventListener('click', () => modal.close());
      modal.addEventListener('click', function (event) {
        const rect = modal.querySelector('.dash-modal__card').getBoundingClientRect();
        const inside =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        if (!inside) modal.close();
      });

      const form = q('sa-create-admin-form');
      if (form) {
        form.addEventListener('submit', async function (event) {
          event.preventDefault();
          const submit = form.querySelector('button[type="submit"]');
          if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, true);
          try {
            await LifeDropApi.createHospitalAdmin({
              email: q('sa-admin-email').value.trim(),
              password: q('sa-admin-password').value,
              firstName: q('sa-admin-firstname').value.trim(),
              lastName: q('sa-admin-lastname').value.trim(),
              hospitalId: q('sa-admin-hospitalid').value.trim()
            });
            if (window.LifeDropUi) window.LifeDropUi.showToast('Hospital Admin created successfully.', 'success');
            form.reset();
            modal.close();
          } catch (error) {
            if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
          } finally {
            if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, false);
          }
        });
      }
    }

    const select = q('sa-admin-hospitalid');
    if (select) {
      select.innerHTML = '<option value="">Select hospital</option>' +
        (hospitals || []).map(h => `<option value="${escapeHtml(h.hospitalId)}">${escapeHtml(hospitalLabel(h))}</option>`).join('');
    }
    return modal;
  }

  function openCreateAdminModal(hospitalId, hospitals) {
    const modal = ensureCreateAdminModal(hospitals);
    const select = q('sa-admin-hospitalid');
    if (select && hospitalId) select.value = hospitalId;
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', 'open');
    const first = q('sa-admin-firstname');
    if (first) first.focus();
  }

  async function initDashboardOverview() {
    // GET /api/Hospitals/dashboard/overview â†’ DashboardOverviewDto
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
      let currentSearch = '';
      let searchTimeout = null;
      let showPhoneColumn = false;
      let allEmployees = [];
      let visibleCount = 5;

      const tbody = q('emp-table-body');
      const table = tbody ? tbody.closest('table') : null;
      const phoneHeader = table ? table.querySelector('[data-col="phone"]') : null;
      const searchInput = q('emp-search');
      const pageIndicator = q('emp-page-indicator');
      const showMoreBtn = q('emp-show-more-btn');
      const showLessBtn = q('emp-show-less-btn');
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

      function renderEmployeeRows() {
        if (!tbody) return;
        const visibleEmployees = allEmployees.slice(0, visibleCount);
        if (!visibleEmployees.length) {
          tbody.innerHTML = tableMessageRow(showPhoneColumn ? 7 : 6, 'No employees found.');
          applyPhoneColumnVisibility();
          if (pageIndicator) pageIndicator.textContent = '';
          if (showMoreBtn) showMoreBtn.style.display = 'none';
          if (showLessBtn) showLessBtn.style.display = 'none';
          return;
        }

        tbody.innerHTML = visibleEmployees.map(emp => {
              const activeClass = emp.isActive ? 'dash-badge--normal' : 'dash-badge--critical';
              const activeLabel = emp.isActive ? 'Active' : 'Inactive';
              const toggleButton = activationAvailable ? employeeActivationButton(emp, 'ha-toggle-emp-btn') : '';
              return `<tr>
                <td><strong>${emp.firstName} ${emp.lastName}</strong></td>
                <td>${emp.email}</td>
                <td class="emp-phone-cell">${emp.phoneNumber || '--'}</td>
                <td>${emp.role}</td>
                <td><span class="dash-badge ${activeClass}" data-role="employee-active-badge">${activeLabel}</span></td>
                <td>${fmtDate(emp.createdOn)}</td>
                <td class="dash-table-cell-actions">
                  <button class="dash-btn dash-btn--secondary dash-btn--xs view-emp-btn" data-id="${emp.employeeProfileId}">View</button>
                  ${toggleButton}
                </td>
              </tr>`;
            }).join('');
        applyPhoneColumnVisibility();

        document.querySelectorAll('.view-emp-btn').forEach(btn => {
          btn.addEventListener('click', () => openDetails(btn.dataset.id));
        });
        document.querySelectorAll('.ha-toggle-emp-btn').forEach(btn => {
          btn.addEventListener('click', (event) => toggleHospitalEmployeeActivation(event.currentTarget, allEmployees));
        });

        if (pageIndicator) pageIndicator.textContent = `Showing ${Math.min(visibleCount, allEmployees.length)} of ${allEmployees.length}`;
        if (showMoreBtn) showMoreBtn.style.display = visibleCount < allEmployees.length ? 'inline-flex' : 'none';
        if (showLessBtn) showLessBtn.style.display = visibleCount > 5 ? 'inline-flex' : 'none';
      }

      async function loadData() {
        try {
          if (tbody) tbody.innerHTML = tableMessageRow(showPhoneColumn ? 7 : 6, 'Loading employees...');
          
          const response = await LifeDropApi.getEmployees(1, 50, currentSearch);
          allEmployees = (response && response.data) || [];
          showPhoneColumn = allEmployees.some(hasPhoneField);
          visibleCount = 5;
          renderEmployeeRows();
        } catch (error) {
          if (tbody) {
            let displayMsg = error.message;
            if (displayMsg.includes('401')) displayMsg = 'Unauthorized. Please login again.';
            else if (displayMsg.includes('403')) displayMsg = 'Forbidden. You do not have access to view employees.';
            else if (displayMsg.includes('404')) displayMsg = 'Employees not found.';
            else if (displayMsg.includes('429')) displayMsg = 'Too many requests. Please try again later.';
            tbody.innerHTML = tableMessageRow(showPhoneColumn ? 7 : 6, displayMsg, true);
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
            <div class="dash-stack-2">
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
            visibleCount = 5;
            loadData();
          }, 300);
        });
      }

      if (showMoreBtn) {
        showMoreBtn.addEventListener('click', () => {
          visibleCount += 5;
          renderEmployeeRows();
        });
      }

      if (showLessBtn) {
        showLessBtn.addEventListener('click', () => {
          visibleCount = 5;
          renderEmployeeRows();
        });
      }

      loadData();
    }
  }



  async function initRequestManagement() {
    async function loadTable() {
      try {
        const paged = await LifeDropApi.getRequests();
        const reqs  = (paged && paged.data) || [];

        const activeCount = reqs.filter(r => isActiveStatus(r.status)).length;
        const criticalCount = reqs.filter(r => isCriticalUrgency(r.urgency)).length;
        const avgProgress = reqs.length
          ? Math.round(reqs.reduce((sum, r) => sum + (r.fulfillmentPercentage || 0), 0) / reqs.length)
          : 0;
        text('rm-active-count', activeCount);
        text('rm-avg-progress', `${avgProgress}%`);
        text('rm-critical-gap', criticalCount);

        html('requests-table-body', reqs.length
          ? reqs.map(requestRow).join('')
          : '<tr><td colspan="7" class="dash-muted">No requests found.</td></tr>');
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
  // â”€â”€ Shared new-request form logic (used from standalone page AND inline panel) â”€
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

    // â”€â”€ Populate governorates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (govSelect) {
      try {
        const govs = await LifeDropApi.getGovernorates();
        const list  = Array.isArray(govs) ? govs : (govs && govs.data ? govs.data : []);
        govSelect.innerHTML = '<option value="">â€” Select Governorate â€”</option>' +
          list.map(g => `<option value="${g.id}">${g.nameEn || g.name}</option>`).join('');
      } catch (_) {
        govSelect.innerHTML = '<option value="">Failed to load governorates</option>';
      }
    }

    // â”€â”€ Load districts when governorate changes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (govSelect && distSelect) {
      govSelect.addEventListener('change', async function () {
        const govId = this.value;
        distSelect.innerHTML = '<option>Loading districtsâ€¦</option>';
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

    // â”€â”€ Submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, true);
      setStatus('Submittingâ€¦');
      try {
        const profile    = await LifeDropApi.getHospitalProfile();
        const hospitalId = profile && profile.hospitalId;
        if (!hospitalId) throw new Error('Cannot determine hospital ID from profile.');

        const selectedDistricts = distSelect
          ? Array.from(distSelect.selectedOptions).map(o => o.value).filter(Boolean)
          : [];
        if (!selectedDistricts.length) throw new Error('Please select at least one district.');

        // Exact payload required by CreateDonationRequestCommand:
        //   hospitalId (Guid), bloodType (int 0â€“7), targetQuota (int >0),
        //   urgency (int 0â€“2), targetDistrictIds (Guid[] â‰¥1), expiryDate (DateTime? UTC)
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
      // No patientName/department/requestCode in DTO â€” use hospitalName + address + id prefix
      text('rd-subtitle', `${req.hospitalName} | ${req.hospitalAddress || ''} | ID: ${id.slice(0,8)}â€¦`);
      text('rd-progress-value', `${pct}%`);
      text('rd-progress-copy', `${req.currentFulfilledAcceptances} / ${req.targetQuota} units`);
      text('rd-status', statusLabel);

      // acceptances[] â€” each has its own acceptanceId (NOT a top-level field)
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
        // One row per acceptance â€” AcceptanceStatus: 0=Accepted (actionable), 1=Fulfilled, 2=CancelledByDonor, 3=NoShow
        html('rd-donor-table', acceptances.map((a, i) => {
          const canAct = (a.status === 0) && !isClosed; // only Accepted status is actionable
          return `
            <tr>
              <td><strong>${a.donorName}</strong><div class="dash-muted">${a.phoneNumber}</div></td>
              <td><span class="dash-badge ${urgClass(req.urgency)}">${fmtBT(a.bloodType)}</span></td>
              <td><span class="dash-row"><span class="dash-dot"></span>${fmtASt(a.status)}</span></td>
              <td>${fmtDate(a.acceptedAt)}</td>
              <td class="dash-table-cell-actions">
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

      // â”€â”€ Monthly donation bar chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        html('reports-bars', '<div class="dash-empty-inline">No monthly data available.</div>');
      }

      // â”€â”€ Summary metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      text('reports-response', avgMin != null ? `${Number(avgMin).toFixed(1)} min` : '--');

      // â”€â”€ Blood type distribution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    // Backend endpoint does not exist â€” no /Admin/settings controller implemented.
    showError('global-settings-root', 'Global settings are currently unavailable.');
  }

  function initAuditLogs() {
    // Backend endpoint does not exist â€” no /AuditLogs controller implemented.
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
        saHospitalsTbody.innerHTML = tableMessageRow(4, 'No hospitals found.');
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
            <a class="dash-btn dash-btn--secondary dash-btn--xs" href="hospital-employees.html?hospitalId=${h.hospitalId}&name=${encodeURIComponent(h.name || '')}">Employees</a>
            <button class="dash-btn dash-btn--primary dash-btn--xs sa-create-admin-btn" data-id="${h.hospitalId}" type="button">Create Admin</button>
            <button class="dash-btn ${toggleBtnClass} dash-btn--xs sa-toggle-hosp-btn" data-id="${h.hospitalId}" data-active="${h.isActive}">${toggleBtnLabel}</button>
          </td>
        </tr>`;
      }).join('');

      if (showAllBtn) {
        showAllBtn.style.display = hospitals.length > 5 ? 'inline-flex' : 'none';
        showAllBtn.textContent = showAllHospitals ? 'Show less' : `Show all (${hospitals.length})`;
      }

      ensureCreateAdminModal(hospitals);
      document.querySelectorAll('.sa-create-admin-btn').forEach(btn => {
        btn.addEventListener('click', (event) => openCreateAdminModal(event.currentTarget.dataset.id, hospitals));
      });

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
            if (window.LifeDropUi && window.LifeDropUi.showToast) window.LifeDropUi.showToast(error.message, 'error');
            button.disabled = false;
          }
        });
      });
    }

    async function loadAdminHospitals() {
      if (!saHospitalsTbody) return;
      try {
        hospitals = await LifeDropApi.getHospitals() || [];
        ensureCreateAdminModal(hospitals);
        renderAdminHospitals();
      } catch (error) {
        saHospitalsTbody.innerHTML = tableMessageRow(4, `Error: ${error.message}`, true);
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
      if (tbody) tbody.innerHTML = tableMessageRow(5, 'Missing hospitalId in the URL. Return to the dashboard and open employees from a hospital row.', true);
      return;
    }

    function renderEmployees() {
      if (!tbody) return;
      if (!employees.length) {
        tbody.innerHTML = tableMessageRow(5, 'No employees found.');
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
            if (window.LifeDropUi && window.LifeDropUi.showToast) window.LifeDropUi.showToast(error.message, 'error');
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
      if (tbody) tbody.innerHTML = tableMessageRow(5, 'Loading employees...');
      employees = await LifeDropApi.getHospitalEmployeesAdmin(hospitalId) || [];
      renderEmployees();
    } catch (error) {
      if (tbody) tbody.innerHTML = tableMessageRow(5, `Error: ${error.message}`, true);
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
    const createPanel = q('create-hospital-panel');
    const tbody = q('hospitals-page-tbody');
    const showMoreBtn = q('hospitals-show-more-btn');
    const visibleCountEl = q('hospitals-visible-count');
    let hospitals = [];
    let visibleCount = 10;

    function renderHospitalRows() {
      if (!tbody) return;
      if (!hospitals.length) {
        tbody.innerHTML = tableMessageRow(4, 'No hospitals found.');
        if (showMoreBtn) showMoreBtn.style.display = 'none';
        if (visibleCountEl) visibleCountEl.textContent = '';
        return;
      }

      const visibleHospitals = hospitals.slice(0, visibleCount);
      tbody.innerHTML = visibleHospitals.map(h => {
        const activeClass = h.isActive ? 'dash-badge--normal' : 'dash-badge--critical';
        const activeLabel = h.isActive ? 'Active' : 'Inactive';
        const toggleBtnLabel = h.isActive ? 'Deactivate' : 'Activate';
        const toggleBtnClass = h.isActive ? 'dash-btn--danger' : 'dash-btn--success';
        return `<tr>
          <td><strong>${escapeHtml(h.name || 'Hospital')}</strong><div class="dash-muted">${escapeHtml(h.hospitalId || '--')}</div></td>
          <td>${escapeHtml(h.address || '--')}</td>
          <td><span class="dash-badge ${activeClass}">${activeLabel}</span></td>
          <td class="dash-table-actions">
            <a class="dash-btn dash-btn--secondary dash-btn--xs" href="hospital-employees.html?hospitalId=${encodeURIComponent(h.hospitalId)}&name=${encodeURIComponent(h.name || '')}">Employees</a>
            <button class="dash-btn dash-btn--primary dash-btn--xs hospitals-create-admin-btn" data-id="${escapeHtml(h.hospitalId)}" type="button">Create Admin</button>
            <button class="dash-btn ${toggleBtnClass} dash-btn--xs hospitals-toggle-btn" data-id="${escapeHtml(h.hospitalId)}" data-active="${h.isActive}" type="button">${toggleBtnLabel}</button>
          </td>
        </tr>`;
      }).join('');

      ensureCreateAdminModal(hospitals);
      document.querySelectorAll('.hospitals-create-admin-btn').forEach(btn => {
        btn.addEventListener('click', (event) => openCreateAdminModal(event.currentTarget.dataset.id, hospitals));
      });
      document.querySelectorAll('.hospitals-toggle-btn').forEach(btn => {
        btn.addEventListener('click', async (event) => {
          const button = event.currentTarget;
          const id = button.dataset.id;
          const isActive = button.dataset.active === 'true';
          try {
            button.disabled = true;
            if (isActive) await LifeDropApi.deactivateHospital(id);
            else await LifeDropApi.activateHospital(id);
            const updated = hospitals.find(h => String(h.hospitalId) === String(id));
            if (updated) updated.isActive = !isActive;
            renderHospitalRows();
          } catch (error) {
            if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
            button.disabled = false;
          }
        });
      });

      if (showMoreBtn) {
        const hasMore = visibleCount < hospitals.length;
        showMoreBtn.style.display = hasMore ? 'inline-flex' : 'none';
      }
      if (visibleCountEl) {
        visibleCountEl.textContent = `Showing ${Math.min(visibleCount, hospitals.length)} of ${hospitals.length}`;
      }
    }

    async function loadHospitals() {
      if (!tbody) return;
      try {
        tbody.innerHTML = tableMessageRow(4, 'Loading hospitals...');
        hospitals = await LifeDropApi.getHospitals() || [];
        ensureCreateAdminModal(hospitals);
        renderHospitalRows();
      } catch (error) {
        tbody.innerHTML = tableMessageRow(4, `Error: ${error.message}`, true);
      }
    }

    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', function () {
        visibleCount += 10;
        renderHospitalRows();
      });
    }

    let hospitalMap = null;
    let hospitalMarker = null;

    function resizeHospitalMap() {
      if (!hospitalMap) return;
      window.setTimeout(() => hospitalMap.invalidateSize(), 80);
    }

    function initHospitalMap() {
      if (!mapEl) return;
      if (!window.L) {
        if (mapStatus) mapStatus.textContent = 'Map unavailable. Enter coordinates manually.';
        return;
      }
      if (hospitalMap) {
        resizeHospitalMap();
        return;
      }
      try {
        hospitalMap = L.map(mapEl).setView([31.9539, 35.9106], 8);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(hospitalMap);
        hospitalMap.on('click', function (event) {
          const lat = Number(event.latlng.lat.toFixed(6));
          const lng = Number(event.latlng.lng.toFixed(6));
          if (latInput) latInput.value = lat;
          if (lngInput) lngInput.value = lng;
          if (hospitalMarker) hospitalMarker.setLatLng(event.latlng);
          else hospitalMarker = L.marker(event.latlng).addTo(hospitalMap);
          if (mapStatus) mapStatus.textContent = `Selected ${lat}, ${lng}`;
        });
        if (mapStatus) mapStatus.textContent = 'Click the map to fill latitude and longitude.';
        resizeHospitalMap();
      } catch (_) {
        if (mapStatus) mapStatus.textContent = 'Map failed to load. Enter coordinates manually.';
      }
    }

    if (createPanel) {
      if (new URLSearchParams(location.search).get('create') === '1') {
        createPanel.setAttribute('open', '');
      }
      createPanel.addEventListener('toggle', function () {
        if (createPanel.open) initHospitalMap();
      });
    }

    if (createPanel && createPanel.open) {
      initHospitalMap();
    } else if (!createPanel) {
      initHospitalMap();
    } else if (mapStatus && !window.L) {
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
        await LifeDropApi.createHospital(payload);
        if (window.LifeDropUi) window.LifeDropUi.showToast('Hospital created successfully.', 'success');
        html('ch-result', '');
        form.reset();
        await loadHospitals();
      } catch (error) {
        if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
        html('ch-result', `<div class="dash-status-card dash-status-card--error">Error: ${error.message}</div>`);
      } finally {
        if (window.LifeDropUi && window.LifeDropUi.setLoadingState) window.LifeDropUi.setLoadingState(submit, false);
      }
    });

    loadHospitals();
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
        html('cha-result', `<div class="dash-status-card dash-status-card--success"><strong>Admin Created:</strong> ${result.email}<br/><strong>User ID:</strong> ${result.userId}<br/><strong>Hospital ID:</strong> ${result.hospitalId}</div>`);
        form.reset();
      } catch (error) {
        if (window.LifeDropUi) window.LifeDropUi.showToast(error.message, 'error');
        html('cha-result', `<div class="dash-status-card dash-status-card--error">Error: ${error.message}</div>`);
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
    const activationAvailable = hasHospitalAdminEmployeeActivation();
    let allEmployees = [];
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
      tbody.innerHTML = allEmployees.length ? allEmployees.map(emp => {
        const activeClass = emp.isActive ? 'dash-badge--normal' : 'dash-badge--critical';
        const activeLabel = emp.isActive ? 'Active' : 'Inactive';
        const toggleButton = activationAvailable ? employeeActivationButton(emp, 'staff-toggle-emp-btn') : '';
        return `<tr>
          <td><strong>${emp.firstName} ${emp.lastName}</strong></td>
          <td>${emp.email}</td>
          <td class="staff-phone-cell">${emp.phoneNumber || '--'}</td>
          <td>${emp.role || '--'}</td>
          <td><span class="dash-badge ${activeClass}" data-role="employee-active-badge">${activeLabel}</span></td>
          <td class="dash-table-actions">${toggleButton}</td>
        </tr>`;
      }).join('') : tableMessageRow(supportsPhoneNumber ? 6 : 5, 'No employees found.');
      setPhoneUi(supportsPhoneNumber);
      document.querySelectorAll('.staff-toggle-emp-btn').forEach(btn => {
        btn.addEventListener('click', (event) => toggleHospitalEmployeeActivation(event.currentTarget, allEmployees));
      });
    }

    async function loadEmployees() {
      try {
        const response = await LifeDropApi.getEmployees(1, 50, '');
        allEmployees = (response && response.data) || [];
        supportsPhoneNumber = allEmployees.some(emp => emp && Object.prototype.hasOwnProperty.call(emp, 'phoneNumber'));
        setPhoneUi(supportsPhoneNumber);
        renderStaffRows();
      } catch (error) {
        if (listEl) listEl.innerHTML = `<div class="dash-helper is-danger">${error.message}</div>`;
        if (tbody) tbody.innerHTML = tableMessageRow(supportsPhoneNumber ? 6 : 5, error.message, true);
        setPhoneUi(supportsPhoneNumber);
      }
    }

    await loadEmployees();

    if (activationNote) {
      activationNote.textContent = activationAvailable ? '' : 'Employee activation controls are currently unavailable for hospital administrators.';
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

    // â”€â”€ 1. Role chip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const chip = document.querySelector('.dash-user-chip');
    if (chip) chip.textContent = role === 'HospitalAdmin' ? 'Hospital Admin' : 'Employee';

    // â”€â”€ 2. Brand subtitle: hospital name from API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const brandSubtitle = document.querySelector('.dash-brand__subtitle');
    if (brandSubtitle) {
      brandSubtitle.textContent = 'Loadingâ€¦';
      try {
        const profile = await LifeDropApi.getHospitalProfile();
        brandSubtitle.textContent = (profile && profile.name) ? profile.name : 'Hospital Portal';
      } catch (_) {
        brandSubtitle.textContent = 'Hospital Portal';
      }
    }

    // â”€â”€ 3. Hide dead Emergency buttons (TODO: wire to Critical request flow) â”€â”€
    // â”€â”€ 4. Build nav per role â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        <div class="dash-nav-section-label">Admin</div>
        <a class="dash-nav__item ${p.includes('employee-onboarding.html') ? 'is-active' : ''}" href="../hospital-admin/employee-onboarding.html">Employees</a>
      `;
    }

    nav.innerHTML = navHtml;

    // â”€â”€ 5. Wire Logout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    renderSidebar(); // async â€” runs concurrently with page init; no await needed here

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

