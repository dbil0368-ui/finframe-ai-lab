drop policy if exists "Users can read their own VYBORA creator profile" on public.vybora_creator_profiles;
create policy "Users can read their own VYBORA creator profile" on public.vybora_creator_profiles for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can create their own VYBORA creator profile" on public.vybora_creator_profiles;
create policy "Users can create their own VYBORA creator profile" on public.vybora_creator_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own VYBORA creator profile" on public.vybora_creator_profiles;
create policy "Users can update their own VYBORA creator profile" on public.vybora_creator_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own VYBORA creator profile" on public.vybora_creator_profiles;
create policy "Users can delete their own VYBORA creator profile" on public.vybora_creator_profiles for delete to authenticated using ((select auth.uid()) = user_id);
