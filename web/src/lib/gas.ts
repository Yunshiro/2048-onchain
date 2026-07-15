export const MOVE_GAS_FLOOR = 400_000n;

export function addMoveGasSafetyMargin(estimate: bigint): bigint {
  const buffered = (estimate * 140n) / 100n + 20_000n;
  return buffered > MOVE_GAS_FLOOR ? buffered : MOVE_GAS_FLOOR;
}
