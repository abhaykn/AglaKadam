-- Voice notes of visits, and their transcripts.
--
-- After the lesson, a CRP may speak a note of up to two minutes instead of typing: what they saw,
-- in their own language. The note is the CRP's working memo for filling in the visit; it belongs to
-- the CRP who made the visit, and only they hear it or read its transcript. What they take from it
-- into the visit record is what the teacher sees.
--
-- A note is uploaded to the private `visit-notes` bucket under `<visit id>/<note id>.<extension>`,
-- then recorded here. Storage accepts the file only for the CRP's own visit that took place, within
-- the 14 days a visit can be changed; the database verifies that the file exists, was uploaded by
-- the same CRP and was not used for another note. Recording again replaces the note.
--
-- The speech engine transcribes notes overnight (Hindi with IndicConformer, English with Whisper).
-- Like Pulse recordings, a note's audio and transcript are removed after 30 days, by the same daily
-- job, and uploads that no note claims are removed after two days.

-- ---------------------------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------------------------

create table public.visit_notes (
  visit_id uuid primary key references public.visits (id) on delete cascade,
  note_id uuid not null,
  audio_path text not null,
  audio_type text not null,
  audio_bytes integer not null,
  duration_ms integer not null,
  language text not null default 'hi',
  recorded_at timestamptz not null,
  recorded_by uuid references public.profiles (id) on delete set null,
  received_at timestamptz not null default now(),
  audio_etag text,
  audio_deleted_at timestamptz,
  transcript text,
  transcript_engine text,
  transcribed_at timestamptz,
  transcript_failures smallint not null default 0,
  transcript_failed_engine text,
  constraint visit_notes_audio_path_key unique (audio_path),
  constraint visit_notes_audio_etag_key unique (audio_etag),
  constraint visit_notes_language_valid check (language in ('hi', 'en')),
  constraint visit_notes_audio_type_valid check (
    audio_type in ('audio/webm', 'audio/ogg', 'audio/mp4')
  ),
  constraint visit_notes_audio_bytes_range check (audio_bytes between 1 and 1048576),
  constraint visit_notes_duration_range check (duration_ms between 1000 and 121000),
  constraint visit_notes_transcript_length check (
    transcript is null or char_length(transcript) <= 8000
  ),
  constraint visit_notes_transcript_engine_length check (
    transcript_engine is null or char_length(transcript_engine) between 1 and 120
  ),
  constraint visit_notes_transcript_failures_range check (transcript_failures between 0 and 1000),
  constraint visit_notes_transcript_failed_engine_length check (
    transcript_failed_engine is null or char_length(transcript_failed_engine) between 1 and 120
  )
);

comment on table public.visit_notes is
  'A CRP''s spoken note about a visit, at most two minutes, and its transcript. Seen only by that '
  'CRP; removed with its transcript after 30 days.';
comment on column public.visit_notes.note_id is
  'Chosen by the device and used in the file''s name, so that a note recorded again is a new file.';
comment on column public.visit_notes.transcript_failures is
  'Times the engine named in transcript_failed_engine could not transcribe the note; that engine '
  'stops trying after the third, and a new engine version starts again from one.';

create index visit_notes_recorded_by_idx on public.visit_notes (recorded_by);
create index visit_notes_received_at_idx on public.visit_notes (received_at)
  where audio_deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- The visit a note's file belongs to, or null when the name is not of the expected form
-- `<visit id>/<note id>.<webm|ogg|m4a>`.
create function private.visit_note_visit(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|ogg|m4a)$'
    then split_part(object_name, '/', 1)::uuid
  end
$$;

-- Whether the signed-in CRP may store a note's file now: their own visit that took place, still
-- open to changes.
create function private.visit_note_upload_allowed(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.visits as v
    where v.id = private.visit_note_visit(object_name)
      and v.status = 'done'
      and private.visit_writable(v.id)
  )
$$;

-- Who stored a note's file, and its storage details, read past the storage policies.
create function private.visit_note_object(object_name text)
returns table (owner_id text, metadata jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select o.owner_id, o.metadata
  from storage.objects as o
  where o.bucket_id = 'visit-notes' and o.name = object_name
$$;

-- ---------------------------------------------------------------------------------------------
-- Guard
-- ---------------------------------------------------------------------------------------------

-- A note names a file of its own visit that the same CRP uploaded; its type, size and fingerprint
-- are taken from storage. Only the engine writes the transcript: a note recorded again starts
-- without one.
create function private.guard_visit_note_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stored record;
  extension text;
begin
  if not private.is_api_user() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.visit_id is distinct from old.visit_id then
    raise exception 'A note cannot move to another visit.' using errcode = '42501';
  end if;
  if private.visit_note_visit(new.audio_path) is distinct from new.visit_id
     or new.audio_path not like new.visit_id || '/' || new.note_id || '.%'
  then
    raise exception 'A note is stored under its visit and its own identifier.'
      using errcode = '23514';
  end if;
  if new.recorded_at > now() + interval '10 minutes' then
    raise exception 'The recording time is in the future.' using errcode = '23514';
  end if;

  select o.owner_id, o.metadata into stored from private.visit_note_object(new.audio_path) as o;
  if not found then
    raise exception 'The note''s recording is not in storage.' using errcode = '23514';
  end if;
  if stored.owner_id is distinct from auth.uid()::text then
    raise exception 'The note''s recording was stored by someone else.' using errcode = '42501';
  end if;

  -- The type is the one storage holds, and the file's extension must match it.
  new.recorded_by := auth.uid();
  new.audio_etag := nullif(stored.metadata ->> 'eTag', '');
  new.audio_type := coalesce(
    nullif(btrim(split_part(stored.metadata ->> 'mimetype', ';', 1)), ''),
    new.audio_type
  );
  new.audio_bytes := coalesce((stored.metadata ->> 'size')::integer, new.audio_bytes);
  extension := case new.audio_type
    when 'audio/webm' then 'webm'
    when 'audio/ogg' then 'ogg'
    when 'audio/mp4' then 'm4a'
  end;
  if extension is null or new.audio_path <> new.visit_id || '/' || new.note_id || '.' || extension
  then
    raise exception 'The note''s file name does not match its type.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' or new.audio_path is distinct from old.audio_path then
    new.received_at := now();
    new.audio_deleted_at := null;
    new.transcript := null;
    new.transcript_engine := null;
    new.transcribed_at := null;
    new.transcript_failures := 0;
    new.transcript_failed_engine := null;
  else
    new.received_at := old.received_at;
    new.audio_deleted_at := old.audio_deleted_at;
    new.transcript := old.transcript;
    new.transcript_engine := old.transcript_engine;
    new.transcribed_at := old.transcribed_at;
    new.transcript_failures := old.transcript_failures;
    new.transcript_failed_engine := old.transcript_failed_engine;
  end if;
  return new;
end;
$$;

create trigger visit_notes_guard_write before insert or update on public.visit_notes
  for each row execute function private.guard_visit_note_write();

revoke all on function private.visit_note_visit(text) from public;
revoke all on function private.visit_note_upload_allowed(text) from public;
revoke all on function private.visit_note_object(text) from public;
revoke all on function private.guard_visit_note_write() from public;

grant execute on function
  private.visit_note_visit(text),
  private.visit_note_upload_allowed(text),
  private.visit_note_object(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------------

alter table public.visit_notes enable row level security;
revoke all on table public.visit_notes from anon, authenticated, service_role;
grant select, insert, update, delete on table public.visit_notes to authenticated;
grant select, update on table public.visit_notes to service_role;

create policy "The visit's CRP can read their note" on public.visit_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.visits as v
      where v.id = visit_notes.visit_id and v.crp_id = (select auth.uid())
    )
  );
create policy "The visit's CRP can keep a note" on public.visit_notes
  for insert to authenticated
  with check (private.visit_writable(visit_id));
create policy "The visit's CRP can record the note again" on public.visit_notes
  for update to authenticated
  using (private.visit_writable(visit_id))
  with check (private.visit_writable(visit_id));
create policy "The visit's CRP can remove the note" on public.visit_notes
  for delete to authenticated
  using (private.visit_writable(visit_id));

-- ---------------------------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------------------------

-- Two minutes of speech at the recorder's bit rate is far below the limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-notes', 'visit-notes', false, 1048576, array['audio/webm', 'audio/ogg', 'audio/mp4'])
on conflict (id) do update
set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "CRPs can upload notes of their visits" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'visit-notes' and private.visit_note_upload_allowed(name));
-- Only the CRP who stored a note hears it, and only while the visit is theirs.
create policy "CRPs can listen to their own notes" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'visit-notes'
    and owner_id = (select auth.uid())::text
    and exists (
      select 1 from public.visits as v
      where v.id = private.visit_note_visit(name) and v.crp_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Service functions: transcription and retention
-- ---------------------------------------------------------------------------------------------

-- Like the other service functions, these run with the caller's rights: only the secret key's
-- role may call them.

-- Notes waiting for a transcript, oldest first. A note the current engine failed on three times
-- is left alone; another engine version tries it again.
create function public.service_visit_notes_to_transcribe(
  batch_size integer,
  current_engine text default null
)
returns table (
  visit_id uuid,
  audio_path text,
  audio_type text,
  language text,
  duration_ms integer
)
language sql
stable
set search_path = ''
as $$
  select n.visit_id, n.audio_path, n.audio_type, n.language, n.duration_ms
  from public.visit_notes as n
  where n.transcribed_at is null
    and n.audio_deleted_at is null
    and (
      n.transcript_failures < 3
      or (current_engine is not null and n.transcript_failed_engine is distinct from current_engine)
    )
  order by
    case when n.transcript_failed_engine is distinct from current_engine then 0
      else n.transcript_failures end,
    n.received_at
  limit greatest(1, least(coalesce(batch_size, 50), 500))
$$;

-- Saves the transcript of a note, unless the note was recorded again or removed meanwhile.
-- Returns whether it was saved.
create function public.service_save_visit_note_transcript(
  target_visit_id uuid,
  target_path text,
  note_transcript text,
  engine text
)
returns boolean
language sql
set search_path = ''
as $$
  with saved as (
    update public.visit_notes
    set transcript = left(coalesce(note_transcript, ''), 8000),
      transcript_engine = left(engine, 120),
      transcribed_at = now(),
      transcript_failures = 0,
      transcript_failed_engine = null
    where visit_id = target_visit_id
      and audio_path = target_path
      and audio_deleted_at is null
    returning 1
  )
  select exists (select 1 from saved)
$$;

-- Notes an attempt by an engine to transcribe a note, made once the note's file is at hand and
-- before the engine starts on it, so that a run that ends in the middle still counts it. An attempt
-- by another engine version starts the count again. Returns the number of attempts so far.
create function public.service_record_visit_note_failure(
  target_visit_id uuid,
  target_path text,
  engine text
)
returns integer
language sql
set search_path = ''
as $$
  update public.visit_notes
  set transcript_failures = case
      when transcript_failed_engine is distinct from left(coalesce(nullif(engine, ''), 'unknown'), 120)
        then 1
      else least(transcript_failures + 1, 1000)
    end,
    transcript_failed_engine = left(coalesce(nullif(engine, ''), 'unknown'), 120)
  where visit_id = target_visit_id and audio_path = target_path
  returning transcript_failures
$$;

-- Note files due for removal: those past the 30 days, then uploads no note refers to.
create function public.service_visit_notes_to_remove(batch_size integer default 200)
returns table (path text, reason text)
language sql
stable
set search_path = ''
as $$
  (
    select n.audio_path, 'expired'
    from public.visit_notes as n
    where n.audio_deleted_at is null
      and n.received_at < now() - interval '30 days'
    order by n.received_at
    limit greatest(batch_size, 0)
  )
  union all
  (
    select o.name, 'unclaimed'
    from storage.objects as o
    where o.bucket_id = 'visit-notes'
      and o.created_at < now() - interval '2 days'
      and not exists (
        select 1 from public.visit_notes as n
        where n.audio_path = o.name and n.audio_deleted_at is null
      )
    order by o.created_at
    limit greatest(batch_size, 0)
  )
$$;

-- Notes that the files of these notes, and with them their transcripts, are gone.
create function public.service_mark_visit_notes_removed(paths text[])
returns integer
language sql
set search_path = ''
as $$
  with removed as (
    update public.visit_notes
    set audio_deleted_at = now(), transcript = null
    where audio_path = any (paths) and audio_deleted_at is null
    returning 1
  )
  select count(*)::integer from removed
$$;

revoke all on function public.service_visit_notes_to_transcribe(integer, text)
  from public, anon, authenticated;
revoke all on function public.service_save_visit_note_transcript(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.service_record_visit_note_failure(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.service_visit_notes_to_remove(integer)
  from public, anon, authenticated;
revoke all on function public.service_mark_visit_notes_removed(text[])
  from public, anon, authenticated;

grant execute on function
  public.service_visit_notes_to_transcribe(integer, text),
  public.service_save_visit_note_transcript(uuid, text, text, text),
  public.service_record_visit_note_failure(uuid, text, text),
  public.service_visit_notes_to_remove(integer),
  public.service_mark_visit_notes_removed(text[])
  to service_role;
