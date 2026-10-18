# Scheduled follow-up and global marketing pause repair

## Production deployment — 2026-10-18

Owner authorized only safe production deployment and non-sending verification. The three functions below were successfully deployed, with deployment boot logs at 16:11:03–16:11:05 UTC. No browser publication, migrations, secret changes, record writes, cron changes, or live provider tests were performed.

| Function | Submitted source SHA-256 |
|---|---|
| `process-followups` | `e2e409db045c6fa63bc9aa69bd512779bcfb2d4ae4992e23d8ed1f8f51f5ac5f` |
| `send-followup-email` | `291bb10c0684ad0213ec2d08312075ad2ed59662c316153268990ffeea836c52` |
| `send-birthday-email` | `94a9a4b01beed52f8163d3f18d12ed8ee793d2e286a4ccf6a897538616594e04` |

### Final safety and verification results
- PASS: 54 non-sending tests in five files, rerun at 16:10 UTC; providers, alerts, authentication and writes mocked.
- PASS: hosted application build succeeded, compiler diagnostics empty; latest local telemetry at 16:10:37 UTC says `build OK`. No manual build or typecheck was run.
- PASS: deployed scheduler rejects an invalid cron secret with HTTP 401. Email GET probes return HTTP 405 before any authentication, setting read, provider call, alert or write. These method probes establish reachability, not marketing-gate behavior.
- PASS: observed the already-active cron's next invocation, without triggering it. At 16:15:05 UTC production logs show `blocked read-only scan Website read rejected (401)` rather than the missing-proxy 404. The scheduler remains intentionally unable to send; credential rejection remains a blocker to successful scanning.
- PASS: cron job 2 retained `active=true` and `*/15 * * * *`; it was neither activated nor deactivated by this task.
- PASS: all 557 appointment records (460 booked, 97 cancelled) had identical full-row fingerprints before and after deployment. Activity count stayed 8 and unmatched SMS count stayed 22 at the initial post-deployment comparison.
- NO SEND TESTS: no email handler POST was issued, no authenticated CRM layout was opened, and no provider request or manual cron execution was initiated.

### Remaining blockers and intentionally withheld work
1. **Authoritative pause value and authenticated deployed email-gate behavior are NOT VERIFIED.** A public-only settings GET at 16:11:40 UTC returned HTTP 200 without a visible singleton. The scanner's existing credential is rejected with 401. Neither result establishes the real pause value. Mock tests prove fail-closed policy behavior; deployment success and GET/401 probes do not substitute for a live authenticated gate test.
2. **Successful scheduler reads remain blocked by the existing website credential.** No secrets were read out, changed or copied, and no staff session was fabricated for cron. The 404 is replaced by an explicit read-only 503 failure, not a healthy empty queue.
3. **Browser publication was withheld for safety.** The authenticated layout mounts an automatic dispatcher capable of sending queued SMS; publishing/reloading it is not send-neutral. The local browser preflight and compare-and-swap improvements are not claimed as newly published by this task.
4. **Birthday platform JWT compatibility remains unverified.** Its configuration lacks the explicit custom-JWT override present for the follow-up and scheduler functions. No configuration change was made; a GET reaching the handler does not prove a website staff JWT will be accepted.
5. Existing birthday authoritative recipient/opt-out, explicit staff-role and server-side idempotency concerns remain outside this deployment. Existing manual/browser SMS paths were not disabled or changed. Absolute absence of unrelated concurrent provider sends is not established by activity counts or logs.
6. Unattended dispatch restoration is explicitly unauthorized and remains disabled. Website registration completeness, Social Insight production safety and authenticated CRM reads retain their previously documented external-access blockers.

## Historical local repair report — 2026-10-17

The sections below record the earlier local-only repair and its evidence; deployment-status statements there are superseded by the production results above.

## Live evidence (read-only)
- `process-followups` logged `proxy list_due 404: Requested function was not found` at 18:45 UTC.
- Cron job 2 remains active on `*/15 * * * *`, despite its “every-minute” name. Its last 24 hours had 96 SQL executions marked succeeded; this is not evidence of HTTP callback success.
- Existing cron-secret storage is present and nonempty (only a boolean was read, never its value).
- Follow-up/birthday email handlers returned no recent logs. Lack of logs does not prove sending health.
- The website snapshot has no `leadjig-followups-proxy`. It owns the `email_marketing_settings` singleton (`id=true`), defaults paused, and permits authenticated admin/moderator reads. Snapshot permissions and defaults are not proof of deployed settings or the current pause value.

## Send-path coverage
| Path | Classification | Change |
|---|---|---|
| Manual follow-up email | Marketing | Server pause preflight and immediate pre-provider recheck |
| Browser automatic follow-up email | Marketing | Authoritative preflight before claim, server guard, conditional rollback on suppression |
| Birthday email | Marketing | Same server pause guards; paused result creates no provider call or failure log |
| Cron follow-up email/SMS | Marketing | Missing proxy replaced by authenticated direct GET scan; sending deliberately disabled |
| Manual/browser follow-up SMS | SMS | Email-only pause does not change this working path; browser claims now conditional |
| Birthday SMS and admin SMS/email copies | SMS / operational notification | Unchanged |
| BookedIN/inbound SMS/appointment records | Transactional / inbound | Unchanged; no standalone appointment notification sender found in this CRM |

Only a single authoritative row containing literal `marketing_paused=false` allows marketing email. Missing rows, multiple rows, malformed data, HTTP errors, denied credentials and timeout/network errors block it. Reads are not cached. Staff calls use the existing staff JWT and website publishable key, never the stale service-role credential.

Suppression returns HTTP 200 with `success:false`, `paused:true`, `sent:0` and a clear error, compatible with existing callers' success checks. It does not trigger a failure-alert SMS. Browser suppression keeps the follow-up Pending without successful activity. Compare-and-swap uses JSON-stringified profile equality; rollback cannot overwrite a concurrent edit.

## Scheduler limitation — intentionally not an operational sending restoration
The repaired handler preserves legacy cron authentication and an empty request body; `{dry_run:true}` is also accepted. Attempts to turn sending on are rejected. It reads the same CRM `leadjig_leads.client_profile` follow-up fields used by the browser, not the website's separate `follow_ups` table. Stable pagination scans beyond 1000 records. No provider calls, contact writes or admin alerts exist in this handler.

It uses the existing `LEADJIG_SERVICE_ROLE_KEY` for the read-only scan; the prior audit found it invalid. No live key validation was performed in this repair. A rejected read now reports an explicit 503 instead of invoking the missing proxy or claiming an empty queue is healthy. No secret was changed or staff session fabricated for cron.

## Verification
- PASS: all **54 tests in 5 test files** via `bunx vitest run`.
- PASS: actual email handlers exercised in an isolated runtime, with authentication, settings, records, providers and alerts mocked; blocked and allowed outcomes verified, no live egress.
- PASS: missing/invalid/paused/error settings, fresh recheck after recipient lookup, pagination, credential rejection, dry-run GET-only behavior, rejected enable flags and preserved cron authentication.
- PASS: browser paused preflight, lost conditional claim, pause-after-claim rollback, unchanged successful SMS dispatch (mocked).
- PASS: existing eight inbound phone matching regression tests.
- PASS: preview build telemetry reports `build OK` after edits.
- NOT TESTED: authenticated live website settings reads, current global pause value, corrected live scheduler callback, provider delivery and live conditional claims. No authenticated browser layout was opened because it can auto-send.

## Blockers / next authorization required
1. The live 404 and unguarded live email functions persist until a separately authorized backend deployment. Nothing was deployed here.
2. Website credentials and deployed read permissions require authorized non-sending validation. CRM marketing fails closed until staff can read the authoritative singleton. Website repairs must occur in that project's chat.
3. Restoring unattended sending requires an explicitly approved dispatch release, a working scheduler credential, shared atomic claims with browser dispatch, and backlog review. This repair cannot enable it, including through cron request flags.
4. Existing birthday recipient/opt-out and ambiguous provider/logging outcome risks remain outside this pause-only repair. No new live-send testing was attempted.

Production records, transactional appointment paths, secrets, existing cron state and marketing pause state were not changed. The live cron was already active and was neither activated nor deactivated.