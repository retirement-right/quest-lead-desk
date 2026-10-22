## Answer (read-only, nothing changed)

### What I confirmed in the code
- **The live CRM login uses the Retirement Right website's login system, not a separate CRM one.** The CRM sign-in page checks the email and password against the website's account list.
- **The CRM has never had its own admin accounts, admin role or onboarding.** The CRM code has no admin role or role check, no account-creation screen and no invite step. Its login page offers only sign-in and "Forgot password".
- **Who can get in today:** any account that has a working Retirement Right website login. There is no extra CRM permission step. Your website admin account doesn't need to be "added" to the CRM.
- **So the new website password should work in the CRM**, as long as you use the exact same email you reset on the website.
- **Why Apple Passwords doesn't offer it:** Apple saves passwords per website address. You saved the new password for retirement-right.com, and the CRM lives at quest-lead-desk.lovable.app, so Apple won't suggest it there. You have to type it or copy it in.

### What I could not check without your session
- Whether your account exists in the website's login list and is working. That list belongs to the Website project, and this chat can't read its accounts.
- What error, if any, you actually get on the CRM.

### Most likely cause of the failed sign-in
Apple filled in an old CRM password or a different email, or the new password was mistyped. The CRM needs no account setup, so a missing account is unlikely if the website admin login works.

### One simple test (tells a wrong password apart from a missing account)
1. Open https://www.retirement-right.com/admin/login and sign in with the new password. If that fails, the password is the problem and it has nothing to do with the CRM.
2. If it works, open https://quest-lead-desk.lovable.app/login in the same browser. Type (don't autofill) the exact same email and the new password.
3. If the CRM shows "Invalid login credentials", tell me the exact message and I'll check the Website login settings, still read-only. If it works, you'll land on the Contacts page.
4. Optional: in Apple Passwords, add or edit the entry for quest-lead-desk.lovable.app with the new password.

### Notes
- I'm in read-only plan mode, so I didn't add this request to the task list. I'll add it once changes are allowed.
- Known gap that's still open: the CRM lets in any website account, not only admins. Nothing about that changes here.
