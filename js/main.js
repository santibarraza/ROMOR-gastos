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
    entradas: [],
    documentos: [],
    bitacora: [],
    currentUser: localStorage.getItem("romor_user") || null,
    // "Último proyecto usado": solo se usa para pre-seleccionar el proyecto
    // al crear un gasto/entrada nuevo. Ya NO bloquea el acceso al dashboard.
    currentProject: JSON.parse(localStorage.getItem("romor_project") || "null"),
    // Filtro de la vista general: "" = todos los proyectos juntos.
    filtroProyecto: "",
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

  // -------------------- MODO SIN INTERNET (PWA + cola local) --------------------
  // Registra el service worker: hace que el "cascarón" de la app (HTML/CSS/JS,
  // logo, fuentes) cargue aunque no haya internet. Los datos siguen yendo
  // siempre directo a Supabase (ver sw.js).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("sw.js")
        .catch((err) => console.warn("No se pudo registrar el service worker:", err));
    });
  }

  const OUTBOX_KEY = "romor_outbox";

  function getOutbox() {
    try {
      return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    } catch (err) {
      return [];
    }
  }

  function setOutbox(items) {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  }

  // Guarda en una cola local (localStorage) un gasto/entrada/nota de bitácora
  // nuevo capturado sin internet, para subirlo solo en cuanto vuelva la conexión.
  function queueOutbox(tipo, payload) {
    const items = getOutbox();
    const localId = "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    items.push({ localId, tipo, payload, creadoEn: new Date().toISOString() });
    setOutbox(items);
    updateOfflineBanner();
    return localId;
  }

  async function trySyncOutbox() {
    if (!navigator.onLine) return;
    const items = getOutbox();
    if (items.length === 0) return;
    const restantes = [];
    let subidos = 0;
    for (const item of items) {
      try {
        if (item.tipo === "gasto") {
          await DATA.saveGasto(item.payload, null);
        } else if (item.tipo === "entrada") {
          await DATA.saveEntrada(item.payload, null);
        } else if (item.tipo === "bitacora") {
          await DATA.addBitacoraEntry(item.payload);
        }
        subidos++;
      } catch (err) {
        console.warn("No se pudo sincronizar un registro pendiente:", err);
        restantes.push(item);
      }
    }
    setOutbox(restantes);
    updateOfflineBanner();
    if (subidos > 0) {
      toast(`${subidos} registro(s) pendiente(s) sincronizado(s)`);
      if (state.currentUser) await refreshAll();
    }
  }

  function updateOfflineBanner() {
    const banner = $("offline-banner");
    if (!banner) return;
    const pendientes = getOutbox().length;
    if (!navigator.onLine) {
      banner.textContent = "📡 Sin conexión — lo que agregues se guardará y se subirá cuando vuelva el internet.";
      banner.classList.remove("hidden");
    } else if (pendientes > 0) {
      banner.textContent = `📡 Sincronizando ${pendientes} registro(s) pendiente(s)...`;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }

  window.addEventListener("online", () => {
    updateOfflineBanner();
    trySyncOutbox();
  });
  window.addEventListener("offline", () => {
    updateOfflineBanner();
  });

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

  $("change-user-btn").addEventListener("click", () => {
    showNameView();
  });

  async function afterLogin() {
    await loadCatalogs();
    updateOfflineBanner();
    trySyncOutbox();
    if (!state.currentUser || !state.integrantes.find((i) => i.nombre === state.currentUser)) {
      showNameView();
    } else {
      await goToDashboard();
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
    await goToDashboard();
  });

  // -------------------- CATÁLOGOS --------------------
  async function loadCatalogs() {
    const [categorias, proveedores, integrantes, proyectos] = await Promise.all([
      DATA.getCategorias(),
      DATA.getProveedores(),
      DATA.getIntegrantes(),
      DATA.getProyectos(),
    ]);
    state.categorias = categorias;
    state.proveedores = proveedores;
    state.integrantes = integrantes;
    state.proyectos = proyectos;
  }

  // -------------------- PROYECTOS --------------------
  // "Proyectos" ya no es una pantalla obligatoria antes del dashboard: es una
  // pantalla de administración (crear proyectos, o cambiar el filtro) a la
  // que se entra desde el enlace "proyectos" en el encabezado del dashboard.
  $("change-project-btn").addEventListener("click", () => {
    openProyectosView();
  });

  $("proyectos-back-btn").addEventListener("click", () => {
    showView("dashboard");
  });

  async function openProyectosView() {
    try {
      state.proyectos = await DATA.getProyectos();
    } catch (err) {
      toast("Error cargando proyectos: " + err.message, true);
    }
    renderProyectosList();
    showView("proyectos");
  }

  function renderProyectosList() {
    const cont = $("lista-proyectos");
    $("proyectos-vacio").classList.toggle("hidden", state.proyectos.length > 0);
    cont.innerHTML = state.proyectos
      .map(
        (p) => `
      <div class="proyecto-item w-full text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2.5 flex justify-between items-center transition">
        <button data-id="${p.id}" class="proyecto-select-btn flex-1 min-w-0 text-left flex items-center gap-2">
          <span class="font-medium text-slate-800 truncate">${esc(p.nombre)}</span>
        </button>
        <button data-id="${p.id}" data-nombre="${esc(p.nombre)}" class="proyecto-delete-btn shrink-0 text-slate-400 hover:text-red-600 text-lg px-1 leading-none" title="Eliminar proyecto">🗑️</button>
        <span class="text-slate-400 ml-1">→</span>
      </div>`
      )
      .join("");
    cont.querySelectorAll(".proyecto-select-btn").forEach((el) => {
      el.addEventListener("click", () => selectProyectoFiltro(el.dataset.id));
    });
    cont.querySelectorAll(".proyecto-delete-btn").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const id = el.dataset.id;
        const nombre = el.dataset.nombre;
        const nGastos = state.gastos.filter((g) => g.proyecto_id === id).length;
        const nEntradas = state.entradas.filter((e) => e.proyecto_id === id).length;
        const nDocumentos = state.documentos.filter((d) => d.proyecto_id === id).length;
        const nBitacora = state.bitacora.filter((b) => b.proyecto_id === id).length;
        const detalle =
          nGastos || nEntradas || nDocumentos || nBitacora
            ? ` Esto borra PERMANENTEMENTE ${nGastos} gasto(s), ${nEntradas} entrada(s), ${nDocumentos} documento(s) y ${nBitacora} avance(s) de bitácora de este proyecto.`
            : " Este proyecto no tiene gastos, entradas, documentos ni avances de bitácora registrados.";
        if (!confirm(`¿Eliminar el proyecto "${nombre}"?${detalle} Esta acción no se puede deshacer.`)) return;
        try {
          await DATA.deleteProyecto(id);
          state.proyectos = state.proyectos.filter((p) => p.id !== id);
          state.gastos = state.gastos.filter((g) => g.proyecto_id !== id);
          state.entradas = state.entradas.filter((e) => e.proyecto_id !== id);
          state.documentos = state.documentos.filter((d) => d.proyecto_id !== id);
          state.bitacora = state.bitacora.filter((b) => b.proyecto_id !== id);
          if (state.filtroProyecto === id) state.filtroProyecto = "";
          if (state.currentProject?.id === id) {
            state.currentProject = null;
            localStorage.removeItem("romor_project");
          }
          toast("Proyecto eliminado");
          renderProyectosList();
        } catch (err) {
          toast("Error al eliminar: " + err.message, true);
        }
      });
    });
  }

  // El botón "Vista general (todos los proyectos)" vive fijo en el HTML,
  // fuera de #lista-proyectos, así que se conecta aparte.
  $("proyecto-vista-general-btn").addEventListener("click", () => {
    selectProyectoFiltro("");
  });

  // Elegir un proyecto en la pantalla de "Proyectos" ahora solo ajusta el
  // filtro del dashboard (y recuerda ese proyecto como el que se usará por
  // defecto al crear un gasto/entrada nuevo) — ya no bloquea nada.
  function selectProyectoFiltro(id) {
    state.filtroProyecto = id || "";
    if (id) {
      const p = state.proyectos.find((x) => x.id === id);
      if (p) {
        state.currentProject = p;
        localStorage.setItem("romor_project", JSON.stringify(p));
      }
    }
    goToDashboard();
  }

  $("proyecto-add-btn").addEventListener("click", async () => {
    const nombre = $("proyecto-new").value.trim();
    $("proyecto-add-error").classList.add("hidden");
    if (!nombre) return;
    try {
      const p = await DATA.addProyecto(nombre);
      state.proyectos.push(p);
      $("proyecto-new").value = "";
      toast("Proyecto creado");
      renderProyectosList();
      selectProyectoFiltro(p.id);
    } catch (err) {
      // Mostramos el error real (antes se ocultaba con un mensaje genérico,
      // lo que hacía parecer que el botón "no funcionaba").
      console.error("Error creando proyecto:", err);
      $("proyecto-add-error").textContent =
        "No se pudo crear: " + (err.message || "¿ya existe un proyecto con ese nombre?");
      $("proyecto-add-error").classList.remove("hidden");
    }
  });

  // -------------------- PROVEEDORES (directorio) --------------------
  $("open-proveedores-btn").addEventListener("click", () => {
    openProveedoresView();
  });

  $("proveedores-back-btn").addEventListener("click", () => {
    showView("dashboard");
  });

  async function openProveedoresView() {
    try {
      state.proveedores = await DATA.getProveedores();
    } catch (err) {
      toast("Error cargando proveedores: " + err.message, true);
    }
    resetProveedorForm();
    renderProveedoresList();
    showView("proveedores");
  }

  function totalPagadoProveedor(proveedorId) {
    return state.gastos.filter((g) => g.proveedor_id === proveedorId).reduce((s, g) => s + Number(g.monto), 0);
  }

  function renderProveedoresList() {
    const cont = $("lista-proveedores");
    $("proveedores-vacio").classList.toggle("hidden", state.proveedores.length > 0);
    cont.innerHTML = state.proveedores
      .map((p) => {
        const categoria = state.categorias.find((c) => c.id === p.categoria_id)?.nombre || "";
        const total = totalPagadoProveedor(p.id);
        const tel = (p.telefono || "").replace(/[^0-9]/g, "");
        return `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <div class="flex justify-between items-start gap-2">
          <button data-id="${p.id}" class="proveedor-edit-item text-left min-w-0 flex-1">
            <p class="font-medium text-slate-900 truncate">${esc(p.nombre_empresa)}</p>
            <p class="text-xs text-slate-500 truncate">${esc(categoria)}${p.contacto ? " · " + esc(p.contacto) : ""}</p>
            ${p.telefono ? `<p class="text-xs text-slate-400">${esc(p.telefono)}</p>` : ""}
          </button>
          <div class="text-right shrink-0">
            <p class="text-xs text-slate-400">Pagado</p>
            <p class="font-semibold text-slate-900">${fmt(total)}</p>
          </div>
        </div>
        ${
          tel
            ? `<a href="https://wa.me/${esc(tel)}" target="_blank" rel="noopener" class="mt-2 inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 rounded-full px-2.5 py-1">💬 WhatsApp</a>`
            : ""
        }
      </div>`;
      })
      .join("");
    cont.querySelectorAll(".proveedor-edit-item").forEach((el) => {
      el.addEventListener("click", () => openProveedorForEdit(el.dataset.id));
    });
  }

  function categoriaOptionsProveedor(selectedId) {
    return (
      '<option value="">— Sin categoría —</option>' +
      state.categorias.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")
    );
  }

  function resetProveedorForm() {
    $("proveedor-form-title").textContent = "Agregar proveedor";
    $("proveedor-id").value = "";
    $("proveedor-nombre").value = "";
    $("proveedor-categoria").innerHTML = categoriaOptionsProveedor();
    $("proveedor-categoria").value = "";
    $("proveedor-contacto").value = "";
    $("proveedor-telefono").value = "";
    $("proveedor-notas").value = "";
    $("proveedor-form-error").classList.add("hidden");
    $("proveedor-cancel-btn").classList.add("hidden");
    $("proveedor-delete-btn").classList.add("hidden");
  }

  function openProveedorForEdit(id) {
    const p = state.proveedores.find((x) => x.id === id);
    if (!p) return;
    $("proveedor-form-title").textContent = "Editar proveedor";
    $("proveedor-id").value = p.id;
    $("proveedor-nombre").value = p.nombre_empresa || "";
    $("proveedor-categoria").innerHTML = categoriaOptionsProveedor();
    $("proveedor-categoria").value = p.categoria_id || "";
    $("proveedor-contacto").value = p.contacto || "";
    $("proveedor-telefono").value = p.telefono || "";
    $("proveedor-notas").value = p.notas || "";
    $("proveedor-form-error").classList.add("hidden");
    $("proveedor-cancel-btn").classList.remove("hidden");
    $("proveedor-delete-btn").classList.remove("hidden");
  }

  $("proveedor-cancel-btn").addEventListener("click", () => resetProveedorForm());

  $("form-proveedor").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("proveedor-form-error").classList.add("hidden");
    const btn = $("proveedor-save-btn");
    btn.disabled = true;
    btn.textContent = "Guardando...";
    try {
      const nombre = $("proveedor-nombre").value.trim();
      if (!nombre) throw new Error("El nombre de la empresa es obligatorio.");
      const payload = {
        nombre_empresa: nombre,
        categoria_id: $("proveedor-categoria").value || null,
        contacto: $("proveedor-contacto").value.trim() || null,
        telefono: $("proveedor-telefono").value.trim() || null,
        notas: $("proveedor-notas").value.trim() || null,
      };
      const id = $("proveedor-id").value || null;
      await DATA.saveProveedor(payload, id);
      state.proveedores = await DATA.getProveedores();
      toast(id ? "Proveedor actualizado" : "Proveedor agregado");
      resetProveedorForm();
      renderProveedoresList();
    } catch (err) {
      $("proveedor-form-error").textContent = "Error al guardar: " + err.message;
      $("proveedor-form-error").classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  });

  $("proveedor-delete-btn").addEventListener("click", async () => {
    const id = $("proveedor-id").value;
    if (!id) return;
    if (!confirm("¿Eliminar este proveedor? Esta acción no se puede deshacer.")) return;
    try {
      await DATA.deleteProveedor(id);
      state.proveedores = await DATA.getProveedores();
      toast("Proveedor eliminado");
      resetProveedorForm();
      renderProveedoresList();
    } catch (err) {
      toast("Error al eliminar: " + err.message, true);
    }
  });

  // -------------------- DASHBOARD --------------------
  async function goToDashboard() {
    $("current-user-label").textContent = state.currentUser;
    renderFiltroProyecto();
    showView("dashboard");
    await refreshAll();
  }

  async function refreshAll() {
    try {
      // Traemos TODOS los gastos/entradas/documentos/bitácora (de todos los
      // proyectos) y filtramos en el cliente — así la vista general y el
      // filtro por proyecto no requieren volver a pedir datos al servidor.
      const [gastos, entradas, documentos, bitacora] = await Promise.all([
        DATA.getGastos(),
        DATA.getEntradas(),
        DATA.getDocumentos(),
        DATA.getBitacora(),
      ]);
      state.gastos = gastos;
      state.entradas = entradas;
      state.documentos = documentos;
      state.bitacora = bitacora;
    } catch (err) {
      toast("Error cargando datos: " + err.message, true);
      return;
    }
    renderFiltroCategoria();
    renderResumen();
    renderLista();
    renderEntradasList();
    renderDocumentosList();
    renderBitacoraList();
    renderCreditosList();
  }

  // Compatibilidad: algunas partes del código piden solo refrescar gastos/entradas
  const refreshGastos = refreshAll;

  function renderFiltroProyecto() {
    const sel = $("filtro-proyecto");
    const current = state.filtroProyecto || "";
    sel.innerHTML =
      '<option value="">🌐 Todos los proyectos</option>' +
      state.proyectos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
    sel.value = current;
  }

  $("filtro-proyecto").addEventListener("change", () => {
    state.filtroProyecto = $("filtro-proyecto").value;
    renderResumen();
    renderLista();
    renderEntradasList();
    renderDocumentosList();
    renderBitacoraList();
    renderCreditosList();
  });

  function gastosFiltrados() {
    return state.filtroProyecto ? state.gastos.filter((g) => g.proyecto_id === state.filtroProyecto) : state.gastos;
  }

  function entradasFiltradas() {
    return state.filtroProyecto
      ? state.entradas.filter((e) => e.proyecto_id === state.filtroProyecto)
      : state.entradas;
  }

  function documentosFiltrados() {
    return state.filtroProyecto
      ? state.documentos.filter((d) => d.proyecto_id === state.filtroProyecto)
      : state.documentos;
  }

  function bitacoraFiltrada() {
    return state.filtroProyecto
      ? state.bitacora.filter((b) => b.proyecto_id === state.filtroProyecto)
      : state.bitacora;
  }

  // Proyecto a usar por defecto al crear un gasto/entrada nuevo: el que esté
  // filtrado en el dashboard, si no el último usado, si no el primero de la lista.
  function defaultProyectoId() {
    return state.filtroProyecto || state.currentProject?.id || state.proyectos[0]?.id || "";
  }

  // Inserta en el estado local, de forma optimista, un gasto/entrada capturado
  // sin internet — así aparece de inmediato en la lista (con su etiqueta "⏳
  // sin subir") mientras espera su turno en la cola local para subirse.
  function addPendingGastoToState(payload, localId) {
    state.gastos.unshift({
      id: localId,
      ...payload,
      categorias: state.categorias.find((c) => c.id === payload.categoria_id) || null,
      proveedores: state.proveedores.find((p) => p.id === payload.proveedor_id) || null,
      proyectos: state.proyectos.find((p) => p.id === payload.proyecto_id) || null,
      _pendiente: true,
    });
  }

  function addPendingEntradaToState(payload, localId) {
    state.entradas.unshift({
      id: localId,
      ...payload,
      proyectos: state.proyectos.find((p) => p.id === payload.proyecto_id) || null,
      _pendiente: true,
    });
  }

  function renderFiltroCategoria() {
    const sel = $("filtro-categoria");
    const current = sel.value;
    sel.innerHTML =
      '<option value="">Todas las partidas</option>' +
      state.categorias.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
    sel.value = current;
  }

  // -------------------- TABS GASTOS / ENTRADAS / DOCUMENTOS / BITÁCORA --------------------
  const TABS = ["bitacora", "gastos", "entradas", "documentos", "creditos"];
  $("tab-gastos-btn").addEventListener("click", () => switchTab("gastos"));
  $("tab-entradas-btn").addEventListener("click", () => switchTab("entradas"));
  $("tab-documentos-btn").addEventListener("click", () => switchTab("documentos"));
  $("tab-bitacora-btn").addEventListener("click", () => switchTab("bitacora"));
  $("tab-creditos-btn").addEventListener("click", () => switchTab("creditos"));

  function switchTab(tab) {
    TABS.forEach((t) => {
      const active = t === tab;
      $(`panel-${t}`).classList.toggle("hidden", !active);
      $(`tab-${t}-btn`).className =
        "tab-btn shrink-0 rounded-lg py-2 px-4 text-sm font-medium " +
        (active ? "bg-brand text-white" : "bg-white border border-slate-300 text-slate-600");
    });
    // El botón "+" flotante solo aplica a la lista de gastos; documentos y
    // bitácora tienen su propio botón "+" arriba de su lista.
    $("fab-add").classList.toggle("hidden", tab !== "gastos");
  }

  function renderResumen() {
    const gastos = gastosFiltrados();
    const entradas = entradasFiltradas();
    const totalGastos = gastos.reduce((s, g) => s + Number(g.monto), 0);
    const totalEntradas = entradas.reduce((s, e) => s + Number(e.monto), 0);
    const saldo = totalEntradas - totalGastos;
    $("total-general").textContent = fmt(totalGastos);
    $("total-entradas").textContent = fmt(totalEntradas);
    const saldoEl = $("total-saldo");
    saldoEl.textContent = fmt(saldo);
    saldoEl.style.color = saldo >= 0 ? "#0ca30c" : "#d03b3b";

    const porCategoria = {};
    for (const g of gastos) {
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
            <div class="h-1.5 rounded-full" style="width:${(monto / max) * 100}%;background:#DB002E"></div>
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
    const gastos = gastosFiltrados();
    const porMes = {};
    for (const g of gastos) {
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
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="#DB002E"></rect>
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
    const mostrarTodos = !state.filtroProyecto;
    const filtroCat = $("filtro-categoria").value;
    let gastos = gastosFiltrados();
    if (filtroCat) gastos = gastos.filter((g) => g.categoria_id === filtroCat);
    const cont = $("lista-gastos");
    $("lista-vacia").classList.toggle("hidden", gastos.length > 0);
    cont.innerHTML = gastos
      .map((g) => {
        const proveedor = g.proveedores?.nombre_empresa || g.proveedor_texto || "";
        const proyectoTag =
          mostrarTodos && g.proyectos?.nombre
            ? `<span class="inline-block text-[10px] font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 mr-1 align-middle">${esc(g.proyectos.nombre)}</span>`
            : "";
        const pendienteTag = g._pendiente
          ? '<span class="inline-block text-[10px] font-medium text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mr-1 align-middle">⏳ sin subir</span>'
          : "";
        let creditoTag = "";
        if (g.metodo_pago === "Crédito") {
          const abonado = (g.abonos_credito || []).reduce((s, a) => s + Number(a.monto), 0);
          const saldo = Number(g.monto) - abonado;
          creditoTag =
            saldo > 0.005
              ? `<span class="inline-block text-[10px] font-medium text-red-700 bg-red-50 rounded px-1.5 py-0.5 mr-1 align-middle">💳 ${fmt(saldo)}</span>`
              : '<span class="inline-block text-[10px] font-medium text-green-700 bg-green-50 rounded px-1.5 py-0.5 mr-1 align-middle">💳 pagado</span>';
        }
        let ivaTag = "";
        if (g.con_iva) {
          const { iva } = desgloseIva(Number(g.monto));
          ivaTag = `<span class="inline-block text-[10px] font-medium text-slate-600 bg-slate-100 rounded px-1.5 py-0.5 mr-1 align-middle">IVA ${fmt(iva)}</span>`;
        }
        return `
        <button data-id="${g.id}" data-pendiente="${g._pendiente ? 1 : 0}" class="gasto-item w-full text-left bg-white rounded-xl border border-slate-200 shadow-sm p-3 hover:border-slate-300 transition">
          <div class="flex justify-between items-start">
            <div class="min-w-0 pr-2">
              <p class="font-medium text-slate-900 truncate">${proyectoTag}${pendienteTag}${creditoTag}${ivaTag}${esc(g.descripcion || g.categorias?.nombre || "Gasto")}</p>
              <p class="text-xs text-slate-500 truncate">${esc(g.categorias?.nombre || "")}${proveedor ? " · " + esc(proveedor) : ""}</p>
              <p class="text-xs text-slate-400">${fmtFecha(g.fecha)} · ${esc(g.metodo_pago || "")}${g.pagado_por ? " · pagó " + esc(g.pagado_por) : ""}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="font-semibold text-slate-900">${fmt(g.monto)}</p>
              ${(() => {
                const n = (g.gasto_documentos || []).length;
                if (n > 0) return `<span class="text-xs text-slate-400">📎 ${n} documento${n > 1 ? "s" : ""}</span>`;
                return g.comprobante_url ? '<span class="text-xs text-slate-400">📎 comprobante</span>' : "";
              })()}
            </div>
          </div>
        </button>`;
      })
      .join("");
    cont.querySelectorAll(".gasto-item").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.dataset.pendiente === "1") {
          toast("Este gasto se está subiendo, espera un momento antes de editarlo", true);
          return;
        }
        openForm(el.dataset.id);
      });
    });
  }

  $("filtro-categoria").addEventListener("change", renderLista);

  // -------------------- CRÉDITOS (gastos con metodo_pago = "Crédito") --------------------
  // No hay una columna "es_credito" aparte: un gasto es una deuda a crédito
  // si su metodo_pago vale exactamente "Crédito". El saldo pendiente se
  // calcula en el cliente restándole al monto original la suma de sus
  // abonos (g.abonos_credito, que ya viene incluido en cada gasto gracias
  // al select anidado de DATA.getGastos).
  function creditoInfo(g) {
    const abonado = (g.abonos_credito || []).reduce((s, a) => s + Number(a.monto), 0);
    const saldo = Number(g.monto) - abonado;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fechaGasto = new Date(g.fecha + "T00:00:00");
    const diasAntiguedad = Math.max(0, Math.floor((hoy - fechaGasto) / 86400000));
    let diasParaVencer = null;
    let vencido = false;
    if (g.fecha_limite_pago) {
      const fl = new Date(g.fecha_limite_pago + "T00:00:00");
      diasParaVencer = Math.floor((fl - hoy) / 86400000);
      vencido = diasParaVencer < 0 && saldo > 0.005;
    }
    return { abonado, saldo, diasAntiguedad, diasParaVencer, vencido };
  }

  function renderCreditosList() {
    const mostrarTodos = !state.filtroProyecto;
    const soloPendientes = $("creditos-solo-pendientes").checked;
    const provFiltro = $("creditos-filtro-proveedor").value;

    const todosCredito = gastosFiltrados()
      .filter((g) => g.metodo_pago === "Crédito")
      .map((g) => ({ ...g, _credito: creditoInfo(g) }));
    const todosPendientes = todosCredito.filter((g) => g._credito.saldo > 0.005);

    // Resumen: total adeudado + antigüedad (siempre sobre TODOS los
    // pendientes del filtro de proyecto activo, sin importar el filtro de
    // proveedor/solo-pendientes de la lista de abajo).
    const totalAdeudado = todosPendientes.reduce((s, g) => s + g._credito.saldo, 0);
    $("creditos-total-adeudado").textContent = fmt(totalAdeudado);
    const buckets = { b1: 0, b2: 0, b3: 0 };
    todosPendientes.forEach((g) => {
      if (g._credito.diasAntiguedad <= 30) buckets.b1 += g._credito.saldo;
      else if (g._credito.diasAntiguedad <= 60) buckets.b2 += g._credito.saldo;
      else buckets.b3 += g._credito.saldo;
    });
    $("creditos-bucket-1").textContent = fmt(buckets.b1);
    $("creditos-bucket-2").textContent = fmt(buckets.b2);
    $("creditos-bucket-3").textContent = fmt(buckets.b3);

    // Adeudado por proveedor
    const porProveedor = new Map();
    todosPendientes.forEach((g) => {
      const nombre = g.proveedores?.nombre_empresa || g.proveedor_texto || "Sin proveedor";
      porProveedor.set(nombre, (porProveedor.get(nombre) || 0) + g._credito.saldo);
    });
    const provOrdenados = [...porProveedor.entries()].sort((a, b) => b[1] - a[1]);
    $("creditos-por-proveedor").innerHTML = provOrdenados.length
      ? provOrdenados
          .map(
            ([nombre, saldo]) => `
        <div class="flex justify-between text-sm py-1 border-b border-slate-100 last:border-0">
          <span class="text-slate-600">${esc(nombre)}</span>
          <span class="font-medium text-slate-900">${fmt(saldo)}</span>
        </div>`
          )
          .join("")
      : '<p class="text-xs text-slate-400">Sin deudas pendientes.</p>';

    // Opciones del filtro de proveedor (a partir de los proveedores que sí
    // tienen algún gasto a crédito, no el catálogo completo)
    const provsEnCreditos = [
      ...new Set(todosCredito.map((g) => g.proveedores?.nombre_empresa || g.proveedor_texto).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "es"));
    const provFiltroActual = $("creditos-filtro-proveedor").value;
    $("creditos-filtro-proveedor").innerHTML =
      '<option value="">Todos los proveedores</option>' +
      provsEnCreditos.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    $("creditos-filtro-proveedor").value = provFiltroActual;

    // Lista (aplica los dos filtros: proveedor y solo-pendientes)
    let gastos = todosCredito;
    if (soloPendientes) gastos = gastos.filter((g) => g._credito.saldo > 0.005);
    if (provFiltro) gastos = gastos.filter((g) => (g.proveedores?.nombre_empresa || g.proveedor_texto || "") === provFiltro);
    gastos.sort((a, b) => {
      if (a._credito.vencido !== b._credito.vencido) return a._credito.vencido ? -1 : 1;
      return b._credito.diasAntiguedad - a._credito.diasAntiguedad;
    });

    const cont = $("lista-creditos");
    $("lista-creditos-vacia").classList.toggle("hidden", gastos.length > 0);
    cont.innerHTML = gastos
      .map((g) => {
        const c = g._credito;
        const proveedor = g.proveedores?.nombre_empresa || g.proveedor_texto || "Sin proveedor";
        const proyectoTag =
          mostrarTodos && g.proyectos?.nombre
            ? `<span class="inline-block text-[10px] font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 mr-1 align-middle">${esc(g.proyectos.nombre)}</span>`
            : "";
        let fechaLimiteBadge = "";
        if (g.fecha_limite_pago && c.saldo > 0.005) {
          fechaLimiteBadge = c.vencido
            ? `<span class="inline-block text-[10px] font-medium text-red-700 bg-red-50 rounded px-1.5 py-0.5 ml-1">vencido hace ${Math.abs(c.diasParaVencer)}d</span>`
            : `<span class="inline-block text-[10px] font-medium text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 ml-1">vence en ${c.diasParaVencer}d</span>`;
        }
        const pagadoBadge =
          c.saldo <= 0.005
            ? '<span class="inline-block text-[10px] font-medium text-green-700 bg-green-50 rounded px-1.5 py-0.5 ml-1">pagado</span>'
            : "";
        const abonosOrdenados = (g.abonos_credito || []).slice().sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
        return `
        <div class="credito-item bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <button class="credito-toggle w-full text-left flex justify-between items-start">
            <div class="min-w-0 pr-2">
              <p class="font-medium text-slate-900 truncate">${proyectoTag}${esc(proveedor)}</p>
              <p class="text-xs text-slate-500 truncate">${esc(g.descripcion || g.categorias?.nombre || "")}</p>
              <p class="text-xs text-slate-400">${fmtFecha(g.fecha)} · ${c.diasAntiguedad}d de antigüedad${fechaLimiteBadge}${pagadoBadge}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-xs text-slate-400">${fmt(g.monto)} original</p>
              <p class="font-semibold ${c.saldo > 0.005 ? "text-red-600" : "text-green-600"}">${fmt(c.saldo)}</p>
            </div>
          </button>
          <div class="credito-detalle hidden mt-3 pt-3 border-t border-slate-100">
            <div class="space-y-1 mb-3">
              ${
                abonosOrdenados.length
                  ? abonosOrdenados
                      .map(
                        (a) => `
                <div class="flex justify-between items-center text-xs text-slate-600">
                  <span>${fmtFecha(a.fecha)}${a.notas ? " · " + esc(a.notas) : ""}</span>
                  <span class="flex items-center gap-2">
                    <span class="font-medium text-slate-800">${fmt(a.monto)}</span>
                    <button class="abono-delete-btn text-slate-400 hover:text-red-600" data-id="${a.id}">🗑️</button>
                  </span>
                </div>`
                      )
                      .join("")
                  : '<p class="text-xs text-slate-400">Sin abonos todavía.</p>'
              }
            </div>
            ${
              g._pendiente
                ? '<p class="text-xs text-amber-600">Este gasto todavía no se sube (sin internet) — los abonos se podrán registrar en cuanto se sincronice.</p>'
                : c.saldo > 0.005
                ? `
            <form class="abono-form flex flex-wrap items-end gap-2" data-gasto-id="${g.id}">
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">Fecha</label>
                <input type="date" class="abono-fecha rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value="${new Date()
                  .toISOString()
                  .slice(0, 10)}" />
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">Monto</label>
                <input type="number" step="0.01" min="0.01" max="${c.saldo.toFixed(
                  2
                )}" class="abono-monto rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-28" placeholder="0.00" />
              </div>
              <div class="flex-1 min-w-[120px]">
                <label class="block text-[11px] text-slate-500 mb-1">Notas (opcional)</label>
                <input type="text" class="abono-notas rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-full" />
              </div>
              <button type="submit" class="bg-brand text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-brand-dark">Registrar abono</button>
            </form>`
                : ""
            }
          </div>
        </div>`;
      })
      .join("");

    cont.querySelectorAll(".credito-toggle").forEach((el) => {
      el.addEventListener("click", () => {
        el.parentElement.querySelector(".credito-detalle").classList.toggle("hidden");
      });
    });

    cont.querySelectorAll(".abono-delete-btn").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (!confirm("¿Eliminar este abono? El saldo pendiente de la deuda vuelve a subir.")) return;
        try {
          await DATA.deleteAbonoCredito(el.dataset.id);
          toast("Abono eliminado");
          await refreshGastos();
        } catch (err) {
          toast("Error al eliminar abono: " + err.message, true);
        }
      });
    });

    cont.querySelectorAll(".abono-form").forEach((form) => {
      form.addEventListener("click", (ev) => ev.stopPropagation());
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const gastoId = form.dataset.gastoId;
        const fecha = form.querySelector(".abono-fecha").value;
        const monto = parseFloat(form.querySelector(".abono-monto").value);
        const notas = form.querySelector(".abono-notas").value.trim() || null;
        if (!monto || monto <= 0) {
          toast("Pon un monto válido", true);
          return;
        }
        try {
          await DATA.addAbonoCredito({
            gasto_id: gastoId,
            fecha,
            monto,
            notas,
            registrado_por: state.currentUser,
          });
          toast("Abono registrado");
          await refreshGastos();
        } catch (err) {
          toast("Error al registrar abono: " + err.message, true);
        }
      });
    });
  }

  $("creditos-filtro-proveedor").addEventListener("change", renderCreditosList);
  $("creditos-solo-pendientes").addEventListener("change", renderCreditosList);

  // -------------------- ENTRADAS --------------------
  function renderEntradasList() {
    const mostrarTodos = !state.filtroProyecto;
    const entradas = entradasFiltradas();
    const cont = $("lista-entradas");
    $("lista-entradas-vacia").classList.toggle("hidden", entradas.length > 0);
    cont.innerHTML = entradas
      .map((e) => {
        const proyectoTag =
          mostrarTodos && e.proyectos?.nombre
            ? `<span class="inline-block text-[10px] font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 mr-1 align-middle">${esc(e.proyectos.nombre)}</span>`
            : "";
        const pendienteTag = e._pendiente
          ? '<span class="inline-block text-[10px] font-medium text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mr-1 align-middle">⏳ sin subir</span>'
          : "";
        let ivaTag = "";
        if (e.con_iva) {
          const { iva } = desgloseIva(Number(e.monto));
          ivaTag = `<span class="inline-block text-[10px] font-medium text-slate-600 bg-slate-100 rounded px-1.5 py-0.5 mr-1 align-middle">IVA ${fmt(iva)}</span>`;
        }
        return `
      <button data-id="${e.id}" data-pendiente="${e._pendiente ? 1 : 0}" class="entrada-item w-full text-left bg-white rounded-xl border border-slate-200 shadow-sm p-3 hover:border-slate-300 transition">
        <div class="flex justify-between items-start">
          <div class="min-w-0 pr-2">
            <p class="font-medium text-slate-900 truncate">${proyectoTag}${pendienteTag}${ivaTag}${esc(e.concepto || "Entrada")}</p>
            <p class="text-xs text-slate-400">${fmtFecha(e.fecha)}${e.aportado_por ? " · aportó " + esc(e.aportado_por) : ""}</p>
          </div>
          <p class="font-semibold" style="color:#0ca30c">${fmt(e.monto)}</p>
        </div>
      </button>`;
      })
      .join("");
    cont.querySelectorAll(".entrada-item").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.dataset.pendiente === "1") {
          toast("Esta entrada se está subiendo, espera un momento antes de editarla", true);
          return;
        }
        openEntradaForm(el.dataset.id);
      });
    });
  }

  $("entrada-add-open-btn").addEventListener("click", () => openEntradaForm(null));
  $("entrada-form-back-btn").addEventListener("click", () => {
    showView("dashboard");
  });

  function rememberProyecto(id) {
    const p = state.proyectos.find((x) => x.id === id);
    if (p) {
      state.currentProject = p;
      localStorage.setItem("romor_project", JSON.stringify(p));
    }
  }

  async function openEntradaForm(id) {
    $("entrada-form-error").classList.add("hidden");
    $("entrada-aportador").innerHTML = state.integrantes.map((i) => `<option value="${esc(i.nombre)}">${esc(i.nombre)}</option>`).join("");
    $("entrada-proyecto").innerHTML = state.proyectos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");

    if (id) {
      $("entrada-form-title").textContent = "Editar entrada";
      $("entrada-delete-btn").classList.remove("hidden");
      const e = state.entradas.find((x) => x.id === id) || (await DATA.getEntrada(id));
      $("entrada-id").value = e.id;
      $("entrada-proyecto").value = e.proyecto_id || defaultProyectoId();
      $("entrada-monto").value = e.monto;
      $("entrada-fecha").value = e.fecha;
      $("entrada-concepto").value = e.concepto || "";
      $("entrada-aportador").value = e.aportado_por || "";
      $("entrada-notas").value = e.notas || "";
      $("entrada-con-iva").checked = !!e.con_iva;
      actualizarDesgloseIvaEntrada();
    } else {
      $("entrada-form-title").textContent = "Nueva entrada";
      $("entrada-delete-btn").classList.add("hidden");
      $("entrada-id").value = "";
      $("entrada-proyecto").value = defaultProyectoId();
      $("entrada-monto").value = "";
      $("entrada-fecha").value = new Date().toISOString().slice(0, 10);
      $("entrada-concepto").value = "";
      $("entrada-aportador").value = state.currentUser;
      $("entrada-notas").value = "";
      $("entrada-con-iva").checked = false;
      actualizarDesgloseIvaEntrada();
    }
    showView("form-entrada");
  }

  function actualizarDesgloseIvaEntrada() {
    const monto = parseFloat($("entrada-monto").value);
    const p = $("entrada-iva-desglose");
    if ($("entrada-con-iva").checked && monto > 0) {
      const { subtotal, iva } = desgloseIva(monto);
      p.textContent = `Subtotal: ${fmt(subtotal)} · IVA: ${fmt(iva)}`;
      p.classList.remove("hidden");
    } else {
      p.classList.add("hidden");
    }
  }
  $("entrada-monto").addEventListener("input", actualizarDesgloseIvaEntrada);
  $("entrada-con-iva").addEventListener("change", actualizarDesgloseIvaEntrada);

  $("form-entrada").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("entrada-form-error").classList.add("hidden");
    const btn = $("entrada-save-btn");
    btn.disabled = true;
    btn.textContent = "Guardando...";
    try {
      const proyectoId = $("entrada-proyecto").value || defaultProyectoId() || null;
      const payload = {
        proyecto_id: proyectoId,
        monto: parseFloat($("entrada-monto").value),
        fecha: $("entrada-fecha").value,
        concepto: $("entrada-concepto").value.trim() || null,
        aportado_por: $("entrada-aportador").value || null,
        capturado_por: state.currentUser,
        notas: $("entrada-notas").value.trim() || null,
        con_iva: $("entrada-con-iva").checked,
      };
      const id = $("entrada-id").value || null;

      if (!navigator.onLine && !id) {
        // Sin internet: guardamos la entrada en una cola local y se sube sola
        // en cuanto vuelva la conexión (no requiere ningún archivo).
        const localId = queueOutbox("entrada", payload);
        if (proyectoId) rememberProyecto(proyectoId);
        addPendingEntradaToState(payload, localId);
        toast("Entrada guardada sin conexión — se subirá sola");
        showView("dashboard");
        renderResumen();
        renderEntradasList();
        return;
      }

      await DATA.saveEntrada(payload, id);
      if (proyectoId) rememberProyecto(proyectoId);
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

  // -------------------- DOCUMENTOS DEL PROYECTO --------------------
  function renderDocumentosList() {
    const mostrarTodos = !state.filtroProyecto;
    const documentos = documentosFiltrados();
    const cont = $("lista-documentos");
    $("lista-documentos-vacia").classList.toggle("hidden", documentos.length > 0);
    cont.innerHTML = documentos
      .map((d) => {
        const proyectoTag =
          mostrarTodos && d.proyectos?.nombre
            ? `<span class="inline-block text-[10px] font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 mr-1 align-middle">${esc(d.proyectos.nombre)}</span>`
            : "";
        return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex justify-between items-center gap-2">
          <a href="${esc(d.url)}" target="_blank" rel="noopener" class="min-w-0 flex-1">
            <p class="font-medium text-slate-900 truncate">${proyectoTag}📄 ${esc(d.nombre)}</p>
            <p class="text-xs text-slate-500">${esc(d.tipo || "Documento")}${d.subido_por ? " · subió " + esc(d.subido_por) : ""}</p>
          </a>
          <button data-id="${d.id}" class="documento-delete-btn shrink-0 text-slate-400 hover:text-red-600 text-lg px-1">🗑️</button>
        </div>`;
      })
      .join("");
    cont.querySelectorAll(".documento-delete-btn").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!confirm("¿Eliminar este documento? Esta acción no se puede deshacer.")) return;
        try {
          await DATA.deleteDocumento(el.dataset.id);
          state.documentos = state.documentos.filter((d) => d.id !== el.dataset.id);
          toast("Documento eliminado");
          renderDocumentosList();
        } catch (err) {
          toast("Error al eliminar: " + err.message, true);
        }
      });
    });
  }

  $("documento-add-open-btn").addEventListener("click", () => openDocumentoForm());
  $("documento-form-back-btn").addEventListener("click", () => showView("dashboard"));

  function openDocumentoForm() {
    $("documento-form-error").classList.add("hidden");
    $("documento-proyecto").innerHTML = state.proyectos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
    $("documento-proyecto").value = defaultProyectoId();
    $("documento-nombre").value = "";
    $("documento-tipo").value = "Contrato";
    $("documento-archivo").value = "";
    showView("documento-form");
  }

  $("form-documento").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("documento-form-error").classList.add("hidden");
    if (!navigator.onLine) {
      $("documento-form-error").textContent = "Necesitas conexión a internet para subir un documento.";
      $("documento-form-error").classList.remove("hidden");
      return;
    }
    const btn = $("documento-save-btn");
    btn.disabled = true;
    btn.textContent = "Subiendo...";
    try {
      const file = $("documento-archivo").files[0];
      if (!file) throw new Error("Selecciona un archivo.");
      const up = await DATA.uploadComprobante(file);
      const payload = {
        proyecto_id: $("documento-proyecto").value || defaultProyectoId() || null,
        nombre: $("documento-nombre").value.trim() || file.name,
        tipo: $("documento-tipo").value || null,
        url: up.url,
        subido_por: state.currentUser,
      };
      await DATA.addDocumento(payload);
      toast("Documento subido");
      showView("dashboard");
      state.documentos = await DATA.getDocumentos();
      renderDocumentosList();
    } catch (err) {
      $("documento-form-error").textContent = "Error al subir: " + err.message;
      $("documento-form-error").classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Subir";
    }
  });

  // -------------------- BITÁCORA DE AVANCE --------------------
  function renderBitacoraList() {
    const mostrarTodos = !state.filtroProyecto;
    const bitacora = bitacoraFiltrada();
    const cont = $("lista-bitacora");
    $("lista-bitacora-vacia").classList.toggle("hidden", bitacora.length > 0);
    cont.innerHTML = bitacora
      .map((b) => {
        const proyectoTag =
          mostrarTodos && b.proyectos?.nombre
            ? `<span class="inline-block text-[10px] font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 mr-1 align-middle">${esc(b.proyectos.nombre)}</span>`
            : "";
        const pendienteTag = b._pendiente
          ? '<span class="inline-block text-[10px] font-medium text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mr-1 align-middle">⏳ sin subir</span>'
          : "";
        const fotos = (b.fotos || [])
          .map(
            (url) =>
              `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" class="w-16 h-16 object-cover rounded-lg border border-slate-200" /></a>`
          )
          .join("");
        return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div class="flex justify-between items-start gap-2">
            <p class="text-xs text-slate-400 mb-1">${proyectoTag}${pendienteTag}${fmtFecha(b.fecha)}${b.capturado_por ? " · " + esc(b.capturado_por) : ""}</p>
            <button data-id="${esc(b.id)}" class="bitacora-delete-btn shrink-0 text-slate-400 hover:text-red-600 text-lg px-1 leading-none">🗑️</button>
          </div>
          ${b.nota ? `<p class="text-sm text-slate-800 mb-2">${esc(b.nota)}</p>` : ""}
          ${fotos ? `<div class="flex gap-2 flex-wrap">${fotos}</div>` : ""}
        </div>`;
      })
      .join("");
    cont.querySelectorAll(".bitacora-delete-btn").forEach((el) => {
      el.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este avance de bitácora? Esta acción no se puede deshacer.")) return;
        const id = el.dataset.id;
        const entrada = state.bitacora.find((b) => b.id === id);
        try {
          if (entrada?._pendiente) {
            // Todavía no se subió a Supabase (esperando conexión) — solo hay
            // que quitarlo de la cola local y del estado.
            setOutbox(getOutbox().filter((item) => item.localId !== id));
            updateOfflineBanner();
          } else {
            await DATA.deleteBitacoraEntry(id);
          }
          state.bitacora = state.bitacora.filter((b) => b.id !== id);
          toast("Avance eliminado");
          renderBitacoraList();
        } catch (err) {
          toast("Error al eliminar: " + err.message, true);
        }
      });
    });
  }

  $("bitacora-add-open-btn").addEventListener("click", () => openBitacoraForm());
  $("bitacora-form-back-btn").addEventListener("click", () => showView("dashboard"));

  function openBitacoraForm() {
    $("bitacora-form-error").classList.add("hidden");
    $("bitacora-proyecto").innerHTML = state.proyectos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
    $("bitacora-proyecto").value = defaultProyectoId();
    $("bitacora-fecha").value = new Date().toISOString().slice(0, 10);
    $("bitacora-nota").value = "";
    $("bitacora-fotos").value = "";
    showView("bitacora-form");
  }

  $("form-bitacora").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("bitacora-form-error").classList.add("hidden");
    const btn = $("bitacora-save-btn");
    btn.disabled = true;
    btn.textContent = "Guardando...";
    try {
      const proyectoId = $("bitacora-proyecto").value || defaultProyectoId() || null;
      const payload = {
        proyecto_id: proyectoId,
        fecha: $("bitacora-fecha").value,
        nota: $("bitacora-nota").value.trim() || null,
        fotos: [],
        capturado_por: state.currentUser,
      };
      const files = Array.from($("bitacora-fotos").files || []);

      if (!navigator.onLine) {
        // Sin internet no se pueden subir fotos: se guarda solo la nota en la
        // cola local y se sube en cuanto vuelva la conexión.
        if (files.length > 0) {
          toast("Sin internet: las fotos no se subieron, agrégalas después editando el avance", true);
        }
        const localId = queueOutbox("bitacora", payload);
        if (proyectoId) rememberProyecto(proyectoId);
        state.bitacora.unshift({
          id: localId,
          ...payload,
          proyectos: state.proyectos.find((p) => p.id === proyectoId) || null,
          _pendiente: true,
        });
        toast("Avance guardado sin conexión — se subirá solo");
        showView("dashboard");
        renderBitacoraList();
        return;
      }

      if (files.length > 0) {
        const subidas = await Promise.all(files.map((f) => DATA.uploadComprobante(f)));
        payload.fotos = subidas.map((s) => s.url);
      }

      await DATA.addBitacoraEntry(payload);
      if (proyectoId) rememberProyecto(proyectoId);
      toast("Avance guardado");
      showView("dashboard");
      state.bitacora = await DATA.getBitacora();
      renderBitacoraList();
    } catch (err) {
      $("bitacora-form-error").textContent = "Error al guardar: " + err.message;
      $("bitacora-form-error").classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  });

  // -------------------- REPORTE PDF DE BITÁCORA (por rango de fechas) --------------------
  function formatoImagenDesdeDataUrl(dataUrl) {
    const m = /^data:image\/(png|jpe?g|webp)/i.exec(dataUrl || "");
    if (!m) return "JPEG";
    const tipo = m[1].toLowerCase();
    if (tipo === "png") return "PNG";
    if (tipo === "webp") return "WEBP";
    return "JPEG";
  }

  function tamañoImagen(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  $("bitacora-pdf-btn").addEventListener("click", async () => {
    const btn = $("bitacora-pdf-btn");
    const desde = $("bitacora-pdf-desde").value || null;
    const hasta = $("bitacora-pdf-hasta").value || null;
    if (desde && hasta && desde > hasta) {
      toast("La fecha 'Desde' no puede ser después de 'Hasta'", true);
      return;
    }

    const mostrarTodos = !state.filtroProyecto;
    let entradas = bitacoraFiltrada();
    if (desde) entradas = entradas.filter((b) => b.fecha >= desde);
    if (hasta) entradas = entradas.filter((b) => b.fecha <= hasta);
    // Orden cronológico (más antiguo primero), como se lee una bitácora real.
    entradas = [...entradas].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

    if (entradas.length === 0) {
      toast("No hay avances de bitácora en ese rango de fechas", true);
      return;
    }

    btn.disabled = true;
    try {
      const nombreProyecto = mostrarTodos
        ? "Todos los proyectos"
        : state.proyectos.find((p) => p.id === state.filtroProyecto)?.nombre || "Proyecto";

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "pt" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginX = 40;
      let y = 50;

      try {
        const logoData = await imageUrlToDataURL("assets/logo.png");
        doc.addImage(logoData, "PNG", marginX, 24, 90, 27);
      } catch (err) {
        console.warn("No se pudo cargar el logo para el PDF:", err);
      }

      doc.setFontSize(16);
      doc.setTextColor(20, 20, 20);
      doc.text("Bitácora de avance de obra", pageWidth - marginX, 38, { align: "right" });
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(nombreProyecto, pageWidth - marginX, 54, { align: "right" });
      const rangoTxt =
        desde || hasta ? `${desde ? fmtFecha(desde) : "inicio"} — ${hasta ? fmtFecha(hasta) : "hoy"}` : "Todas las fechas";
      doc.text(rangoTxt, pageWidth - marginX, 68, { align: "right" });
      doc.text("Generado el " + new Date().toLocaleDateString("es-MX"), pageWidth - marginX, 82, { align: "right" });

      y = 108;
      doc.setDrawColor(219, 0, 46);
      doc.setLineWidth(1);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 20;

      // Fotos más grandes que antes (150x150 en vez de 110x110) y en una
      // columna a la izquierda; la nota va en una segunda columna a la
      // derecha de las fotos, en vez de debajo — así se lee más como un
      // reporte de dos columnas y no se desperdicia tanto espacio en blanco.
      const anchoFoto = 150;
      const altoFoto = 150;
      const gapFoto = 10;
      const gapColumnas = 20;

      // Agrupar por proyecto cuando el reporte incluye "todos los proyectos",
      // para que el nombre del proyecto aparezca UNA sola vez (como encabezado
      // de sección) y no se repita en cada avance de bitácora.
      let gruposEntradas;
      if (mostrarTodos) {
        const porProyecto = new Map();
        for (const b of entradas) {
          const key = b.proyecto_id || "sin-proyecto";
          if (!porProyecto.has(key)) {
            porProyecto.set(key, { nombre: b.proyectos?.nombre || "Proyecto", items: [] });
          }
          porProyecto.get(key).items.push(b);
        }
        gruposEntradas = [...porProyecto.values()].sort((a, b2) => a.nombre.localeCompare(b2.nombre, "es"));
      } else {
        gruposEntradas = [{ nombre: nombreProyecto, items: entradas }];
      }

      for (const grupo of gruposEntradas) {
        if (mostrarTodos) {
          if (y > pageHeight - 110) {
            doc.addPage();
            y = 50;
          }
          doc.setFontSize(13);
          doc.setFont(undefined, "bold");
          doc.setTextColor(20, 20, 20);
          doc.text(grupo.nombre, marginX, y);
          y += 8;
          doc.setDrawColor(219, 0, 46);
          doc.setLineWidth(1.3);
          doc.line(marginX, y, marginX + 140, y);
          doc.setFont(undefined, "normal");
          y += 20;
        }

        for (const b of grupo.items) {
          const fotos = b.fotos || [];
          // Hasta 2 fotos por fila dentro de la columna de fotos (si hay 3 o
          // más), si no, una sola columna (más ancha para la nota).
          const fotosPorFilaCol = fotos.length >= 3 ? 2 : 1;
          const numFilasFoto = fotos.length > 0 ? Math.ceil(fotos.length / fotosPorFilaCol) : 0;
          const colFotoWidth = fotos.length > 0 ? fotosPorFilaCol * anchoFoto + (fotosPorFilaCol - 1) * gapFoto : 0;
          const textX = marginX + colFotoWidth + (fotos.length > 0 ? gapColumnas : 0);
          const textWidth = pageWidth - marginX - textX;

          doc.setFontSize(10);
          const lineas = b.nota ? doc.splitTextToSize(b.nota, textWidth) : [];

          const altoFotos = numFilasFoto > 0 ? numFilasFoto * altoFoto + (numFilasFoto - 1) * gapFoto : 0;
          const altoTexto = lineas.length * 13;
          const altoFila = Math.max(altoFotos, altoTexto);

          // Salto de página si la entrada completa (encabezado + fotos/nota)
          // no cabe entera — así fotos y texto de una misma entrada siempre
          // quedan alineados en la misma página.
          if (y + 18 + altoFila > pageHeight - 30) {
            doc.addPage();
            y = 50;
          }

          doc.setFontSize(12);
          doc.setTextColor(20, 20, 20);
          let encabezado = fmtFecha(b.fecha);
          if (b.capturado_por) encabezado += "  ·  " + b.capturado_por;
          doc.text(encabezado, marginX, y);
          y += 18;

          const yFila = y;

          if (fotos.length > 0) {
            let x = marginX;
            let yFoto = yFila;
            let col = 0;
            for (let i = 0; i < fotos.length; i++) {
              try {
                const dataUrl = await imageUrlToDataURL(fotos[i]);
                const { width: iw, height: ih } = await tamañoImagen(dataUrl);
                const escala = Math.min(anchoFoto / iw, altoFoto / ih);
                const w = iw * escala;
                const h = ih * escala;
                doc.addImage(
                  dataUrl,
                  formatoImagenDesdeDataUrl(dataUrl),
                  x + (anchoFoto - w) / 2,
                  yFoto + (altoFoto - h) / 2,
                  w,
                  h
                );
              } catch (err) {
                console.warn("No se pudo cargar una foto de bitácora para el PDF:", err);
              }
              col++;
              if (col === fotosPorFilaCol) {
                col = 0;
                x = marginX;
                yFoto += altoFoto + gapFoto;
              } else {
                x += anchoFoto + gapFoto;
              }
            }
          }

          if (lineas.length > 0) {
            doc.setFontSize(10);
            doc.setTextColor(60, 60, 60);
            let yTexto = yFila;
            for (const linea of lineas) {
              doc.text(linea, textX, yTexto);
              yTexto += 13;
            }
          }

          y = yFila + altoFila + 14;
          doc.setDrawColor(230, 230, 230);
          doc.setLineWidth(0.5);
          doc.line(marginX, y, pageWidth - marginX, y);
          y += 18;
        }
      }

      const sufijoRango = desde || hasta ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : "";
      const nombreArchivo = (mostrarTodos ? "todos_los_proyectos" : nombreProyecto).replace(/[^a-z0-9]+/gi, "_");
      doc.save(`bitacora_${nombreArchivo}${sufijoRango}.pdf`);
    } catch (err) {
      toast("No se pudo generar el PDF de bitácora: " + err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // -------------------- EXPORTAR A EXCEL --------------------
  $("export-excel-btn").addEventListener("click", () => {
    try {
      const mostrarTodos = !state.filtroProyecto;
      const gastos = gastosFiltrados();
      const entradas = entradasFiltradas();
      const gastosRows = gastos.map((g) => ({
        ...(mostrarTodos ? { Proyecto: g.proyectos?.nombre || "" } : {}),
        Fecha: g.fecha,
        Partida: g.categorias?.nombre || "",
        Proveedor: g.proveedores?.nombre_empresa || g.proveedor_texto || "",
        Descripción: g.descripcion || "",
        Monto: Number(g.monto),
        "Subtotal (sin IVA)": g.con_iva ? Number(desgloseIva(Number(g.monto)).subtotal.toFixed(2)) : "",
        "IVA (16%)": g.con_iva ? Number(desgloseIva(Number(g.monto)).iva.toFixed(2)) : "",
        "Método de pago": g.metodo_pago || "",
        "Pagó": g.pagado_por || "",
        "Capturó": g.capturado_por || "",
        Notas: g.notas || "",
        "Saldo pendiente (crédito)":
          g.metodo_pago === "Crédito"
            ? Number(g.monto) - (g.abonos_credito || []).reduce((s, a) => s + Number(a.monto), 0)
            : "",
        "Fecha límite de pago": g.fecha_limite_pago || "",
      }));
      const entradasRows = entradas.map((e) => ({
        ...(mostrarTodos ? { Proyecto: e.proyectos?.nombre || "" } : {}),
        Fecha: e.fecha,
        Concepto: e.concepto || "",
        Monto: Number(e.monto),
        "Subtotal (sin IVA)": e.con_iva ? Number(desgloseIva(Number(e.monto)).subtotal.toFixed(2)) : "",
        "IVA (16%)": e.con_iva ? Number(desgloseIva(Number(e.monto)).iva.toFixed(2)) : "",
        "Aportó": e.aportado_por || "",
        "Capturó": e.capturado_por || "",
        Notas: e.notas || "",
      }));
      const totalGastos = gastos.reduce((s, g) => s + Number(g.monto), 0);
      const totalEntradas = entradas.reduce((s, e) => s + Number(e.monto), 0);
      const resumenRows = [
        { Concepto: "Total entradas", Monto: totalEntradas },
        { Concepto: "Total gastos", Monto: totalGastos },
        { Concepto: "Saldo", Monto: totalEntradas - totalGastos },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumenRows), "Resumen");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastosRows), "Gastos");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entradasRows), "Entradas");

      const nombreProyecto = mostrarTodos
        ? "todos_los_proyectos"
        : (state.proyectos.find((p) => p.id === state.filtroProyecto)?.nombre || "proyecto").replace(
            /[^a-z0-9]+/gi,
            "_"
          );
      XLSX.writeFile(wb, `gastos_${nombreProyecto}.xlsx`);
    } catch (err) {
      toast("No se pudo exportar: " + err.message, true);
    }
  });

  // -------------------- EXPORTAR REPORTE PDF --------------------
  async function imageUrlToDataURL(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  $("export-pdf-btn").addEventListener("click", async () => {
    const btn = $("export-pdf-btn");
    btn.disabled = true;
    try {
      const mostrarTodos = !state.filtroProyecto;
      const gastos = gastosFiltrados();
      const entradas = entradasFiltradas();
      const totalGastos = gastos.reduce((s, g) => s + Number(g.monto), 0);
      const totalEntradas = entradas.reduce((s, e) => s + Number(e.monto), 0);
      const saldo = totalEntradas - totalGastos;
      const nombreProyecto = mostrarTodos
        ? "Todos los proyectos"
        : state.proyectos.find((p) => p.id === state.filtroProyecto)?.nombre || "Proyecto";

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "pt" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginX = 40;
      let y = 50;

      try {
        const logoData = await imageUrlToDataURL("assets/logo.png");
        doc.addImage(logoData, "PNG", marginX, 24, 90, 27);
      } catch (err) {
        console.warn("No se pudo cargar el logo para el PDF:", err);
      }

      doc.setFontSize(16);
      doc.setTextColor(20, 20, 20);
      doc.text("Reporte de gastos de obra", pageWidth - marginX, 38, { align: "right" });
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(nombreProyecto, pageWidth - marginX, 54, { align: "right" });
      doc.text("Generado el " + new Date().toLocaleDateString("es-MX"), pageWidth - marginX, 68, { align: "right" });

      y = 96;
      doc.setDrawColor(219, 0, 46);
      doc.setLineWidth(1);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 24;

      doc.setFontSize(11);
      doc.setTextColor(30, 30, 30);
      doc.text(`Total entradas: ${fmt(totalEntradas)}`, marginX, y);
      y += 16;
      doc.text(`Total gastos: ${fmt(totalGastos)}`, marginX, y);
      y += 16;
      doc.setTextColor(...(saldo >= 0 ? [12, 163, 12] : [208, 59, 59]));
      doc.text(`Saldo: ${fmt(saldo)}`, marginX, y);
      doc.setTextColor(30, 30, 30);
      y += 26;

      const porCategoria = {};
      for (const g of gastos) {
        const nombre = g.categorias?.nombre || "Sin categoría";
        porCategoria[nombre] = (porCategoria[nombre] || 0) + Number(g.monto);
      }
      const filasCategoria = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
      if (filasCategoria.length > 0) {
        doc.setFontSize(12);
        doc.text("Gasto por partida", marginX, y);
        y += 8;
        doc.autoTable({
          startY: y,
          margin: { left: marginX, right: marginX },
          head: [["Partida", "Monto"]],
          body: filasCategoria.map(([nombre, monto]) => [nombre, fmt(monto)]),
          theme: "striped",
          headStyles: { fillColor: [219, 0, 46] },
          styles: { fontSize: 9 },
        });
        y = doc.lastAutoTable.finalY + 26;
      }

      const gastosHead = mostrarTodos
        ? ["Proyecto", "Fecha", "Partida", "Proveedor", "Descripción", "Monto"]
        : ["Fecha", "Partida", "Proveedor", "Descripción", "Monto"];
      const gastosBody = gastos.map((g) => {
        const row = [fmtFecha(g.fecha), g.categorias?.nombre || "", g.proveedores?.nombre_empresa || g.proveedor_texto || "", g.descripcion || "", fmt(g.monto)];
        if (mostrarTodos) row.unshift(g.proyectos?.nombre || "");
        return row;
      });
      if (gastosBody.length > 0) {
        if (y > pageHeight - 100) {
          doc.addPage();
          y = 50;
        }
        doc.setFontSize(12);
        doc.text("Gastos", marginX, y);
        y += 8;
        doc.autoTable({
          startY: y,
          margin: { left: marginX, right: marginX },
          head: [gastosHead],
          body: gastosBody,
          theme: "striped",
          headStyles: { fillColor: [219, 0, 46] },
          styles: { fontSize: 8 },
        });
        y = doc.lastAutoTable.finalY + 26;
      }

      const entradasHead = mostrarTodos ? ["Proyecto", "Fecha", "Concepto", "Aportó", "Monto"] : ["Fecha", "Concepto", "Aportó", "Monto"];
      const entradasBody = entradas.map((e) => {
        const row = [fmtFecha(e.fecha), e.concepto || "", e.aportado_por || "", fmt(e.monto)];
        if (mostrarTodos) row.unshift(e.proyectos?.nombre || "");
        return row;
      });
      if (entradasBody.length > 0) {
        if (y > pageHeight - 100) {
          doc.addPage();
          y = 50;
        }
        doc.setFontSize(12);
        doc.text("Entradas", marginX, y);
        y += 8;
        doc.autoTable({
          startY: y,
          margin: { left: marginX, right: marginX },
          head: [entradasHead],
          body: entradasBody,
          theme: "striped",
          headStyles: { fillColor: [219, 0, 46] },
          styles: { fontSize: 8 },
        });
      }

      const nombreArchivo = mostrarTodos ? "todos_los_proyectos" : nombreProyecto.replace(/[^a-z0-9]+/gi, "_");
      doc.save(`reporte_${nombreArchivo}.pdf`);
    } catch (err) {
      toast("No se pudo generar el PDF: " + err.message, true);
    } finally {
      btn.disabled = false;
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

  // Muestra/oculta el campo de "fecha límite de pago", solo relevante
  // cuando el método de pago elegido es "Crédito".
  function toggleCreditoFields() {
    $("gasto-credito-fields").classList.toggle("hidden", $("gasto-metodo").value !== "Crédito");
  }
  $("gasto-metodo").addEventListener("change", toggleCreditoFields);

  // Desglose de IVA (16%): el "monto" del gasto sigue siendo el total pagado
  // (no cambia ningún cálculo existente); esto solo muestra cuánto de ese
  // total corresponde a subtotal e IVA cuando el gasto marca "incluye IVA".
  function desgloseIva(monto) {
    const subtotal = monto / 1.16;
    return { subtotal, iva: monto - subtotal };
  }
  function actualizarDesgloseIva() {
    const monto = parseFloat($("gasto-monto").value);
    const p = $("gasto-iva-desglose");
    if ($("gasto-con-iva").checked && monto > 0) {
      const { subtotal, iva } = desgloseIva(monto);
      p.textContent = `Subtotal: ${fmt(subtotal)} · IVA: ${fmt(iva)}`;
      p.classList.remove("hidden");
    } else {
      p.classList.add("hidden");
    }
  }
  $("gasto-monto").addEventListener("input", actualizarDesgloseIva);
  $("gasto-con-iva").addEventListener("change", actualizarDesgloseIva);

  $("gasto-categoria").addEventListener("change", renderProveedorOptions);

  // Lista de documentos/comprobantes ya subidos de un gasto, dentro de su
  // formulario, cada uno con un botón para borrarlo individualmente (el
  // borrado es inmediato, no espera a que se guarde el formulario).
  function renderGastoDocumentos(docs) {
    const cont = $("gasto-documentos-lista");
    if (!docs || !docs.length) {
      cont.innerHTML = "";
      return;
    }
    cont.innerHTML = docs
      .map(
        (d) => `
      <div class="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5" data-doc-id="${d.id}">
        <a href="${d.url}" target="_blank" class="text-sm text-blue-600 underline truncate">${esc(d.nombre || "Documento")}</a>
        <button type="button" class="gasto-doc-delete-btn text-red-500 hover:text-red-700 text-sm shrink-0" data-id="${d.id}">🗑️</button>
      </div>`
      )
      .join("");
    cont.querySelectorAll(".gasto-doc-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este documento? Esta acción no se puede deshacer.")) return;
        try {
          await DATA.deleteGastoDocumento(btn.dataset.id);
          btn.closest("[data-doc-id]").remove();
          const gastoId = $("gasto-id").value;
          const g = state.gastos.find((x) => x.id === gastoId);
          if (g) g.gasto_documentos = (g.gasto_documentos || []).filter((d) => d.id !== btn.dataset.id);
          toast("Documento eliminado");
        } catch (err) {
          toast("No se pudo eliminar el documento: " + err.message, true);
        }
      });
    });
  }

  async function openForm(id) {
    fillSelects();
    $("form-error").classList.add("hidden");
    $("gasto-comprobante").value = "";
    renderGastoDocumentos([]);
    state.editingId = id;

    if (id) {
      $("form-title").textContent = "Editar gasto";
      $("gasto-delete-btn").classList.remove("hidden");
      const g = state.gastos.find((x) => x.id === id) || (await DATA.getGasto(id));
      $("gasto-id").value = g.id;
      $("gasto-proyecto").value = g.proyecto_id || defaultProyectoId();
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
      $("gasto-fecha-limite").value = g.fecha_limite_pago || "";
      toggleCreditoFields();
      $("gasto-con-iva").checked = !!g.con_iva;
      actualizarDesgloseIva();
      renderGastoDocumentos(g.gasto_documentos || []);
    } else {
      $("form-title").textContent = "Nuevo gasto";
      $("gasto-delete-btn").classList.add("hidden");
      $("gasto-id").value = "";
      $("gasto-proyecto").value = defaultProyectoId();
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
      $("gasto-fecha-limite").value = "";
      toggleCreditoFields();
      $("gasto-con-iva").checked = false;
      actualizarDesgloseIva();
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
      const proyectoId = $("gasto-proyecto").value || defaultProyectoId() || null;
      const payload = {
        proyecto_id: proyectoId,
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
        fecha_limite_pago: $("gasto-metodo").value === "Crédito" ? $("gasto-fecha-limite").value || null : null,
        con_iva: $("gasto-con-iva").checked,
      };

      // Si el usuario escribió un proveedor que no está en la lista, se
      // agrega automáticamente al directorio de proveedores (si hay
      // internet) para que quede disponible en futuros gastos, y el gasto
      // queda ligado a ese proveedor en vez de guardar solo el texto libre.
      if (navigator.onLine && payload.proveedor_texto && !payload.proveedor_id) {
        const nombreNuevo = payload.proveedor_texto;
        let match = state.proveedores.find(
          (p) => p.nombre_empresa.trim().toLowerCase() === nombreNuevo.toLowerCase()
        );
        if (!match) {
          try {
            match = await DATA.saveProveedor({
              nombre_empresa: nombreNuevo,
              categoria_id: payload.categoria_id || null,
            });
            state.proveedores = await DATA.getProveedores();
          } catch (err) {
            match = null; // si falla, se guarda el gasto con el texto libre como respaldo
          }
        }
        if (match) {
          payload.proveedor_id = match.id;
          payload.proveedor_texto = null;
        }
      }

      const id = $("gasto-id").value || null;
      const files = Array.from($("gasto-comprobante").files || []);

      if (!navigator.onLine && !id) {
        // Sin internet no se pueden subir documentos (requiere red); se
        // guarda el gasto en una cola local y se sube solo en cuanto vuelva
        // la conexión. Los documentos se pueden agregar después editando.
        if (files.length) {
          toast("Sin internet: los documentos no se subieron, agrégalos después editando el gasto", true);
        }
        const localId = queueOutbox("gasto", payload);
        if (proyectoId) rememberProyecto(proyectoId);
        addPendingGastoToState(payload, localId);
        toast("Gasto guardado sin conexión — se subirá solo");
        showView("dashboard");
        renderResumen();
        renderLista();
        return;
      }

      const saved = await DATA.saveGasto(payload, id);
      const gastoId = id || saved.id;

      if (files.length) {
        for (const file of files) {
          try {
            const up = await DATA.uploadComprobante(file);
            await DATA.addGastoDocumento({
              gasto_id: gastoId,
              url: up.url,
              nombre: up.nombre,
              subido_por: state.currentUser,
            });
          } catch (err) {
            toast(`No se pudo subir "${file.name}": ` + err.message, true);
          }
        }
      }

      if (proyectoId) rememberProyecto(proyectoId);
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
