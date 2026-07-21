-- Sherpa AI v3: structured learner profile + per-plan learning strategy
-- Apply after database_specification_v1.md and database_migration_v2.md.

create table if not exists public.learner_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  learning_goal text,
  current_level text check (current_level in ('Beginner', 'Intermediate', 'Advanced')),
  motivation text,
  preferred_learning_style text check (preferred_learning_style in ('hands_on', 'visual', 'reading', 'discussion', 'mixed')),
  available_study_time_minutes integer check (available_study_time_minutes between 5 and 600),
  target_outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_plan_strategies (
  learning_plan_id uuid primary key references public.learning_plans(id) on delete cascade,
  recommended_session_minutes integer check (recommended_session_minutes between 5 and 600),
  recommended_content_format text,
  initial_quiz_difficulty text check (initial_quiz_difficulty in ('Easy', 'Medium', 'Hard')),
  quiz_mode text check (quiz_mode in ('scaffold', 'standard', 'challenge')),
  coaching_approach text,
  resource_preference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_sherpa_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists learner_profiles_set_updated_at on public.learner_profiles;
create trigger learner_profiles_set_updated_at
before update on public.learner_profiles
for each row execute procedure public.set_sherpa_profile_updated_at();

drop trigger if exists learning_plan_strategies_set_updated_at on public.learning_plan_strategies;
create trigger learning_plan_strategies_set_updated_at
before update on public.learning_plan_strategies
for each row execute procedure public.set_sherpa_profile_updated_at();

-- These new learner-owned tables are protected even if legacy hackathon tables
-- remain in their current RLS-disabled state.
alter table public.learner_profiles enable row level security;
alter table public.learning_plan_strategies enable row level security;

drop policy if exists "Learners manage their own profile" on public.learner_profiles;
create policy "Learners manage their own profile"
on public.learner_profiles
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Learners manage strategies for their plans" on public.learning_plan_strategies;
create policy "Learners manage strategies for their plans"
on public.learning_plan_strategies
for all
using (
  exists (
    select 1 from public.learning_plans plan
    where plan.id = learning_plan_id and plan.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.learning_plans plan
    where plan.id = learning_plan_id and plan.user_id = auth.uid()
  )
);
