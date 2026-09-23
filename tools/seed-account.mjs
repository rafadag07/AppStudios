import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}

function readCredentials() {
  return new Promise((resolve, reject) => {
    const input = createInterface({ input: process.stdin, terminal: false });
    input.once("line", (line) => {
      input.close();
      try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
    });
  });
}

const config = parseEnv(await readFile(".env", "utf8"));
const url = config.VITE_SUPABASE_URL;
const key = config.VITE_SUPABASE_PUBLISHABLE_KEY || config.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("Faltan VITE_SUPABASE_URL o la clave publica en .env");

const credentials = await readCredentials();
if (!credentials.email || !credentials.password || !credentials.name || !credentials.backupPath) throw new Error("Faltan credenciales o ruta de copia");
const sourceBytes = await readFile(credentials.backupPath);
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
const backup = JSON.parse(sourceBytes.toString("utf8"));
const sourceData = structuredClone(backup.data?.subjects ? backup.data : backup);
const pomodoro = backup.pomodoro || null;
if (!Array.isArray(sourceData.subjects)) throw new Error("La copia no contiene asignaturas");

const omittedAttachments = [];
for (const subject of sourceData.subjects) {
  for (const theme of subject.themes || []) {
    const kept = [];
    for (const media of theme.media || []) {
      if (typeof media.fileId === "string" && media.fileId.startsWith("file_")) omittedAttachments.push(media.fileId);
      else kept.push(media);
    }
    theme.media = kept;
  }
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let auth = await supabase.auth.signUp({ email: credentials.email, password: credentials.password, options: { data: { full_name: credentials.name } } });
if (auth.error && !/already registered|already been registered|user already/i.test(auth.error.message)) throw auth.error;
if (!auth.data?.session) {
  auth = await supabase.auth.signInWithPassword({ email: credentials.email, password: credentials.password });
}
if (auth.error) {
  if (/confirm|verified/i.test(auth.error.message)) {
    console.log(JSON.stringify({ accountCreated: true, confirmationRequired: true, email: credentials.email }));
    process.exit(2);
  }
  throw auth.error;
}
const user = auth.data.user;
if (!user) throw new Error("Supabase no ha devuelto el usuario");

const existing = await supabase.from("campus_profiles").select("data, updated_at").eq("user_id", user.id).maybeSingle();
if (existing.error) throw existing.error;
if (existing.data?.data?.sourceBackupSha256 && existing.data.data.sourceBackupSha256 !== sourceHash) {
  throw new Error("La cuenta ya contiene una migracion distinta. No se ha sobrescrito.");
}

const matches = new Map();
const imagePattern = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
function collect(value) {
  if (typeof value === "string") for (const match of value.matchAll(imagePattern)) matches.set(match[0], { mime: match[1], bytes: Buffer.from(match[2], "base64") });
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === "object") Object.values(value).forEach(collect);
}
collect(sourceData);

const extensionFor = (mime) => ({ "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp", "image/gif": "gif" }[mime] || "png");
const replacements = new Map();
let uploaded = 0;
for (const [dataUrl, asset] of matches) {
  const hash = createHash("sha256").update(asset.bytes).digest("hex");
  const filename = `${hash}.${extensionFor(asset.mime)}`;
  const path = `${user.id}/assets/${filename}`;
  const result = await supabase.storage.from("campus-files").upload(path, asset.bytes, { contentType: asset.mime, upsert: false });
  if (result.error && !/already exists|duplicate/i.test(result.error.message)) throw result.error;
  replacements.set(dataUrl, `appstudios-asset://${filename}`);
  uploaded += 1;
  if (uploaded % 10 === 0 || uploaded === matches.size) console.log(JSON.stringify({ stage: "assets", uploaded, total: matches.size }));
}

function replace(value) {
  if (typeof value === "string") {
    let next = value;
    for (const [from, to] of replacements) next = next.split(from).join(to);
    return next;
  }
  if (Array.isArray(value)) return value.map(replace);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, replace(item)]));
  return value;
}
const normalizedData = replace(sourceData);
const originalPath = `${user.id}/imports/${sourceHash}.json`;
const originalUpload = await supabase.storage.from("campus-files").upload(originalPath, sourceBytes, { contentType: "application/json", upsert: false });
if (originalUpload.error && !/already exists|duplicate/i.test(originalUpload.error.message)) throw originalUpload.error;

const now = new Date().toISOString();
const envelope = {
  format: "appstudios-cloud-v3",
  revision: randomUUID(),
  updatedAt: now,
  deviceId: "verified-import",
  state: normalizedData,
  pomodoro,
  history: [],
  conflicts: [],
  missingAttachments: [],
  omittedAttachments,
  sourceBackupSha256: sourceHash,
  sourceBackupPath: originalPath,
  importedAt: now,
};
const saved = await supabase.from("campus_profiles").upsert({ user_id: user.id, data: envelope, updated_at: now }).select("updated_at").single();
if (saved.error) throw saved.error;
console.log(JSON.stringify({ accountCreated: true, confirmationRequired: false, profileImported: true, userId: user.id, sourceHash, subjects: normalizedData.subjects.length, themes: normalizedData.subjects.reduce((sum, subject) => sum + (subject.themes?.length || 0), 0), questions: normalizedData.subjects.reduce((sum, subject) => sum + (subject.qa?.length || 0), 0), pomodoroSessions: pomodoro?.history?.length || 0, omittedAttachments: omittedAttachments.length, embeddedAssets: matches.size, updatedAt: saved.data.updated_at }));
