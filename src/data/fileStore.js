import { downloadCloudFile, uploadCloudFile } from "./supabaseClient";

const DB_NAME = "summer-study-campus-files";
const STORE_NAME = "files";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStoredFile(file) {
  const id = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const remoteId = await uploadCloudFile(id, file);
    if (remoteId) return remoteId;
  } catch (error) {
    console.warn("No se ha podido subir el archivo a Supabase. Se guardara localmente.", error);
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      id,
      blob: file,
      name: file.name,
      type: file.type,
      createdAt: new Date().toISOString(),
    });
    transaction.oncomplete = () => {
      db.close();
      resolve(id);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function getStoredFile(id) {
  if (id?.startsWith("remote:")) {
    const blob = await downloadCloudFile(id);
    if (!blob) return null;
    return {
      id,
      blob,
      name: id.split("/").pop(),
      type: blob.type,
      createdAt: new Date().toISOString(),
    };
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}
