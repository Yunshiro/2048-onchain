import { describe, expect, it } from "vitest";
import { applyMove, applyPredictedMove, Direction, packBoard, slideRowLeft, unpackBoard } from "./engine";

describe("slideRowLeft", () => {
  it.each([
    [[1, 1, 1, 1], [2, 2, 0, 0], 8],
    [[1, 1, 2, 0], [2, 2, 0, 0], 4],
    [[2, 1, 1, 0], [2, 2, 0, 0], 4],
    [[1, 0, 0, 1], [2, 0, 0, 0], 4],
    [[1, 2, 1, 2], [1, 2, 1, 2], 0],
    [[15, 15, 0, 0], [15, 15, 0, 0], 0],
  ])("slides %j", (input, expected, score) => {
    expect(slideRowLeft(input)).toEqual({ row: expected, gained: score });
  });
});

describe("applyMove", () => {
  const horizontal = packBoard([1, 0, 1, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  it("moves left", () => {
    const result = applyMove(horizontal, Direction.Left);
    expect(unpackBoard(result.board)).toEqual([2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.gained).toBe(12);
  });

  it("moves right", () => {
    const result = applyMove(horizontal, Direction.Right);
    expect(unpackBoard(result.board)).toEqual([0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.gained).toBe(12);
  });

  it("moves vertically", () => {
    const vertical = packBoard([1, 2, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(unpackBoard(applyMove(vertical, Direction.Up).board)).toEqual([2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(unpackBoard(applyMove(vertical, Direction.Down).board)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0]);
  });

  it("adds one deterministic visual tile for optimistic input", () => {
    const first = applyPredictedMove(horizontal, Direction.Left, 77n, 0);
    const second = applyPredictedMove(horizontal, Direction.Left, 77n, 0);
    expect(first).toEqual(second);
    expect(first.gained).toBe(12);
    expect(unpackBoard(first.board).filter(Boolean)).toHaveLength(3);
  });
});
