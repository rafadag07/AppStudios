import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export async function getCurrentSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export async function signInWithEmail(email) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const redirectTo = window.location.origin;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export async function signUpWithPassword({ email, password, name }) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name }, emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  return data;
}

export async function signInWithPassword({ email, password }) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function sendPasswordReset(email) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error) throw error;
}

export async function deleteOwnAccount() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
}

export function onCloudAuthChange(callback) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signOutCloud() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function fetchCloudData(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.from("campus_profiles").select("data, updated_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function fetchSharedSpace(syncId) {
  if (!supabase || !syncId) return null;
  const { data, error } = await supabase.from("campus_sync_spaces").select("data, updated_at").eq("sync_id", syncId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function saveSharedSpace(syncId, data) {
  if (!supabase || !syncId) return;
  const { error } = await supabase.from("campus_sync_spaces").upsert({
    sync_id: syncId,
    data,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function saveCloudData(userId, data) {
  if (!supabase || !userId) return;
  const { error } = await supabase.from("campus_profiles").upsert({
    user_id: userId,
    data,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function createCloudProfile(userId, data) {
  const { data: row, error } = await supabase.from("campus_profiles").insert({ user_id: userId, data }).select("data, updated_at").single();
  if (error) throw error;
  return row;
}

export async function updateCloudProfile(userId, expectedUpdatedAt, data) {
  const { data: rows, error } = await supabase
    .from("campus_profiles")
    .update({ data, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("updated_at", expectedUpdatedAt)
    .select("data, updated_at");
  if (error) throw error;
  return rows?.[0] || null;
}

export async function uploadCloudObject(path, blob, { upsert = false, ignoreExisting = false } = {}) {
  const { error } = await supabase.storage.from("campus-files").upload(path, blob, { upsert, contentType: blob.type || "application/octet-stream" });
  if (error && !(ignoreExisting && (error.statusCode === "409" || /already exists|duplicate/i.test(error.message)))) throw error;
  return path;
}

export async function downloadCloudObject(path) {
  const { data, error } = await supabase.storage.from("campus-files").download(path);
  if (error) throw error;
  return data;
}

export async function uploadVersionSnapshot(userId, revision, snapshot) {
  const path = `${userId}/versions/${revision}.json`;
  await uploadCloudObject(path, new Blob([JSON.stringify(snapshot)], { type: "application/json" }), { upsert: false, ignoreExisting: true });
  return path;
}

export async function downloadVersionSnapshot(path) {
  const blob = await downloadCloudObject(path);
  return JSON.parse(await blob.text());
}

export function subscribeToCloudData(userId, onChange) {
  if (!supabase || !userId) return () => {};
  const channel = supabase
    .channel(`campus-profile-${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "campus_profiles", filter: `user_id=eq.${userId}` },
      (payload) => onChange(payload.new)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToSharedSpace(syncId, onChange) {
  if (!supabase || !syncId) return () => {};
  const channel = supabase
    .channel(`campus-sync-space-${syncId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "campus_sync_spaces", filter: `sync_id=eq.${syncId}` },
      (payload) => onChange(payload.new)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function createSyncCode() {
  const part = () => Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CAMPUS-${part()}-${part()}`;
}

export function normalizeSyncCode(value = "") {
  return value.trim().replace(/\s+/g, "-").toUpperCase();
}

export async function uploadCloudFile(fileId, file) {
  if (!supabase || !file) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const extension = file.name?.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `${user.id}/${fileId}.${extension}`;
  const { error } = await supabase.storage.from("campus-files").upload(path, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  return `remote:${path}`;
}

export async function downloadCloudFile(remoteId) {
  if (!supabase || !remoteId?.startsWith("remote:")) return null;
  const path = remoteId.replace("remote:", "");
  const { data, error } = await supabase.storage.from("campus-files").download(path);
  if (error) throw error;
  return data;
}
