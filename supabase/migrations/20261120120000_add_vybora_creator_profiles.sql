-- VYBORA Creator Kit cloud sync
-- Each authenticated user owns exactly one private creator profile.
create table if not exists public.vybora_creator_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vybora_creator_profiles_profile_object check (jsonb_typeof(profile) = 'object')
);

alter table public.vybora_creator_profiles enable row level security;

drop policy if exists "Users can read their own VYBORA creator profile" on public.vybora_creator_profiles;
create policy "Users can read their own VYBORA creator profile"
  on public.vybora_creator_profiles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own VYBORA creator profile" on public.vybora_creator_profiles;
create policy "Users can create their own VYBORA creator profile"
  on public.vybora_creator_profiles for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own VYBORA creator profile" on public.vybora_creator_profiles;
create policy "Users can update their own VYBORA creator profile"
  on public.vybora_creator_profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own VYBORA creator profile" on public.vybora_creator_profiles;
create policy "Users can delete their own VYBORA creator profile"
  on public.vybora_creator_profiles for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.vybora_creator_profiles to authenticated;
revoke all on public.vybora_creator_profiles from anon;
