import { describe, expect, it } from "vitest";
import { leadPhoneTails, phoneTail } from "./phoneMatching";

describe("existing inbound phone matching rules", () => {
  it.each([
    "(480) 221-4264", "480-221-4264", "4802214264",
    "+1 480 221 4264", "+14802214264",
  ])("matches %s to the same last ten digits", (phone) => {
    expect(phoneTail(phone)).toBe("4802214264");
  });

  it("uses a raw-payload phone when the main column is empty", () => {
    expect(leadPhoneTails({ phone: "", raw_payload: { phone_number: "(480) 221-4264" } }))
      .toEqual(["4802214264"]);
  });

  it("does not match missing or incomplete phone numbers", () => {
    expect(phoneTail(null)).toBeNull();
    expect(phoneTail("221-4264")).toBeNull();
    expect(leadPhoneTails(undefined)).toEqual([]);
  });

  it("deduplicates equivalent main and fallback numbers", () => {
    expect(leadPhoneTails({ phone: "+14802214264", raw_payload: { mobile: "480-221-4264" } }))
      .toEqual(["4802214264"]);
  });
});