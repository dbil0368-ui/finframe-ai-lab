alter table public.billing_plans
  drop constraint if exists billing_plans_currency_check,
  add constraint billing_plans_currency_check check (currency in ('INR','USD'));

alter table public.billing_plans
  drop constraint if exists billing_plans_plan_key_check,
  add constraint billing_plans_plan_key_check check (plan_key in ('starter','pro','pro_usd'));

insert into public.billing_plans
  (plan_key, razorpay_plan_id, amount_paise, currency, period, interval_count, total_count, active)
values ('pro_usd', null, 500, 'USD', 'monthly', 1, 1200, true)
on conflict (plan_key) do update
set amount_paise = excluded.amount_paise,
    currency = excluded.currency,
    period = excluded.period,
    interval_count = excluded.interval_count,
    total_count = excluded.total_count,
    active = excluded.active,
    updated_at = now();
