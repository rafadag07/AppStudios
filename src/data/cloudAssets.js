import { cacheAsset, readCachedAsset } from "./accountStorage";
import { downloadCloudObject, uploadCloudObject } from "./supabaseClient";

const DATA_IMAGE_RE = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
const ASSET_RE = /appstudios-asset:\/\/([a-f0-9]{64}\.[a-z0-9]+)/g;
const knownUploadedAssets = new Set();
const normalizedDataUrlCache = new Map();

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

async function yieldToBrowser() {
  if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
  else await new Promise((resolve) => setTimeout(resolve, 0));
}

async function collectStringsCooperatively(value, visitor) {
  const pending = [value];
  let processed = 0;
  while (pending.length > 0) {
    const item = pending.pop();
    if (typeof item === "string") visitor(item);
    else if (Array.isArray(item)) pending.push(...item);
    else if (item && typeof item === "object") pending.push(...Object.values(item));
    processed += 1;
    if (processed % 150 === 0) await yieldToBrowser();
  }
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

async function replaceStringsCooperatively(value, replacements, progress = { processed: 0 }) {
  progress.processed += 1;
  if (progress.processed % 100 === 0) await yieldToBrowser();
  if (typeof value === "string") {
    let next = value;
    for (const [from, to] of replacements) next = next.split(from).join(to);
    return next;
  }
  if (Array.isArray(value)) {
    const result = [];
    for (const item of value) result.push(await replaceStringsCooperatively(item, replacements, progress));
    return result;
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = await replaceStringsCooperatively(item, replacements, progress);
    return result;
  }
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
  await collectStringsCooperatively(data, (text) => {
    for (const match of text.matchAll(DATA_IMAGE_RE)) found.set(match[0], { mime: match[1], base64: match[2] });
  });
  const entries = [...found.entries()];
  const replacements = new Map();
  await pooled(entries, async ([dataUrl, asset]) => {
    const cachedUri = normalizedDataUrlCache.get(dataUrl);
    if (cachedUri) {
      replacements.set(dataUrl, cachedUri);
      onProgress(replacements.size, entries.length);
      return;
    }
    const decoded = await fetch(dataUrl).then((response) => response.blob());
    const bytes = new Uint8Array(await decoded.arrayBuffer());
    const hash = await sha256(bytes);
    const filename = `${hash}.${extensionFor(asset.mime)}`;
    const path = `${userId}/assets/${filename}`;
    if (!knownUploadedAssets.has(path)) {
      await uploadCloudObject(path, new Blob([bytes], { type: asset.mime }), { upsert: false, ignoreExisting: true });
      knownUploadedAssets.add(path);
    }
    const assetUri = `appstudios-asset://${filename}`;
    replacements.set(dataUrl, assetUri);
    normalizedDataUrlCache.set(dataUrl, assetUri);
    if (normalizedDataUrlCache.size > 256) normalizedDataUrlCache.delete(normalizedDataUrlCache.keys().next().value);
    onProgress(replacements.size, entries.length);
  });
  return { data: await replaceStringsCooperatively(data, replacements), assetCount: entries.length };
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
