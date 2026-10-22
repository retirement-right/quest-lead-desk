# Six critical security findings and owner admin proof (read-only check, Oct 22 20:16 UTC)

Nothing was changed. I read only the access rules themselves, not any customer data or credentials.

## What the six findings are

| # | Records | What the rule allows | Real issue? |
|---|---|---|---|
| 1 | Birthday message history | Any signed-in account can read all of it | Real, but narrow (see below) |
| 2 | Client documents list | Any signed-in account can read, add and delete entries | Real, but narrow |
| 3 | Client document files | Any signed-in account can download, upload and delete files | Real, but narrow |
| 4 | BookedIN appointments (includes phone numbers) | Any signed-in account can read all of it | Real, but narrow |
| 5 | Contact activity history | Any signed-in account can read it and add entries | Real, but narrow |
| 6 | Unmatched incoming texts | Any signed-in account can read and change them | Real, but narrow |

**Why "narrow":** all six rules really exist live. But they only apply to accounts signed in to the CRM's own backend. You and your staff sign in through the website's login, which never gets you into those rules. The CRM pages reach these records through its own protected functions instead. The CRM's backend has 2 accounts of its own, and I haven't checked who they are. Whether outsiders can create new accounts there is also unverified. So these are real open doors, but only a few people could reach them today. They are more than a scanner warning.

**The bigger real gap (not in the six):** those protected functions check only that someone is signed in on the website. Any website registrant could pass that check. The admin-only check that fixes this is built and tested, but it isn't switched on.

## Smallest action to prove your admin access

In the **Retirement-Right Website** chat, paste:
"Read-only: confirm michaeleberhardt01@gmail.com has the admin role, and that a signed-in user can read their own role. Change nothing."

## Recommended order of fixes (after that confirmation)

1. Switch on the admin-only check in every CRM function. Deploy it, then confirm your account gets in and a regular account is refused.
2. Close the six open rules so only the CRM's protected functions can reach these records. Do it after step 1, because the CRM pages already go through those functions and nothing you use would break.
3. Run a new security scan and confirm the six findings are gone.
4. Separately, check who owns the 2 CRM backend accounts and whether outsiders can sign up.

## Tested vs proven live

- **Tested only:** the admin-only check, with 10 tests passing. The full test suite also passes, 229 of 229.
- **Proven live:** the six open rules exist, and they are unchanged since Oct 19.
- **Not proven:** your admin role, and any signed-in check from start to finish.
- **Unchanged:** forwarding is still held, marketing is still paused, and nothing was sent.
