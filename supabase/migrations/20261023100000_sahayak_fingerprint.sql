-- A feedback score belongs to the feedback as it was scored. Feedback can still be edited after
-- it was agreed, so the time of agreement alone does not tell that the score is current: the
-- score keeps a fingerprint of the feedback (SHA-256 of its fields), which the Edge Function and
-- the phone compute the same way.

alter table public.visit_feedback_scores
  add column feedback_fingerprint text not null default '';

alter table public.visit_feedback_scores
  add constraint visit_feedback_scores_fingerprint_valid
  check (feedback_fingerprint = '' or feedback_fingerprint ~ '^[0-9a-f]{64}$');

comment on column public.visit_feedback_scores.feedback_fingerprint is
  'SHA-256 of the scored feedback''s fields; a score whose fingerprint differs from the feedback '
  'is of an earlier version.';
