# CRM status report (read-only) — Oct 23, 2026, 01:13 UTC

Nothing is changed or sent by this report. Approving it just closes the report. It does not start any work.

## Meaningful change today
- None. The last project change was Oct 22 at 23:27 UTC (a planning note only). No code changes, deployments or setting changes since then.

## SMS safety fix
- Live since Oct 19: automatic SMS and automatic admin alerts are held at all four messaging functions. Page-load sending was removed and is published.
- Follow-up and birthday emails held since Oct 21 deployment. Manual SMS still works.
- Live proof: requests with bad credentials are refused. Not live-tested: a signed-in automatic request (tests only).

## Security scan
- Six critical access findings still open since Oct 19 (birthday history, lead-document records and files, BookedIN appointments, contact activity, unmatched SMS).
- Server functions check website sign-in, not staff role. The admin-only gate is built and tested (10 tests) but not connected.

## Website integration authentication
- Oct 21: receiver and contact scan deployed using the dedicated integration key. Keyed receiver check returned OK; scan read 2,908 contacts, 0 due, 0 sent, marketing paused.
- Forwarding still held: 0 events received from the website.

## Deployment
- CRM published Oct 22 (password-reset fix); live site serves it. 233 tests passing.

## Live end-to-end
- Owner signed in to the Contacts dashboard Oct 22.
- Not yet checked live: signed-in hold behavior; full emailed password reset.

## Remaining blocker
- Website project must confirm your account has the admin role. Then: connect the gate, close the six findings, rescan. Website receiver address and forwarding are set up on the Website side.
