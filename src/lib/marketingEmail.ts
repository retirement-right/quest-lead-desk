import { marketingEmailAllowed } from "../../supabase/functions/_shared/marketing-policy";
import { WEBSITE_PUBLISHABLE_KEY } from "../../supabase/functions/_shared/website-rest";

// UI-side preflight avoids changing a pending follow-up while marketing is paused.
// The sending functions still enforce the same rule independently.
export function canSendMarketingEmail(staffJwt: string): Promise<boolean> {
  return marketingEmailAllowed({ apiKey: WEBSITE_PUBLISHABLE_KEY, token: staffJwt });
}