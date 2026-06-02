const modal = document.getElementById("crud-modal");
const openModalButton = document.getElementById("open-modal");
const closeModalButton = document.getElementById("close-modal");

function closeModal() {
  if (!modal) {
    return;
  }

  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

if (modal && openModalButton && closeModalButton) {
  openModalButton.addEventListener("click", async () => {
    try {
      if (typeof txLoadBancosOptions === "function") {
        await txLoadBancosOptions();
      }
    } catch (e) {
      // ignore load errors and still open modal
    }

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  });

  closeModalButton.addEventListener("click", closeModal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
}

// API base helper
// - If the UI is served by the same Express server (port 3000), use relative URLs.
// - If the UI is served from another origin (Live Server) or from file://, use http://localhost:3000.
const API_ORIGIN = (() => {
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
  } catch (e) {
    // ignore
  }

  return "http://localhost:3000";
})();

const apiUrl = (path) => (API_ORIGIN ? `${API_ORIGIN}${path}` : path);

const ensureAuthIfNeeded = async (path) => {
  if (!String(path || "").startsWith("/api/")) return;
  if (String(path).startsWith("/api/auth/")) return;
  if (String(path) === "/api/health") return;
  return true;
};

const apiFetch = async (path, options = {}) => {
  await ensureAuthIfNeeded(path);

  const response = await fetch(apiUrl(path), {
    credentials: "include",
    ...options
  });

  if (response.status === 401) {
    window.scGuard?.goLogin?.();
  }

  return response;
};

const toast = document.getElementById("toast");
const showToastButton = document.getElementById("show-toast");
let toastTimeout;

const showToast = ({
  title = "Listo",
  subtitle = "Accion completada.",
  icon = "download_done",
  durationMs = 2200
} = {}) => {
  if (!toast) {
    return;
  }

  const iconEl = toast.querySelector(".material-symbols-outlined");
  const titleEl = toast.querySelector("p");
  const subtitleEl = toast.querySelector("small");

  if (iconEl) {
    iconEl.textContent = String(icon || "download_done");
  }
  if (titleEl) {
    titleEl.textContent = String(title || "Listo");
  }
  if (subtitleEl) {
    subtitleEl.textContent = String(subtitle || "Accion completada.");
  }

  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, durationMs);
};

if (toast && showToastButton) {
  showToastButton.addEventListener("click", () => {
    showToast({
      title: "Reporte listo para descarga",
      subtitle: "La exportacion visual se completo correctamente.",
      icon: "download_done"
    });
  });
}

const ventasPage = document.getElementById("ventas-page");

if (ventasPage) {
  const state = {
    tableColumns: [],
    previewColumns: [],
    previewRows: [],
    previewFilter: "all",
    records: [],
    dueDatesMap: new Map(),
    salesFileName: "",
    dueDatesFileName: ""
  };

  let prevFocusedElementForModal = null;
  let ventaModalKeyHandler = null;

  const fileInput = document.getElementById("ventas-file-input");
  const dueFileInput = document.getElementById("ventas-due-file-input");
  const dropzone = document.getElementById("ventas-dropzone");
  const dueDropzone = document.getElementById("ventas-due-dropzone");
  const fileNameLabel = document.getElementById("ventas-file-name");
  const dueFileNameLabel = document.getElementById("ventas-due-file-name");
  const importStatus = document.getElementById("ventas-import-status");
  const previewCount = document.getElementById("ventas-preview-count");
  const previewFilter = document.getElementById("ventas-preview-filter");
  const previewHead = document.getElementById("ventas-preview-head");
  const previewBody = document.getElementById("ventas-preview-body");
  const applyImportButton = document.getElementById("ventas-apply-import");
  const clearPreviewButton = document.getElementById("ventas-clear-preview");

  const ventasImportColumns = [
    "Tipo de transacción",
    "Comprobante",
    "Fecha elaboración",
    "Identificación",
    "Sucursal",
    "Cliente",
    "Estado envío de correo",
    "Total",
    "Moneda",
    "Fecha vencimiento"
  ];

  const ventasImportFieldMap = {
    "Tipo de transacción": "tipo_transaccion",
    "Comprobante": "comprobante",
    "Fecha elaboración": "fecha_elaboracion",
    "Identificación": "identificacion",
    "Sucursal": "sucursal",
    "Cliente": "cliente",
    "Estado envío de correo": "estado_envio_correo",
    "Total": "total",
    "Moneda": "moneda",
    "Fecha vencimiento": "fecha_vencimiento"
  };

  const tableHead = document.getElementById("ventas-table-head");
  const tableBody = document.getElementById("ventas-table-body");

  const globalFilter = document.getElementById("ventas-filter-global");
  const ventasReadOnlyColumns = new Set(["ID Venta", "Aplicado", "Saldo"]);

  const kpiTotal = document.getElementById("ventas-kpi-total");
  const kpiEmployees = document.getElementById("ventas-kpi-empleados");
  const kpiAmount = document.getElementById("ventas-kpi-monto");
  const kpiFile = document.getElementById("ventas-kpi-archivo");
  const kpiRecords = document.getElementById("ventas-kpi-registros");

  const normalizeKey = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const normalizeDocumentKey = (value) =>
    normalizeKey(value).replace(/[^a-z0-9]/g, "");

  const getPreviewMissingCount = () =>
    state.previewRows.filter((row) => !parseDateInputValue(row.fecha_vencimiento)).length;

  const getPreviewVisibleRows = () => {
    const indexedRows = state.previewRows.map((row, rowIndex) => ({ row, rowIndex }));

    if (state.previewFilter === "missing") {
      return indexedRows.filter(({ row }) => !parseDateInputValue(row.fecha_vencimiento));
    }

    return indexedRows;
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

  const toIsoDateString = (yearValue, monthValue, dayValue) => {
    const year = Number.parseInt(String(yearValue || ""), 10);
    const month = Number.parseInt(String(monthValue || ""), 10);
    const day = Number.parseInt(String(dayValue || ""), 10);

    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return "";
    }

    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(candidate.getTime()) ||
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() + 1 !== month ||
      candidate.getUTCDate() !== day
    ) {
      return "";
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const excelSerialToIsoDate = (serialValue) => {
    const serial = Number(serialValue);
    if (!Number.isFinite(serial) || serial <= 0) {
      return "";
    }

    const epoch = Date.UTC(1899, 11, 30);
    const ms = Math.round(serial * 86400000);
    const parsed = new Date(epoch + ms);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }

    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  };

  const parseDateInputValue = (value) => {
    if (value === null || typeof value === "undefined") {
      return "";
    }

    if (typeof value === "number") {
      const isoFromSerial = excelSerialToIsoDate(value);
      if (isoFromSerial) {
        return isoFromSerial;
      }
    }

    const raw = String(value).trim();
    if (!raw) {
      return "";
    }

    if (/^\d{5}(?:\.\d+)?$/.test(raw)) {
      const isoFromSerial = excelSerialToIsoDate(raw);
      if (isoFromSerial) {
        return isoFromSerial;
      }
    }

    const dateOnly = raw.split(/[T\s]/)[0].trim();

    const isoMatch = dateOnly.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (isoMatch) {
      return toIsoDateString(isoMatch[1], isoMatch[2], isoMatch[3]);
    }

    const dmyMatch = dateOnly.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (dmyMatch) {
      const normalizedYear = normalizeTwoDigitYear(dmyMatch[3]);
      return normalizedYear ? toIsoDateString(normalizedYear, dmyMatch[2], dmyMatch[1]) : "";
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }

    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  };

  const inferColumns = (rows) => {
    const colSet = new Set();
    rows.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (String(key).trim()) {
          colSet.add(String(key).trim());
        }
      });
    });

    return Array.from(colSet);
  };

  const normalizeHeader = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  const ensureUniqueHeaders = (headers) => {
    const seen = new Map();
    return headers.map((header, index) => {
      const base = normalizeHeader(header) || `Columna ${index + 1}`;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count ? `${base} (${count + 1})` : base;
    });
  };

  const scoreHeaderRow = (cells) => {
    const knownHeaderHints = [
      "tipo",
      "transaccion",
      "comprobante",
      "documento",
      "fecha",
      "vencimiento",
      "identificacion",
      "sucursal",
      "cliente",
      "estado",
      "correo",
      "total",
      "moneda",
      "nit",
      "empleado",
      "vendedor"
    ];

    const nonEmptyCells = cells.filter((cell) => normalizeHeader(cell)).length;
    if (nonEmptyCells < 2) {
      return -1;
    }

    const hintMatches = cells.reduce((acc, cell) => {
      const normalized = normalizeKey(cell);
      if (!normalized) {
        return acc;
      }

      return acc + (knownHeaderHints.some((hint) => normalized.includes(hint)) ? 1 : 0);
    }, 0);

    return nonEmptyCells * 2 + hintMatches * 5;
  };

  const parseVentasSheet = (worksheet) => {
    const matrix = window.XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false
    });

    if (!matrix.length) {
      return { rows: [], columns: [] };
    }

    let headerIndex = -1;
    let headerScore = -1;

    matrix.forEach((row, index) => {
      const score = scoreHeaderRow(row);
      if (score > headerScore) {
        headerScore = score;
        headerIndex = index;
      }
    });

    if (headerIndex < 0) {
      const fallbackRows = window.XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });
      return { rows: fallbackRows, columns: inferColumns(fallbackRows) };
    }

    const rawHeaders = matrix[headerIndex] || [];
    const lastHeaderCell = rawHeaders.reduce((last, header, index) => {
      return normalizeHeader(header) ? index : last;
    }, -1);

    const slicedHeaders = rawHeaders.slice(0, lastHeaderCell + 1);
    const headers = ensureUniqueHeaders(slicedHeaders);

    const rows = matrix
      .slice(headerIndex + 1)
      .map((row) => {
        const record = {};
        headers.forEach((header, colIndex) => {
          record[header] = String(row[colIndex] ?? "").trim();
        });
        return record;
      })
      .filter((record) => Object.values(record).some((value) => normalizeHeader(value)));

    return { rows, columns: headers };
  };

  const buildVentasImportRows = (rows) =>
    rows
      .map((row) => ({
        tipo_transaccion: getPossibleFieldValue(row, ["tipo transaccion", "tipo de transaccion", "transaccion", "tipo"]),
        comprobante: getPossibleFieldValue(row, ["comprobante", "documento", "referencia"]),
        fecha_elaboracion: getPossibleFieldValue(row, ["fecha elaboracion", "fecha de elaboracion", "fecha_ elaboracion", "fecha"]),
        identificacion: getPossibleFieldValue(row, ["identificacion", "nit", "documento cliente"]),
        sucursal: getPossibleFieldValue(row, ["sucursal", "sucursal id"]),
        cliente: getPossibleFieldValue(row, ["cliente", "nombre", "empresa"]),
        estado_envio_correo: getPossibleFieldValue(row, ["estado envio de correo", "estado_envio_correo", "estado correo"]),
        total: getPossibleFieldValue(row, ["total", "monto", "valor", "venta", "importe"]),
        moneda: getPossibleFieldValue(row, ["moneda"]),
        fecha_vencimiento: ""
      }))
      .filter((record) => Object.values(record).some((value) => normalizeHeader(value)));

  const buildDueDatesMap = (rows) => {
    const dueMap = new Map();
    rows.forEach((row) => {
      const documentValue = getPossibleFieldValue(row, [
        "documento",
        "numero documento",
        "nro documento",
        "comprobante",
        "referencia",
        "numero"
      ]);
      const dueDateValue = getPossibleFieldValue(row, [
        "fecha vencimiento",
        "fecha de vencimiento",
        "fecha_vencimiento",
        "f vencimiento",
        "vencimiento"
      ]);
      const key = normalizeDocumentKey(documentValue);
      const isoDate = parseDateInputValue(dueDateValue);
      if (key && isoDate) {
        dueMap.set(key, isoDate);
      }
    });
    return dueMap;
  };

  const applyDueDatesToPreview = () => {
    if (!state.previewRows.length) {
      return;
    }

    state.previewRows = state.previewRows.map((row) => {
      const comprobanteKey = normalizeDocumentKey(row.comprobante);
      const mappedDueDate = comprobanteKey ? state.dueDatesMap.get(comprobanteKey) : "";
      if (mappedDueDate && !parseDateInputValue(row.fecha_vencimiento)) {
        return {
          ...row,
          fecha_vencimiento: mappedDueDate
        };
      }
      return row;
    });
  };

  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const getPossibleFieldValue = (row, alternatives) => {
    const entries = Object.entries(row);
    for (const [key, value] of entries) {
      const normalized = normalizeKey(key);
      if (alternatives.some((alt) => normalized.includes(alt))) {
        return String(value || "");
      }
    }

    return "";
  };

  const parseCurrency = (value) => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    let s = String(value || "").trim();
    if (!s) return 0;

    // Remove currency symbols and spaces.
    s = s.replace(/\s+/g, "").replace(/\$/g, "").replace(/€|COP|USD/gi, "");

    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");

    if (lastDot > -1 && lastComma > -1) {
      if (lastComma > lastDot) {
        s = s.replace(/\./g, "").replace(/,/g, ".");
      } else {
        s = s.replace(/,/g, "");
      }
    } else if (lastComma > -1) {
      s = s.replace(/\./g, "").replace(/,/g, ".");
    } else if (lastDot > -1) {
      const dotParts = s.split(".");
      const hasThousandGrouping = dotParts.length > 1 && dotParts.every((part, index) => {
        if (index === 0) {
          return /^\d+$/.test(part);
        }
        return /^\d{3}$/.test(part);
      });

      if (hasThousandGrouping) {
        s = dotParts.join("");
      }
    }

    const amount = Number.parseFloat(s);
    return Number.isFinite(amount) ? amount : 0;
  };

  const ventasTableColumns = [
    "ID Venta",
    "Cliente",
    "NIT",
    "Fecha Elaboracion",
    "Fecha Vencimiento",
    "Comprobante",
    "Moneda",
    "Total",
    "Aplicado",
    "Saldo"
  ];

  const ventasActionColumn = "Acciones";
  const ventasColumnFieldMap = {
    "Cliente": "cliente_nombre",
    "NIT": "cliente_nit",
    "Fecha Elaboracion": "fecha_elaboracion",
    "Fecha Vencimiento": "fecha_vencimiento",
    "Comprobante": "comprobante",
    "Moneda": "moneda",
    "Total": "total"
  };

  const mapVentaApiRow = (row) => ({
    id_venta: row.id_venta,
    "ID Venta": row.id_venta ?? "",
    "Cliente": row.cliente_nombre || "",
    "NIT": row.cliente_nit || "",
    "Fecha Elaboracion": row.fecha_elaboracion || "",
    "Fecha Vencimiento": row.fecha_vencimiento || "",
    "Comprobante": row.comprobante || "",
    "Moneda": row.moneda || "",
    "Total": row.total ?? "",
    "Aplicado": row.total_aplicado ?? "",
    "Saldo": row.saldo_venta ?? ""
  });

  const loadVentasFromDatabase = async () => {
    if (importStatus) {
      importStatus.textContent = "Cargando ventas desde la base de datos...";
    }

    try {
      const response = await apiFetch("/api/ventas");
      if (!response.ok) {
        throw new Error(`No fue posible consultar la BD (${response.status})`);
      }

      const payload = await response.json();
      const ventas = Array.isArray(payload.data) ? payload.data : [];

      state.records = ventas.map(mapVentaApiRow);
      state.tableColumns = ventas.length ? ventasTableColumns : [];

      applyFilters();
      refreshKpis();

      if (importStatus) {
        importStatus.textContent = ventas.length
          ? `${ventas.length} ventas cargadas desde la base de datos.`
          : "No hay ventas guardadas todavía.";
      }
    } catch (error) {
      if (importStatus) {
        importStatus.textContent = `No fue posible cargar ventas desde la base de datos: ${error.message}`;
      }
    }
  };

  const moneyFormatter = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  });

  const formatDisplayDate = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const day = String(parsed.getDate()).padStart(2, "0");
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      const year = parsed.getFullYear();
      return `${day}/${month}/${year}`;
    }

    return raw;
  };

  const renderImportPreview = () => {
    if (!previewHead || !previewBody) {
      return;
    }

    const columns = ventasImportColumns;
    previewHead.innerHTML = `<tr>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr>`;

    const totalRows = state.previewRows.length;
    const missingCount = getPreviewMissingCount();
    const visibleRows = getPreviewVisibleRows();

    if (!totalRows) {
      previewBody.innerHTML = `<tr><td class="ventas-empty" colspan="${columns.length}">No hay preview aun.</td></tr>`;
      if (previewCount) {
        previewCount.textContent = "0 filas";
      }
      refreshKpis();
      return;
    }

    if (!visibleRows.length) {
      previewBody.innerHTML = `<tr><td class="ventas-empty" colspan="${columns.length}">No hay registros sin vencimiento para mostrar.</td></tr>`;
      if (previewCount) {
        previewCount.textContent = `${visibleRows.length} visibles de ${totalRows} filas · ${missingCount} sin vencimiento`;
      }
      previewBody.dataset.missingDueDates = String(missingCount);
      previewBody.dataset.totalRows = String(totalRows);
      refreshKpis();
      return;
    }

    previewBody.innerHTML = visibleRows
      .map(({ row, rowIndex }) => {
        const cells = columns
          .map((col) => {
            const fieldName = ventasImportFieldMap[col];
            const rawValue = row[fieldName] ?? "";

            if (col === "Fecha elaboración") {
              return `<td data-col="${escapeHtml(col)}">${escapeHtml(formatDisplayDate(rawValue))}</td>`;
            }

            if (col === "Fecha vencimiento") {
              const inputValue = parseDateInputValue(rawValue);
              const hasDueDate = Boolean(inputValue);
              const inputClass = hasDueDate ? "table-input" : "table-input is-required";
              const placeholder = hasDueDate ? "" : "Pendiente";
              return `<td data-col="${escapeHtml(col)}"><input type="date" class="${inputClass}" data-preview-field="fecha_vencimiento" data-row-index="${rowIndex}" value="${escapeHtml(inputValue)}" placeholder="${placeholder}" /></td>`;
            }

            const value = escapeHtml(String(col === "Total" ? parseCurrency(rawValue) || rawValue : rawValue || ""));
            return `<td data-col="${escapeHtml(col)}">${value}</td>`;
          })
          .join("");

        return `<tr data-row-index="${rowIndex}">${cells}</tr>`;
      })
      .join("");

    previewBody.dataset.missingDueDates = String(missingCount);
    previewBody.dataset.totalRows = String(totalRows);
    if (previewCount) {
      previewCount.textContent = state.previewFilter === "missing"
        ? `${visibleRows.length} visibles de ${totalRows} filas · ${missingCount} sin vencimiento`
        : `${visibleRows.length} filas${missingCount ? ` · ${missingCount} sin vencimiento` : ""}`;
    }

    refreshKpis();
  };

  const refreshImportPreviewSummary = () => {
    if (!previewBody || !previewCount) {
      return;
    }

    renderImportPreview();
  };

  const renderTable = (headEl, bodyEl, rows, columns, emptyText) => {
    if (!headEl || !bodyEl) {
      return;
    }

    if (!rows.length || !columns.length) {
      headEl.innerHTML = "";
      bodyEl.innerHTML = `<tr><td class="ventas-empty" colspan="1">${escapeHtml(emptyText)}</td></tr>`;
      return;
    }

    headEl.innerHTML = `<tr>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr>`;

    bodyEl.innerHTML = rows
      .map((row) => {
        const idAttr = escapeHtml(String(row.id_venta ?? ""));
        const cells = columns
          .map((col) => `<td>${escapeHtml(String(row[col] ?? ""))}</td>`)
          .join("");
        return `<tr data-id="${idAttr}" class="ventas-row">${cells}</tr>`;
      })
      .join("");
  };

  const renderVentasMainTable = (rows) => {
    if (!tableHead || !tableBody) {
      return;
    }

    const columns = [...ventasTableColumns, ventasActionColumn];
    tableHead.innerHTML = `<tr>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr>`;

    if (!rows.length) {
      tableBody.innerHTML = `<tr><td class="ventas-empty" colspan="${columns.length}">${escapeHtml(
        "No hay registros que coincidan con los filtros actuales."
      )}</td></tr>`;
      return;
    }

    const moneyCols = new Set(["Total", "Aplicado", "Saldo"]);
    const dateCols = new Set(["Fecha Elaboracion", "Fecha Vencimiento"]);
    tableBody.innerHTML = rows
      .map((row) => {
        const idAttr = escapeHtml(String(row.id_venta ?? ""));
        const dataCells = ventasTableColumns
          .map((col) => {
            const key = escapeHtml(col);
            const raw = row[col] ?? "";

            if (col === "ID Venta") {
              const val = escapeHtml(String(raw || row.id_venta || ""));
              return `<td data-col="${key}"><strong>#${val}</strong></td>`;
            }

            if (col === "Moneda") {
              const val = escapeHtml(String(raw || "-").trim().toUpperCase());
              return `<td data-col="${key}"><strong>${val}</strong></td>`;
            }

            if (moneyCols.has(col)) {
              const amount = parseCurrency(raw);
              const formatted = escapeHtml(moneyFormatter.format(amount));
              const klass =
                col === "Aplicado"
                  ? "text-green-600 font-bold text-right"
                  : col === "Saldo"
                    ? "text-red-600 font-bold text-right"
                    : "font-bold text-right";
              return `<td data-col="${key}" class="${klass}">${formatted}</td>`;
            }

            if (dateCols.has(col)) {
              const value = escapeHtml(formatDisplayDate(raw));
              return `<td data-col="${key}">${value}</td>`;
            }

            const value = escapeHtml(String(raw ?? ""));
            return `<td data-col="${key}">${value}</td>`;
          })
          .join("");

        const actionCell = `
          <td class="row-actions-cell">
            <div class="row-actions" aria-label="Acciones">
              <button type="button" class="icon-btn" data-action="edit" title="Editar" aria-label="Editar">
                <span class="material-symbols-outlined">edit</span>
              </button>
              <button type="button" class="icon-btn icon-btn-danger" data-action="delete" title="Borrar" aria-label="Borrar">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
          </td>`;

        return `<tr data-id="${idAttr}" class="ventas-row" tabindex="0" role="button">${dataCells}${actionCell}</tr>`;
      })
      .join("");
  };

  const ventasExitEditMode = () => {
    applyFilters();
  };

  const ventasStartEditMode = (tr) => {
    if (!tr || tr.classList.contains("is-editing")) {
      return;
    }

    const id = tr.getAttribute("data-id");
    if (!id) {
      return;
    }

    const record = state.records.find((row) => String(row.id_venta) === String(id)) || null;

    tr.classList.add("is-editing");
    tr.removeAttribute("role");
    tr.removeAttribute("tabindex");

    ventasTableColumns.forEach((col) => {
      if (ventasReadOnlyColumns.has(col)) {
        return;
      }

      const td = tr.querySelector(`td[data-col="${CSS.escape(col)}"]`);
      if (!td) {
        return;
      }

      const currentValue = td.textContent || "";
      const recordValue = record ? String(record[col] ?? "") : "";
      const baseValue = recordValue || currentValue;
      td.innerHTML = "";

      let fieldEl;
      if (col === "Moneda") {
        const select = document.createElement("select");
        select.className = "table-input";
        ["COP", "USD", "EUR", "PAB"].forEach((code) => {
          const opt = document.createElement("option");
          opt.value = code;
          opt.textContent = code;
          select.appendChild(opt);
        });
        select.value = String(baseValue || "").trim().toUpperCase() || "COP";
        fieldEl = select;
      } else if (col === "Fecha Elaboracion" || col === "Fecha Vencimiento") {
        const input = document.createElement("input");
        input.type = "date";
        input.className = "table-input";
        input.value = String(baseValue || "").trim();
        fieldEl = input;
      } else if (col === "Total") {
        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "decimal";
        input.className = "table-input";
        input.value = String(baseValue || "").trim();
        fieldEl = input;
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "table-input";
        input.value = String(baseValue || "").trim();
        fieldEl = input;
      }

      fieldEl.setAttribute("data-field", col);
      td.appendChild(fieldEl);
    });

    const actionsCell = tr.querySelector(".row-actions");
    if (actionsCell) {
      actionsCell.innerHTML = `
        <button type="button" class="icon-btn" data-action="save" title="Guardar" aria-label="Guardar">
          <span class="material-symbols-outlined">save</span>
        </button>
        <button type="button" class="icon-btn" data-action="cancel" title="Cancelar" aria-label="Cancelar">
          <span class="material-symbols-outlined">close</span>
        </button>
      `;
    }

    // focus first input
    const firstInput = tr.querySelector(".table-input");
    if (firstInput && typeof firstInput.focus === "function") {
      firstInput.focus();
    }
  };

  const ventasCollectEditPayload = (tr) => {
    const out = {};
    ventasTableColumns.forEach((col) => {
      const el = tr.querySelector(`[data-field="${CSS.escape(col)}"]`);
      if (!el) {
        return;
      }
      const apiField = ventasColumnFieldMap[col];
      if (!apiField) {
        return;
      }
      out[apiField] = String(el.value ?? "").trim();
    });
    return out;
  };

  const ventasSaveEdit = async (tr) => {
    const id = tr?.getAttribute("data-id");
    if (!id) {
      return;
    }

    const body = ventasCollectEditPayload(tr);
    try {
      const response = await apiFetch(`/api/ventas/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || `No fue posible editar la venta (${response.status})`);
      }

      showToast({
        title: "Venta actualizada",
        subtitle: `Se guardaron los cambios en la venta #${id}.`,
        icon: "task_alt"
      });

      await loadVentasFromDatabase();
    } catch (error) {
      alert(`Error guardando venta: ${error.message}`);
    }
  };

  const ventasDeleteRow = async (tr) => {
    const id = tr?.getAttribute("data-id");
    if (!id) {
      return;
    }

    const ok = window.confirm(`¿Deseas borrar la venta #${id}?`);
    if (!ok) {
      return;
    }

    try {
      const response = await apiFetch(`/api/ventas/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || `No fue posible borrar la venta (${response.status})`);
      }

      state.records = state.records.filter((row) => String(row.id_venta) !== String(id));
      applyFilters();
      refreshKpis();

      showToast({
        title: "Venta borrada",
        subtitle: `La venta #${id} fue eliminada.`,
        icon: "delete"
      });
    } catch (error) {
      alert(`Error borrando venta: ${error.message}`);
    }
  };

  const applyFilters = () => {
    const queryGlobal = normalizeKey(globalFilter?.value);

    const filtered = state.records.filter((row) => {
      const valuesText = normalizeKey(Object.values(row).join(" "));
      return !queryGlobal || valuesText.includes(queryGlobal);
    });

    renderVentasMainTable(filtered);
  };

  const refreshKpis = () => {
    if (kpiTotal) {
      kpiTotal.textContent = String(state.records.length);
    }

    const uniqueEmployees = new Set(
      state.records
        .map((row) => getPossibleFieldValue(row, ["empleado", "vendedor", "asesor", "ejecutivo", "nombre"]))
        .map((v) => v.trim())
        .filter(Boolean)
    );

    if (kpiEmployees) {
      kpiEmployees.textContent = String(uniqueEmployees.size);
    }

    const amount = state.records.reduce((acc, row) => {
      // Prefer explicit Total column when available
      const raw = row['Total'] ?? row.Total ?? getPossibleFieldValue(row, ["monto", "valor", "venta", "total", "importe"]);
      return acc + parseCurrency(raw);
    }, 0);

    if (kpiAmount) {
      kpiAmount.textContent = moneyFormatter.format(amount);
    }

    if (kpiRecords) {
      kpiRecords.textContent = `${state.previewRows.length} registros en preview`;
    }
  };

  const renderPreview = () => {
    renderImportPreview();
  };

  const readWorkbook = async (file) => {
    if (!window.XLSX) {
      if (importStatus) {
        importStatus.textContent = "No se pudo cargar la libreria para leer Excel.";
      }
      return;
    }

    if (fileNameLabel) {
      fileNameLabel.textContent = `Archivo: ${file.name}`;
    }

    state.salesFileName = file.name;

    if (importStatus) {
      importStatus.textContent = "Procesando archivo...";
    }

    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const parsed = parseVentasSheet(worksheet);

    state.previewRows = buildVentasImportRows(parsed.rows);
    state.previewColumns = [...ventasImportColumns];
    applyDueDatesToPreview();

    renderPreview();

    if (importStatus) {
      importStatus.textContent = parsed.rows.length
        ? `Se extrajeron ${parsed.rows.length} filas del archivo.`
        : "El archivo no contiene filas validas para importar.";
    }

    if (kpiFile) {
      kpiFile.textContent = file.name;
    }
  };

  const readDueDatesWorkbook = async (file) => {
    if (!window.XLSX) {
      if (importStatus) {
        importStatus.textContent = "No se pudo cargar la libreria para leer la planilla de vencimientos.";
      }
      return;
    }

    if (dueFileNameLabel) {
      dueFileNameLabel.textContent = `Archivo: ${file.name}`;
    }

    state.dueDatesFileName = file.name;

    if (importStatus) {
      importStatus.textContent = "Procesando planilla de vencimientos...";
    }

    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const parsed = parseVentasSheet(worksheet);

    state.dueDatesMap = buildDueDatesMap(parsed.rows);
    applyDueDatesToPreview();
    renderPreview();

    const matched = state.previewRows.filter((row) => parseDateInputValue(row.fecha_vencimiento)).length;
    const missing = state.previewRows.length - matched;

    if (importStatus) {
      importStatus.textContent = state.previewRows.length
        ? `Se cargaron ${state.dueDatesMap.size} vencimientos. Coincidencias en ventas: ${matched}. Pendientes por completar: ${missing}.`
        : `Se cargó ${state.dueDatesMap.size} vencimientos. Falta subir la planilla de ventas para aplicar la relación.`;
    }
  };

  const collectImportRecords = () => {
    if (!previewBody) {
      return [];
    }

    return state.previewRows.map((row, rowIndex) => {
      const input = previewBody.querySelector(`[data-preview-field="fecha_vencimiento"][data-row-index="${rowIndex}"]`);
      const fechaVencimiento = parseDateInputValue(input?.value || row.fecha_vencimiento || "");

      return {
        ...row,
        fecha_vencimiento: fechaVencimiento
      };
    });
  };

  const resetImportState = () => {
    state.previewRows = [];
    state.previewColumns = [];
    state.previewFilter = "all";
    state.dueDatesMap = new Map();
    state.salesFileName = "";
    state.dueDatesFileName = "";

    if (fileInput) fileInput.value = "";
    if (dueFileInput) dueFileInput.value = "";
    if (previewFilter) previewFilter.value = "all";
    if (fileNameLabel) fileNameLabel.textContent = "Sin archivo seleccionado.";
    if (dueFileNameLabel) dueFileNameLabel.textContent = "Sin planilla de vencimientos seleccionada.";
  };

  // Dashboard modal logic
  const ventaDashboardModal = document.getElementById("venta-dashboard-modal");
  const closeVentaDashboardBtn = document.getElementById("close-venta-dashboard");
  const ventaSaldoTotalEl = document.getElementById("venta-saldo-total");
  const ventaSaldoMetaEl = document.getElementById("venta-saldo-meta");
  const ventaSaldoPillEl = document.getElementById("venta-saldo-pill");
  const ventaSaldoBody = document.getElementById("venta-saldo-body");
  const ventaGhostTotalEl = document.getElementById("venta-ghost-total");
  const ventaGhostMetaEl = document.getElementById("venta-ghost-meta");
  const ventaGhostPillEl = document.getElementById("venta-ghost-pill");
  const ventaGhostBody = document.getElementById("venta-ghost-body");
  let ventaChart = null;
  let ventaDashboardCurrentId = null;
  let ventaDashboardCurrentClientId = null;
  let ventaDashboardCurrentCurrency = "COP";
  let ventaGhostRows = [];

  const ventaFormatAmountWithCurrency = (value, currency) => {
    const code = String(currency || "COP").trim().toUpperCase() || "COP";
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  };

  const renderVentaSaldoPositivo = (data) => {
    const rows = Array.isArray(data?.saldo_positivo_transacciones) ? data.saldo_positivo_transacciones : [];
    const saleCurrency = String(data?.venta?.moneda || "COP").trim().toUpperCase() || "COP";
    const saleBalance = Number(data?.saldo || 0);
    const saldoPorMoneda = rows.reduce((acc, row) => {
      const currency = String(row?.moneda || saleCurrency || "COP").trim().toUpperCase() || "COP";
      const current = Number(acc[currency] || 0);
      acc[currency] = current + Number(row?.saldo_transaccion || 0);
      return acc;
    }, {});
    const saldoTexto = Object.entries(saldoPorMoneda)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, total]) => ventaFormatAmountWithCurrency(total, currency))
      .join(" | ");

    if (ventaSaldoTotalEl) {
      ventaSaldoTotalEl.textContent = rows.length ? (saldoTexto || ventaFormatAmountWithCurrency(0, saleCurrency)) : "Sin saldo positivo";
    }

    if (ventaSaldoMetaEl) {
      if (saleBalance <= 0) {
        ventaSaldoMetaEl.textContent = "Esta venta ya está saldada; no hay saldo pendiente para abonar.";
      } else if (rows.length) {
        ventaSaldoMetaEl.textContent = `Transacciones del cliente que pueden abonarse a esta venta (${saleCurrency}).`;
      } else {
        ventaSaldoMetaEl.textContent = "No hay transacciones positivas del cliente para esta venta.";
      }
    }

    if (ventaSaldoPillEl) {
      ventaSaldoPillEl.textContent = `${rows.length} transacciones`;
    }

    if (ventaSaldoBody) {
      if (!rows.length) {
        ventaSaldoBody.innerHTML = `<tr><td colspan="6" class="ventas-empty">No hay saldo positivo para aplicar.</td></tr>`;
        return;
      }

      ventaSaldoBody.innerHTML = rows
        .map((row) => {
          const txId = Number(row.id_transaccion || 0);
          const saldoDisponible = Number(row.saldo_transaccion || 0);
          const fecha = row.fecha ? new Date(row.fecha).toLocaleString("es-CO") : "";
          const amountLabel = ventaFormatAmountWithCurrency(saldoDisponible, row.moneda || saleCurrency);

          return `
            <tr>
              <td>${escapeHtml(fecha)}</td>
              <td><strong>#${escapeHtml(String(txId))}</strong><br/><small>${escapeHtml(row.referencia || row.descripcion || "Sin referencia")}</small></td>
              <td>${escapeHtml(row.banco_nombre || "-")}</td>
              <td><strong>${escapeHtml(String(row.moneda || saleCurrency).toUpperCase())}</strong></td>
              <td class="font-bold text-right">${escapeHtml(amountLabel)}</td>
              <td>
                <button type="button" class="venta-saldo-action" data-action="apply-positive-balance" data-tx-id="${escapeHtml(String(txId))}" data-tx-saldo="${escapeHtml(String(saldoDisponible))}" ${saleBalance <= 0 || saldoDisponible <= 0 ? "disabled" : ""}>
                  Aplicar a esta venta
                </button>
              </td>
            </tr>
          `;
        })
        .join("");
    }
  };

  const renderVentaGhosts = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    ventaGhostRows = list;

    if (ventaGhostTotalEl) {
      ventaGhostTotalEl.textContent = list.length ? `${list.length} pendientes` : "Sin fantasmas";
    }

    if (ventaGhostMetaEl) {
      ventaGhostMetaEl.textContent = list.length
        ? "Selecciona una transacción fantasma y conviértela en una transacción real para esta venta."
        : "No hay transacciones fantasma pendientes.";
    }

    if (ventaGhostPillEl) {
      ventaGhostPillEl.textContent = `${list.length} pendientes`;
    }

    if (!ventaGhostBody) {
      return;
    }

    if (!list.length) {
      ventaGhostBody.innerHTML = `<tr><td class="ventas-empty" colspan="7">No hay transacciones fantasma para asignar.</td></tr>`;
      return;
    }

    ventaGhostBody.innerHTML = list
      .map((ghost) => {
        const ghostId = Number(ghost.id_fantasma || 0);
        const ghostCurrency = String(ghost.moneda || ventaDashboardCurrentCurrency || "COP").trim().toUpperCase() || "COP";
        const amountLabel = ventaFormatAmountWithCurrency(Number(ghost.valor || 0), ghostCurrency);
        const fecha = ghost.fecha ? new Date(ghost.fecha).toLocaleString("es-CO") : "";

        return `
          <tr>
            <td>${escapeHtml(fecha)}</td>
            <td><strong>#${escapeHtml(String(ghostId))}</strong></td>
            <td>${escapeHtml(ghost.descripcion || ghost.nombre || "-")}</td>
            <td>${escapeHtml(ghost.banco_nombre || "-")}</td>
            <td><strong>${escapeHtml(ghostCurrency)}</strong></td>
            <td class="font-bold text-right">${escapeHtml(amountLabel)}</td>
            <td>
              <button type="button" class="venta-saldo-action" data-action="assign-ghost-to-sale" data-ghost-id="${escapeHtml(String(ghostId))}">
                Asignar a esta venta
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  };

  const loadVentaGhosts = async () => {
    if (ventaGhostBody) {
      ventaGhostBody.innerHTML = `<tr><td class="ventas-empty" colspan="7">Cargando transacciones fantasma...</td></tr>`;
    }

    try {
      const response = await apiFetch("/api/transacciones/fantasmas?estado=pendiente");
      if (!response.ok) {
        throw new Error(`(${response.status})`);
      }
      const payload = await response.json().catch(() => ({}));
      renderVentaGhosts(Array.isArray(payload.data) ? payload.data : []);
    } catch (error) {
      if (ventaGhostBody) {
        ventaGhostBody.innerHTML = `<tr><td class="ventas-empty" colspan="7">No fue posible cargar las transacciones fantasma.</td></tr>`;
      }
      if (ventaGhostMetaEl) {
        ventaGhostMetaEl.textContent = "No se pudieron cargar las transacciones fantasma.";
      }
    }
  };

  const applyTxBalanceToCurrentSale = async (txId, txSaldo) => {
    if (!ventaDashboardCurrentId) {
      return;
    }

    const amount = Number(txSaldo || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("La transacción no tiene saldo disponible para aplicar.");
      return;
    }

    const ok = window.confirm("¿Deseas aplicar este saldo positivo a la venta seleccionada?");
    if (!ok) {
      return;
    }

    try {
      const response = await apiFetch("/api/aplicaciones", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id_transaccion: Number(txId),
          id_venta: Number(ventaDashboardCurrentId),
          valor_aplicado: amount
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || `No fue posible aplicar el saldo (${response.status})`);
      }

      showToast({
        title: "Saldo aplicado a la venta",
        subtitle: `Se abonó la transacción #${txId} a la venta seleccionada.`,
        icon: "task_alt"
      });

      await openVentaDashboard(ventaDashboardCurrentId);
    } catch (error) {
      alert(`Error aplicando el saldo: ${error.message}`);
    }
  };

  const assignGhostToCurrentSale = async (ghostId) => {
    if (!ventaDashboardCurrentId) {
      return;
    }

    const ghost = ventaGhostRows.find((item) => Number(item.id_fantasma) === Number(ghostId));
    if (!ghost) {
      alert("No se encontró la transacción fantasma seleccionada.");
      return;
    }

    const ghostCurrency = String(ghost.moneda || "COP").trim().toUpperCase() || "COP";
    let tasaConversion = 1;
    if (ghostCurrency !== ventaDashboardCurrentCurrency) {
      const rateInput = window.prompt(`La transacción está en ${ghostCurrency} y la venta en ${ventaDashboardCurrentCurrency}. Ingresa la tasa de conversión:`);
      if (rateInput === null) {
        return;
      }
      tasaConversion = Number.parseFloat(String(rateInput).replace(/,/g, "."));
      if (!Number.isFinite(tasaConversion) || tasaConversion <= 0) {
        alert("La tasa de conversión no es válida.");
        return;
      }
    }

    const ok = window.confirm("¿Deseas convertir esta transacción fantasma y aplicarla a la venta seleccionada?");
    if (!ok) {
      return;
    }

    try {
      const response = await apiFetch(`/api/transacciones/fantasmas/${encodeURIComponent(ghostId)}/resolver`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id_cliente: Number(ventaDashboardCurrentClientId || 0),
          id_venta: Number(ventaDashboardCurrentId),
          tasa_conversion: tasaConversion,
          observaciones: "Asignada desde ventas"
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || `No fue posible resolver la transacción fantasma (${response.status})`);
      }

      showToast({
        title: "Transacción fantasma aplicada",
        subtitle: `La fila #${ghostId} quedó asociada a esta venta.`,
        icon: "task_alt"
      });

      await openVentaDashboard(ventaDashboardCurrentId);
    } catch (error) {
      alert(`Error asignando la transacción fantasma: ${error.message}`);
    }
  };

  const closeVentaDashboard = () => {
    if (!ventaDashboardModal) return;
    ventaDashboardModal.classList.remove("is-open");
    ventaDashboardModal.setAttribute("aria-hidden", "true");
    ventaDashboardCurrentId = null;
    if (ventaChart) {
      try {
        ventaChart.destroy();
      } catch (e) {}
      ventaChart = null;
    }
    // remove key handler and restore focus
    if (ventaModalKeyHandler) {
      document.removeEventListener('keydown', ventaModalKeyHandler);
      ventaModalKeyHandler = null;
    }
    if (prevFocusedElementForModal && typeof prevFocusedElementForModal.focus === 'function') {
      prevFocusedElementForModal.focus();
      prevFocusedElementForModal = null;
    }
  };

  if (closeVentaDashboardBtn) {
    closeVentaDashboardBtn.addEventListener("click", closeVentaDashboard);
  }

  if (ventaDashboardModal) {
    ventaDashboardModal.addEventListener("click", (ev) => {
      if (ev.target === ventaDashboardModal) closeVentaDashboard();
    });
  }

  ventaSaldoBody?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[data-action='apply-positive-balance']");
    if (!button) {
      return;
    }

    const txId = button.getAttribute("data-tx-id");
    const txSaldo = button.getAttribute("data-tx-saldo");
    if (txId) {
      applyTxBalanceToCurrentSale(txId, txSaldo);
    }
  });

  ventaGhostBody?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[data-action='assign-ghost-to-sale']");
    if (!button) {
      return;
    }

    const ghostId = button.getAttribute("data-ghost-id");
    if (ghostId) {
      assignGhostToCurrentSale(ghostId);
    }
  });

  const openVentaDashboard = async (idVenta) => {
    if (!idVenta) return;
    try {
      const res = await apiFetch(`/api/ventas/${encodeURIComponent(idVenta)}/dashboard`);
      if (!res.ok) throw new Error(`(${res.status})`);
      const payload = await res.json();
      if (!payload.success) throw new Error(payload.message || "error");

        const data = payload.data;
        ventaDashboardCurrentId = Number(idVenta);
        ventaDashboardCurrentClientId = Number(data?.cliente?.id_cliente || 0) || null;
        ventaDashboardCurrentCurrency = String(data?.venta?.moneda || "COP").trim().toUpperCase() || "COP";
      // Populate info into KPI header and animate numbers
      document.getElementById("venta-dashboard-title").textContent = `Venta ${data.venta.comprobante || "-"}`;
      document.getElementById("venta-dashboard-subtitle").textContent = `Cliente: ${data.cliente.nombre || "-"} (${data.cliente.identificacion || "-"})`;

      const totalEl = document.getElementById("venta-kpi-total-val");
      const aplicadoEl = document.getElementById("venta-kpi-aplicado-val");
      const saldoEl = document.getElementById("venta-kpi-saldo-val");

      const totalNum = Number(data.venta.total) || 0;
      const aplicadoNum = Number(data.aplicaciones?.reduce((s, a) => s + Number(a.valor_aplicado || 0), 0) || 0);
      const saldoNum = Number(data.saldo) || (totalNum - aplicadoNum);

      const animateNumber = (el, to) => {
        if (!el) return;
        const duration = 650;
        const startTime = performance.now();
        const start = 0;
        const step = (now) => {
          const t = Math.min(1, (now - startTime) / duration);
          const val = Math.round(start + (to - start) * t);
          el.textContent = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val);
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };

      animateNumber(totalEl, totalNum);
      animateNumber(aplicadoEl, aplicadoNum);
      animateNumber(saldoEl, saldoNum);

      // Fill history table
      const historyBody = document.getElementById("venta-history-body");
      historyBody.innerHTML = "";
      (data.aplicaciones || []).forEach((a) => {
        const tr = document.createElement("tr");
        const fecha = document.createElement("td");
        fecha.textContent = a.fecha ? new Date(a.fecha).toLocaleString() : "-";
        const tx = document.createElement("td");
        tx.textContent = `#${a.id_transaccion} - ${a.transaccion_nombre || a.referencia || "-"}`;
        const valor = document.createElement("td");
        valor.textContent = Number(a.valor_aplicado).toFixed(2);
        tr.appendChild(fecha);
        tr.appendChild(tx);
        tr.appendChild(valor);
        tr.classList.add('fade-in-up');
        historyBody.appendChild(tr);
      });

      // Chart: aggregated by fecha
      const chartCanvas = document.getElementById("venta-aplicaciones-chart");
      const labels = (data.aplicaciones_por_fecha || []).map((r) => r.fecha);
      const values = (data.aplicaciones_por_fecha || []).map((r) => Number(r.total_aplicado));
      if (ventaChart) {
        try { ventaChart.destroy(); } catch (e) {}
      }
      try {
        ventaChart = new Chart(chartCanvas.getContext("2d"), {
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                label: "Total aplicado",
                data: values,
                backgroundColor: "rgba(16,42,71,0.8)"
              }
            ]
          },
          options: {
            responsive: true,
            interaction: { mode: 'index' },
            plugins: { legend: { display: false } }
          }
        });
      } catch (e) {
        // Chart fail silently
      }

      // Draw small sparkline preview
      try {
        const spark = document.getElementById('venta-sparkline');
        if (spark && labels.length) {
          const ctx = spark.getContext('2d');
          ctx.clearRect(0,0,spark.width,spark.height);
          ctx.strokeStyle = 'rgba(16,42,71,0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          values.forEach((v,i)=>{
            const x = (i/(values.length-1 || 1)) * (spark.width-8) + 4;
            const max = Math.max(...values,1);
            const y = spark.height - 6 - (v/max)*(spark.height-12);
            if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
          });
          ctx.stroke();
        }
      } catch (e) {}

      // Open modal and manage focus
      prevFocusedElementForModal = document.activeElement;
      ventaDashboardModal.classList.add("is-open");
      ventaDashboardModal.setAttribute("aria-hidden", "false");
      // focus first focusable element (close button)
      const closeBtn = document.getElementById('close-venta-dashboard');
      if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();

      // Trap focus inside modal and handle Escape
      ventaModalKeyHandler = function(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeVentaDashboard();
          return;
        }

        if (e.key !== 'Tab') return;
        const focusable = ventaDashboardModal.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      document.addEventListener('keydown', ventaModalKeyHandler);

      renderVentaSaldoPositivo(data);
      loadVentaGhosts();
    } catch (err) {
      alert(`No fue posible obtener el dashboard de la venta: ${err.message}`);
    }
  };

  const onFileSelected = async (file) => {
    const isExcel = /\.(xlsx|xls)$/i.test(file?.name || "");
    if (!file || !isExcel) {
      if (importStatus) {
        importStatus.textContent = "Selecciona un archivo Excel valido (.xlsx o .xls).";
      }
      return;
    }

    try {
      await readWorkbook(file);
    } catch (error) {
      if (importStatus) {
        importStatus.textContent = "No fue posible leer el archivo. Revisa el formato e intenta de nuevo.";
      }
    }
  };

  if (fileInput) {
    fileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      await onFileSelected(file);
    });
  }

  if (dueFileInput) {
    dueFileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const isExcel = /\.(xlsx|xls)$/i.test(file.name || "");
      if (!isExcel) {
        if (importStatus) {
          importStatus.textContent = "Selecciona un archivo Excel valido para la planilla de vencimientos (.xlsx o .xls).";
        }
        return;
      }

      try {
        await readDueDatesWorkbook(file);
      } catch (error) {
        if (importStatus) {
          importStatus.textContent = "No fue posible leer la planilla de vencimientos. Revisa el formato e intenta de nuevo.";
        }
      }
    });
  }

  if (previewBody) {
    previewBody.addEventListener("input", (event) => {
      const target = event.target;
      if (!target || target.dataset.previewField !== "fecha_vencimiento") {
        return;
      }

      const rowIndex = Number.parseInt(target.dataset.rowIndex || "", 10);
      if (!Number.isInteger(rowIndex) || !state.previewRows[rowIndex]) {
        return;
      }

      state.previewRows[rowIndex].fecha_vencimiento = parseDateInputValue(target.value);
      refreshImportPreviewSummary();
    });
  }

  if (dropzone && fileInput) {
    ["dragenter", "dragover"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragover");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-dragover");
      });
    });

    dropzone.addEventListener("drop", async (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (fileInput && file) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
      }
      await onFileSelected(file);
    });
  }

  if (dueDropzone && dueFileInput) {
    ["dragenter", "dragover"].forEach((eventName) => {
      dueDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dueDropzone.classList.add("is-dragover");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dueDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dueDropzone.classList.remove("is-dragover");
      });
    });

    dueDropzone.addEventListener("drop", async (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (dueFileInput && file) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        dueFileInput.files = transfer.files;
      }
      if (file) {
        await readDueDatesWorkbook(file);
      }
    });
  }

  if (applyImportButton) {
    applyImportButton.addEventListener("click", async () => {
      if (!state.previewRows.length) {
        if (importStatus) {
          importStatus.textContent = "No hay filas en preview para importar a la base de datos.";
        }
        return;
      }

      const recordsToImport = collectImportRecords();
      const missingDueDates = recordsToImport.filter((row) => !parseDateInputValue(row.fecha_vencimiento));
      if (missingDueDates.length > 0) {
        if (importStatus) {
          importStatus.textContent = `Faltan ${missingDueDates.length} fechas de vencimiento por completar. Carga la planilla opcional o llena esos campos en el preview.`;
        }
        return;
      }

      // Mostrar modal de progreso
      const progressModal = document.getElementById("import-progress-modal");
      const progressBar = document.getElementById("import-progress-bar");
      const progressText = document.getElementById("import-progress-text");
      const logsContainer = document.getElementById("import-logs-container");

      if (progressModal) {
        progressModal.classList.add("is-open");
        progressModal.setAttribute("aria-hidden", "false");
      }

      logsContainer.innerHTML = '<p style="color: #999; margin: 0;">Iniciando importación a base de datos...</p>';

      try {
        // Enviar datos al servidor
        const response = await apiFetch("/api/ventas/import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            records: recordsToImport
          })
        });

        const result = await response.json();

        // Actualizar progreso
        const progress = result.imported > 0 ? (result.imported / result.total) * 100 : 0;
        if (progressBar) {
          progressBar.style.width = progress + "%";
        }
        if (progressText) {
          progressText.textContent = `${result.imported} / ${result.total} registros procesados`;
        }

        // Agregar logs
        let logsHtml = `<p style="color: #27ae60; margin: 0 0 0.5rem 0;">✓ Importación completada</p>`;
        logsHtml += `<p style="color: #555; margin: 0 0 0.5rem 0; font-size: 0.75rem;">
          Total: ${result.total} | Importados: ${result.imported} | Errores: ${result.failed}
        </p>`;

        if (result.errors && result.errors.length > 0) {
          logsHtml += `<p style="color: #e74c3c; margin: 0.5rem 0 0.3rem 0; font-weight: 600;">Errores encontrados:</p>`;
          result.errors.slice(0, 10).forEach((err) => {
            logsHtml += `<p style="color: #555; margin: 0.2rem 0; font-size: 0.75rem;">
              Fila ${err.row}: ${err.error}
            </p>`;
          });
          if (result.errors.length > 10) {
            logsHtml += `<p style="color: #999; margin: 0.2rem 0; font-size: 0.75rem;">
              ... y ${result.errors.length - 10} errores más
            </p>`;
          }
        }

        logsContainer.innerHTML = logsHtml;

        // Mostrar resultados después de 1 segundo
        setTimeout(() => {
          if (progressModal) {
            progressModal.classList.remove("is-open");
            progressModal.setAttribute("aria-hidden", "true");
          }

          showImportResults(result);
        }, 1000);

      } catch (error) {
        logsContainer.innerHTML = `<p style="color: #e74c3c; margin: 0;">Error: ${error.message}</p>`;

        setTimeout(() => {
          if (progressModal) {
            progressModal.classList.remove("is-open");
            progressModal.setAttribute("aria-hidden", "true");
          }

          showImportResults({
            success: false,
            total: state.previewRows.length,
            imported: 0,
            failed: state.previewRows.length,
            errors: [{ error: error.message }]
          });
        }, 1500);
      }
    });
  }

  // Función para mostrar resultados
  const showImportResults = async (result) => {
    const resultsModal = document.getElementById("import-results-modal");
    const resultTotal = document.getElementById("result-total");
    const resultImported = document.getElementById("result-imported");
    const resultFailed = document.getElementById("result-failed");
    const errorsContainer = document.getElementById("result-errors-container");
    const errorsList = document.getElementById("result-errors-list");

    if (resultTotal) resultTotal.textContent = String(result.total);
    if (resultImported) resultImported.textContent = String(result.imported);
    if (resultFailed) resultFailed.textContent = String(result.failed);

    // Mostrar errores si existen
    if (result.errors && result.errors.length > 0) {
      if (errorsContainer) errorsContainer.style.display = "block";
      if (errorsList) {
        let html = "";
        result.errors.forEach((err) => {
          html += `<div style="padding: 0.5rem; border-bottom: 1px solid #fee; font-size: 0.75rem;">
            <strong>Fila ${err.row || "?"}: </strong>${err.error}
          </div>`;
        });
        errorsList.innerHTML = html;
      }
    } else {
      if (errorsContainer) errorsContainer.style.display = "none";
    }

    if (resultsModal) {
      resultsModal.classList.add("is-open");
      resultsModal.setAttribute("aria-hidden", "false");
    }

    // Si la importación fue exitosa, limpiar preview y recargar desde BD
    if (result.success && result.imported > 0) {
      resetImportState();
      renderPreview();

      if (importStatus) {
        importStatus.textContent = `${result.imported} ventas importadas exitosamente a la base de datos. Actualizando listado...`;
      }

      await loadVentasFromDatabase();

      // Cerrar modal de carga
      closeModal();
    }
  };

  if (clearPreviewButton) {
    clearPreviewButton.addEventListener("click", () => {
      resetImportState();
      renderPreview();
      if (importStatus) {
        importStatus.textContent = "Preview limpio.";
      }
    });
  }

  if (previewFilter) {
    previewFilter.addEventListener("change", () => {
      state.previewFilter = previewFilter.value === "missing" ? "missing" : "all";
      renderPreview();
    });
  }

  if (globalFilter) {
    globalFilter.addEventListener("input", applyFilters);
  }

  // Manejadores para cerrar modal de resultados
  const closeResultsButton = document.getElementById("close-results-button");
  const closeResultsModal = document.getElementById("close-results-modal");
  const resultsModal = document.getElementById("import-results-modal");

  if (closeResultsButton) {
    closeResultsButton.addEventListener("click", () => {
      if (resultsModal) {
        resultsModal.classList.remove("is-open");
        resultsModal.setAttribute("aria-hidden", "true");
      }
    });
  }

  if (closeResultsModal) {
    closeResultsModal.addEventListener("click", () => {
      if (resultsModal) {
        resultsModal.classList.remove("is-open");
        resultsModal.setAttribute("aria-hidden", "true");
      }
    });
  }

  if (resultsModal) {
    resultsModal.addEventListener("click", (event) => {
      if (event.target === resultsModal) {
        resultsModal.classList.remove("is-open");
        resultsModal.setAttribute("aria-hidden", "true");
      }
    });
  }

  loadVentasFromDatabase();
  renderPreview();

  // Delegated handlers for Ventas table
  tableBody?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[data-action]");
    const tr = event.target?.closest?.("tr[data-id]");
    if (!tr) {
      return;
    }

    if (button) {
      event.preventDefault();
      event.stopPropagation();
      const action = button.getAttribute("data-action");

      if (action === "edit") {
        ventasStartEditMode(tr);
      } else if (action === "cancel") {
        ventasExitEditMode();
      } else if (action === "save") {
        ventasSaveEdit(tr);
      } else if (action === "delete") {
        ventasDeleteRow(tr);
      }

      return;
    }

    // Default: open dashboard
    const id = tr.getAttribute("data-id");
    if (id && !tr.classList.contains("is-editing")) {
      openVentaDashboard(id);
    }
  });

  tableBody?.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!target) {
      return;
    }

    if (target.tagName === "BUTTON" || target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") {
      return;
    }

    const tr = target.closest?.("tr[data-id]");
    if (!tr || tr.classList.contains("is-editing")) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const id = tr.getAttribute("data-id");
      if (id) {
        openVentaDashboard(id);
      }
    }
  });
}

const transaccionesPage = document.getElementById("transacciones-page");

if (transaccionesPage) {
  const txState = {
    ventasOptions: [],
    clientesOptions: [],
    bancosOptions: [],
    ghosts: [],
    records: []
  };

  const txPlanBody = document.getElementById("tx-plan-body");
  const txPlanStatus = document.getElementById("tx-plan-status");
  const txAddRowButton = document.getElementById("tx-add-row");
  const txAddFiveRowsButton = document.getElementById("tx-add-5-rows");
  const txClearRowsButton = document.getElementById("tx-clear-rows");
  const txSavePlanButton = document.getElementById("tx-save-plan");
  const txCancelModalButton = document.getElementById("tx-cancel-modal");
  const txPlanTotalPreview = document.getElementById("tx-plan-total-preview");
  const txPlanTotalMeta = document.getElementById("tx-plan-total-meta");
  const txPlanTotalBreakdown = document.getElementById("tx-plan-total-breakdown");
  const txPlanTotalBox = document.querySelector(".tx-plan-total");

  const txFilterGlobal = document.getElementById("tx-filter-global");
  const txGhostFilter = document.getElementById("tx-ghost-filter");
  const txTableHead = document.getElementById("tx-table-head");
  const txTableBody = document.getElementById("tx-table-body");
  const txGhostCount = document.getElementById("tx-ghost-count");
  const txGhostTableBody = document.getElementById("tx-ghost-table-body");
  const txGhostModal = document.getElementById("tx-ghost-modal");
  const txGhostCloseButton = document.getElementById("tx-ghost-close");
  const txGhostCancelButton = document.getElementById("tx-ghost-cancel");
  const txGhostResolveButton = document.getElementById("tx-ghost-resolve");
  const txGhostClienteSelect = document.getElementById("tx-ghost-cliente");
  const txGhostVentaSelect = document.getElementById("tx-ghost-venta");
  const txGhostRateWrap = document.getElementById("tx-ghost-rate-wrap");
  const txGhostRateInput = document.getElementById("tx-ghost-rate");
  const txGhostNotesInput = document.getElementById("tx-ghost-notas");
  const txGhostSummary = document.getElementById("tx-ghost-summary");
  const txGhostFecha = document.getElementById("tx-ghost-fecha");
  const txGhostValor = document.getElementById("tx-ghost-valor");
  const txGhostMoneda = document.getElementById("tx-ghost-moneda");
  const txGhostBanco = document.getElementById("tx-ghost-banco");
  const txGhostReferencia = document.getElementById("tx-ghost-referencia");
  const txGhostDescripcion = document.getElementById("tx-ghost-descripcion");

  const txKpiTotal = document.getElementById("tx-kpi-total");
  const txKpiAplicado = document.getElementById("tx-kpi-aplicado");
  const txKpiSaldo = document.getElementById("tx-kpi-saldo");

  const txResultsModal = document.getElementById("tx-results-modal");
  const txCloseResultsButton = document.getElementById("tx-close-results");
  const txResultsOkButton = document.getElementById("tx-results-ok");
  const txResultTotal = document.getElementById("tx-result-total");
  const txResultOk = document.getElementById("tx-result-ok");
  const txResultError = document.getElementById("tx-result-error");
  const txResultLog = document.getElementById("tx-result-log");

  const txDetailModal = document.getElementById("tx-detail-modal");
  const closeTxDetailBtn = document.getElementById("close-tx-detail");

  let txGhostCurrent = null;

  const txTableColumns = [
    "ID Transacción",
    "Cliente",
    "NIT",
    "Fecha",
    "Descripcion",
    "Banco",
    "Moneda",
    "Valor",
    "Aplicado",
    "Saldo"
  ];
  const txActionColumn = "Acciones";

  const txMoneyFormatter = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  });

  const txRateFormatter = new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });

  const txPlanAmountFormatter = new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });

  const txEscapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const txNormalize = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const txParseCurrency = (value) => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    let clean = String(value || "").trim();
    if (!clean) return 0;

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
      clean = clean.replace(/\./g, "").replace(/,/g, ".");
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

  const txFormatAmountWithCurrency = (value, currency) => {
    const code = String(currency || "").trim().toUpperCase();
    const amount = txMoneyFormatter.format(Number(value || 0));
    return code ? `${amount} ${code}` : amount;
  };

  const txFormatRate = (value) => txRateFormatter.format(Number(value || 0));

  const txGetVentaByValue = (value) => {
    const raw = String(value || "");
    if (!raw.startsWith("venta:")) {
      return null;
    }

    const idVenta = Number.parseInt(raw.split(":")[1], 10);
    if (!Number.isInteger(idVenta) || idVenta <= 0) {
      return null;
    }

    return txState.ventasOptions.find((item) => Number(item.id_venta) === idVenta) || null;
  };

  const txUpdateConversionMode = (rowEl) => {
    const ventaSelect = rowEl.querySelector('[data-field="venta"]');
    const monedaSelect = rowEl.querySelector('[data-field="moneda"]');
    const valorInput = rowEl.querySelector('[data-field="valor"]');
    const conversionWrap = rowEl.querySelector('[data-field="conversion-wrap"]');
    const conversionInput = rowEl.querySelector('[data-field="tasa-conversion"]');
    const conversionHint = rowEl.querySelector('[data-field="conversion-hint"]');
    const conversionPreview = rowEl.querySelector('[data-field="conversion-preview"]');

    if (!ventaSelect || !monedaSelect || !conversionWrap || !conversionInput) {
      return;
    }

    const venta = txGetVentaByValue(ventaSelect.value);
    const txCurrency = String(monedaSelect.value || "COP").trim().toUpperCase();
    const saleCurrency = String(venta?.moneda || "").trim().toUpperCase();
    const referenceCurrency = saleCurrency || "COP";
    const needsConversion = Boolean((venta ? saleCurrency !== txCurrency : txCurrency !== "COP") && txCurrency);

    if (needsConversion) {
      conversionWrap.classList.remove("is-hidden");
      conversionInput.required = true;
      conversionInput.placeholder = `Ej: 4000`;
      if (conversionHint) {
        conversionHint.textContent = `1 ${txCurrency} = ? ${referenceCurrency}`;
      }
      if (conversionPreview) {
        const amount = txParseCurrency(valorInput?.value || 0);
        const rate = txParseCurrency(conversionInput.value || 0);
        conversionPreview.textContent = amount > 0 && rate > 0 ? `Equivale a ${txFormatAmountWithCurrency(amount * rate, referenceCurrency)}` : "";
      }
      return;
    }

    conversionInput.required = false;
    conversionInput.value = "";
    if (conversionHint) {
      conversionHint.textContent = "";
    }
    if (conversionPreview) {
      conversionPreview.textContent = "";
    }
    conversionWrap.classList.add("is-hidden");
  };

  const txUpdateConversionPreview = (rowEl) => {
    const ventaSelect = rowEl.querySelector('[data-field="venta"]');
    const monedaSelect = rowEl.querySelector('[data-field="moneda"]');
    const valorInput = rowEl.querySelector('[data-field="valor"]');
    const conversionInput = rowEl.querySelector('[data-field="tasa-conversion"]');
    const conversionPreview = rowEl.querySelector('[data-field="conversion-preview"]');
    if (!ventaSelect || !monedaSelect || !conversionInput || !conversionPreview) {
      return;
    }

    const venta = txGetVentaByValue(ventaSelect.value);
    const txCurrency = String(monedaSelect.value || "COP").trim().toUpperCase();
    const saleCurrency = String(venta?.moneda || "").trim().toUpperCase();
    const referenceCurrency = saleCurrency || "COP";
    const needsConversion = Boolean((venta ? saleCurrency !== txCurrency : txCurrency !== "COP") && txCurrency);
    if (!needsConversion) {
      conversionPreview.textContent = "";
      return;
    }

    const amount = txParseCurrency(valorInput?.value || 0);
    const rate = txParseCurrency(conversionInput.value || 0);
    conversionPreview.textContent = amount > 0 && rate > 0 ? `Equivale a ${txFormatAmountWithCurrency(amount * rate, referenceCurrency)}` : "";
  };

  const txFormatDateLabel = (value) => {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("es-CO");
  };

  const txUpdateGhostSaleOptions = () => {
    if (!txGhostVentaSelect) return;

    const clienteId = Number.parseInt(txGhostClienteSelect?.value || "", 10);
    const selectedVentaId = txGhostCurrent?.id_venta_resuelta ? Number(txGhostCurrent.id_venta_resuelta) : null;
    const ventaOptions = txState.ventasOptions
      .filter((venta) => !Number.isInteger(clienteId) || clienteId <= 0 || Number(venta.id_cliente) === clienteId)
      .map((venta) => `<option value="${txEscapeHtml(String(venta.id_venta))}">${txEscapeHtml(`Venta #${venta.id_venta} | ${venta.cliente_nombre} | ${String(venta.moneda || "COP").toUpperCase()}`)}</option>`)
      .join("");

    txGhostVentaSelect.innerHTML = `<option value="">Selecciona una venta</option>${ventaOptions}`;
    if (selectedVentaId) {
      txGhostVentaSelect.value = String(selectedVentaId);
    }

    const venta = txState.ventasOptions.find((item) => Number(item.id_venta) === Number.parseInt(txGhostVentaSelect.value || "", 10));
    const monedaGhost = String(txGhostCurrent?.moneda || "COP").trim().toUpperCase();
    const monedaVenta = String(venta?.moneda || "").trim().toUpperCase();
    const needsRate = Boolean(venta && monedaGhost && monedaVenta && monedaGhost !== monedaVenta);

    if (txGhostRateWrap) {
      txGhostRateWrap.classList.toggle("hidden", !needsRate);
    }
    if (!needsRate && txGhostRateInput) {
      txGhostRateInput.value = "";
    }
  };

  const txOpenGhostModal = (ghost) => {
    txGhostCurrent = ghost || null;
    if (!txGhostModal || !ghost) return;

    if (txGhostSummary) {
      txGhostSummary.textContent = `Resolver la fila #${ghost.id_fantasma} y crear la transacción real asociada.`;
    }
    if (txGhostFecha) txGhostFecha.textContent = txFormatDateLabel(ghost.fecha);
    if (txGhostValor) txGhostValor.textContent = txMoneyFormatter.format(Number(ghost.valor || 0));
    if (txGhostMoneda) txGhostMoneda.textContent = String(ghost.moneda || "COP").toUpperCase();
    if (txGhostBanco) txGhostBanco.textContent = ghost.banco_nombre || "-";
    if (txGhostReferencia) txGhostReferencia.textContent = ghost.referencia || "-";
    if (txGhostDescripcion) txGhostDescripcion.textContent = ghost.descripcion || ghost.nombre || "-";

    if (txGhostClienteSelect) {
      txGhostClienteSelect.innerHTML = [
        '<option value="">Selecciona un cliente</option>',
        ...txState.clientesOptions.map((cliente) => {
          const label = `${cliente.nombre} (${cliente.identificacion || "Sin NIT"})`;
          return `<option value="${txEscapeHtml(String(cliente.id_cliente))}">${txEscapeHtml(label)}</option>`;
        })
      ].join("");
    }

    if (txGhostNotesInput) txGhostNotesInput.value = ghost.observaciones || "";
    if (txGhostRateInput) txGhostRateInput.value = "";
    txUpdateGhostSaleOptions();

    txGhostModal.classList.add("is-open");
    txGhostModal.setAttribute("aria-hidden", "false");
  };

  const txCloseGhostModal = () => {
    if (txGhostModal) {
      txGhostModal.classList.remove("is-open");
      txGhostModal.setAttribute("aria-hidden", "true");
    }
    txGhostCurrent = null;
  };

  const txRenderGhosts = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    txState.ghosts = list;

    if (txGhostCount) {
      txGhostCount.textContent = String(list.length);
    }

    if (!txGhostTableBody) return;

    if (!list.length) {
      txGhostTableBody.innerHTML = `<tr><td class="ventas-empty" colspan="8">No hay transacciones fantasma pendientes.</td></tr>`;
      return;
    }

    txGhostTableBody.innerHTML = list.map((ghost) => {
      const idAttr = txEscapeHtml(String(ghost.id_fantasma));
      const isPending = String(ghost.estado || "pendiente") === "pendiente";
      return `
        <tr data-id="${idAttr}">
          <td>${txEscapeHtml(txFormatDateLabel(ghost.fecha))}</td>
          <td class="font-bold text-right">${txEscapeHtml(txMoneyFormatter.format(Number(ghost.valor || 0)))}</td>
          <td><strong>${txEscapeHtml(String(ghost.moneda || "COP").toUpperCase())}</strong></td>
          <td>${txEscapeHtml(ghost.banco_nombre || "-")}</td>
          <td>${txEscapeHtml(ghost.referencia || "-")}</td>
          <td>${txEscapeHtml(ghost.descripcion || ghost.nombre || "-")}</td>
          <td><span class="badge badge-warning">${txEscapeHtml(ghost.estado || "pendiente")}</span></td>
          <td>
            <button type="button" class="btn-secondary" data-action="resolve-ghost" data-ghost-id="${idAttr}" ${isPending ? "" : "disabled"}>Resolver</button>
          </td>
        </tr>
      `;
    }).join("");
  };

  const txLoadGhosts = async () => {
    if (txGhostTableBody) {
      txGhostTableBody.innerHTML = `<tr><td class="ventas-empty" colspan="8">Cargando transacciones fantasma...</td></tr>`;
    }

    const estado = String(txGhostFilter?.value || "pendiente").trim();
    const query = estado ? `?estado=${encodeURIComponent(estado)}` : "";
    const response = await apiFetch(`/api/transacciones/fantasmas${query}`);
    if (!response.ok) {
      throw new Error(`No se pudieron cargar transacciones fantasma (${response.status})`);
    }

    const payload = await response.json();
    txRenderGhosts(Array.isArray(payload.data) ? payload.data : []);
  };

  const txResolveGhost = async () => {
    if (!txGhostCurrent) return;

    const idCliente = Number.parseInt(txGhostClienteSelect?.value || "", 10);
    const idVenta = Number.parseInt(txGhostVentaSelect?.value || "", 10);
    const tasaConversion = Number.parseFloat(txGhostRateInput?.value || "");

    if (!Number.isInteger(idCliente) || idCliente <= 0) {
      alert("Selecciona un cliente.");
      return;
    }
    if (!Number.isInteger(idVenta) || idVenta <= 0) {
      alert("Selecciona una venta.");
      return;
    }

    const monedaGhost = String(txGhostCurrent.moneda || "COP").trim().toUpperCase();
    const venta = txState.ventasOptions.find((item) => Number(item.id_venta) === idVenta);
    const monedaVenta = String(venta?.moneda || "").trim().toUpperCase();
    const needsRate = Boolean(monedaGhost && monedaVenta && monedaGhost !== monedaVenta);

    if (needsRate && (!Number.isFinite(tasaConversion) || tasaConversion <= 0)) {
      alert("Ingresa una tasa de conversión válida.");
      return;
    }

    if (txGhostResolveButton) txGhostResolveButton.disabled = true;

    try {
      const response = await apiFetch(`/api/transacciones/fantasmas/${encodeURIComponent(txGhostCurrent.id_fantasma)}/resolver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_cliente: idCliente,
          id_venta: idVenta,
          tasa_conversion: needsRate ? tasaConversion : 1,
          observaciones: txGhostNotesInput?.value || ""
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "No fue posible resolver la transacción fantasma");
      }

      txCloseGhostModal();
      await Promise.all([txLoadTransacciones(), txLoadGhosts()]);
      if (txPlanStatus) {
        txPlanStatus.textContent = `Transacción fantasma resuelta y aplicada a la venta #${idVenta}.`;
      }
    } catch (error) {
      alert(`Error resolviendo fantasma: ${error.message}`);
    } finally {
      if (txGhostResolveButton) txGhostResolveButton.disabled = false;
    }
  };

  const txToDatetimeLocal = (value) => {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const txExitEditMode = () => {
    txApplyFilter();
  };

  const txStartEditMode = (tr) => {
    if (!tr || tr.classList.contains("is-editing")) {
      return;
    }
    const id = tr.getAttribute("data-id");
    if (!id) {
      return;
    }

    const record = txState.records.find((r) => String(r.id_transaccion) === String(id));
    if (!record) {
      return;
    }

    tr.classList.add("is-editing");
    tr.removeAttribute("role");
    tr.removeAttribute("tabindex");

    const setCellNode = (col, node) => {
      const td = tr.querySelector(`td[data-col="${CSS.escape(col)}"]`);
      if (!td) return;
      td.innerHTML = "";
      td.appendChild(node);
    };

    const setCellInput = (col, el, dataField = col) => {
      el.classList.add("table-input");
      el.setAttribute("data-field", dataField);
      setCellNode(col, el);
    };

    const fechaInput = document.createElement("input");
    fechaInput.type = "datetime-local";
    fechaInput.value = txToDatetimeLocal(record.fecha);
    setCellInput("Fecha", fechaInput);

    const clienteInput = document.createElement("input");
    clienteInput.type = "text";
    clienteInput.value = String(record.cliente_nombre || "");
    setCellInput("Cliente", clienteInput);

    const nitInput = document.createElement("input");
    nitInput.type = "text";
    nitInput.value = String(record.cliente_nit || "");
    setCellInput("NIT", nitInput);

    const valorInput = document.createElement("input");
    valorInput.type = "text";
    valorInput.inputMode = "decimal";
    valorInput.value = String(record.valor ?? "");
    setCellInput("Valor", valorInput);

    const monedaSelect = document.createElement("select");
    ["COP", "USD", "EUR", "PAB"].forEach((code) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = code;
      monedaSelect.appendChild(opt);
    });
    monedaSelect.value = String(record.moneda || "COP").trim().toUpperCase() || "COP";
    setCellInput("Moneda", monedaSelect);

    const bancoSelect = document.createElement("select");
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "-";
    bancoSelect.appendChild(emptyOpt);
    (txState.bancosOptions || []).forEach((banco) => {
      const opt = document.createElement("option");
      opt.value = String(banco.id_banco);
      opt.textContent = banco.nombre;
      bancoSelect.appendChild(opt);
    });
    bancoSelect.value = record.id_banco ? String(record.id_banco) : "";
    setCellInput("Banco", bancoSelect);

    const descWrap = document.createElement("div");
    descWrap.style.display = "grid";
    descWrap.style.gap = "0.35rem";

    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.placeholder = "Descripción";
    descInput.value = String(record.descripcion || record.nombre || "");
    descInput.classList.add("table-input");
    descInput.setAttribute("data-field", "Descripcion");

    const refInput = document.createElement("input");
    refInput.type = "text";
    refInput.placeholder = "Referencia";
    refInput.value = String(record.referencia || "");
    refInput.classList.add("table-input");
    refInput.setAttribute("data-field", "Referencia");

    descWrap.appendChild(descInput);
    descWrap.appendChild(refInput);
    setCellNode("Descripcion", descWrap);

    const actionsCell = tr.querySelector(".row-actions");
    if (actionsCell) {
      actionsCell.innerHTML = `
        <button type="button" class="icon-btn" data-action="save" title="Guardar" aria-label="Guardar">
          <span class="material-symbols-outlined">save</span>
        </button>
        <button type="button" class="icon-btn" data-action="cancel" title="Cancelar" aria-label="Cancelar">
          <span class="material-symbols-outlined">close</span>
        </button>
      `;
    }

    fechaInput.focus();
  };

  const txCollectEditPayload = (tr) => {
    const getVal = (col) => tr.querySelector(`[data-field="${CSS.escape(col)}"]`)?.value;
    return {
      fecha: String(getVal("Fecha") || "").trim(),
      cliente_nombre: String(getVal("Cliente") || "").trim(),
      cliente_nit: String(getVal("NIT") || "").trim(),
      valor: String(getVal("Valor") || "").trim(),
      moneda: String(getVal("Moneda") || "").trim(),
      id_banco: String(getVal("Banco") || "").trim(),
      referencia: String(getVal("Referencia") || "").trim(),
      descripcion: String(getVal("Descripcion") || "").trim()
    };
  };

  const txSaveEdit = async (tr) => {
    const id = tr?.getAttribute("data-id");
    if (!id) {
      return;
    }

    const body = txCollectEditPayload(tr);
    try {
      const response = await apiFetch(`/api/transacciones/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || `No fue posible editar la transaccion (${response.status})`);
      }

      showToast({
        title: "Transaccion actualizada",
        subtitle: `Se guardaron los cambios en la transaccion #${id}.`,
        icon: "task_alt"
      });

      await txLoadTransacciones();
    } catch (error) {
      alert(`Error guardando transaccion: ${error.message}`);
    }
  };

  const txDeleteRow = async (tr) => {
    const id = tr?.getAttribute("data-id");
    if (!id) {
      return;
    }

    const ok = window.confirm(`¿Deseas borrar la transaccion #${id}?`);
    if (!ok) {
      return;
    }

    try {
      const response = await apiFetch(`/api/transacciones/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || `No fue posible borrar la transaccion (${response.status})`);
      }

      showToast({
        title: "Transaccion borrada",
        subtitle: `La transaccion #${id} fue eliminada.`,
        icon: "delete"
      });

      await txLoadTransacciones();
    } catch (error) {
      alert(`Error borrando transaccion: ${error.message}`);
    }
  };

  const txGetVentaOptionsHtml = () => {
    const options = [
      '<option value="sin-venta">Venta no registrada</option>',
      ...txState.ventasOptions.map((venta) => {
        const label = `Venta #${venta.id_venta} | ${venta.cliente_nombre} | ${String(venta.moneda || "COP").toUpperCase()} | Saldo ${txFormatAmountWithCurrency(venta.saldo_venta || 0, venta.moneda || "COP")}`;
        return `<option value="venta:${venta.id_venta}">${txEscapeHtml(label)}</option>`;
      })
    ];

    return options.join("");
  };

  const txGetClientOptionsHtml = () => {
    const options = [
      '<option value="">Selecciona un cliente</option>',
      '<option value="cliente:no-registrado">Cliente no registrado</option>',
      ...txState.clientesOptions.map((cliente) => {
        const label = `${cliente.nombre} (${cliente.identificacion || "Sin NIT"})`;
        return `<option value="cliente:${cliente.id_cliente}">${txEscapeHtml(label)}</option>`;
      })
    ];

    return options.join("");
  };

  const txNormalizeBankName = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  const txBankPresets = [
    { key: "bbva1819", label: "BBVA 1819", aliases: ["bbva 1819", "bbva"] },
    { key: "bbva0605", label: "BBVA 0605", aliases: ["bbva 0605"] },
    { key: "bancolombia", label: "Bancolombia", aliases: ["bancolombia"] },
    { key: "bpanama", label: "Banco De Panama", aliases: ["banco de panama", "b de panama", "panama"] }
  ];

  const txResolvePresetBank = (presetKey) => {
    const preset = txBankPresets.find((item) => item.key === String(presetKey || ""));
    if (!preset) return null;

    const candidates = preset.aliases.map(txNormalizeBankName);
    return txState.bancosOptions.find((banco) => {
      const nombre = txNormalizeBankName(banco?.nombre);
      const codigo = txNormalizeBankName(banco?.codigo);
      return candidates.some((candidate) => nombre.includes(candidate) || codigo.includes(candidate));
    }) || null;
  };

  const txGetBancoOptionsHtml = () => {
    const options = [
      '<option value="">Selecciona banco</option>',
      ...txBankPresets.map((preset) => {
        return `<option value="preset:${preset.key}">${txEscapeHtml(preset.label)}</option>`;
      })
    ];

    return options.join("");
  };

  const txMarkRowError = (rowEl, hasError) => {
    if (!rowEl) {
      return;
    }

    rowEl.classList.toggle("tx-row-error", hasError);
  };

  const txUpdateClientMode = (rowEl) => {
    const ventaSelect = rowEl.querySelector('[data-field="venta"]');
    const clientSelect = rowEl.querySelector('[data-field="cliente-select"]');
    const clientDisplay = rowEl.querySelector('[data-field="cliente-display"]');
    const clientIdInput = rowEl.querySelector('[data-field="cliente-id"]');
    const clienteNitInput = rowEl.querySelector('[data-field="nit"]');

    if (!ventaSelect || !clientSelect || !clientDisplay || !clientIdInput || !clienteNitInput) {
      return;
    }

    const selected = String(ventaSelect.value || "");
    const hasVenta = selected.startsWith("venta:");
    const selectedClientValue = String(clientSelect.value || "");
    const isClientNoRegistered = selectedClientValue === "cliente:no-registrado";

    if (hasVenta) {
      const idVenta = Number.parseInt(selected.split(":")[1], 10);
      const venta = txState.ventasOptions.find((item) => Number(item.id_venta) === idVenta);

      clientIdInput.value = String(venta?.id_cliente || "");
      clientDisplay.value = venta?.cliente_nombre || "";
      clienteNitInput.value = venta?.cliente_nit || "";
      clientDisplay.readOnly = true;
      clienteNitInput.readOnly = true;
      clientSelect.hidden = true;
      clientDisplay.hidden = false;
      clientDisplay.classList.add("tx-input-readonly");
      clienteNitInput.classList.add("tx-input-readonly");
      txUpdateConversionMode(rowEl);
      return;
    }

    clientSelect.hidden = false;
    clientDisplay.hidden = true;
    clientDisplay.value = "";
    if (isClientNoRegistered) {
      clientIdInput.value = "";
      clienteNitInput.value = "";
      clientDisplay.value = "Cliente no registrado";
      clientDisplay.readOnly = true;
      clienteNitInput.readOnly = true;
      clientDisplay.classList.add("tx-input-readonly");
      clienteNitInput.classList.add("tx-input-readonly");
    } else {
      clienteNitInput.value = "";
      clientDisplay.readOnly = false;
      clienteNitInput.readOnly = false;
      clientDisplay.classList.remove("tx-input-readonly");
      clienteNitInput.classList.remove("tx-input-readonly");
      clientIdInput.value = clientSelect.value ? String(clientSelect.value.split(":")[1] || "") : "";
    }
    txUpdateConversionMode(rowEl);
  };

  const txCreatePlanRow = (defaults = {}) => {
    if (!txPlanBody) {
      return;
    }

    const row = document.createElement("tr");
    const now = new Date();
    const defaultDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    row.innerHTML = `
      <td><input data-field="fecha" type="datetime-local" value="${txEscapeHtml(defaults.fecha || defaultDate)}" /></td>
      <td>
        <select data-field="venta">
          ${txGetVentaOptionsHtml()}
        </select>
      </td>
      <td>
        <input data-field="nit" type="text" placeholder="NIT" value="${txEscapeHtml(defaults.cliente_nit || "")}" />
      </td>
      <td>
        <select data-field="cliente-select">
          ${txGetClientOptionsHtml()}
        </select>
        <input data-field="cliente-id" type="hidden" value="${txEscapeHtml(defaults.id_cliente || "")}" />
        <input data-field="cliente-display" type="text" placeholder="Nombre cliente" value="${txEscapeHtml(defaults.cliente_nombre || "")}" />
      </td>
      <td><input data-field="valor" type="text" placeholder="0" value="${txEscapeHtml(defaults.valor || "")}" /></td>
      <td>
        <div class="tx-value-stack">
          <select data-field="moneda">
            <option value="COP">COP</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="PAB">PAB</option>
          </select>
          <div class="tx-conversion-wrap is-hidden" data-field="conversion-wrap">
            <label>Conversión al día</label>
            <input data-field="tasa-conversion" type="text" inputmode="decimal" placeholder="Ej: 4000" />
            <small data-field="conversion-hint"></small>
            <small data-field="conversion-preview"></small>
          </div>
        </div>
      </td>
      <td>
        <select data-field="banco">
          ${txGetBancoOptionsHtml()}
        </select>
        <input data-field="id-banco" type="hidden" value="${txEscapeHtml(defaults.id_banco || "")}" />
      </td>
      <td><input data-field="referencia" type="text" placeholder="Referencia" value="${txEscapeHtml(defaults.referencia || "")}" /></td>
      <td><input data-field="descripcion" type="text" placeholder="Descripcion" value="${txEscapeHtml(defaults.descripcion || "")}" /></td>
      <td>
        <button type="button" class="tx-row-remove" title="Eliminar fila">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </td>
    `;

    txPlanBody.appendChild(row);

    const ventaSelect = row.querySelector('[data-field="venta"]');
    const clientSelect = row.querySelector('[data-field="cliente-select"]');
    if (ventaSelect && defaults.id_venta) {
      ventaSelect.value = `venta:${defaults.id_venta}`;
    }
    if (clientSelect && defaults.id_cliente) {
      clientSelect.value = `cliente:${defaults.id_cliente}`;
    }
    txUpdateClientMode(row);

    row.querySelector('[data-field="venta"]')?.addEventListener("change", () => {
      txUpdateClientMode(row);
      txUpdateConversionMode(row);
    });

    row.querySelector('[data-field="moneda"]')?.addEventListener("change", () => {
      txUpdateConversionMode(row);
    });

    row.querySelector('[data-field="valor"]')?.addEventListener("input", () => {
      txUpdateConversionPreview(row);
    });

    row.querySelector('[data-field="tasa-conversion"]')?.addEventListener("input", () => {
      txUpdateConversionPreview(row);
    });

    row.querySelector('[data-field="cliente-select"]')?.addEventListener("change", (event) => {
      const target = event.currentTarget;
      const clientIdInput = row.querySelector('[data-field="cliente-id"]');
      const clienteNitInput = row.querySelector('[data-field="nit"]');
      const clientDisplay = row.querySelector('[data-field="cliente-display"]');
      const selectedCliente = txState.clientesOptions.find((cliente) => `cliente:${cliente.id_cliente}` === String(target?.value || ""));

      if (target?.value === "cliente:no-registrado") {
        if (clientIdInput) {
          clientIdInput.value = "";
        }
        if (clienteNitInput) {
          clienteNitInput.value = "";
          clienteNitInput.readOnly = true;
        }
        if (clientDisplay) {
          clientDisplay.value = "Cliente no registrado";
          clientDisplay.readOnly = true;
        }
        txUpdatePlanPreview();
        return;
      }

      if (clientIdInput) {
        clientIdInput.value = selectedCliente ? String(selectedCliente.id_cliente) : "";
      }
      if (clienteNitInput) {
        clienteNitInput.value = selectedCliente?.identificacion || "";
      }
      if (clientDisplay) {
        clientDisplay.value = selectedCliente?.nombre || "";
      }
    });

    row.querySelector('[data-field="banco"]')?.addEventListener("change", (event) => {
      const target = event.currentTarget;
      const idBancoInput = row.querySelector('[data-field="id-banco"]');
      const rawValue = String(target?.value || "");
      const selectedBanco = rawValue.startsWith("preset:")
        ? txResolvePresetBank(rawValue.split(":")[1])
        : txState.bancosOptions.find((banco) => `banco:${banco.id_banco}` === rawValue);

      if (idBancoInput) {
        idBancoInput.value = selectedBanco ? String(selectedBanco.id_banco) : "";
      }
    });

    row.querySelector(".tx-row-remove")?.addEventListener("click", () => {
      row.remove();
      if (!txPlanBody.children.length) {
        txCreatePlanRow();
      }
      txUpdatePlanPreview();
    });

    row.querySelectorAll("input, select").forEach((field) => {
      field.addEventListener("input", txUpdatePlanPreview);
      field.addEventListener("change", txUpdatePlanPreview);
    });

    txUpdateConversionMode(row);
    txUpdatePlanPreview();
  };

  const txResetPlanRows = (count = 3) => {
    if (!txPlanBody) {
      return;
    }

    txPlanBody.innerHTML = "";
    for (let i = 0; i < count; i++) {
      txCreatePlanRow();
    }

    txUpdatePlanPreview();
  };

  const txCollectPlanRows = () => {
    const rows = Array.from(txPlanBody?.querySelectorAll("tr") || []);
    const payload = [];
    let hasValidationError = false;

    rows.forEach((rowEl) => {
      txMarkRowError(rowEl, false);

      const rawVenta = rowEl.querySelector('[data-field="venta"]')?.value || "sin-venta";
      const fecha = rowEl.querySelector('[data-field="fecha"]')?.value || "";
      const clienteId = rowEl.querySelector('[data-field="cliente-id"]')?.value || "";
      const clienteNit = rowEl.querySelector('[data-field="nit"]')?.value || "";
      const clienteNombre = rowEl.querySelector('[data-field="cliente-display"]')?.value || "";
      const clienteSelectValue = rowEl.querySelector('[data-field="cliente-select"]')?.value || "";
      const valorRaw = rowEl.querySelector('[data-field="valor"]')?.value || "";
      const moneda = rowEl.querySelector('[data-field="moneda"]')?.value || "COP";
      const tasaConversionRaw = rowEl.querySelector('[data-field="tasa-conversion"]')?.value || "";
      const idBanco = rowEl.querySelector('[data-field="id-banco"]')?.value || null;
      const referencia = rowEl.querySelector('[data-field="referencia"]')?.value || "";
      const descripcion = rowEl.querySelector('[data-field="descripcion"]')?.value || "";
      const isGhost =
        rawVenta === "sin-venta" &&
        clienteSelectValue === "cliente:no-registrado" &&
        !txNormalize(clienteId);

      const isEmpty =
        !txNormalize(valorRaw) &&
        !txNormalize(referencia) &&
        !txNormalize(descripcion) &&
        rawVenta === "sin-venta" &&
        !txNormalize(clienteId) &&
        !txNormalize(clienteSelectValue);

      if (isEmpty) {
        return;
      }

      const valor = txParseCurrency(valorRaw);
      const hasVenta = rawVenta.startsWith("venta:");
      const idVenta = hasVenta ? Number.parseInt(rawVenta.split(":")[1], 10) : null;
      const hasClientSelection = Boolean(clienteSelectValue && clienteSelectValue.startsWith("cliente:"));
      const idCliente = hasClientSelection ? Number.parseInt(clienteSelectValue.split(":")[1], 10) : Number.parseInt(clienteId, 10);
      const selectedVenta = hasVenta ? txGetVentaByValue(rawVenta) : null;
      const saleCurrency = String(selectedVenta?.moneda || "").trim().toUpperCase();
      const txCurrency = String(moneda || "COP").trim().toUpperCase();
      const needsConversion = Boolean((hasVenta ? saleCurrency !== txCurrency : txCurrency !== "COP") && txCurrency);
      const tasaConversion = needsConversion ? txParseCurrency(tasaConversionRaw) : 1;

      let valid = true;
      if (!fecha || Number.isNaN(new Date(fecha).getTime())) {
        valid = false;
      }

      if (valor <= 0) {
        valid = false;
      }

      if (!hasVenta && !isGhost && (!Number.isInteger(idCliente) || idCliente <= 0)) {
        valid = false;
      }

      if (hasVenta && !idVenta) {
        valid = false;
      }

      if (needsConversion && tasaConversion <= 0) {
        valid = false;
      }

      if (!valid) {
        txMarkRowError(rowEl, true);
        hasValidationError = true;
        return;
      }

      payload.push({
        fecha,
        id_venta: idVenta,
        id_cliente: hasVenta ? null : idCliente,
        cliente_nit: clienteNit.trim(),
        cliente_nombre: clienteNombre.trim(),
        valor,
        moneda: moneda.trim() || "COP",
        tasa_conversion: needsConversion ? tasaConversion : 1,
        moneda_referencia: needsConversion ? (saleCurrency || "COP") : null,
        id_banco: idBanco ? Number.parseInt(idBanco, 10) : null,
        referencia: referencia.trim(),
        descripcion: descripcion.trim()
      });
    });

    return {
      hasValidationError,
      payload
    };
  };

  const txComputePlanSummary = () => {
    const rows = Array.from(txPlanBody?.querySelectorAll("tr") || []);
    let totalRowsWithData = 0;
    let validRows = 0;
    const currencyTotals = {};

    rows.forEach((rowEl) => {
      const rawVenta = rowEl.querySelector('[data-field="venta"]')?.value || "sin-venta";
      const fecha = rowEl.querySelector('[data-field="fecha"]')?.value || "";
      const clienteId = rowEl.querySelector('[data-field="cliente-id"]')?.value || "";
      const clienteSelectValue = rowEl.querySelector('[data-field="cliente-select"]')?.value || "";
      const clienteNit = rowEl.querySelector('[data-field="nit"]')?.value || "";
      const clienteNombre = rowEl.querySelector('[data-field="cliente-display"]')?.value || "";
      const valorRaw = rowEl.querySelector('[data-field="valor"]')?.value || "";
      const moneda = rowEl.querySelector('[data-field="moneda"]')?.value || "COP";
      const tasaConversionRaw = rowEl.querySelector('[data-field="tasa-conversion"]')?.value || "";
      const isGhost =
        rawVenta === "sin-venta" &&
        clienteSelectValue === "cliente:no-registrado" &&
        !txNormalize(clienteId);

      const isEmpty =
        !txNormalize(valorRaw) &&
        rawVenta === "sin-venta" &&
        !txNormalize(clienteId) &&
        !txNormalize(clienteSelectValue);

      if (isEmpty) {
        return;
      }

      totalRowsWithData++;

      const valor = txParseCurrency(valorRaw);
      const hasVenta = rawVenta.startsWith("venta:");
      const idVenta = hasVenta ? Number.parseInt(rawVenta.split(":")[1], 10) : null;
      const hasClientSelection = Boolean(clienteSelectValue && clienteSelectValue.startsWith("cliente:"));
      const idCliente = hasClientSelection ? Number.parseInt(clienteSelectValue.split(":")[1], 10) : Number.parseInt(clienteId, 10);
      const selectedVenta = hasVenta ? txGetVentaByValue(rawVenta) : null;
      const saleCurrency = String(selectedVenta?.moneda || "").trim().toUpperCase();
      const txCurrency = String(moneda || "COP").trim().toUpperCase();
      const needsConversion = Boolean((hasVenta ? saleCurrency !== txCurrency : txCurrency !== "COP") && txCurrency);
      const tasaConversion = needsConversion ? txParseCurrency(tasaConversionRaw) : 1;

      const isValid =
        Boolean(fecha && !Number.isNaN(new Date(fecha).getTime())) &&
        valor > 0 &&
        (isGhost || hasVenta || Number.isInteger(idCliente) && idCliente > 0) &&
        (!hasVenta || Boolean(idVenta)) &&
        (!needsConversion || tasaConversion > 0);

      if (isValid) {
        validRows++;
        const currencyCode = txCurrency || "COP";
        currencyTotals[currencyCode] = Number(currencyTotals[currencyCode] || 0) + Number(valor || 0);
      }
    });

    return {
      totalRowsWithData,
      validRows,
      invalidRows: Math.max(totalRowsWithData - validRows, 0),
      currencyTotals
    };
  };

  const txUpdatePlanPreview = () => {
    const summary = txComputePlanSummary();

    if (txPlanTotalPreview) {
      txPlanTotalPreview.textContent = String(summary.validRows);
    }

    if (txPlanTotalMeta) {
      if (summary.totalRowsWithData === 0) {
        txPlanTotalMeta.textContent = "0 filas válidas";
      } else if (summary.invalidRows > 0) {
        txPlanTotalMeta.textContent = `${summary.validRows} listas y ${summary.invalidRows} por corregir`;
      } else {
        txPlanTotalMeta.textContent = `${summary.validRows} filas válidas`;
      }
    }

    if (txPlanTotalBox) {
      txPlanTotalBox.classList.toggle("has-warning", summary.invalidRows > 0);
    }

    if (txPlanTotalBreakdown) {
      const currencies = Object.keys(summary.currencyTotals).sort();

      if (!currencies.length) {
        txPlanTotalBreakdown.innerHTML = "";
      } else {
        txPlanTotalBreakdown.innerHTML = currencies
          .map((code) => {
            const amount = txPlanAmountFormatter.format(Number(summary.currencyTotals[code] || 0));
            return `<span class="tx-plan-total-chip"><span class="tx-plan-total-chip-code">${txEscapeHtml(code)}</span><span>${txEscapeHtml(amount)}</span></span>`;
          })
          .join("");
      }
    }
  };

  const txRenderTable = (rows) => {
    if (!txTableHead || !txTableBody) {
      return;
    }

    const columns = [...txTableColumns, txActionColumn];
    txTableHead.innerHTML = `<tr>${columns.map((col) => `<th>${txEscapeHtml(col)}</th>`).join("")}</tr>`;

    if (!rows.length) {
      txTableBody.innerHTML = `<tr><td class="ventas-empty" colspan="${columns.length}">No hay transacciones para mostrar.</td></tr>`;
      return;
    }

    txTableBody.innerHTML = rows
      .map((row) => {
        const idAttr = txEscapeHtml(String(row.id_transaccion ?? ""));
        const fecha = row.fecha ? new Date(row.fecha).toLocaleDateString("es-CO") : "";

        const key = (col) => txEscapeHtml(col);
        const money = (val) => txMoneyFormatter.format(Number(val || 0));

        const idCell = `<td data-col="${key("ID Transacción")}"><strong>#${idAttr}</strong></td>`;
        const clienteCell = `<td data-col="${key("Cliente")}">${txEscapeHtml(row.cliente_nombre || "")}</td>`;
        const nitCell = `<td data-col="${key("NIT")}">${txEscapeHtml(row.cliente_nit || "")}</td>`;
        const fechaCell = `<td data-col="${key("Fecha")}">${txEscapeHtml(fecha)}</td>`;

        const desc = row.descripcion || row.nombre || "-";
        const ref = row.referencia || "";
        const descHtml = ref
          ? `${txEscapeHtml(desc)}<br/><small class="text-slate-500">Ref: ${txEscapeHtml(ref)}</small>`
          : txEscapeHtml(desc);
        const descCell = `<td data-col="${key("Descripcion")}">${descHtml}</td>`;

        const bancoCell = `<td data-col="${key("Banco")}">${txEscapeHtml(row.banco_nombre || "-")}</td>`;
        const monedaCell = `<td data-col="${key("Moneda")}"><strong>${txEscapeHtml(String(row.moneda || "-").toUpperCase())}</strong></td>`;
        const valorCell = `<td data-col="${key("Valor")}" class="font-bold text-right">${txEscapeHtml(money(row.valor))}</td>`;
        const aplicadoCell = `<td data-col="${key("Aplicado")}" class="text-green-600 font-bold text-right">${txEscapeHtml(money(row.total_aplicado))}</td>`;
        const saldoCell = `<td data-col="${key("Saldo")}" class="text-red-600 font-bold text-right">${txEscapeHtml(money(row.saldo_transaccion))}</td>`;

        const dataCells = [
          idCell,
          clienteCell,
          nitCell,
          fechaCell,
          descCell,
          bancoCell,
          monedaCell,
          valorCell,
          aplicadoCell,
          saldoCell
        ].join("");

        const actionCell = `
          <td class="row-actions-cell">
            <div class="row-actions" aria-label="Acciones">
              <button type="button" class="icon-btn" data-action="edit" title="Editar" aria-label="Editar">
                <span class="material-symbols-outlined">edit</span>
              </button>
              <button type="button" class="icon-btn icon-btn-danger" data-action="delete" title="Borrar" aria-label="Borrar">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
          </td>`;

        return `<tr class="ventas-row" data-id="${idAttr}" tabindex="0" role="button">${dataCells}${actionCell}</tr>`;
      })
      .join("");
  };

  const txRefreshKpis = (rows) => {
    const total = rows.length;
    const totalAplicado = rows.reduce((acc, row) => acc + Number(row.total_aplicado || 0), 0);
    const totalSaldo = rows.reduce((acc, row) => acc + Number(row.saldo_transaccion || 0), 0);

    if (txKpiTotal) {
      txKpiTotal.textContent = String(total);
    }

    if (txKpiAplicado) {
      txKpiAplicado.textContent = txMoneyFormatter.format(totalAplicado);
    }

    if (txKpiSaldo) {
      txKpiSaldo.textContent = txMoneyFormatter.format(totalSaldo);
    }
  };

  const closeTxDetailModal = () => {
    if (txDetailModal) {
      txDetailModal.classList.remove("is-open");
      txDetailModal.setAttribute("aria-hidden", "true");
    }

    txDetailCurrentId = null;
    txDetailCurrentClientId = null;

    if (prevFocusedElementForTxDetail) {
      prevFocusedElementForTxDetail.focus();
    }
  };

  const openTransaccionDashboard = async (idTransaccion) => {
    if (!txDetailModal) {
      return;
    }

    prevFocusedElementForTxDetail = document.activeElement;

    try {
      const response = await apiFetch(`/api/transacciones/${idTransaccion}/detalle`);
      if (!response.ok) {
        alert("Error al cargar detalle de transacción");
        return;
      }

      const result = await response.json();
      const { transaccion, aplicaciones } = result.data;
      txDetailCurrentId = Number(idTransaccion);
      txDetailCurrentClientId = Number(transaccion?.id_cliente || 0) || null;

      // Fill in transaction details
      const titleEl = document.getElementById("tx-detail-title");
      const subtitleEl = document.getElementById("tx-detail-subtitle");
      const fechaEl = document.getElementById("tx-detail-fecha");
      const clienteEl = document.getElementById("tx-detail-cliente");
      const valorEl = document.getElementById("tx-detail-valor");
      const monedaEl = document.getElementById("tx-detail-moneda");
      const tipoCambioEl = document.getElementById("tx-detail-tipo-cambio");
      const monedaReferenciaEl = document.getElementById("tx-detail-moneda-referencia");
      const valorEquivalenteEl = document.getElementById("tx-detail-valor-equivalente");
      const bancoEl = document.getElementById("tx-detail-banco");
      const referenciaEl = document.getElementById("tx-detail-referencia");
      const documentoEl = document.getElementById("tx-detail-documento");
      const soporteEl = document.getElementById("tx-detail-soporte");
      const descripcionEl = document.getElementById("tx-detail-descripcion");
      const aplicacionesTbody = document.getElementById("tx-detail-aplicaciones-body");

      if (titleEl) {
        titleEl.textContent = "Detalle de la Transacción";
      }

      if (subtitleEl) {
        subtitleEl.textContent = `${transaccion.cliente_nombre} (${transaccion.cliente_nit})`;
      }

      if (fechaEl) {
        fechaEl.textContent = transaccion.fecha ? new Date(transaccion.fecha).toLocaleString("es-CO") : "";
      }

      if (clienteEl) {
        clienteEl.textContent = `${transaccion.cliente_nombre} (${transaccion.cliente_nit})`;
      }

      if (valorEl) {
        valorEl.textContent = txFormatAmountWithCurrency(Number(transaccion.valor || 0), transaccion.moneda || "");
      }

      if (monedaEl) {
        monedaEl.textContent = transaccion.moneda || "";
      }

      if (tipoCambioEl) {
        const tipoCambio = Number(transaccion.tipo_cambio || 0);
        tipoCambioEl.textContent = tipoCambio > 0 ? txFormatRate(tipoCambio) : "-";
      }

      if (monedaReferenciaEl) {
        monedaReferenciaEl.textContent = transaccion.moneda_referencia || "-";
      }

      if (valorEquivalenteEl) {
        const valorEquivalente = Number(transaccion.valor_equivalente || 0);
        const monedaReferencia = String(transaccion.moneda_referencia || "").trim().toUpperCase();
        valorEquivalenteEl.textContent = valorEquivalente > 0 && monedaReferencia ? txFormatAmountWithCurrency(valorEquivalente, monedaReferencia) : "-";
      }

      if (bancoEl) {
        bancoEl.textContent = transaccion.banco_nombre || "-";
      }

      if (referenciaEl) {
        referenciaEl.textContent = transaccion.referencia || "-";
      }

      if (documentoEl) {
        documentoEl.textContent = transaccion.documento || "-";
      }

      if (soporteEl) {
        soporteEl.textContent = transaccion.soporte || "-";
      }

      if (descripcionEl) {
        descripcionEl.textContent = transaccion.descripcion || "(Sin descripción)";
      }

      // Render aplicaciones table
      if (aplicacionesTbody) {
        if (aplicaciones && aplicaciones.length > 0) {
          aplicacionesTbody.innerHTML = aplicaciones
            .map((app) => {
              const valorVenta = Number(app.valor_aplicado || 0);
              const valorTx = Number(app.valor_aplicado_transaccion ?? app.valor_aplicado ?? 0);
              const tasa = Number(app.tipo_cambio || 1);
              const monedaVenta = String(app.moneda_venta || transaccion.moneda || "").toUpperCase();
              const monedaTx = String(transaccion.moneda || "").toUpperCase();
              const tasaLabel = monedaVenta && monedaTx ? `1 ${monedaTx} = ${txFormatRate(tasa)} ${monedaVenta}` : txFormatRate(tasa);
              return `
                <tr>
                  <td>${app.id_venta}</td>
                  <td>${txEscapeHtml(app.comprobante || "Sin comprobante")}</td>
                  <td>${txEscapeHtml(app.cliente_venta_nombre || "")}</td>
                  <td>${txFormatAmountWithCurrency(valorVenta, monedaVenta)}</td>
                  <td>${txFormatAmountWithCurrency(valorTx, monedaTx)}</td>
                  <td>${txEscapeHtml(tasaLabel)}</td>
                </tr>
              `;
            })
            .join("");
        } else {
          aplicacionesTbody.innerHTML = '<tr><td colspan="6">Sin aplicaciones registradas</td></tr>';
        }
      }

      // Show modal
      txDetailModal.classList.add("is-open");
      txDetailModal.setAttribute("aria-hidden", "false");

      // Handle keyboard navigation within modal
      const handleTxDetailKeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeTxDetailModal();
          txDetailModal.removeEventListener("keydown", handleTxDetailKeydown);
        }
      };

      txDetailModal.addEventListener("keydown", handleTxDetailKeydown);
    } catch (error) {
      alert(`Error al cargar detalle: ${error.message}`);
    }
  };

  const txApplyFilter = () => {
    const query = txNormalize(txFilterGlobal?.value || "");
    const filtered = txState.records.filter((row) => {
      if (!query) return true;

      const haystack = txNormalize(
        [
          row.id_transaccion,
          row.cliente_nombre,
          row.cliente_nit,
          row.fecha,
          row.banco_nombre,
          row.referencia,
          row.descripcion,
          row.ventas_aplicadas,
          row.moneda,
          row.valor,
          row.total_aplicado,
          row.saldo_transaccion
        ]
          .filter(Boolean)
          .join(" ")
      );

      const passQuery = !query || haystack.includes(query);

      return passQuery;
    });

    txRenderTable(filtered);
    txRefreshKpis(filtered);
  };

  const txLoadVentasOptions = async () => {
    const response = await apiFetch("/api/ventas/opciones-transaccion");
    if (!response.ok) {
      throw new Error(`No se pudieron cargar ventas (${response.status})`);
    }

    const payload = await response.json();
    txState.ventasOptions = Array.isArray(payload.data) ? payload.data : [];
  };

  const txLoadClientesOptions = async () => {
    const response = await apiFetch("/api/clientes");
    if (!response.ok) {
      throw new Error(`No se pudieron cargar clientes (${response.status})`);
    }

    const payload = await response.json();
    txState.clientesOptions = Array.isArray(payload.data) ? payload.data : [];
  };

  const txLoadBancosOptions = async () => {
    const response = await apiFetch("/api/bancos");
    if (!response.ok) {
      throw new Error(`No se pudieron cargar bancos (${response.status})`);
    }

    const payload = await response.json();
    txState.bancosOptions = Array.isArray(payload.data) ? payload.data : [];

    // Update any existing banco <select> elements in the plan rows so they reflect the fixed UI options
    try {
      const optsHtml = txGetBancoOptionsHtml();
      document.querySelectorAll('#tx-plan-body [data-field="banco"]').forEach((sel) => {
        const row = sel.closest('tr');
        const idBancoInput = row ? row.querySelector('[data-field="id-banco"]') : null;
        const prevValue = idBancoInput ? String(idBancoInput.value || "") : "";
        sel.innerHTML = optsHtml;

        const previousBank = txState.bancosOptions.find((banco) => String(banco.id_banco) === prevValue);
        const matchedPreset = txBankPresets.find((preset) => {
          const aliases = preset.aliases.map(txNormalizeBankName);
          const nombre = txNormalizeBankName(previousBank?.nombre);
          const codigo = txNormalizeBankName(previousBank?.codigo);
          return aliases.some((alias) => nombre.includes(alias) || codigo.includes(alias));
        });

        if (prevValue) {
          sel.value = matchedPreset ? `preset:${matchedPreset.key}` : "";
        } else {
          sel.value = "";
        }
      });
    } catch (e) {
      // silently ignore DOM update errors
    }
  };

  const txLoadTransacciones = async () => {
    if (txTableBody) {
      txTableBody.innerHTML = `<tr><td class="ventas-empty" colspan="${txTableColumns.length + 1}">Cargando transacciones...</td></tr>`;
    }

    const response = await apiFetch("/api/transacciones");
    if (!response.ok) {
      throw new Error(`No se pudieron cargar transacciones (${response.status})`);
    }

    const payload = await response.json();
    txState.records = Array.isArray(payload.data) ? payload.data : [];
    txApplyFilter();
  };

  const txShowResults = (result) => {
    if (txResultTotal) {
      txResultTotal.textContent = String(result.total || 0);
    }
    if (txResultOk) {
      txResultOk.textContent = String(result.inserted || 0);
    }
    if (txResultError) {
      txResultError.textContent = String(result.failed || 0);
    }

    if (txResultLog) {
      const lines = [];
      lines.push(`Total: ${result.total || 0}`);
      lines.push(`Guardadas: ${result.inserted || 0}`);
      if (Number(result.queued || 0) > 0) {
        lines.push(`En bandeja fantasma: ${result.queued || 0}`);
      }
      lines.push(`Errores: ${result.failed || 0}`);

      (result.warnings || []).forEach((item) => {
        lines.push(`ADVERTENCIA fila ${item.row}: ${item.message}`);
      });

      (result.errors || []).forEach((item) => {
        lines.push(`ERROR fila ${item.row}: ${item.error}`);
      });

      txResultLog.innerHTML = lines.map((line) => `<p style="margin: 0 0 0.4rem 0;">${txEscapeHtml(line)}</p>`).join("");
    }

    if (txResultsModal) {
      txResultsModal.classList.add("is-open");
      txResultsModal.setAttribute("aria-hidden", "false");
    }
  };

  const txCloseResults = () => {
    if (txResultsModal) {
      txResultsModal.classList.remove("is-open");
      txResultsModal.setAttribute("aria-hidden", "true");
    }
  };

  txAddRowButton?.addEventListener("click", () => {
    txCreatePlanRow();
  });

  txAddFiveRowsButton?.addEventListener("click", () => {
    for (let i = 0; i < 5; i++) {
      txCreatePlanRow();
    }
  });

  txClearRowsButton?.addEventListener("click", () => {
    txResetPlanRows(3);
    if (txPlanStatus) {
      txPlanStatus.textContent = "Planilla reiniciada.";
    }
  });

  txCancelModalButton?.addEventListener("click", () => {
    closeModal();
  });

  txFilterGlobal?.addEventListener("input", txApplyFilter);

  txCloseResultsButton?.addEventListener("click", txCloseResults);
  txResultsOkButton?.addEventListener("click", txCloseResults);
  txResultsModal?.addEventListener("click", (event) => {
    if (event.target === txResultsModal) {
      txCloseResults();
    }
  });

  closeTxDetailBtn?.addEventListener("click", closeTxDetailModal);
  txDetailModal?.addEventListener("click", (event) => {
    if (event.target === txDetailModal) {
      closeTxDetailModal();
    }
  });

  txGhostCloseButton?.addEventListener("click", txCloseGhostModal);
  txGhostCancelButton?.addEventListener("click", txCloseGhostModal);
  txGhostModal?.addEventListener("click", (event) => {
    if (event.target === txGhostModal) {
      txCloseGhostModal();
    }
  });

  txGhostClienteSelect?.addEventListener("change", () => {
    txUpdateGhostSaleOptions();
  });

  txGhostVentaSelect?.addEventListener("change", () => {
    txUpdateGhostSaleOptions();
  });

  txGhostFilter?.addEventListener("change", () => {
    txLoadGhosts().catch((error) => {
      if (txPlanStatus) {
        txPlanStatus.textContent = `No fue posible actualizar las transacciones fantasma: ${error.message}`;
      }
    });
  });

  txGhostResolveButton?.addEventListener("click", txResolveGhost);

  txGhostTableBody?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[data-action='resolve-ghost']");
    if (!button) return;
    const idFantasma = Number.parseInt(button.getAttribute("data-ghost-id") || "", 10);
    const ghost = txState.ghosts.find((item) => Number(item.id_fantasma) === idFantasma);
    if (ghost) {
      txOpenGhostModal(ghost);
    }
  });

  openModalButton?.addEventListener("click", () => {
    if (!txPlanBody?.children.length) {
      txResetPlanRows(3);
    }
    txUpdatePlanPreview();
  });

  txSavePlanButton?.addEventListener("click", async () => {
    const { hasValidationError, payload } = txCollectPlanRows();

    if (hasValidationError) {
      if (txPlanStatus) {
        txPlanStatus.textContent = "Hay filas con errores. Revisa fecha, valor y la asignacion de cliente/venta cuando aplique.";
      }
      return;
    }

    if (!payload.length) {
      if (txPlanStatus) {
        txPlanStatus.textContent = "No hay filas con datos para guardar.";
      }
      return;
    }

    if (txPlanStatus) {
      txPlanStatus.textContent = `Guardando ${payload.length} transacciones...`;
    }

    try {
      const response = await apiFetch("/api/transacciones/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ rows: payload })
      });

      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(result.message || "No fue posible guardar transacciones");
      }

      txShowResults(result);

      if (txPlanStatus) {
        txPlanStatus.textContent = `${result.inserted} transacciones guardadas${result.queued ? `, ${result.queued} en bandeja fantasma` : ""}. ${result.failed} con error.`;
      }

      if (result.inserted > 0 || result.queued > 0) {
        await Promise.all([txLoadTransacciones(), txLoadGhosts(), txLoadVentasOptions(), txLoadClientesOptions(), txLoadBancosOptions()]);
        txResetPlanRows(3);
        closeModal();
      }
    } catch (error) {
      if (txPlanStatus) {
        txPlanStatus.textContent = `Error al guardar: ${error.message}`;
      }
    }
  });

  (async () => {
    try {
      await Promise.all([txLoadVentasOptions(), txLoadClientesOptions(), txLoadBancosOptions(), txLoadTransacciones(), txLoadGhosts()]);
      txResetPlanRows(3);
    } catch (error) {
      if (txTableBody) {
        txTableBody.innerHTML = `<tr><td class="ventas-empty" colspan="8">${txEscapeHtml(
          `No fue posible cargar la informacion: ${error.message}`
        )}</td></tr>`;
      }

      if (txPlanStatus) {
        txPlanStatus.textContent = `No fue posible cargar ventas para el plan: ${error.message}`;
      }
    }
  })();

  // Delegated handlers for Transacciones table
  txTableBody?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[data-action]");
    const tr = event.target?.closest?.("tr[data-id]");
    if (!tr) {
      return;
    }

    if (button) {
      event.preventDefault();
      event.stopPropagation();
      const action = button.getAttribute("data-action");
      if (action === "edit") {
        txStartEditMode(tr);
      } else if (action === "cancel") {
        txExitEditMode();
      } else if (action === "save") {
        txSaveEdit(tr);
      } else if (action === "delete") {
        txDeleteRow(tr);
      }
      return;
    }

    const id = tr.getAttribute("data-id");
    if (id && !tr.classList.contains("is-editing")) {
      openTransaccionDashboard(Number.parseInt(id, 10));
    }
  });

  txTableBody?.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!target) {
      return;
    }

    if (target.tagName === "BUTTON" || target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") {
      return;
    }

    const tr = target.closest?.("tr[data-id]");
    if (!tr || tr.classList.contains("is-editing")) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const id = tr.getAttribute("data-id");
      openTransaccionDashboard(Number.parseInt(id, 10));
    }
  });
}

const homePage = document.getElementById("home-page");

if (homePage) {
  const homeMoneyFormatter = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  });

  const homePercentFormatter = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0
  });

  const homeState = {
    ventas: [],
    transacciones: [],
    charts: {
      trend: null,
      balance: null,
      mix: null
    },
    lastUpdatedAt: null,
    sourceLabel: "Cargando datos...",
    snapshot: null
  };

  const homeElements = {
    sourcePill: document.getElementById("home-source-pill"),
    healthScore: document.getElementById("home-health-score"),
    healthCaption: document.getElementById("home-health-caption"),
    lastUpdate: document.getElementById("home-last-update"),
    lastUpdateDetail: document.getElementById("home-last-update-detail"),
    averageTicket: document.getElementById("home-average-ticket"),
    averageTicketDetail: document.getElementById("home-average-ticket-detail"),
    topClient: document.getElementById("home-top-client"),
    topBank: document.getElementById("home-top-bank"),
    kpiVentas: document.getElementById("home-kpi-ventas"),
    kpiVentasMeta: document.getElementById("home-kpi-ventas-meta"),
    kpiTransacciones: document.getElementById("home-kpi-transacciones"),
    kpiTransaccionesMeta: document.getElementById("home-kpi-transacciones-meta"),
    kpiRecaudo: document.getElementById("home-kpi-recaudo"),
    kpiRecaudoMeta: document.getElementById("home-kpi-recaudo-meta"),
    kpiSaldo: document.getElementById("home-kpi-saldo"),
    kpiSaldoMeta: document.getElementById("home-kpi-saldo-meta"),
    progressBar: document.getElementById("home-progress-bar"),
    feedList: document.getElementById("home-feed-list"),
    feedCount: document.getElementById("home-feed-count"),
    flowChip: document.getElementById("home-flow-chip"),
    refreshButton: document.getElementById("refresh-dashboard"),
    exportButton: document.getElementById("show-toast")
  };

  const normalizeText = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const parseCurrencyValue = (value) => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    let text = String(value || "").trim();
    if (!text) {
      return 0;
    }

    text = text.replace(/\s+/g, "").replace(/\$/g, "").replace(/€|COP|USD/gi, "");

    const lastDot = text.lastIndexOf(".");
    const lastComma = text.lastIndexOf(",");

    if (lastDot > -1 && lastComma > -1) {
      if (lastComma > lastDot) {
        text = text.replace(/\./g, "").replace(/,/g, ".");
      } else {
        text = text.replace(/,/g, "");
      }
    } else if (lastComma > -1) {
      text = text.replace(/\./g, "").replace(/,/g, ".");
    } else if (lastDot > -1) {
      const dotParts = text.split(".");
      const hasThousandGrouping = dotParts.length > 1 && dotParts.every((part, index) => {
        if (index === 0) {
          return /^\d+$/.test(part);
        }
        return /^\d{3}$/.test(part);
      });

      if (hasThousandGrouping) {
        text = dotParts.join("");
      }
    }

    const amount = Number.parseFloat(text);
    return Number.isFinite(amount) ? amount : 0;
  };

  const parseDateValue = (value) => {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const formatShortDateTime = (value) => {
    const date = value instanceof Date ? value : parseDateValue(value);
    if (!date) {
      return "--";
    }

    return date.toLocaleString("es-CO", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const animateNumber = (element, target, formatter, duration = 900) => {
    if (!element) {
      return;
    }

    const startValue = Number.parseFloat(String(element.dataset.current || "0")) || 0;
    const endValue = Number(target) || 0;
    const startTime = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const value = startValue + (endValue - startValue) * progress;
      element.textContent = formatter(value);
      element.dataset.current = String(value);

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  };

  const chartColors = {
    navy: "rgba(16, 42, 71, 0.92)",
    coral: "rgba(229, 17, 72, 0.92)",
    sky: "rgba(15, 124, 195, 0.9)",
    mint: "rgba(15, 139, 95, 0.9)",
    gold: "rgba(226, 166, 31, 0.92)",
    lilac: "rgba(103, 102, 210, 0.9)"
  };

  const getMonthKey = (date) => {
    if (!date) {
      return null;
    }

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };

  const getMonthLabel = (date) =>
    date.toLocaleDateString("es-CO", {
      month: "short"
    });

  const getLastMonths = (count) => {
    const months = [];
    const now = new Date();

    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      months.push({
        key: getMonthKey(date),
        label: getMonthLabel(date)
      });
    }

    return months;
  };

  const buildMonthlyBuckets = (records, dateGetter, valueGetter) => {
    const months = getLastMonths(6);
    const buckets = months.map((month) => ({
      ...month,
      value: 0
    }));

    records.forEach((record) => {
      const date = dateGetter(record);
      const key = getMonthKey(date);
      const bucket = buckets.find((item) => item.key === key);
      if (bucket) {
        bucket.value += valueGetter(record);
      }
    });

    return buckets;
  };

  const buildCategorySeries = (records, getter, fallbackLabel) => {
    const values = new Map();

    records.forEach((record) => {
      const raw = normalizeText(getter(record)) || fallbackLabel;
      const current = values.get(raw) || 0;
      values.set(raw, current + 1);
    });

    const entries = Array.from(values.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5);

    if (!entries.length) {
      return [{ label: fallbackLabel, value: 1 }];
    }

    return entries.map(([label, value]) => ({ label, value }));
  };

  const ensureChartDefaults = () => {
    if (!window.Chart) {
      return;
    }

    window.Chart.defaults.font.family = "Outfit, sans-serif";
    window.Chart.defaults.color = "#56708a";
    window.Chart.defaults.animation.duration = 800;
  };

  const destroyChart = (chart) => {
    if (!chart) {
      return null;
    }

    try {
      chart.destroy();
    } catch (error) {
      // ignore chart teardown errors
    }

    return null;
  };

  const createGradient = (ctx, left, right) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, left);
    gradient.addColorStop(1, right);
    return gradient;
  };

  const loadVentas = async () => {
    const response = await apiFetch("/api/ventas");
    if (!response.ok) {
      throw new Error(`Ventas no disponibles (${response.status})`);
    }

    const payload = await response.json();
    return Array.isArray(payload.data) ? payload.data : [];
  };

  const loadTransacciones = async () => {
    const response = await apiFetch("/api/transacciones");
    if (!response.ok) {
      throw new Error(`Transacciones no disponibles (${response.status})`);
    }

    const payload = await response.json();
    return Array.isArray(payload.data) ? payload.data : [];
  };

  const buildSnapshot = (ventas, transacciones, fallbackMode) => {
    const totalVentas = ventas.reduce((acc, venta) => acc + parseCurrencyValue(venta.total), 0);
    const totalTransacciones = transacciones.reduce((acc, tx) => acc + parseCurrencyValue(tx.valor), 0);
    const totalAplicado = transacciones.reduce((acc, tx) => acc + parseCurrencyValue(tx.total_aplicado), 0);
    const totalSaldo = transacciones.reduce((acc, tx) => acc + parseCurrencyValue(tx.saldo_transaccion), 0);
    const coverage = totalAplicado + totalSaldo > 0 ? totalAplicado / (totalAplicado + totalSaldo) : 0;
    const averageTicket = ventas.length ? totalVentas / ventas.length : 0;

    const salesByMonth = buildMonthlyBuckets(
      ventas,
      (venta) => parseDateValue(venta.fecha_elaboracion || venta.created_at),
      (venta) => parseCurrencyValue(venta.total)
    );

    const txByMonth = buildMonthlyBuckets(
      transacciones,
      (tx) => parseDateValue(tx.fecha),
      (tx) => parseCurrencyValue(tx.valor)
    );

    const stateCounts = buildCategorySeries(
      ventas,
      (venta) => venta.estado_envio_correo || "sin estado",
      "sin estado"
    );

    const bankCounts = buildCategorySeries(
      transacciones,
      (tx) => tx.banco_nombre || "sin banco",
      "sin banco"
    );

    const clientFrequency = new Map();
    ventas.forEach((venta) => {
      const key = venta.cliente_nombre || venta.cliente_nit || "Sin cliente";
      clientFrequency.set(key, (clientFrequency.get(key) || 0) + 1);
    });

    const topClient = Array.from(clientFrequency.entries())
      .sort((left, right) => right[1] - left[1])[0]?.[0] || "Sin cliente";

    const topBank = bankCounts[0]?.label || "Sin banco";

    const recentFeed = [...ventas.map((venta) => ({
      kind: "venta",
      date: parseDateValue(venta.created_at || venta.fecha_elaboracion),
      title: venta.cliente_nombre || venta.comprobante || "Venta registrada",
      subtitle: `${venta.comprobante || "Sin comprobante"} · ${venta.estado_envio_correo || "sin estado"}`,
      amount: parseCurrencyValue(venta.total),
      meta: venta.moneda || "COP"
    })), ...transacciones.map((tx) => ({
      kind: "transaccion",
      date: parseDateValue(tx.fecha),
      title: tx.cliente_nombre || tx.referencia || "Transaccion registrada",
      subtitle: `${tx.referencia || "Sin referencia"} · ${tx.banco_nombre || "Sin banco"}`,
      amount: parseCurrencyValue(tx.valor),
      meta: tx.moneda || "COP"
    }))]
      .filter((item) => item.date)
      .sort((left, right) => right.date - left.date)
      .slice(0, 6);

    return {
      fallbackMode,
      totalVentas,
      totalTransacciones,
      totalAplicado,
      totalSaldo,
      coverage,
      averageTicket,
      salesCount: ventas.length,
      txCount: transacciones.length,
      topClient,
      topBank,
      salesByMonth,
      txByMonth,
      stateCounts,
      bankCounts,
      recentFeed,
      generatedAt: new Date()
    };
  };

  const formatMoneyCompact = (value) => homeMoneyFormatter.format(Number(value) || 0);

  const renderCharts = (snapshot) => {
    if (!window.Chart) {
      return;
    }

    ensureChartDefaults();

    const trendCanvas = document.getElementById("home-trend-chart");
    const balanceCanvas = document.getElementById("home-balance-chart");
    const mixCanvas = document.getElementById("home-mix-chart");

    homeState.charts.trend = destroyChart(homeState.charts.trend);
    homeState.charts.balance = destroyChart(homeState.charts.balance);
    homeState.charts.mix = destroyChart(homeState.charts.mix);

    if (trendCanvas) {
      const ctx = trendCanvas.getContext("2d");
      homeState.charts.trend = new window.Chart(ctx, {
        type: "bar",
        data: {
          labels: snapshot.salesByMonth.map((item) => item.label),
          datasets: [
            {
              label: "Ventas",
              data: snapshot.salesByMonth.map((item) => item.value),
              backgroundColor: createGradient(ctx, "rgba(16, 42, 71, 0.95)", "rgba(16, 42, 71, 0.2)"),
              borderRadius: 16,
              borderSkipped: false
            },
            {
              label: "Transacciones",
              data: snapshot.txByMonth.map((item) => item.value),
              backgroundColor: createGradient(ctx, "rgba(229, 17, 72, 0.95)", "rgba(229, 17, 72, 0.18)"),
              borderRadius: 16,
              borderSkipped: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: "index",
            intersect: false
          },
          plugins: {
            legend: {
              position: "bottom",
              align: "start",
              labels: {
                usePointStyle: true,
                pointStyle: "circle",
                boxWidth: 8,
                boxHeight: 8,
                padding: 18
              }
            },
            tooltip: {
              callbacks: {
                label(context) {
                  return `${context.dataset.label}: ${formatMoneyCompact(context.parsed.y)}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: {
                display: false
              }
            },
            y: {
              beginAtZero: true,
              ticks: {
                callback(value) {
                  return formatMoneyCompact(value);
                }
              }
            }
          }
        }
      });
    }

    if (balanceCanvas) {
      const ctx = balanceCanvas.getContext("2d");
      homeState.charts.balance = new window.Chart(ctx, {
        type: "doughnut",
        data: {
          labels: ["Recaudado", "Pendiente"],
          datasets: [
            {
              data: [snapshot.totalAplicado, snapshot.totalSaldo || 0],
              backgroundColor: [chartColors.mint, chartColors.coral],
              borderWidth: 0,
              hoverOffset: 8,
              cutout: "68%"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                usePointStyle: true,
                pointStyle: "circle"
              }
            },
            tooltip: {
              callbacks: {
                label(context) {
                  return `${context.label}: ${formatMoneyCompact(context.parsed)}`;
                }
              }
            }
          }
        }
      });
    }

    if (mixCanvas) {
      const ctx = mixCanvas.getContext("2d");
      const stateData = snapshot.stateCounts;
      const bankData = snapshot.bankCounts;
      const combinedLabels = [
        ...stateData.map((item) => `Correo: ${item.label}`),
        ...bankData.map((item) => `Banco: ${item.label}`)
      ];
      const combinedValues = [...stateData.map((item) => item.value), ...bankData.map((item) => item.value)];
      const combinedColors = [chartColors.sky, chartColors.gold, chartColors.lilac, chartColors.navy, chartColors.coral, chartColors.mint, chartColors.sky, chartColors.gold];

      homeState.charts.mix = new window.Chart(ctx, {
        type: "doughnut",
        data: {
          labels: combinedLabels,
          datasets: [
            {
              data: combinedValues,
              backgroundColor: combinedColors.slice(0, combinedValues.length),
              borderWidth: 0,
              hoverOffset: 8,
              cutout: "64%"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                usePointStyle: true,
                pointStyle: "circle",
                boxWidth: 8,
                boxHeight: 8
              }
            }
          }
        }
      });
    }
  };

  const renderFeed = (snapshot) => {
    const feedList = homeElements.feedList;
    if (!feedList) {
      return;
    }

    if (!snapshot.recentFeed.length) {
      feedList.innerHTML = '<div class="home-feed-empty">No hay movimientos suficientes para mostrar la consola.</div>';
      return;
    }

    feedList.innerHTML = snapshot.recentFeed
      .map((item) => {
        const badgeClass = item.kind === "venta" ? "feed-badge-sale" : "feed-badge-tx";
        const icon = item.kind === "venta" ? "paid" : "sync_alt";

        return `
          <article class="feed-item">
            <div class="feed-badge ${badgeClass}">
              <span class="material-symbols-outlined">${icon}</span>
            </div>
            <div class="feed-main">
              <strong>${String(item.title || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</strong>
              <span>${String(item.subtitle || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</span>
            </div>
            <div class="feed-meta">
              <strong>${formatMoneyCompact(item.amount)}</strong>
              <span>${formatShortDateTime(item.date)} · ${String(item.meta || "").toUpperCase()}</span>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const syncHome = async (forceFallback = false) => {
    if (homeElements.sourcePill) {
      homeElements.sourcePill.textContent = "Actualizando datos...";
    }

    try {
      const [ventas, transacciones] = forceFallback
        ? [[], []]
        : await Promise.all([loadVentas(), loadTransacciones()]);

      const hasData = ventas.length > 0 || transacciones.length > 0;
      const snapshot = buildSnapshot(ventas, transacciones, !hasData);

      if (!hasData) {
        snapshot.sourceHint = "Sin registros aun. Mostrando estructura de previsualizacion.";
      }

      homeState.ventas = ventas;
      homeState.transacciones = transacciones;
      homeState.snapshot = snapshot;
      homeState.lastUpdatedAt = snapshot.generatedAt;
      homeState.sourceLabel = hasData ? "Datos reales desde BD" : "Vista de ejemplo sin registros";

      animateNumber(homeElements.kpiVentas, snapshot.salesCount, (value) => homePercentFormatter.format(Math.round(value)));
      animateNumber(homeElements.kpiTransacciones, snapshot.txCount, (value) => homePercentFormatter.format(Math.round(value)));
      animateNumber(homeElements.kpiRecaudo, snapshot.totalAplicado, (value) => homeMoneyFormatter.format(Math.round(value)));
      animateNumber(homeElements.kpiSaldo, snapshot.totalSaldo, (value) => homeMoneyFormatter.format(Math.round(value)));
      animateNumber(homeElements.averageTicket, snapshot.averageTicket, (value) => homeMoneyFormatter.format(Math.round(value)));

      if (homeElements.healthScore) {
        animateNumber(homeElements.healthScore, snapshot.coverage * 100, (value) => `${Math.round(value)}%`, 700);
      }

      if (homeElements.healthCaption) {
        homeElements.healthCaption.textContent = hasData
          ? snapshot.coverage >= 0.7
            ? "Cobertura estable"
            : "Requiere seguimiento"
          : "Esperando carga real";
      }

      if (homeElements.sourcePill) {
        homeElements.sourcePill.textContent = homeState.sourceLabel;
      }

      if (homeElements.lastUpdate) {
        homeElements.lastUpdate.textContent = snapshot.generatedAt.toLocaleTimeString("es-CO", {
          hour: "2-digit",
          minute: "2-digit"
        });
      }

      if (homeElements.lastUpdateDetail) {
        homeElements.lastUpdateDetail.textContent = hasData ? "Consulta consolidada completada" : "Sin datos reales disponibles";
      }

      if (homeElements.averageTicketDetail) {
        homeElements.averageTicketDetail.textContent = hasData
          ? `${snapshot.salesCount} ventas analizadas`
          : "Ejemplo de previsualizacion";
      }

      if (homeElements.topClient) {
        homeElements.topClient.textContent = snapshot.topClient;
      }

      if (homeElements.topBank) {
        homeElements.topBank.textContent = `Banco favorito: ${snapshot.topBank}`;
      }

      if (homeElements.kpiVentasMeta) {
        homeElements.kpiVentasMeta.textContent = hasData ? `Últimos ${snapshot.salesCount} movimientos comerciales` : "Sin registros reales aun";
      }

      if (homeElements.kpiTransaccionesMeta) {
        homeElements.kpiTransaccionesMeta.textContent = hasData ? `Cobertura ${Math.round(snapshot.coverage * 100)}%` : "Vista de demostracion activa";
      }

      if (homeElements.kpiRecaudoMeta) {
        homeElements.kpiRecaudoMeta.textContent = hasData ? "Recaudo aplicado consolidado" : "Sin recaudo real disponible";
      }

      if (homeElements.kpiSaldoMeta) {
        homeElements.kpiSaldoMeta.textContent = hasData ? "Saldo pendiente sobre cartera total" : "Saldo de ejemplo no persistente";
      }

      if (homeElements.flowChip) {
        homeElements.flowChip.textContent = hasData ? "Ultimos 6 meses con datos reales" : "Vista de ejemplo";
      }

      if (homeElements.progressBar) {
        homeElements.progressBar.style.width = `${Math.max(0, Math.min(100, snapshot.coverage * 100))}%`;
      }

      if (homeElements.feedCount) {
        homeElements.feedCount.textContent = `${snapshot.recentFeed.length} eventos`;
      }

      renderCharts(snapshot);
      renderFeed(snapshot);
    } catch (error) {
      const fallbackSnapshot = buildSnapshot([], [], true);
      homeState.snapshot = fallbackSnapshot;
      homeState.sourceLabel = `Modo demostracion: ${error.message}`;

      if (homeElements.sourcePill) {
        homeElements.sourcePill.textContent = homeState.sourceLabel;
      }

      if (homeElements.healthCaption) {
        homeElements.healthCaption.textContent = "Conexion no disponible";
      }

      if (homeElements.lastUpdateDetail) {
        homeElements.lastUpdateDetail.textContent = "No fue posible consultar la BD";
      }

      if (homeElements.feedList) {
        homeElements.feedList.innerHTML = '<div class="home-feed-empty">No se pudo cargar la informacion real del sistema.</div>';
      }
    }
  };

  const downloadSnapshot = () => {
    if (!homeState.snapshot) {
      return;
    }

    const payload = {
      generatedAt: homeState.snapshot.generatedAt.toISOString(),
      source: homeState.sourceLabel,
      metrics: {
        ventas: homeState.snapshot.salesCount,
        transacciones: homeState.snapshot.txCount,
        recaudoAplicado: homeState.snapshot.totalAplicado,
        saldoPendiente: homeState.snapshot.totalSaldo,
        cobertura: homeState.snapshot.coverage,
        ticketPromedio: homeState.snapshot.averageTicket
      },
      highlights: {
        topClient: homeState.snapshot.topClient,
        topBank: homeState.snapshot.topBank
      }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    const fileName = `snapshot-dashboard-${new Date().toISOString().slice(0, 10)}.json`;

    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  };

  homeElements.refreshButton?.addEventListener("click", () => {
    syncHome(false);
  });

  homeElements.exportButton?.addEventListener("click", () => {
    downloadSnapshot();
  });

  syncHome(false);
}
