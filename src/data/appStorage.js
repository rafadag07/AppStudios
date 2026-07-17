const DB_NAME = "appstudios-local-data";
const DB_VERSION = 1;
const STORE_NAME = "state";
const MAIN_STATE_KEY = "main";

let writeQueue = Promise.resolve();

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB no esta disponible en este navegador."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se ha podido abrir el almacenamiento local."));
  });
}

function cloneForStorage(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export async function readAppData() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(MAIN_STATE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("No se han podido leer los datos locales."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("No se han podido leer los datos locales."));
    };
  });
}

function putAppData(data) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put({
          key: MAIN_STATE_KEY,
          data,
          updatedAt: new Date().toISOString(),
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error || new Error("No se han podido guardar los datos locales."));
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error || new Error("El guardado local se ha interrumpido."));
        };
      })
  );
}

export function writeAppData(data) {
  const snapshot = cloneForStorage(data);
  writeQueue = writeQueue.catch(() => undefined).then(() => putAppData(snapshot));
  return writeQueue;
}
