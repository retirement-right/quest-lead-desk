/** Normalize a CRM or incoming US phone number for last-ten-digit matching. */
export const phoneTail = (raw: string | null | undefined): string | null => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
};

const RAW_PHONE_KEYS = [
  "phone", "phone_number", "phoneNumber", "mobile", "mobile_phone",
  "cell", "cell_phone", "home_phone", "primary_phone", "telephone",
];

/** Main phone column plus known raw-payload fallbacks, without duplicates. */
export const leadPhoneTails = (lead: {
  phone?: string | null;
  raw_payload?: Record<string, unknown> | null;
} | null | undefined): string[] => {
  const tails = new Set<string>();
  const main = phoneTail(lead?.phone);
  if (main) tails.add(main);
  const rp = lead?.raw_payload ?? {};
  for (const key of RAW_PHONE_KEYS) {
    const t = phoneTail(rp[key] as string | null | undefined);
    if (t) tails.add(t);
  }
  return [...tails];
};