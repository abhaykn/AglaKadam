# Live check

An end-to-end check of a deployed Agla Kadam project. It signs in as each kind of user, uses the
same Edge Functions and database functions as the web app, and confirms both what each person can
do and what they must not be able to do. Every record it creates is removed at the end, including
its audit history.

```bash
npm run check:live                 # run the check, then remove the records it made
npm run check:live -- --clean-up   # only remove records left by an interrupted run
```

## What it needs

- `apps/web/.env.local` with the project URL and publishable key.
- The Supabase CLI logged in (`npx supabase login`) and linked to the same project
  (`npx supabase link`). The check refuses to run if the two point to different projects.
- The project's secret key, typed or pasted when asked (the input is hidden), or provided as
  `SUPABASE_SECRET_KEY`. It is used only to create the temporary administrator, because the first
  administrator of a project cannot be created any other way. It is kept in memory and never
  printed or written to disk.

## How records are marked and removed

Each run picks four random capital letters, for example `KXQP`. The state it imports has the code
`LCKXQPS` and the name "Live check KXQP state"; official state codes are numeric, so the two can
never clash. The temporary administrator's sign-in is `live-check-kxqp@agla-kadam.invalid`.
Everything else the run creates belongs to that state or to that account.

Removal is a single database transaction run through the Supabase CLI as the database owner. It
removes the school hierarchy, classes, learners, staff and family accounts, and their audit events,
or nothing at all if any step fails. A final count confirms that nothing is left. The academic
session is removed only when the run added it and nothing else uses it.
