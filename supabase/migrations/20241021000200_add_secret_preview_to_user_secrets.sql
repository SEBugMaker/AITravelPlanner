alter table public.user_secrets
  add column if not exists secret_preview text;

drop view if exists public.user_secret_overview;

create view public.user_secret_overview as
  select user_id, secret_key, secret_preview, updated_at
  from public.user_secrets;

alter view public.user_secret_overview set (security_invoker = true);
