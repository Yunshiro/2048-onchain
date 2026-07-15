import { encodeAbiParameters, keccak256 } from "viem";

export enum Direction {
  Up,
  Down,
  Left,
  Right,
}

export type MoveResult = {
  board: bigint;
  gained: number;
  moved: boolean;
};

export function getCell(board: bigint, index: number): number {
  return Number((board >> BigInt(index * 4)) & 0xfn);
}

export function setCell(board: bigint, index: number, value: number): bigint {
  const shift = BigInt(index * 4);
  const mask = 0xfn << shift;
  return (board & ~mask) | (BigInt(value & 0xf) << shift);
}

export function unpackBoard(board: bigint): number[] {
  return Array.from({ length: 16 }, (_, index) => getCell(board, index));
}

export function packBoard(cells: readonly number[]): bigint {
  return cells.reduce((board, value, index) => setCell(board, index, value), 0n);
}

export function slideRowLeft(input: readonly number[]): { row: number[]; gained: number } {
  const compact = input.filter((value) => value !== 0);
  const row: number[] = [];
  let gained = 0;

  for (let index = 0; index < compact.length; index += 1) {
    const value = compact[index];
    if (index + 1 < compact.length && value === compact[index + 1] && value < 15) {
      const merged = value + 1;
      row.push(merged);
      gained += 2 ** merged;
      index += 1;
    } else {
      row.push(value);
    }
  }

  while (row.length < 4) row.push(0);
  return { row, gained };
}

function cellIndex(direction: Direction, line: number, offset: number): number {
  if (direction === Direction.Left) return line * 4 + offset;
  if (direction === Direction.Right) return line * 4 + (3 - offset);
  if (direction === Direction.Up) return offset * 4 + line;
  return (3 - offset) * 4 + line;
}

export function applyMove(board: bigint, direction: Direction): MoveResult {
  let nextBoard = 0n;
  let gained = 0;

  for (let line = 0; line < 4; line += 1) {
    const input = Array.from({ length: 4 }, (_, offset) => getCell(board, cellIndex(direction, line, offset)));
    const result = slideRowLeft(input);
    gained += result.gained;
    result.row.forEach((value, offset) => {
      nextBoard = setCell(nextBoard, cellIndex(direction, line, offset), value);
    });
  }

  return { board: nextBoard, gained, moved: nextBoard !== board };
}

export function deterministicRandom(gameId: bigint, moveCount: number, board: bigint): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint32" }, { type: "uint256" }],
        [gameId, moveCount, board],
      ),
    ),
  );
}

export function spawnTile(board: bigint, random: bigint): bigint {
  const emptyCells = Array.from({ length: 16 }, (_, index) => index).filter((index) => getCell(board, index) === 0);
  if (emptyCells.length === 0) return board;
  const target = emptyCells[Number(random % BigInt(emptyCells.length))];
  return setCell(board, target, random % 10n === 0n ? 2 : 1);
}

export function applyPredictedMove(
  board: bigint,
  direction: Direction,
  gameId: bigint,
  moveCount: number,
): MoveResult {
  const moved = applyMove(board, direction);
  if (!moved.moved) return moved;
  const random = deterministicRandom(gameId, moveCount, moved.board);
  return { ...moved, board: spawnTile(moved.board, random) };
}

export function maxTile(board: bigint): number {
  const exponent = Math.max(...unpackBoard(board));
  return exponent === 0 ? 0 : 2 ** exponent;
}

export function formatTile(exponent: number): string {
  return exponent === 0 ? "" : String(2 ** exponent);
}
