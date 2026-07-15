import { describe, expect, it } from "vitest";
import { addMoveGasSafetyMargin, MOVE_GAS_FLOOR } from "./gas";

describe("move gas safety margin", () => {
  it("raises the failed on-chain estimate to the minimum", () => {
    expect(addMoveGasSafetyMargin(163_319n)).toBe(MOVE_GAS_FLOOR);
  });

  it("adds a proportional margin above the minimum", () => {
    expect(addMoveGasSafetyMargin(400_000n)).toBe(580_000n);
  });
});
