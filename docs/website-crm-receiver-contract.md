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