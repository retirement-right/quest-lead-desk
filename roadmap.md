# Safe integration health audit

## Scheduled follow-up and marketing pause repair
- [ ] Inspect live scheduler logs, cron metadata, global setting contract, and all CRM sends.
- [ ] Add local fail-closed marketing guards and a backwards-compatible scheduler repair.
- [ ] Run non-sending mock tests and report deployment/external dependencies; leave cron, secrets, and records unchanged.

- [x] Trace CRM registrations, attribution, tracking, and operational health.
- [x] Inspect Social Insight organic posting, paid ads, registration URLs, and compliance safeguards.
- [x] Run strictly non-sending, read-only live checks and local regression tests.
- [x] Apply only evidenced, backward-compatible local improvements; no deployment.
- [x] Report tested findings, remaining verification blockers, and exact edits.
- [ ] Verify live website registration and attribution completeness — requires redacted source-project export or separate authorized non-sending access.
- [ ] Verify Social Insight live pause/queue/paid-ad state and repair its safeguards — requires that project's chat; snapshots cannot update it.
- [ ] Verify authenticated CRM read endpoints — requires accepted website staff session without entering auto-send layout.