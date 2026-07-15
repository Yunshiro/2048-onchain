import { describe, expect, it } from "vitest";
import { forgetSessionAccount, getOrCreateSessionAccount } from "./session";

describe("in-memory session accounts", () => {
  it("isolates sessions by login wallet and never requires browser storage", () => {
    const ownerA = "0x0000000000000000000000000000000000000001";
    const ownerB = "0x0000000000000000000000000000000000000002";
    const firstA = getOrCreateSessionAccount(ownerA);
    const secondA = getOrCreateSessionAccount(ownerA.toUpperCase());
    const firstB = getOrCreateSessionAccount(ownerB);

    expect(secondA.address).toBe(firstA.address);
    expect(firstB.address).not.toBe(firstA.address);

    forgetSessionAccount(ownerA);
    expect(getOrCreateSessionAccount(ownerA).address).not.toBe(firstA.address);
  });
});
