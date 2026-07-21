-- Sherpa AI v5: current adaptive-learning decision for each learner and plan.
-- Apply after v1 through database_migration_v4_ai_roadmaps.sql.

create table if not exists public.adaptive_learning_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  learning_plan_id uuid not null references public.learning_plans(id) on delete cascade,
  active_concept_id uuid references public.concepts(id) on delete set null,
  next_concept_id uuid references public.concepts(id) on delete set null,
  next_quiz_difficulty text check (next_quiz_difficulty in ('Easy', 'Medium', 'Hard')),
  recommended_question_type text check (recommended_question_type in ('multiple_choice', 'fill_blank', 'short_answer')),
  review_at timestamptz,
  knowledge_gap jsonb not null default '{}'::jsonb,
  last_decision jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, learning_plan_id)
);

create index if not exists adaptive_learning_states_review_at_idx
on public.adaptive_learning_states (user_id, review_at);

drop trigger if exists adaptive_learning_states_set_updated_at on public.adaptive_learning_states;
create trigger adaptive_learning_states_set_updated_at
before update on public.adaptive_learning_states
for each row execute procedure public.set_sherpa_profile_updated_at();

alter table public.adaptive_learning_states enable row level security;

drop policy if exists "Learners manage their adaptive state" on public.adaptive_learning_states;
create policy "Learners manage their adaptive state"
on public.adaptive_learning_states
for all
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.learning_plans plan
    where plan.id = learning_plan_id and plan.user_id = auth.uid()
  )
);
