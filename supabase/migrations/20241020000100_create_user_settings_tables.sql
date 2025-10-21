-- User-specific settings storage
create table if not exists public.user_secrets (
  user_id uuid not null references auth.users(id) on delete cascade,
  secret_key text not null,
  secret_ciphertext text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, secret_key)
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_travel_days integer,
  default_budget_cny numeric,
  voice_assist_enabled boolean,
  auto_persist_itineraries boolean,
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'user_secrets_set_updated_at'
  ) then
    create trigger user_secrets_set_updated_at
      before update on public.user_secrets
      for each row
      execute procedure public.handle_updated_at();
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'user_preferences_set_updated_at'
  ) then
    create trigger user_preferences_set_updated_at
      before update on public.user_preferences
      for each row
      execute procedure public.handle_updated_at();
  end if;
end;
$$;

create or replace view public.user_secret_overview as
  select user_id, secret_key, updated_at
  from public.user_secrets;

alter view public.user_secret_overview set (security_invoker = true);

alter table public.user_secrets enable row level security;
alter table public.user_preferences enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where policyname = 'user_secrets_select'
      and schemaname = 'public'
      and tablename = 'user_secrets'
  ) then
    create policy user_secrets_select
      on public.user_secrets
      for select
      using (auth.uid() = user_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where policyname = 'user_secrets_insert'
      and schemaname = 'public'
      and tablename = 'user_secrets'
  ) then
    create policy user_secrets_insert
      on public.user_secrets
      for insert
      with check (auth.uid() = user_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where policyname = 'user_secrets_update'
      and schemaname = 'public'
      and tablename = 'user_secrets'
  ) then
    create policy user_secrets_update
      on public.user_secrets
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where policyname = 'user_secrets_delete'
      and schemaname = 'public'
      and tablename = 'user_secrets'
  ) then
    create policy user_secrets_delete
      on public.user_secrets
      for delete
      using (auth.uid() = user_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where policyname = 'user_preferences_select'
      and schemaname = 'public'
      and tablename = 'user_preferences'
  ) then
    create policy user_preferences_select
      on public.user_preferences
      for select
      using (auth.uid() = user_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where policyname = 'user_preferences_upsert'
      and schemaname = 'public'
      and tablename = 'user_preferences'
  ) then
    create policy user_preferences_upsert
      on public.user_preferences
      for insert
      with check (auth.uid() = user_id);
    create policy user_preferences_update
      on public.user_preferences
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end;
$$;
