# CRM documented website scan adapter — 2026-10-18

## Contract inspected

Read-only website snapshot `e24be882`: `docs/website-crm-integration.md`, `docs/website-crm-verification-2026-10-18.md`, and actual `crm-readonly-scan` handler/entrypoint. The website implements a write-free, dedicated shared-secret POST returning minimal due leads, authoritative marketing settings and opaque continuation cursors. Its verification report explicitly states the dedicated website credential is not configured.

## CRM changes and safety

Only scheduler read behavior changed. `process-followups` now uses existing server `LEADJIG_SHARED_SECRET` for `x-shared-secret`, not `LEADJIG_SERVICE_ROLE_KEY` REST authentication. Staff-session email gates and recipient suppression boundaries remain unchanged. No secret values were read from snapshots, displayed, copied between projects or changed.

The adapter requests `{cursor:null,limit:500}`, follows opaque cursors even on empty due-lead pages, and caps inspection at ten pages / 5,000 profiled rows and a 20-second read timeout. It validates contract, held/no-send fields, singleton types, page sizes, lead structure, ordering and cursor progression. Incomplete, unauthorized, unavailable or malformed reads throw; scheduler responds 503 with `marketing_paused:true`, `scan_complete:false`, `dry_run:true`, `sending_enabled:false`, `sent:0`. A reliably paused scan can complete as a successful **inspection**, never permission to send. A pause observed on any page stays sticky for that inspection.

Successful `scanned` counts profiled rows inspected by the website; `due` counts eligible returned observations. `suppressed_email` here counts website pause / do-not-email observations only, not a complete CRM sticky-suppression reconciliation. Existing provider boundaries still independently enforce sticky suppression. Pages are not a database snapshot and concurrent website edits can affect completeness; no dispatch authorization is inferred.

No send, provider, notification, claim or record-update code was added. No browser publication, cron changes, marketing enablement or held-event release occurred.

## Non-sending evidence

- Before deployment: existing authenticated scheduler returned 503; live log at 22:15:04 UTC recorded obsolete website REST 401. Cron job 2 was active with `*/15 * * * *`.
- Direct website POST with privately supplied existing CRM credential and `limit:1`: 503; checked only the boolean equality of its error to `CRM authentication unavailable`. No person data, credential, URL or upstream body was printed.
- First scheduler deployment was accepted at approximately 22:17 UTC. Authenticated scheduler probe returned 503 with new `Website scan rejected (503)` and explicit paused/incomplete/held fields. Invalid cron credential returned 401 before scanning.
- All CRM tests: **138 passed across seven files**, 22:17:55 UTC. New scan suite: 52 mocked tests; handler suite: 32 including preserved email tests and scheduler body/auth/error tests. These test providers/writes only as mocks.
- A compiler narrowing diagnostic in continuation-cursor handling was corrected after the first deployment; final deployment/check evidence follows below.

## Remaining blocker and exact secure UI steps

The CRM obsolete 401 adapter is replaced, but successful live recovery is **not verified**: the deployed website returns authentication-unavailable 503 before authoritative settings/data reads. This is configuration missing on the website, not authorization to weaken authentication.

1. Open **Retirement-Right Website** in Lovable.
2. Open **Project Settings → Secrets → Add secret**.
3. Name it **`WEBSITE_CRM_SHARED_SECRET`** and enter the exact existing value corresponding to CRM **`LEADJIG_SHARED_SECRET`** from the owner's own secure configuration/password manager. Never paste it in chat. Do not substitute the service key, public key or unrelated webhook secret, and do not change the CRM credential.
4. Save. If the name already exists, update that existing entry instead of adding a duplicate. Keep marketing paused and forwarding flags unchanged.
5. Return to this CRM chat and request a non-sending read-only verification. Successful recovery must return `website-crm-read-v1`, a real boolean singleton, completed pagination, and held/no-send fields through the authenticated scheduler.

If the matching existing value is not available in the owner's secure records, stop and coordinate authorized credential provisioning in the website project; this repair neither guesses nor rotates it. `WEBSITE_CRM_RECEIVER_URL` is additionally needed for website forwarding capability checks, but is not needed by this scheduler read. Forwarding and event persistence verification remain separate, held work.