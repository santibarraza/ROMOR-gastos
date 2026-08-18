// Cliente de Supabase (cargado vía CDN en index.html como `supabase`)
window.sb = supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);
