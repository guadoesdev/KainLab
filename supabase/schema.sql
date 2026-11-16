-- AI Nutrition Tracker — Supabase PostgreSQL Schema
-- Run this in the Supabase Dashboard -> SQL Editor before deploying on Render.

create table if not exists public.profiles (
  uid text primary key,
  email text not null default '',
  username text not null unique,
  display_name text not null,
  daily_calorie_goal integer not null default 2000
    check (daily_calorie_goal >= 800 and daily_calorie_goal <= 10000),
  protein_goal integer not null default 150
    check (protein_goal >= 20 and protein_goal <= 500),
  carbs_goal integer not null default 225
    check (carbs_goal >= 20 and carbs_goal <= 1000),
  fat_goal integer not null default 56
    check (fat_goal >= 10 and fat_goal <= 400),
  photo_url text,
  provider text not null default 'password'
    check (provider in ('google.com', 'password')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add column if not exists protein_goal integer not null default 150,
  add column if not exists carbs_goal integer not null default 225,
  add column if not exists fat_goal integer not null default 56;

create table if not exists public.meals (
  id text primary key,
  user_id text not null references public.profiles(uid) on delete cascade,
  date_key text not null check (date_key ~ '^\d{4}-\d{2}-\d{2}$'),
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  foods jsonb not null default '[]'::jsonb,
  portions text not null default '',
  calories integer not null default 0 check (calories >= 0 and calories <= 10000),
  protein integer not null default 0 check (protein >= 0 and protein <= 1000),
  carbs integer not null default 0 check (carbs >= 0 and carbs <= 1000),
  fat integer not null default 0 check (fat >= 0 and fat <= 1000),
  confidence numeric(3, 2) not null default 0.90 check (confidence >= 0 and confidence <= 1),
  source text not null default 'text' check (source in ('text', 'image')),
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_meals_user_date
  on public.meals (user_id, date_key, created_at asc);

create table if not exists public.chat_messages (
  id text primary key,
  user_id text not null references public.profiles(uid) on delete cascade,
  date_key text not null check (date_key ~ '^\d{4}-\d{2}-\d{2}$'),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  meal_id text references public.meals(id) on delete set null,
  confidence numeric(3, 2) check (confidence >= 0 and confidence <= 1),
  clarification_options jsonb,
  sources jsonb,
  nutrition_snapshot jsonb,
  has_image boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_chat_messages_user_date
  on public.chat_messages (user_id, date_key, created_at asc);

create table if not exists public.daily_summaries (
  user_id text not null references public.profiles(uid) on delete cascade,
  date_key text not null check (date_key ~ '^\d{4}-\d{2}-\d{2}$'),
  calories integer not null default 0 check (calories >= 0),
  protein integer not null default 0 check (protein >= 0),
  carbs integer not null default 0 check (carbs >= 0),
  fat integer not null default 0 check (fat >= 0),
  daily_calorie_goal integer not null default 2000
    check (daily_calorie_goal >= 800 and daily_calorie_goal <= 10000),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, date_key)
);

-- Enable Row Level Security so anon PostgREST keys cannot read or mutate rows directly.
-- The Render Express server verifies Firebase JWTs and accesses Supabase via SUPABASE_SERVICE_ROLE_KEY.
alter table public.profiles enable row level security;
alter table public.meals enable row level security;
alter table public.chat_messages enable row level security;
alter table public.daily_summaries enable row level security;
