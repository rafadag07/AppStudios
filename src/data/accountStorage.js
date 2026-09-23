const DB_NAME = "appstudios-account-data";
const DB_VERSION = 1;
const SNAPSHOTS = "snapshots";
const ASSETS = "assets";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: "userId" });
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se ha podido abrir el espacio local de la cuenta."));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function readAccountSnapshot(userId) {
  const db = await openDb();
  try {
    return await requestResult(db.transaction(SNAPSHOTS, "readonly").objectStore(SNAPSHOTS).get(userId));
  } finally {
    db.close();
  }
}

export async function writeAccountSnapshot(userId, snapshot) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS, "readwrite");
    tx.objectStore(SNAPSHOTS).put({ userId, ...structuredClone(snapshot), savedAt: new Date().toISOString() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export async function readCachedAsset(userId, path) {
  const db = await openDb();
  try {
    return await requestResult(db.transaction(ASSETS, "readonly").objectStore(ASSETS).get(`${userId}:${path}`));
  } finally {
    db.close();
  }
}

export async function cacheAsset(userId, path, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS, "readwrite");
    tx.objectStore(ASSETS).put({ key: `${userId}:${path}`, blob, savedAt: new Date().toISOString() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
