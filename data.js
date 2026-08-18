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
    let q = sb
      .from("gastos")
      .select("*, categorias(nombre), proveedores(nombre_empresa)")
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
    let q = sb.from("entradas").select("*").order("fecha", { ascending: false }).order("created_at", { ascending: false });
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

  return {
    getCategorias,
    getProveedores,
    getProyectos,
    addProyecto,
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
  };
})();
