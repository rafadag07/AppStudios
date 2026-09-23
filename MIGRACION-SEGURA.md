# AppStudios: propuesta de migración, 23 de septiembre de 2026

Estado actualizado: la sincronización con cuentas, almacenamiento offline separado por usuario, guardado automático, imágenes privadas, detección de conflictos, historial recuperable y eliminación de cuenta están implementados localmente y compilados. No se ha desplegado ni importado la copia real porque el proyecto configurado `pggxmkwhpbovwtwtnfgc.supabase.co` ya no existe en DNS. La creación de cuenta se intentó y falló antes de crear el usuario o subir datos.

El usuario autorizó continuar sin los diez adjuntos locales ausentes. La migración preparada elimina únicamente esas diez entradas `media` del estado de Rafael, conserva el JSON original independiente y migra el resto: 3 asignaturas, 25 temas, 50 preguntas, 1 tarea, 2 eventos, 150 sesiones Pomodoro y 169 imágenes incrustadas.

## Servicios existentes y recomendación

| Componente | Evidencia local | Decisión |
|---|---|---|
| Vercel | `.vercel/project.json`, URL indicada por el usuario | Aprovechar alojamiento existente; revisar diferencias del despliegue frente al checkout antes de publicar |
| GitHub | remoto `rafadag07/AppStudios`, API `api/appstudios-sync.js` | Conservar como fuente histórica de respaldo, no como base privada multiusuario |
| Supabase | SDK instalado, URL/clave pública configuradas localmente, cliente y SQL existentes | Aprovechar Auth, Postgres con RLS y Storage privado; verificar proyecto, región, plan y políticas efectivas en el panel |
| Navegador/PWA | IndexedDB, localStorage y service worker | Mantener almacenamiento local; separar legado y cada cuenta |

La pantalla actual usa nube manual de GitHub. El cliente Supabase incluye enlaces por correo, pero App.jsx no lo usa para autenticar/sincronizar los apuntes. Los adjuntos sí pueden usar Supabase si hay sesión. La instalación PWA no crea por sí sola una cuenta ni sincronización.

Problemas del código local que deben resolverse ANTES de activar cuentas:

- Exportación actual: incluye estado y Pomodoro, pero omite blobs de IndexedDB.
- `campus_sync_spaces`: políticas de lectura anónima `using (true)` y escritura por formato de código; no ofrece privacidad por usuario. No reutilizarla para nuevos datos privados.
- API manual local: no comprueba identidad; la producción responde 401 y parece diferir. Auditar despliegue efectivo; no asumir exposición pública ni que `APPSTUDIOS_SYNC_PASSWORD` proteja el código local.
- `campus_profiles`: un JSON completo por usuario, sobrescritura sin control de versión; insuficiente para conflictos/offline.
- Carga actual: puede borrar eventos al aplicar `__eventsClearedV2` y elimina la clave antigua de localStorage; Pomodoro añade ajustes históricos específicos. El importador nuevo no debe ejecutar estas mutaciones.
- Adjuntos actuales: si la subida funciona, no conserva necesariamente una copia local. Necesitan caché local y cola propia.
- Service worker: cachea todos los GET, incluidas posibles respuestas de API. El nuevo worker deberá cachear solo recursos estáticos, excluir Auth/API/Storage privado, versionar caché y no eliminar IndexedDB.

## Ubicación de cada copia

Origen: `https://appstudios.vercel.app`. Cambiar dominio, navegador o perfil puede abrir otro almacén. La app instalada puede compartirlo con su navegador o usar un contenedor distinto: comprobarlo en cada dispositivo.

| Datos | Ubicación |
|---|---|
| Asignaturas, temas, HTML de apuntes, preguntas, tareas, calendario | IndexedDB `appstudios-local-data` → `state` → clave `main`, campo `data` |
| Copia antigua | localStorage `summer-study-campus-v1`, si aún existe |
| Adjuntos locales | IndexedDB `summer-study-campus-files` → `files`, blobs por `fileId` |
| Pomodoro | localStorage `appstudios-pomodoro-history-v1` y `appstudios-pomodoro-settings-v1`; conservar también indicadores de ajustes históricos |
| Nube manual | GitHub, rama main por defecto, `appstudios-cloud/data.json` y partes referenciadas en `chunks/`; la configuración real de Vercel podría cambiar esos valores |
| Supabase antiguo | `campus_profiles`, `campus_sync_spaces`, bucket privado `campus-files`; existencia/contenido efectivos pendientes de verificar |

Ordenador Opera: exportación aportada recibida y duplicada, **43.345.817 bytes**, SHA-256 `aadd7b8dcdd3e3242868743474d3e23b886374c73ba619b287436dc146d9e4ef`. 3 asignaturas, 25 temas/documentos, 50 preguntas en asignaturas, 1 tarea, 2 eventos, 150 sesiones de Pomodoro. 169 apariciones de imágenes incrustadas (no necesariamente imágenes únicas). Diez referencias a adjuntos locales sin sus blobs. Cero notas en el array separado `notes` NO significa ausencia de apuntes: hay 25 documentos HTML.

El original en Descargas y la copia en `backups-private/opera-pc-2026-09-23/` coinciden byte a byte según SHA-256. Son dos archivos independientes pero están en el MISMO ordenador: trasladar uno a USB/disco externo para protegerse de fallo de disco. La carpeta está excluida de Git; no subir copias privadas al repositorio.

Copia del checkout de GitHub: manifiesto fechado 22 de julio; reconstrucción de 8.879.011 bytes, 3 asignaturas/4 temas, 5 adjuntos ausentes y sin Pomodoro. Copiados y verificados también los archivos de partes e históricos. **No equivale a la nube actual**. GET a la nube actual devolvió HTTP 401; queda pendiente exportación autenticada. Portátil, móvil y tablet: aún no inventariados.

## Cómo completar los respaldos sin reemplazar datos

1. En cada dispositivo, detener edición, esperar a que indique guardado local y descargar `Copia`. Renombrar el archivo con dispositivo, navegador y fecha. NO pulsar `Actualizar datos` ni `Importar`: sustituyen datos.
2. En Opera del PC, exportar también los adjuntos. Herramienta preparada: `tools/export-device-readonly.js`. Abrir la pestaña original, F12 → Consola; ejecutar el contenido completo del archivo revisado. Solo lee las dos bases conocidas y claves concretas, no incluye tokens ni envía datos. Descarga un JSON v3 con blobs en base64 y hashes. No ejecutar en localhost: sería otro almacén. Si el navegador bloquea pegar código, no desactivar protecciones; usar una vía de exportación revisada con asistencia.
3. Verificar el archivo DESCARGADO en disco con `node tools/backup-audit.mjs RUTA`. Comprueba JSON, hash del sobre v3, tamaño/hash de cada blob y referencias ausentes. Repetir la copia si se detecta escritura concurrente. En móvil/tablet hará falta exportación completa en el origen o depuración del navegador; la exportación JSON actual es un primer respaldo, no un respaldo completo de adjuntos.
4. Exportar la nube mediante una sesión autorizada, sin aplicar su contenido al dispositivo. `tools/download-cloud-readonly.mjs` usa solo GET, pero el acceso actual está bloqueado por 401. No enviar contraseñas al chat. Antes de adaptar la herramienta, revisar cómo autentica la versión desplegada.
5. Abrir una selección de documentos, preguntas, PDF/imágenes y Pomodoros desde una restauración AISLADA. Validar todos los hashes y adjuntos; el hash prueba integridad, no actualidad ni recuperación funcional. Copias con referencias faltantes permanecen incompletas.
6. Guardar archivos y manifiestos en un segundo soporte. Mantener originales por dispositivo incluso si una copia parece más reciente; no sobrescribirlos con una supuesta copia principal.

## Así quedaría el flujo de cuentas e importación

`Crear cuenta (correo + contraseña) → confirmar correo → iniciar sesión → espacio privado separado → revisar copias → elegir qué importar → confirmar`.

Supabase Auth gestionará registro, verificación, inicio, cierre y recuperación de contraseña. La app nunca guarda contraseñas en su base de estudio. Antes del primer inicio online no se puede autenticar una cuenta nueva sin red. Una cuenta ya abierta podrá estudiar offline; los cambios esperan si caduca la sesión y solo salen tras reautenticarse con el mismo usuario.

El legado se mantiene intacto. Nuevo IndexedDB con clave compuesta por `user_id` para entidades, adjuntos, historial, cursores y cola. Cambiar de cuenta cambia de espacio; jamás reasigna la cola de A a B. Cerrar sesión detiene sincronización y oculta datos de la cuenta, sin eliminar cambios pendientes. En equipos compartidos ofrecer borrado local explícito con aviso de pendientes, después de exportar o sincronizar; IndexedDB no es una caja fuerte frente a quien controle el perfil del navegador.

Pantalla de revisión real: identidad de cuenta destino, dispositivo/origen, fecha, SHA-256, cantidades, adjuntos presentes/ausentes, duplicados y diferencias por entidad. Acciones: **añadir**, **omitir idéntico**, **conservar ambas variantes**, **resolver tras comparar**. No decidir por el reloj del dispositivo. IDs heredados se conservan en un mapa por origen; no deduplicar simplemente porque coincidan. Mostrar preguntas y sesiones importadas antes de aceptar. Conservar campos desconocidos en la copia original.

Existe un inventario real de revisión en `backups-private/opera-pc-2026-09-23/import-review.json`: ninguna fila seleccionada, cuenta destino sin asignar, importación bloqueada. No es un archivo ejecutable ni se ha enviado a ningún servicio.

La confirmación debe vincular cuenta, hash de copia y plan exacto. Si cambia la fuente o el destino, rehacer revisión. Importaciones por lotes reanudables con identificadores idempotentes, validación y manifiesto completo; nunca marcar completada una importación parcial. No eliminar ni vaciar la fuente. El rollback cambia a la vista del legado, conservando también la nueva cuenta y sus cambios; una reversión no equivale a borrar versiones.

## Sincronización propuesta

- Guardar localmente datos + operación pendiente en la misma transacción de IndexedDB; mostrar error si falla. Tras unos 600 ms sin escribir, enviar cambios de entidades afectadas. Espera máxima durante edición continua; vaciar estado del editor al perder foco/ocultarse. No confiar únicamente en un último guardado al cerrar.
- Asignaturas, temas/documentos, preguntas, tareas, recursos, agenda y sesiones de Pomodoro tendrán IDs estables separados. Configuración Pomodoro también sincronizada; temporizador activo representa hora de inicio/fin e ID de sesión, no un mensaje por segundo. Finalización idempotente para no contabilizar dos veces.
- Cola duradera, orden por entidad, reintentos con backoff, operación UUID y recibo de servidor. No retirar operaciones hasta confirmación. Manejar red caída, 401, cuota, cierre de app, respuesta perdida y varias pestañas. Bloqueo/lease en IndexedDB para un único despachador por cuenta, sin depender solo de memoria.
- Reconectar al evento online, al recuperar foco, al iniciar sesión y mediante comprobación periódica. Realtime notifica cambios; descarga incremental recupera los omitidos. Sincronizar con la app abierta; los sistemas móviles pueden suspenderla cerrada, así que no prometer ejecución permanente en segundo plano.
- Servidor valida la revisión base de forma atómica bajo bloqueo por usuario/entidad. Si coincide, crea revisión y avanza cabecera; si no, guarda rama en conflicto y no destruye la versión vigente. El usuario compara ambas, combina o restaura creando otra revisión. Borrados son marcadores recuperables que también pueden entrar en conflicto.
- Historial y cambios usan secuencia confirmada por usuario y paginación, no solo marcas horarias del cliente. Resolver huecos de transacciones y garantizar orden de commit antes de usar cursores. No confundir notificación Realtime con entrega fiable.
- PDFs e imágenes: primero copia local, hash de contenido, subida reanudable al bucket privado bajo `user_id/hash`, sin sobrescribir objetos de otra versión. Referencias publicadas tras confirmar el archivo; descargar/caché verificada para modo offline. Extraer imágenes base64 sin alterar la copia original. Una imagen externa no queda disponible offline hasta descargarla.

## Cuentas y permisos: contrato de servidor a implementar y probar

| Tabla propuesta | Contenido y restricciones |
|---|---|
| `study_entities` | Propietario + ID + tipo + referencia padre + revisión actual + marcador borrado. PK compuesta usuario/ID; padres del mismo propietario |
| `study_revisions` | Revisiones inmutables, valor, base, dispositivo, operación, estado de conflicto; índice usuario/entidad |
| `study_operations` | Recibos únicos por usuario/UUID; mismo UUID con otro cuerpo se rechaza |
| `study_changes` | Secuencia por usuario para descarga incremental, incluidos conflictos y borrados |
| `study_imports` | Cuenta, hash origen, plan aprobado, lote, estado y resultado para reanudar |

RLS en todas las tablas: `auth.uid() = user_id`, sin lectura anónima ni espacios por código. Derivar propietario del JWT validado, nunca confiar en `user_id` enviado por cliente. Escrituras solamente por RPC transaccional que comprueba propietario, revisión base, relaciones, límites y tamaños; revocar escrituras directas a anon/authenticated en tablas de revisiones y recibos. Funciones con privilegios elevados requieren `search_path` fijo, comprobaciones explícitas y permisos de ejecución acotados. Clave service-role solo servidor, nunca Vite/APK.

Storage privado, prefijo del usuario validado en cada operación y URLs firmadas breves. No usar URL pública como control de acceso. Probar con dos usuarios reales que B no puede leer/escribir/restaurar/falsificar recibos de A, ni obtener sus archivos. Validar HTML importado contra XSS antes de mostrarlo. Revisar permisos antiguos después de respaldar sus datos; no borrarlos a ciegas.

Google Play: preparar exportación, eliminación de cuenta y datos desde la app y una URL externa, política de privacidad y declaración de seguridad de datos. La eliminación debe cubrir Auth, tablas, objetos, historial y una política explícita de retención de copias. [Requisito oficial de eliminación](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en). Publicar en Play y mantener una PWA son tareas distintas.

## Coste y límites reales

Supabase Free: **0 USD/mes**, 500 MB de base de datos por proyecto, 1 GB de archivos, 50.000 usuarios activos/mes, 5 GB de salida y otros 5 GB de salida cacheada, máximo 50 MB por archivo. Realtime: 200 conexiones simultáneas y 2 millones de mensajes/mes. Máximo 2 proyectos Free activos; pausa tras una semana de inactividad. Sin backups automáticos ni recuperación a un instante (PITR) incluidos. Pro desde 25 USD/mes, más posibles extras/impuestos. [Tarifas oficiales](https://supabase.com/pricing).

Free no genera cargos por exceso: puede imponer restricciones, impedir escrituras o exigir reducir consumo/cambiar de plan para continuar. La app debe conservar pendientes localmente e informar, nunca borrarlos por un error de cuota. [Control de costes](https://supabase.com/docs/guides/platform/cost-control), [cuota de base de datos](https://supabase.com/docs/guides/platform/database-size).

El correo integrado de Supabase es para pruebas: solo destinatarios autorizados del equipo, actualmente 2 mensajes/hora y sin garantía de entrega. Para registro público y recuperación hace falta SMTP propio; su proveedor y dominio pueden tener coste y límites adicionales. No presupuestar correo público ilimitado gratis. [SMTP oficial](https://supabase.com/docs/guides/auth/auth-smtp).

Tu JSON pesa 43,35 MB con imágenes incrustadas. Copiar ese JSON entero en cada guardado agotaría pronto base de datos, historial y transferencia (100 transferencias completas rondan 4,33 GB). Separar adjuntos, enviar entidades modificadas y conservar versiones sin duplicar archivos es esencial. No se puede estimar capacidad real por número de usuarios sin medir documentos, adjuntos y revisiones. Añadir alertas de cuota y política visible de retención; nunca podar conflictos pendientes silenciosamente.

Mantener Vercel Hobby mientras se ajuste a uso personal no comercial; revisar plan antes de monetizar/publicar un servicio comercial. [Condiciones Hobby](https://vercel.com/docs/plans/hobby). GitHub se mantiene para código y respaldos históricos existentes, no para publicar nuevos apuntes privados.

## Ensayo y puerta de salida

`node tools/serve-sync-lab.mjs` → http://127.0.0.1:4178. Sirve solo los dos archivos de laboratorio, no los respaldos. Prueba visual con tres dispositivos simulados, dos cuentas, revisión de importación, pausa de 600 ms, offline, conflictos e historial. No es registro real y recargar reinicia el ensayo. `node --test tests/sync-model.test.mjs`: 8 pruebas superadas; la reapertura usa un adaptador de disco simulado, no un navegador real.

También se comprobó en navegador que el ejemplo llega a las tres vistas y que una edición offline en conflicto queda conservada al reconectar. Esto no valida aún IndexedDB de producción, Supabase Auth/RLS, entrega real entre dispositivos, adjuntos ni el service worker.

No activar ni desplegar hasta: (1) copias de todos los orígenes verificadas y prueba de restauración aislada; (2) revisión del usuario del plan real; (3) entorno Supabase de pruebas separado con dos cuentas ficticias, permisos negativos y carreras concurrentes; (4) pruebas de cerrar/reabrir offline, caducidad, cuota, archivos y cambio de cuenta en móvil/PC/tablet; (5) informe de resultados y aprobación de migración exacta. Hoy siguen pendientes estos requisitos.
