// Ejecutar en la consola de LA PESTAÑA ORIGINAL, con la edición detenida.
// Solo lecturas. No importa, modifica, borra ni envía datos a una red.
(async () => {
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  const databases = await indexedDB.databases();
  async function read(name, store) {
    if (!databases.some(db => db.name === name)) return [];
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('La base desapareció. No se ha creado otra.')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(store)) { db.close(); reject(new Error(`Falta ${name}/${store}`)); return; }
        const tx = db.transaction(store, 'readonly');
        const records = tx.objectStore(store).getAll();
        tx.oncomplete = () => { db.close(); resolve(records.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }
  const keys = ['summer-study-campus-v1', 'appstudios-pomodoro-history-v1', 'appstudios-pomodoro-settings-v1', 'appstudios-pomodoro-july-2026-adjustment-v1', 'appstudios-pomodoro-july-22-2026-adjustment-v1', 'appstudios-local-data-updated-at'];
  const localBefore = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
  const state = await read('appstudios-local-data', 'state');
  const storedFiles = await read('summer-study-campus-files', 'files');
  const files = [];
  for (const file of storedFiles) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const { blob, ...metadata } = file;
    files.push({ ...metadata, size: bytes.length, sha256: await digest(bytes), base64: btoa(binary) });
  }
  const stateAfter = await read('appstudios-local-data', 'state');
  if (JSON.stringify(state) !== JSON.stringify(stateAfter) || keys.some(key => localBefore[key] !== localStorage.getItem(key))) throw new Error('Los datos cambiaron durante la copia. Detén la edición y repite.');
  const data = state.find(row => row.key === 'main')?.data || JSON.parse(localBefore['summer-study-campus-v1'] || 'null');
  if (!Array.isArray(data?.subjects)) throw new Error('No hay datos reconocibles. No se ha exportado una copia vacía.');
  const payload = {
    app: 'AppStudios', format: 'appstudios-independent-backup-v3', exportedAt: new Date().toISOString(),
    origin: location.origin, device: navigator.userAgent, data, rawState: state, rawLocalStorage: localBefore, files,
    pomodoro: { history: JSON.parse(localBefore['appstudios-pomodoro-history-v1'] || '[]'), settings: JSON.parse(localBefore['appstudios-pomodoro-settings-v1'] || '{}') },
    limitations: ['Los adjuntos remote: requieren una descarga autenticada aparte.', 'Verificar referencias con backup-audit.mjs.', 'No incluye cambios aún no guardados por el editor.'],
  };
  const envelope = { payload, sha256: await digest(new TextEncoder().encode(JSON.stringify(payload))) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `appstudios-dispositivo-${Date.now()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  console.info('Copia descargada, pendiente de verificar en disco.', { origin: payload.origin, subjects: data.subjects.length, files: files.length, sha256: envelope.sha256 });
})().catch(error => { console.error(error); alert(`Copia no completada: ${error.message}`); });
