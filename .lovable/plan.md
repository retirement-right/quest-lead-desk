# CRM progress report (read-only) — Oct 22, 2026

Nothing is changed or sent by this report. Approving it just closes the report. It does not start any work.

## CRM security
- Six critical access findings are still open: birthday history, lead-document records and files, BookedIN appointments, contact activity, and unmatched SMS. The rules are live and unchanged since Oct 19. They only reach accounts on the CRM's own backend, not website-login staff.
- Bigger gap: the CRM's server functions check that someone is signed in to the website. They don't check that the person is staff, so any website account could get through.
- The admin-only gate is built and passes its tests. It is not connected or live yet. It is waiting for confirmation, from the Website chat, of which account is yours and that it has the admin role.

## SMS safety fix
- Automatic SMS and the automatic admin alerts are held at the sending step. Opening a page no longer sends anything (the old trigger was removed). Manual SMS still works.
- Follow-up emails, birthday emails, drip emails and newsletters are held, as you decided.
- This was deployed to the four messaging functions. With no signed-in session, all I could confirm live is that requests with bad credentials are refused.

## Authentication tests
- 233 practice tests passed. Nothing in them reaches the internet or sends messages. They include 28 sign-in plus SMS hold tests and 10 admin-gate tests.
- The emailed password reset now goes to the Retirement Right website's reset page. That fix is published and the live site has it.
- Not checked: the full emailed reset, done by you, and the hold during a real signed-in session.

## Forwarding status
- The CRM's website-event receiver is live, needs a password-style key, and has sending switched off. It returned "OK" to a keyed check.
- The CRM's read of website contacts works: 2,908 contacts read, 0 due, 0 sent, marketing paused.
- Website-to-CRM forwarding is still held. Whether the receiver address saved on the website is correct can't be confirmed from the CRM.

## What's confirmed live
- The CRM site (quest-lead-desk.lovable.app) shows the reset help text and the website reset link.
- The retired test page returns "gone".
- Not confirmed live: the hold during a signed-in session, owner admin access, and the Website's own message settings.

## Open items, each waiting on you or the Website project
1. Confirm in the Website chat that your account has the admin role. Then connect the gate, close the six findings and rescan.
2. Sign in to the CRM once by typing the website password by hand, so the signed-in checks can run.
3. Check the receiver address saved in the Website project.
4. The November Facebook campaign is a separate project and hasn't been touched.
