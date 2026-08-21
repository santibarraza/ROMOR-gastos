// =============================================================
// Capa de datos: todas las llamadas a Supabase viven aquí
// =============================================================
window.DATA = (function () {
  async function getCategorias() {
    const { data, error } = await sb
      .from("categorias")
      .select("*")
      .order("orden", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function getProveedores() {
    const { data, error } = await sb
      .from("proveedores")
      .select("*")
      .order("nombre_empresa", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function saveProveedor(proveedor, id) {
    if (id) {
      const { data, error } = await sb.from("proveedores").update(proveedor).eq("id", id).select().single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await sb.from("proveedores").insert(proveedor).select().single();
      if (error) throw error;
      return data;
    }
  }

  async function deleteProveedor(id) {
    const { error } = await sb.from("proveedores").delete().eq("id", id);
    if (error) throw error;
  }

  async function getProyectos() {
    const { data, error } = await sb
      .from("proyectos")
      .select("*")
      .order("nombre", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function addProyecto(nombre) {
    const { data, error } = await sb
      .from("proyectos")
      .insert({ nombre })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Borra un proyecto. La base de datos tiene "on delete cascade" en
  // gastos/entradas/documentos/bitacora hacia proyectos, así que esto borra
  // también TODOS sus gastos, entradas, documentos y avances de bitácora —
  // por eso main.js pide confirmación mostrando esos totales antes de llamar
  // a esta función.
  async function deleteProyecto(id) {
    const { error } = await sb.from("proyectos").delete().eq("id", id);
    if (error) throw error;
  }

  async function getIntegrantes() {
    const { data, error } = await sb
      .from("integrantes")
      .select("*")
      .order("nombre", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function addIntegrante(nombre) {
    const { data, error } = await sb
      .from("integrantes")
      .insert({ nombre })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function getGastos(proyectoId) {
    // abonos_credito(*): trae los abonos parciales de cada gasto marcado
    // como "Crédito" (relación uno-a-muchos, Supabase la resuelve sola por
    // la llave foránea abonos_credito.gasto_id -> gastos.id). Así el saldo
    // pendiente de cada deuda se puede calcular en el cliente sin pedirlo
    // aparte.
    let q = sb
      .from("gastos")
      .select(
        "*, categorias(nombre), proveedores(nombre_empresa), proyectos(nombre), abonos_credito(*), gasto_documentos(*)"
      )
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false });
    if (proyectoId) q = q.eq("proyecto_id", proyectoId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function getGasto(id) {
    const { data, error } = await sb
      .from("gastos")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  }

  async function saveGasto(gasto, id) {
    if (id) {
      const { data, error } = await sb
        .from("gastos")
        .update(gasto)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await sb
        .from("gastos")
        .insert(gasto)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }

  async function deleteGasto(id) {
    const { error } = await sb.from("gastos").delete().eq("id", id);
    if (error) throw error;
  }

  async function getEntradas(proyectoId) {
    let q = sb
      .from("entradas")
      .select("*, proyectos(nombre)")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false });
    if (proyectoId) q = q.eq("proyecto_id", proyectoId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function getEntrada(id) {
    const { data, error } = await sb.from("entradas").select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  }

  async function saveEntrada(entrada, id) {
    if (id) {
      const { data, error } = await sb.from("entradas").update(entrada).eq("id", id).select().single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await sb.from("entradas").insert(entrada).select().single();
      if (error) throw error;
      return data;
    }
  }

  async function deleteEntrada(id) {
    const { error } = await sb.from("entradas").delete().eq("id", id);
    if (error) throw error;
  }

  async function uploadComprobante(file) {
    const ext = file.name.split(".").pop();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage
      .from("comprobantes")
      .upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;
    const { data: pub } = sb.storage.from("comprobantes").getPublicUrl(path);
    return { url: pub.publicUrl, nombre: file.name };
  }

  // -------------------- DOCUMENTOS --------------------
  async function getDocumentos(proyectoId) {
    let q = sb.from("documentos").select("*, proyectos(nombre)").order("created_at", { ascending: false });
    if (proyectoId) q = q.eq("proyecto_id", proyectoId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function addDocumento(documento) {
    const { data, error } = await sb.from("documentos").insert(documento).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteDocumento(id) {
    const { error } = await sb.from("documentos").delete().eq("id", id);
    if (error) throw error;
  }

  // -------------------- BITÁCORA DE AVANCE --------------------
  async function getBitacora(proyectoId) {
    let q = sb
      .from("bitacora")
      .select("*, proyectos(nombre)")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false });
    if (proyectoId) q = q.eq("proyecto_id", proyectoId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function addBitacoraEntry(entrada) {
    const { data, error } = await sb.from("bitacora").insert(entrada).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteBitacoraEntry(id) {
    const { error } = await sb.from("bitacora").delete().eq("id", id);
    if (error) throw error;
  }

  // -------------------- ABONOS DE GASTOS A CRÉDITO --------------------
  // Un gasto con metodo_pago === "Crédito" es una deuda con un proveedor.
  // Cada fila de abonos_credito es un pago parcial contra esa deuda; el
  // saldo pendiente se calcula en el cliente (monto del gasto menos la
  // suma de sus abonos), no se guarda como columna aparte.
  async function addAbonoCredito(abono) {
    const { data, error } = await sb.from("abonos_credito").insert(abono).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteAbonoCredito(id) {
    const { error } = await sb.from("abonos_credito").delete().eq("id", id);
    if (error) throw error;
  }

  // -------------------- DOCUMENTOS DE UN GASTO (varios por gasto) --------------------
  // Un gasto puede tener varios documentos/comprobantes (fotos y/o PDF), no
  // solo uno — cada fila de gasto_documentos es un archivo ya subido al
  // bucket "comprobantes" de Storage, ligado al gasto por gasto_id.
  async function addGastoDocumento(doc) {
    const { data, error } = await sb.from("gasto_documentos").insert(doc).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteGastoDocumento(id) {
    const { error } = await sb.from("gasto_documentos").delete().eq("id", id);
    if (error) throw error;
  }

  // -------------------- RECORDATORIOS --------------------
  // Tareas/trámites con fecha, opcionalmente ligados a un proyecto (o
  // generales si proyecto_id es null). Se traen TODOS siempre (no se
  // filtran por proyecto_id como gastos/entradas) porque la tarjeta fija
  // del dashboard los muestra sin importar el proyecto que esté filtrado.
  async function getRecordatorios() {
    const { data, error } = await sb
      .from("recordatorios")
      .select("*, proyectos(nombre)")
      .order("fecha", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function saveRecordatorio(recordatorio, id) {
    if (id) {
      const { data, error } = await sb.from("recordatorios").update(recordatorio).eq("id", id).select().single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await sb.from("recordatorios").insert(recordatorio).select().single();
      if (error) throw error;
      return data;
    }
  }

  async function deleteRecordatorio(id) {
    const { error } = await sb.from("recordatorios").delete().eq("id", id);
    if (error) throw error;
  }

  return {
    getCategorias,
    getProveedores,
    saveProveedor,
    deleteProveedor,
    getProyectos,
    addProyecto,
    deleteProyecto,
    getIntegrantes,
    addIntegrante,
    getGastos,
    getGasto,
    saveGasto,
    deleteGasto,
    getEntradas,
    getEntrada,
    saveEntrada,
    deleteEntrada,
    uploadComprobante,
    getDocumentos,
    addDocumento,
    deleteDocumento,
    getBitacora,
    addBitacoraEntry,
    deleteBitacoraEntry,
    addAbonoCredito,
    deleteAbonoCredito,
    addGastoDocumento,
    deleteGastoDocumento,
    getRecordatorios,
    saveRecordatorio,
    deleteRecordatorio,
  };
})();
