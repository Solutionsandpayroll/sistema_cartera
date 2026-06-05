(() => {
  const AUTH_ORIGIN = (() => {
    try {
      const { protocol, hostname, port } = window.location;
      if (protocol === "http:" || protocol === "https:") {
        if (String(port || "") === "3000") return "";
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

  const apiUrl = (path) => (AUTH_ORIGIN ? `${AUTH_ORIGIN}${path}` : path);

  const isLoginPage = () => {
    const p = String(window.location.pathname || "");
    return p.endsWith("/login.html") || p.endsWith("login.html");
  };

  const nextParam = () => {
    try {
      const url = new URL(window.location.href);
      const next = url.searchParams.get("next");
      if (!next) return null;
      // evitar open redirect: solo rutas locales
      if (!next.startsWith("/")) return null;
      if (next.includes("//")) return null;
      if (next.endsWith("login.html")) return null;
      return next;
    } catch (_) {
      return null;
    }
  };

  const goLogin = () => {
    const current = String(window.location.pathname || "/") + String(window.location.search || "");
    const url = new URL(apiUrl("/login.html"), window.location.href);
    url.searchParams.set("next", current.startsWith("/") ? current : `/${current}`);
    window.location.replace(url.toString());
  };

  const goAfterLogin = () => {
    const next = nextParam();
    if (next) {
      window.location.replace(next);
    } else {
      window.location.replace(apiUrl("/home.html"));
    }
  };

  const setSessionUser = (data) => {
    const userEl = document.getElementById("session-user");
    if (!userEl) return;

    const label = data?.user || data?.username || "";
    if (!label) {
      userEl.classList.add("is-hidden");
      userEl.textContent = "";
      return;
    }

    userEl.classList.remove("is-hidden");
    userEl.textContent = `Sesión: ${label}`;
  };

  const me = async () => {
    const resp = await fetch(apiUrl("/api/auth/me"), {
      method: "GET",
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null);
    return json?.success ? json.data : null;
  };

  const attachLogout = () => {
    const btn = document.getElementById("btn-logout");
    if (!btn) return;

    me().then(setSessionUser).catch(() => setSessionUser(null));

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await fetch(apiUrl("/api/auth/logout"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" }
        }).catch(() => null);
      } finally {
        window.location.replace(apiUrl("/login.html"));
      }
    });
  };

  const attachLogin = () => {
    const form = document.getElementById("login-form");
    const user = document.getElementById("login-user");
    const pass = document.getElementById("login-pass");
    const peek = document.getElementById("login-peek");
    const status = document.getElementById("login-status");
    const submit = document.getElementById("login-submit");
    const card = document.querySelector(".login-card");

    const setStatus = (msg = "", mode = "") => {
      if (!status) return;
      const text = String(msg || "");
      if (!text) {
        status.classList.add("is-hidden");
        status.textContent = "";
        status.dataset.mode = "";
        return;
      }
      status.classList.remove("is-hidden");
      status.textContent = text;
      status.dataset.mode = String(mode || "info");
    };

    if (card) {
      const onMove = (ev) => {
        const rect = card.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        const y = (ev.clientY - rect.top) / rect.height;
        const rx = (0.5 - y) * 8;
        const ry = (x - 0.5) * 10;
        card.style.setProperty("--tilt-x", `${rx}deg`);
        card.style.setProperty("--tilt-y", `${ry}deg`);
        card.style.setProperty("--glow-x", `${Math.round(x * 100)}%`);
        card.style.setProperty("--glow-y", `${Math.round(y * 100)}%`);
      };
      const onLeave = () => {
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
        card.style.setProperty("--glow-x", "50%");
        card.style.setProperty("--glow-y", "0%");
      };
      card.addEventListener("mousemove", onMove);
      card.addEventListener("mouseleave", onLeave);
    }

    if (peek && pass) {
      peek.addEventListener("click", () => {
        const isPass = pass.type === "password";
        pass.type = isPass ? "text" : "password";
        const icon = peek.querySelector(".material-symbols-outlined");
        if (icon) icon.textContent = isPass ? "visibility_off" : "visibility";
      });
    }

    if (!form || !pass) return;

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const username = String(user?.value || "").trim();
      if (!username) {
        setStatus("Ingresa el usuario.", "warn");
        user?.focus();
        return;
      }
      if (!pass.value) {
        setStatus("Ingresa la contraseña.", "warn");
        pass.focus();
        return;
      }

      submit && (submit.disabled = true);
      setStatus("Validando acceso...", "info");

      try {
        const resp = await fetch(apiUrl("/api/auth/login"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password: pass.value })
        });

        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json?.success) {
          throw new Error(json?.message || "Credenciales inválidas");
        }

        setStatus("Acceso concedido. Redirigiendo...", "success");
        setTimeout(goAfterLogin, 350);
      } catch (err) {
        setStatus(err?.message || "No se pudo iniciar sesión", "error");
      } finally {
        submit && (submit.disabled = false);
      }
    });
  };

  const applyRole = (data) => {
    const role = data?.role || "admin";
    window.scGuard.role = role;
    if (role === "readonly") {
      document.documentElement.classList.add("is-readonly");
    }
  };

  const guard = async () => {
    const data = await me();

    if (isLoginPage()) {
      if (data) {
        goAfterLogin();
        return;
      }
      attachLogin();
      return;
    }

    attachLogout();
    setSessionUser(data);
    applyRole(data);

    if (!data) {
      goLogin();
    }
  };

  document.addEventListener("DOMContentLoaded", guard);
  window.addEventListener("pageshow", (event) => {
    if (!isLoginPage() && event.persisted) {
      guard().catch(() => null);
    }
  });

  // Exponer helper para que otras scripts redirijan en 401
  window.scGuard = {
    goLogin,
    setSessionUser,
    role: "admin"
  };
})();
