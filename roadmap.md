# Safe integration health audit

## Scheduled follow-up and marketing pause repair
- [ ] Complete authorized production deployment safety checks, deploy only the three repaired email/scheduler functions, and verify with non-sending checks; do not publish the browser auto-dispatcher or change cron, pause, secrets, or records.
- [x] Inspect live scheduler logs, cron metadata, global setting contract, and all CRM sends.
- [x] Add local fail-closed marketing guards and a backwards-compatible read-only scheduler repair.
- [x] Run non-sending mock tests and report deployment/external dependencies; leave cron, secrets, and records unchanged.
- [ ] Validate live authoritative website pause reads — requires an accepted website admin/moderator session or working scheduler read credential.
- [ ] Deploy repaired functions and verify live 404 removal — owner authorized safe backend deployment on 2026-10-18; sending remains prohibited.
- [ ] Restore unattended scheduled dispatch — requires separate authorization, backlog review, working scheduler credentials and shared atomic claims.

- [x] Trace CRM registrations, attribution, tracking, and operational health.
- [x] Inspect Social Insight organic posting, paid ads, registration URLs, and compliance safeguards.
- [x] Run strictly non-sending, read-only live checks and local regression tests.
- [x] Apply only evidenced, backward-compatible local improvements; no deployment.
- [x] Report tested findings, remaining verification blockers, and exact edits.
- [ ] Verify live website registration and attribution completeness — requires redacted source-project export or separate authorized non-sending access.
- [ ] Verify Social Insight live pause/queue/paid-ad state and repair its safeguards — requires that project's chat; snapshots cannot update it.
- [ ] Verify authenticated CRM read endpoints — requires accepted website staff session without entering auto-send layout.