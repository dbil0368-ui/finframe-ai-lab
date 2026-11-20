create or replace function public.consume_vybora_ai_generation_for_current_user()
returns table(allowed boolean, used integer, daily_limit integer, remaining integer, plan_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan text := 'free';
  v_daily_limit integer;
  v_used integer;
  v_today date := timezone('Asia/Kolkata', now())::date;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select coalesce((
    select bs.plan_key from public.billing_subscriptions bs
    where bs.user_id = v_user_id and bs.status = 'active'
    order by bs.updated_at desc nulls last limit 1
  ), 'free') into v_plan;
  if exists (
    select 1 from public.vybora_referral_rewards rr
    where rr.referrer_user_id = v_user_id and rr.starts_at <= now() and rr.expires_at > now()
  ) then v_plan := 'pro'; end if;
  v_daily_limit := case v_plan when 'pro' then 50 when 'starter' then 15 else 3 end;
  insert into public.vybora_ai_daily_usage(user_id, usage_date, generation_count)
  values (v_user_id, v_today, 0) on conflict (user_id, usage_date) do nothing;
  update public.vybora_ai_daily_usage u
     set generation_count = u.generation_count + 1, updated_at = now()
   where u.user_id = v_user_id and u.usage_date = v_today and u.generation_count < v_daily_limit
  returning u.generation_count into v_used;
  if v_used is not null then
    return query select true, v_used, v_daily_limit, greatest(0, v_daily_limit - v_used), v_plan;
  else
    select u.generation_count into v_used from public.vybora_ai_daily_usage u
     where u.user_id = v_user_id and u.usage_date = v_today;
    return query select false, coalesce(v_used, 0), v_daily_limit, 0, v_plan;
  end if;
end;
$$;

create or replace function public.consume_vybora_tryon_request_for_current_user()
returns table(allowed boolean, used integer, daily_limit integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_daily_limit integer := 5;
  v_used integer;
  v_today date := timezone('Asia/Kolkata', now())::date;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  insert into public.vybora_tryon_daily_usage(user_id, usage_date, request_count)
  values (v_user_id, v_today, 0) on conflict (user_id, usage_date) do nothing;
  update public.vybora_tryon_daily_usage u
     set request_count = u.request_count + 1, updated_at = now()
   where u.user_id = v_user_id and u.usage_date = v_today and u.request_count < v_daily_limit
  returning u.request_count into v_used;
  if v_used is not null then
    return query select true, v_used, v_daily_limit, greatest(0, v_daily_limit - v_used);
  else
    select u.request_count into v_used from public.vybora_tryon_daily_usage u
     where u.user_id = v_user_id and u.usage_date = v_today;
    return query select false, coalesce(v_used, 0), v_daily_limit, 0;
  end if;
end;
$$;

revoke all on function public.consume_vybora_ai_generation_for_current_user() from public, anon;
revoke all on function public.consume_vybora_tryon_request_for_current_user() from public, anon;
grant execute on function public.consume_vybora_ai_generation_for_current_user() to authenticated;
grant execute on function public.consume_vybora_tryon_request_for_current_user() to authenticated;