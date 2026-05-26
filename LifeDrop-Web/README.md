# LifeDrop-Web Frontend Documentation  
**Graduation Project (Web Application)**

## 1. Frontend Introduction

### 1.1 Overview
LifeDrop-Web is a role-based web frontend for blood donation operations management. It provides dashboards, request workflows, employee management, and administrative control surfaces for:
- `SystemAdmin`
- `HospitalAdmin`
- `HospitalEmployee`

The app is built as a static multi-page web application using shared JavaScript modules and reusable CSS design systems.

### 1.2 Problem Statement
Blood donation operations require:
- fast request creation and monitoring,
- role-specific access and controls,
- real-time visibility into request lifecycle events,
- responsive UI for operational use across screen sizes.

Without a centralized frontend, hospitals and administrators face delayed coordination, limited visibility, and inconsistent operational workflows.

### 1.3 Objectives
- Build a production-ready web frontend aligned with backend APIs.
- Provide role-specific pages and guarded workflows.
- Integrate REST + SignalR for near real-time updates.
- Deliver responsive, consistent UI with clear states (loading, empty, error).

### 1.4 Motivations
- Improve request fulfillment speed and coordination quality.
- Reduce manual communication overhead.
- Standardize administrative and hospital workflows in one interface.

### 1.5 Scope
In-scope:
- authentication UI and JWT-based role routing,
- requester/hospital dashboards and request workflows,
- system admin hospital/admin management,
- analytics visualization via Chart.js,
- SignalR event consumption,
- responsive navigation and core accessibility enhancements.

Out-of-scope:
- donor frontend implementation (explicitly not implemented in login logic),
- backend endpoint creation/changes.

### 1.6 Contributions
- Unified API layer with refresh-token retry flow.
- Realtime layer abstraction for SignalR.
- Role-based navigation and page initialization architecture.
- Production UI cleanup (removed dead/prototype controls).
- Consistent list preview patterns (`max 5 + show all/less`) on key tables.

---

## 2. Technology Stack

## 2.1 Core Frontend
- **HTML5** (multi-page structure under `pages/`)
- **CSS3** (modular styles in `css/`)
- **Vanilla JavaScript (ES6)** (`js/app.js`, `js/api.js`, `js/pages.js`, `js/realtime.js`)

## 2.2 Libraries and External Assets
- **Chart.js 4.4.4** (CDN) for dashboard/analytics charts.
- **Microsoft SignalR JS 8.0.7** (CDN) for realtime events.
- **Leaflet 1.9.4** (CDN) for map-based hospital location picker.
- **jsonwebtoken** in `package.json` (used by local utility scripts, not browser runtime framework dependency).

## 2.3 API Integration
- REST API base defaults to:
  - `https://lifedrop-vh2h.onrender.com/api`
- Override supported via:
  - `localStorage["lifedrop-api-base"]`

## 2.4 Authentication/Token Storage
- Access token: `localStorage["lifedrop-access-token"]`
- Refresh token: `localStorage["lifedrop-refresh-token"]`
- JWT decoded client-side for role routing and guard behavior.

## 2.5 Responsive Design System
- Shared layout/tokens and components in:
  - `css/theme.css`
  - `css/dashboard.css`
  - `css/style.css`
  - `css/responsive.css`

## 2.6 Deployment Configuration
- Frontend assumes production backend on Render via default base URL.
- Environment switching supported at runtime through localStorage override.

---

## 3. Frontend Architecture

## 3.1 Application Structure
- Entry/hub: `index.html`
- Pages grouped by domain:
  - `pages/auth/`
  - `pages/requester/`
  - `pages/system-admin/`
  - `pages/hospital-admin/`

## 3.2 Shared Runtime Modules
- `js/app.js`: UI behaviors (theme switch, toasts, form validation helper, sidebar toggle, password visibility toggles).
- `js/api.js`: REST abstraction + token lifecycle.
- `js/realtime.js`: SignalR connection abstraction.
- `js/pages.js`: page controllers keyed by `data-page`.

## 3.3 Reusable UI System
- Shared cards, tables, badges, form controls, dialogs, sidebars in CSS modules.
- Consistent component classes (`dash-*`) across roles.

## 3.4 API Layer
- Single global namespace: `window.LifeDropApi`.
- Central request helper:
  - attaches bearer token,
  - handles 401 refresh,
  - unwraps backend `ApiResponse<T>.data`,
  - standardizes error propagation.

## 3.5 Realtime Layer
- `window.LifeDropRealtime`:
  - derives hub from API base (`/api` removed, then `/hubs/donations`),
  - uses token factory,
  - automatic reconnect enabled,
  - event registration helper per event name.

## 3.6 State/Data Flow
- Page load:
  1. HTML renders shell.
  2. `pages.js` detects `data-page` and runs initializer.
  3. Initializer fetches data from `LifeDropApi`.
  4. UI renders tables/cards/charts.
  5. If relevant, subscribes to SignalR and refreshes sections.

## 3.7 Role-Based Architecture
- Login decodes JWT role and redirects:
  - `SystemAdmin` -> `pages/system-admin/dashboard.html`
  - `HospitalAdmin`/`HospitalEmployee` -> `pages/requester/dashboard-overview.html`
- Sidebar/navigation assembled dynamically for hospital roles in `renderSidebar()`.

## 3.8 Responsive Sidebar and Dialog System
- Off-canvas sidebar under narrow widths with overlay and escape/outer-click close.
- Dialog/modal behavior implemented using native `<dialog>` + styled modal containers and backdrops.

---

## 4. Role-Based System

## 4.1 SystemAdmin Frontend
**Primary pages**
- `system-admin/dashboard.html`
- `system-admin/create-hospital.html`
- `system-admin/create-hospital-admin.html`
- `system-admin/hospital-employees.html`

**Capabilities**
- View global metrics and region/system charts.
- View/manage hospitals (`activate/deactivate`).
- Create hospital.
- Create hospital admin (with auto-selected hospital from query param).
- Manage hospital employees (admin activation endpoints).

**Data/API**
- `/Admin/operations`, `/Admin/hospitals`
- `/Hospitals` (create)
- `/Hospitals/admin` (create admin)
- `/Admin/hospitals/{id}/employees`
- `/Admin/hospitals/employees/{employeeProfileId}/activate|deactivate`

**Realtime**
- No SignalR dependency on SystemAdmin dashboards in current implementation.

## 4.2 HospitalAdmin Frontend
**Primary pages**
- `requester/dashboard-overview.html`
- `requester/request-management.html`
- `requester/request-details.html`
- `hospital-admin/employee-onboarding.html`
- plus read-only/limited operational pages.

**Capabilities**
- Monitor request KPIs and analytics.
- Create/cancel requests.
- Fulfill/no-show acceptance actions.
- View employee lists and details.
- Create employee accounts.
- Manage profile visibility page.

**Data/API**
- `/Hospitals/dashboard/overview`
- `/DonationRequests*`
- `/Hospitals/analytics`
- `/Hospitals/employees`, `/Hospitals/employees/{id}`
- `/Hospitals/employee`
- `/Hospitals/me`

**Realtime**
- Subscribes to: `DashboardUpdated`, `RequestAccepted`, `RequestUpdated`, `AcceptanceUpdated`.

## 4.3 HospitalEmployee Frontend
**Pages**
- Shares requester pages (`dashboard-overview`, `request-management`, `request-details`, etc.) with reduced controls by role context.

**Capabilities**
- Consume dashboards and request status updates.
- Participate in request lifecycle observation and operational monitoring.

**Realtime**
- Same subscribed events as HospitalAdmin on requester pages.

---

## 5. Pages Documentation (All Pages)

## 5.1 Auth Pages
1. **`auth/login.html`**
   - Purpose: credential entry + role redirect.
   - APIs: `LifeDropApi.login()`.
   - Validations: required email/password, login error display.
   - Realtime: none.
   - Responsive: split auth layout.

2. **`auth/forgot-password.html`**
   - Purpose: recovery email form UI.
   - APIs: none wired.
   - Realtime: none.

3. **`auth/otp.html`**
   - Purpose: OTP UI mock workflow.
   - APIs: none wired.

4. **`auth/reset-password.html`**
   - Purpose: password reset UI/form.
   - APIs: none wired.
   - Includes password fields with visibility toggle enhancement from `app.js`.

5. **`auth/register-hospital.html`**
   - Purpose: registration-style auth page (UI shell).
   - APIs: no production API integration in `pages.js`.

## 5.2 Requester/Hospital Operational Pages
6. **`requester/dashboard-overview.html`**
   - Purpose: hospital KPI dashboard.
   - APIs: overview + analytics + recent requests.
   - Charts: monthly bar, blood mix doughnut, status pie, completion gauge.
   - Realtime: all four operational events.
   - Tables: recent requests + HospitalAdmin employee preview.
   - Modal: employee details dialog.
   - Responsive: off-canvas sidebar; chart cards adapt/hide when no data.

7. **`requester/request-management.html`**
   - Purpose: request list and inline request creation.
   - APIs: requests list, governorates/districts, create request.
   - Realtime: request/acceptance events.
   - Table behavior: preview default + show all/less.

8. **`requester/request-details.html`**
   - Purpose: single request lifecycle and acceptance actions.
   - APIs: get request, fulfill, no-show, cancel.
   - Realtime: request-specific event refresh.
   - Actions: verify link, fulfill, no-show, cancel.

9. **`requester/new-request.html`**
   - Purpose: dedicated request creation form.
   - APIs: governorates/districts + create request.
   - On success: redirects to `request-details` if `requestId` returned.

10. **`requester/reports-analytics.html`**
   - Purpose: analytics rendering page.
   - APIs: `/Hospitals/analytics`.
   - Handles full-empty state cleanly.

11. **`requester/donor-communication.html`**
   - Purpose: communication list rendering.
   - APIs: `/Hospitals/donors/communication`.
   - Realtime: none.

12. **`requester/donor-verification.html`**
   - Purpose: donor verification context screen.
   - APIs: request details fetch to locate acceptance.
   - Current blocker: verification action remains disabled due missing required linkage context.

13. **`requester/settings-profile.html`**
   - Purpose: profile display and staff shortcut.
   - APIs: `/Hospitals/me`.
   - Fields are rendered read-only in current UX.

## 5.3 System Admin Pages
14. **`system-admin/dashboard.html`**
   - Purpose: global operations + hospital management table.
   - APIs: `/Admin/operations`, `/Admin/hospitals`, activate/deactivate hospital.
   - Charts: regions bar + system mix doughnut.
   - Table: hospitals preview (5) + show all/less + per-row create admin.

15. **`system-admin/create-hospital.html`**
   - Purpose: create hospital.
   - APIs: `/Hospitals` (POST).
   - Map: Leaflet coordinate picker.
   - Redirect: auto to create-admin with `hospitalId` query.

16. **`system-admin/create-hospital-admin.html`**
   - Purpose: create hospital admin.
   - APIs: `/Admin/hospitals` (load options), `/Hospitals/admin` (create).
   - Auto-select hospital from query param when present and valid.

17. **`system-admin/hospital-employees.html`**
   - Purpose: list and toggle hospital employee activation.
   - APIs: `/Admin/hospitals/{hospitalId}/employees`, activate/deactivate admin employee endpoint.
   - List behavior: preview 5 + show all/less.

## 5.4 Hospital Admin Legacy Admin-Shell Pages
18. **`hospital-admin/global-operations.html`**
19. **`hospital-admin/hospital-management.html`**
20. **`hospital-admin/global-settings.html`**
21. **`hospital-admin/audit-logs.html`**
22. **`hospital-admin/employee-onboarding.html`**
- Purpose: admin shell pages; some are active, others show unavailable/fallback messaging.
- Key note: `employee-onboarding` is actively integrated with employee API flows.

---

## 6. Authentication System

- Login calls `/Auth/login`.
- Access + refresh tokens stored in localStorage.
- API requests attach `Authorization: Bearer ...`.
- 401 flow:
  - tries `/Auth/refresh`,
  - updates tokens on success,
  - retries original request once,
  - clears tokens and redirects to login on failure.
- Role extraction from JWT claim:
  - `http://schemas.microsoft.com/ws/2008/06/identity/claims/role`.
- Logout:
  - `LifeDropApi.clearTokens()` + redirect to login.

---

## 7. SignalR Realtime System

- Hub URL computed from API base:
  - `https://lifedrop-vh2h.onrender.com/api` -> `https://lifedrop-vh2h.onrender.com/hubs/donations`
- Connection:
  - `withAutomaticReconnect()`
  - token via `accessTokenFactory`
- Events consumed:
  - `RequestAccepted`
  - `RequestUpdated`
  - `DashboardUpdated`
  - `AcceptanceUpdated`
- Realtime effects:
  - dashboard KPIs refresh,
  - request tables/details refresh,
  - user feedback via toast notifications.
- Fallback behavior:
  - if SignalR CDN/library missing, app remains functional with REST flows.

---

## 8. UI/UX System

- Theme:
  - Light/dark toggle persisted in localStorage.
- Navigation:
  - responsive sidebar with hamburger, overlay, escape/outer close.
- Dialog/modal:
  - centered dialog styles with dim/blur backdrops.
- Lists/tables:
  - standardized previews in key long-list pages.
- Charts:
  - responsive containers + empty/library-unavailable states.
- Accessibility:
  - skip link,
  - aria live toast region,
  - aria labels/pressed states on toggles.
- Password visibility:
  - dynamic toggle buttons injected for password fields.
- Loading/error:
  - button loading states,
  - empty/error card messaging through `showError`.

---

## 9. Charts and Analytics

- Chart.js used where loaded by page:
  - hospital dashboard overview,
  - system admin dashboard.
- Charts rendered conditionally:
  - hide optional chart cards when no usable analytics data.
- Container safeguards:
  - responsive chart wrappers and inline empty-state components.
- Fallback:
  - explicit “Chart library unavailable” rendering when Chart.js absent.

---

## 10. Testing and Validation

Implemented validation strategy includes:
- **Syntax checks**
  - `node --check js/app.js`
  - `node --check js/pages.js`
  - `node --check js/api.js`
  - `node --check js/realtime.js`
- **Role testing**
  - login redirect and guard behavior for all roles.
- **Realtime testing**
  - event subscription and refresh behavior in requester pages.
- **Responsive testing**
  - sidebar/menu behavior on narrow/split layouts.
- **Browser/runtime resilience**
  - graceful degradation when CDN chart/realtime libs are unavailable.
- **Deployment testing**
  - production Render API base + local override verification.

---

## 11. Production Readiness

- Prototype/dead UI controls were removed or replaced with production messaging.
- Unsupported HospitalAdmin employee activation is not faked.
- SignalR + Chart.js are optional-enhancement paths; REST core still works without them.
- Render backend target is configured as frontend default.
- Error handling standardized in API and page controllers.
- Role routing and token refresh flow implemented for session continuity.

---

## 12. Results and Conclusions

## 12.1 Achievements
- Delivered a structured, role-based web frontend with shared architecture.
- Implemented production API integration with token refresh retry.
- Integrated realtime operational updates where needed.
- Improved consistency across modal, navigation, table, and chart UX patterns.

## 12.2 Strengths
- Clear separation of concerns (`api`, `realtime`, `page controllers`, `UI runtime`).
- Strong fallback behavior for partial dependency failure.
- Practical role-aligned workflows with operationally relevant views.

## 12.3 Limitations
- Some auth-side pages remain UI-only without backend workflows.
- HospitalAdmin employee activation endpoints remain unavailable.
- Donor verification completion is backend-data-dependent.

## 12.4 Backend Blockers (Current)
- No HospitalAdmin activate/deactivate employee endpoint.
- Donor verification lacks full linkage context on current data path.
- Global settings/audit logs functionality constrained by backend availability.

## 12.5 Future Improvements
- Move auth recovery/reset flows to real backend endpoints.
- Add stricter client route guards with centralized guard middleware.
- Introduce bundling/build tooling (Vite/Webpack) for maintainability.
- Add end-to-end tests (Playwright/Cypress) for role workflows and realtime events.
- Add typed API contracts (TypeScript or generated schema clients).

---

## Project Structure Summary

```text
LifeDrop-Web/
  assets/                 # logos/icons
  css/                    # theme, dashboard, auth, responsive, utilities
  js/
    api.js                # REST + token refresh + role helpers
    realtime.js           # SignalR hub lifecycle and events
    pages.js              # per-page controllers and flows
    app.js                # shared UI runtime
  pages/
    auth/                 # login/recovery/reset/otp/register UI
    requester/            # hospital operational pages
    system-admin/         # system admin pages
    hospital-admin/       # admin shell + employee page
  index.html              # navigation hub
```

## Key Frontend Files
- `C:\Users\Abed\Downloads\LifeDrop-Workspace\LifeDrop-Web\js\api.js`
- `C:\Users\Abed\Downloads\LifeDrop-Workspace\LifeDrop-Web\js\realtime.js`
- `C:\Users\Abed\Downloads\LifeDrop-Workspace\LifeDrop-Web\js\pages.js`
- `C:\Users\Abed\Downloads\LifeDrop-Workspace\LifeDrop-Web\js\app.js`
- `C:\Users\Abed\Downloads\LifeDrop-Workspace\LifeDrop-Web\css\dashboard.css`
- `C:\Users\Abed\Downloads\LifeDrop-Workspace\LifeDrop-Web\css\style.css`

## Technologies Summary
- HTML5, CSS3, Vanilla JS
- Chart.js (CDN)
- SignalR JS (CDN)
- Leaflet (CDN)
- REST API (Render-hosted backend)
- JWT token handling in browser + localStorage persistence

## Recommendations for Future Work
1. Implement full backend-linked forgot/reset password workflows.
2. Add backend support for HospitalAdmin employee activation.
3. Formalize API contracts and validation schemas.
4. Add automated UI regression and realtime integration tests.
5. Introduce build pipeline and modularization for long-term scaling.