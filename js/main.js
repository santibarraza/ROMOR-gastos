// =============================================================
// Lógica principal de la app (vistas, eventos, render)
// =============================================================
(function () {
  const state = {
    categorias: [],
    proveedores: [],
    integrantes: [],
    gastos: [],
    currentUser: localStorage.getItem("romor_user") || null,
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

  $("logout-btn").addEventListener("click", async () => {
    await sb.auth.signOut();
    localStorage.removeItem("romor_user");
    state.currentUser = null;
    $("login-password").value = "";
    showView("login");
  });

  $("change-user-btn").addEventListener("click", () => {
    showNameView();
  });

  async function afterLogin() {
    await loadCatalogs();
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
    const [categorias, proveedores, integrantes] = await Promise.all([
      DATA.getCategorias(),
      DATA.getProveedores(),
      DATA.getIntegrantes(),
    ]);
    state.categorias = categorias;
    state.proveedores = proveedores;
    state.integrantes = integrantes;
  }

  // -------------------- DASHBOARD --------------------
  async function goToDashboard() {
    $("current-user-label").textContent = state.currentUser;
    showView("dashboard");
    await refreshGastos();
  }

  async function refreshGastos() {
    try {
      state.gastos = await DATA.getGastos();
    } catch (err) {
      toast("Error cargando gastos: " + err.message, true);
      return;
    }
    renderFiltroCategoria();
    renderResumen();
    renderLista();
  }

  function renderFiltroCategoria() {
    const sel = $("filtro-categoria");
    const current = sel.value;
    sel.innerHTML =
      '<option value="">Todas las partidas</option>' +
      state.categorias.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
    sel.value = current;
  }

  function renderResumen() {
    const total = state.gastos.reduce((s, g) => s + Number(g.monto), 0);
    $("total-general").textContent = fmt(total);
    $("total-count").textContent = state.gastos.length;

    const porCategoria = {};
    for (const g of state.gastos) {
      const nombre = g.categorias?.nombre || "Sin categoría";
      porCategoria[nombre] = (porCategoria[nombre] || 0) + Number(g.monto);
    }
    const filas = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
    const cont = $("totales-categoria");
    if (filas.length === 0) {
      cont.innerHTML = '<p class="text-sm text-slate-400">Sin datos todavía.</p>';
      return;
    }
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
          <div class="bg-slate-700 h-1.5 rounded-full" style="width:${(monto / max) * 100}%"></div>
        </div>
      </div>`
      )
      .join("");
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
