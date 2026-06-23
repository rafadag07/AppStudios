# Campus Verano gratis: web + sincronizacion

Esta app ya funciona en local aunque no configures nada. Para tenerla en varios dispositivos y sincronizada gratis, usa:

- Vercel Hobby: alojamiento gratuito para la web.
- Supabase Free: base de datos, login por email y archivos.
- PWA: instalable como acceso directo/app.

## 1. Crear Supabase

1. Entra en https://supabase.com y crea un proyecto gratis.
2. Ve a `SQL Editor`.
3. Copia y ejecuta el contenido de `supabase-schema.sql`.
4. Ve a `Project Settings > API`.
5. Copia:
   - `Project URL`
   - `anon public` o `publishable key`

## 2. Probar sincronizacion en local

1. Crea un archivo `.env` en la raiz del proyecto.
2. Copia dentro:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA_ANON
```

3. Arranca la app:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5174
```

4. Abre `http://127.0.0.1:5174`.
5. Pulsa `Nube`, escribe tu email y abre el enlace que te mande Supabase.

## 3. Subir gratis a Vercel

1. Sube esta carpeta a un repositorio de GitHub.
2. Entra en https://vercel.com con GitHub.
3. Pulsa `Add New > Project`.
4. Selecciona el repositorio.
5. Framework: Vite.
6. Build command: `npm run build`.
7. Output directory: `dist`.
8. En `Environment Variables`, añade:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
9. Deploy.

## 4. Permitir login desde Vercel

En Supabase:

1. Ve a `Authentication > URL Configuration`.
2. En `Site URL`, pon tu URL de Vercel.
3. En `Redirect URLs`, añade:
   - tu URL de Vercel
   - `http://127.0.0.1:5174`

## 5. Instalar como app

Cuando abras la URL de Vercel:

- En Chrome/Edge: menu de tres puntos > `Guardar y compartir` > `Instalar pagina` o `Crear acceso directo`.
- En movil: menu del navegador > `Añadir a pantalla de inicio`.

## Notas

- Los apuntes, asignaturas, temas, preguntas, calendario y tareas se guardan en Supabase cuando inicias sesion.
- Los archivos adjuntos nuevos se suben al bucket privado `campus-files`.
- Si no hay Supabase configurado, la app vuelve automaticamente a localStorage/IndexedDB.
- El plan gratis es suficiente para uso personal normal. Evita subir PDFs o imagenes enormes.
