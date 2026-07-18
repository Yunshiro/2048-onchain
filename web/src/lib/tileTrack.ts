import { applyMove, cellIndex, Direction, getCell, packBoard } from "./engine";

/**
 * 把「打包棋盘 → 打包棋盘」的离散变化还原成每块瓦片的连续轨迹，
 * 让 UI 能用稳定 id 渲染瓦片并播放真实的滑动 / 合并 / 生成动画。
 */

export type TileModel = {
  /** 稳定身份，跨多次移动保持不变（合并时取靠目标侧的那块延续）。 */
  id: number;
  /** 指数：1 = 2, 2 = 4, ... */
  exp: number;
  /** 当前所在格子 0..15 */
  index: number;
  /** 每次作为合并产物时 +1，用于触发合并弹跳动画。 */
  popKey: number;
  /** 本回合新生成（缩小淡入）。 */
  spawned: boolean;
  /** 生成动画延迟（秒），用于开局瀑布式入场。 */
  spawnDelay: number;
};

/** 被合并吸收的那一块：滑到合并格后消失。 */
export type GhostTile = {
  id: number;
  exp: number;
  from: number;
  to: number;
};

/** 一次合并事件：在 index 格合成出 value。 */
export type MergeEvent = {
  id: number;
  index: number;
  value: number;
};

export type BoardTransition = {
  tiles: TileModel[];
  ghosts: GhostTile[];
  merges: MergeEvent[];
};

function manhattan(a: number, b: number): number {
  return Math.abs((a % 4) - (b % 4)) + Math.abs((a >> 2) - (b >> 2));
}

function toCells(tiles: readonly TileModel[]): number[] {
  const cells = Array.from({ length: 16 }, () => 0);
  for (const tile of tiles) cells[tile.index] = tile.exp;
  return cells;
}

/**
 * 已知移动方向时，重放 slide+merge 的精确轨迹。
 * 返回 null 表示该方向无法解释这次棋盘变化（调用方走 resync 兜底）。
 */
export function computeTransition(
  prev: readonly TileModel[],
  prevBoard: bigint,
  nextBoard: bigint,
  direction: Direction,
  nextId: () => number,
): BoardTransition | null {
  const sim = applyMove(prevBoard, direction);
  if (!sim.moved) return null;

  // 模拟结果与真实结果的差异必须恰好是新生成的那一块。
  let spawnIndex = -1;
  for (let index = 0; index < 16; index += 1) {
    const simulated = getCell(sim.board, index);
    const actual = getCell(nextBoard, index);
    if (simulated === actual) continue;
    if (simulated === 0 && actual > 0 && spawnIndex === -1) {
      spawnIndex = index;
    } else {
      return null;
    }
  }

  const tiles: TileModel[] = [];
  const ghosts: GhostTile[] = [];
  const merges: MergeEvent[] = [];

  for (let line = 0; line < 4; line += 1) {
    // 沿移动方向依次取该行的输入瓦片。
    const compact: TileModel[] = [];
    for (let offset = 0; offset < 4; offset += 1) {
      const index = cellIndex(direction, line, offset);
      const tile = prev.find((candidate) => candidate.index === index);
      if (tile) compact.push(tile);
    }

    let out = 0;
    for (let i = 0; i < compact.length; i += 1) {
      const current = compact[i];
      const next = compact[i + 1];
      const target = cellIndex(direction, line, out);
      if (next && current.exp === next.exp && current.exp < 15) {
        tiles.push({ ...current, exp: current.exp + 1, index: target, popKey: current.popKey + 1, spawned: false, spawnDelay: 0 });
        ghosts.push({ id: nextId(), exp: next.exp, from: next.index, to: target });
        merges.push({ id: nextId(), index: target, value: 2 ** (current.exp + 1) });
        i += 1;
      } else {
        tiles.push({ ...current, index: target, spawned: false, spawnDelay: 0 });
      }
      out += 1;
    }
  }

  if (spawnIndex >= 0) {
    tiles.push({
      id: nextId(),
      exp: getCell(nextBoard, spawnIndex),
      index: spawnIndex,
      popKey: 0,
      spawned: true,
      spawnDelay: 0.14,
    });
  }

  return packBoard(toCells(tiles)) === nextBoard ? { tiles, ghosts, merges } : null;
}

/**
 * 兜底同步：方向未知或轨迹对不上（链上对账回滚、开局、刷新）时，
 * 按同值最近原则把旧瓦片匹配到新棋盘，匹配不上的按新生成处理。
 */
export function resyncTiles(
  prev: readonly TileModel[],
  nextBoard: bigint,
  nextId: () => number,
  initial: boolean,
): BoardTransition {
  const remaining = [...prev];
  const tiles: TileModel[] = [];

  for (let index = 0; index < 16; index += 1) {
    const exp = getCell(nextBoard, index);
    if (exp === 0) continue;

    let pick = remaining.find((tile) => tile.index === index && tile.exp === exp);
    if (!pick) {
      pick = remaining
        .filter((tile) => tile.exp === exp)
        .sort((a, b) => manhattan(a.index, index) - manhattan(b.index, index))[0];
    }

    if (pick) {
      remaining.splice(remaining.indexOf(pick), 1);
      tiles.push({ ...pick, index, spawned: false, spawnDelay: 0 });
    } else {
      const col = index % 4;
      const row = index >> 2;
      tiles.push({
        id: nextId(),
        exp,
        index,
        popKey: 0,
        spawned: true,
        spawnDelay: initial ? 0.08 + (col + row) * 0.045 : 0.08,
      });
    }
  }

  return { tiles, ghosts: [], merges: [] };
}
