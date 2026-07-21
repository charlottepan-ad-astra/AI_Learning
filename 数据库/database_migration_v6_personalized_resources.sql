-- Sherpa AI v6: learner-specific AI resource recommendations.
-- Apply after v1 through database_migration_v5_adaptive_learning_engine.sql.

create table if not exists public.personalized_resource_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  learning_plan_id uuid not null references public.learning_plans(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  recommendation_key text not null,
  title text not null,
  resource_type text not null check (resource_type in ('Article', 'Video', 'Documentation', 'Course', 'Practice')),
  url text not null,
  estimated_study_minutes integer not null check (estimated_study_minutes between 1 and 600),
  rationale text not null,
  priority text not null check (priority in ('High', 'Medium', 'Low')),
  context_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, learning_plan_id, recommendation_key)
);

create index if not exists personalized_resource_recommendations_plan_priority_idx
on public.personalized_resource_recommendations (user_id, learning_plan_id, priority, updated_at desc);

drop trigger if exists personalized_resource_recommendations_set_updated_at on public.personalized_resource_recommendations;
create trigger personalized_resource_recommendations_set_updated_at
before update on public.personalized_resource_recommendations
for each row execute procedure public.set_sherpa_profile_updated_at();

alter table public.personalized_resource_recommendations enable row level security;

drop policy if exists "Learners manage their personalized resources" on public.personalized_resource_recommendations;
create policy "Learners manage their personalized resources"
on public.personalized_resource_recommendations
for all
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.learning_plans plan
    where plan.id = learning_plan_id and plan.user_id = auth.uid()
  )
);
