(function () {
  const storageKey = "lifedrop-theme";

  function applyTheme(theme) {
    const body = document.body;
    body.classList.remove("light", "dark");
    body.classList.add(theme);
    document.querySelectorAll("[data-theme-set]").forEach((btn) => {
      const active = btn.dataset.themeSet === theme;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function savedTheme() {
    return localStorage.getItem(storageKey) || "light";
  }

  function setTheme(theme) {
    localStorage.setItem(storageKey, theme);
    applyTheme(theme);
  }

  function injectThemeSwitch() {
    if (document.querySelector(".theme-switch")) return;

    const wrap = document.createElement("div");
    wrap.className = "theme-switch";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Theme switcher");
    wrap.innerHTML = `
      <button class="theme-switch__btn" data-theme-set="light" type="button" aria-label="Switch to light mode">☀</button>
      <button class="theme-switch__btn" data-theme-set="dark" type="button" aria-label="Switch to dark mode">☾</button>
    `;
    document.body.appendChild(wrap);

    wrap.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-theme-set]");
      if (!btn) return;
      setTheme(btn.dataset.themeSet);
    });
  }

  function injectSkipLink() {
    if (document.querySelector(".skip-link")) return;
    const target = document.querySelector("main") || document.querySelector("[role='main']") || document.querySelector(".dash-content") || document.body.firstElementChild;
    if (!target) return;
    if (!target.id) target.id = "main-content";
    const skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = `#${target.id}`;
    skip.textContent = "Skip to content";
    document.body.insertAdjacentElement("afterbegin", skip);
  }

  function ensureToastRegion() {
    let region = document.querySelector(".toast-region");
    if (region) return region;
    region = document.createElement("div");
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.appendChild(region);
    return region;
  }

  function showToast(message, variant) {
    const region = ensureToastRegion();
    const toast = document.createElement("div");
    toast.className = `toast toast--${variant || "success"}`;
    toast.textContent = message;
    region.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 2800);
  }

  function setLoadingState(button, isLoading) {
    if (!button) return;
    if (!button.dataset.defaultText) {
      button.dataset.defaultText = button.innerHTML;
    }
    button.classList.toggle("is-loading", isLoading);
    button.disabled = isLoading;
    if (isLoading) {
      button.innerHTML = button.dataset.loadingText || "Processing...";
      button.setAttribute("aria-busy", "true");
    } else {
      button.innerHTML = button.dataset.defaultText;
      button.removeAttribute("aria-busy");
    }
  }

  function clearFieldError(field) {
    if (!field) return;
    field.classList.remove("is-invalid");
    field.removeAttribute("aria-invalid");
    const targetId = field.getAttribute("data-error-id");
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (el) el.textContent = "";
  }

  function setFieldError(field, message) {
    field.classList.add("is-invalid");
    field.setAttribute("aria-invalid", "true");
    let targetId = field.getAttribute("data-error-id");
    if (!targetId) {
      targetId = `error-${Math.random().toString(36).slice(2, 10)}`;
      field.setAttribute("data-error-id", targetId);
      const error = document.createElement("div");
      error.className = "field-error";
      error.id = targetId;
      field.insertAdjacentElement("afterend", error);
      const describedBy = field.getAttribute("aria-describedby");
      field.setAttribute("aria-describedby", describedBy ? `${describedBy} ${targetId}` : targetId);
    }
    const el = document.getElementById(targetId);
    if (el) el.textContent = message;
  }

  function validateField(field) {
    const value = (field.value || "").trim();
    clearFieldError(field);

    if (field.hasAttribute("required") && !value) {
      setFieldError(field, "This field is required.");
      return false;
    }

    if (field.type === "email" && value) {
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      if (!ok) {
        setFieldError(field, "Enter a valid email address.");
        return false;
      }
    }

    if (field.type === "password" && value && value.length < 8) {
      setFieldError(field, "Use at least 8 characters.");
      return false;
    }

    return true;
  }

  function bindForms() {
    document.querySelectorAll("form:not([data-api-form])").forEach((form) => {
      form.setAttribute("novalidate", "novalidate");
      const fields = form.querySelectorAll("input, select, textarea");
      fields.forEach((field) => {
        if (field.type !== "checkbox" && field.type !== "hidden" && !field.disabled) {
          if (!field.hasAttribute("required") && (field.type === "email" || field.type === "password" || field.type === "text")) {
            field.setAttribute("required", "required");
          }
          field.addEventListener("blur", function () {
            validateField(field);
          });
          field.addEventListener("input", function () {
            if (field.classList.contains("is-invalid")) validateField(field);
          });
        }
      });

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        let valid = true;
        fields.forEach((field) => {
          if (field.type === "checkbox" || field.type === "hidden" || field.disabled) return;
          if (!validateField(field)) valid = false;
        });
        const submitButton = form.querySelector("button[type='submit'], .btn-primary, .dash-btn--primary");
        if (!valid) {
          showToast("Fix the highlighted fields first.", "error");
          const firstInvalid = form.querySelector(".is-invalid");
          if (firstInvalid) firstInvalid.focus();
          return;
        }
        setLoadingState(submitButton, true);
        window.setTimeout(() => {
          setLoadingState(submitButton, false);
          showToast("Form passed validation. Connect this to the real backend next.", "success");
        }, 900);
      });
    });
  }

  function bindButtonActions() {
    document.querySelectorAll("[data-loading-text]").forEach((button) => {
      button.addEventListener("click", function () {
        if (button.closest("form")) return;
        setLoadingState(button, true);
        window.setTimeout(() => {
          setLoadingState(button, false);
          showToast("Prototype action completed.", "success");
        }, 700);
      });
    });
  }

  function bindDemoInteractions() {
    document.querySelectorAll("[data-select-group]").forEach((group) => {
      group.addEventListener("click", function (e) {
        const item = e.target.closest("[data-select-item]");
        if (!item) return;
        group.querySelectorAll("[data-select-item]").forEach((el) => el.classList.remove("is-selected"));
        item.classList.add("is-selected");
      });
    });

    document.querySelectorAll("[data-priority-group]").forEach((group) => {
      group.addEventListener("click", function (e) {
        const item = e.target.closest("[data-priority-item]");
        if (!item) return;
        group.querySelectorAll("[data-priority-item]").forEach((el) => el.classList.remove("is-selected"));
        item.classList.add("is-selected");
      });
    });

    document.querySelectorAll("[data-toggle]").forEach((toggle) => {
      toggle.addEventListener("click", function () {
        const isOn = !toggle.classList.contains("is-on");
        toggle.classList.toggle("is-on", isOn);
        toggle.setAttribute("aria-pressed", String(isOn));
      });
    });
  }

  window.LifeDropUi = { showToast, setLoadingState };

  document.addEventListener("DOMContentLoaded", function () {
    injectThemeSwitch();
    applyTheme(savedTheme());
    injectSkipLink();
    bindDemoInteractions();
    bindForms();
    bindButtonActions();
  });
})();

