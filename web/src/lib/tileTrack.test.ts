import { describe, expect, it } from "vitest";
import { applyPredictedMove, Direction, packBoard, unpackBoard } from "./engine";
import { computeTransition, resyncTiles, type TileModel } from "./tileTrack";

let counter = 1;
const nextId = () => counter++;

function toTiles(cells: readonly number[]): TileModel[] {
  return cells.flatMap((exp, index) =>
    exp === 0 ? [] : [{ id: nextId(), exp, index, popKey: 0, spawned: false, spawnDelay: 0 }],
  );
}

function cellsOf(tiles: readonly TileModel[]): number[] {
  const cells = Array.from({ length: 16 }, () => 0);
  for (const tile of tiles) cells[tile.index] = tile.exp;
  return cells;
}

describe("computeTransition", () => {
  it("keeps identity and positions for a simple slide", () => {
    const prevBoard = packBoard([1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const prev = toTiles(unpackBoard(prevBoard));
    const next = applyPredictedMove(prevBoard, Direction.Left, 7n, 0);
    const transition = computeTransition(prev, prevBoard, next.board, Direction.Left, nextId);

    expect(transition).not.toBeNull();
    const [a, b] = prev;
    expect(transition!.tiles).toContainEqual({ ...a, index: 0 });
    expect(transition!.tiles).toContainEqual({ ...b, index: 1 });
    expect(transition!.ghosts).toHaveLength(0);
    expect(transition!.merges).toHaveLength(0);
    expect(cellsOf(transition!.tiles)).toEqual(unpackBoard(next.board));
    // 模拟滑动的两格之外恰好有一块新生成
    expect(transition!.tiles.filter((tile) => tile.spawned)).toHaveLength(1);
  });

  it("resolves merges with survivor, ghost and merge event", () => {
    const prevBoard = packBoard([1, 1, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const prev = toTiles(unpackBoard(prevBoard));
    const next = applyPredictedMove(prevBoard, Direction.Right, 9n, 1);
    const transition = computeTransition(prev, prevBoard, next.board, Direction.Right, nextId);

    expect(transition).not.toBeNull();
    expect(transition!.merges.map((merge) => merge.value).sort((a, b) => a - b)).toEqual([4, 8]);
    expect(transition!.ghosts).toHaveLength(2);
    // 合并产物：靠右的瓦片延续 id，指数 +1
    const survivor = transition!.tiles.find((tile) => !tile.spawned && tile.exp === 3);
    expect(survivor?.index).toBe(3);
    expect(survivor?.popKey).toBe(1);
    expect(cellsOf(transition!.tiles)).toEqual(unpackBoard(next.board));
  });

  it("tracks vertical moves", () => {
    const prevBoard = packBoard([1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]);
    const prev = toTiles(unpackBoard(prevBoard));
    const next = applyPredictedMove(prevBoard, Direction.Up, 5n, 2);
    const transition = computeTransition(prev, prevBoard, next.board, Direction.Up, nextId);

    expect(transition).not.toBeNull();
    expect(transition!.merges.map((merge) => merge.value)).toEqual([4]);
    expect(cellsOf(transition!.tiles)).toEqual(unpackBoard(next.board));
  });

  it("keeps a full merge chain stable across repeated moves", () => {
    let board = packBoard([1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    let tiles = toTiles(unpackBoard(board));
    for (let moveCount = 0; moveCount < 12; moveCount += 1) {
      const direction = moveCount % 2 === 0 ? Direction.Left : Direction.Up;
      const next = applyPredictedMove(board, direction, 11n, moveCount);
      if (!next.moved) continue;
      const transition = computeTransition(tiles, board, next.board, direction, nextId);
      expect(transition).not.toBeNull();
      expect(cellsOf(transition!.tiles)).toEqual(unpackBoard(next.board));
      board = next.board;
      tiles = transition!.tiles;
    }
  });

  it("returns null when the direction cannot explain the change", () => {
    const prevBoard = packBoard([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const prev = toTiles(unpackBoard(prevBoard));
    const unrelated = packBoard([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(computeTransition(prev, prevBoard, unrelated, Direction.Left, nextId)).toBeNull();
  });
});

describe("resyncTiles", () => {
  it("matches identical tiles in place and spawns the rest", () => {
    const prevBoard = packBoard([1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const prev = toTiles(unpackBoard(prevBoard));
    const nextBoard = packBoard([1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0]);
    const { tiles, ghosts, merges } = resyncTiles(prev, nextBoard, nextId, false);

    expect(ghosts).toHaveLength(0);
    expect(merges).toHaveLength(0);
    expect(cellsOf(tiles)).toEqual(unpackBoard(nextBoard));
    expect(tiles.find((tile) => tile.index === 0)?.id).toBe(prev[0].id);
    expect(tiles.find((tile) => tile.index === 3)?.id).toBe(prev[1].id);
    expect(tiles.find((tile) => tile.index === 14)?.spawned).toBe(true);
  });

  it("drops tiles that no longer exist", () => {
    const prevBoard = packBoard([1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const prev = toTiles(unpackBoard(prevBoard));
    const nextBoard = packBoard([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const { tiles } = resyncTiles(prev, nextBoard, nextId, false);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].id).toBe(prev[0].id);
  });
});
