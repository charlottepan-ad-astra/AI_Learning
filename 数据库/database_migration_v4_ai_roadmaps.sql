-- Sherpa AI v4: persisted AI-generated roadmap metadata.
-- Apply after v1, v2, and database_migration_v3_learner_profiles.sql.

create table if not exists public.learning_plan_roadmaps (
  learning_plan_id uuid primary key references public.learning_plans(id) on delete cascade,
  rationale text not null,
  milestones jsonb not null default '[]'::jsonb,
  learner_profile_snapshot jsonb not null default '{}'::jsonb,
  strategy_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists learning_plan_roadmaps_set_updated_at on public.learning_plan_roadmaps;
create trigger learning_plan_roadmaps_set_updated_at
before update on public.learning_plan_roadmaps
for each row execute procedure public.set_sherpa_profile_updated_at();

alter table public.learning_plan_roadmaps enable row level security;

drop policy if exists "Learners manage roadmaps for their plans" on public.learning_plan_roadmaps;
create policy "Learners manage roadmaps for their plans"
on public.learning_plan_roadmaps
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
