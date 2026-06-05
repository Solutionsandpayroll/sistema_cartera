const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const crypto = require("crypto");

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (typeof process.env[key] === "undefined" || process.env[key] === "") {
      process.env[key] = value;
    }
  });
};

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Configuración de CORS
app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(express.json({ limit: "50mb" }));

// ======================
// AUTH CON USERS EN NEON
// - Credenciales verificadas contra la tabla users
// - Sesión en memoria con cookie HttpOnly
// ======================

const SESSION_COOKIE = "sc_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h
const sessions = new Map();
const SESSION_COOKIE_SECURE = String(process.env.NODE_ENV || "").toLowerCase() === "production";

const parseCookies = (cookieHeader = "") => {
  const out = {};
  String(cookieHeader || "")
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx <= 0) return;
      const k = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(val);
    });
  return out;
};

const getSession = (req) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const entry = sessions.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return entry;
};

const setSessionCookie = (res, token, maxAgeSeconds) => {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (SESSION_COOKIE_SECURE) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
};

const clearSessionCookie = (res) => {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (SESSION_COOKIE_SECURE) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
};

const hashPassword = (password, salt) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(Buffer.from(derivedKey).toString("hex"));
    });
  });

const verifyPassword = async (password, salt, expectedHash) => {
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  if (!expected.length) {
    return false;
  }

  const actual = Buffer.from(await hashPassword(password, salt), "hex");
  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
};

// Limpieza simple de sesiones expiradas
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of sessions.entries()) {
    if (!entry || now > entry.expiresAt) {
      sessions.delete(token);
    }
  }
}, 30 * 60 * 1000).unref();

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Usuario y contraseña son requeridos"
    });
  }

  let user;

  try {
    const result = await pool.query(
      `SELECT id_user, username, display_name, password_hash, password_salt, password_algorithm, is_active
       FROM users
       WHERE username = $1
       LIMIT 1`,
      [username]
    );

    user = result.rows[0] || null;
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `No se pudo consultar la tabla users: ${error.message}`
    });
  }

  if (!user || user.is_active === false) {
    return res.status(401).json({
      success: false,
      message: "Credenciales inválidas"
    });
  }

  const algorithm = String(user.password_algorithm || "scrypt").toLowerCase();
  const passwordMatches =
    algorithm === "scrypt"
      ? await verifyPassword(password, user.password_salt, user.password_hash)
      : false;

  if (!passwordMatches) {
    return res.status(401).json({
      success: false,
      message: "Credenciales inválidas"
    });
  }

  await pool
    .query(
      "UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id_user = $1",
      [user.id_user]
    )
    .catch(() => null);

  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    user: user.display_name || user.username,
    username: user.username,
    expiresAt: Date.now() + SESSION_TTL_MS
  });

  setSessionCookie(res, token, Math.floor(SESSION_TTL_MS / 1000));
  res.json({
    success: true,
    data: {
      user: user.display_name || user.username,
      username: user.username
    }
  });
});

app.post("/api/auth/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (token) {
    sessions.delete(token);
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get("/api/auth/me", (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({
      success: false,
      message: "No autenticado"
    });
  }
  res.json({
    success: true,
    data: {
      user: session.user,
      username: session.username || session.user
    }
  });
});

// Proteger API (excepto auth + health)
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth")) return next();
  if (req.path === "/health") return next();

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ success: false, message: "No autenticado" });
  }

  req.user = session.user;
  next();
});

// Guard para páginas HTML (protege rutas no-API)
app.use((req, res, next) => {
  if (req.method !== "GET") return next();

  const p = String(req.path || "/");

  // Root: siempre arranca en login si no hay sesión
  if (p === "/") {
    const session = getSession(req);
    return res.redirect(session ? "/home.html" : "/login.html");
  }

  // Permitir login y assets
  if (p === "/login.html") return next();
  if (!p.endsWith(".html")) return next();

  const session = getSession(req);
  if (!session) {
    const nextUrl = encodeURIComponent(p);
    return res.redirect(`/login.html?next=${nextUrl}`);
  }

  next();
});

// Archivos estáticos (después del guard HTML)
app.use(express.static(path.join(__dirname)));

// Configuración de conexión a Neon
const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("Falta DATABASE_URL o NEON_DATABASE_URL en el entorno");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test de conexión
pool.on("error", (err) => {
  console.error("Error inesperado en el pool de conexiones:", err);
});

// Rutas de salud
app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ status: "ok", timestamp: result.rows[0] });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

/**
 * GET /api/ventas/descargar-plantilla
 * Descarga un archivo XLSX de ejemplo para pruebas
 */
app.get("/api/ventas/descargar-plantilla", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Ventas");

    // Headers
    const headers = [
      "Tipo Transaccion",
      "Comprobante",
      "Fecha Elaboracion",
      "Sucursal",
      "Estado Envio Correo",
      "NIT",
      "Cliente",
      "Total",
      "Moneda"
    ];

    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF102a47" }
    };

    // Datos de ejemplo
    const datos = [
      ["Venta", "COMP-001", "2026-04-20", 1, "Enviado", "12345678", "Acme Corp", 150000, "COP"],
      ["Venta", "COMP-002", "2026-04-21", 2, "Pendiente", "87654321", "Tech Solutions SAS", 320000, "COP"],
      ["Devolución", "COMP-003", "2026-04-22", 1, "Enviado", "12345678", "Acme Corp", 50000, "COP"],
      ["Venta", "COMP-004", "2026-04-23", 3, "Pendiente", "11223344", "Distribuidora Plus", 275000, "COP"],
      ["Venta", "COMP-005", "2026-04-24", 2, "Enviado", "87654321", "Tech Solutions SAS", 125000, "COP"],
      ["Venta", "COMP-006", "2026-04-25", 1, "Pendiente", "55667788", "Retail Express", 420000, "COP"],
      ["Venta", "COMP-007", "2026-04-26", 3, "Enviado", "11223344", "Distribuidora Plus", 180000, "COP"],
      ["Venta", "COMP-008", "2026-04-27", 2, "Pendiente", "12345678", "Acme Corp", 290000, "COP"]
    ];

    datos.forEach((fila) => {
      worksheet.addRow(fila);
    });

    // Ajustar anchos de columna
    worksheet.columns.forEach((column, index) => {
      const width = [18, 12, 18, 10, 18, 12, 22, 12, 10];
      column.width = width[index] || 12;
    });

    // Enviar como descarga
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=Ventas_Prueba.xlsx");

    await workbook.xlsx.write(res);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error generando plantilla: " + error.message
    });
  }
});

// Función auxiliar para normalizar valores
const normalizeValue = (value) => {
  if (!value) return null;
  return String(value).trim();
};

const normalizeCurrencyCode = (value, fallback = "COP") => {
  const currency = String(value || "").trim().toUpperCase();
  return currency || fallback;
};

const sumByCurrency = (rows, amountSelector, currencySelector) => {
  const totals = new Map();

  rows.forEach((row) => {
    const currency = normalizeCurrencyCode(currencySelector(row));
    const amount = Number(amountSelector(row) || 0);
    totals.set(currency, roundMoney((totals.get(currency) || 0) + amount));
  });

  return Array.from(totals.entries())
    .map(([moneda, total]) => ({ moneda, total: roundMoney(total) }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda));
};

const parseCurrency = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  let clean = String(value || "").trim();
  if (!clean) {
    return 0;
  }

  clean = clean.replace(/\s+/g, "").replace(/\$/g, "").replace(/€|COP|USD/gi, "");

  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");

  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) {
      clean = clean.replace(/\./g, "").replace(/,/g, ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    const commaParts = clean.split(",");
    const hasThousandGroupingByComma = commaParts.length > 1 && commaParts.every((part, index) => {
      if (index === 0) return /^\d+$/.test(part);
      return /^\d{3}$/.test(part);
    });
    if (hasThousandGroupingByComma) {
      clean = commaParts.join("");
    } else {
      clean = clean.replace(/\./g, "").replace(/,/g, ".");
    }
  } else if (lastDot > -1) {
    const dotParts = clean.split(".");
    const hasThousandGrouping = dotParts.length > 1 && dotParts.every((part, index) => {
      if (index === 0) {
        return /^\d+$/.test(part);
      }
      return /^\d{3}$/.test(part);
    });

    if (hasThousandGrouping) {
      clean = dotParts.join("");
    }
  }

  const amount = Number.parseFloat(clean);
  return Number.isFinite(amount) ? amount : 0;
};

const parseExchangeRate = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const clean = String(value || "")
    .replace(/\s+/g, "")
    .replace(/\$/g, "")
    .replace(/,/g, ".");
  const amount = Number.parseFloat(clean);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const roundMoney = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
};

const buildAppliedAmounts = (transactionAmount, saleAmount, exchangeRate = 1) => {
  const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  const txAmount = roundMoney(transactionAmount);
  const saleBalance = roundMoney(saleAmount);
  const equivalentSaleAmount = roundMoney(txAmount * rate);
  const appliedSaleAmount = roundMoney(Math.min(equivalentSaleAmount, saleBalance));
  const appliedTransactionAmount = roundMoney(appliedSaleAmount / rate);

  return {
    rate,
    equivalentSaleAmount,
    appliedSaleAmount,
    appliedTransactionAmount,
    txRemaining: roundMoney(txAmount - appliedTransactionAmount),
    saleRemaining: roundMoney(saleBalance - appliedSaleAmount)
  };
};

const isCopReferencedTransaction = (transaction) => {
  const txCurrency = String(transaction?.moneda || "").trim().toUpperCase();
  const referenceCurrency = String(transaction?.moneda_referencia || "").trim().toUpperCase();
  return referenceCurrency === "COP" && txCurrency !== "COP";
};

const getEffectiveTransactionCurrency = (transaction) => {
  return isCopReferencedTransaction(transaction)
    ? "COP"
    : String(transaction?.moneda || "").trim().toUpperCase() || null;
};

const getEffectiveTransactionAmount = (transaction) => {
  if (isCopReferencedTransaction(transaction)) {
    return roundMoney(transaction?.valor_equivalente ?? transaction?.valor ?? 0);
  }

  return roundMoney(transaction?.valor ?? 0);
};

const normalizeTwoDigitYear = (yearValue) => {
  const year = Number.parseInt(String(yearValue || ""), 10);
  if (!Number.isFinite(year)) {
    return null;
  }

  if (String(yearValue).length >= 4) {
    return year;
  }

  return year >= 70 ? 1900 + year : 2000 + year;
};

const buildIsoDate = (yearValue, monthValue, dayValue) => {
  const year = Number.parseInt(String(yearValue || ""), 10);
  const month = Number.parseInt(String(monthValue || ""), 10);
  const day = Number.parseInt(String(dayValue || ""), 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const excelSerialToIsoDate = (serialValue) => {
  const serial = Number(serialValue);
  if (!Number.isFinite(serial) || serial <= 0) {
    return null;
  }

  const epoch = Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86400000);
  const parsed = new Date(epoch + ms);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
};

const parseDate = (value) => {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return excelSerialToIsoDate(value);
  }

  const dateStr = String(value).trim();
  if (!dateStr) {
    return null;
  }

  if (/^\d{5}(?:\.\d+)?$/.test(dateStr)) {
    const isoFromSerial = excelSerialToIsoDate(dateStr);
    if (isoFromSerial) {
      return isoFromSerial;
    }
  }

  const dateOnly = dateStr.split(/[T\s]/)[0].trim();

  const isoMatch = dateOnly.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (isoMatch) {
    return buildIsoDate(isoMatch[1], isoMatch[2], isoMatch[3]);
  }

  const dmyMatch = dateOnly.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (dmyMatch) {
    const normalizedYear = normalizeTwoDigitYear(dmyMatch[3]);
    return normalizedYear ? buildIsoDate(normalizedYear, dmyMatch[2], dmyMatch[1]) : null;
  }

  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().split("T")[0];
};

const parseDateTime = (value) => {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(String(value).trim());
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

const parseBoolean = (value) => {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "1", "si", "sí", "yes", "x"].includes(normalized);
};

const getPossibleFieldValue = (row, alternatives) => {
  const entries = Object.entries(row);
  for (const [key, value] of entries) {
    const normalized = String(key || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
    if (alternatives.some((alt) => normalized.includes(alt))) {
      return String(value || "");
    }
  }
  return "";
};

/**
 * POST /api/ventas/import
 * Importa registros de ventas desde un archivo Excel procesado
 * Body: { records: [...] }
 * Retorna: { success, total, imported, errors }
 */
app.post("/api/ventas/import", async (req, res) => {
  const { records } = req.body;

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No records provided"
    });
  }

  const client = await pool.connect();
  const results = {
    success: true,
    total: records.length,
    imported: 0,
    failed: 0,
    errors: []
  };

  try {
    await client.query("BEGIN");

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      try {
        // Extraer datos del registro
        const nit = normalizeValue(getPossibleFieldValue(record, ["nit", "identificacion", "documento"]));
        const nombre = normalizeValue(getPossibleFieldValue(record, ["cliente", "nombre", "empresa"]));
        const tipoTransaccion = normalizeValue(getPossibleFieldValue(record, ["tipo", "tipo_transaccion"]));
        const comprobante = normalizeValue(getPossibleFieldValue(record, ["comprobante", "referencia", "numero"]));
        const fechaStr = normalizeValue(getPossibleFieldValue(record, ["fecha", "fecha_elaboracion", "fecha_venta"]));
        const fechaVencimientoStr = normalizeValue(getPossibleFieldValue(record, ["fecha_vencimiento", "fecha vencimiento", "vencimiento"]));
        const sucursal = normalizeValue(getPossibleFieldValue(record, ["sucursal", "sucursal_id"]));
        const estadoCorreo = normalizeValue(getPossibleFieldValue(record, ["estado", "estado_envio_correo", "estado_correo"]));
        const totalStr = normalizeValue(getPossibleFieldValue(record, ["total", "monto", "valor", "venta"]));
        const moneda = normalizeValue(getPossibleFieldValue(record, ["moneda"])) || "COP";

        // Validaciones básicas
        if (!nit || !nombre) {
          results.errors.push({
            row: i + 2,
            error: "NIT y Nombre son requeridos"
          });
          results.failed++;
          continue;
        }

        if (!comprobante) {
          results.errors.push({
            row: i + 2,
            error: "Comprobante es requerido"
          });
          results.failed++;
          continue;
        }

        const total = parseCurrency(totalStr);
        if (total <= 0) {
          results.errors.push({
            row: i + 2,
            error: "Total debe ser mayor a 0"
          });
          results.failed++;
          continue;
        }

        const fecha = parseDate(fechaStr);
        const fechaVencimiento = fechaVencimientoStr ? parseDate(fechaVencimientoStr) : null;

        if (fechaVencimientoStr && !fechaVencimiento) {
          results.errors.push({
            row: i + 2,
            error: "Fecha de vencimiento invalida"
          });
          results.failed++;
          continue;
        }

        // Buscar o crear cliente
        const clienteResult = await client.query(
          "SELECT id_cliente FROM cliente WHERE identificacion = $1",
          [nit]
        );

        let idCliente;
        if (clienteResult.rows.length > 0) {
          idCliente = clienteResult.rows[0].id_cliente;
        } else {
          const newClienteResult = await client.query(
            "INSERT INTO cliente (identificacion, nombre) VALUES ($1, $2) RETURNING id_cliente",
            [nit, nombre]
          );
          idCliente = newClienteResult.rows[0].id_cliente;
        }

        // Insertar venta
        const ventaResult = await client.query(
          `INSERT INTO venta 
           (id_cliente, tipo_transaccion, comprobante, fecha_elaboracion, fecha_vencimiento, sucursal, estado_envio_correo, total, moneda) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
           RETURNING id_venta`,
          [
            idCliente,
            tipoTransaccion || null,
            comprobante,
            fecha || null,
            fechaVencimiento || null,
            sucursal ? parseInt(sucursal, 10) : null,
            estadoCorreo || null,
            total,
            moneda
          ]
        );

        results.imported++;
      } catch (error) {
        results.errors.push({
          row: i + 2,
          error: error.message
        });
        results.failed++;
      }
    }

    await client.query("COMMIT");
    res.json(results);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({
      success: false,
      message: error.message,
      errors: results.errors
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/ventas
 * Retorna todas las ventas con información del cliente
 */
app.get("/api/ventas", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        v.id_venta,
        v.id_cliente,
        c.nombre as cliente_nombre,
        c.identificacion as cliente_nit,
        v.tipo_transaccion,
        v.comprobante,
        v.fecha_elaboracion,
        v.fecha_vencimiento,
        v.sucursal,
        v.estado_envio_correo,
        v.total,
        v.moneda,
        COALESCE(ap_sum.total_aplicado, 0)::NUMERIC(15,2) AS total_aplicado,
        (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) AS saldo_venta,
        v.created_at
      FROM venta v
      JOIN cliente c ON v.id_cliente = c.id_cliente
      LEFT JOIN (
        SELECT id_venta, SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado
        FROM aplicacion_pago
        GROUP BY id_venta
      ) ap_sum ON ap_sum.id_venta = v.id_venta
      ORDER BY v.created_at DESC
    `);

    res.json({
      success: true,
      total: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PUT /api/ventas/:id
 * Edita una venta (y opcionalmente datos básicos del cliente asociado)
 * Body permitido: { tipo_transaccion, comprobante, fecha_elaboracion, fecha_vencimiento, sucursal, estado_envio_correo, total, moneda, cliente_nit, cliente_nombre }
 */
app.put("/api/ventas/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "id invalido" });
  }

  const payload = req.body || {};

  const tipoTransaccion = normalizeValue(payload.tipo_transaccion);
  const comprobante = normalizeValue(payload.comprobante);
  const fechaRaw = payload.fecha_elaboracion;
  const fecha =
    typeof fechaRaw === "undefined" || fechaRaw === null || String(fechaRaw).trim() === ""
      ? null
      : parseDate(fechaRaw);
  const fechaVencimientoRaw = payload.fecha_vencimiento;
  const fechaVencimiento =
    typeof fechaVencimientoRaw === "undefined" || fechaVencimientoRaw === null || String(fechaVencimientoRaw).trim() === ""
      ? null
      : parseDate(fechaVencimientoRaw);
  const sucursalRaw = payload.sucursal;
  const sucursal = sucursalRaw === "" || sucursalRaw === null || typeof sucursalRaw === "undefined"
    ? null
    : Number.parseInt(String(sucursalRaw).trim(), 10);
  const estadoCorreo = normalizeValue(payload.estado_envio_correo);
  const moneda = normalizeValue(payload.moneda);
  const totalRaw = payload.total;
  const total =
    typeof totalRaw === "undefined" || totalRaw === null || String(totalRaw).trim() === ""
      ? null
      : parseCurrency(totalRaw);

  const clienteNit = normalizeValue(payload.cliente_nit);
  const clienteNombre = normalizeValue(payload.cliente_nombre);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ventaRes = await client.query(
      "SELECT id_venta, id_cliente, comprobante FROM venta WHERE id_venta = $1 FOR UPDATE",
      [id]
    );

    if (!ventaRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Venta no encontrada" });
    }

    const venta = ventaRes.rows[0];

    if (comprobante && comprobante !== venta.comprobante) {
      const dupRes = await client.query(
        "SELECT 1 FROM venta WHERE comprobante = $1 AND id_venta <> $2",
        [comprobante, id]
      );
      if (dupRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "El comprobante ya existe en otra venta" });
      }
    }

    if (clienteNit || clienteNombre) {
      const clienteRes = await client.query(
        "SELECT id_cliente, identificacion FROM cliente WHERE id_cliente = $1 FOR UPDATE",
        [venta.id_cliente]
      );

      if (clienteRes.rows.length) {
        const currentCliente = clienteRes.rows[0];
        if (clienteNit && clienteNit !== currentCliente.identificacion) {
          const nitDupRes = await client.query(
            "SELECT id_cliente FROM cliente WHERE identificacion = $1 AND id_cliente <> $2",
            [clienteNit, venta.id_cliente]
          );
          if (nitDupRes.rows.length) {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "El NIT ya existe en otro cliente" });
          }
        }

        await client.query(
          `UPDATE cliente
           SET identificacion = COALESCE($1, identificacion),
               nombre = COALESCE($2, nombre),
               updated_at = NOW()
           WHERE id_cliente = $3`,
          [clienteNit || null, clienteNombre || null, venta.id_cliente]
        );
      }
    }

    if (typeof fechaRaw !== "undefined" && fechaRaw !== null && String(fechaRaw).trim() !== "" && !fecha) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Fecha elaboracion invalida" });
    }

    if (typeof fechaVencimientoRaw !== "undefined" && fechaVencimientoRaw !== null && String(fechaVencimientoRaw).trim() !== "" && !fechaVencimiento) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Fecha vencimiento invalida" });
    }

    if (typeof sucursal !== "undefined" && sucursal !== null && Number.isNaN(sucursal)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Sucursal invalida" });
    }

    if (total !== null && total < 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Total debe ser mayor o igual a 0" });
    }

    await client.query(
      `UPDATE venta
       SET tipo_transaccion = COALESCE($1, tipo_transaccion),
           comprobante = COALESCE($2, comprobante),
           fecha_elaboracion = COALESCE($3, fecha_elaboracion),
           fecha_vencimiento = COALESCE($4, fecha_vencimiento),
           sucursal = COALESCE($5, sucursal),
           estado_envio_correo = COALESCE($6, estado_envio_correo),
           total = COALESCE($7, total),
           moneda = COALESCE($8, moneda),
           updated_at = NOW()
       WHERE id_venta = $9`,
      [
        tipoTransaccion || null,
        comprobante || null,
        fecha || null,
        fechaVencimiento || null,
        typeof sucursal === "undefined" ? null : sucursal,
        estadoCorreo || null,
        total === null ? null : total,
        moneda || null,
        id
      ]
    );

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {}
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/ventas/:id
 * Borra una venta si no tiene aplicaciones asociadas
 */
app.delete("/api/ventas/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "id invalido" });
  }

  try {
    const countRes = await pool.query(
      "SELECT COUNT(1)::INT AS total FROM aplicacion_pago WHERE id_venta = $1",
      [id]
    );
    const totalApps = Number(countRes.rows[0]?.total || 0);
    if (totalApps > 0) {
      return res.status(409).json({
        success: false,
        message: "No se puede borrar la venta: tiene aplicaciones registradas"
      });
    }

    const delRes = await pool.query("DELETE FROM venta WHERE id_venta = $1", [id]);
    if (!delRes.rowCount) {
      return res.status(404).json({ success: false, message: "Venta no encontrada" });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/ventas/:id/dashboard
 * Retorna detalle de la venta, cliente, aplicaciones y agregados por fecha
 */
app.get("/api/ventas/:id/dashboard", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "id invalido" });
  }

  try {
    const ventaRes = await pool.query(
      `SELECT v.*, c.identificacion AS cliente_identificacion, c.nombre AS cliente_nombre
       FROM venta v
       JOIN cliente c ON v.id_cliente = c.id_cliente
       WHERE v.id_venta = $1`,
      [id]
    );

    if (!ventaRes.rows.length) {
      return res.status(404).json({ success: false, message: "Venta no encontrada" });
    }

    const venta = ventaRes.rows[0];

    const totalAplicadoRes = await pool.query(
      `SELECT COALESCE(SUM(a.valor_aplicado),0)::NUMERIC(15,2) AS total_aplicado
       FROM aplicacion_pago a
       WHERE a.id_venta = $1`,
      [id]
    );

    const totalAplicado = Number(totalAplicadoRes.rows[0]?.total_aplicado || 0);
    const saldo = Number(venta.total) - totalAplicado;

    const aplicacionesRes = await pool.query(
      `SELECT a.id_aplicacion, a.valor_aplicado, t.id_transaccion, t.fecha, t.nombre AS transaccion_nombre, t.referencia, t.documento
       FROM aplicacion_pago a
       JOIN transaccion t ON a.id_transaccion = t.id_transaccion
       WHERE a.id_venta = $1
       ORDER BY t.fecha ASC`,
      [id]
    );

    const agrupadoRes = await pool.query(
      `SELECT DATE(t.fecha) AS fecha, COALESCE(SUM(a.valor_aplicado),0)::NUMERIC(15,2) AS total_aplicado
       FROM aplicacion_pago a
       JOIN transaccion t ON a.id_transaccion = t.id_transaccion
       WHERE a.id_venta = $1
       GROUP BY DATE(t.fecha)
       ORDER BY DATE(t.fecha)`,
      [id]
    );

    const ventaMoneda = String(venta.moneda || "COP").trim().toUpperCase() || "COP";
    const saldoPositivoTxRes = await pool.query(
      `SELECT * FROM (
         SELECT
           t.id_transaccion,
           t.fecha,
           t.referencia,
           t.descripcion,
           COALESCE(b.nombre, '-') AS banco_nombre,
           CASE
             WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
               THEN 'COP'
             ELSE COALESCE(t.moneda, 'COP')
           END AS moneda,
           CASE
             WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
               THEN COALESCE(t.valor_equivalente, t.valor)
             ELSE t.valor
           END::NUMERIC(15,2) AS valor_disponible,
           COALESCE(ap_sum.total_aplicado_venta, 0)::NUMERIC(15,2) AS total_aplicado,
           COALESCE(ap_sum.total_aplicado_transaccion, COALESCE(ap_sum.total_aplicado_venta, 0))::NUMERIC(15,2) AS total_aplicado_transaccion,
           (
             CASE
               WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
                 THEN COALESCE(t.valor_equivalente, t.valor)
               ELSE t.valor
             END - COALESCE(ap_sum.total_aplicado_transaccion, COALESCE(ap_sum.total_aplicado_venta, 0))
           )::NUMERIC(15,2) AS saldo_transaccion
         FROM transaccion t
         LEFT JOIN banco b ON b.id_banco = t.id_banco
         LEFT JOIN (
           SELECT
             id_transaccion,
             SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado_venta,
             SUM(COALESCE(valor_aplicado_transaccion, valor_aplicado))::NUMERIC(15,2) AS total_aplicado_transaccion
           FROM aplicacion_pago
           GROUP BY id_transaccion
         ) ap_sum ON ap_sum.id_transaccion = t.id_transaccion
         WHERE t.id_cliente = $1
       ) tx
       WHERE tx.saldo_transaccion > 0
         AND tx.moneda = $2
       ORDER BY tx.fecha ASC, tx.id_transaccion ASC`,
      [venta.id_cliente, ventaMoneda]
    );

    const saldoPositivoTotal = Number(
      saldoPositivoTxRes.rows.reduce((acc, row) => acc + Number(row.saldo_transaccion || 0), 0).toFixed(2)
    );

    res.json({
      success: true,
      data: {
        venta: venta,
        cliente: { identificacion: venta.cliente_identificacion, nombre: venta.cliente_nombre, id_cliente: venta.id_cliente },
        saldo: saldo,
        aplicaciones: aplicacionesRes.rows,
        aplicaciones_por_fecha: agrupadoRes.rows,
        saldo_positivo_total: saldoPositivoTotal,
        saldo_positivo_transacciones: saldoPositivoTxRes.rows
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/ventas/opciones-transaccion
 * Retorna ventas con saldo para el desplegable de la planilla de transacciones
 */
app.get("/api/ventas/opciones-transaccion", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        v.id_venta,
        v.comprobante,
        v.total,
        v.moneda,
        c.id_cliente,
        c.identificacion AS cliente_nit,
        c.nombre AS cliente_nombre,
        (v.total - COALESCE(ap.total_aplicado, 0))::NUMERIC(15,2) AS saldo_venta
      FROM venta v
      JOIN cliente c ON c.id_cliente = v.id_cliente
      LEFT JOIN (
        SELECT
          id_venta,
          SUM(valor_aplicado) AS total_aplicado
        FROM aplicacion_pago
        GROUP BY id_venta
      ) ap ON ap.id_venta = v.id_venta
      ORDER BY v.id_venta DESC
    `);

    res.json({
      success: true,
      total: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/clientes
 * Retorna clientes para el desplegable de transacciones sin venta
 */
app.get("/api/clientes", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id_cliente,
        identificacion,
        nombre
      FROM cliente
      ORDER BY nombre ASC, identificacion ASC
    `);

    res.json({
      success: true,
      total: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/transacciones
 * Retorna transacciones con resumen de aplicacion
 */
app.get("/api/transacciones", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.id_transaccion,
        t.fecha,
        t.valor,
        t.moneda,
        t.moneda_referencia,
        t.valor_equivalente,
        t.id_banco,
        COALESCE(b.nombre, '-') AS banco_nombre,
        t.referencia,
        t.descripcion,
        c.identificacion AS cliente_nit,
        c.nombre AS cliente_nombre,
        COALESCE(ap.total_aplicado_venta, 0)::NUMERIC(15,2) AS total_aplicado,
        COALESCE(ap.total_aplicado_transaccion, COALESCE(ap.total_aplicado_venta, 0))::NUMERIC(15,2) AS total_aplicado_transaccion,
        (
          CASE
            WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
              THEN COALESCE(t.valor_equivalente, t.valor)
            ELSE t.valor
          END - COALESCE(ap.total_aplicado_transaccion, COALESCE(ap.total_aplicado_venta, 0))
        )::NUMERIC(15,2) AS saldo_transaccion,
        COALESCE(av.ventas_aplicadas, 'Sin aplicar') AS ventas_aplicadas
      FROM transaccion t
      JOIN cliente c ON c.id_cliente = t.id_cliente
      LEFT JOIN banco b ON b.id_banco = t.id_banco
      LEFT JOIN (
        SELECT
          id_transaccion,
          SUM(valor_aplicado) AS total_aplicado_venta,
          SUM(COALESCE(valor_aplicado_transaccion, valor_aplicado)) AS total_aplicado_transaccion
        FROM aplicacion_pago
        GROUP BY id_transaccion
      ) ap ON ap.id_transaccion = t.id_transaccion
      LEFT JOIN (
        SELECT
          a.id_transaccion,
          STRING_AGG(
            DISTINCT ('Venta #' || v.id_venta || ' (' || COALESCE(v.comprobante, 'Sin comprobante') || ')'),
            ', '
          ) AS ventas_aplicadas
        FROM aplicacion_pago a
        JOIN venta v ON v.id_venta = a.id_venta
        GROUP BY a.id_transaccion
      ) av ON av.id_transaccion = t.id_transaccion
      ORDER BY t.fecha DESC, t.id_transaccion DESC
      LIMIT 500
    `);

    res.json({
      success: true,
      total: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PUT /api/transacciones/:id
 * Edita una transacción (y opcionalmente datos básicos del cliente asociado)
 * Body permitido: { fecha, valor, moneda, id_banco, referencia, descripcion, documento, soporte, nombre, cliente_nit, cliente_nombre }
 */
app.put("/api/transacciones/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "id invalido" });
  }

  const payload = req.body || {};
  const fechaRaw = payload.fecha;
  const fecha =
    typeof fechaRaw === "undefined" || fechaRaw === null || String(fechaRaw).trim() === ""
      ? null
      : parseDateTime(fechaRaw);

  const valorRaw = payload.valor;
  const valor =
    typeof valorRaw === "undefined" || valorRaw === null || String(valorRaw).trim() === ""
      ? null
      : parseCurrency(valorRaw);
  const moneda = normalizeValue(payload.moneda);
  const idBancoRaw = payload.id_banco;
  const idBanco = idBancoRaw === "" || idBancoRaw === null || typeof idBancoRaw === "undefined"
    ? null
    : Number.parseInt(String(idBancoRaw).trim(), 10);
  const referencia = normalizeValue(payload.referencia);
  const descripcion = normalizeValue(payload.descripcion);
  const documento = normalizeValue(payload.documento);
  const soporte = typeof payload.soporte === "undefined" ? null : parseBoolean(payload.soporte);
  const nombre = normalizeValue(payload.nombre);

  const clienteNit = normalizeValue(payload.cliente_nit);
  const clienteNombre = normalizeValue(payload.cliente_nombre);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const txRes = await client.query(
      "SELECT id_transaccion, id_cliente FROM transaccion WHERE id_transaccion = $1 FOR UPDATE",
      [id]
    );
    if (!txRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Transaccion no encontrada" });
    }

    const tx = txRes.rows[0];

    if (typeof fechaRaw !== "undefined" && fechaRaw !== null && String(fechaRaw).trim() !== "" && !fecha) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Fecha invalida" });
    }
    if (valor !== null && valor < 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Valor debe ser mayor o igual a 0" });
    }
    if (idBanco !== null && Number.isNaN(idBanco)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Banco invalido" });
    }

    if (clienteNit || clienteNombre) {
      const clienteRes = await client.query(
        "SELECT id_cliente, identificacion FROM cliente WHERE id_cliente = $1 FOR UPDATE",
        [tx.id_cliente]
      );

      if (clienteRes.rows.length) {
        const currentCliente = clienteRes.rows[0];
        if (clienteNit && clienteNit !== currentCliente.identificacion) {
          const nitDupRes = await client.query(
            "SELECT id_cliente FROM cliente WHERE identificacion = $1 AND id_cliente <> $2",
            [clienteNit, tx.id_cliente]
          );
          if (nitDupRes.rows.length) {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "El NIT ya existe en otro cliente" });
          }
        }

        await client.query(
          `UPDATE cliente
           SET identificacion = COALESCE($1, identificacion),
               nombre = COALESCE($2, nombre),
               updated_at = NOW()
           WHERE id_cliente = $3`,
          [clienteNit || null, clienteNombre || null, tx.id_cliente]
        );
      }
    }

    await client.query(
      `UPDATE transaccion
       SET fecha = COALESCE($1, fecha),
           valor = COALESCE($2, valor),
           moneda = COALESCE($3, moneda),
           id_banco = COALESCE($4, id_banco),
           referencia = COALESCE($5, referencia),
           descripcion = COALESCE($6, descripcion),
           documento = COALESCE($7, documento),
           soporte = COALESCE($8, soporte),
           nombre = COALESCE($9, nombre),
           updated_at = NOW()
       WHERE id_transaccion = $10`,
      [
        fecha || null,
        valor === null ? null : valor,
        moneda || null,
        idBanco,
        referencia || null,
        descripcion || null,
        documento || null,
        soporte === null ? null : soporte,
        nombre || null,
        id
      ]
    );

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {}
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/transacciones/:id
 * Borra una transacción si no tiene aplicaciones asociadas
 */
app.delete("/api/transacciones/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "id invalido" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM aplicacion_pago WHERE id_transaccion = $1", [id]);

    const delRes = await client.query("DELETE FROM transaccion WHERE id_transaccion = $1", [id]);
    if (!delRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Transaccion no encontrada" });
    }

    await client.query("COMMIT");

    res.json({ success: true });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {}
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/bancos
 * Retorna lista de bancos disponibles
 */
app.get("/api/bancos", async (req, res) => {
  try {
    const result = await pool.query("SELECT id_banco, codigo, nombre FROM banco ORDER BY nombre");
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/transacciones/:id/detalle
 * Retorna detalle completo de una transacción con sus aplicaciones
 */
app.get("/api/transacciones/:id/detalle", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "id inválido" });
  }

  try {
    const txRes = await pool.query(
      `SELECT t.*, c.nombre AS cliente_nombre, c.identificacion AS cliente_nit, 
              COALESCE(b.nombre, '-') AS banco_nombre
       FROM transaccion t
       JOIN cliente c ON t.id_cliente = c.id_cliente
       LEFT JOIN banco b ON t.id_banco = b.id_banco
       WHERE t.id_transaccion = $1`,
      [id]
    );

    if (!txRes.rows.length) {
      return res.status(404).json({ success: false, message: "Transacción no encontrada" });
    }

    const transaccion = txRes.rows[0];

    const aplicacionesRes = await pool.query(
          `SELECT a.id_aplicacion,
            a.valor_aplicado,
            a.valor_aplicado_transaccion,
            a.tipo_cambio,
            v.id_venta,
            v.comprobante,
            v.total,
            v.moneda AS moneda_venta,
            c.nombre AS cliente_venta_nombre
       FROM aplicacion_pago a
       JOIN venta v ON a.id_venta = v.id_venta
       JOIN cliente c ON v.id_cliente = c.id_cliente
       WHERE a.id_transaccion = $1
       ORDER BY a.created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        transaccion,
        aplicaciones: aplicacionesRes.rows
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/transacciones/bulk
 * Crea varias transacciones y aplica pago a venta cuando corresponda
 */
app.post("/api/transacciones/bulk", async (req, res) => {
  const { rows } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No se recibieron filas para procesar"
    });
  }

  const client = await pool.connect();
  const results = {
    success: true,
    total: rows.length,
    inserted: 0,
    queued: 0,
    failed: 0,
    warnings: [],
    errors: []
  };

  try {
    await client.query("BEGIN");

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      await client.query("SAVEPOINT sp_tx_row");

      try {
        const fecha = parseDateTime(row.fecha);
        const idVenta = Number.parseInt(row.id_venta, 10);
        const hasVenta = Number.isInteger(idVenta) && idVenta > 0;

        const valor = parseCurrency(row.valor);
        const moneda = normalizeValue(row.moneda) || "COP";
        const tasaConversionRaw = row.tasa_conversion ?? row.tipo_cambio ?? row.conversion_dia;
        const idBanco = Number.parseInt(row.id_banco, 10);
        const referencia = normalizeValue(row.referencia);
        const descripcion = normalizeValue(row.descripcion);
        const nombre = normalizeValue(row.nombre);
        const documento = normalizeValue(row.documento);
        const soporte = parseBoolean(row.soporte);

        if (!fecha) {
          throw new Error("Fecha invalida");
        }

        if (valor <= 0) {
          throw new Error("El valor debe ser mayor a 0");
        }

        let idCliente;
        let ventaSaldo = 0;
        let tipoCambio = null;
        let monedaReferencia = null;
        let valorEquivalente = null;

        if (hasVenta) {
          const ventaResult = await client.query(
            `SELECT v.id_venta, v.id_cliente, v.total, v.moneda
             FROM venta v
             WHERE v.id_venta = $1
             FOR UPDATE OF v`,
            [idVenta]
          );

          if (!ventaResult.rows.length) {
            throw new Error(`La venta ${idVenta} no existe`);
          }

          const venta = ventaResult.rows[0];
          idCliente = venta.id_cliente;
          const ventaMoneda = normalizeValue(venta.moneda) || moneda;

          const totalAplicadoResult = await client.query(
            `SELECT COALESCE(SUM(a.valor_aplicado), 0)::NUMERIC(15,2) AS total_aplicado
             FROM aplicacion_pago a
             WHERE a.id_venta = $1`,
            [idVenta]
          );

          const totalAplicado = totalAplicadoResult.rows[0]?.total_aplicado || 0;
          ventaSaldo = Number(venta.total) - Number(totalAplicado);

          const requiresConversion = ventaMoneda !== moneda;
          if (requiresConversion) {
            tipoCambio = parseExchangeRate(tasaConversionRaw);
            if (!tipoCambio) {
              throw new Error("Se requiere la conversión al día cuando la moneda de la transacción es diferente a la de la venta");
            }
            monedaReferencia = ventaMoneda;
            valorEquivalente = roundMoney(valor * tipoCambio);
          }
        } else {
          const selectedClienteId = Number.parseInt(row.id_cliente, 10);
          const clienteNit = normalizeValue(row.cliente_nit || row.nit || row.identificacion);
          const clienteNombre = normalizeValue(row.cliente_nombre || row.cliente || row.nombre_cliente);
          const hasClientInfo = (Number.isInteger(selectedClienteId) && selectedClienteId > 0) || Boolean(clienteNit || clienteNombre);

          if (!hasClientInfo) {
            const ghostTipoCambio = moneda !== "COP" ? parseExchangeRate(tasaConversionRaw) : null;
            const ghostMonedaReferencia = ghostTipoCambio ? "COP" : null;
            const ghostValorEquivalente = ghostTipoCambio ? roundMoney(valor * ghostTipoCambio) : null;

            const ghostResult = await client.query(
              `INSERT INTO transaccion_fantasma
               (fecha, nombre, descripcion, referencia, documento, valor, moneda, id_banco, soporte, tipo_cambio, moneda_referencia, valor_equivalente, origen, raw_payload)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
               RETURNING id_fantasma`,
              [
                fecha,
                nombre,
                descripcion,
                referencia,
                documento,
                valor,
                moneda,
                Number.isInteger(idBanco) && idBanco > 0 ? idBanco : null,
                soporte,
                ghostTipoCambio,
                ghostMonedaReferencia,
                ghostValorEquivalente,
                "importacion",
                JSON.stringify(row)
              ]
            );

            results.queued++;
            results.warnings.push({
              row: i + 1,
              message: `La fila ${i + 1} se guardo en la bandeja fantasma (#${ghostResult.rows[0].id_fantasma}) porque no tiene cliente ni venta.`
            });

            await client.query("RELEASE SAVEPOINT sp_tx_row");
            continue;
          }

          if (Number.isInteger(selectedClienteId) && selectedClienteId > 0) {
            const clienteResult = await client.query(
              "SELECT id_cliente FROM cliente WHERE id_cliente = $1",
              [selectedClienteId]
            );

            if (!clienteResult.rows.length) {
              throw new Error(`El cliente ${selectedClienteId} no existe`);
            }

            idCliente = clienteResult.rows[0].id_cliente;
          } else {
            if (!clienteNit || !clienteNombre) {
              throw new Error("Para 'Venta no registrada' se requiere un cliente válido");
            }

            const clienteResult = await client.query(
              "SELECT id_cliente FROM cliente WHERE identificacion = $1",
              [clienteNit]
            );

            if (clienteResult.rows.length > 0) {
              idCliente = clienteResult.rows[0].id_cliente;
            } else {
              const created = await client.query(
                "INSERT INTO cliente (identificacion, nombre) VALUES ($1, $2) RETURNING id_cliente",
                [clienteNit, clienteNombre]
              );
              idCliente = created.rows[0].id_cliente;
            }
          }

          if (moneda !== "COP") {
            tipoCambio = parseExchangeRate(tasaConversionRaw);
            if (!tipoCambio) {
              throw new Error("Se requiere la conversión al día cuando la transacción no está asociada a una venta y su moneda no es COP");
            }
            monedaReferencia = "COP";
            valorEquivalente = roundMoney(valor * tipoCambio);
          }
        }

        const transaccionResult = await client.query(
          `INSERT INTO transaccion
           (id_cliente, fecha, nombre, descripcion, referencia, documento, valor, moneda, id_banco, soporte, tipo_cambio, moneda_referencia, valor_equivalente)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id_transaccion`,
          [
            idCliente,
            fecha,
            nombre,
            descripcion,
            referencia,
            documento,
            valor,
            moneda,
            Number.isInteger(idBanco) && idBanco > 0 ? idBanco : null,
            soporte,
            tipoCambio,
            monedaReferencia,
            valorEquivalente
          ]
        );

        const idTransaccion = transaccionResult.rows[0].id_transaccion;

        if (hasVenta) {
          const ventaMoneda = normalizeValue(ventaResult.rows[0]?.moneda) || moneda;
          const requiresConversion = ventaMoneda !== moneda;
          const exchangeRate = requiresConversion ? parseExchangeRate(tasaConversionRaw) : 1;
          if (requiresConversion && !exchangeRate) {
            throw new Error("Se requiere la conversión al día cuando la moneda de la transacción es diferente a la de la venta");
          }

          const amounts = buildAppliedAmounts(valor, ventaSaldo, exchangeRate || 1);
          const valorAplicadoVenta = Math.max(0, amounts.appliedSaleAmount);
          const valorAplicadoTransaccion = Math.max(0, amounts.appliedTransactionAmount);

          if (valorAplicadoVenta > 0) {
            await client.query(
              `INSERT INTO aplicacion_pago
               (id_transaccion, id_venta, valor_aplicado, valor_aplicado_transaccion, tipo_cambio)
               VALUES ($1, $2, $3, $4, $5)`,
              [idTransaccion, idVenta, valorAplicadoVenta, valorAplicadoTransaccion, exchangeRate || 1]
            );
          }

          const saldoCliente = Number(amounts.txRemaining);
          if (saldoCliente > 0) {
            results.warnings.push({
              row: i + 1,
              message: requiresConversion
                ? `La transaccion ${idTransaccion} se aplico con conversión ${exchangeRate} a la venta ${idVenta}. Se aplicaron ${valorAplicadoVenta.toFixed(2)} en moneda de la venta y quedaron ${saldoCliente.toFixed(2)} como saldo positivo de la transacción.`
                : `La transaccion ${idTransaccion} supera el saldo de la venta ${idVenta}. Se aplicaron ${valorAplicadoVenta.toFixed(2)} y quedaron ${saldoCliente.toFixed(2)} como saldo positivo del cliente.`
            });
          }
        }

        await client.query("RELEASE SAVEPOINT sp_tx_row");
        results.inserted++;
      } catch (rowError) {
        await client.query("ROLLBACK TO SAVEPOINT sp_tx_row");
        results.failed++;
        results.errors.push({
          row: i + 1,
          error: rowError.message
        });
      }
    }

    await client.query("COMMIT");
    res.json(results);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({
      success: false,
      message: error.message,
      partial: results
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/transacciones/fantasmas
 * Retorna transacciones pendientes de clasificación.
 */
app.get("/api/transacciones/fantasmas", async (req, res) => {
  try {
    const estado = String(req.query.estado || "pendiente").trim();
    const params = [];
    let whereSql = "WHERE 1=1";

    if (estado && estado !== "all" && estado !== "todas" && estado !== "todos") {
      whereSql += ` AND tf.estado = $${params.length + 1}`;
      params.push(estado);
    }

    const result = await pool.query(
      `SELECT
         tf.id_fantasma,
         tf.fecha,
         tf.nombre,
         tf.descripcion,
         tf.referencia,
         tf.documento,
         tf.valor,
         tf.moneda,
         tf.id_banco,
         COALESCE(b.nombre, '-') AS banco_nombre,
         tf.soporte,
         tf.tipo_cambio,
         tf.moneda_referencia,
         tf.valor_equivalente,
         tf.estado,
         tf.origen,
         tf.observaciones,
         tf.id_cliente_resuelto,
         c.nombre AS cliente_resuelto_nombre,
         c.identificacion AS cliente_resuelto_nit,
         tf.id_venta_resuelta,
         v.comprobante AS venta_resuelta_comprobante,
         tf.id_transaccion_resuelta,
         t.id_transaccion AS transaccion_resuelta_id,
         tf.created_at,
         tf.updated_at,
         tf.resolved_at
       FROM transaccion_fantasma tf
       LEFT JOIN banco b ON b.id_banco = tf.id_banco
       LEFT JOIN cliente c ON c.id_cliente = tf.id_cliente_resuelto
       LEFT JOIN venta v ON v.id_venta = tf.id_venta_resuelta
       LEFT JOIN transaccion t ON t.id_transaccion = tf.id_transaccion_resuelta
       ${whereSql}
       ORDER BY tf.created_at DESC, tf.id_fantasma DESC
       LIMIT 200`,
      params
    );

    res.json({
      success: true,
      total: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/transacciones/fantasmas/:id/resolver
 * Convierte un pendiente fantasma en una transaccion real y la aplica a una venta.
 */
app.post("/api/transacciones/fantasmas/:id/resolver", async (req, res) => {
  const idFantasma = Number.parseInt(req.params.id, 10);
  const idCliente = Number.parseInt(req.body?.id_cliente, 10);
  const idVenta = Number.parseInt(req.body?.id_venta, 10);
  const tasaConversionRaw = req.body?.tasa_conversion ?? req.body?.tipo_cambio ?? req.body?.conversion_dia;
  const observaciones = normalizeValue(req.body?.observaciones);

  if (!Number.isInteger(idFantasma) || idFantasma <= 0) {
    return res.status(400).json({ success: false, message: "id_fantasma inválido" });
  }
  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return res.status(400).json({ success: false, message: "id_cliente inválido" });
  }
  if (!Number.isInteger(idVenta) || idVenta <= 0) {
    return res.status(400).json({ success: false, message: "id_venta inválido" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const ghostRes = await db.query(
      `SELECT *
       FROM transaccion_fantasma
       WHERE id_fantasma = $1
       FOR UPDATE`,
      [idFantasma]
    );

    if (!ghostRes.rows.length) {
      await db.query("ROLLBACK");
      return res.status(404).json({ success: false, message: `La transacción fantasma ${idFantasma} no existe` });
    }

    const ghost = ghostRes.rows[0];
    if (ghost.estado !== "pendiente") {
      await db.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "La transacción fantasma ya fue resuelta o descartada" });
    }

    const clienteRes = await db.query(
      "SELECT id_cliente, nombre, identificacion FROM cliente WHERE id_cliente = $1 FOR UPDATE",
      [idCliente]
    );
    if (!clienteRes.rows.length) {
      await db.query("ROLLBACK");
      return res.status(404).json({ success: false, message: `El cliente ${idCliente} no existe` });
    }

    const ventaRes = await db.query(
      "SELECT id_venta, id_cliente, moneda, total, comprobante FROM venta WHERE id_venta = $1 FOR UPDATE",
      [idVenta]
    );
    if (!ventaRes.rows.length) {
      await db.query("ROLLBACK");
      return res.status(404).json({ success: false, message: `La venta ${idVenta} no existe` });
    }

    const venta = ventaRes.rows[0];
    if (String(venta.id_cliente) !== String(idCliente)) {
      await db.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "El cliente seleccionado no coincide con la venta elegida" });
    }

    const monedaTx = normalizeValue(ghost.moneda) || "COP";
    const monedaVenta = normalizeValue(venta.moneda) || monedaTx;
    const requiresConversion = monedaTx !== monedaVenta;
    const exchangeRate = requiresConversion ? parseExchangeRate(tasaConversionRaw) : 1;
    if (requiresConversion && !exchangeRate) {
      await db.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Se requiere la conversión al día para resolver esta transacción fantasma" });
    }

    const valor = Number(ghost.valor || 0);
    const insertTxRes = await db.query(
      `INSERT INTO transaccion
       (id_cliente, fecha, nombre, descripcion, referencia, documento, valor, moneda, id_banco, soporte, tipo_cambio, moneda_referencia, valor_equivalente)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id_transaccion`,
      [
        idCliente,
        ghost.fecha,
        ghost.nombre,
        ghost.descripcion,
        ghost.referencia,
        ghost.documento,
        valor,
        monedaTx,
        ghost.id_banco || null,
        ghost.soporte,
        requiresConversion ? exchangeRate : null,
        requiresConversion ? monedaVenta : null,
        requiresConversion ? roundMoney(valor * exchangeRate) : null
      ]
    );

    const idTransaccion = insertTxRes.rows[0].id_transaccion;
    const saldoVentaRes = await db.query(
      `SELECT (v.total - COALESCE(SUM(ap.valor_aplicado), 0))::NUMERIC(15,2) AS saldo
       FROM venta v
       LEFT JOIN aplicacion_pago ap ON ap.id_venta = v.id_venta
       WHERE v.id_venta = $1
       GROUP BY v.total`,
      [idVenta]
    );
    const saldoVenta = Number(saldoVentaRes.rows[0]?.saldo || 0);
    if (saldoVenta <= 0) {
      await db.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "La venta no tiene saldo pendiente para aplicar" });
    }

    const appliedAmounts = buildAppliedAmounts(valor, saldoVenta, exchangeRate || 1);
    const valorAplicadoVenta = Math.max(0, appliedAmounts.appliedSaleAmount);
    const valorAplicadoTransaccion = Math.max(0, appliedAmounts.appliedTransactionAmount);

    if (valorAplicadoVenta <= 0) {
      await db.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "No fue posible calcular un valor aplicable para la venta" });
    }

    const insertApRes = await db.query(
      `INSERT INTO aplicacion_pago
       (id_transaccion, id_venta, valor_aplicado, valor_aplicado_transaccion, tipo_cambio)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_aplicacion`,
      [idTransaccion, idVenta, valorAplicadoVenta, valorAplicadoTransaccion, requiresConversion ? exchangeRate : 1]
    );

    await db.query(
      `UPDATE transaccion_fantasma
       SET estado = 'resuelto',
           id_cliente_resuelto = $2,
           id_venta_resuelta = $3,
           id_transaccion_resuelta = $4,
           observaciones = COALESCE(NULLIF($5, ''), observaciones),
           resolved_at = NOW(),
           updated_at = NOW()
       WHERE id_fantasma = $1`,
      [idFantasma, idCliente, idVenta, idTransaccion, observaciones]
    );

    await db.query("COMMIT");
    res.json({
      success: true,
      data: {
        id_fantasma: idFantasma,
        id_transaccion: idTransaccion,
        id_aplicacion: insertApRes.rows[0].id_aplicacion,
        id_cliente: idCliente,
        id_venta: idVenta,
        valor_aplicado: valorAplicadoVenta,
        valor_aplicado_transaccion: valorAplicadoTransaccion,
        tipo_cambio: requiresConversion ? exchangeRate : 1
      }
    });
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch (_) {}
    res.status(400).json({ success: false, message: error.message });
  } finally {
    db.release();
  }
});

/**
 * POST /api/aplicaciones
 * Crea una aplicación de pago manual: aplica parte (o todo) del saldo disponible de una transacción
 * a una venta con saldo pendiente.
 *
 * Body JSON:
 * - id_transaccion (number)
 * - id_venta (number)
 * - valor_aplicado (number)
 */
app.post("/api/aplicaciones", async (req, res) => {
  const idTransaccion = Number.parseInt(req.body?.id_transaccion, 10);
  const idVenta = Number.parseInt(req.body?.id_venta, 10);
  const valorRaw = req.body?.valor_aplicado;
  const valorAplicado = typeof valorRaw === 'string' ? Number(valorRaw) : Number(valorRaw);
  const tasaConversionRaw = req.body?.tasa_conversion ?? req.body?.tipo_cambio ?? req.body?.conversion_dia;

  if (!Number.isInteger(idTransaccion) || idTransaccion <= 0) {
    return res.status(400).json({ success: false, message: 'id_transaccion inválido' });
  }
  if (!Number.isInteger(idVenta) || idVenta <= 0) {
    return res.status(400).json({ success: false, message: 'id_venta inválido' });
  }
  if (!Number.isFinite(valorAplicado) || valorAplicado <= 0) {
    return res.status(400).json({ success: false, message: 'valor_aplicado inválido' });
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    // Lock ordenado para evitar deadlocks (venta primero, luego transacción)
    const ventaRes = await db.query(
      'SELECT id_venta, id_cliente, moneda, total FROM venta WHERE id_venta = $1 FOR UPDATE',
      [idVenta]
    );
    if (!ventaRes.rows.length) {
      throw new Error(`La venta ${idVenta} no existe`);
    }

    const txRes = await db.query(
      'SELECT id_transaccion, id_cliente, moneda, moneda_referencia, valor, valor_equivalente FROM transaccion WHERE id_transaccion = $1 FOR UPDATE',
      [idTransaccion]
    );
    if (!txRes.rows.length) {
      throw new Error(`La transacción ${idTransaccion} no existe`);
    }

    const venta = ventaRes.rows[0];
    const tx = txRes.rows[0];
    const txEffectiveCurrency = getEffectiveTransactionCurrency(tx);

    if (String(venta.id_cliente) !== String(tx.id_cliente)) {
      throw new Error('La venta y la transacción deben ser del mismo cliente');
    }

    const ventaMoneda = (venta.moneda || null);
    const txMoneda = txEffectiveCurrency;
    const needsConversion = ventaMoneda !== txMoneda;
    const exchangeRate = needsConversion ? parseExchangeRate(tasaConversionRaw) : 1;
    if (needsConversion && !exchangeRate) {
      throw new Error('Se requiere la conversión al día cuando la moneda de la transacción es diferente a la de la venta');
    }

    // Saldos actuales
    const ventaSaldoRes = await db.query(
      `SELECT (v.total - COALESCE(SUM(ap.valor_aplicado), 0))::NUMERIC(15,2) AS saldo
       FROM venta v
       LEFT JOIN aplicacion_pago ap ON ap.id_venta = v.id_venta
       WHERE v.id_venta = $1
       GROUP BY v.total`,
      [idVenta]
    );
    const txSaldoRes = await db.query(
      `SELECT (
          CASE
            WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
              THEN COALESCE(t.valor_equivalente, t.valor)
            ELSE t.valor
          END - COALESCE(SUM(COALESCE(ap.valor_aplicado_transaccion, ap.valor_aplicado)), 0)
        )::NUMERIC(15,2) AS saldo
       FROM transaccion t
       LEFT JOIN aplicacion_pago ap ON ap.id_transaccion = t.id_transaccion
       WHERE t.id_transaccion = $1
       GROUP BY t.valor, t.moneda, t.moneda_referencia, t.valor_equivalente`,
      [idTransaccion]
    );

    const saldoVenta = Number(ventaSaldoRes.rows[0]?.saldo || 0);
    const saldoTx = Number(txSaldoRes.rows[0]?.saldo || 0);
    if (saldoVenta <= 0) {
      throw new Error('La venta no tiene saldo pendiente');
    }
    if (saldoTx <= 0) {
      throw new Error('La transacción no tiene saldo disponible');
    }

    const appliedAmounts = buildAppliedAmounts(valorAplicado, saldoVenta, exchangeRate || 1);
    const valorVenta = Math.max(0, appliedAmounts.appliedSaleAmount);
    const valorTx = Math.max(0, appliedAmounts.appliedTransactionAmount);

    const valueToCheck = needsConversion ? valorVenta : Math.max(0, Math.min(Number(valorAplicado.toFixed(2)), saldoVenta, saldoTx));
    if (valueToCheck <= 0) {
      throw new Error('El valor a aplicar excede los saldos disponibles');
    }

    if (needsConversion && valorTx > saldoTx) {
      throw new Error('La conversión al día excede el saldo disponible de la transacción');
    }

    const insertRes = await db.query(
      'INSERT INTO aplicacion_pago (id_transaccion, id_venta, valor_aplicado, valor_aplicado_transaccion, tipo_cambio) VALUES ($1, $2, $3, $4, $5) RETURNING id_aplicacion',
      [idTransaccion, idVenta, valorVenta, needsConversion ? valorTx : valorVenta, needsConversion ? exchangeRate : 1]
    );

    // Saldos posteriores
    const ventaSaldoAfterRes = await db.query(
      `SELECT (v.total - COALESCE(SUM(ap.valor_aplicado), 0))::NUMERIC(15,2) AS saldo
       FROM venta v
       LEFT JOIN aplicacion_pago ap ON ap.id_venta = v.id_venta
       WHERE v.id_venta = $1
       GROUP BY v.total`,
      [idVenta]
    );
    const txSaldoAfterRes = await db.query(
      `SELECT (
          CASE
            WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
              THEN COALESCE(t.valor_equivalente, t.valor)
            ELSE t.valor
          END - COALESCE(SUM(COALESCE(ap.valor_aplicado_transaccion, ap.valor_aplicado)), 0)
        )::NUMERIC(15,2) AS saldo
       FROM transaccion t
       LEFT JOIN aplicacion_pago ap ON ap.id_transaccion = t.id_transaccion
       WHERE t.id_transaccion = $1
       GROUP BY t.valor, t.moneda, t.moneda_referencia, t.valor_equivalente`,
      [idTransaccion]
    );

    await db.query('COMMIT');
    res.json({
      success: true,
      data: {
        id_aplicacion: insertRes.rows[0].id_aplicacion,
        id_transaccion: idTransaccion,
        id_venta: idVenta,
        valor_aplicado: valorVenta,
        valor_aplicado_transaccion: needsConversion ? valorTx : valorVenta,
        tipo_cambio: needsConversion ? exchangeRate : 1,
        saldo_venta_antes: saldoVenta,
        saldo_transaccion_antes: saldoTx,
        saldo_venta_despues: Number(ventaSaldoAfterRes.rows[0]?.saldo || 0),
        saldo_transaccion_despues: Number(txSaldoAfterRes.rows[0]?.saldo || 0)
      }
    });
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch (_) {}
    res.status(400).json({ success: false, message: error.message });
  } finally {
    db.release();
  }
});

/**
 * POST /api/clientes/:id_cliente/auto-aplicar-saldos
 * Aplica automáticamente saldos positivos (transacciones con saldo) a ventas con saldo pendiente.
 *
 * Query params:
 * - moneda (opcional): si se envía, solo aplica dentro de esa moneda
 * - dry_run=1|0 (default: 1): si 1, solo simula y NO inserta en aplicacion_pago
 *
 * Estrategia (actual): FIFO
 * - Transacciones: más antiguas primero
 * - Ventas: más antiguas primero
 */
app.post("/api/clientes/:id_cliente/auto-aplicar-saldos", async (req, res) => {
  const idCliente = Number.parseInt(req.params.id_cliente, 10);
  const moneda = (req.query.moneda || "").toString().trim() || null;
  const dryRun = String(req.query.dry_run ?? "1") !== "0";

  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return res.status(400).json({ success: false, message: "id_cliente inválido" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    // Lock del cliente para evitar condiciones de carrera entre auto-aplicaciones.
    await db.query("SELECT pg_advisory_xact_lock($1)", [idCliente]);

    // Confirmar existencia del cliente
    const clienteRes = await db.query("SELECT id_cliente, nombre, identificacion FROM cliente WHERE id_cliente = $1", [idCliente]);
    if (!clienteRes.rows.length) {
      await db.query("ROLLBACK");
      return res.status(404).json({ success: false, message: `Cliente ${idCliente} no existe` });
    }

    const ventasParams = [idCliente];
    let ventasSql = `
      SELECT
        v.id_venta,
        v.fecha_elaboracion,
        v.moneda,
        v.total,
        COALESCE(ap_sum.total_aplicado_venta, 0)::NUMERIC(15,2) AS total_aplicado,
        (v.total - COALESCE(ap_sum.total_aplicado_venta, 0))::NUMERIC(15,2) AS saldo_venta
      FROM venta v
      LEFT JOIN (
        SELECT
          id_venta,
          SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado_venta,
          SUM(COALESCE(valor_aplicado_transaccion, valor_aplicado))::NUMERIC(15,2) AS total_aplicado_transaccion
        FROM aplicacion_pago
        GROUP BY id_venta
      ) ap_sum ON ap_sum.id_venta = v.id_venta
      WHERE v.id_cliente = $1
        AND (v.total - COALESCE(ap_sum.total_aplicado_venta, 0)) > 0
    `;
    if (moneda) {
      ventasSql += ` AND v.moneda = $${ventasParams.length + 1}`;
      ventasParams.push(moneda);
    }
    ventasSql += ` ORDER BY v.fecha_elaboracion ASC NULLS LAST, v.id_venta ASC`;

    const txParams = [idCliente];
    const txSql = `
      SELECT
        t.id_transaccion,
        t.fecha,
        CASE
          WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
            THEN 'COP'
          ELSE COALESCE(t.moneda, 'COP')
        END AS moneda,
        (
          CASE
            WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
              THEN COALESCE(t.valor_equivalente, t.valor)
            ELSE t.valor
          END
        )::NUMERIC(15,2) AS valor,
        COALESCE(ap_sum.total_aplicado_venta, 0)::NUMERIC(15,2) AS total_aplicado,
        COALESCE(ap_sum.total_aplicado_transaccion, COALESCE(ap_sum.total_aplicado_venta, 0))::NUMERIC(15,2) AS total_aplicado_transaccion,
        (
          CASE
            WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
              THEN COALESCE(t.valor_equivalente, t.valor)
            ELSE t.valor
          END - COALESCE(ap_sum.total_aplicado_transaccion, COALESCE(ap_sum.total_aplicado_venta, 0))
        )::NUMERIC(15,2) AS saldo_transaccion
      FROM transaccion t
      LEFT JOIN (
        SELECT
          id_transaccion,
          SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado_venta,
          SUM(COALESCE(valor_aplicado_transaccion, valor_aplicado))::NUMERIC(15,2) AS total_aplicado_transaccion
        FROM aplicacion_pago
        GROUP BY id_transaccion
      ) ap_sum ON ap_sum.id_transaccion = t.id_transaccion
      WHERE t.id_cliente = $1
        AND (
          CASE
            WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
              THEN COALESCE(t.valor_equivalente, t.valor)
            ELSE t.valor
          END - COALESCE(ap_sum.total_aplicado_transaccion, COALESCE(ap_sum.total_aplicado_venta, 0))
        ) > 0
    `;
    if (moneda) {
      txSql += ` AND t.moneda = $${txParams.length + 1}`;
      txParams.push(moneda);
    }
    txSql += ` ORDER BY t.fecha ASC, t.id_transaccion ASC`;

    const ventasRes = await db.query(ventasSql, ventasParams);
    const txRes = await db.query(txSql, txParams);

    // Modelo en memoria de saldos
    const ventas = ventasRes.rows.map((v) => ({
      id_venta: Number(v.id_venta),
      moneda: v.moneda || null,
      saldo: Number(v.saldo_venta || 0)
    }));

    const transacciones = txRes.rows.map((t) => ({
      id_transaccion: Number(t.id_transaccion),
      moneda: t.moneda || null,
      saldo: Number(t.saldo_transaccion || 0)
    }));

    const saldoPositivoTotal = Number(
      transacciones.reduce((acc, tx) => acc + Math.max(0, Number(tx.saldo || 0)), 0).toFixed(2)
    );
    const transaccionesConSaldo = transacciones.filter((tx) => Number(tx.saldo || 0) > 0).length;
    const ventasPendientes = ventas.filter((venta) => Number(venta.saldo || 0) > 0).length;
    const saldoPositivoPorMoneda = transacciones.reduce((acc, tx) => {
      const currency = String(tx.moneda || "COP").trim().toUpperCase() || "COP";
      const current = Number(acc[currency] || 0);
      const next = current + Math.max(0, Number(tx.saldo || 0));
      acc[currency] = Number(next.toFixed(2));
      return acc;
    }, {});

    // Nada que hacer para aplicar, pero sí devolvemos el resumen de saldo positivo.
    if (ventasRes.rows.length === 0 || txRes.rows.length === 0) {
      await db.query("COMMIT");
      return res.json({
        success: true,
        data: {
          dry_run: dryRun,
          cliente: clienteRes.rows[0],
          moneda,
          saldo_positivo_total: saldoPositivoTotal,
          saldo_positivo_por_moneda: saldoPositivoPorMoneda,
          transacciones_con_saldo: transaccionesConSaldo,
          ventas_pendientes: ventasPendientes,
          applied_total: 0,
          aplicaciones: [],
          message: ventasRes.rows.length === 0
            ? "No hay ventas con saldo pendiente para aplicar"
            : "No hay transacciones con saldo positivo disponible"
        }
      });
    }

    const aplicaciones = [];

    // Aplicación FIFO: transacciones -> ventas
    for (const tx of transacciones) {
      if (tx.saldo <= 0) continue;

      for (const v of ventas) {
        if (tx.saldo <= 0) break;
        if (v.saldo <= 0) continue;

        // No cruzar monedas
        if ((tx.moneda || null) !== (v.moneda || null)) continue;

        const valorAplicado = Math.min(tx.saldo, v.saldo);
        if (valorAplicado <= 0) continue;

        aplicaciones.push({
          id_transaccion: tx.id_transaccion,
          id_venta: v.id_venta,
          valor_aplicado: Number(valorAplicado.toFixed(2)),
          valor_aplicado_transaccion: Number(valorAplicado.toFixed(2)),
          tipo_cambio: 1
        });

        tx.saldo = Number((tx.saldo - valorAplicado).toFixed(2));
        v.saldo = Number((v.saldo - valorAplicado).toFixed(2));
      }
    }

    if (!dryRun) {
      // Insertar aplicaciones con validación por locks individuales.
      for (const a of aplicaciones) {
        // Bloquea venta y transacción para coordinación con otros flujos (bulk, ediciones)
        const ventaLock = await db.query(
          "SELECT id_venta, id_cliente, moneda, total FROM venta WHERE id_venta = $1 FOR UPDATE",
          [a.id_venta]
        );
        if (!ventaLock.rows.length || Number(ventaLock.rows[0].id_cliente) !== idCliente) {
          throw new Error(`Venta ${a.id_venta} inválida para el cliente ${idCliente}`);
        }

        const txLock = await db.query(
          "SELECT id_transaccion, id_cliente, moneda, valor FROM transaccion WHERE id_transaccion = $1 FOR UPDATE",
          [a.id_transaccion]
        );
        if (!txLock.rows.length || Number(txLock.rows[0].id_cliente) !== idCliente) {
          throw new Error(`Transacción ${a.id_transaccion} inválida para el cliente ${idCliente}`);
        }

        const ventaMoneda = (ventaLock.rows[0].moneda || null);
        const txMoneda = (txLock.rows[0].moneda || null);
        if (ventaMoneda !== txMoneda) {
          // En teoría no debería pasar por el filtro anterior.
          continue;
        }

        // Recalcular saldos actuales (por seguridad)
        const ventaSaldoRes = await db.query(
          `SELECT (v.total - COALESCE(SUM(ap.valor_aplicado), 0))::NUMERIC(15,2) AS saldo
           FROM venta v
           LEFT JOIN aplicacion_pago ap ON ap.id_venta = v.id_venta
           WHERE v.id_venta = $1
           GROUP BY v.total`,
          [a.id_venta]
        );
        const txSaldoRes = await db.query(
          `SELECT (t.valor - COALESCE(SUM(ap.valor_aplicado), 0))::NUMERIC(15,2) AS saldo
           FROM transaccion t
           LEFT JOIN aplicacion_pago ap ON ap.id_transaccion = t.id_transaccion
           WHERE t.id_transaccion = $1
           GROUP BY t.valor`,
          [a.id_transaccion]
        );

        const saldoVenta = Number(ventaSaldoRes.rows[0]?.saldo || 0);
        const saldoTx = Number(txSaldoRes.rows[0]?.saldo || 0);
        const valor = Math.max(0, Math.min(Number(a.valor_aplicado || 0), saldoVenta, saldoTx));
        if (valor <= 0) continue;

        await db.query(
          "INSERT INTO aplicacion_pago (id_transaccion, id_venta, valor_aplicado, valor_aplicado_transaccion, tipo_cambio) VALUES ($1, $2, $3, $4, $5)",
          [a.id_transaccion, a.id_venta, valor, valor, 1]
        );
      }
    }

    const appliedTotal = aplicaciones.reduce((acc, a) => acc + Number(a.valor_aplicado || 0), 0);

    await db.query("COMMIT");
    res.json({
      success: true,
      data: {
        dry_run: dryRun,
        cliente: clienteRes.rows[0],
        moneda,
        saldo_positivo_total: saldoPositivoTotal,
        saldo_positivo_por_moneda: saldoPositivoPorMoneda,
        transacciones_con_saldo: transaccionesConSaldo,
        ventas_pendientes: ventasPendientes,
        applied_total: Number(appliedTotal.toFixed(2)),
        aplicaciones
      }
    });
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch (_) {}
    res.status(500).json({ success: false, message: error.message });
  } finally {
    db.release();
  }
});

/**
 * =============================
 * RUTAS DE REPORTES
 * =============================
 */

/**
 * GET /api/reportes/filtros-disponibles
 * Retorna opciones para los filtros dinámicos
 */
app.get("/api/reportes/filtros-disponibles", async (req, res) => {
  try {
    const clientesResult = await pool.query(
      "SELECT DISTINCT id_cliente, identificacion, nombre FROM cliente ORDER BY nombre"
    );

    // Monedas: obtener de las tablas venta y transaccion en lugar de tabla moneda
    const monedasResult = await pool.query(`
      SELECT DISTINCT moneda AS codigo FROM (
        SELECT DISTINCT moneda FROM venta WHERE moneda IS NOT NULL
        UNION
        SELECT DISTINCT moneda FROM transaccion WHERE moneda IS NOT NULL
      ) m
      WHERE moneda IS NOT NULL
      ORDER BY moneda
    `);

    const tiposResult = await pool.query(
      "SELECT DISTINCT tipo_transaccion FROM venta WHERE tipo_transaccion IS NOT NULL ORDER BY tipo_transaccion"
    );

    const estadosResult = await pool.query(
      "SELECT DISTINCT estado_envio_correo FROM venta WHERE estado_envio_correo IS NOT NULL ORDER BY estado_envio_correo"
    );

    const bancosResult = await pool.query(
      "SELECT id_banco, codigo, nombre FROM banco ORDER BY nombre"
    );

    const fechasResult = await pool.query(`
      SELECT 
        MIN(fecha_elaboracion) as fecha_minima,
        MAX(fecha_elaboracion) as fecha_maxima
      FROM venta
      WHERE fecha_elaboracion IS NOT NULL
    `);

    // Mapeo de monedas con nombres
    const monedaNombres = {
      "COP": "Peso Colombiano",
      "USD": "Dólar estadounidense",
      "EUR": "Euro",
      "PAB": "Balboa (Panamá)"
    };

    const monedasConNombre = monedasResult.rows.map(m => ({
      codigo: m.codigo,
      nombre: monedaNombres[m.codigo] || m.codigo
    }));

    res.json({
      success: true,
      data: {
        clientes: clientesResult.rows,
        monedas: monedasConNombre,
        tipos_transaccion: tiposResult.rows.map(r => r.tipo_transaccion),
        estados: estadosResult.rows.map(r => r.estado_envio_correo),
        bancos: bancosResult.rows,
        rango_fechas: {
          fecha_minima: fechasResult.rows[0]?.fecha_minima,
          fecha_maxima: fechasResult.rows[0]?.fecha_maxima
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/reportes/datos
 * Retorna datos de ventas y transacciones con filtros aplicados
 * Query params: cliente_id, moneda, tipo, estado, fecha_inicio, fecha_fin, tipo_dato (ventas|transacciones|ambos)
 */
app.get("/api/reportes/datos", async (req, res) => {
  try {
    const {
      cliente_id,
      moneda,
      tipo,
      estado,
      fecha_inicio,
      fecha_fin,
      tipo_dato = "ambos",
      venta_estado_abono,
      banco_id
    } = req.query;

    let ventasData = [];
    let transaccionesData = [];

    // Construcción de filtros para ventas
    if (tipo_dato === "ventas" || tipo_dato === "ambos") {
      let ventasQuery = `
        SELECT 
          v.id_venta,
          v.id_cliente,
          c.nombre as cliente_nombre,
          c.identificacion as cliente_nit,
          v.tipo_transaccion,
          v.comprobante,
          v.fecha_elaboracion,
          v.fecha_vencimiento,
          v.sucursal,
          v.estado_envio_correo,
          v.total,
          v.moneda,
          COALESCE(ap_sum.total_aplicado, 0)::NUMERIC(15,2) AS total_aplicado,
          (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) AS saldo_venta
        FROM venta v
        JOIN cliente c ON v.id_cliente = c.id_cliente
        LEFT JOIN (
          SELECT id_venta, SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado
          FROM aplicacion_pago
          GROUP BY id_venta
        ) ap_sum ON ap_sum.id_venta = v.id_venta
        WHERE 1=1
      `;

      const ventasParams = [];

      if (cliente_id) {
        ventasQuery += ` AND v.id_cliente = $${ventasParams.length + 1}`;
        ventasParams.push(parseInt(cliente_id));
      }
      if (moneda) {
        ventasQuery += ` AND v.moneda = $${ventasParams.length + 1}`;
        ventasParams.push(moneda);
      }
      if (tipo) {
        ventasQuery += ` AND v.tipo_transaccion = $${ventasParams.length + 1}`;
        ventasParams.push(tipo);
      }
      if (estado) {
        ventasQuery += ` AND v.estado_envio_correo = $${ventasParams.length + 1}`;
        ventasParams.push(estado);
      }
      if (fecha_inicio) {
        ventasQuery += ` AND v.fecha_elaboracion >= $${ventasParams.length + 1}`;
        ventasParams.push(fecha_inicio);
      }
      if (fecha_fin) {
        ventasQuery += ` AND v.fecha_vencimiento <= $${ventasParams.length + 1}`;
        ventasParams.push(fecha_fin);
      }

      if (venta_estado_abono === "pendiente") {
        ventasQuery += ` AND (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) > 0`;
      }

      if (venta_estado_abono === "completado") {
        ventasQuery += ` AND (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) <= 0`;
      }

      ventasQuery += ` ORDER BY c.nombre ASC, v.fecha_elaboracion DESC, v.id_venta DESC`;

      const ventasResult = await pool.query(ventasQuery, ventasParams);
      ventasData = ventasResult.rows;
    }

    // Construcción de filtros para transacciones
    if (tipo_dato === "transacciones" || tipo_dato === "ambos") {
      let transaccionesQuery = `
        SELECT 
          t.id_transaccion,
          t.id_cliente,
          c.nombre as cliente_nombre,
          c.identificacion as cliente_nit,
          t.fecha,
          t.nombre,
          t.descripcion,
          t.referencia,
          t.documento,
          t.valor,
          t.moneda,
            t.moneda_referencia,
            t.valor_equivalente,
          COALESCE(b.nombre, '-') AS banco_nombre,
          COALESCE(ap_ventas.ventas_asociadas, 0) AS ventas_asociadas,
          COALESCE(ap_sum.total_aplicado, 0)::NUMERIC(15,2) AS total_aplicado,
            (
              CASE
                WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
                  THEN COALESCE(t.valor_equivalente, t.valor)
                ELSE t.valor
              END - COALESCE(ap_sum.total_aplicado, 0)
            )::NUMERIC(15,2) AS saldo_transaccion
        FROM transaccion t
        JOIN cliente c ON t.id_cliente = c.id_cliente
        LEFT JOIN banco b ON t.id_banco = b.id_banco
        LEFT JOIN (
          SELECT id_transaccion, COUNT(DISTINCT id_venta) AS ventas_asociadas
          FROM aplicacion_pago
          WHERE id_transaccion IS NOT NULL AND id_venta IS NOT NULL
          GROUP BY id_transaccion
        ) ap_ventas ON ap_ventas.id_transaccion = t.id_transaccion
        LEFT JOIN (
          SELECT id_transaccion, SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado
          FROM aplicacion_pago
          GROUP BY id_transaccion
        ) ap_sum ON ap_sum.id_transaccion = t.id_transaccion
        WHERE 1=1
      `;

      const transaccionesParams = [];

      if (cliente_id) {
        transaccionesQuery += ` AND t.id_cliente = $${transaccionesParams.length + 1}`;
        transaccionesParams.push(parseInt(cliente_id));
      }
      if (moneda) {
        transaccionesQuery += ` AND t.moneda = $${transaccionesParams.length + 1}`;
        transaccionesParams.push(moneda);
      }
      if (fecha_inicio) {
        transaccionesQuery += ` AND DATE(t.fecha) >= $${transaccionesParams.length + 1}`;
        transaccionesParams.push(fecha_inicio);
      }
      if (fecha_fin) {
        transaccionesQuery += ` AND DATE(t.fecha) <= $${transaccionesParams.length + 1}`;
        transaccionesParams.push(fecha_fin);
      }

      if (banco_id) {
        transaccionesQuery += ` AND t.id_banco = $${transaccionesParams.length + 1}`;
        transaccionesParams.push(parseInt(banco_id, 10));
      }

      transaccionesQuery += ` ORDER BY c.nombre ASC, t.fecha DESC, t.id_transaccion DESC`;

      const transaccionesResult = await pool.query(transaccionesQuery, transaccionesParams);
      transaccionesData = transaccionesResult.rows;
    }

    res.json({
      success: true,
      data: {
        ventas: ventasData,
        transacciones: transaccionesData,
        total_ventas: ventasData.length,
        total_transacciones: transaccionesData.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/reportes/agregados
 * Retorna datos agregados para gráficos
 */
app.get("/api/reportes/agregados", async (req, res) => {
  try {
    const {
      cliente_id,
      moneda,
      tipo,
      estado,
      fecha_inicio,
      fecha_fin,
      tipo_dato = "ambos",
      venta_estado_abono,
      banco_id
    } = req.query;

    const agregados = {};

    // Agregados por cliente
    if (tipo_dato === "ventas" || tipo_dato === "ambos") {
      let queryClienteVentas = `
        SELECT 
          c.nombre as cliente,
          v.moneda,
          SUM(v.total)::NUMERIC(15,2) AS total_ventas,
          COUNT(v.id_venta) AS cantidad_ventas
        FROM venta v
        JOIN cliente c ON v.id_cliente = c.id_cliente
        LEFT JOIN (
          SELECT id_venta, SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado
          FROM aplicacion_pago
          GROUP BY id_venta
        ) ap_sum ON ap_sum.id_venta = v.id_venta
        WHERE 1=1
      `;

      const params = [];

      if (cliente_id) {
        queryClienteVentas += ` AND v.id_cliente = $${params.length + 1}`;
        params.push(parseInt(cliente_id));
      }
      if (moneda) {
        queryClienteVentas += ` AND v.moneda = $${params.length + 1}`;
        params.push(moneda);
      }
      if (tipo) {
        queryClienteVentas += ` AND v.tipo_transaccion = $${params.length + 1}`;
        params.push(tipo);
      }
      if (estado) {
        queryClienteVentas += ` AND v.estado_envio_correo = $${params.length + 1}`;
        params.push(estado);
      }
      if (fecha_inicio) {
        queryClienteVentas += ` AND v.fecha_elaboracion >= $${params.length + 1}`;
        params.push(fecha_inicio);
      }
      if (fecha_fin) {
        queryClienteVentas += ` AND v.fecha_vencimiento <= $${params.length + 1}`;
        params.push(fecha_fin);
      }

      if (venta_estado_abono === "pendiente") {
        queryClienteVentas += ` AND (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) > 0`;
      }

      if (venta_estado_abono === "completado") {
        queryClienteVentas += ` AND (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) <= 0`;
      }

      queryClienteVentas += ` GROUP BY c.nombre, v.moneda ORDER BY total_ventas DESC, c.nombre ASC, v.moneda ASC`;

      const resultClienteVentas = await pool.query(queryClienteVentas, params);
      agregados.por_cliente = resultClienteVentas.rows;

      // Agregados por moneda
      let queryMoneda = `
        SELECT 
          v.moneda,
          SUM(v.total)::NUMERIC(15,2) AS total,
          COUNT(v.id_venta) AS cantidad
        FROM venta v
        LEFT JOIN (
          SELECT id_venta, SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado
          FROM aplicacion_pago
          GROUP BY id_venta
        ) ap_sum ON ap_sum.id_venta = v.id_venta
        WHERE 1=1
      `;

      const paramsMoneda = [];

      if (cliente_id) {
        queryMoneda += ` AND v.id_cliente = $${paramsMoneda.length + 1}`;
        paramsMoneda.push(parseInt(cliente_id));
      }
      if (moneda) {
        queryMoneda += ` AND v.moneda = $${paramsMoneda.length + 1}`;
        paramsMoneda.push(moneda);
      }
      if (tipo) {
        queryMoneda += ` AND v.tipo_transaccion = $${paramsMoneda.length + 1}`;
        paramsMoneda.push(tipo);
      }
      if (estado) {
        queryMoneda += ` AND v.estado_envio_correo = $${paramsMoneda.length + 1}`;
        paramsMoneda.push(estado);
      }
      if (fecha_inicio) {
        queryMoneda += ` AND v.fecha_elaboracion >= $${paramsMoneda.length + 1}`;
        paramsMoneda.push(fecha_inicio);
      }
      if (fecha_fin) {
        queryMoneda += ` AND v.fecha_vencimiento <= $${paramsMoneda.length + 1}`;
        paramsMoneda.push(fecha_fin);
      }

      if (venta_estado_abono === "pendiente") {
        queryMoneda += ` AND (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) > 0`;
      }

      if (venta_estado_abono === "completado") {
        queryMoneda += ` AND (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) <= 0`;
      }

      queryMoneda += ` GROUP BY v.moneda ORDER BY total DESC`;

      const resultMoneda = await pool.query(queryMoneda, paramsMoneda);
      agregados.por_moneda = resultMoneda.rows;

      // Series de tiempo (diarias)
      let queryTiempoVentas = `
        SELECT 
          DATE(v.fecha_elaboracion) as fecha,
          v.moneda,
          SUM(v.total)::NUMERIC(15,2) AS total,
          COUNT(v.id_venta) AS cantidad
        FROM venta v
        LEFT JOIN (
          SELECT id_venta, SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado
          FROM aplicacion_pago
          GROUP BY id_venta
        ) ap_sum ON ap_sum.id_venta = v.id_venta
        WHERE v.fecha_elaboracion IS NOT NULL
      `;

      const paramsTiempo = [];

      if (cliente_id) {
        queryTiempoVentas += ` AND v.id_cliente = $${paramsTiempo.length + 1}`;
        paramsTiempo.push(parseInt(cliente_id));
      }
      if (moneda) {
        queryTiempoVentas += ` AND v.moneda = $${paramsTiempo.length + 1}`;
        paramsTiempo.push(moneda);
      }
      if (tipo) {
        queryTiempoVentas += ` AND v.tipo_transaccion = $${paramsTiempo.length + 1}`;
        paramsTiempo.push(tipo);
      }
      if (estado) {
        queryTiempoVentas += ` AND v.estado_envio_correo = $${paramsTiempo.length + 1}`;
        paramsTiempo.push(estado);
      }
      if (fecha_inicio) {
        queryTiempoVentas += ` AND v.fecha_elaboracion >= $${paramsTiempo.length + 1}`;
        paramsTiempo.push(fecha_inicio);
      }
      if (fecha_fin) {
        queryTiempoVentas += ` AND v.fecha_vencimiento <= $${paramsTiempo.length + 1}`;
        paramsTiempo.push(fecha_fin);
      }

      if (venta_estado_abono === "pendiente") {
        queryTiempoVentas += ` AND (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) > 0`;
      }

      if (venta_estado_abono === "completado") {
        queryTiempoVentas += ` AND (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) <= 0`;
      }

      queryTiempoVentas += ` GROUP BY DATE(v.fecha_elaboracion), v.moneda ORDER BY fecha ASC, v.moneda ASC`;

      const resultTiempo = await pool.query(queryTiempoVentas, paramsTiempo);
      agregados.serie_tiempo_ventas = resultTiempo.rows;
    }

    // Agregados de transacciones por banco y serie temporal
    if (tipo_dato === "transacciones" || tipo_dato === "ambos") {
      let queryBanco = `
        SELECT
          COALESCE(b.nombre, '-') AS banco,
          t.moneda,
          SUM(t.valor)::NUMERIC(15,2) AS total,
          COUNT(t.id_transaccion) AS cantidad
        FROM transaccion t
        LEFT JOIN banco b ON b.id_banco = t.id_banco
        WHERE 1=1
      `;

      const paramsBanco = [];

      if (cliente_id) {
        queryBanco += ` AND t.id_cliente = $${paramsBanco.length + 1}`;
        paramsBanco.push(parseInt(cliente_id, 10));
      }
      if (moneda) {
        queryBanco += ` AND t.moneda = $${paramsBanco.length + 1}`;
        paramsBanco.push(moneda);
      }
      if (fecha_inicio) {
        queryBanco += ` AND DATE(t.fecha) >= $${paramsBanco.length + 1}`;
        paramsBanco.push(fecha_inicio);
      }
      if (fecha_fin) {
        queryBanco += ` AND DATE(t.fecha) <= $${paramsBanco.length + 1}`;
        paramsBanco.push(fecha_fin);
      }
      if (banco_id) {
        queryBanco += ` AND t.id_banco = $${paramsBanco.length + 1}`;
        paramsBanco.push(parseInt(banco_id, 10));
      }

      queryBanco += ` GROUP BY COALESCE(b.nombre, '-'), t.moneda ORDER BY total DESC, banco ASC, t.moneda ASC`;
      const resultBanco = await pool.query(queryBanco, paramsBanco);
      agregados.transacciones_por_banco = resultBanco.rows;

      let queryTiempoTx = `
        SELECT
          DATE(t.fecha) AS fecha,
          t.moneda,
          SUM(t.valor)::NUMERIC(15,2) AS total,
          COUNT(t.id_transaccion) AS cantidad
        FROM transaccion t
        WHERE t.fecha IS NOT NULL
      `;

      const paramsTiempoTx = [];

      if (cliente_id) {
        queryTiempoTx += ` AND t.id_cliente = $${paramsTiempoTx.length + 1}`;
        paramsTiempoTx.push(parseInt(cliente_id, 10));
      }
      if (moneda) {
        queryTiempoTx += ` AND t.moneda = $${paramsTiempoTx.length + 1}`;
        paramsTiempoTx.push(moneda);
      }
      if (fecha_inicio) {
        queryTiempoTx += ` AND DATE(t.fecha) >= $${paramsTiempoTx.length + 1}`;
        paramsTiempoTx.push(fecha_inicio);
      }
      if (fecha_fin) {
        queryTiempoTx += ` AND DATE(t.fecha) <= $${paramsTiempoTx.length + 1}`;
        paramsTiempoTx.push(fecha_fin);
      }
      if (banco_id) {
        queryTiempoTx += ` AND t.id_banco = $${paramsTiempoTx.length + 1}`;
        paramsTiempoTx.push(parseInt(banco_id, 10));
      }

      queryTiempoTx += ` GROUP BY DATE(t.fecha), t.moneda ORDER BY fecha ASC, t.moneda ASC`;
      const resultTiempoTx = await pool.query(queryTiempoTx, paramsTiempoTx);
      agregados.serie_tiempo_transacciones = resultTiempoTx.rows;
    }

    // Resumen general
    const resumenVentasParams = [];
    const resumenTxParams = [];
    const resumenVentasWhere = [];
    const resumenTxWhere = [];

    if (cliente_id) {
      resumenVentasWhere.push(`v.id_cliente = $${resumenVentasParams.length + 1}`);
      resumenVentasParams.push(parseInt(cliente_id, 10));
      resumenTxWhere.push(`t.id_cliente = $${resumenTxParams.length + 1}`);
      resumenTxParams.push(parseInt(cliente_id, 10));
    }
    if (moneda) {
      resumenVentasWhere.push(`v.moneda = $${resumenVentasParams.length + 1}`);
      resumenVentasParams.push(moneda);
      resumenTxWhere.push(`t.moneda = $${resumenTxParams.length + 1}`);
      resumenTxParams.push(moneda);
    }
    if (fecha_inicio) {
      resumenVentasWhere.push(`v.fecha_elaboracion >= $${resumenVentasParams.length + 1}`);
      resumenVentasParams.push(fecha_inicio);
      resumenTxWhere.push(`DATE(t.fecha) >= $${resumenTxParams.length + 1}`);
      resumenTxParams.push(fecha_inicio);
    }
    if (fecha_fin) {
      resumenVentasWhere.push(`v.fecha_vencimiento <= $${resumenVentasParams.length + 1}`);
      resumenVentasParams.push(fecha_fin);
      resumenTxWhere.push(`DATE(t.fecha) <= $${resumenTxParams.length + 1}`);
      resumenTxParams.push(fecha_fin);
    }

    const [resultResumenClientes, resultResumenVentas, resultResumenTx] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT c.id_cliente) AS total_clientes
         FROM cliente c
         ${cliente_id ? "WHERE c.id_cliente = $1" : ""}`,
        cliente_id ? [parseInt(cliente_id, 10)] : []
      ),
      pool.query(
        `SELECT
           v.moneda,
           COUNT(v.id_venta) AS total_ventas,
           SUM(v.total)::NUMERIC(15,2) AS monto_total_ventas
         FROM venta v
         ${resumenVentasWhere.length ? `WHERE ${resumenVentasWhere.join(" AND ")}` : ""}
         GROUP BY v.moneda
         ORDER BY v.moneda`,
        resumenVentasParams
      ),
      pool.query(
        `SELECT
           t.moneda,
           COUNT(t.id_transaccion) AS total_transacciones,
           SUM(t.valor)::NUMERIC(15,2) AS monto_total_transacciones
         FROM transaccion t
         ${resumenTxWhere.length ? `WHERE ${resumenTxWhere.join(" AND ")}` : ""}
         GROUP BY t.moneda
         ORDER BY t.moneda`,
        resumenTxParams
      )
    ]);

    agregados.resumen = {
      total_clientes: Number(resultResumenClientes.rows[0]?.total_clientes || 0),
      ventas_por_moneda: resultResumenVentas.rows,
      transacciones_por_moneda: resultResumenTx.rows
    };

    res.json({
      success: true,
      data: agregados
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/reportes/export
 * Descarga un reporte (CSV o XLSX) con los filtros aplicados.
 * Query params: mismos de /api/reportes/datos +
 * - format: csv|xlsx (default xlsx)
 * - include_ventas: 1|0 (default 1)
 * - include_transacciones: 1|0 (default 1)
 */
app.get("/api/reportes/export", async (req, res) => {
  try {
    const {
      format = "xlsx",
      include_ventas = "1",
      include_transacciones = "1",
      include_saldos = "1"
    } = req.query;

    const includeVentas = include_ventas === "1";
    const includeTransacciones = include_transacciones === "1";
    const includeSaldos = include_saldos === "1";

    if (!includeVentas && !includeTransacciones) {
      return res.status(400).json({ success: false, message: "Debes seleccionar al menos un conjunto de datos" });
    }

    if (String(format).toLowerCase() === "csv" && includeVentas && includeTransacciones) {
      return res.status(400).json({
        success: false,
        message: "Para CSV selecciona solo Ventas o solo Transacciones (para ambos usa XLSX)."
      });
    }

    // Reutiliza la misma lógica que /api/reportes/datos
    const proxyReq = { query: { ...req.query } };
    // Fuerza tipo_dato según selección
    if (includeVentas && !includeTransacciones) proxyReq.query.tipo_dato = "ventas";
    if (!includeVentas && includeTransacciones) proxyReq.query.tipo_dato = "transacciones";
    if (includeVentas && includeTransacciones) proxyReq.query.tipo_dato = "ambos";

    const {
      cliente_id,
      moneda,
      tipo,
      estado,
      fecha_inicio,
      fecha_fin,
      tipo_dato = "ambos",
      venta_estado_abono,
      banco_id
    } = proxyReq.query;

    const data = { ventas: [], transacciones: [] };

    if (tipo_dato === "ventas" || tipo_dato === "ambos") {
      let ventasQuery = `
        SELECT 
          v.id_venta,
          c.nombre as cliente_nombre,
          c.identificacion as cliente_nit,
          v.fecha_elaboracion,
          v.fecha_vencimiento,
          v.comprobante,
          v.tipo_transaccion,
          v.moneda,
          v.total,
          COALESCE(ap_sum.total_aplicado, 0)::NUMERIC(15,2) AS total_aplicado,
          (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) AS saldo_venta,
          v.estado_envio_correo
        FROM venta v
        JOIN cliente c ON v.id_cliente = c.id_cliente
        LEFT JOIN (
          SELECT id_venta, SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado
          FROM aplicacion_pago
          GROUP BY id_venta
        ) ap_sum ON ap_sum.id_venta = v.id_venta
        WHERE 1=1
      `;

      const ventasParams = [];

      if (cliente_id) {
        ventasQuery += ` AND v.id_cliente = $${ventasParams.length + 1}`;
        ventasParams.push(parseInt(cliente_id, 10));
      }
      if (moneda) {
        ventasQuery += ` AND v.moneda = $${ventasParams.length + 1}`;
        ventasParams.push(moneda);
      }
      if (tipo) {
        ventasQuery += ` AND v.tipo_transaccion = $${ventasParams.length + 1}`;
        ventasParams.push(tipo);
      }
      if (estado) {
        ventasQuery += ` AND v.estado_envio_correo = $${ventasParams.length + 1}`;
        ventasParams.push(estado);
      }
      if (fecha_inicio) {
        ventasQuery += ` AND v.fecha_elaboracion >= $${ventasParams.length + 1}`;
        ventasParams.push(fecha_inicio);
      }
      if (fecha_fin) {
        ventasQuery += ` AND v.fecha_vencimiento <= $${ventasParams.length + 1}`;
        ventasParams.push(fecha_fin);
      }

      if (venta_estado_abono === "pendiente") {
        ventasQuery += ` AND (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) > 0`;
      }
      if (venta_estado_abono === "completado") {
        ventasQuery += ` AND (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) <= 0`;
      }

      ventasQuery += ` ORDER BY c.nombre ASC, v.fecha_elaboracion DESC, v.id_venta DESC`;

      const ventasResult = await pool.query(ventasQuery, ventasParams);
      data.ventas = ventasResult.rows;
    }

    if (tipo_dato === "transacciones" || tipo_dato === "ambos") {
      let transaccionesQuery = `
        SELECT 
          t.id_transaccion,
          c.nombre as cliente_nombre,
          c.identificacion as cliente_nit,
          t.fecha,
          t.nombre,
          t.descripcion,
          COALESCE(b.nombre, '-') AS banco_nombre,
          t.moneda,
          t.valor,
            t.moneda_referencia,
            t.valor_equivalente,
          COALESCE(ap_ventas.ventas_asociadas, 0) AS ventas_asociadas,
          COALESCE(ap_sum.total_aplicado, 0)::NUMERIC(15,2) AS total_aplicado,
            (
              CASE
                WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
                  THEN COALESCE(t.valor_equivalente, t.valor)
                ELSE t.valor
              END - COALESCE(ap_sum.total_aplicado, 0)
            )::NUMERIC(15,2) AS saldo_transaccion
        FROM transaccion t
        JOIN cliente c ON t.id_cliente = c.id_cliente
        LEFT JOIN banco b ON t.id_banco = b.id_banco
        LEFT JOIN (
          SELECT id_transaccion, COUNT(DISTINCT id_venta) AS ventas_asociadas
          FROM aplicacion_pago
          WHERE id_transaccion IS NOT NULL AND id_venta IS NOT NULL
          GROUP BY id_transaccion
        ) ap_ventas ON ap_ventas.id_transaccion = t.id_transaccion
        LEFT JOIN (
          SELECT id_transaccion, SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado
          FROM aplicacion_pago
          GROUP BY id_transaccion
        ) ap_sum ON ap_sum.id_transaccion = t.id_transaccion
        WHERE 1=1
      `;

      const transaccionesParams = [];

      if (cliente_id) {
        transaccionesQuery += ` AND t.id_cliente = $${transaccionesParams.length + 1}`;
        transaccionesParams.push(parseInt(cliente_id, 10));
      }
      if (moneda) {
        transaccionesQuery += ` AND t.moneda = $${transaccionesParams.length + 1}`;
        transaccionesParams.push(moneda);
      }
      if (fecha_inicio) {
        transaccionesQuery += ` AND DATE(t.fecha) >= $${transaccionesParams.length + 1}`;
        transaccionesParams.push(fecha_inicio);
      }
      if (fecha_fin) {
        transaccionesQuery += ` AND DATE(t.fecha) <= $${transaccionesParams.length + 1}`;
        transaccionesParams.push(fecha_fin);
      }
      if (banco_id) {
        transaccionesQuery += ` AND t.id_banco = $${transaccionesParams.length + 1}`;
        transaccionesParams.push(parseInt(banco_id, 10));
      }

      transaccionesQuery += ` ORDER BY c.nombre ASC, t.fecha DESC, t.id_transaccion DESC`;
      const transaccionesResult = await pool.query(transaccionesQuery, transaccionesParams);
      data.transacciones = transaccionesResult.rows;
    }

    const safeDate = new Date().toISOString().split("T")[0];

    if (String(format).toLowerCase() === "csv") {
      const rows = includeVentas ? data.ventas : data.transacciones;
      const columns = includeVentas
        ? [
            "id_venta",
            "cliente_nombre",
            "cliente_nit",
            "fecha_elaboracion",
            "fecha_vencimiento",
            "comprobante",
            "tipo_transaccion",
            "moneda",
            "total",
            "total_aplicado",
            "estado_envio_correo"
          ]
        : [
            "id_transaccion",
            "cliente_nombre",
            "cliente_nit",
            "fecha",
            "descripcion",
            "banco_nombre",
            "moneda",
            "valor",
            "total_aplicado"
          ];

      if (includeSaldos) {
        if (includeVentas) {
          columns.splice(10, 0, "saldo_venta");
        } else {
          columns.push("saldo_transaccion");
        }
      }

      const escapeCsv = (value) => {
        const s = String(value ?? "");
        if (/[\n\r",]/.test(s)) {
          return `"${s.replaceAll('"', '""')}"`;
        }
        return s;
      };

      const header = columns.join(",");
      const body = rows
        .map((row) => columns.map((col) => escapeCsv(row[col])).join(","))
        .join("\n");

      const csv = `${header}\n${body}\n`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=reporte-${includeVentas ? "ventas" : "transacciones"}-${safeDate}.csv`
      );
      return res.send(csv);
    }

    // XLSX
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Sistema Cartera";
    workbook.created = new Date();

    const styleHeader = (row) => {
      row.font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102A47" } };
    };

    if (includeVentas) {
      const ws = workbook.addWorksheet("Ventas");
      const headers = [
        "ID Venta",
        "Cliente",
        "NIT",
        "Fecha Elaboración",
        "Fecha Vencimiento",
        "Comprobante",
        "Tipo",
        "Moneda",
        "Total",
        "Aplicado",
        "Estado"
      ];

      if (includeSaldos) {
        headers.splice(10, 0, "Saldo");
      }
      const headerRow = ws.addRow(headers);
      styleHeader(headerRow);

      data.ventas.forEach((v) => {
        const row = [
          v.id_venta,
          v.cliente_nombre,
          v.cliente_nit,
          v.fecha_elaboracion,
          v.fecha_vencimiento,
          v.comprobante,
          v.tipo_transaccion,
          v.moneda,
          Number(v.total),
          Number(v.total_aplicado)
        ];
        if (includeSaldos) row.push(Number(v.saldo_venta));
        row.push(v.estado_envio_correo);
        ws.addRow(row);
      });

      ws.columns.forEach((col) => {
        col.width = Math.min(28, Math.max(12, (col.header ? String(col.header).length : 12) + 2));
      });
    }

    if (includeTransacciones) {
      const ws = workbook.addWorksheet("Transacciones");
      const headers = [
        "ID Transacción",
        "Cliente",
        "NIT",
        "Fecha",
        "Descripción",
        "Banco",
        "Moneda",
        "Valor",
        "Aplicado"
      ];

      if (includeSaldos) {
        headers.push("Saldo");
      }
      const headerRow = ws.addRow(headers);
      styleHeader(headerRow);

      data.transacciones.forEach((t) => {
        const row = [
          t.id_transaccion,
          t.cliente_nombre,
          t.cliente_nit,
          t.fecha,
          t.descripcion || t.nombre,
          t.banco_nombre,
          t.moneda,
          Number(t.valor),
          Number(t.total_aplicado)
        ];
        if (includeSaldos) row.push(Number(t.saldo_transaccion));
        ws.addRow(row);
      });

      ws.columns.forEach((col) => {
        col.width = Math.min(28, Math.max(12, (col.header ? String(col.header).length : 12) + 2));
      });
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=reporte-${safeDate}.xlsx`);
    await workbook.xlsx.write(res);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/backup/export
 * Descarga un respaldo tabular con ventas, transacciones, clientes y bancos.
 */
app.get("/api/backup/export", async (req, res) => {
  try {
    const format = String(req.query.format || "xlsx").toLowerCase();
    const safeDate = new Date().toISOString().split("T")[0];

    const [ventasResult, transaccionesResult, clientesResult, bancosResult] = await Promise.all([
      pool.query(`
        SELECT
          v.id_venta,
          c.nombre AS cliente_nombre,
          c.identificacion AS cliente_nit,
          v.fecha_elaboracion,
          v.fecha_vencimiento,
          v.comprobante,
          v.tipo_transaccion,
          v.moneda,
          v.total,
          COALESCE(ap_sum.total_aplicado, 0)::NUMERIC(15,2) AS total_aplicado,
          (v.total - COALESCE(ap_sum.total_aplicado, 0))::NUMERIC(15,2) AS saldo_venta,
          v.estado_envio_correo
        FROM venta v
        JOIN cliente c ON v.id_cliente = c.id_cliente
        LEFT JOIN (
          SELECT id_venta, SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado
          FROM aplicacion_pago
          GROUP BY id_venta
        ) ap_sum ON ap_sum.id_venta = v.id_venta
        ORDER BY v.fecha_elaboracion DESC, v.id_venta DESC
      `),
      pool.query(`
        SELECT
          t.id_transaccion,
          c.nombre AS cliente_nombre,
          c.identificacion AS cliente_nit,
          t.fecha,
          t.nombre,
          t.descripcion,
          COALESCE(b.nombre, '-') AS banco_nombre,
          t.moneda,
          t.valor,
          t.moneda_referencia,
          t.valor_equivalente,
          COALESCE(ap_sum.total_aplicado, 0)::NUMERIC(15,2) AS total_aplicado,
          (
            CASE
              WHEN COALESCE(t.moneda_referencia, '') = 'COP' AND COALESCE(t.moneda, '') <> 'COP'
                THEN COALESCE(t.valor_equivalente, t.valor)
              ELSE t.valor
            END - COALESCE(ap_sum.total_aplicado, 0)
          )::NUMERIC(15,2) AS saldo_transaccion
        FROM transaccion t
        JOIN cliente c ON t.id_cliente = c.id_cliente
        LEFT JOIN banco b ON t.id_banco = b.id_banco
        LEFT JOIN (
          SELECT id_transaccion, SUM(valor_aplicado)::NUMERIC(15,2) AS total_aplicado
          FROM aplicacion_pago
          GROUP BY id_transaccion
        ) ap_sum ON ap_sum.id_transaccion = t.id_transaccion
        ORDER BY t.fecha DESC, t.id_transaccion DESC
      `),
      pool.query(`
        SELECT id_cliente, identificacion, nombre
        FROM cliente
        ORDER BY nombre ASC, identificacion ASC
      `),
      pool.query(`
        SELECT id_banco, codigo, nombre
        FROM banco
        ORDER BY nombre ASC
      `)
    ]);

    const datasets = [
      {
        sheetName: "Ventas",
        title: "Ventas",
        rows: ventasResult.rows,
        columns: [
          { header: "ID Venta", key: "id_venta" },
          { header: "Cliente", key: "cliente_nombre" },
          { header: "NIT", key: "cliente_nit" },
          { header: "Fecha Elaboración", key: "fecha_elaboracion" },
          { header: "Fecha Vencimiento", key: "fecha_vencimiento" },
          { header: "Comprobante", key: "comprobante" },
          { header: "Tipo", key: "tipo_transaccion" },
          { header: "Moneda", key: "moneda" },
          { header: "Total", key: "total" },
          { header: "Aplicado", key: "total_aplicado" },
          { header: "Saldo", key: "saldo_venta" },
          { header: "Estado", key: "estado_envio_correo" }
        ]
      },
      {
        sheetName: "Transacciones",
        title: "Transacciones",
        rows: transaccionesResult.rows,
        columns: [
          { header: "ID Transacción", key: "id_transaccion" },
          { header: "Cliente", key: "cliente_nombre" },
          { header: "NIT", key: "cliente_nit" },
          { header: "Fecha", key: "fecha" },
          { header: "Nombre", key: "nombre" },
          { header: "Descripción", key: "descripcion" },
          { header: "Banco", key: "banco_nombre" },
          { header: "Moneda", key: "moneda" },
          { header: "Valor", key: "valor" },
          { header: "Moneda Referencia", key: "moneda_referencia" },
          { header: "Valor Equivalente", key: "valor_equivalente" },
          { header: "Aplicado", key: "total_aplicado" },
          { header: "Saldo", key: "saldo_transaccion" }
        ]
      },
      {
        sheetName: "Clientes",
        title: "Clientes",
        rows: clientesResult.rows,
        columns: [
          { header: "ID Cliente", key: "id_cliente" },
          { header: "Identificación", key: "identificacion" },
          { header: "Nombre", key: "nombre" }
        ]
      },
      {
        sheetName: "Bancos",
        title: "Bancos",
        rows: bancosResult.rows,
        columns: [
          { header: "ID Banco", key: "id_banco" },
          { header: "Código", key: "codigo" },
          { header: "Nombre", key: "nombre" }
        ]
      }
    ];

    if (format === "csv") {
      const escapeCsv = (value) => {
        const text = String(value ?? "");
        if (/[\n\r",]/.test(text)) {
          return `"${text.replaceAll('"', '""')}"`;
        }
        return text;
      };

      const sections = datasets.map((dataset) => {
        const header = dataset.columns.map((column) => column.header).join(",");
        const body = dataset.rows
          .map((row) => dataset.columns.map((column) => escapeCsv(row[column.key])).join(","))
          .join("\n");
        return [`# ${dataset.title}`, header, body].filter(Boolean).join("\n");
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=backup-${safeDate}.csv`);
      return res.send(sections.join("\n\n"));
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Sistema Cartera";
    workbook.created = new Date();

    const styleHeader = (row) => {
      row.font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102A47" } };
    };

    datasets.forEach((dataset) => {
      const worksheet = workbook.addWorksheet(dataset.sheetName);
      const headerRow = worksheet.addRow(dataset.columns.map((column) => column.header));
      styleHeader(headerRow);

      dataset.rows.forEach((row) => {
        worksheet.addRow(dataset.columns.map((column) => row[column.key]));
      });

      worksheet.columns.forEach((column) => {
        column.width = Math.min(28, Math.max(12, (column.header ? String(column.header).length : 12) + 2));
      });

      worksheet.views = [{ state: "frozen", ySplit: 1 }];
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=backup-${safeDate}.xlsx`);
    await workbook.xlsx.write(res);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/notas-credito/import
 * Importa notas crédito (comprobantes NC) como transacciones aplicadas a ventas.
 * Body: { records: [{ comprobante, cliente, nit, fecha_elaboracion, moneda, total, id_venta }] }
 */
app.post("/api/notas-credito/import", async (req, res) => {
  const { records } = req.body;

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ success: false, message: "No se recibieron registros." });
  }

  const client = await pool.connect();
  const results = { success: true, total: records.length, imported: 0, failed: 0, errors: [] };

  try {
    await client.query("BEGIN");

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      try {
        const nit = normalizeValue(String(record.nit || ""));
        const nombre = normalizeValue(String(record.cliente || ""));
        const comprobante = normalizeValue(String(record.comprobante || ""));
        const fechaStr = normalizeValue(String(record.fecha_elaboracion || ""));
        const moneda = normalizeValue(String(record.moneda || "")) || "COP";
        const idVentaRaw = record.id_venta;
        const valor = Math.abs(parseCurrency(String(record.total || "0")));

        if (!nit || !nombre) {
          results.errors.push({ row: i + 1, error: "NIT y Cliente son requeridos." });
          results.failed++;
          continue;
        }
        if (!comprobante) {
          results.errors.push({ row: i + 1, error: "Comprobante es requerido." });
          results.failed++;
          continue;
        }
        if (!idVentaRaw) {
          results.errors.push({ row: i + 1, error: `NC ${comprobante}: debe seleccionar una venta.` });
          results.failed++;
          continue;
        }
        if (valor <= 0) {
          results.errors.push({ row: i + 1, error: `NC ${comprobante}: el valor debe ser mayor a 0.` });
          results.failed++;
          continue;
        }

        const idVenta = Number.parseInt(String(idVentaRaw), 10);
        if (!Number.isFinite(idVenta) || idVenta <= 0) {
          results.errors.push({ row: i + 1, error: `NC ${comprobante}: ID de venta inválido.` });
          results.failed++;
          continue;
        }

        // Buscar o crear cliente
        let idCliente;
        const clienteRes = await client.query(
          "SELECT id_cliente FROM cliente WHERE identificacion = $1",
          [nit]
        );
        if (clienteRes.rows.length > 0) {
          idCliente = clienteRes.rows[0].id_cliente;
        } else {
          const newCliente = await client.query(
            "INSERT INTO cliente (identificacion, nombre) VALUES ($1, $2) RETURNING id_cliente",
            [nit, nombre]
          );
          idCliente = newCliente.rows[0].id_cliente;
        }

        // Verificar que la venta pertenece al mismo cliente y obtener saldo actual
        const ventaRes = await client.query(
          `SELECT v.id_venta, v.id_cliente, v.total,
                  COALESCE(SUM(ap.valor_aplicado), 0)::NUMERIC(15,2) AS total_aplicado
           FROM venta v
           LEFT JOIN aplicacion_pago ap ON ap.id_venta = v.id_venta
           WHERE v.id_venta = $1
           GROUP BY v.id_venta, v.id_cliente, v.total`,
          [idVenta]
        );
        if (!ventaRes.rows.length) {
          results.errors.push({ row: i + 1, error: `NC ${comprobante}: venta #${idVenta} no encontrada.` });
          results.failed++;
          continue;
        }
        if (String(ventaRes.rows[0].id_cliente) !== String(idCliente)) {
          results.errors.push({ row: i + 1, error: `NC ${comprobante}: la venta #${idVenta} no pertenece al cliente.` });
          results.failed++;
          continue;
        }

        // Si la NC supera el saldo pendiente de la venta, solo aplica hasta cubrir la venta
        const saldoVenta = Math.max(0, Number(ventaRes.rows[0].total) - Number(ventaRes.rows[0].total_aplicado));
        const valorAplicar = saldoVenta > 0 ? Math.min(valor, saldoVenta) : 0;

        const fecha = fechaStr ? parseDate(fechaStr) : new Date().toISOString();

        // Crear transacción con el valor completo de la NC (el excedente queda como saldo)
        const txRes = await client.query(
          `INSERT INTO transaccion (id_cliente, fecha, nombre, descripcion, referencia, valor, moneda, id_banco, soporte)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, false)
           RETURNING id_transaccion`,
          [idCliente, fecha || new Date().toISOString(), nombre, `Nota Crédito: ${comprobante}`, comprobante, valor, moneda]
        );
        const idTransaccion = txRes.rows[0].id_transaccion;

        // Aplicar solo el monto que cabe en el saldo de la venta
        if (valorAplicar > 0) {
          await client.query(
            `INSERT INTO aplicacion_pago (id_transaccion, id_venta, valor_aplicado, tipo_cambio, valor_aplicado_transaccion)
             VALUES ($1, $2, $3, 1, $3)`,
            [idTransaccion, idVenta, valorAplicar]
          );
        }

        results.imported++;
      } catch (err) {
        results.errors.push({ row: i + 1, error: err.message });
        results.failed++;
      }
    }

    await client.query("COMMIT");
    res.json(results);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, message: err.message, errors: results.errors });
  } finally {
    client.release();
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
  console.log(`Abre http://localhost:${PORT}/home.html en tu navegador`);
});
