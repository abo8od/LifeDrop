
window.LifeDropApi = (function () {
  const BASE_URL = localStorage.getItem("lifedrop-api-base") || "https://localhost:5001/api";

  // ── JWT Decoder ───────────────────────────────────────────────────────────────
  function decodeJwt(token) {
    try {
      const payload = token.split('.')[1];
      // Base64url → Base64
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  // Returns { email, role, sub } from the stored access token, or null.
  function getCurrentUser() {
    const token = localStorage.getItem("lifedrop-access-token");
    if (!token) return null;
    const claims = decodeJwt(token);
    if (!claims) return null;
    return {
      sub:   claims["sub"] || claims["nameid"] || null,
      email: claims["email"] || null,
      role:  claims["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"] || null
    };
  }

  // ── Token Helpers ────────────────────────────────────────────────────────────
  function getAccessToken() {
    return localStorage.getItem("lifedrop-access-token");
  }

  function setTokens(accessToken, refreshToken) {
    localStorage.setItem("lifedrop-access-token", accessToken);
    if (refreshToken) localStorage.setItem("lifedrop-refresh-token", refreshToken);
  }

  function clearTokens() {
    localStorage.removeItem("lifedrop-access-token");
    localStorage.removeItem("lifedrop-refresh-token");
  }

  // ── Core Request ─────────────────────────────────────────────────────────────
  let refreshPromise = null;

  async function request(path, options, isRetry = false) {
    let token = getAccessToken();
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(options && options.headers ? options.headers : {})
    };

    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers
    });

    if (response.status === 401 && !isRetry) {
      const refreshToken = localStorage.getItem("lifedrop-refresh-token");
      if (token && refreshToken) {
        if (!refreshPromise) {
          refreshPromise = fetch(`${BASE_URL}/Auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: token, refreshToken })
          }).then(async (res) => {
            if (res.ok) {
              const refreshJson = await res.json();
              const tokenData = refreshJson && Object.prototype.hasOwnProperty.call(refreshJson, 'data') ? refreshJson.data : refreshJson;
              setTokens(tokenData.accessToken, tokenData.refreshToken);
              return true;
            }
            return false;
          }).finally(() => {
            refreshPromise = null;
          });
        }
        
        const refreshSuccess = await refreshPromise;
        if (refreshSuccess) {
          return request(path, options, true);
        } else {
          clearTokens();
          window.location.href = '../auth/login.html';
          return Promise.reject(new Error("Session expired. Please log in again."));
        }
      } else {
        clearTokens();
        window.location.href = '../auth/login.html';
        return Promise.reject(new Error("Session expired. Please log in again."));
      }
    }

    // Handle empty responses (e.g. 204 No Content)
    if (response.status === 204) return null;

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      // Unwrap backend ApiResponse<T> error message if present
      const message = (json && json.message) || `Request failed (${response.status})`;
      throw new Error(message);
    }

    // Unwrap ApiResponse<T> wrapper: { code, message, data }
    return json && Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  async function login(email, password) {
    const json = await fetch(`${BASE_URL}/Auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!json.ok) {
      const err = await json.json().catch(() => ({}));
      throw new Error((err && err.message) || `Login failed (${json.status})`);
    }

    const result = await json.json();
    const tokenData = result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
    setTokens(tokenData.accessToken, tokenData.refreshToken);
    return tokenData;
  }

  // ── API Functions ─────────────────────────────────────────────────────────────
  return {
    baseUrl: BASE_URL,

    // Token / identity helpers exposed for auth guard use
    getAccessToken,
    setTokens,
    clearTokens,
    getCurrentUser,

    // Auth
    login,

    // Dashboard
    getDashboardOverview: () => request('/Hospitals/dashboard/overview'),

    // Donation Requests
    getRequests:          () => request('/DonationRequests'),
    getRequest:           (id) => request(`/DonationRequests/${id}`),
    createRequest:        (payload) => request('/DonationRequests', { method: 'POST', body: JSON.stringify(payload) }),
    cancelDonationRequest: (requestId) => request(`/DonationRequests/${requestId}/cancel`, { method: 'POST' }),

    // Acceptance Actions
    fulfillAcceptance:    (acceptanceId) => request(`/DonationRequests/acceptances/${acceptanceId}/fulfill`, { method: 'POST' }),
    markAcceptanceNoShow: (acceptanceId) => request(`/DonationRequests/acceptances/${acceptanceId}/no-show`, { method: 'POST' }),

    // Reports / Analytics
    getReports:           () => request('/Hospitals/analytics'),

    // Global Operations (System Admin)
    getOperationsGlobal:  () => request('/Admin/operations'),

    // Hospitals
    getHospitals:         () => request('/Admin/hospitals'),
    activateHospital:     (id) => request(`/Admin/hospitals/${id}/activate`, { method: 'PATCH' }),
    deactivateHospital:   (id) => request(`/Admin/hospitals/${id}/deactivate`, { method: 'PATCH' }),
    getHospitalProfile:   () => request('/Hospitals/me'),
    updateHospitalProfile: (payload) => request('/Hospitals/profile', { method: 'PUT', body: JSON.stringify(payload) }),

    // Hospital Employees
    getEmployees:         (pageNumber = 1, pageSize = 10, searchTerm = '') => request(`/Hospitals/employees?pageNumber=${pageNumber}&pageSize=${pageSize}&searchTerm=${encodeURIComponent(searchTerm)}`),
    getEmployee:          (id) => request(`/Hospitals/employees/${id}`),
    activateEmployee:     (id) => Promise.reject(new Error("Backend missing endpoint: HospitalsController lacks activate employee API for Hospital Admins.")),
    deactivateEmployee:   (id) => Promise.reject(new Error("Backend missing endpoint: HospitalsController lacks deactivate employee API for Hospital Admins.")),

    // Admin Employees
    getHospitalEmployeesAdmin: (hospitalId) => request(`/Admin/hospitals/${hospitalId}/employees`),
    activateEmployeeAdmin: (employeeProfileId) => request(`/Admin/hospitals/employees/${employeeProfileId}/activate`, { method: 'PATCH' }),
    deactivateEmployeeAdmin: (employeeProfileId) => request(`/Admin/hospitals/employees/${employeeProfileId}/deactivate`, { method: 'PATCH' }),

    // Donor Communication & Verification
    getDonorCommunication: () => request('/Hospitals/donors/communication'),
    verifyDonor:          (payload) => request('/Donors/verify', { method: 'POST', body: JSON.stringify(payload) }),

    // Locations (public — no auth required)
    getGovernorates:      () => request('/Locations/governorates'),
    getDistricts:         (governorateId) => request(`/Locations/governorates/${governorateId}/districts`),

    // Employee Onboarding
    createStaff:          (payload) => request('/Hospitals/employee', { method: 'POST', body: JSON.stringify(payload) }),

    // System Admin Endpoints
    createHospital:       (payload) => request('/Hospitals', { method: 'POST', body: JSON.stringify(payload) }),
    createHospitalAdmin:  (payload) => request('/Hospitals/admin', { method: 'POST', body: JSON.stringify(payload) })
  };
})();
