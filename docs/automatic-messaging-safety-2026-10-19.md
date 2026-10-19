# Automatic messaging safety — 2026-10-19

## Latest restricted re-verification — 01:14 UTC

- The requested repair was already implemented in checked-in source; no production dispatch code needed changing. The inert hook and unconditional automatic provider hold remain intact. The hold is stronger than a pause lookup: automatic messages cannot send whether the setting is true, false, missing or unavailable.
- Strengthened the isolated hook regressions with StrictMode rerender/remount, two simulated days, zero pending timers, direct fetch interception, both client mocks, and preserved overdue SMS/email fixtures. No authenticated CRM interface was opened.
- Strengthened all four provider-handler regressions to assert zero dispatch-time credential reads, recipient lookups and suppression reads for held requests, and added caller-supplied force/unpause/send-enable bypass tests. Providers and storage are mocked; no live sends or production requests were made.
- **183 tests passed across six targeted safety files**; harness compilation reported **build OK at 2026-10-19T01:14:15Z**. No queue, history, pause, credentials or cron changes were performed.
- No backend redeployment was needed: production guard code was unchanged from the preceding deployment. That earlier deployment evidence is recorded below, not freshly verified live in this restricted check.
- **Publication withheld:** isolated regressions and source inspection verify the current implementation, but do not establish deployed parity or actual authenticated page-load behavior. This check respects the owner's prohibition on opening the authenticated CRM; no sign-in is requested or attempted. The preceding publication blocker remains unresolved.

## Implemented and deployed

- Removed `useFollowupAutoSend` from `AppLayout`; its compatibility export is now inert, with no session reads, queue scans, claims, rollback, activity writes or messages.
- Added shared validated automatic-dispatch guard to follow-up SMS, birthday SMS, follow-up email and birthday email. Auth remains enforced first. `auto:true` returns `success:false`, `paused:true`, `sending_enabled:false`, `sent:0` before credential loading, recipient lookup, providers, alerts or writes.
- Automatic messaging remains disabled even when marketing is explicitly unpaused. This stronger hold does not depend on unavailable website settings and cannot be enabled by request flags or environment configuration. Independent owner authorization and a separate implementation are required to resume it.
- Invalid JSON/non-object bodies and non-boolean `auto` return 400 without side effects. Existing manual calls with omitted `auto` or `auto:false` retain their established path. Manual email still enforces authoritative marketing pause and Cloud recipient suppression. Manual SMS behavior and birthday admin copies are preserved.
- Automatic follow-up admin SMS success/failure and email-failure alert exports are inert as defense in depth. Birthday admin copies remain part of explicitly initiated manual birthday sends.
- No change to read-only scheduler, cron, inbound SMS, appointments, credentials, marketing pause, Facebook or paid ads. No send function invoked with valid sending input during live tests.

## Tests and verification

- **180 Vitest tests passed across 7 files**, including 74 provider/scheduler handler tests and 4 inert-hook tests.
- **2 Deno runtime tests passed**: request enable flags cannot bypass automatic hold; automatic follow-up admin alerts cannot reach a provider.
- All providers were mocked in tests. Automatic requests tested for pause true, false, null and unavailable; no providers, alerts, settings reads or record writes. Invalid dispatch types tested on all four handlers. Explicit manual SMS and existing manual email paths tested with mocked providers.
- Browser loaded Contacts, Follow-ups, Appointments and Birthdays with a mock staff session and overdue SMS/email fixtures. All external data requests intercepted: **0 send requests, 0 PATCH/PUT/DELETE queue writes**. Contacts screenshot inspected. This is mocked integration verification, not actual authenticated live verification.
- Harness compilation: **build OK**, latest observed entry `2026-10-19T01:11:06Z`.
- Production non-sending probes after deployment: follow-up SMS and birthday SMS POST with deliberately invalid auth → **401**; follow-up email and birthday email GET → **405**. No valid staff JWT available to verify the deployed automatic-held response live.
- Cloud counts before/after unchanged: **557 appointments, 8 contact activity entries, 22 inbound queue rows, 12 birthday history rows**. This count comparison is not proof of row-by-row immutability. Application performed no production writes; website-hosted outbound queue not read due unavailable staff session.
- Cron job 2 remains active on `*/15 * * * *`; inspected only, not changed. Its deployed function remains read-only.

## Exact deployment

Four functions deployed successfully on **2026-10-19**, between the observed `01:11:14Z` test start and `01:12:24Z` post-deployment verification. Deployment tool provides no exact completion timestamp; do not infer one.

| Function | Submitted source/settings SHA-256 |
| --- | --- |
| send-followup-sms | `724ec2f72cf80c00dcbb6fff193e47c94e5964003cfc10d44f3b62ba9bd3ef6f` |
| send-birthday-sms | `e4a70c9a4f856b9432fd20e5edfff15194c5de7e570321f4021aa9f58a1a12f8` |
| send-followup-email | `5656c59529d0f558aed73da24add2cfaa5a88d6bc9bd49964bffb443cd2a7bfb` |
| send-birthday-email | `53d2802f088aab78a0ac8fbd1ad94e7300db5316eb9a7c171426d5c4dbb00c93` |

These hashes identify submitted deployment bundles, not independently downloaded live source.

## Remaining blockers and owner steps

1. **Frontend not published**: final actual signed-in verification unavailable. Cloud session mint for requesting account failed because no matching Cloud account exists; CRM uses a separate website staff login. Sign into the CRM preview through its existing login, then request final non-sending page-load verification. Do not paste credentials or tokens into chat. After verification, publish only this inert frontend. Old published browser code may still attempt automatic requests; deployed provider holds prevent those `auto:true` requests from sending, but the old hook can temporarily claim/roll back queue records until frontend is replaced. Close old CRM tabs until the verified frontend is published.
2. **Live automatic gate and website queue verification** require that valid website staff session. Live authorized guard response not yet verified; deployed auth and method rejection are verified.
3. **Website read/receiver matching configuration** remains unresolved from prior audit; no new secret inspection or changes performed. Website owner must configure `WEBSITE_CRM_SHARED_SECRET` in Website → Project Settings → Secrets to match existing CRM `LEADJIG_SHARED_SECRET` using secure records, and configure the documented receiver URL without enabling forwarding or marketing. Do not paste values in chat.
4. Website accepted-event/duplicate/conflict persistence, real multi-session races, birthday staff-JWT compatibility, registration attribution completeness and Social Insight safeguards remain unverified under prior documented blockers. None was enabled or changed here.

Automatic functions are identified by `auto:true`; omitted/false remains the existing manual contract. This is not a new server-verified scheduler identity or a universal ban on staff manual sends. No automatic implementation remains in current browser source. Future automatic implementations must reuse the hold and require separate authorization.