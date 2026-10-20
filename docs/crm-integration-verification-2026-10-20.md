# CRM safe integration verification — 20 October 2026

## Result

**Integration remains blocked by website credential configuration.** Current source contracts agree; no supported automatic cross-project credential binding or applicable connector was found. No code repair or deployment was justified. No messages were sent, signed-in pages opened, secrets read/copied/rotated, customer records written, forwarding enabled, marketing settings changed, or cron settings changed.

## Fresh evidence

- Website read-only snapshot: `6a41aad0`. Inspected integration/verification documentation and actual scan, receiver transport and held forwarding source. Documentation contains historical references to CRM's obsolete adapter; current CRM source already uses the dedicated scan contract, so those references are not current CRM evidence.
- CRM secret-name listing: `LEADJIG_SHARED_SECRET` exists. `LEADJIG_SERVICE_ROLE_KEY` also exists but is not accepted as scan/receiver authentication. Names do not prove usable values or matching credentials. Scheduler secret storage has one matching named row; no value was selected.
- At **18:15:05 UTC**, existing deployed scheduler logged `Website scan rejected (503)` after scheduler authentication. This is a live failed read, not recovery or an empty healthy queue.
- Direct website read-only scan POST with deliberately invalid shared authentication, `cursor:null,limit:1`: **503**, exact known authentication-unavailable condition and `marketing_paused:true`. Based on inspected handler, authentication configuration is unavailable before settings/data reads. No response person data or credential was printed. This does not independently list website secret metadata or determine whether its secret entry is absent versus unusable/empty.
- CRM receiver GET with deliberately invalid shared authentication: **401**. CRM scheduler POST with invalid cron authentication: **401**.
- Deployed follow-up SMS and birthday SMS POSTs with deliberately invalid authorization and no recipient: **401** each. Deployed follow-up email and birthday email GETs: **405** each. These are safe rejection/reachability checks, **not proof that the live authenticated automatic hold matches source**.
- **183 isolated tests passed in six files**, run at **18:17:40 UTC**: handler guards 78, scan 52, receiver 25, marketing policy 16, inert hook 4, phone matching 8. Provider calls, storage and website reads are mocked; no live message sends or customer writes.
- Latest hosted compilation record: successful at **2026-10-19 01:15:19 UTC**, matching current source commit `519e4307a14ad243f133c3a705c055b5e4fa2789`; diagnostics empty. This is a recorded prior successful compilation, **not a newly executed build today**. No application source changed today.
- Read-only CRM aggregates observed: **558 appointments, 8 activity rows, 22 inbound queue rows, 0 receiver events, 0 suppression rows**. Appointment count differs from prior historical 557; this audit made no writes and did not inspect or attribute the new row. Counts are not row-level immutability evidence, nor a website follow-up queue audit.

## Authentication and safety contracts

### CRM → website read

`crm-readonly-scan` requires HTTPS POST, JSON, and `x-shared-secret`. Website verifies its own `WEBSITE_CRM_SHARED_SECRET`; CRM supplies its existing server-side `LEADJIG_SHARED_SECRET`. No staff JWT, public key, unrelated webhook secret or cross-project service credential substitutes for this header.

Input is `cursor:null,limit:500`, followed by opaque returned cursors. CRM validates `website-crm-read-v1`, a real boolean singleton, held/no-send fields, lead shapes/order and cursor progression; maximum ten pages/5,000 profiled rows/20-second timeout. Errors or incomplete scans fail closed. Pause remains sticky across pages. Scheduler remains read-only with `dry_run:true,sending_enabled:false,sent:0`; an unpaused value still cannot enable sending.

### Website → CRM held receiver

Receiver verifies existing CRM `LEADJIG_SHARED_SECRET` against `x-shared-secret`. Authenticated GET returns `website-events-v1,sending_enabled:false,sent:0` without writes. Event POST requires JSON, stable matching `Idempotency-Key`/`event_idempotency_key`, delivery UUID, strict check-in/unsubscribe schema and at most 16 KiB.

Website sender requires both `delivery_enabled` and `receiver_idempotency_verified` plus dedicated URL/credential before claims/delivery. Its `verify_receiver` action uses GET only and does not set verification flags. Acknowledgments require accepted/duplicate, held/no-send fields and unsubscribe suppression confirmation. CRM persists sticky email suppression atomically; check-ins do not clear consent, create contacts, enroll follow-ups or send messages. Unsubscribe events still held on the website have **not** synchronized suppression into CRM.

### Messaging hold

Current source removes mount-triggered dispatch and retains an inert compatibility hook. All four providers enforce authentication and then reject `auto:true` before dispatch credential reads, recipient lookups, writes, providers or alerts. The unconditional automatic hold is stronger than a pause lookup: automatic requests cannot send with pause true, false, missing or unavailable. Manual paths are preserved; manual email separately rechecks authoritative pause and sticky suppression at the provider boundary. This is not a universal ban on staff-initiated manual SMS.

## Supported no-secret-exposure setup assessment

No supported existing cross-project binding mechanism was found in available platform guidance, CLI or tool interfaces. Cross-project checkout grants read-only source evidence, not database/secret access. Current secret listing is CRM-scoped; website secret names must be verified from the website project's own chat. Available Apify, Drive, Sheets and Twilio connections cannot authenticate this custom website scan/receiver contract. No connection was linked or used.

Do not generate a replacement: generated values cannot be revealed for the other project to receive. Do not retrieve either project's service key, use a debug endpoint, compare secret-derived hashes/prefixes, or rotate the existing shared credential.

## Exact minimum owner action

1. Open **Retirement-Right Website** → **Project Settings → Secrets**.
2. Have that project's chat inspect **names only** for `WEBSITE_CRM_SHARED_SECRET` and `WEBSITE_CRM_RECEIVER_URL`.
3. If missing, add `WEBSITE_CRM_SHARED_SECRET` with the exact existing value corresponding to CRM `LEADJIG_SHARED_SECRET`, obtained from the owner's own secure configuration/password manager. If the name exists, update that existing entry only if needed. **Do not paste its value in chat, replace CRM's value, substitute a service/public key, or rotate anything.** If the existing value is unavailable, stop: this task cannot provision a match without separately authorized credential coordination.
4. Add/verify `WEBSITE_CRM_RECEIVER_URL` using the deployed **receive-website-event** function URL copied from this CRM's **View Backend → Functions**. It must be HTTPS with exact `/functions/v1/receive-website-event` path, no username/password, query or fragment; the CRM browser URL is not the receiver URL. This destination is configuration, not a secret value to recover.
5. Leave marketing paused and both forwarding flags unchanged/held. Do not run retry, replay or send actions.
6. In the website project's own chat, request its write-free `verify_receiver` capability probe using its supported authorized context, plus an authenticated bounded scan with no returned person data in chat. Require real singleton pause evidence and complete bounded pagination; report counts/booleans only. Capability GET verifies authentication/reachability, **not** persistence/idempotency or consent storage.
7. Return here for read-only scheduler recovery verification through existing scheduled logs; do not manually expose the cron credential or activate cron.

## Remaining blockers

- Website matching-credential configuration is currently authentication-unavailable; actual cross-project credential equality is unverified. Website receiver URL metadata is also unverified here.
- Fresh live marketing singleton/forwarding-flag values cannot be read from this project's cross-project snapshot. Prior website report recorded pause true and forwarding held; **today's live settings are not established**. This audit changed none.
- Accepted/duplicate/conflict receiver persistence, sticky suppression and true multi-session races need separately authorized isolated fixtures; no production fixtures or held events were released.
- Deployed guard source parity and real authenticated automatic-held response are not independently verified. Prior deployment report records four guards deployed on October 19, but submitted hashes are not downloaded live-source evidence. Invalid-auth/method probes cannot verify this claim. Available read-only CLI metadata did not expose deployed function source.
- Frontend publication remains withheld. No unsafe signed-in page was opened or requested; old published tabs may still attempt queue claims even if provider holds prevent automatic sends. Do not open old signed-in CRM tabs as a workaround for verification.
- Existing `debug-leadjig-key` source exposes secret-derived information if served. It was **not invoked**, and live presence was not verified. Do not use it for readiness or credential matching; removal/neutralization needs a focused safety repair rather than reading its response.

Only audit documentation/task tracking changed; no production function or application behavior was modified or deployed.
