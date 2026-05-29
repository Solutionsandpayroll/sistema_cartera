(() => {
  const AUTH_API_ORIGIN = (() => {
    try {
      const { protocol, hostname, port } = window.location;
      if (protocol === "http:" || protocol === "https:") {
        if (String(port || "") === "3000") {
          return "";
        }
        const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(
          String(hostname || "").toLowerCase()
        );
        return isLocalHost ? `${protocol}//${hostname}:3000` : window.location.origin;
      }
    } catch (_) {
      // ignore
    }

    return "http://localhost:3000";
  })();

  const apiUrl = (path) => (AUTH_API_ORIGIN ? `${AUTH_API_ORIGIN}${path}` : path);

  const state = {
    checked: false,
    authenticated: false,
    user: null,
    inFlight: null
  };

  const el = {
    dock: null,
    card: null,
    subtitle: null,
    form: null,
    user: null,
    pass: null,
    peek: null,
    submit: null,
    status: null,
    logged: null,
    logout: null
  };

  const setStatus = (message = "", mode = "") => {
    if (!el.status) return;
    const text = String(message || "");
    if (!text) {
      el.status.classList.add("is-hidden");
      el.status.textContent = "";
      el.status.dataset.mode = "";
      return;
    }

    el.status.classList.remove("is-hidden");
    el.status.textContent = text;
    el.status.dataset.mode = String(mode || "info");
  };

  const applyAuthUI = ({ authenticated, user }) => {
    if (!el.card) return;

    el.card.classList.toggle("is-authenticated", !!authenticated);
    el.card.classList.toggle("is-locked", !authenticated);

    if (el.subtitle) {
      el.subtitle.textContent = authenticated
        ? "Sesión activa"
        : "Sesión requerida";
    }

    if (el.logged) {
      el.logged.classList.toggle("is-hidden", !authenticated);
    }
    if (el.form) {
      el.form.classList.toggle("is-hidden", !!authenticated);
    }
    if (el.user) {
      if ("value" in el.user) {
        el.user.value = authenticated ? String(user || "") : "";
      } else {
        el.user.textContent = authenticated ? String(user || "") : "";
      }
    }
  };

  const showRequired = () => {
    applyAuthUI({ authenticated: false, user: null });
    setStatus("Inicia sesión para usar el sistema.", "warn");
  };

  const request = async (path, options = {}) => {
    const url = apiUrl(path);
    const resp = await fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    return resp;
  };

  const me = async () => {
    const resp = await request("/api/auth/me", { method: "GET" });
    if (!resp.ok) {
      throw new Error("No autenticado");
    }

    const json = await resp.json().catch(() => ({}));
    if (!json?.success) {
      throw new Error(json?.message || "No autenticado");
    }

    return json.data;
  };

  const ensureAuth = async () => {
    if (state.authenticated) return { user: state.user };

    if (!state.inFlight) {
      state.inFlight = (async () => {
        try {
          const data = await me();
          state.checked = true;
          state.authenticated = true;
          state.user = data?.user || data?.username || "";
          applyAuthUI({ authenticated: true, user: state.user });
          setStatus("", "");
          return { user: state.user };
        } catch (_) {
          state.checked = true;
          state.authenticated = false;
          state.user = null;
          showRequired();
          throw _;
        } finally {
          state.inFlight = null;
        }
      })();
    }

    return state.inFlight;
  };

  const login = async (password) => {
    const loginUser = String(el.user?.value || el.user?.textContent || "").trim();
    const resp = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: loginUser, password })
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json?.success) {
      throw new Error(json?.message || "Credenciales inválidas");
    }

    return json.data;
  };

  const logout = async () => {
    await request("/api/auth/logout", { method: "POST" }).catch(() => null);
  };

  const mount = () => {
    el.dock = document.getElementById("sc-auth");
    if (!el.dock) {
      return;
    }

    el.card = el.dock.querySelector(".sc-auth-card");
    el.subtitle = el.dock.querySelector("#sc-auth-subtitle");
    el.form = el.dock.querySelector("#sc-auth-form");
    el.user = el.dock.querySelector("#sc-auth-user");
    el.pass = el.dock.querySelector("#sc-auth-pass");
    el.peek = el.dock.querySelector("#sc-auth-peek");
    el.submit = el.dock.querySelector("#sc-auth-submit");
    el.status = el.dock.querySelector("#sc-auth-status");
    el.logged = el.dock.querySelector("#sc-auth-logged");
    el.logout = el.dock.querySelector("#sc-auth-logout");

    // 3D tilt (no convencional) sin depender de librerías
    if (el.card) {
      const onMove = (ev) => {
        const rect = el.card.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        const y = (ev.clientY - rect.top) / rect.height;
        const rx = (0.5 - y) * 8;
        const ry = (x - 0.5) * 10;
        el.card.style.setProperty("--sc-tilt-x", `${rx}deg`);
        el.card.style.setProperty("--sc-tilt-y", `${ry}deg`);
        el.card.style.setProperty("--sc-glow-x", `${Math.round(x * 100)}%`);
        el.card.style.setProperty("--sc-glow-y", `${Math.round(y * 100)}%`);
      };
      const onLeave = () => {
        el.card.style.setProperty("--sc-tilt-x", "0deg");
        el.card.style.setProperty("--sc-tilt-y", "0deg");
        el.card.style.setProperty("--sc-glow-x", "50%");
        el.card.style.setProperty("--sc-glow-y", "0%");
      };

      el.card.addEventListener("mousemove", onMove);
      el.card.addEventListener("mouseleave", onLeave);
      el.card.addEventListener("focusin", () => el.card.classList.add("is-focused"));
      el.card.addEventListener("focusout", () => el.card.classList.remove("is-focused"));
    }

    if (el.peek && el.pass) {
      el.peek.addEventListener("click", () => {
        const isPass = el.pass.type === "password";
        el.pass.type = isPass ? "text" : "password";
        el.peek.querySelector(".material-symbols-outlined").textContent = isPass
          ? "visibility_off"
          : "visibility";
      });
    }

    if (el.form && el.pass) {
      el.form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const loginUser = String(el.user?.value || el.user?.textContent || "").trim();
        if (!loginUser) {
          setStatus("Ingresa el usuario.", "warn");
          if (el.user && "focus" in el.user) {
            el.user.focus();
          }
          return;
        }
        if (!el.pass.value) {
          setStatus("Ingresa la contraseña.", "warn");
          el.pass.focus();
          return;
        }

        try {
          setStatus("Validando credenciales...", "info");
          el.submit && (el.submit.disabled = true);
          await login(el.pass.value);
          setStatus("Acceso concedido. Cargando módulos...", "success");
          await ensureAuth();
          window.location.reload();
        } catch (err) {
          setStatus(err?.message || "No se pudo iniciar sesión", "error");
        } finally {
          el.submit && (el.submit.disabled = false);
        }
      });
    }

    if (el.logout) {
      el.logout.addEventListener("click", async () => {
        try {
          setStatus("Cerrando sesión...", "info");
          el.logout.disabled = true;
          await logout();
        } finally {
          window.location.reload();
        }
      });
    }

    // Si estás en un host local distinto de 3000, avisar porque cookies/cors pueden bloquear
    const currentHostname = String(window.location?.hostname || "").toLowerCase();
    const currentPort = String(window.location?.port || "");
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(currentHostname);
    if (isLocalHost && currentPort !== "3000") {
      setStatus(
        "Para que el login funcione, abre desde http://localhost:3000/*.html",
        "warn"
      );
    }

    // Estado inicial
    applyAuthUI({ authenticated: false, user: null });
    ensureAuth().catch(() => null);
  };

  window.scAuth = {
    ensureAuth,
    showRequired,
    apiUrl
  };

  document.addEventListener("DOMContentLoaded", mount);
})();
