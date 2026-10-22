# Fix: CRM password reset lands on retirement-right.com

## What the read-only trace proved (Oct 22, 21:20 UTC)

Nothing was changed, no reset email was sent, and no settings were touched. The checks used a deliberately invalid test link, so the login service had nothing to act on.

1. **The CRM signs in through the Website's login service, not its own.** The live CRM code (checked in the published bundle) sends sign-in and "Forgot password?" to the Website's account system. The CRM's own backend handles data only. So the CRM password and the Website admin password are the same account.
2. **Opening the CRM login page does not redirect.** `https://quest-lead-desk.lovable.app/login` and `/reset-password` both load directly (HTTP 200). The code has no redirect to the website.
3. **Clicking "Forgot password?" does not redirect either.** It only asks for an email to be sent, and it asks for the link to return to `https://quest-lead-desk.lovable.app/reset-password`.
4. **The emailed link is the step that sends you to the website (proven).** I tested the login service's link handling with fake links pointing at different return addresses:

```text
Return address requested                                  Where the login service sent it
www.retirement-right.com/reset-password                   accepted (stays there)
www.retirement-right.com/admin/reset-password             accepted (stays there)
site-replicator-buddy-79.lovable.app/reset-password       accepted (stays there)
quest-lead-desk.lovable.app/reset-password  (the CRM)     REJECTED -> site-replicator-buddy-79.lovable.app/
CRM preview address                                       REJECTED -> site-replicator-buddy-79.lovable.app/
made-up unknown site                                      REJECTED -> site-replicator-buddy-79.lovable.app/
```

   The CRM address is treated the same as an unknown site. The service falls back to the Website's default address, and that address then forwards to `retirement-right.com` (HTTP 302). That is the redirect you keep seeing.

5. **Why adding the CRM address on the Website side may not have stuck (likely, not proven).** Lovable keeps each project's list of allowed addresses in sync. It removes `*.lovable.app` addresses that belong to other projects. So an entry like `https://quest-lead-desk.lovable.app/**` in the Website's list may be removed again. I could not read the Website's live list from here.

## Step you can take today (no changes needed)

The Website already has a working reset page for the same account:

1. Go to `https://www.retirement-right.com/admin/login`, enter your email and click its "Forgot password".
2. Open the newest email and click the link. It lands on the Website's "set new password" page, which is an allowed address. Choose a new password there.
3. Go to `https://quest-lead-desk.lovable.app/login` and sign in with that new password.

Use only the newest email. Older links have expired or point to the rejected CRM address.

## What I will change in the CRM (after you approve)

A small, safe change to the CRM sign-in page only:

- "Forgot password?" will ask for the link to return to the Website's allowed reset page (`https://www.retirement-right.com/admin/reset-password`), not the rejected CRM address. The emailed link will then always open a page where you can set the password.
- A short note under the button: "You'll set your new password on the Retirement Right site, then come back here to sign in," with a link back to the CRM login.
- If someone lands on the CRM reset page with an expired or invalid link, show "This link expired — request a new one" with a button back to sign in. Today the page just stays disabled.
- One small test checks that the reset request uses the Website's allowed return address.

Not touched: auth settings, the Website project, emails, marketing, messaging, data, and publishing. You can publish when you're ready.

## Permanent fix (optional, owner action)

To have reset links return straight to the CRM:
1. Give the CRM its own domain, for example `crm.retirement-right.com` (CRM project → Settings → Domains).
2. In the **Website** project's chat, ask to add `https://crm.retirement-right.com/**` to the Redirect URLs under Auth settings → Advanced, with **Live** selected. Leave the Site URL unchanged.

A custom domain is not removed by Lovable's sync, unlike a `lovable.app` address. After that, the CRM can switch back to returning to its own reset page.

## Technical details

- CRM auth client: `src/lib/supabase.ts` points to the Website auth project, and `useAuth`/`Login`/`ResetPassword` use it. The CRM's own Cloud client is in the bundle for data and functions only.
- Probe: `GET /auth/v1/verify?token=invalid&type=recovery&redirect_to=<X>` returns 303. The `Location` echoes `<X>` only when `<X>` is allowlisted; otherwise it is the Site URL. Results are in the table above.
- Website `adminSupabase` uses the same auth project, and `/admin/reset-password` handles `PASSWORD_RECOVERY` and then `updateUser({ password })`.
- Planned edits: `src/pages/Login.tsx` (redirectTo constant and note), `src/pages/ResetPassword.tsx` (parse `#error=` hash and show an expired-link message), and one test in `src/lib`.
