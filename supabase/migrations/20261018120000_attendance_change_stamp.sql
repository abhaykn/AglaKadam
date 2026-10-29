-- Lets a device recognise its own earlier saves of a day's attendance.
--
-- A day's attendance is changed only if it is still the version the teacher started from, so a
-- phone that syncs late never overwrites someone else's newer record. A device must still be able
-- to tell its own earlier save from someone else's: when the answer to a send was lost, or when the
-- teacher corrected the day again while the first save was still on its way. Each save carries a
-- random identifier, stored with the record it wrote, for exactly that purpose.

alter table public.attendance_sessions add column client_change_id uuid;

comment on column public.attendance_sessions.client_change_id is
  'Identifier of the device save that last wrote this record. Chosen by the application and used '
  'only to recognise its own earlier saves; it grants nothing.';
