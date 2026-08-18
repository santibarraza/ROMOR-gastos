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
3. Después elige o crea un **proyecto** (puedes tener varias obras/proyectos separados; cada uno lleva sus propios gastos, entradas y totales).
4. Con el botón **+** se agrega un gasto: monto, fecha, partida, proveedor, método de pago, quién pagó y, si quieren, la foto del comprobante.
5. En la pestaña **Entradas** se registra el dinero que entra al proyecto (aportaciones, ingresos) — con eso la app calcula el **Saldo** (entradas − gastos) en verde si es positivo y en rojo si es negativo.
6. En la pantalla principal se ven las gráficas de gasto por partida y por mes, la lista completa con filtro por categoría, y el botón **⬇️ Exportar a Excel** descarga un archivo `.xlsx` con tres hojas (Resumen, Gastos, Entradas) del proyecto que estés viendo.
7. Cualquiera puede editar o borrar cualquier gasto/entrada/proyecto — tal como lo pediste, no hay restricciones entre integrantes.

---

## 6.1 Si ya tenías la app funcionando (actualización a proyectos + entradas)

Si ya habías corrido `sql/schema.sql` antes y tu app ya está en uso, **no vuelvas a correr ese archivo completo** (volvería a intentar insertar cosas que ya existen). En vez de eso:

1. Ve a Supabase → **SQL Editor** → **New query**.
2. Copia y pega **todo** el contenido de `sql/migration_v2_proyectos_entradas.sql` de esta carpeta, y dale **Run**.
3. Esto agrega las tablas de `proyectos` y `entradas`, mete tus gastos ya existentes dentro de un proyecto llamado "ROMOR" (para no perder nada), limpia los proveedores duplicados y refuerza los permisos.
4. Vuelve a subir **todos** los archivos de este zip a tu repo de GitHub (reemplazando los que ya tenías) para que la app tenga las pantallas nuevas.

---

## 7. Cómo hacer cambios después

- **Agregar categorías o proveedores nuevos:** en Supabase, ve a **Table Editor** → tabla `categorias` o `proveedores` → **Insert row**. No hace falta tocar código.
- **Agregar integrantes del equipo:** se agregan solos la primera vez que alguien escribe su nombre en la app, o también los puedes precargar en la tabla `integrantes` desde Supabase.
- **Cambiar la contraseña compartida:** en Supabase → **Authentication** → **Users** → busca `equipo@romor-obra.local` → los tres puntos → **Reset password** (o edítalo directo).
- **Cambiar el diseño o agregar funciones:** puedo ayudarte a modificar `index.html` / `js/main.js` cuando quieras; solo vuelves a subir los archivos actualizados a GitHub y Vercel los publica solo.

---

## Estructura del proyecto

```
index.html                              Toda la interfaz (login, nombre, proyectos, dashboard, formularios; Tailwind vía CDN)
js/config.js                            Tus llaves de Supabase — edítalo en el paso 3
js/supabaseClient.js                    Conexión con Supabase
js/data.js                              Todas las consultas a la base de datos
js/main.js                              Lógica de la interfaz
sql/schema.sql                          Esquema completo — solo para un proyecto de Supabase NUEVO
sql/migration_v2_proyectos_entradas.sql Migración — para un proyecto que ya tenías funcionando (ver 6.1)
```
