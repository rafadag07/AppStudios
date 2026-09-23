import { cacheAsset, readCachedAsset } from "./accountStorage";
import { downloadCloudObject, uploadCloudObject } from "./supabaseClient";

const DATA_IMAGE_RE = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
const ASSET_RE = /appstudios-asset:\/\/([a-f0-9]{64}\.[a-z0-9]+)/g;
const knownUploadedAssets = new Set();

const extensionFor = (mime) => ({ "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp", "image/gif": "gif" }[mime] || "png");

function bytesToBase64(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(result);
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function collectStrings(value, visitor) {
  if (typeof value === "string") visitor(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, visitor));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, visitor));
}

function replaceStrings(value, replacements) {
  if (typeof value === "string") {
    let next = value;
    for (const [from, to] of replacements) next = next.split(from).join(to);
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, replacements));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceStrings(item, replacements)]));
  return value;
}

async function pooled(items, worker, concurrency = 4) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) await worker(items[cursor++]);
  });
  await Promise.all(runners);
}

export async function normalizeAssetsForCloud(userId, data, onProgress = () => {}) {
  const found = new Map();
  collectStrings(data, (text) => {
    for (const match of text.matchAll(DATA_IMAGE_RE)) found.set(match[0], { mime: match[1], base64: match[2] });
  });
  const entries = [...found.entries()];
  const replacements = new Map();
  await pooled(entries, async ([dataUrl, asset]) => {
    const binary = atob(asset.base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const hash = await sha256(bytes);
    const filename = `${hash}.${extensionFor(asset.mime)}`;
    const path = `${userId}/assets/${filename}`;
    if (!knownUploadedAssets.has(path)) {
      await uploadCloudObject(path, new Blob([bytes], { type: asset.mime }), { upsert: false, ignoreExisting: true });
      knownUploadedAssets.add(path);
    }
    replacements.set(dataUrl, `appstudios-asset://${filename}`);
    onProgress(replacements.size, entries.length);
  });
  return { data: replaceStrings(data, replacements), assetCount: entries.length };
}

export async function hydrateCloudAssets(userId, data, onProgress = () => {}) {
  const names = new Set();
  collectStrings(data, (text) => { for (const match of text.matchAll(ASSET_RE)) names.add(match[1]); });
  const replacements = new Map();
  const entries = [...names];
  await pooled(entries, async (filename) => {
    const path = `${userId}/assets/${filename}`;
    knownUploadedAssets.add(path);
    let cached = await readCachedAsset(userId, path);
    let blob = cached?.blob || null;
    if (!blob) {
      blob = await downloadCloudObject(path);
      await cacheAsset(userId, path, blob);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    replacements.set(`appstudios-asset://${filename}`, `data:${blob.type || "image/png"};base64,${bytesToBase64(bytes)}`);
    onProgress(replacements.size, entries.length);
  });
  return replaceStrings(data, replacements);
}

export function findMissingLocalAttachments(data) {
  const ids = new Set();
  collectStrings(data, (text) => {
    if (/^file_[a-z0-9_]+$/i.test(text)) ids.add(text);
  });
  return [...ids];
}
