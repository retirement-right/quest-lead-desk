# Staff access and isolated SMS verification — 2026-10-21

## Authorization and evidence

No migration, deployment, customer write, credential change, message, authenticated page load, forwarding change or marketing-setting change was performed.

**Production metadata read:** Cloud has eight public tables, all with RLS enabled; no public role/profile/staff tables were found. Cloud has two auth users (count only; identities were not inspected). Existing authenticated policies permit all-row access to activity, appointments, birthday history and documents, and all-row update access to unmatched SMS. Storage policies permit authenticated users to read/upload/delete in the documents bucket. Effective privileges on six legacy tables also include anonymous CRUD, though RLS denies anonymous row access. The event inbox and suppressions are service-only. Internal secrets have no row policies, so normal users are denied despite excess grants. Effective privileges were checked with `has_table_privilege`; an empty information-schema grants result is not evidence of absent grants.

**CRM source:** `src/lib/supabase.ts` uses website authentication; `RequireAuth` checks only session presence. `requireStaffAuth` validates the website token with `auth.getUser`, but does not establish staff membership. Cloud bridge handlers then use privileged clients, bypassing RLS. Narrowing policies alone cannot fix those handlers.

**Website source snapshot only:** commit `4065947d` defines separate `user_roles` with `admin`, `moderator`, `user`; protected role writes and an own-role read policy appear in migrations. Its admin helper checks admin/moderator after validating identity. These are not live role assignments or live grants, and neither owner identity nor an owner role is established by the snapshot. No website schema or account was changed.

## Proposed least-privilege approach — NOT applied

1. Keep website login and its protected role table authoritative. Do not equate Cloud auth UUIDs with website auth UUIDs, copy roles into profiles, trust browser storage, or treat shared integration credentials as staff credentials.
2. After website token validation, read the verified user's role through their website session, enforce an owner-approved staff rule and fail closed on missing/unavailable roles. Apply that authorization to every privileged bridge and all alternate admin handlers. Ordinary website registrants must receive 403, not CRM service access. Admin-only bulk repairs must require admin separately.
3. Confirm the owner's exact existing website identity and role with an authorized read-only role check before any enforcement. No guessed UUID, email-based privilege assignment or signup auto-promotion. If the owner has no authorized role, stop; a separate explicit role assignment is required in the website project.
4. Inventory every direct Cloud and storage browser call. First migrate any required operation to a role-checked bridge without reducing owner functionality. Owner/staff read-only checks must pass before tightening policies. Test writes only with isolated fixtures, never customer records under this authorization.
5. Then remove direct anon/authenticated privileges from the six legacy CRM tables; keep the established server service access. Lock down the document bucket's broad browser policies without affecting other buckets. Preserve existing customer rows, service-only receiver/suppression policies, cron and secrets.

### Conditional migration draft — DO NOT execute

This SQL is a review draft in documentation, intentionally outside the migration directory. It is unsafe to apply until steps 2–4 are verified. No new role table or profile is needed with the recommended website-role model.

```sql
REVOKE ALL PRIVILEGES ON TABLE
  public.birthday_outreach_log,
  public.bookedin_appointments,
  public.contact_activity,
  public.inbound_sms_unmatched,
  public.lead_documents,
  public.internal_secrets
FROM anon, authenticated;

-- Exact existing bucket-specific policy names from the live metadata read.
-- Deny direct browser access only AFTER role-checked document bridges are verified.
ALTER POLICY "Authenticated can read lead documents"
  ON storage.objects USING (false);
ALTER POLICY "Authenticated can upload lead documents"
  ON storage.objects WITH CHECK (false);
ALTER POLICY "Authenticated can delete lead documents"
  ON storage.objects USING (false);
```

Existing Cloud authenticated all-row table policies can subsequently be retired in a reviewed migration; the privilege revocation above blocks that direct path. Do not revoke storage schema-wide grants or change unrelated buckets. Existing service privileges remain unchanged. Additional roles/inherited grants and all sibling policies must be rechecked immediately before application. Prepare a reviewed rollback restoring only necessary prior owner access before enforcement; do not deploy and hope the owner still works.

## Isolated authenticated SMS verification

Added `src/lib/authenticatedSmsGuard.test.ts`. The harness executes the actual `requireStaffAuth`, automatic-dispatch guard and both SMS handlers in an isolated context; only the identity service response is simulated. It does not mock the authorization helper into unconditional success. No real token or credential is used. All fetches, storage/database operations, alerts and dispatch-time credential reads throw if reached.

28 tests confirm automatic requests are held after successful simulated identity validation, including claimed paused/unpaused/missing/unavailable states and force/enable overrides; invalid/missing identity is rejected; malformed automatic flags are rejected; no dispatch-time credentials, second SDK client, recipient query, alerts, writes or providers are reached. The guard is an unconditional automatic hold, not a live pause lookup. This proves source behavior for a validated simulated identity, not authorized staff-role separation or production code parity.

Targeted run: **215 passing tests across 8 files**, including existing email-policy, page-load, diagnostic retirement, receiver and bounded scan regressions. No production endpoint was probed in this task, and no authenticated interface was opened. Production automatic-hold behavior remains unverified after valid real authentication; isolated tests cannot resolve that blocker. No verification POST to a messaging endpoint is included: if deployed code were stale it could send before returning.

## Exact owner decision needed

Recommended initial policy: **only Michael's verified existing website admin account may access CRM; ordinary website accounts and moderators are denied**. Owner must approve that rule or name each additional CRM staff account and its permitted actions (read-only, activity/document changes, manual messaging, bulk administrative repairs). Also confirm which website account is the owner account; its UUID and role must be verified privately, not guessed. Approval to design staff access is not permission to assign roles, apply this draft or enable messaging.

After that decision, request a separate staged implementation preserving the confirmed owner role, with a read-only owner/non-staff verification before any direct-access revocation. If moderators are meant to be CRM staff, decide whether all website moderators qualify or only an explicitly approved subset. A subset needs a separate protected CRM membership model; do not automatically grant every website moderator customer-data access.

Remaining blockers: owner/staff access policy and confirmed website role; live website role schema/grants; complete direct-call/bridge inventory and action authorization; safe production source parity and real authenticated guard verification. No marketing or forwarding authorization is implied.