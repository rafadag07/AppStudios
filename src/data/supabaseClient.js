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

export async function saveCloudData(userId, data) {
  if (!supabase || !userId) return;
  const { error } = await supabase.from("campus_profiles").upsert({
    user_id: userId,
    data,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
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
