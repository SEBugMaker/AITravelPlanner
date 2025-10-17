-- Enable required extensions
create extension if not exists "pgcrypto";

-- Itinerary master table
create table if not exists public.itineraries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  plan jsonb not null,
  preferences jsonb not null,
  source text not null default 'api',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists itineraries_user_id_idx on public.itineraries(user_id);

-- Expense records associated with itineraries
create table if not exists public.expense_records (
  id uuid primary key default gen_random_uuid(),
  "itineraryId" uuid not null references public.itineraries(id) on delete cascade,
  amount numeric(12,2) not null,
  currency text not null default 'CNY',
  category text not null,
  note text,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  "userId" uuid
);

create index if not exists expense_records_itinerary_idx on public.expense_records("itineraryId");
create index if not exists expense_records_user_idx on public.expense_records("userId");
