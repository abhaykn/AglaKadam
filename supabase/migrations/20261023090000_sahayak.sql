-- Sahayak: language-model help for CRPs, through the `sahayak` Edge Function.
--
--   * A draft of the coaching feedback, from what the CRP saw in the lesson, the class's Pulse and
--     the CRP's voice note. The CRP edits it; nothing reaches a teacher without the CRP.
--   * A private score of the feedback the CRP agreed with the teacher, against a fixed rubric, with
--     one tip. Only the CRP reads their own scores; offices will see only totals over many visits.
--   * The tasks in a photo of an order from the block, which the CRP checks before adding them.
--   * A rehearsal room: the CRP practises a hard conversation with a simulated teacher, then gets a
--     debrief. The debrief is kept for the CRP; the conversation itself is not.
--
-- The function counts each person's requests per day here, so that the free limits of the
-- services are shared fairly and a credit allowance is not spent by one account. Children's and
-- teachers' names are replaced on the phone before anything is sent.

-- ---------------------------------------------------------------------------------------------
-- Daily allowance
-- ---------------------------------------------------------------------------------------------

create table private.ai_usage (
  profile_id uuid not null,
  used_on date not null,
  kind text not null,
  used integer not null default 0,
  primary key (profile_id, used_on, kind),
  constraint ai_usage_kind_valid check (kind ~ '^[a-z][a-z_]{1,31}$'),
  constraint ai_usage_used_valid check (used >= 0)
);

comment on table private.ai_usage is
  'Requests to the language-model services per person, day and kind. The all-zero identifier counts '
  'the whole project, for allowances shared by everyone.';

revoke all on table private.ai_usage from public, anon, authenticated, service_role;
grant select, insert, update, delete on table private.ai_usage to service_role;

-- Takes one request from today's allowance; false when it is used up. Called by the Edge Function
-- with the secret key, before it asks a service.
create function public.service_take_ai_quota(
  target_profile_id uuid,
  usage_kind text,
  daily_limit integer
)
returns boolean
language sql
set search_path = ''
as $$
  with taken as (
    insert into private.ai_usage as u (profile_id, used_on, kind, used)
    select target_profile_id, private.today(), usage_kind, 1
    where daily_limit > 0
    on conflict (profile_id, used_on, kind) do update
      set used = u.used + 1
      where u.used < daily_limit
    returning 1
  )
  select exists (select 1 from taken)
$$;

-- Gives back a request the service could not answer, so that a failure costs nothing.
create function public.service_return_ai_quota(target_profile_id uuid, usage_kind text)
returns void
language sql
set search_path = ''
as $$
  update private.ai_usage
  set used = greatest(used - 1, 0)
  where profile_id = target_profile_id and used_on = private.today() and kind = usage_kind
$$;

revoke all on function public.service_take_ai_quota(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.service_return_ai_quota(uuid, text) from public, anon, authenticated;
grant execute on function
  public.service_take_ai_quota(uuid, text, integer),
  public.service_return_ai_quota(uuid, text)
  to service_role;

create function private.purge_ai_usage()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.ai_usage where used_on < private.today() - 90
$$;

revoke all on function private.purge_ai_usage() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Feedback scores
-- ---------------------------------------------------------------------------------------------

create table public.visit_feedback_scores (
  visit_id uuid primary key references public.visits (id) on delete cascade,
  crp_id uuid references public.profiles (id) on delete set null,
  specific smallint not null,
  evidence smallint not null,
  one_focus smallint not null,
  demonstration smallint not null,
  check_back smallint not null,
  respectful smallint not null,
  total smallint generated always as (
    specific + evidence + one_focus + demonstration + check_back + respectful
  ) stored,
  tip text not null,
  language text not null default 'hi',
  model text not null,
  feedback_agreed_at timestamptz not null,
  scored_at timestamptz not null default now(),
  constraint visit_feedback_scores_parts_valid check (
    specific between 0 and 2 and evidence between 0 and 2 and one_focus between 0 and 2
    and demonstration between 0 and 2 and check_back between 0 and 2 and respectful between 0 and 2
  ),
  constraint visit_feedback_scores_tip_length check (char_length(tip) between 1 and 400),
  constraint visit_feedback_scores_language_valid check (language in ('hi', 'en')),
  constraint visit_feedback_scores_model_length check (char_length(model) between 1 and 80)
);

comment on table public.visit_feedback_scores is
  'The rubric score of the feedback a CRP agreed with a teacher, read only by that CRP: specific, '
  'backed by what was seen, one focus, shown in practice, a check-back soon, and respectful; each '
  'from 0 to 2.';
comment on column public.visit_feedback_scores.feedback_agreed_at is
  'When the scored feedback was agreed, so that feedback agreed again is scored again.';

create index visit_feedback_scores_crp_id_idx on public.visit_feedback_scores (crp_id);

-- ---------------------------------------------------------------------------------------------
-- Rehearsal debriefs
-- ---------------------------------------------------------------------------------------------

create table public.rehearsal_debriefs (
  id uuid primary key default gen_random_uuid(),
  crp_id uuid not null references public.profiles (id) on delete cascade,
  scenario text not null,
  language text not null default 'hi',
  turns smallint not null,
  named_practice boolean not null,
  asked_constraints boolean not null,
  agreed_check_back boolean not null,
  kept_blame_out boolean not null,
  cited_evidence boolean not null,
  went_well text not null,
  try_next text not null,
  provider text not null,
  created_at timestamptz not null default now(),
  constraint rehearsal_debriefs_scenario_valid check (scenario ~ '^[a-z][a-z0-9-]{2,47}$'),
  constraint rehearsal_debriefs_language_valid check (language in ('hi', 'en')),
  constraint rehearsal_debriefs_turns_valid check (turns between 1 and 40),
  constraint rehearsal_debriefs_text_length check (
    char_length(went_well) between 1 and 600 and char_length(try_next) between 1 and 600
  ),
  constraint rehearsal_debriefs_provider_valid check (provider in ('claude', 'groq'))
);

comment on table public.rehearsal_debriefs is
  'What a CRP did well and should try next in a practice conversation with a simulated teacher. '
  'The conversation itself is not kept.';

create index rehearsal_debriefs_crp_id_idx on public.rehearsal_debriefs (crp_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------------

alter table public.visit_feedback_scores enable row level security;
alter table public.rehearsal_debriefs enable row level security;

revoke all on table public.visit_feedback_scores from anon, authenticated, service_role;
revoke all on table public.rehearsal_debriefs from anon, authenticated, service_role;
grant select on table public.visit_feedback_scores, public.rehearsal_debriefs to authenticated;
-- Written only by the Edge Function, after it has checked the visit is the caller's.
grant select, insert, update on table public.visit_feedback_scores to service_role;
grant select, insert on table public.rehearsal_debriefs to service_role;

create policy "CRPs read the scores of their own feedback" on public.visit_feedback_scores
  for select to authenticated
  using (crp_id = (select auth.uid()));
create policy "CRPs read their own rehearsal debriefs" on public.rehearsal_debriefs
  for select to authenticated
  using (crp_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------------------------

-- Counts older than 90 days are removed daily (04:15 IST) where scheduled jobs are available.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed; the usage clean-up job was not created.';
    return;
  end if;

  perform cron.schedule('purge-ai-usage', '45 22 * * *', 'select private.purge_ai_usage()');
end;
$$;
