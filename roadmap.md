# Safe integration health audit

## Staff least-privilege proposal — 2026-10-21
- [x] Inspect current Cloud authentication/role metadata and website role source snapshot; document an unapplied least-privilege proposal with owner-access prerequisites.
- [x] Add and run an isolated SMS handler harness exercising the real authentication helper with simulated identity validation and no network or storage access: 28 new tests, 215 targeted tests passed.
- [x] Document source-test versus production evidence and the exact owner authorization decision; no migration or deployment.
- [ ] Implement staff enforcement and reviewed direct-access tightening — blocked on owner-approved staff/action policy, privately verified owner website role, and complete bridge compatibility checks.

## Restricted integration verification — 2026-10-20
- [x] Inspect current website snapshot, CRM secret names and authentication contracts without reading secret values; no applicable cross-project credential binding or connector found.
- [x] Verify live receiver/scheduler unauthorized rejection, SMS invalid-auth rejection and email method rejection; website scan still returns authentication-unavailable 503 and existing scheduler logged that failure at 18:15:05 UTC.
- [x] Run 183 isolated regressions in six files; fresh harness telemetry reports build OK at 2026-10-20 18:18:52 UTC after documentation edits; no manual build/typecheck.
- [x] Document exact owner setup and current evidence in docs/crm-integration-verification-2026-10-20.md; no code deployment, signed-in page, sends, secret changes, forwarding changes or customer writes.
- [ ] Verify website matching credential, receiver URL and authoritative live pause/held settings — requires website project's metadata-only inspection and owner secure provisioning if unavailable.
- [ ] Verify deployed guard source parity without unsafe dispatch — current available read-only interfaces expose rejection behavior, not live source; authenticated dispatch probe deliberately withheld.
- [ ] Assess/remove legacy secret-derived debug endpoint safely — source is unsafe; live presence unverified and endpoint must never be invoked for credential readiness.

## Safety repair re-verification — 2026-10-19
- [x] Strengthen isolated page-load and automatic-provider regressions; no authenticated CRM interface, messages, production writes or setting changes.
- [x] Run non-sending safety tests (183 passing) and inspect harness compilation (build OK at 01:14:15 UTC); publication withheld because deployed parity and actual page-load safety remain unverified under the no-authenticated-interface restriction.

## Automatic messaging safety — 2026-10-19
- [x] Disable page-load dispatch and independently hold automatic SMS/email at providers without queue/history writes; preserve manual functions.
- [x] Run 180 mock regressions and 2 Deno tests; verify four mock-session pages issue zero send requests or queue writes; deploy four backend guards.
- [ ] Publish verified send-neutral frontend — actual website staff session unavailable; owner must sign into preview for final authenticated page-load check. Mock-session verification alone is not live end-to-end verification.
- [x] Record exact deployment evidence, unchanged production counts, tests and remaining owner-setup blockers.

## Secure cross-project authentication audit — 2026-10-18
- [x] Inspect current credential names, supported runtime authentication, website contracts and CRM receiver without reading secret values; no supported service-key or platform-auth fallback exists for the dedicated website contract.
- [x] Re-run 137 non-sending tests and inspect browser startup queued SMS exposure without loading an authenticated auto-send layout; SMS can dispatch despite email pause.
- [x] Document exact minimum owner setup, fresh website 503/CRM 401 evidence, no-deployment decision and publishing blockers in the Files audit report.
- [ ] Complete matching-auth live recovery — owner must securely configure website shared credential and receiver URL; original private value is unavailable to this audit.
- [x] Make browser publication send-neutral — removed startup dispatcher, made legacy hook inert, deployed automatic provider holds; final live-session publication check tracked above.

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
- [ ] Publish send-neutral browser — preflight/claim dispatcher replaced by inert compatibility hook; waiting for actual website staff session as tracked above.
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