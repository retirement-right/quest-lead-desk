# Safe integration health audit

## Documented website read-only scheduler adapter
- [x] Adopt the deployed authenticated bounded scan contract without changing sending, cron, secrets or records.
- [x] Run 138 passing mock regressions, safely deploy only process-followups, and verify held fail-closed live behavior; document missing website credential blocker.
- [ ] Verify successful live scheduler recovery and authoritative pause read — website must securely configure WEBSITE_CRM_SHARED_SECRET matching existing CRM LEADJIG_SHARED_SECRET; deployed website currently returns authentication-unavailable 503.

## Website forwarding receiver and credential repair
- [x] Inspect latest website outbox/diagnostic contract and CRM read authentication.
- [x] Implement and safely deploy authenticated idempotent check-in/unsubscribe receiver with consent suppression and no automatic sends.
- [x] Run 82 non-sending regression tests and 2 Deno runtime tests; verify live unauthorized rejection, email method guards, service-only schema and unchanged appointment totals; document deployment and website contract.
- [ ] Complete website authenticated forwarding configuration — website now implements authenticated sender and service-read endpoint; dedicated matching credential and receiver URL require owner secure configuration and private verification, without enabling delivery.
- [ ] Verify live accepted/duplicate/conflict persistence and real multi-session races — requires authorized isolated fixtures, not production contacts or held outbox release.

## Scheduled follow-up and marketing pause repair
- [x] Complete authorized production deployment safety checks and deploy only the three repaired email/scheduler functions; non-sending reachability/auth checks and the existing 16:15 UTC read-only cron callback verified. No browser publication or changes to cron, pause, secrets, or records.
- [x] Inspect live scheduler logs, cron metadata, global setting contract, and all CRM sends.
- [x] Add local fail-closed marketing guards and a backwards-compatible read-only scheduler repair.
- [x] Run non-sending mock tests and report deployment/external dependencies; leave cron, secrets, and records unchanged.
- [ ] Validate authoritative pause value and deployed authenticated email gate without sending — public settings read exposes no singleton; existing scheduler credential rejected with 401; requires accepted website staff read access and a non-sending authenticated gate check.
- [x] Deploy repaired functions and verify live 404 removal — three functions deployed on 2026-10-18; existing cron now reports explicit read-only website 401/503 failure, not missing proxy 404.
- [ ] Publish local browser preflight/claim improvements — withheld because authenticated layout startup can dispatch queued SMS; requires separately authorized send-neutral publication strategy.
- [ ] Verify birthday website-JWT compatibility — requires a non-sending authenticated validation; current function-specific JWT configuration is not explicitly overridden.
- [ ] Restore unattended scheduled dispatch — requires separate authorization, backlog review, working scheduler credentials and shared atomic claims.

- [x] Trace CRM registrations, attribution, tracking, and operational health.
- [x] Inspect Social Insight organic posting, paid ads, registration URLs, and compliance safeguards.
- [x] Run strictly non-sending, read-only live checks and local regression tests.
- [x] Apply only evidenced, backward-compatible local improvements; no deployment.
- [x] Report tested findings, remaining verification blockers, and exact edits.
- [ ] Verify live website registration and attribution completeness — requires redacted source-project export or separate authorized non-sending access.
- [ ] Verify Social Insight live pause/queue/paid-ad state and repair its safeguards — requires that project's chat; snapshots cannot update it.
- [ ] Verify authenticated CRM read endpoints — requires accepted website staff session without entering auto-send layout.