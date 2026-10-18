# Website → CRM contract and safety report

## Evidence and scope — 2026-10-18

Website snapshot commit `ecbb36f8` was inspected read-only. Its current `send-checkin-webhook/delivery.ts` sends **no authentication**: only `Content-Type` and `Idempotency-Key`. The CRM receiver intentionally rejects these requests until website authentication is added. Website diagnostics require website admin authentication and are not a scheduler service-read endpoint. Snapshot settings default held with no polling job; actual live settings were not read and are not established by defaults.

CRM scheduler live logs at **18:15:04 UTC** show upstream `Website read rejected (401)` after cron authentication, not a cron-secret failure. The handler returns 503 for this failure. It uses `LEADJIG_SERVICE_ROLE_KEY` as both the website API key and bearer credential. Existing staff JWT reads use the website publishable key, but a cron task has no staff session. The website snapshot has **no shared-secret authenticated lead/settings scan endpoint**. Do not invent a staff JWT, substitute a public credential for privileged authorization, copy another project's credentials, or enable forwarding to diagnose this.

## Receiver contract for the website agent

- Function: **`receive-website-event`**, in this CRM's Lovable Cloud functions.
- Method: HTTPS `POST`, redirects disabled. Website uses its configured `CHECKIN_WEBHOOK_URL`; obtain the deployed function URL from CRM Cloud. Do not point at the CRM browser URL.
- Headers: `Content-Type: application/json`, `Idempotency-Key: <outbox.event_key>`, **`x-shared-secret: <matching private server credential>`**.
- CRM validates its existing `LEADJIG_SHARED_SECRET` (already used for CRM → website trusted forwarding). Website must use the corresponding existing server credential if provisioned. Neither its name nor equality on the website has been established here; the BookedIN website endpoint references `ZAPIER_SHARED_SECRET`. Verify privately, never paste values into chat or URLs. If equality cannot be established, stop and arrange authorized credential provisioning; no secret was changed in this repair.
- Authenticated **GET** is a send-neutral, write-free capability check returning `contract: website-events-v1`, `sending_enabled:false`, `sent:0`. It does not verify persistence or credential equality unless executed with the real matching website credential.
- Body: existing website payload, plus `event_idempotency_key` (exactly equal to header) and `delivery_id` (UUID). Maximum 16 KiB. Unknown fields rejected, including enrollment or send flags.

### Check-in JSON
```json
{
  "source": "retirement_right_admin_checkin",
  "email": "person@example.test",
  "name": "Person",
  "lead_id": null,
  "event_id": null,
  "event_name": "Seminar",
  "event_date": "2026-10-18",
  "checked_in_at": "2026-10-18T18:00:00+00:00",
  "guest_checked_in_at": null,
  "guest_name": null,
  "event_idempotency_key": "attendees:source-uuid:checked_in_at:timestamp",
  "delivery_id": "00000000-0000-4000-8000-000000000001"
}
```
One check-in timestamp is required. Name, IDs, event name/date and guest fields may be absent/null as supported by the schema. Email must be valid; invalid/missing website email remains held rather than matched by name. Guest check-in is only an attendance observation, never evidence of guest consent.

### Unsubscribe JSON
```json
{
  "source": "retirement_right_local_unsubscribe",
  "email": "person@example.test",
  "group": "Newsletter",
  "unsubscribed_at": "2026-10-18T18:00:00+00:00",
  "event_idempotency_key": "newsletter_unsubscribes:source-uuid:unsubscribe",
  "delivery_id": "00000000-0000-4000-8000-000000000001"
}
```

### Acknowledgment and retry
- New committed event: HTTP 200 `{success:true,status:"accepted",held:true,suppression_applied:<unsubscribe>,sending_enabled:false,sent:0}`.
- Same key and normalized content: HTTP 200 `status:"duplicate"`; transport `delivery_id` is not event identity. No duplicate row or consent change.
- Same key, different content: HTTP 409. Do not mint a new key to bypass a conflict.
- Missing/bad auth: 401; missing receiver auth configuration or failed persistence: 503; malformed event: 400; oversize: 413; wrong content type: 415.
- Website currently considers any 2xx delivered. It should additionally check `success:true` and accepted/duplicate status, preserve existing uncertain-outcome handling, and never automatically replay ambiguous transport outcomes.

## Consent and automation boundaries

Events are stored in `crm_website_events` with immutable held state. Unsubscribe inserts sticky **all-CRM-marketing-email** suppression in `crm_email_suppressions` within the same database transaction. Any group opt-out conservatively blocks all CRM marketing emails; no check-in can clear it. Email follow-up and birthday handlers check suppression at their provider boundary as well as the website global pause. Storage errors fail closed and suppression does not trigger failure-alert SMS. Birthday BCC recipients are checked too.

This receiver does **not** update website `leadjig_leads.do_not_email`, create contacts, alter appointments, enroll follow-ups, send SMS/email, or open/publish the browser. Suppression applies only once a website unsubscribe has reached CRM: events still held at the website cannot be claimed as synchronized. Existing SMS/manual send paths are not consent-repaired by this email-only change.

## Required website-side credential repair

Repair must be made from the website's own chat. Preferred safe solution: a dedicated read-only server endpoint validating the existing matching server shared secret and exposing only a bounded, paginated CRM lead scan and the authoritative marketing singleton, with no dispatch actions. Use the website's own privileged client internally, never export its service credential. Exact new read contract must be agreed and implemented on the website before replacing the CRM scheduler adapter; its current diagnostics endpoint is unsuitable (admin JWT, outbox status only). Keep all sending disabled and forwarding settings held while validating authentication and persistence with isolated fixtures.

No scheduler credential fallback was added because none is authenticated by the deployed website contract. The 401 remains an explicit fail-closed operational blocker, not a healthy empty queue.

## Verification limits

The actual migration was applied by the Cloud migration tool and the live database confirms both tables are RLS-enabled, inaccessible to ordinary clients, and that only the service role can execute the receiver RPC. Isolated PGlite tests run the exact applied SQL and cover duplicates, conflicts, suppression, rollback and permissions; their parallel promises share a single connection and **do not prove a real multi-session race**. Live accepted-event persistence and website-to-CRM authenticated delivery remain untested to avoid writing production fixture records or releasing held events. Two runtime tests also exercise the actual receiver imports with storage mocked. Provider calls and alerts are mocked in email boundary tests.

## Production deployment and non-sending results — 2026-10-18, 18:21 UTC

Email safeguards were deployed **before** the receiver. Deployment does not invoke any send handler and the receiver has no provider, contact-update, enrollment or dispatch code.

| Function | Submitted source SHA-256 |
|---|---|
| `send-followup-email` | `2d3c532a27992a6c3bcf9acb8becd0f99a455f8f64e5842ecd74ffeb527279de` |
| `send-birthday-email` | `349708156b4b317bbfb2df82205263f3dd8b830ff1170005f33da94f2fa5c610` |
| `receive-website-event` | `b0ef29a40ff31b2cc32452f9ac2aeeab6afb243844a1576852975d92e1df19a8` |

- PASS: **82 tests across six files**, final run 18:21:36–18:21:43 UTC; **2 Deno receiver runtime tests** passed separately.
- PASS: latest compiler telemetry at 18:21:12 UTC reports `build OK`.
- PASS: deployed receiver POST with deliberately invalid shared secret returned **401**, no writes; handler boot log at 18:21:32 UTC. This does not prove real website credential equality.
- PASS: deployed email GET probes returned **405** before recipient/provider handling; boot logs at 18:21:33 and 18:21:34 UTC. No email POST or provider test was issued.
- PASS: live database has both service-only tables and RPC; ordinary client read and RPC permissions are false, service permissions true. Inbox and suppression table remain **0 rows** after probes.
- PASS: appointment totals remain **557 / 460 booked / 97 cancelled**. No existing-record writes were performed. A new fingerprint was collected with a different serialization than earlier baselines, so it is **not** claimed as proof of identical full-row fingerprints.
- PASS: cron job 2 remains `active=true`, `*/15 * * * *`; not activated, deactivated, invoked manually or changed. The scheduler source/deployment was unchanged this turn and remains read-only.
- PASS: inventory found only the follow-up and birthday client email provider boundaries in scope; birthday SMS's staff-copy email and BookedIN failure-alert email are operational notifications and were left unchanged.
- NOT VERIFIED: authenticated live marketing-gate response, global pause singleton, real website receiver credential equality, accepted production persistence, website live held-setting values, multi-session database races, website registration completeness and birthday staff-JWT compatibility.

No live email/SMS sends, browser publication, secret changes, marketing enablement, scheduled dispatch restoration or held outbox delivery were performed. New service-only schema was applied; existing production records were not edited. Unrelated concurrent activity is not ruled out by these probes.

## Proposed website read contract — requires website implementation, not deployed here

For the website agent: implement **`crm-readonly-scan`**, authenticated server-side with the privately verified matching shared secret in `x-shared-secret`. CRM calls HTTPS POST with JSON `{ "cursor": null, "limit": 500 }`; allow an opaque continuation cursor and limit 1–500, reject unknown fields and any sending/retry flags. Response: `{ "success": true, "marketing_settings": { "id": true, "marketing_paused": true }, "leads": [...], "next_cursor": null }`. Lead fields: `id`, `name`, `email`, `phone`, `do_not_email`, `raw_payload`, `client_profile`; stable ID ordering, least necessary data, service-only caller. Only a reliably read singleton's literal `false` may authorize the marketing-policy read; invalid/missing settings or auth failures must fail closed, never synthesize false. No writes, claims, sends or setting changes. Return 401 for auth failure, 400 for invalid input, 503 for unavailable authoritative reads; do not return credentials or raw upstream errors.

This is a **proposed coordinated contract**, not an existing endpoint or a completed credential fix. Once implemented and privately verified in the website project, CRM can replace its rejected service-key REST adapter under non-sending tests. Do not turn forwarding on to validate it.