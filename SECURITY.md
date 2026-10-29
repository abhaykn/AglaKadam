# Security

Agla Kadam handles children's recordings, school records and staff accounts, so security reports
are taken seriously.

## Reporting a problem

Please do not open a public issue. Use this repository's **Security** tab → **Report a
vulnerability**, which reaches the maintainers privately. Describe what you found, how to reproduce
it and what it could expose. You will get an answer within a week.

## How the application protects data

- Every database table has row level security; a test checks that no table, view or function is
  open to visitors and that each role sees only its own scope.
- Secret keys live only in the hosting platforms' secret stores, never in the code or the browser.
- Data kept on a phone is encrypted with a key per account, and removed when the person signs out.
- Recordings are audio only and deleted after 30 days; names are removed from any text before it
  is sent to a language-model service.
- Sign-in is limited per account and per network, and a family PIN locks after repeated failures.
