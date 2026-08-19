# ROMOR · Control de gastos de obra

App web sencilla para que varias personas registren y consulten los gastos
de la obra desde el celular o la computadora, en tiempo real y en un solo
lugar. Todos entran con la misma contraseña y luego eligen su nombre, así
queda registrado quién capturó y quién pagó cada gasto.

No requiere instalar nada ni saber programar. Es un sitio estático (HTML +
JavaScript) que se conecta a una base de datos en **Supabase** y se aloja
gratis en **Vercel**.

---

## 1. Qué necesitas crear (todo gratis)

1. Una cuenta en **Supabase** (la base de datos) → https://supabase.com
2. Una cuenta en **GitHub** (para subir los archivos) → https://github.com
3. Una cuenta en **Vercel** (donde vive la app, con el link que compartes) → https://vercel.com

Puedes usar el mismo correo (santibarraza@gmail.com) para las tres.

---

## 2. Crear la base de datos en Supabase

1. Entra a https://supabase.com, crea una cuenta y luego un **New project**.
   - Nombre: `romor-gastos` (o el que quieras)
   - Contraseña de base de datos: la que te sugiera o una que tú definas (guárdala, no es la que usará el equipo)
   - Región: la más cercana (ej. `West US` o `East US`)
2. Espera 1-2 minutos a que el proyecto termine de crearse.
3. En el menú izquierdo entra a **SQL Editor** → **New query**.
4. Abre el archivo `sql/schema.sql` de esta carpeta, copia **todo** el contenido, pégalo ahí y dale **Run**.
   - Esto crea las tablas y precarga las categorías y proveedores que ya tenías capturados (Eléctrico, Hidrosanitario, Materiales, etc.)
5. Crea el bucket para las fotos de comprobantes:
   - Ve a **Storage** (menú izquierdo) → **New bucket**
   - Nombre: `comprobantes`
   - Activa **Public bucket**
   - Crea el bucket
6. Regresa a **SQL Editor** → **New query** y corre solo esta parte (ya está al final de `schema.sql` también, por si el bucket no existía la primera vez):
   ```sql
   insert into storage.buckets (id, name, public)
   values ('comprobantes', 'comprobantes', true)
   on conflict (id) do nothing;
   ```
7. Crea el usuario compartido con el que todo el equipo va a entrar:
   - Ve a **Authentication** → **Users** → **Add user** → **Create new user**
   - Email: `equipo@romor-obra.local` (cópialo tal cual, no importa que no sea un correo real)
   - Password: **la contraseña que quieras compartir con tu equipo** (ej. "Obra2026!")
   - Activa la casilla **Auto Confirm User**
   - Crea el usuario
8. Copia tus llaves de conexión:
   - Ve a **Project Settings** (ícono de engrane) → **API**
   - Copia el **Project URL** (algo como `https://xxxxx.supabase.co`)
   - Copia la llave **anon public**

---

## 3. Configurar la app con tus llaves

1. Abre el archivo `js/config.js` de esta carpeta.
2. Reemplaza:
   - `SUPABASE_URL` con tu Project URL
   - `SUPABASE_ANON_KEY` con tu llave anon public
   - Deja `SHARED_LOGIN_EMAIL` como `equipo@romor-obra.local` (o cámbialo si usaste otro correo en el paso 2.7 — deben ser idénticos)
3. Guarda el archivo.

---

## 4. Subir el proyecto a GitHub

1. Entra a https://github.com, crea una cuenta si no tienes.
2. Da clic en **New repository**. Nombre: `romor-gastos`. Puede ser público o privado (privado es más discreto, es gratis). Crea el repositorio.
3. En la página del repo, da clic en **uploading an existing file** (o el botón **Add file → Upload files**).
4. Arrastra **todos los archivos y carpetas** de esta carpeta (`index.html`, `js/`, `sql/`, `README.md`) y dale **Commit changes**.

> ⚠️ **Si ya tenías la app funcionando y solo estás actualizando** (por ejemplo, agregando una función nueva): **NO subas `js/config.js`** a menos que este archivo en particular haya cambiado — ese archivo trae tu URL y llave real de Supabase, y si subes el de la plantilla lo pisas con los valores de ejemplo (`TU-PROYECTO`, `TU-ANON-KEY`) y el login deja de funcionar. Sube todo lo demás normal; solo evita reemplazar `js/config.js` salvo que te lo indique explícitamente.

---

## 5. Publicar en Vercel

1. Entra a https://vercel.com y crea una cuenta usando **Continue with GitHub** (así quedan conectadas).
2. Da clic en **Add New** → **Project**.
3. Busca el repositorio `romor-gastos` y dale **Import**.
4. No necesitas cambiar ninguna configuración (no hay "build command", es un sitio estático) — dale **Deploy**.
5. En 30-60 segundos te da un link tipo `https://romor-gastos.vercel.app`. **Ese es el link que compartes con tu equipo.**

---

## 6. Usar la app

1. Comparte con tu equipo: el link de Vercel + la contraseña que definiste en el paso 2.7.
2. Cada persona entra, escribe la contraseña, y la primera vez elige o escribe su nombre (se guarda en su celular/compu, no lo vuelve a pedir).
3. Después de elegir su nombre, entra **directo al dashboard con la vista general**: los totales, gráficas y lista que ves por defecto combinan **todos los proyectos juntos**. Arriba hay un selector "🌐 Todos los proyectos" con el que puedes cambiar a ver solo uno en particular, sin perder la vista general de conjunto.
4. Con el botón **+** se agrega un gasto en cualquier momento, sin necesidad de entrar antes a un proyecto — el formulario te pregunta a qué proyecto pertenece (por defecto propone el que tengas filtrado, o el último que usaste).
5. Con el enlace **"proyectos"** (junto a tu nombre) entras a administrar proyectos: crear uno nuevo, o tocar uno para filtrar el dashboard por ese proyecto. "🌐 Vista general" regresa a ver todo junto.
6. En la pestaña **Entradas** se registra el dinero que entra a un proyecto (aportaciones, ingresos) — con eso la app calcula el **Saldo** (entradas − gastos) en verde si es positivo y en rojo si es negativo.
7. En la pantalla principal se ven las gráficas de gasto por partida y por mes, la lista completa con filtro por categoría (y por proyecto, si dejas la vista en "Todos los proyectos" cada gasto/entrada muestra una etiqueta con su proyecto), y el botón **⬇️ Exportar a Excel** descarga un archivo `.xlsx` con tres hojas (Resumen, Gastos, Entradas) reflejando lo que estés viendo (todo, o solo el proyecto filtrado).
8. Cualquiera puede editar o borrar cualquier gasto/entrada/proyecto — tal como lo pediste, no hay restricciones entre integrantes.

---

## 6.1 Si ya tenías la app funcionando (actualización a proyectos + entradas)

Si ya habías corrido `sql/schema.sql` antes y tu app ya está en uso, **no vuelvas a correr ese archivo completo** (volvería a intentar insertar cosas que ya existen). En vez de eso:

1. Ve a Supabase → **SQL Editor** → **New query**.
2. Copia y pega **todo** el contenido de `sql/migration_v2_proyectos_entradas.sql` de esta carpeta, y dale **Run**.
3. Esto agrega las tablas de `proyectos` y `entradas`, mete tus gastos ya existentes dentro de un proyecto llamado "ROMOR" (para no perder nada), limpia los proveedores duplicados y refuerza los permisos.
4. Vuelve a subir **todos** los archivos de este zip a tu repo de GitHub (reemplazando los que ya tenías) para que la app tenga las pantallas nuevas.

---

## 6.2 Actualización: vista general por defecto

Esta versión cambia cómo funcionan los proyectos en el dashboard:

- Ya no hay que entrar primero a un proyecto para ver gastos o agregar uno nuevo — al iniciar sesión ves de una vez la vista general (todos los proyectos combinados), y el botón **+** funciona directo desde ahí.
- La pantalla de "Proyectos" pasó de ser un paso obligatorio a una pantalla de administración: sirve para crear proyectos nuevos o cambiar el filtro del dashboard.
- **No necesitas correr ninguna migración de SQL nueva para esto** — es un cambio solo de interfaz, no de la base de datos. Basta con subir los archivos actualizados (`index.html`, `js/data.js`, `js/main.js`) a GitHub como siempre (recuerda: **no** subas `js/config.js`).
- Si el botón "Crear" de un proyecto nuevo no hace nada o no lo ves reflejado, ahora aparece un mensaje de error debajo del botón con el motivo real (por ejemplo, si te faltó correr la migración `migration_v2_proyectos_entradas.sql` de la sección 6.1, o si ya existe un proyecto con ese nombre) — antes ese error quedaba oculto.

---

## 6.3 Actualización: logo y tipografía de marca

Se agregó el logo real de ROMOR (antes era solo el emoji 🏗️) y las fuentes de marca:
**Bebas Neue** para los títulos de cada pantalla y **Roboto** para el resto del texto
(ambas se cargan gratis desde Google Fonts, no requieren instalar nada).

- El logo vive en `assets/logo.png` (aparece en la pantalla de login y en el encabezado
  del dashboard) y también se generó el set de íconos de pestaña/favicon a partir de él
  (`assets/favicon*.png`, `assets/favicon.ico`, `assets/apple-touch-icon.png`).
- Si más adelante cambias el logo, mándamelo y yo regenero todos estos archivos
  (el logo grande y los distintos tamaños de favicon) a partir de esa imagen.
- Al actualizar, no olvides subir también la carpeta **`assets/`** completa a GitHub
  (además de `index.html`), si no el logo y los íconos no van a cargar.

---

## 6.4 Actualización: colores de marca y look profesional

Se rediseñó la app con los colores del logo (rojo `#DB002E` y naranja `#FFB000`) en vez
del negro/gris genérico que tenía antes:

- Todos los botones principales (Entrar, Guardar, el tab activo, el botón **+**, Nueva
  entrada) ahora son rojo de marca en vez de negro.
- Las gráficas de "por partida" y "por mes" también usan el rojo de marca en vez del
  azul genérico que tenían.
- Los números grandes del resumen (Entradas/Gastos/Saldo) usan la fuente Bebas Neue
  para más impacto visual — el color de Saldo (verde/rojo según sea positivo o
  negativo) se mantiene igual, es independiente del color de marca.
- Las tarjetas (resumen, listas de gastos/entradas, secciones) ahora tienen una
  sombra sutil en vez de verse completamente planas.
- Se quitó el emoji 👋 de la pantalla "¿Quién eres?" y se reemplazó por el ícono de
  marca (la "r" del logo); el botón de exportar a Excel ahora usa un ícono en vez
  del emoji ⬇️.
- El foco de los campos de formulario (al hacer clic para escribir) ahora se ve en
  rojo de marca en vez del azul por defecto del navegador.
- No requirió ninguna migración de SQL ni archivos nuevos aparte de los ya
  mencionados en 6.3 — solo sube `index.html` y `js/main.js` actualizados (y la
  carpeta `assets/` si aún no la habías subido).

---

## 6.5 Actualización: documentos, reporte PDF, bitácora, modo sin internet y directorio de proveedores

Esta versión agrega 5 funciones nuevas a la app:

1. **Documentos del proyecto** (pestaña "Documentos"): sube contratos, permisos, planos o cotizaciones (foto o PDF) y quedan guardados por proyecto, con un botón para verlos/descargarlos y otro para borrarlos.
2. **Reporte PDF** (botón "Reporte PDF" junto a "Excel"): genera un PDF con el logo, el resumen (entradas/gastos/saldo), la gráfica de gasto por partida y las tablas completas de gastos y entradas — respeta el filtro de proyecto que tengas activo (uno solo, o todos juntos).
3. **Bitácora de avance** (pestaña "Bitácora"): registra notas de avance de obra con fecha y fotos (puedes elegir varias a la vez).
4. **Modo sin internet**: la app se puede "instalar" (es una PWA) y sigue cargando aunque no haya señal; si capturas un gasto, una entrada o una nota de bitácora sin internet, se guarda en el celular con una etiqueta "⏳ sin subir" y se sube solo en cuanto vuelva la conexión (aparece un aviso arriba de la pantalla mientras tanto). Las fotos y documentos sí necesitan internet en el momento — si no hay señal, se guarda la nota o el gasto y puedes agregar la foto/comprobante después editándolo.
5. **Directorio de proveedores** (enlace "proveedores" junto a tu nombre): lista de todos tus proveedores con su categoría, contacto, teléfono, un botón directo a WhatsApp y el total que les has pagado (sumando sus gastos). Puedes agregar, editar o borrar proveedores desde ahí.

### Pasos para activar esta actualización

1. Ve a Supabase → **SQL Editor** → **New query**.
2. Copia y pega **todo** el contenido de `sql/migration_v3_documentos_bitacora.sql` de esta carpeta, y dale **Run**.
   - Esto crea las tablas `documentos` y `bitacora`. **No necesitas crear ningún bucket nuevo en Storage** — reutiliza el mismo bucket `comprobantes` que ya tenías del paso 2.5.
3. Sube **todos** los archivos de este paquete a tu repo de GitHub, reemplazando los que ya tenías — incluye especialmente los dos archivos nuevos que van en la **raíz** del repo (junto a `index.html`, NO dentro de `js/`): `manifest.json` y `sw.js`. Recuerda: **no** subas `js/config.js`.
4. Vercel vuelve a publicar solo en cuanto detecta el cambio en GitHub.

> 💡 **Instalar la app en el celular (opcional):** una vez publicado, al abrir el link en Chrome (Android) o Safari (iPhone) aparece la opción "Agregar a pantalla de inicio" / "Instalar app" — así queda como un ícono más, se abre a pantalla completa y funciona el modo sin internet.

---

## 7. Cómo hacer cambios después

- **Agregar categorías o proveedores nuevos:** en Supabase, ve a **Table Editor** → tabla `categorias` o `proveedores` → **Insert row**. No hace falta tocar código.
- **Agregar integrantes del equipo:** se agregan solos la primera vez que alguien escribe su nombre en la app, o también los puedes precargar en la tabla `integrantes` desde Supabase.
- **Cambiar la contraseña compartida:** en Supabase → **Authentication** → **Users** → busca `equipo@romor-obra.local` → los tres puntos → **Reset password** (o edítalo directo).
- **Cambiar el diseño o agregar funciones:** puedo ayudarte a modificar `index.html` / `js/main.js` cuando quieras; solo vuelves a subir los archivos actualizados a GitHub y Vercel los publica solo.

---

## Estructura del proyecto

```
index.html                                  Toda la interfaz (login, nombre, proyectos, dashboard, formularios; Tailwind vía CDN)
manifest.json                               Configuración de la PWA (permite "instalar" la app y el modo sin internet, ver 6.5)
sw.js                                       Service worker: cachea el cascarón de la app para que cargue sin internet (ver 6.5)
assets/                                     Logo y favicons de la marca (ver 6.3)
js/config.js                                Tus llaves de Supabase — edítalo en el paso 3
js/supabaseClient.js                        Conexión con Supabase
js/data.js                                  Todas las consultas a la base de datos
js/main.js                                  Lógica de la interfaz
sql/schema.sql                              Esquema completo — solo para un proyecto de Supabase NUEVO
sql/migration_v2_proyectos_entradas.sql     Migración — para un proyecto que ya tenías funcionando (ver 6.1)
sql/migration_v3_documentos_bitacora.sql    Migración — documentos, bitácora y proveedores directorio (ver 6.5)
```
