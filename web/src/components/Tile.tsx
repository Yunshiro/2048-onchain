import { useEffect, useRef, useState } from "react";
import { motion, useAnimation, useReducedMotion } from "motion/react";
import { Direction } from "../lib/engine";
import type { TileModel } from "../lib/tileTrack";

export type TileLayout = {
  cell: number;
  pad: number;
  gap: number;
};

export function cellOffset(index: number, layout: TileLayout): { x: number; y: number } {
  return {
    x: layout.pad + (index % 4) * (layout.cell + layout.gap),
    y: layout.pad + (index >> 2) * (layout.cell + layout.gap),
  };
}

const slideSpring = { type: "spring", stiffness: 620, damping: 40, mass: 0.9 } as const;

function tileFontSize(exp: number, cell: number): number {
  const digits = String(2 ** exp).length;
  const scale = digits <= 2 ? 0.4 : digits === 3 ? 0.32 : digits === 4 ? 0.25 : 0.2;
  return Math.round(cell * scale);
}

export function Tile({
  tile,
  layout,
  reducedMotion,
}: {
  tile: TileModel;
  layout: TileLayout;
  reducedMotion: boolean;
}) {
  const { x, y } = cellOffset(tile.index, layout);
  const juiceClass = tile.popKey > 0 ? "tile-pop" : tile.spawned ? "tile-spawn" : "";
  return (
    <motion.div
      className="tile-anchor"
      style={{ width: layout.cell, height: layout.cell, zIndex: 2 }}
      initial={{ x, y }}
      animate={{ x, y }}
      transition={reducedMotion ? { duration: 0.01 } : slideSpring}
    >
      <div
        key={`${tile.id}-${tile.popKey}-${tile.spawned}`}
        className={`tile tile-${Math.min(tile.exp, 12)} ${juiceClass}`}
        style={{ fontSize: tileFontSize(tile.exp, layout.cell), animationDelay: tile.spawned ? `${tile.spawnDelay}s` : undefined }}
        aria-label={String(2 ** tile.exp)}
      >
        <span>{2 ** tile.exp}</span>
      </div>
    </motion.div>
  );
}

export function GhostTileView({
  ghost,
  layout,
  reducedMotion,
}: {
  ghost: { id: number; exp: number; from: number; to: number };
  layout: TileLayout;
  reducedMotion: boolean;
}) {
  const from = cellOffset(ghost.from, layout);
  const to = cellOffset(ghost.to, layout);
  return (
    <motion.div
      className="tile-anchor"
      style={{ width: layout.cell, height: layout.cell, zIndex: 1 }}
      initial={{ x: from.x, y: from.y }}
      animate={{ x: to.x, y: to.y }}
      transition={reducedMotion ? { duration: 0.01 } : slideSpring}
    >
      <div className={`tile tile-${Math.min(ghost.exp, 12)}`} style={{ fontSize: tileFontSize(ghost.exp, layout.cell) }}>
        <span>{2 ** ghost.exp}</span>
      </div>
    </motion.div>
  );
}

/** 合并得分飘字：从合成格升起后消散。 */
export function ScoreFloater({
  merge,
  layout,
}: {
  merge: { id: number; index: number; value: number };
  layout: TileLayout;
}) {
  const { x, y } = cellOffset(merge.index, layout);
  return (
    <motion.span
      className="tile-floater"
      style={{ left: x, top: y, width: layout.cell, fontSize: Math.max(15, layout.cell * 0.22), textAlign: "center" }}
      initial={{ opacity: 0, y: 4, scale: 0.8 }}
      animate={{ opacity: [0, 1, 1, 0], y: [4, -layout.cell * 0.5], scale: [0.8, 1.06, 1] }}
      transition={{ duration: 0.78, times: [0, 0.18, 0.72, 1], ease: "easeOut" }}
    >
      +{merge.value}
    </motion.span>
  );
}

/** 合并冲击环：沿合成格边缘扩散一圈。 */
export function MergeRing({
  merge,
  layout,
}: {
  merge: { id: number; index: number; value: number };
  layout: TileLayout;
}) {
  const { x, y } = cellOffset(merge.index, layout);
  return (
    <motion.div
      className="tile-ring"
      style={{ left: x, top: y, width: layout.cell, height: layout.cell }}
      initial={{ opacity: 0.85, scale: 0.72 }}
      animate={{ opacity: 0, scale: 1.32 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    />
  );
}

/** 无效移动时的横向抖动（由父组件用 shakeKey 触发）。 */
export function useBoardShake(shakeKey: number, reducedMotion: boolean) {
  const controls = useAnimation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (shakeKey > 0 && !reducedMotion) {
      void controls.start({ x: [0, -7, 6, -3, 0], transition: { duration: 0.3, ease: "easeInOut" } });
    }
  }, [shakeKey, reducedMotion, controls]);
  return controls;
}
