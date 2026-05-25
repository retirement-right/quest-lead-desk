# Admin lead data repairs (manual only)

The Contacts page **no longer** runs any of the repairs below on load. Use this document and one-off SQL or a service-role script when cleanup is needed.

**Table:** `leadjig_leads` on the LeadJig Supabase project (`uoneplysuvmaygbrbswd`).

Run repairs in a maintenance window. Preview with `SELECT` before `UPDATE`/`DELETE`. Migrate related rows (`contact_activity`, `lead_documents`) before deleting duplicates.

---

## 1. Attended leads → `hot_lead`

**When:** Lead is attended (check-in) but `lifecycle_stage` is not `hot_lead`.

**Preview:**

```sql
-- Adjust attended detection to match your canonical field when available
SELECT id, name, email, lifecycle_stage
FROM leadjig_leads
WHERE lifecycle_stage IS DISTINCT FROM 'hot_lead'
  AND (
    attended_status ILIKE '%attend%'
    OR (raw_payload->>'attended') IN ('true', 'yes', '1')
    OR (client_profile->>'checked_in') IN ('true', 'yes', '1')
  );
```

**Fix:** `UPDATE leadjig_leads SET lifecycle_stage = 'hot_lead' WHERE id IN (...);`

Previously: auto-ran in `Contacts.tsx` via `isAttendedLead()`.

---

## 2. Phantom `appointment_at`

**When:** `appointment_at` is set but stage is not `consultation_booked` or `appointment_set` (and lead is not treated as attended hot lead).

**Fix:** `UPDATE leadjig_leads SET appointment_at = NULL WHERE id IN (...);`

---

## 3. Guest / shared-email BookedIN promotion

**When:** `is_guest = true` (or known false positives) has `consultation_booked` / `appointment_set` without real attendance — often from BookedIN proxy matching shared email with primary attendee.

**Fix:** `UPDATE leadjig_leads SET lifecycle_stage = 'new', appointment_at = NULL WHERE id IN (...);`

**Root fix:** Update `leadjig-update-from-bookedin` to skip guests.

---

## 4. Shari Newstead appointment

**When:** Email in `sharinewstead@gmail.com`, `sharinenewstead@gmail.com` and appointment should be BookedIN May 26 2026 10:00 AM MST.

**Fix:** `UPDATE leadjig_leads SET appointment_at = '2026-05-26T17:00:00.000Z', lifecycle_stage = 'consultation_booked' WHERE ...;`

---

## 5. Queen Creek seminar `event_date`

**When:** `event_date` date portion is `2026-05-15` but event was `2026-05-16`.

**Fix:** Replace date portion in `event_date` string, preserving time.

---

## 6. John Hooper guest reset

**When:** Name matches John Hooper, guest without real appointment.

**Fix:** `UPDATE leadjig_leads SET lifecycle_stage = 'new', appointment_at = NULL WHERE ...;`

---

## 7. Merge duplicates (Cathy Leon, Shari Newstead)

**When:** Multiple rows for same person.

**Strategy:** Keep one row (prefer row with `appointment_at`, else oldest `created_at`). Delete others after re-pointing FKs. Apply Shari appointment update on keeper if needed.

**Do not** run merges from the CRM UI.

---

## 8. UI email dedup (display only — removed)

Contacts previously hid duplicate emails in the list (newest per email). That was display-only but masked duplicates. The UI now shows **all** rows returned from the database.

---

## ContactDetail.tsx

Contact detail load is **read-only** (fetch + display). Repairs are not run when opening a single contact.
