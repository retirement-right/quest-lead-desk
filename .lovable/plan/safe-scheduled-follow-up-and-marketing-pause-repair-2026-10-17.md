# Safe scheduled follow-up and marketing pause repair

## Changes
- Replace the scheduler's missing website proxy dependency with a direct, authenticated website lead adapter using existing credentials only. Credential rejection remains fail-closed; no staff session is invented for cron.
- Keep the repaired scheduler in dry-run mode by default, so the existing cron request cannot release overdue messages. Require explicit future authorization before enabling sending.
- Check the authoritative website `email_marketing_settings` singleton (`id = true`) before CRM follow-up and birthday marketing emails. Only literal `marketing_paused = false` permits sending; missing settings, denied access, timeouts, or malformed responses block sending.
- Keep paused browser follow-ups pending without claiming them or recording a successful send. Preserve SMS behavior outside the repaired scheduler, appointment notifications, records, secrets, and existing cron configuration.
- Add mock tests for pause/error handling, scheduler dry-run, authenticated reads, and duplicate-prevention behavior; run the existing tests too.

## Technical details
- Shared server-side modules own pause reads and scheduler orchestration, with injectable dependencies for non-sending tests.
- Marketing handlers return a backwards-compatible `success: false`, `paused: true` result on suppression; no failure alert SMS is generated for a pause.
- Direct scheduler access uses the existing website service credential; its known invalidity is a runtime blocker, not a reason to weaken authentication or copy another project's credentials.

## Verification and blockers
- No live sends, deployment, publication, cron activation, record changes, or secret changes.
- The live 404 will persist until separately authorized deployment. Website credential/read permissions and the live global pause value need authorized non-sending validation; any unavailable read blocks marketing.
- Changes to the website itself must be performed from its own project chat if permissions or credentials prevent authoritative access.