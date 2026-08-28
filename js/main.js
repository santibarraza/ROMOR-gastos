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
    // Avance de bitácora que se está editando ahora mismo en
    // view-bitacora-form (null = se está dando de alta uno nuevo), y las
    // fotos que ya tenía guardadas ese avance (se puede quitar alguna antes
    // de guardar — ver renderBitacoraFotosActuales).
    editingBitacoraId: null,
    bitacoraFotosActuales: [],
    recordatorios: [],
    recordatoriosFiltro: "pendientes",
    currentUser: localStorage.getItem("romor_user") || null,
    // "Último proyecto usado": solo se usa para pre-seleccionar el proyecto
    // al crear un gasto/entrada nuevo. Ya NO bloquea el acceso al dashboard.
    currentProject: JSON.parse(localStorage.getItem("romor_project") || "null"),
    // Filtro de la vista general: "" = todos los proyectos juntos.
    filtroProyecto: "",
    editingId: null,
    // Impuestos del gasto que se está creando/editando en el formulario
    // ahora mismo (ver sección "IMPUESTOS DE GASTO" más abajo). Cada
    // elemento trae {tipo, nombre, es_retencion, porcentaje} y, si ya se
    // guardó en la base de datos, también un "id".
    formImpuestos: [],
    // Presupuesto por partida (ver sección "PRESUPUESTO POR PARTIDA" más
    // abajo). Cada elemento trae {id, proyecto_id, categoria_id, monto,
    // proyectos:{nombre}, categorias:{nombre}} tal como llega de Supabase.
    presupuestos: [],
    // Si no es null, la mini-forma de presupuesto está EDITANDO ese
    // registro (en vez de agregando uno nuevo).
    editingPresupuestoId: null,
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
        const nRecordatorios = state.recordatorios.filter((r) => r.proyecto_id === id).length;
        const nPresupuestos = state.presupuestos.filter((p) => p.proyecto_id === id).length;
        const detalle =
          nGastos || nEntradas || nDocumentos || nBitacora || nRecordatorios || nPresupuestos
            ? ` Esto borra PERMANENTEMENTE ${nGastos} gasto(s), ${nEntradas} entrada(s), ${nDocumentos} documento(s), ${nBitacora} avance(s) de bitácora, ${nRecordatorios} recordatorio(s) y ${nPresupuestos} presupuesto(s) de partida de este proyecto.`
            : " Este proyecto no tiene gastos, entradas, documentos, avances de bitácora, recordatorios ni presupuestos registrados.";
        if (!confirm(`¿Eliminar el proyecto "${nombre}"?${detalle} Esta acción no se puede deshacer.`)) return;
        try {
          await DATA.deleteProyecto(id);
          state.proyectos = state.proyectos.filter((p) => p.id !== id);
          state.gastos = state.gastos.filter((g) => g.proyecto_id !== id);
          state.entradas = state.entradas.filter((e) => e.proyecto_id !== id);
          state.documentos = state.documentos.filter((d) => d.proyecto_id !== id);
          state.bitacora = state.bitacora.filter((b) => b.proyecto_id !== id);
          state.recordatorios = state.recordatorios.filter((r) => r.proyecto_id !== id);
          state.presupuestos = state.presupuestos.filter((p) => p.proyecto_id !== id);
          renderRecordatoriosCard();
          renderPresupuesto();
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

  // -------------------- RECORDATORIOS --------------------
  // Tareas/trámites con fecha y un check para marcarlos hechos. Se muestran
  // en una tarjeta fija arriba del dashboard (visible sin importar la
  // pestaña o el filtro de proyecto activo), y hay una pantalla completa
  // para verlos todos, agregar, editar y borrar. Pueden estar ligados a un
  // proyecto o ser generales (proyecto_id null).
  function recordatorioEstado(r) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fecha = new Date(r.fecha + "T00:00:00");
    const dias = Math.round((fecha - hoy) / 86400000);
    let texto, clase;
    if (dias < 0) {
      texto = `vencido hace ${-dias}d`;
      clase = "text-red-700 bg-red-50";
    } else if (dias === 0) {
      texto = "hoy";
      clase = "text-red-700 bg-red-50";
    } else if (dias <= 3) {
      texto = `en ${dias}d`;
      clase = "text-amber-700 bg-amber-50";
    } else {
      texto = fmtFecha(r.fecha);
      clase = "text-slate-500 bg-slate-100";
    }
    return { dias, texto, clase };
  }

  function recordatorioRowHtml(r, { conProyecto }) {
    const estado = recordatorioEstado(r);
    const proyectoTag =
      conProyecto && r.proyectos?.nombre
        ? `<span class="inline-block shrink-0 text-[10px] font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 align-middle">${esc(r.proyectos.nombre)}</span>`
        : "";
    const fechaTag = r.hecho
      ? `<span class="inline-block shrink-0 text-[10px] font-medium text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 align-middle">✓ ${fmtFecha(r.fecha)}</span>`
      : `<span class="inline-block shrink-0 text-[10px] font-medium ${estado.clase} rounded px-1.5 py-0.5 align-middle">${estado.texto}</span>`;
    // El botón es flex (no solo su contenedor padre) para que el <span> del
    // título quede "blockificado" como hijo directo de un flex container —
    // así "truncate" (overflow/ellipsis) sí recorta el texto largo en vez
    // de desbordarse fuera de la tarjeta (un <span> normal, inline, ignora
    // text-overflow aunque tenga la clase "truncate").
    return `
      <div class="flex items-center gap-2 py-1 min-w-0" data-recordatorio-id="${r.id}">
        <input type="checkbox" class="recordatorio-check shrink-0 w-4 h-4 rounded border-slate-300" data-id="${r.id}" ${r.hecho ? "checked" : ""} />
        <button type="button" class="recordatorio-abrir min-w-0 flex-1 flex items-center gap-1 text-left" data-id="${r.id}">
          ${proyectoTag}
          <span class="text-sm ${r.hecho ? "text-slate-400 line-through" : "text-slate-800"} truncate min-w-0">${esc(r.titulo)}</span>
        </button>
        ${fechaTag}
      </div>`;
  }

  async function toggleRecordatorioHecho(id, hecho) {
    const r = state.recordatorios.find((x) => x.id === id);
    if (!r) return;
    const payload = {
      hecho,
      hecho_por: hecho ? state.currentUser : null,
      hecho_en: hecho ? new Date().toISOString() : null,
    };
    try {
      await DATA.saveRecordatorio(payload, id);
      Object.assign(r, payload);
      renderRecordatoriosCard();
      if ($("view-recordatorios").classList.contains("active")) renderRecordatoriosList();
    } catch (err) {
      toast("No se pudo actualizar el recordatorio: " + err.message, true);
    }
  }

  function renderRecordatoriosCard() {
    const pendientes = state.recordatorios.filter((r) => !r.hecho);
    const cont = $("recordatorios-lista-card");
    $("recordatorios-vacio-card").classList.toggle("hidden", pendientes.length > 0);
    const TOP_N = 5;
    cont.innerHTML = pendientes
      .slice(0, TOP_N)
      .map((r) => recordatorioRowHtml(r, { conProyecto: true }))
      .join("");
    if (pendientes.length > TOP_N) {
      cont.innerHTML += `<p class="text-xs text-slate-400 pt-1">+${pendientes.length - TOP_N} más — toca "Ver todos"</p>`;
    }
    cont.querySelectorAll(".recordatorio-check").forEach((el) => {
      el.addEventListener("click", (ev) => ev.stopPropagation());
      el.addEventListener("change", () => toggleRecordatorioHecho(el.dataset.id, el.checked));
    });
    cont.querySelectorAll(".recordatorio-abrir").forEach((el) => {
      el.addEventListener("click", () => {
        openRecordatoriosView();
        openRecordatorioForEdit(el.dataset.id);
      });
    });
  }

  $("recordatorios-ver-todos-btn").addEventListener("click", () => openRecordatoriosView());
  $("recordatorios-add-card-btn").addEventListener("click", () => {
    openRecordatoriosView();
    resetRecordatorioForm();
  });
  $("open-recordatorios-btn").addEventListener("click", () => openRecordatoriosView());
  $("recordatorios-back-btn").addEventListener("click", () => showView("dashboard"));

  function openRecordatoriosView() {
    setRecordatoriosFiltro(state.recordatoriosFiltro || "pendientes");
    resetRecordatorioForm();
    showView("recordatorios");
  }

  function setRecordatoriosFiltro(filtro) {
    state.recordatoriosFiltro = filtro;
    document.querySelectorAll(".recordatorios-filtro-btn").forEach((btn) => {
      const activo = btn.dataset.filtro === filtro;
      btn.className =
        "recordatorios-filtro-btn flex-1 rounded-lg py-2 text-sm font-medium " +
        (activo ? "bg-brand text-white" : "bg-white border border-slate-300 text-slate-600");
    });
    renderRecordatoriosList();
  }

  document.querySelectorAll(".recordatorios-filtro-btn").forEach((btn) => {
    btn.addEventListener("click", () => setRecordatoriosFiltro(btn.dataset.filtro));
  });

  function renderRecordatoriosList() {
    const filtro = state.recordatoriosFiltro;
    let lista = state.recordatorios;
    if (filtro === "pendientes") lista = lista.filter((r) => !r.hecho);
    else if (filtro === "hechos") lista = lista.filter((r) => r.hecho);
    const cont = $("lista-recordatorios");
    $("recordatorios-vacio").classList.toggle("hidden", lista.length > 0);
    cont.innerHTML = lista
      .map(
        (r) => `<div class="bg-white rounded-xl border border-slate-200 shadow-sm px-3">
          ${recordatorioRowHtml(r, { conProyecto: true })}
        </div>`
      )
      .join("");
    cont.querySelectorAll(".recordatorio-check").forEach((el) => {
      el.addEventListener("click", (ev) => ev.stopPropagation());
      el.addEventListener("change", () => toggleRecordatorioHecho(el.dataset.id, el.checked));
    });
    cont.querySelectorAll(".recordatorio-abrir").forEach((el) => {
      el.addEventListener("click", () => openRecordatorioForEdit(el.dataset.id));
    });
  }

  function proyectoOptionsRecordatorio(selectedId) {
    return (
      '<option value="">— General, no ligado a un proyecto —</option>' +
      state.proyectos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("")
    );
  }

  function resetRecordatorioForm() {
    $("recordatorio-form-title").textContent = "Agregar recordatorio";
    $("recordatorio-id").value = "";
    $("recordatorio-titulo").value = "";
    $("recordatorio-fecha").value = new Date().toISOString().slice(0, 10);
    $("recordatorio-proyecto").innerHTML = proyectoOptionsRecordatorio();
    $("recordatorio-proyecto").value = "";
    $("recordatorio-notas").value = "";
    $("recordatorio-form-error").classList.add("hidden");
    $("recordatorio-cancel-btn").classList.add("hidden");
    $("recordatorio-delete-btn").classList.add("hidden");
  }

  function openRecordatorioForEdit(id) {
    const r = state.recordatorios.find((x) => x.id === id);
    if (!r) return;
    $("recordatorio-form-title").textContent = "Editar recordatorio";
    $("recordatorio-id").value = r.id;
    $("recordatorio-titulo").value = r.titulo || "";
    $("recordatorio-fecha").value = r.fecha;
    $("recordatorio-proyecto").innerHTML = proyectoOptionsRecordatorio();
    $("recordatorio-proyecto").value = r.proyecto_id || "";
    $("recordatorio-notas").value = r.notas || "";
    $("recordatorio-form-error").classList.add("hidden");
    $("recordatorio-cancel-btn").classList.remove("hidden");
    $("recordatorio-delete-btn").classList.remove("hidden");
  }

  $("recordatorio-cancel-btn").addEventListener("click", () => resetRecordatorioForm());

  $("form-recordatorio").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("recordatorio-form-error").classList.add("hidden");
    const btn = $("recordatorio-save-btn");
    btn.disabled = true;
    btn.textContent = "Guardando...";
    try {
      const titulo = $("recordatorio-titulo").value.trim();
      if (!titulo) throw new Error("Escribe qué hay que hacer.");
      const payload = {
        titulo,
        fecha: $("recordatorio-fecha").value,
        proyecto_id: $("recordatorio-proyecto").value || null,
        notas: $("recordatorio-notas").value.trim() || null,
        creado_por: state.currentUser,
      };
      const id = $("recordatorio-id").value || null;
      const saved = await DATA.saveRecordatorio(payload, id);
      if (id) {
        const i = state.recordatorios.findIndex((r) => r.id === id);
        const proyecto = state.proyectos.find((p) => p.id === payload.proyecto_id);
        state.recordatorios[i] = { ...state.recordatorios[i], ...saved, proyectos: proyecto ? { nombre: proyecto.nombre } : null };
      } else {
        const proyecto = state.proyectos.find((p) => p.id === payload.proyecto_id);
        state.recordatorios.push({ ...saved, proyectos: proyecto ? { nombre: proyecto.nombre } : null, hecho: false });
      }
      state.recordatorios.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
      toast(id ? "Recordatorio actualizado" : "Recordatorio agregado");
      resetRecordatorioForm();
      renderRecordatoriosList();
      renderRecordatoriosCard();
    } catch (err) {
      $("recordatorio-form-error").textContent = "Error al guardar: " + err.message;
      $("recordatorio-form-error").classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  });

  $("recordatorio-delete-btn").addEventListener("click", async () => {
    const id = $("recordatorio-id").value;
    if (!id) return;
    if (!confirm("¿Eliminar este recordatorio? Esta acción no se puede deshacer.")) return;
    try {
      await DATA.deleteRecordatorio(id);
      state.recordatorios = state.recordatorios.filter((r) => r.id !== id);
      toast("Recordatorio eliminado");
      resetRecordatorioForm();
      renderRecordatoriosList();
      renderRecordatoriosCard();
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
      const [gastos, entradas, documentos, bitacora, recordatorios, presupuestos] = await Promise.all([
        DATA.getGastos(),
        DATA.getEntradas(),
        DATA.getDocumentos(),
        DATA.getBitacora(),
        DATA.getRecordatorios(),
        DATA.getPresupuestos(),
      ]);
      state.gastos = gastos;
      state.entradas = entradas;
      state.documentos = documentos;
      state.bitacora = bitacora;
      state.recordatorios = recordatorios;
      state.presupuestos = presupuestos;
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
    renderPrestamosList();
    renderRecordatoriosCard();
    renderPresupuesto();
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
    renderPrestamosList();
    renderPresupuesto();
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
  const TABS = ["bitacora", "gastos", "entradas", "documentos", "creditos", "presupuesto"];
  $("tab-gastos-btn").addEventListener("click", () => switchTab("gastos"));
  $("tab-entradas-btn").addEventListener("click", () => switchTab("entradas"));
  $("tab-documentos-btn").addEventListener("click", () => switchTab("documentos"));
  $("tab-bitacora-btn").addEventListener("click", () => switchTab("bitacora"));
  $("tab-creditos-btn").addEventListener("click", () => switchTab("creditos"));
  $("tab-presupuesto-btn").addEventListener("click", () => switchTab("presupuesto"));

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

  // Cuando un gasto se pagó con "dinero de otro proyecto" (fuente_fondos =
  // "prestamo"), ese gasto sigue viviendo en su propio proyecto (para que
  // las partidas/categorías cuadren ahí), pero el efectivo en realidad
  // salió de otro. Para que el Saldo de CADA proyecto refleje su
  // disponibilidad real: al proyecto que RECIBIÓ el préstamo se le suma de
  // vuelta el saldo pendiente de esos gastos (esa parte todavía no la pagó
  // con su propio dinero); al proyecto que PRESTÓ se le resta (ya no tiene
  // ese efectivo disponible mientras no se lo regresen). En "🌐 Todos los
  // proyectos" el ajuste siempre da 0 (se cancela entre sí, es solo dinero
  // moviéndose de un proyecto a otro), por eso solo se nota al filtrar un
  // proyecto específico.
  function ajustePrestamosProyecto(proyectoId) {
    if (!proyectoId) return 0;
    let ajuste = 0;
    for (const g of state.gastos) {
      if (g.fuente_fondos !== "prestamo") continue;
      const saldoPendiente = Number(g.monto) - (g.abonos_prestamo || []).reduce((s, a) => s + Number(a.monto), 0);
      if (g.proyecto_id === proyectoId) ajuste += saldoPendiente;
      if (g.proyecto_prestamista_id === proyectoId) ajuste -= saldoPendiente;
    }
    return ajuste;
  }

  function renderResumen() {
    const gastos = gastosFiltrados();
    const entradas = entradasFiltradas();
    const totalGastos = gastos.reduce((s, g) => s + Number(g.monto), 0);
    const totalEntradas = entradas.reduce((s, e) => s + Number(e.monto), 0);
    const ajustePrestamos = ajustePrestamosProyecto(state.filtroProyecto);
    const saldo = totalEntradas - totalGastos + ajustePrestamos;
    $("total-general").textContent = fmt(totalGastos);
    $("total-entradas").textContent = fmt(totalEntradas);
    const saldoEl = $("total-saldo");
    saldoEl.textContent = fmt(saldo);
    saldoEl.style.color = saldo >= 0 ? "#0ca30c" : "#d03b3b";
    const notaSaldo = $("total-saldo-nota");
    if (Math.abs(ajustePrestamos) > 0.005) {
      notaSaldo.textContent = `Incluye ${ajustePrestamos > 0 ? "+" : "-"}${fmt(Math.abs(ajustePrestamos))} por préstamos entre proyectos`;
      notaSaldo.classList.remove("hidden");
    } else {
      notaSaldo.classList.add("hidden");
    }

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
        if (g.metodo_pago === "Crédito" || g.fuente_fondos === "credito") {
          const abonado = (g.abonos_credito || []).reduce((s, a) => s + Number(a.monto), 0);
          const saldo = Number(g.monto) - abonado;
          creditoTag =
            saldo > 0.005
              ? `<span class="inline-block text-[10px] font-medium text-red-700 bg-red-50 rounded px-1.5 py-0.5 mr-1 align-middle">💳 ${fmt(saldo)}</span>`
              : '<span class="inline-block text-[10px] font-medium text-green-700 bg-green-50 rounded px-1.5 py-0.5 mr-1 align-middle">💳 pagado</span>';
        }
        let prestamoTag = "";
        if (g.fuente_fondos === "prestamo") {
          const abonado = (g.abonos_prestamo || []).reduce((s, a) => s + Number(a.monto), 0);
          const saldo = Number(g.monto) - abonado;
          const nombrePrestamista = g.proyecto_prestamista?.nombre || "otro proyecto";
          prestamoTag =
            saldo > 0.005
              ? `<span class="inline-block text-[10px] font-medium text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mr-1 align-middle" title="Dinero prestado de ${esc(nombrePrestamista)}">🔁 ${fmt(saldo)}</span>`
              : '<span class="inline-block text-[10px] font-medium text-green-700 bg-green-50 rounded px-1.5 py-0.5 mr-1 align-middle">🔁 regresado</span>';
        }
        const ivaTag = gastoImpuestosBadge(g);
        return `
        <button data-id="${g.id}" data-pendiente="${g._pendiente ? 1 : 0}" class="gasto-item w-full text-left bg-white rounded-xl border border-slate-200 shadow-sm p-3 hover:border-slate-300 transition">
          <div class="flex justify-between items-start">
            <div class="min-w-0 pr-2">
              <p class="font-medium text-slate-900 truncate">${proyectoTag}${pendienteTag}${creditoTag}${prestamoTag}${ivaTag}${esc(g.descripcion || g.categorias?.nombre || "Gasto")}</p>
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

  // -------------------- CRÉDITOS (metodo_pago = "Crédito" O fuente_fondos = "credito") --------------------
  // Un gasto es una deuda a crédito si su metodo_pago vale exactamente
  // "Crédito" (deuda con el proveedor de ese gasto, la forma original) O SI
  // su fuente_fondos vale "credito" (línea de crédito general de la obra,
  // sin depender de qué proveedor tenga el gasto — ver la actualización de
  // "fuente de fondos"). Ambos casos comparten el mismo mecanismo de
  // abonos parciales (abonos_credito). El saldo pendiente se calcula en el
  // cliente restándole al monto original la suma de sus abonos (g.abonos_
  // credito, que ya viene incluido en cada gasto gracias al select
  // anidado de DATA.getGastos).
  function creditoAcreedorLabel(g) {
    return g.proveedores?.nombre_empresa || g.proveedor_texto || g.credito_acreedor || "Línea de crédito de la obra";
  }

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
      .filter((g) => g.metodo_pago === "Crédito" || g.fuente_fondos === "credito")
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

    // Adeudado por proveedor / acreedor
    const porProveedor = new Map();
    todosPendientes.forEach((g) => {
      const nombre = creditoAcreedorLabel(g);
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

    // Opciones del filtro de proveedor/acreedor (a partir de los que sí
    // tienen algún gasto a crédito, no el catálogo completo)
    const provsEnCreditos = [...new Set(todosCredito.map((g) => creditoAcreedorLabel(g)))].sort((a, b) =>
      a.localeCompare(b, "es")
    );
    const provFiltroActual = $("creditos-filtro-proveedor").value;
    $("creditos-filtro-proveedor").innerHTML =
      '<option value="">Todos los proveedores</option>' +
      provsEnCreditos.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    $("creditos-filtro-proveedor").value = provFiltroActual;

    // Lista (aplica los dos filtros: proveedor/acreedor y solo-pendientes)
    let gastos = todosCredito;
    if (soloPendientes) gastos = gastos.filter((g) => g._credito.saldo > 0.005);
    if (provFiltro) gastos = gastos.filter((g) => creditoAcreedorLabel(g) === provFiltro);
    gastos.sort((a, b) => {
      if (a._credito.vencido !== b._credito.vencido) return a._credito.vencido ? -1 : 1;
      return b._credito.diasAntiguedad - a._credito.diasAntiguedad;
    });

    const cont = $("lista-creditos");
    $("lista-creditos-vacia").classList.toggle("hidden", gastos.length > 0);
    cont.innerHTML = gastos
      .map((g) => {
        const c = g._credito;
        const proveedor = creditoAcreedorLabel(g);
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

  // -------------------- PRÉSTAMOS ENTRE PROYECTOS (fuente_fondos = "prestamo") --------------------
  // Un gasto pagado con dinero de otro proyecto se sigue viendo en su
  // propio proyecto (para que las partidas/categorías cuadren ahí), pero
  // queda una deuda entre proyectos rastreada con el mismo patrón de
  // abonos parciales que ya usan los créditos (aquí: abonos_prestamo). A
  // diferencia de gastosFiltrados()/creditosFiltrados(), aquí SÍ hace
  // falta mirar gastos de fuera del proyecto filtrado: si filtras el
  // proyecto que PRESTÓ el dinero, también debe aparecer lo que le deben
  // (el gasto vive en el otro proyecto, el deudor).
  function prestamoInfo(g) {
    const abonado = (g.abonos_prestamo || []).reduce((s, a) => s + Number(a.monto), 0);
    return { abonado, saldo: Number(g.monto) - abonado };
  }

  function prestamosFiltrados() {
    const pid = state.filtroProyecto;
    return state.gastos.filter((g) => {
      if (g.fuente_fondos !== "prestamo") return false;
      if (!pid) return true;
      return g.proyecto_id === pid || g.proyecto_prestamista_id === pid;
    });
  }

  function renderPrestamosList() {
    const prestamos = prestamosFiltrados().map((g) => ({ ...g, _prestamo: prestamoInfo(g) }));
    const pendientes = prestamos.filter((g) => g._prestamo.saldo > 0.005);
    $("prestamos-total-pendiente").textContent = fmt(pendientes.reduce((s, g) => s + g._prestamo.saldo, 0));

    const ordenados = prestamos.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    const cont = $("lista-prestamos");
    $("lista-prestamos-vacia").classList.toggle("hidden", ordenados.length > 0);
    cont.innerHTML = ordenados
      .map((g) => {
        const p = g._prestamo;
        const deudor = g.proyectos?.nombre || "Proyecto";
        const prestamista = g.proyecto_prestamista?.nombre || "Otro proyecto";
        const pagadoBadge =
          p.saldo <= 0.005
            ? '<span class="inline-block text-[10px] font-medium text-green-700 bg-green-50 rounded px-1.5 py-0.5 ml-1">regresado</span>'
            : "";
        const abonosOrdenados = (g.abonos_prestamo || []).slice().sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
        return `
        <div class="prestamo-item bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <button class="prestamo-toggle w-full text-left flex justify-between items-start">
            <div class="min-w-0 pr-2">
              <p class="font-medium text-slate-900 truncate">${esc(deudor)} le debe a ${esc(prestamista)}</p>
              <p class="text-xs text-slate-500 truncate">${esc(g.descripcion || g.categorias?.nombre || "")}</p>
              <p class="text-xs text-slate-400">${fmtFecha(g.fecha)}${pagadoBadge}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-xs text-slate-400">${fmt(g.monto)} original</p>
              <p class="font-semibold ${p.saldo > 0.005 ? "text-red-600" : "text-green-600"}">${fmt(p.saldo)}</p>
            </div>
          </button>
          <div class="prestamo-detalle hidden mt-3 pt-3 border-t border-slate-100">
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
                    <button class="abono-prestamo-delete-btn text-slate-400 hover:text-red-600" data-id="${a.id}">🗑️</button>
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
                : p.saldo > 0.005
                ? `
            <form class="abono-prestamo-form flex flex-wrap items-end gap-2" data-gasto-id="${g.id}">
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">Fecha</label>
                <input type="date" class="abono-prestamo-fecha rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value="${new Date()
                  .toISOString()
                  .slice(0, 10)}" />
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">Monto</label>
                <input type="number" step="0.01" min="0.01" max="${p.saldo.toFixed(
                  2
                )}" class="abono-prestamo-monto rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-28" placeholder="0.00" />
              </div>
              <div class="flex-1 min-w-[120px]">
                <label class="block text-[11px] text-slate-500 mb-1">Notas (opcional)</label>
                <input type="text" class="abono-prestamo-notas rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-full" />
              </div>
              <button type="submit" class="bg-brand text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-brand-dark">Registrar abono</button>
            </form>`
                : ""
            }
          </div>
        </div>`;
      })
      .join("");

    cont.querySelectorAll(".prestamo-toggle").forEach((el) => {
      el.addEventListener("click", () => {
        el.parentElement.querySelector(".prestamo-detalle").classList.toggle("hidden");
      });
    });

    cont.querySelectorAll(".abono-prestamo-delete-btn").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (!confirm("¿Eliminar este abono? El saldo pendiente del préstamo vuelve a subir.")) return;
        try {
          await DATA.deleteAbonoPrestamo(el.dataset.id);
          toast("Abono eliminado");
          await refreshGastos();
        } catch (err) {
          toast("Error al eliminar abono: " + err.message, true);
        }
      });
    });

    cont.querySelectorAll(".abono-prestamo-form").forEach((form) => {
      form.addEventListener("click", (ev) => ev.stopPropagation());
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const gastoId = form.dataset.gastoId;
        const fecha = form.querySelector(".abono-prestamo-fecha").value;
        const monto = parseFloat(form.querySelector(".abono-prestamo-monto").value);
        const notas = form.querySelector(".abono-prestamo-notas").value.trim() || null;
        if (!monto || monto <= 0) {
          toast("Pon un monto válido", true);
          return;
        }
        try {
          await DATA.addAbonoPrestamo({
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

  // -------------------- PRESUPUESTO POR PARTIDA --------------------
  // Cuánto se le asigna a cada partida (categoría) de un proyecto, para
  // compararlo contra lo que ya se ha gastado ahí y no pasarse del
  // presupuesto. Cada renglón de `presupuestos` es un proyecto+categoría
  // específico (nunca se mezclan varios proyectos en un solo renglón,
  // aunque el filtro esté en "🌐 Todos los proyectos" — en ese caso
  // simplemente se listan los renglones de todos los proyectos, cada uno
  // con su etiqueta de proyecto, igual que ya se hace en Gastos/Créditos).
  function presupuestosFiltrados() {
    return state.filtroProyecto
      ? state.presupuestos.filter((p) => p.proyecto_id === state.filtroProyecto)
      : state.presupuestos;
  }

  // Categorías que TODAVÍA no tienen presupuesto asignado para un
  // proyecto dado (para no ofrecer agregar una que ya existe — hay que
  // editarla en vez de duplicarla, hay un índice único proyecto+categoría).
  function categoriasSinPresupuesto(proyectoId) {
    const yaAsignadas = new Set(
      state.presupuestos.filter((p) => p.proyecto_id === proyectoId).map((p) => p.categoria_id)
    );
    return state.categorias.filter((c) => !yaAsignadas.has(c.id));
  }

  // Vuelve a llenar los selects de proyecto/categoría de la mini-forma.
  // Se llama al renderizar el apartado completo y cada vez que cambia el
  // proyecto elegido en la propia mini-forma (para refrescar qué
  // categorías le faltan presupuesto a ESE proyecto en particular).
  function renderPresupuestoFormOptions() {
    const selProyecto = $("presupuesto-proyecto");
    const proyectoActual = selProyecto.value || state.filtroProyecto || defaultProyectoId() || state.proyectos[0]?.id || "";
    selProyecto.innerHTML = state.proyectos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
    selProyecto.value = proyectoActual;

    const selCategoria = $("presupuesto-categoria");
    const disponibles = categoriasSinPresupuesto(selProyecto.value);
    if (disponibles.length === 0) {
      selCategoria.innerHTML = '<option value="">— No quedan partidas sin presupuesto en este proyecto —</option>';
    } else {
      selCategoria.innerHTML = disponibles.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
    }
  }
  $("presupuesto-proyecto").addEventListener("change", renderPresupuestoFormOptions);

  // El presupuesto se captura como SUBTOTAL (sin IVA) — la app calcula el
  // IVA (16%, misma tasa fija que ya se usa en el desglose de entradas) y
  // el total ella sola, en vivo, y guarda el TOTAL en `monto` (así se
  // sigue comparando en igualdad de condiciones contra `gastado`, que es
  // siempre el total pagado de cada gasto).
  function presupuestoDesdeSubtotal(subtotal) {
    const iva = subtotal * 0.16;
    return { iva, total: subtotal + iva };
  }

  function actualizarPresupuestoPreview() {
    const subtotal = parseFloat($("presupuesto-monto").value) || 0;
    const { iva, total } = presupuestoDesdeSubtotal(subtotal);
    $("presupuesto-iva-preview").textContent = fmt(iva);
    $("presupuesto-total-preview").textContent = fmt(total);
  }
  $("presupuesto-monto").addEventListener("input", actualizarPresupuestoPreview);

  function resetPresupuestoForm() {
    state.editingPresupuestoId = null;
    $("presupuesto-error").classList.add("hidden");
    $("presupuesto-monto").value = "";
    $("presupuesto-avance").value = "";
    $("presupuesto-proyecto").disabled = false;
    $("presupuesto-categoria").disabled = false;
    $("presupuesto-guardar-btn").textContent = "Agregar";
    $("presupuesto-cancelar-btn").classList.add("hidden");
    $("presupuesto-eliminar-btn").classList.add("hidden");
    renderPresupuestoFormOptions();
    actualizarPresupuestoPreview();
  }

  function renderPresupuesto() {
    // Mantiene la mini-forma coherente si, por ejemplo, se borró desde
    // otra pestaña el proyecto que tenía seleccionado.
    if (!state.editingPresupuestoId) renderPresupuestoFormOptions();

    // El gastado por partida ya no se muestra en la tabla (a petición de
    // Santiago, quedó como un apartado de planeación: presupuesto + avance
    // de obra) pero se sigue calculando para las 3 tarjetas de resumen de
    // arriba (Presupuestado/Gastado/Restante), que sí se dejaron.
    const rows = presupuestosFiltrados().map((p) => {
      const gastado = state.gastos
        .filter((g) => g.proyecto_id === p.proyecto_id && g.categoria_id === p.categoria_id)
        .reduce((s, g) => s + Number(g.monto), 0);
      return { ...p, gastado };
    });
    // Orden: por proyecto (para que no queden mezcladas, aunque ya no se
    // muestre la etiqueta de proyecto) y dentro de cada uno, por el orden
    // de catálogo de la partida (mismo "orden" que ya usan los selects de
    // categoría en toda la app) — ya no se ordena por % gastado porque esa
    // columna se quitó de la tabla.
    const ordenCategoria = (categoriaId) => state.categorias.find((c) => c.id === categoriaId)?.orden ?? 999;
    rows.sort((a, b) => {
      const proy = (a.proyectos?.nombre || "").localeCompare(b.proyectos?.nombre || "");
      if (proy !== 0) return proy;
      return ordenCategoria(a.categoria_id) - ordenCategoria(b.categoria_id);
    });

    const totalPresupuestado = rows.reduce((s, r) => s + Number(r.monto), 0);
    const totalGastado = rows.reduce((s, r) => s + r.gastado, 0);
    const totalRestante = totalPresupuestado - totalGastado;
    $("presupuesto-total-presupuestado").textContent = fmt(totalPresupuestado);
    $("presupuesto-total-gastado").textContent = fmt(totalGastado);
    const restanteEl = $("presupuesto-total-restante");
    restanteEl.textContent = fmt(totalRestante);
    restanteEl.style.color = totalRestante >= 0 ? "#0ca30c" : "#d03b3b";
    $("presupuesto-tfoot-presupuestado").textContent = fmt(totalPresupuestado);

    const cont = $("presupuesto-lista");
    const hayFilas = rows.length > 0;
    $("presupuesto-tabla-wrap").classList.toggle("hidden", !hayFilas);
    $("presupuesto-vacia").classList.toggle("hidden", hayFilas);
    cont.innerHTML = rows
      .map((r) => {
        const subtotal = Number(r.monto) / 1.16;
        const avanceObra = r.avance_obra === null || r.avance_obra === undefined ? null : Number(r.avance_obra);
        const avanceObraCelda =
          avanceObra === null
            ? '<span class="text-[11px] text-slate-400">sin capturar</span>'
            : `
            <div class="w-full bg-slate-100 rounded-full h-1.5 mb-1">
              <div class="h-1.5 rounded-full bg-indigo-500" style="width:${Math.min(100, avanceObra)}%"></div>
            </div>
            <span class="text-[11px] text-slate-500">${avanceObra.toFixed(0)}%</span>`;
        return `
        <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50 align-middle">
          <td class="px-3 py-2">
            <span class="font-medium text-slate-900">${esc(r.categorias?.nombre || "")}</span>
          </td>
          <td class="px-3 py-2 text-right text-slate-700 whitespace-nowrap">
            ${fmt(Number(r.monto))}
            <p class="text-[10px] text-slate-400">sin IVA: ${fmt(subtotal)}</p>
          </td>
          <td class="px-3 py-2">${avanceObraCelda}</td>
          <td class="px-3 py-2 text-center whitespace-nowrap">
            <button type="button" class="presupuesto-edit-btn text-xs font-medium text-brand hover:underline" data-id="${r.id}">Editar</button>
          </td>
        </tr>`;
      })
      .join("");

    cont.querySelectorAll(".presupuesto-edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = state.presupuestos.find((x) => x.id === btn.dataset.id);
        if (!p) return;
        state.editingPresupuestoId = p.id;
        $("presupuesto-error").classList.add("hidden");
        renderPresupuestoFormOptions();
        // Al editar, el proyecto y la categoría son la llave del renglón
        // (hay un índice único proyecto+categoría) — no se pueden cambiar
        // aquí, solo el monto. Se agregan sus opciones aparte porque
        // categoriasSinPresupuesto() las habría excluido por ya estar
        // asignadas.
        $("presupuesto-proyecto").innerHTML = `<option value="${p.proyecto_id}">${esc(p.proyectos?.nombre || "")}</option>`;
        $("presupuesto-categoria").innerHTML = `<option value="${p.categoria_id}">${esc(p.categorias?.nombre || "")}</option>`;
        $("presupuesto-proyecto").disabled = true;
        $("presupuesto-categoria").disabled = true;
        // El monto guardado es el TOTAL (con IVA) — la mini-forma siempre
        // captura el subtotal, así que aquí se deriva de vuelta dividiendo
        // entre 1.16 para que la edición sea consistente con el alta.
        $("presupuesto-monto").value = (Number(p.monto) / 1.16).toFixed(2);
        $("presupuesto-avance").value = p.avance_obra === null || p.avance_obra === undefined ? "" : p.avance_obra;
        actualizarPresupuestoPreview();
        $("presupuesto-guardar-btn").textContent = "Guardar cambios";
        $("presupuesto-cancelar-btn").classList.remove("hidden");
        // El botón de eliminar solo aparece mientras se está editando esa
        // partida — así no queda un ícono de borrar siempre a la vista en
        // cada fila de la tabla, a petición de Santiago.
        $("presupuesto-eliminar-btn").classList.remove("hidden");
        $("presupuesto-monto").focus();
      });
    });
  }

  $("presupuesto-cancelar-btn").addEventListener("click", resetPresupuestoForm);

  $("presupuesto-eliminar-btn").addEventListener("click", async () => {
    const id = state.editingPresupuestoId;
    if (!id) return;
    if (!confirm("¿Eliminar el presupuesto de esta partida? Esta acción no se puede deshacer.")) return;
    try {
      await DATA.deletePresupuesto(id);
      state.presupuestos = state.presupuestos.filter((p) => p.id !== id);
      resetPresupuestoForm();
      toast("Presupuesto eliminado");
      renderPresupuesto();
    } catch (err) {
      toast("Error al eliminar: " + err.message, true);
    }
  });

  $("presupuesto-guardar-btn").addEventListener("click", async () => {
    const errEl = $("presupuesto-error");
    errEl.classList.add("hidden");
    const subtotal = parseFloat($("presupuesto-monto").value);
    if (!(subtotal > 0)) {
      errEl.textContent = "Escribe un subtotal válido.";
      errEl.classList.remove("hidden");
      return;
    }
    const avanceRaw = $("presupuesto-avance").value;
    let avanceObra = null;
    if (avanceRaw !== "") {
      avanceObra = parseFloat(avanceRaw);
      if (isNaN(avanceObra) || avanceObra < 0 || avanceObra > 100) {
        errEl.textContent = "El % de avance de obra debe estar entre 0 y 100.";
        errEl.classList.remove("hidden");
        return;
      }
    }
    // El monto que se guarda es el TOTAL (subtotal + IVA 16%) — así se
    // sigue comparando en igualdad de condiciones contra `gastado`, que es
    // siempre el total pagado de cada gasto.
    const monto = Number(presupuestoDesdeSubtotal(subtotal).total.toFixed(2));
    const btn = $("presupuesto-guardar-btn");
    btn.disabled = true;
    try {
      if (state.editingPresupuestoId) {
        const actualizado = await DATA.savePresupuesto({ monto, avance_obra: avanceObra }, state.editingPresupuestoId);
        const idx = state.presupuestos.findIndex((p) => p.id === state.editingPresupuestoId);
        if (idx >= 0) state.presupuestos[idx] = { ...state.presupuestos[idx], monto: actualizado.monto, avance_obra: actualizado.avance_obra };
        toast("Presupuesto actualizado");
      } else {
        const proyectoId = $("presupuesto-proyecto").value;
        const categoriaId = $("presupuesto-categoria").value;
        if (!proyectoId || !categoriaId) {
          errEl.textContent = "Elige un proyecto y una partida.";
          errEl.classList.remove("hidden");
          return;
        }
        const nuevo = await DATA.savePresupuesto({ proyecto_id: proyectoId, categoria_id: categoriaId, monto, avance_obra: avanceObra }, null);
        state.presupuestos.push({
          ...nuevo,
          proyectos: state.proyectos.find((p) => p.id === proyectoId) ? { nombre: state.proyectos.find((p) => p.id === proyectoId).nombre } : null,
          categorias: state.categorias.find((c) => c.id === categoriaId) ? { nombre: state.categorias.find((c) => c.id === categoriaId).nombre } : null,
        });
        toast("Presupuesto agregado");
      }
      resetPresupuestoForm();
      renderPresupuesto();
    } catch (err) {
      errEl.textContent = "No se pudo guardar: " + err.message;
      errEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  });

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
            <div class="flex items-center gap-1 shrink-0">
              <button data-id="${esc(b.id)}" class="bitacora-edit-btn text-slate-400 hover:text-slate-700 text-lg px-1 leading-none" title="Editar">✏️</button>
              <button data-id="${esc(b.id)}" class="bitacora-delete-btn text-slate-400 hover:text-red-600 text-lg px-1 leading-none" title="Eliminar">🗑️</button>
            </div>
          </div>
          ${b.nota ? `<p class="text-sm text-slate-800 mb-2">${esc(b.nota)}</p>` : ""}
          ${fotos ? `<div class="flex gap-2 flex-wrap">${fotos}</div>` : ""}
        </div>`;
      })
      .join("");
    cont.querySelectorAll(".bitacora-edit-btn").forEach((el) => {
      el.addEventListener("click", () => {
        const entrada = state.bitacora.find((b) => b.id === el.dataset.id);
        if (!entrada) return;
        if (entrada._pendiente) {
          toast("Este avance todavía no se sube — espera a que tengas internet para poder editarlo.", true);
          return;
        }
        openBitacoraForm(entrada);
      });
    });
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
  $("bitacora-form-back-btn").addEventListener("click", () => {
    state.editingBitacoraId = null;
    showView("dashboard");
  });

  // Muestra las fotos que ya tenía guardadas el avance que se está
  // editando (con una ✕ para quitarla de la lista antes de guardar). No
  // borra nada de Storage al quitarla aquí — solo se excluye del arreglo
  // `fotos` que se va a guardar, mismo criterio ya usado en el resto de la
  // app para "documentos" (nunca se limpia el archivo del bucket).
  function renderBitacoraFotosActuales() {
    const wrap = $("bitacora-fotos-actuales-wrap");
    if (!state.editingBitacoraId) {
      wrap.classList.add("hidden");
      return;
    }
    wrap.classList.remove("hidden");
    const fotos = state.bitacoraFotosActuales || [];
    const cont = $("bitacora-fotos-actuales");
    cont.innerHTML = fotos.length
      ? fotos
          .map(
            (url, i) => `
      <div class="relative">
        <img src="${esc(url)}" class="w-16 h-16 object-cover rounded-lg border border-slate-200" />
        <button type="button" class="bitacora-foto-quitar-btn absolute -top-1.5 -right-1.5 bg-white border border-slate-300 rounded-full w-5 h-5 text-xs text-red-600 leading-none shadow-sm" data-index="${i}" title="Quitar">✕</button>
      </div>`
          )
          .join("")
      : '<p class="text-xs text-slate-400">Sin fotos guardadas.</p>';
    cont.querySelectorAll(".bitacora-foto-quitar-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.bitacoraFotosActuales.splice(Number(btn.dataset.index), 1);
        renderBitacoraFotosActuales();
      });
    });
  }

  // Sin argumento: abre el formulario para dar de alta un avance nuevo.
  // Con `entrada`: lo abre en modo edición, precargado con sus datos.
  function openBitacoraForm(entrada) {
    $("bitacora-form-error").classList.add("hidden");
    $("bitacora-proyecto").innerHTML = state.proyectos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
    state.editingBitacoraId = entrada ? entrada.id : null;
    state.bitacoraFotosActuales = entrada ? [...(entrada.fotos || [])] : [];
    $("bitacora-form-title").textContent = entrada ? "Editar avance" : "Nuevo avance";
    $("bitacora-save-btn").textContent = "Guardar";
    $("bitacora-fotos-label").textContent = entrada ? "Agregar fotos nuevas" : "Fotos";
    $("bitacora-fotos-help").textContent = entrada
      ? "Estas fotos se agregan a las que ya tiene el avance (no las reemplazan). Necesitas conexión para subirlas."
      : "Puedes elegir varias fotos a la vez. Necesitas conexión para subirlas — si no hay internet, se guarda solo la nota y puedes agregar las fotos después editando.";
    $("bitacora-proyecto").value = entrada ? entrada.proyecto_id : defaultProyectoId();
    $("bitacora-fecha").value = entrada ? entrada.fecha : new Date().toISOString().slice(0, 10);
    $("bitacora-nota").value = entrada ? entrada.nota || "" : "";
    $("bitacora-fotos").value = "";
    renderBitacoraFotosActuales();
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
      const fecha = $("bitacora-fecha").value;
      const nota = $("bitacora-nota").value.trim() || null;
      const files = Array.from($("bitacora-fotos").files || []);

      if (state.editingBitacoraId) {
        // Modo edición: el avance ya existe en Supabase (los que todavía
        // están "sin subir" no se pueden editar — se bloquea desde el
        // botón ✏️ de la lista), así que aquí siempre hace falta internet
        // para poder subir fotos nuevas si se agregaron.
        if (files.length > 0 && !navigator.onLine) {
          throw new Error("Necesitas conexión a internet para agregar fotos nuevas.");
        }
        let fotos = [...(state.bitacoraFotosActuales || [])];
        if (files.length > 0) {
          const subidas = await Promise.all(files.map((f) => DATA.uploadComprobante(f)));
          fotos = fotos.concat(subidas.map((s) => s.url));
        }
        const payload = { proyecto_id: proyectoId, fecha, nota, fotos };
        const id = state.editingBitacoraId;
        await DATA.saveBitacoraEntry(payload, id);
        const idx = state.bitacora.findIndex((b) => b.id === id);
        if (idx >= 0) {
          state.bitacora[idx] = {
            ...state.bitacora[idx],
            ...payload,
            proyectos: state.proyectos.find((p) => p.id === proyectoId) || null,
          };
        }
        if (proyectoId) rememberProyecto(proyectoId);
        state.editingBitacoraId = null;
        toast("Avance actualizado");
        showView("dashboard");
        renderBitacoraList();
        return;
      }

      const payload = {
        proyecto_id: proyectoId,
        fecha,
        nota,
        fotos: [],
        capturado_por: state.currentUser,
      };

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

  // Dibuja el logo respetando su proporción real (antes se forzaba a un
  // tamaño fijo de 90x27pt, que no corresponde a la proporción real del PNG
  // — 900x182px, ~4.95:1 — y por eso se veía deformado/"apachurrado" en los
  // PDF). Aquí se mide la imagen real y se calcula el ancho a partir del
  // alto deseado, para que nunca se estire.
  async function dibujarLogoPdf(doc, x, y, altoObjetivo) {
    try {
      const logoData = await imageUrlToDataURL("assets/logo.png");
      const { width: iw, height: ih } = await tamañoImagen(logoData);
      const anchoObjetivo = altoObjetivo * (iw / ih);
      doc.addImage(logoData, "PNG", x, y, anchoObjetivo, altoObjetivo);
    } catch (err) {
      console.warn("No se pudo cargar el logo para el PDF:", err);
    }
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
      const footerY = pageHeight - 26;
      let y = 50;

      await dibujarLogoPdf(doc, marginX, 22, 26);

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
      y += 16;
      doc.setFontSize(9);
      doc.setTextColor(140, 140, 140);
      doc.text(
        `${entradas.length} avance${entradas.length === 1 ? "" : "s"} registrado${entradas.length === 1 ? "" : "s"}`,
        marginX,
        y
      );
      y += 22;

      // Cada avance se dibuja como una "tarjeta" (fondo gris muy claro,
      // esquinas redondeadas, franja roja de marca junto a la fecha) en vez
      // de solo texto y fotos sueltos — se ve más como un reporte cuidado y
      // menos como una lista plana. La nota va a lo ancho completo de la
      // tarjeta, arriba de las fotos (ya no al lado, como antes), y las
      // fotos se acomodan en una cuadrícula pareja de hasta 3 por fila,
      // cada una dentro de su propio marco con fondo claro del mismo
      // tamaño — así la cuadrícula queda alineada aunque las fotos
      // originales sean de proporciones distintas (vertical/horizontal/
      // cuadrada). Ya no se muestra quién capturó el avance (a petición de
      // Santiago) — solo la fecha.
      const cardPad = 14;
      const cardWidth = pageWidth - marginX * 2;
      const innerWidth = cardWidth - cardPad * 2;
      const anchoFoto = 140;
      const altoFoto = 140;
      const gapFoto = 10;
      const fotosPorFila = Math.max(1, Math.min(3, Math.floor((innerWidth + gapFoto) / (anchoFoto + gapFoto))));

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
          if (y + 40 > footerY - 10) {
            doc.addPage();
            y = 50;
          }
          doc.setFillColor(219, 0, 46);
          doc.roundedRect(marginX, y, cardWidth, 24, 4, 4, "F");
          doc.setFontSize(12);
          doc.setFont(undefined, "bold");
          doc.setTextColor(255, 255, 255);
          doc.text(grupo.nombre, marginX + 10, y + 16);
          doc.setFont(undefined, "normal");
          doc.setTextColor(20, 20, 20);
          y += 24 + 16;
        }

        for (const b of grupo.items) {
          const fotos = b.fotos || [];

          doc.setFontSize(10);
          const lineas = b.nota ? doc.splitTextToSize(b.nota, innerWidth) : [];

          const filasFoto = fotos.length > 0 ? Math.ceil(fotos.length / fotosPorFila) : 0;
          const altoFotosBloque = filasFoto > 0 ? filasFoto * altoFoto + (filasFoto - 1) * gapFoto : 0;

          const cardHeight =
            cardPad * 2 +
            18 +
            (lineas.length > 0 ? 10 + lineas.length * 13 : 0) +
            (fotos.length > 0 ? 14 + altoFotosBloque : 0);

          // Salto de página si la tarjeta completa no cabe entera, para que
          // nunca se corte una tarjeta a la mitad entre dos páginas.
          if (y + cardHeight > footerY - 10) {
            doc.addPage();
            y = 50;
          }

          const cardTop = y;
          doc.setFillColor(249, 248, 247);
          doc.setDrawColor(232, 230, 227);
          doc.setLineWidth(0.75);
          doc.roundedRect(marginX, cardTop, cardWidth, cardHeight, 6, 6, "FD");

          const cx = marginX + cardPad;
          let cy = cardTop + cardPad + 12;

          doc.setFillColor(219, 0, 46);
          doc.roundedRect(cx, cy - 9, 4, 13, 1, 1, "F");
          doc.setFontSize(12);
          doc.setFont(undefined, "bold");
          doc.setTextColor(20, 20, 20);
          doc.text(fmtFecha(b.fecha), cx + 10, cy);
          doc.setFont(undefined, "normal");

          cy = cardTop + cardPad + 18;

          if (lineas.length > 0) {
            cy += 10;
            doc.setFontSize(10);
            doc.setTextColor(70, 70, 70);
            for (const linea of lineas) {
              doc.text(linea, cx, cy);
              cy += 13;
            }
          }

          if (fotos.length > 0) {
            cy += 14;
            let col = 0;
            let fx = cx;
            let fy = cy;
            for (let i = 0; i < fotos.length; i++) {
              doc.setFillColor(238, 236, 233);
              doc.setDrawColor(222, 220, 216);
              doc.setLineWidth(0.5);
              doc.roundedRect(fx, fy, anchoFoto, altoFoto, 4, 4, "FD");
              try {
                const dataUrl = await imageUrlToDataURL(fotos[i]);
                const { width: iw, height: ih } = await tamañoImagen(dataUrl);
                const escala = Math.min((anchoFoto - 8) / iw, (altoFoto - 8) / ih);
                const w = iw * escala;
                const h = ih * escala;
                doc.addImage(
                  dataUrl,
                  formatoImagenDesdeDataUrl(dataUrl),
                  fx + (anchoFoto - w) / 2,
                  fy + (altoFoto - h) / 2,
                  w,
                  h
                );
              } catch (err) {
                console.warn("No se pudo cargar una foto de bitácora para el PDF:", err);
              }
              col++;
              if (col === fotosPorFila) {
                col = 0;
                fx = cx;
                fy += altoFoto + gapFoto;
              } else {
                fx += anchoFoto + gapFoto;
              }
            }
          }

          y = cardTop + cardHeight + 14;
        }
      }

      // Numeración de páginas al final, ya con el total real de páginas.
      const totalPaginas = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPaginas; p++) {
        doc.setPage(p);
        doc.setFontSize(8);
        doc.setTextColor(160, 160, 160);
        doc.text(`Página ${p} de ${totalPaginas}`, pageWidth / 2, footerY + 8, { align: "center" });
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
        "Subtotal (sin impuestos)": (() => {
          const imps = g.gasto_impuestos || [];
          if (!imps.length) return "";
          const calc = calcularImpuestos(Number(g.monto), imps);
          return calc.ok ? Number(calc.subtotal.toFixed(2)) : "";
        })(),
        "Impuestos aplicados": (g.gasto_impuestos || [])
          .map((imp) => `${imp.nombre} ${fmtPct(imp.porcentaje)}%`)
          .join("; "),
        "Método de pago": g.metodo_pago || "",
        "Pagó": g.pagado_por || "",
        "Capturó": g.capturado_por || "",
        Notas: g.notas || "",
        "Fuente de fondos":
          g.fuente_fondos === "credito"
            ? "Crédito / línea de crédito"
            : g.fuente_fondos === "prestamo"
            ? `Préstamo de ${g.proyecto_prestamista?.nombre || "otro proyecto"}`
            : "Fondos propios",
        "Saldo pendiente (crédito)":
          g.metodo_pago === "Crédito" || g.fuente_fondos === "credito"
            ? Number(g.monto) - (g.abonos_credito || []).reduce((s, a) => s + Number(a.monto), 0)
            : "",
        "Saldo pendiente (préstamo)":
          g.fuente_fondos === "prestamo"
            ? Number(g.monto) - (g.abonos_prestamo || []).reduce((s, a) => s + Number(a.monto), 0)
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

      await dibujarLogoPdf(doc, marginX, 24, 24);

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

  // Muestra/oculta el campo de "fecha límite de pago" — aplica tanto si el
  // método de pago es "Crédito" (deuda con el proveedor) como si la fuente
  // de fondos es "credito" (línea de crédito general de la obra): ambos
  // casos generan una deuda que se rastrea en la pestaña "Créditos".
  function toggleCreditoFields() {
    const esCredito = $("gasto-metodo").value === "Crédito" || $("gasto-fuente-fondos").value === "credito";
    $("gasto-credito-fields").classList.toggle("hidden", !esCredito);
  }
  $("gasto-metodo").addEventListener("change", toggleCreditoFields);

  // -------------------- FUENTE DE FONDOS (crédito general / préstamo de otro proyecto) --------------------
  // Campo aparte del método de pago: de dónde sale el dinero en realidad.
  // 'propio' no necesita nada extra; 'credito' muestra el campo de a quién
  // se le debe (además de la fecha límite, vía toggleCreditoFields);
  // 'prestamo' muestra el select de qué proyecto prestó el dinero.
  function renderProyectoPrestamistaOptions() {
    const sel = $("gasto-proyecto-prestamista");
    const actual = $("gasto-proyecto").value;
    const current = sel.value;
    sel.innerHTML = state.proyectos
      .filter((p) => p.id !== actual)
      .map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`)
      .join("");
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  }

  function toggleFuenteFondosFields() {
    const fuente = $("gasto-fuente-fondos").value;
    $("gasto-fuente-credito-fields").classList.toggle("hidden", fuente !== "credito");
    $("gasto-fuente-prestamo-fields").classList.toggle("hidden", fuente !== "prestamo");
    if (fuente === "prestamo") renderProyectoPrestamistaOptions();
    toggleCreditoFields();
  }
  $("gasto-fuente-fondos").addEventListener("change", toggleFuenteFondosFields);
  // Si cambia el proyecto del gasto, el select de "quién prestó" no debe
  // seguir ofreciendo ese mismo proyecto como opción.
  $("gasto-proyecto").addEventListener("change", () => {
    if ($("gasto-fuente-fondos").value === "prestamo") renderProyectoPrestamistaOptions();
  });

  // Desglose de IVA (16%) para ENTRADAS: se queda igual que antes, es un
  // desglose simple de un solo impuesto fijo. El de GASTOS ahora es el
  // sistema de varios impuestos de abajo ("IMPUESTOS DE GASTO").
  function desgloseIva(monto) {
    const subtotal = monto / 1.16;
    return { subtotal, iva: monto - subtotal };
  }

  // -------------------- IMPUESTOS DE GASTO (varios por gasto) --------------------
  // Catálogo de impuestos con su nombre a mostrar, si se SUMAN al subtotal
  // (traslados, como el IVA) o se RESTAN (retenciones), y un % sugerido por
  // default (editable) — "IEPS" no tiene default fijo porque varía mucho
  // según el producto, y "OTRO" es 100% libre (nombre, %, y si suma o resta
  // los elige la persona).
  const IMPUESTOS_CATALOGO = {
    IVA: { nombre: "IVA", es_retencion: false, pctDefault: 16 },
    RET_IVA: { nombre: "Retención de IVA", es_retencion: true, pctDefault: 10.6667 },
    RET_ISR: { nombre: "Retención de ISR", es_retencion: true, pctDefault: 10 },
    IEPS: { nombre: "IEPS", es_retencion: false, pctDefault: null },
  };

  function fmtPct(n) {
    return Number(n).toFixed(4).replace(/\.?0+$/, "");
  }

  // El "monto" del gasto sigue siendo el total que se pagó, ya con todos
  // sus impuestos aplicados (sumados o restados). Para mostrar el
  // desglose hay que ir "hacia atrás": si subtotal=S, cada traslado suma
  // S*%/100 y cada retención resta S*%/100, así que
  //   monto = S * (1 + Σ%traslados/100 - Σ%retenciones/100)
  // y por lo tanto S = monto / factor. Devuelve ok:false si la mezcla de
  // porcentajes no tiene sentido (factor <= 0, ej. retenciones que suman
  // más del 100%).
  function calcularImpuestos(monto, impuestos) {
    let factor = 1;
    for (const imp of impuestos) {
      const pct = Number(imp.porcentaje) || 0;
      factor += (imp.es_retencion ? -1 : 1) * (pct / 100);
    }
    if (!(factor > 0) || !(monto > 0)) return { ok: false };
    const subtotal = monto / factor;
    const detalles = impuestos.map((imp) => ({
      ...imp,
      monto: subtotal * ((Number(imp.porcentaje) || 0) / 100),
    }));
    return { ok: true, subtotal, detalles };
  }

  // Etiqueta compacta para la lista de Gastos (no recalcula montos ahí,
  // solo indica qué impuestos trae, igual de compacto que el badge 💳 de
  // crédito o el de "+N más" de recordatorios).
  function gastoImpuestosBadge(g) {
    const imps = g.gasto_impuestos || [];
    if (!imps.length) return "";
    const extra = imps.length > 1 ? ` +${imps.length - 1} más` : "";
    return `<span class="inline-block text-[10px] font-medium text-slate-600 bg-slate-100 rounded px-1.5 py-0.5 mr-1 align-middle">🧾 ${esc(imps[0].nombre)}${extra}</span>`;
  }

  // Ajusta el % sugerido y muestra/oculta los campos de "Otro" según el
  // tipo de impuesto elegido en el menú de la mini-forma para agregar uno.
  function actualizarCamposImpuesto() {
    const tipo = $("gasto-impuesto-tipo").value;
    const esOtro = tipo === "OTRO";
    $("gasto-impuesto-otro-fields").classList.toggle("hidden", !esOtro);
    if (esOtro) {
      $("gasto-impuesto-pct").value = "";
    } else {
      const def = IMPUESTOS_CATALOGO[tipo];
      $("gasto-impuesto-pct").value = def && def.pctDefault != null ? def.pctDefault : "";
    }
  }
  $("gasto-impuesto-tipo").addEventListener("change", actualizarCamposImpuesto);

  function resetMiniFormImpuesto() {
    $("gasto-impuesto-tipo").value = "IVA";
    $("gasto-impuesto-nombre").value = "";
    $("gasto-impuesto-signo").value = "suma";
    $("gasto-impuesto-error").classList.add("hidden");
    actualizarCamposImpuesto();
  }

  // Vuelve a calcular y mostrar el desglose (subtotal + cada impuesto +
  // total) debajo de la mini-forma, sin tocar la lista de impuestos ya
  // agregados (se llama también cada vez que cambia el monto).
  function actualizarGastoImpuestosDesglose() {
    const desc = $("gasto-impuestos-desglose");
    const monto = parseFloat($("gasto-monto").value);
    const impuestos = state.formImpuestos;
    if (!impuestos.length || !(monto > 0)) {
      desc.classList.add("hidden");
      return;
    }
    const calc = calcularImpuestos(monto, impuestos);
    if (!calc.ok) {
      desc.innerHTML = `<p class="text-red-600">Esa combinación de porcentajes no es válida (revisa las retenciones).</p>`;
      desc.classList.remove("hidden");
      return;
    }
    const lineas = [`Subtotal: ${fmt(calc.subtotal)}`].concat(
      calc.detalles.map(
        (d) => `${d.es_retencion ? "−" : "+"} ${esc(d.nombre)} (${fmtPct(d.porcentaje)}%): ${fmt(d.monto)}`
      )
    );
    lineas.push(`Total: ${fmt(monto)}`);
    desc.innerHTML = lineas.map((l) => `<p>${l}</p>`).join("");
    desc.classList.remove("hidden");
  }
  $("gasto-monto").addEventListener("input", actualizarGastoImpuestosDesglose);

  // Lista de impuestos ya agregados a este gasto, dentro de su formulario,
  // cada uno con un botón para borrarlo. Si el gasto ya existe (tiene id)
  // y hay internet, agregar/borrar se hace de inmediato contra Supabase
  // (igual que los documentos); si es un gasto nuevo sin guardar todavía,
  // se guardan aquí temporalmente y se suben al guardar el formulario.
  function renderGastoImpuestosLista() {
    const cont = $("gasto-impuestos-lista");
    cont.innerHTML = state.formImpuestos
      .map(
        (imp, i) => `
      <div class="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
        <span class="text-sm text-slate-700 truncate">${esc(imp.nombre)} · ${fmtPct(imp.porcentaje)}% (${imp.es_retencion ? "resta" : "suma"})</span>
        <button type="button" class="gasto-imp-delete-btn text-red-500 hover:text-red-700 text-sm shrink-0" data-index="${i}">🗑️</button>
      </div>`
      )
      .join("");
    cont.querySelectorAll(".gasto-imp-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.index);
        const imp = state.formImpuestos[idx];
        if (!imp) return;
        if (imp.id) {
          if (!confirm("¿Eliminar este impuesto? Esta acción no se puede deshacer.")) return;
          try {
            await DATA.deleteGastoImpuesto(imp.id);
          } catch (err) {
            toast("No se pudo eliminar el impuesto: " + err.message, true);
            return;
          }
        }
        state.formImpuestos.splice(idx, 1);
        renderGastoImpuestosLista();
        toast("Impuesto eliminado");
      });
    });
    actualizarGastoImpuestosDesglose();
  }

  $("gasto-impuesto-add-btn").addEventListener("click", async () => {
    const errEl = $("gasto-impuesto-error");
    errEl.classList.add("hidden");
    const tipo = $("gasto-impuesto-tipo").value;
    const pct = parseFloat($("gasto-impuesto-pct").value);
    if (!(pct >= 0)) {
      errEl.textContent = "Escribe un porcentaje válido.";
      errEl.classList.remove("hidden");
      return;
    }
    let nombre, esRetencion;
    if (tipo === "OTRO") {
      nombre = $("gasto-impuesto-nombre").value.trim();
      if (!nombre) {
        errEl.textContent = "Escribe el nombre del impuesto.";
        errEl.classList.remove("hidden");
        return;
      }
      esRetencion = $("gasto-impuesto-signo").value === "resta";
    } else {
      nombre = IMPUESTOS_CATALOGO[tipo].nombre;
      esRetencion = IMPUESTOS_CATALOGO[tipo].es_retencion;
    }
    const nuevo = { tipo, nombre, es_retencion: esRetencion, porcentaje: pct };

    const gastoId = $("gasto-id").value;
    if (gastoId && navigator.onLine) {
      try {
        const saved = await DATA.addGastoImpuesto({
          gasto_id: gastoId,
          tipo: nuevo.tipo,
          nombre: nuevo.nombre,
          es_retencion: nuevo.es_retencion,
          porcentaje: nuevo.porcentaje,
        });
        nuevo.id = saved.id;
      } catch (err) {
        errEl.textContent = "No se pudo guardar el impuesto: " + err.message;
        errEl.classList.remove("hidden");
        return;
      }
    }
    state.formImpuestos.push(nuevo);
    renderGastoImpuestosLista();
    resetMiniFormImpuesto();
    toast("Impuesto agregado");
  });

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
      $("gasto-fuente-fondos").value = g.fuente_fondos || "propio";
      $("gasto-credito-acreedor").value = g.credito_acreedor || "";
      renderProyectoPrestamistaOptions();
      $("gasto-proyecto-prestamista").value = g.proyecto_prestamista_id || "";
      toggleFuenteFondosFields();
      state.formImpuestos = (g.gasto_impuestos || []).map((imp) => ({ ...imp }));
      resetMiniFormImpuesto();
      renderGastoImpuestosLista();
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
      $("gasto-fuente-fondos").value = "propio";
      $("gasto-credito-acreedor").value = "";
      renderProyectoPrestamistaOptions();
      $("gasto-proyecto-prestamista").value = "";
      toggleFuenteFondosFields();
      state.formImpuestos = [];
      resetMiniFormImpuesto();
      renderGastoImpuestosLista();
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
        fecha_limite_pago:
          $("gasto-metodo").value === "Crédito" || $("gasto-fuente-fondos").value === "credito"
            ? $("gasto-fecha-limite").value || null
            : null,
        // con_iva ya no se toca desde el formulario — el desglose de
        // impuestos ahora vive en la tabla gasto_impuestos (ver más abajo).
        fuente_fondos: $("gasto-fuente-fondos").value,
        credito_acreedor:
          $("gasto-fuente-fondos").value === "credito" ? $("gasto-credito-acreedor").value.trim() || null : null,
        proyecto_prestamista_id:
          $("gasto-fuente-fondos").value === "prestamo" ? $("gasto-proyecto-prestamista").value || null : null,
      };

      if ($("gasto-fuente-fondos").value === "prestamo" && !payload.proyecto_prestamista_id) {
        throw new Error("Elige de qué proyecto viene el dinero prestado.");
      }

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
        if (state.formImpuestos.some((imp) => !imp.id)) {
          toast("Sin internet: los impuestos no se guardaron, agrégalos después editando el gasto", true);
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

      // Impuestos agregados mientras el gasto era nuevo (sin id todavía) o
      // agregados sin conexión a un gasto ya existente — los que ya tenían
      // "id" se guardaron al instante cuando se agregaron, así que aquí
      // solo se suben los que faltan.
      for (const imp of state.formImpuestos.filter((i) => !i.id)) {
        try {
          await DATA.addGastoImpuesto({
            gasto_id: gastoId,
            tipo: imp.tipo,
            nombre: imp.nombre,
            es_retencion: imp.es_retencion,
            porcentaje: imp.porcentaje,
          });
        } catch (err) {
          toast(`No se pudo guardar el impuesto "${imp.nombre}": ` + err.message, true);
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
