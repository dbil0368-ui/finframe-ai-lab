alter table public.billing_subscriptions
  add column if not exists environment text not null default 'live';

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_environment_check;

alter table public.billing_subscriptions
  add constraint billing_subscriptions_environment_check
  check (environment in ('test','live'));

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_pkey;

alter table public.billing_subscriptions
  add constraint billing_subscriptions_pkey primary key (user_id, environment);
