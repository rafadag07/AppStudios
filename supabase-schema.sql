create table if not exists public.campus_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.campus_profiles enable row level security;

drop policy if exists "campus_profiles_select_own" on public.campus_profiles;
drop policy if exists "campus_profiles_insert_own" on public.campus_profiles;
drop policy if exists "campus_profiles_update_own" on public.campus_profiles;

create policy "campus_profiles_select_own"
on public.campus_profiles for select
using (auth.uid() = user_id);

create policy "campus_profiles_insert_own"
on public.campus_profiles for insert
with check (auth.uid() = user_id);

create policy "campus_profiles_update_own"
on public.campus_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.campus_sync_spaces (
  sync_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.campus_sync_spaces enable row level security;

drop policy if exists "campus_sync_spaces_select" on public.campus_sync_spaces;
drop policy if exists "campus_sync_spaces_insert" on public.campus_sync_spaces;
drop policy if exists "campus_sync_spaces_update" on public.campus_sync_spaces;

create policy "campus_sync_spaces_select"
on public.campus_sync_spaces for select
to anon, authenticated
using (true);

create policy "campus_sync_spaces_insert"
on public.campus_sync_spaces for insert
to anon, authenticated
with check (sync_id ~ '^CAMPUS-[A-Z0-9]{6}-[A-Z0-9]{6}$');

create policy "campus_sync_spaces_update"
on public.campus_sync_spaces for update
to anon, authenticated
using (sync_id ~ '^CAMPUS-[A-Z0-9]{6}-[A-Z0-9]{6}$')
with check (sync_id ~ '^CAMPUS-[A-Z0-9]{6}-[A-Z0-9]{6}$');

insert into storage.buckets (id, name, public)
values ('campus-files', 'campus-files', false)
on conflict (id) do nothing;

drop policy if exists "campus_files_select_own" on storage.objects;
drop policy if exists "campus_files_insert_own" on storage.objects;
drop policy if exists "campus_files_update_own" on storage.objects;
drop policy if exists "campus_files_delete_own" on storage.objects;

create policy "campus_files_select_own"
on storage.objects for select
using (bucket_id = 'campus-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "campus_files_insert_own"
on storage.objects for insert
with check (bucket_id = 'campus-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "campus_files_update_own"
on storage.objects for update
using (bucket_id = 'campus-files' and auth.uid()::text = (storage.foldername(name))[1])
with check (bucket_id = 'campus-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "campus_files_delete_own"
on storage.objects for delete
using (bucket_id = 'campus-files' and auth.uid()::text = (storage.foldername(name))[1]);
