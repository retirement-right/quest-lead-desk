# CRM security remediation — safe staging, Oct 23 2026

## Production evidence
- Scan at 17:22:04 UTC: six critical findings and two related storage warnings remain active. Live policy metadata confirms broad authenticated access.
- Owner reports Website database confirmation of admin and signed-in self-role reads. The existing successful CRM Contacts sign-in is acknowledged.
- The sandbox has no usable Website session. CRM Cloud session minting cannot prove Website identity. No actual owner-session authorization test was performed.

## Implemented without enforcing production restrictions
- Hardened staged admin gate: each protected role row must have the verified user ID and a recognized role.
- Added read-only Website identity + self-role adapter. Uses GET, publishable key and caller token only; ignores user-editable role claims and fails closed on errors.
- Added `/admin/access-check` in preview, outside the dashboard layout. Its result never grants privileges or changes rules. No identity/token is displayed or logged.
- Added `crm-access-lockdown.staged.sql` outside migrations. It revokes direct anon/authenticated access to six legacy tables and removes only their broad policies plus three document-bucket policies. No SQL was applied to Cloud. Service access and records remain unchanged.
- Added isolated Postgres tests for real privilege denial, role escalation, document RLS and service/data preservation, and identity/role adapter tests.
- Strengthened actual SMS-handler isolation tests for methods and malformed bodies; existing automatic holds unchanged.

## Remaining production changes — blocked
- Wire server enforcement into 12 identity-only handlers and add missing checks to birthdays-this-month and admin-backfill-leadjig-appointment-at, only after owner-session role readback and compatibility verification.
- Additional source gaps: crm-match-report and import-bookedin-csv have no in-handler caller authentication; protecting only 14 handlers would leave alternate paths. Include them in the pre-enforcement inventory.
- Manual SMS consent/opt-out is not established at the provider boundaries: follow-up validates phone only; birthday trusts request-supplied phone. Automatic suppression tests are not evidence of manual consent enforcement. Authoritative SMS opt-out contract must be inspected before altering working manual sends; no new suppression fields or assumptions were invented.
- Reinspect current privileges, inherited roles and all bucket sibling policies; prepare owner-access rollback; deploy role-enforcing handlers and verify owner/non-admin read-only access before applying restrictive SQL and rescanning.

## Next owner verification
Open `/admin/access-check` in the Lovable preview while signed into CRM and select Verify administrator access. Report the displayed result only, never passwords or tokens. This reads Website identity and protected roles and cannot send, access customer records, forward events or change permissions. A successful browser role read is a prerequisite, not proof that production handlers already enforce it.

No provider calls, live reset requests, customer writes, restrictive migrations, backend handler changes, deployments, publication, schedules, forwarding or marketing changes were performed.