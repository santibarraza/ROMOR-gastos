// =============================================================
// Lógica principal de la app (vistas, eventos, render)
// =============================================================
(function () {
  const state = {
    categorias: [],
    proveedores: [],
    integrantes: [],
    proyectos: [],
    gastos: [],
    currentUser: localStorage.getItem("romor_user") || null,
    currentProject: JSON.parse(localStorage.getItem("romor_project") || "null"),
    editingId: null,
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (n) =>
    "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function showView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $(`view-${name}`).classList.add("active");
  }

  function toast(msg, isError) {
    const t = $("toast");
    t.textContent = msg;
    t.className =
      "fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-white text-sm " +
      (isError ? "bg-red-600" : "bg-slate-900");
    setTimeout(() => (t.className += " hidden"), 3000);
  }

  // -------------------- AUTH --------------------
  async function init() {
    const { data } = await sb.auth.getSession();
    if (data.session) {
      await afterLogin();
    } else {
      showView("login");
    }
  }

  $("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").classList.add("hidden");
    $("login-btn").disabled = true;
    $("login-btn").textContent = "Entrando...";
    try {
      if (
        !window.APP_CONFIG.SUPABASE_URL ||
        window.APP_CONFIG.SUPABASE_URL.includes("TU-PROYECTO") ||
        !window.APP_CONFIG.SUPABASE_ANON_KEY ||
        window.APP_CONFIG.SUPABASE_ANON_KEY.includes("TU-ANON-KEY")
      ) {
        throw new Error(
          "Falta configurar js/config.js con la URL y la llave anon de tu proyecto Supabase (todavía tiene los valores de ejemplo)."
        );
      }
      const { error } = await sb.auth.signInWithPassword({
        email: window.APP_CONFIG.SHARED_LOGIN_EMAIL,
        password: $("login-password").value,
      });
      if (error) throw error;
      await afterLogin();
    } catch (err) {
      // Mostramos el motivo real (Supabase ya lo devuelve en español-friendly
      // la mayoría de las veces en inglés, pero es más útil que un mensaje genérico)
      let msg = err.message || "No se pudo iniciar sesión.";
      if (/invalid login credentials/i.test(msg)) {
        msg =
          "Contraseña incorrecta, o el usuario equipo@romor-obra.local no existe / no coincide con SHARED_LOGIN_EMAIL en config.js.";
      } else if (/email not confirmed/i.test(msg)) {
        msg =
          'El usuario existe pero no está confirmado. En Supabase → Authentication → Users, edita el usuario y activa "Auto Confirm User" (o bórralo y créalo de nuevo con esa casilla activada).';
      } else if (/failed to fetch/i.test(msg)) {
        msg =
          "No se pudo conectar con Supabase. Revisa que SUPABASE_URL en config.js sea exactamente tu Project URL (https://xxxx.supabase.co).";
      }
      $("login-error").textContent = msg;
      $("login-error").classList.remove("hidden");
      console.error("Error de login:", err);
    } finally {
      $("login-btn").disabled = false;
      $("login-btn").textContent = "Entrar";
    }
  });

  async function doLogout() {
    await sb.auth.signOut();
    localStorage.removeItem("romor_user");
    state.currentUser = null;
    $("login-password").value = "";
    showView("login");
  }
  $("logout-btn").addEventListener("click", doLogout);
  $("proyectos-logout-btn").addEventListener("click", doLogout);

  $("change-user-btn").addEventListener("click", () => {
    showNameView();
  });

  $("change-project-btn").addEventListener("click", () => {
    goToProyectos(true);
  });

  async function afterLogin() {
    await loadCatalogs();
    if (!state.currentUser || !state.integrantes.find((i) => i.nombre === state.currentUser)) {
      showNameView();
    } else {
      await goToProyectos();
    }
  }

  // -------------------- SELECCIÓN DE NOMBRE --------------------
  function showNameView() {
    const sel = $("name-select");
    sel.innerHTML =
      '<option value="">— Selecciona tu nombre —</option>' +
      state.integrantes.map((i) => `<option value="${esc(i.nombre)}">${esc(i.nombre)}</option>`).join("");
    $("name-new").value = "";
    showView("name");
  }

  $("name-add-btn").addEventListener("click", async () => {
    const nombre = $("name-new").value.trim();
    if (!nombre) return;
    try {
      await DATA.addIntegrante(nombre);
      await loadCatalogs();
      $("name-select").value = nombre;
      $("name-new").value = "";
      toast("Nombre agregado");
    } catch (err) {
      toast("No se pudo agregar (¿ya existe?)", true);
    }
  });

  $("name-continue-btn").addEventListener("click", async () => {
    const nombre = $("name-select").value || $("name-new").value.trim();
    if (!nombre) {
      toast("Selecciona o escribe tu nombre", true);
      return;
    }
    if (!state.integrantes.find((i) => i.nombre === nombre)) {
      try {
        await DATA.addIntegrante(nombre);
        await loadCatalogs();
      } catch (err) {}
    }
    state.currentUser = nombre;
    localStorage.setItem("romor_user", nombre);
    await goToProyectos();
  });

  // -------------------- CATÁLOGOS --------------------
  async function loadCatalogs() {
    const [categorias, proveedores, integrantes] = await Promise.all([
      DATA.getCategorias(),
      DATA.getProveedores(),
      DATA.getIntegrantes(),
    ]);
    state.categorias = categorias;
    state.proveedores = proveedores;
    state.integrantes = integrantes;
  }

  // -------------------- PROYECTOS --------------------
  async function goToProyectos(force) {
    state.proyectos = await DATA.getProyectos();
    const cached = state.currentProject;
    if (!force && cached && state.proyectos.find((p) => p.id === cached.id)) {
      state.currentProject = state.proyectos.find((p) => p.id === cached.id);
      await goToDashboard();
      return;
    }
    $("proyectos-user-label").textContent = state.currentUser;
    renderProyectosList();
    showView("proyectos");
  }

  function renderProyectosList() {
    const cont = $("lista-proyectos");
    $("proyectos-vacio").classList.toggle("hidden", state.proyectos.length > 0);
    cont.innerHTML = state.proyectos
      .map(
        (p) => `
      <button data-id="${p.id}" class="proyecto-item w-full text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2.5 flex justify-between items-center transition">
        <span class="font-medium text-slate-800">${esc(p.nombre)}</span>
        <span class="text-slate-400">→</span>
      </button>`
      )
      .join("");
    cont.querySelectorAll(".proyecto-item").forEach((el) => {
      el.addEventListener("click", () => selectProyecto(el.dataset.id));
    });
  }

  function selectProyecto(id) {
    const p = state.proyectos.find((x) => x.id === id);
    if (!p) return;
    state.currentProject = p;
    localStorage.setItem("romor_project", JSON.stringify(p));
    goToDashboard();
  }

  $("proyecto-add-btn").addEventListener("click", async () => {
    const nombre = $("proyecto-new").value.trim();
    if (!nombre) return;
    try {
      const p = await DATA.addProyecto(nombre);
      state.proyectos.push(p);
      $("proyecto-new").value = "";
      toast("Proyecto creado");
      selectProyecto(p.id);
    } catch (err) {
      toast("No se pudo crear (¿ya existe un proyecto con ese nombre?)", true);
    }
  });

  // -------------------- DASHBOARD --------------------
  async function goToDashboard() {
    $("current-user-label").textContent = state.currentUser;
    $("current-project-label").textContent = state.currentProject?.nombre || "";
    showView("dashboard");
    await refreshAll();
  }

  async function refreshAll() {
    try {
      const [gastos, entradas] = await Promise.all([
        DATA.getGastos(state.currentProject?.id),
        DATA.getEntradas(state.currentProject?.id),
      ]);
      state.gastos = gastos;
      state.entradas = entradas;
    } catch (err) {
      toast("Error cargando datos: " + err.message, true);
      return;
    }
    renderFiltroCategoria();
    renderResumen();
    renderLista();
    renderEntradasList();
  }

  // Compatibilidad: algunas partes del código piden solo refrescar gastos/entradas
  const refreshGastos = refreshAll;

  function renderFiltroCategoria() {
    const sel = $("filtro-categoria");
    const current = sel.value;
    sel.innerHTML =
      '<option value="">Todas las partidas</option>' +
      state.categorias.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
    sel.value = current;
  }

  // -------------------- TABS GASTOS / ENTRADAS --------------------
  $("tab-gastos-btn").addEventListener("click", () => switchTab("gastos"));
  $("tab-entradas-btn").addEventListener("click", () => switchTab("entradas"));

  function switchTab(tab) {
    const isGastos = tab === "gastos";
    $("panel-gastos").classList.toggle("hidden", !isGastos);
    $("panel-entradas").classList.toggle("hidden", isGastos);
    $("tab-gastos-btn").className =
      "tab-btn flex-1 rounded-lg py-2 text-sm font-medium " +
      (isGastos ? "bg-slate-900 text-white" : "bg-white border border-slate-300 text-slate-600");
    $("tab-entradas-btn").className =
      "tab-btn flex-1 rounded-lg py-2 text-sm font-medium " +
      (!isGastos ? "bg-slate-900 text-white" : "bg-white border border-slate-300 text-slate-600");
    $("fab-add").classList.toggle("hidden", !isGastos);
  }

  function renderResumen() {
    const totalGastos = state.gastos.reduce((s, g) => s + Number(g.monto), 0);
    const totalEntradas = state.entradas.reduce((s, e) => s + Number(e.monto), 0);
    const saldo = totalEntradas - totalGastos;
    $("total-general").textContent = fmt(totalGastos);
    $("total-entradas").textContent = fmt(totalEntradas);
    const saldoEl = $("total-saldo");
    saldoEl.textContent = fmt(saldo);
    saldoEl.style.color = saldo >= 0 ? "#0ca30c" : "#d03b3b";

    const porCategoria = {};
    for (const g of state.gastos) {
      const nombre = g.categorias?.nombre || "Sin categoría";
      porCategoria[nombre] = (porCategoria[nombre] || 0) + Number(g.monto);
    }
    const filas = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
    const cont = $("totales-categoria");
    if (filas.length === 0) {
      cont.innerHTML = '<p class="text-sm text-slate-400">Sin datos todavía.</p>';
    } else {
      const max = Math.max(...filas.map((f) => f[1]));
      cont.innerHTML = filas
        .map(
          ([nombre, monto]) => `
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-slate-600">${esc(nombre)}</span>
            <span class="font-medium text-slate-900">${fmt(monto)}</span>
          </div>
          <div class="w-full bg-slate-100 rounded-full h-1.5">
            <div class="h-1.5 rounded-full" style="width:${(monto / max) * 100}%;background:#2a78d6"></div>
          </div>
        </div>`
        )
        .join("");
    }

    renderGraficaMes();
  }

  const MESES_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  function renderGraficaMes() {
    const cont = $("grafica-mes");
    const porMes = {};
    for (const g of state.gastos) {
      const mes = (g.fecha || "").slice(0, 7);
      if (!mes) continue;
      porMes[mes] = (porMes[mes] || 0) + Number(g.monto);
    }
    const meses = Object.keys(porMes).sort();
    if (meses.length === 0) {
      cont.innerHTML = '<p class="text-sm text-slate-400">Sin datos todavía.</p>';
      return;
    }
    const max = Math.max(...meses.map((m) => porMes[m]));
    const H = 120;
    const barW = 28;
    const gap = 10;
    const totalW = meses.length * barW + (meses.length - 1) * gap;
    const bars = meses
      .map((m, i) => {
        const h = Math.max(3, Math.round((porMes[m] / max) * (H - 26)));
        const x = i * (barW + gap);
        const y = H - 20 - h;
        const [yy, mm] = m.split("-");
        const label = `${MESES_ABBR[parseInt(mm, 10) - 1]} ${yy.slice(2)}`;
        return `<g>
        <title>${esc(label)}: ${fmt(porMes[m])}</title>
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="#2a78d6"></rect>
        <text x="${x + barW / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#898781">${esc(label)}</text>
      </g>`;
      })
      .join("");
    cont.innerHTML = `<svg viewBox="0 0 ${totalW} ${H}" style="max-height:140px;width:100%" preserveAspectRatio="xMinYMid meet">
      <line x1="0" y1="${H - 20}" x2="${totalW}" y2="${H - 20}" stroke="#c3c2b7" stroke-width="1"></line>
      ${bars}
    </svg>`;
  }

  function renderLista() {
    const filtro = $("filtro-categoria").value;
    const gastos = filtro ? state.gastos.filter((g) => g.categoria_id === filtro) : state.gastos;
    const cont = $("lista-gastos");
    $("lista-vacia").classList.toggle("hidden", gastos.length > 0);
    cont.innerHTML = gastos
      .map((g) => {
        const proveedor = g.proveedores?.nombre_empresa || g.proveedor_texto || "";
        return `
        <button data-id="${g.id}" class="gasto-item w-full text-left bg-white rounded-xl border border-slate-200 p-3 hover:border-slate-300 transition">
          <div class="flex justify-between items-start">
            <div class="min-w-0 pr-2">
              <p class="font-medium text-slate-900 truncate">${esc(g.descripcion || g.categorias?.nombre || "Gasto")}</p>
              <p class="text-xs text-slate-500 truncate">${esc(g.categorias?.nombre || "")}${proveedor ? " · " + esc(proveedor) : ""}</p>
              <p class="text-xs text-slate-400">${fmtFecha(g.fecha)} · ${esc(g.metodo_pago || "")}${g.pagado_por ? " · pagó " + esc(g.pagado_por) : ""}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="font-semibold text-slate-900">${fmt(g.monto)}</p>
              ${g.comprobante_url ? '<span class="text-xs text-slate-400">📎 comprobante</span>' : ""}
            </div>
          </div>
        </button>`;
      })
      .join("");
    cont.querySelectorAll(".gasto-item").forEach((el) => {
      el.addEventListener("click", () => openForm(el.dataset.id));
    });
  }

  $("filtro-categoria").addEventListener("change", renderLista);

  // -------------------- ENTRADAS --------------------
  function renderEntradasList() {
    const cont = $("lista-entradas");
    $("lista-entradas-vacia").classList.toggle("hidden", state.entradas.length > 0);
    cont.innerHTML = state.entradas
      .map(
        (e) => `
      <button data-id="${e.id}" class="entrada-item w-full text-left bg-white rounded-xl border border-slate-200 p-3 hover:border-slate-300 transition">
        <div class="flex justify-between items-start">
          <div class="min-w-0 pr-2">
            <p class="font-medium text-slate-900 truncate">${esc(e.concepto || "Entrada")}</p>
            <p class="text-xs text-slate-400">${fmtFecha(e.fecha)}${e.aportado_por ? " · aportó " + esc(e.aportado_por) : ""}</p>
          </div>
          <p class="font-semibold" style="color:#0ca30c">${fmt(e.monto)}</p>
        </div>
      </button>`
      )
      .join("");
    cont.querySelectorAll(".entrada-item").forEach((el) => {
      el.addEventListener("click", () => openEntradaForm(el.dataset.id));
    });
  }

  $("entrada-add-open-btn").addEventListener("click", () => openEntradaForm(null));
  $("entrada-form-back-btn").addEventListener("click", () => {
    showView("dashboard");
  });

  async function openEntradaForm(id) {
    $("entrada-form-error").classList.add("hidden");
    $("entrada-aportador").innerHTML = state.integrantes.map((i) => `<option value="${esc(i.nombre)}">${esc(i.nombre)}</option>`).join("");
    $("entrada-proyecto").innerHTML = state.proyectos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");

    if (id) {
      $("entrada-form-title").textContent = "Editar entrada";
      $("entrada-delete-btn").classList.remove("hidden");
      const e = state.entradas.find((x) => x.id === id) || (await DATA.getEntrada(id));
      $("entrada-id").value = e.id;
      $("entrada-proyecto").value = e.proyecto_id || state.currentProject?.id || "";
      $("entrada-monto").value = e.monto;
      $("entrada-fecha").value = e.fecha;
      $("entrada-concepto").value = e.concepto || "";
      $("entrada-aportador").value = e.aportado_por || "";
      $("entrada-notas").value = e.notas || "";
    } else {
      $("entrada-form-title").textContent = "Nueva entrada";
      $("entrada-delete-btn").classList.add("hidden");
      $("entrada-id").value = "";
      $("entrada-proyecto").value = state.currentProject?.id || "";
      $("entrada-monto").value = "";
      $("entrada-fecha").value = new Date().toISOString().slice(0, 10);
      $("entrada-concepto").value = "";
      $("entrada-aportador").value = state.currentUser;
      $("entrada-notas").value = "";
    }
    showView("form-entrada");
  }

  $("form-entrada").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("entrada-form-error").classList.add("hidden");
    const btn = $("entrada-save-btn");
    btn.disabled = true;
    btn.textContent = "Guardando...";
    try {
      const payload = {
        proyecto_id: $("entrada-proyecto").value || state.currentProject?.id || null,
        monto: parseFloat($("entrada-monto").value),
        fecha: $("entrada-fecha").value,
        concepto: $("entrada-concepto").value.trim() || null,
        aportado_por: $("entrada-aportador").value || null,
        capturado_por: state.currentUser,
        notas: $("entrada-notas").value.trim() || null,
      };
      const id = $("entrada-id").value || null;
      await DATA.saveEntrada(payload, id);
      toast(id ? "Entrada actualizada" : "Entrada guardada");
      showView("dashboard");
      await refreshAll();
    } catch (err) {
      $("entrada-form-error").textContent = "Error al guardar: " + err.message;
      $("entrada-form-error").classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  });

  $("entrada-delete-btn").addEventListener("click", async () => {
    const id = $("entrada-id").value;
    if (!id) return;
    if (!confirm("¿Eliminar esta entrada? Esta acción no se puede deshacer.")) return;
    try {
      await DATA.deleteEntrada(id);
      toast("Entrada eliminada");
      showView("dashboard");
      await refreshAll();
    } catch (err) {
      toast("Error al eliminar: " + err.message, true);
    }
  });

  // -------------------- EXPORTAR A EXCEL --------------------
  $("export-excel-btn").addEventListener("click", () => {
    try {
      const gastosRows = state.gastos.map((g) => ({
        Fecha: g.fecha,
        Partida: g.categorias?.nombre || "",
        Proveedor: g.proveedores?.nombre_empresa || g.proveedor_texto || "",
        Descripción: g.descripcion || "",
        Monto: Number(g.monto),
        "Método de pago": g.metodo_pago || "",
        "Pagó": g.pagado_por || "",
        "Capturó": g.capturado_por || "",
        Notas: g.notas || "",
      }));
      const entradasRows = state.entradas.map((e) => ({
        Fecha: e.fecha,
        Concepto: e.concepto || "",
        Monto: Number(e.monto),
        "Aportó": e.aportado_por || "",
        "Capturó": e.capturado_por || "",
        Notas: e.notas || "",
      }));
      const totalGastos = state.gastos.reduce((s, g) => s + Number(g.monto), 0);
      const totalEntradas = state.entradas.reduce((s, e) => s + Number(e.monto), 0);
      const resumenRows = [
        { Concepto: "Total entradas", Monto: totalEntradas },
        { Concepto: "Total gastos", Monto: totalGastos },
        { Concepto: "Saldo", Monto: totalEntradas - totalGastos },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumenRows), "Resumen");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastosRows), "Gastos");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entradasRows), "Entradas");

      const nombreProyecto = (state.currentProject?.nombre || "proyecto").replace(/[^a-z0-9]+/gi, "_");
      XLSX.writeFile(wb, `gastos_${nombreProyecto}.xlsx`);
    } catch (err) {
      toast("No se pudo exportar: " + err.message, true);
    }
  });

  function fmtFecha(f) {
    if (!f) return "";
    const [y, m, d] = f.split("-");
    return `${d}/${m}/${y}`;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // -------------------- FORMULARIO DE GASTO --------------------
  $("fab-add").addEventListener("click", () => openForm(null));
  $("form-back-btn").addEventListener("click", () => {
    showView("dashboard");
    refreshGastos();
  });

  function fillSelects() {
    $("gasto-proyecto").innerHTML = state.proyectos
      .map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`)
      .join("");
    $("gasto-categoria").innerHTML = state.categorias
      .map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`)
      .join("");
    $("gasto-pagador").innerHTML = state.integrantes
      .map((i) => `<option value="${esc(i.nombre)}">${esc(i.nombre)}</option>`)
      .join("");
    renderProveedorOptions();
  }

  function renderProveedorOptions() {
    const catId = $("gasto-categoria").value;
    const provs = state.proveedores.filter((p) => !catId || p.categoria_id === catId);
    $("gasto-proveedor").innerHTML =
      '<option value="">— Ninguno / escribir abajo —</option>' +
      provs.map((p) => `<option value="${p.id}">${esc(p.nombre_empresa)}</option>`).join("");
  }

  $("gasto-categoria").addEventListener("change", renderProveedorOptions);

  async function openForm(id) {
    fillSelects();
    $("form-error").classList.add("hidden");
    $("gasto-comprobante").value = "";
    $("gasto-comprobante-actual").classList.add("hidden");
    state.editingId = id;

    if (id) {
      $("form-title").textContent = "Editar gasto";
      $("gasto-delete-btn").classList.remove("hidden");
      const g = state.gastos.find((x) => x.id === id) || (await DATA.getGasto(id));
      $("gasto-id").value = g.id;
      $("gasto-proyecto").value = g.proyecto_id || state.currentProject?.id || "";
      $("gasto-monto").value = g.monto;
      $("gasto-fecha").value = g.fecha;
      $("gasto-categoria").value = g.categoria_id || "";
      renderProveedorOptions();
      $("gasto-proveedor").value = g.proveedor_id || "";
      $("gasto-proveedor-texto").value = g.proveedor_texto || "";
      $("gasto-descripcion").value = g.descripcion || "";
      $("gasto-metodo").value = g.metodo_pago || "Efectivo";
      $("gasto-pagador").value = g.pagado_por || state.currentUser;
      $("gasto-notas").value = g.notas || "";
      if (g.comprobante_url) {
        $("gasto-comprobante-actual").href = g.comprobante_url;
        $("gasto-comprobante-actual").classList.remove("hidden");
      }
    } else {
      $("form-title").textContent = "Nuevo gasto";
      $("gasto-delete-btn").classList.add("hidden");
      $("gasto-id").value = "";
      $("gasto-proyecto").value = state.currentProject?.id || "";
      $("gasto-monto").value = "";
      $("gasto-fecha").value = new Date().toISOString().slice(0, 10);
      $("gasto-categoria").value = state.categorias[0]?.id || "";
      renderProveedorOptions();
      $("gasto-proveedor").value = "";
      $("gasto-proveedor-texto").value = "";
      $("gasto-descripcion").value = "";
      $("gasto-metodo").value = "Efectivo";
      $("gasto-pagador").value = state.currentUser;
      $("gasto-notas").value = "";
    }
    showView("form");
  }

  $("form-gasto").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("form-error").classList.add("hidden");
    const btn = $("gasto-save-btn");
    btn.disabled = true;
    btn.textContent = "Guardando...";
    try {
      const payload = {
        proyecto_id: $("gasto-proyecto").value || state.currentProject?.id || null,
        monto: parseFloat($("gasto-monto").value),
        fecha: $("gasto-fecha").value,
        categoria_id: $("gasto-categoria").value || null,
        proveedor_id: $("gasto-proveedor").value || null,
        proveedor_texto: $("gasto-proveedor-texto").value.trim() || null,
        descripcion: $("gasto-descripcion").value.trim() || null,
        metodo_pago: $("gasto-metodo").value,
        pagado_por: $("gasto-pagador").value || null,
        capturado_por: state.currentUser,
        notas: $("gasto-notas").value.trim() || null,
      };

      const file = $("gasto-comprobante").files[0];
      if (file) {
        const up = await DATA.uploadComprobante(file);
        payload.comprobante_url = up.url;
        payload.comprobante_nombre = up.nombre;
      }

      const id = $("gasto-id").value || null;
      await DATA.saveGasto(payload, id);
      toast(id ? "Gasto actualizado" : "Gasto guardado");
      showView("dashboard");
      await refreshGastos();
    } catch (err) {
      $("form-error").textContent = "Error al guardar: " + err.message;
      $("form-error").classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  });

  $("gasto-delete-btn").addEventListener("click", async () => {
    const id = $("gasto-id").value;
    if (!id) return;
    if (!confirm("¿Eliminar este gasto? Esta acción no se puede deshacer.")) return;
    try {
      await DATA.deleteGasto(id);
      toast("Gasto eliminado");
      showView("dashboard");
      await refreshGastos();
    } catch (err) {
      toast("Error al eliminar: " + err.message, true);
    }
  });

  init();
})();
