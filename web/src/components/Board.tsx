import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { applyMove, Direction } from "../lib/engine";
import {
  computeTransition,
  resyncTiles,
  type GhostTile,
  type MergeEvent,
  type TileModel,
} from "../lib/tileTrack";
import { GhostTileView, MergeRing, ScoreFloater, Tile, useBoardShake, type TileLayout } from "./Tile";

const SWIPE_THRESHOLD = 30;
const GHOST_TTL = 320;
const MERGE_TTL = 860;

const directionVector: Record<Direction, { x: number; y: number }> = {
  [Direction.Up]: { x: 0, y: -1 },
  [Direction.Down]: { x: 0, y: 1 },
  [Direction.Left]: { x: -1, y: 0 },
  [Direction.Right]: { x: 1, y: 0 },
};

function readLayout(element: HTMLElement): TileLayout {
  const styles = getComputedStyle(element);
  const pad = Number.parseFloat(styles.getPropertyValue("--pad")) || 12;
  const gap = Number.parseFloat(styles.getPropertyValue("--gap")) || 10;
  const cell = (element.clientWidth - pad * 2 - gap * 3) / 4;
  return { cell, pad, gap };
}

export function Board({
  board,
  disabled,
  shakeKey,
  onMove,
  children,
}: {
  board: bigint;
  disabled: boolean;
  shakeKey: number;
  onMove: (direction: Direction) => void;
  children?: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(1);
  const nextId = useCallback(() => idCounter.current++, []);
  const prevBoardRef = useRef<bigint | null>(null);
  const modelRef = useRef<TileModel[]>([]);
  const pendingDirection = useRef<Direction | null>(null);
  const [tiles, setTiles] = useState<TileModel[]>([]);
  const [ghosts, setGhosts] = useState<GhostTile[]>([]);
  const [merges, setMerges] = useState<MergeEvent[]>([]);
  const [layout, setLayout] = useState<TileLayout | null>(null);
  const [kick, setKick] = useState<{ x: number[]; y: number[] }>({ x: [0], y: [0] });
  const shakeControls = useBoardShake(shakeKey, reducedMotion);

  // 跟随棋盘尺寸与 CSS 变量，换算每格的像素坐标。
  useEffect(() => {
    const element = shellRef.current;
    if (!element) return;
    const measure = () => setLayout(readLayout(element));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 把棋盘快照换算成瓦片轨迹；方向无法解释时回退到最近匹配。
  useEffect(() => {
    if (prevBoardRef.current === board) return;
    const prevBoard = prevBoardRef.current;
    prevBoardRef.current = board;

    const direction = pendingDirection.current;
    pendingDirection.current = null;

    let transition =
      direction !== null && prevBoard !== null && prevBoard !== 0n
        ? computeTransition(modelRef.current, prevBoard, board, direction, nextId)
        : null;
    let initial = false;
    if (!transition) {
      initial = modelRef.current.length === 0;
      transition = resyncTiles(modelRef.current, board, nextId, initial);
    }

    modelRef.current = transition.tiles;
    setTiles(transition.tiles);
    setGhosts(transition.ghosts);
    setMerges(transition.merges);

    if (transition.ghosts.length > 0) {
      const cleared = transition.ghosts;
      window.setTimeout(() => {
        setGhosts((current) => current.filter((ghost) => !cleared.includes(ghost)));
      }, GHOST_TTL);
    }
    if (transition.merges.length > 0) {
      const cleared = transition.merges;
      window.setTimeout(() => {
        setMerges((current) => current.filter((merge) => !cleared.includes(merge)));
      }, MERGE_TTL);
    }

    // 真实移动时给棋盘一个逆方向的轻微回弹，像机械键盘的段落感。
    if (direction !== null && !initial && !reducedMotion) {
      const vector = directionVector[direction];
      setKick({ x: [-vector.x * 5, 0], y: [-vector.y * 5, 0] });
    }
  }, [board, nextId, reducedMotion]);

  const triggerMove = useCallback(
    (direction: Direction) => {
      if (disabled) return;
      // 只有真正会改变棋盘的方向才记录轨迹方向，其余交给上层抖动。
      if (applyMove(board, direction).moved) pendingDirection.current = direction;
      onMove(direction);
    },
    [board, disabled, onMove],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (disabled) return;
      const directions: Partial<Record<string, Direction>> = {
        ArrowUp: Direction.Up,
        ArrowDown: Direction.Down,
        ArrowLeft: Direction.Left,
        ArrowRight: Direction.Right,
      };
      const direction = directions[event.key];
      if (direction === undefined) return;
      event.preventDefault();
      triggerMove(direction);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [disabled, triggerMove]);

  const slots = useMemo(() => Array.from({ length: 16 }, (_, index) => index), []);

  return (
    <motion.div
      className="board-wrap"
      animate={kick}
      transition={{ type: "spring", stiffness: 480, damping: 22 }}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--bx", `${event.clientX - rect.left}px`);
        event.currentTarget.style.setProperty("--by", `${event.clientY - rect.top}px`);
      }}
    >
      <div className="ember-halo" />
      <motion.div
        ref={shellRef}
        className={`board-shell ${disabled ? "board-disabled" : ""}`}
        aria-label="2048 游戏面板"
        aria-disabled={disabled}
        animate={shakeControls}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(event) => {
          if (!touchStart.current) return;
          const touch = event.changedTouches[0];
          const dx = touch.clientX - touchStart.current.x;
          const dy = touch.clientY - touchStart.current.y;
          touchStart.current = null;
          if (disabled || Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
          if (Math.abs(dx) > Math.abs(dy)) triggerMove(dx > 0 ? Direction.Right : Direction.Left);
          else triggerMove(dy > 0 ? Direction.Down : Direction.Up);
        }}
      >
        <div className="board-slots" aria-hidden>
          {slots.map((slot) => (
            <div key={slot} className="board-slot" />
          ))}
        </div>
        {layout && (
          <div className="tile-layer">
            {ghosts.map((ghost) => (
              <GhostTileView key={ghost.id} ghost={ghost} layout={layout} reducedMotion={reducedMotion} />
            ))}
            {tiles.map((tile) => (
              <Tile key={tile.id} tile={tile} layout={layout} reducedMotion={reducedMotion} />
            ))}
            {merges.map((merge) => (
              <MergeRing key={`ring-${merge.id}`} merge={merge} layout={layout} />
            ))}
            {merges.map((merge) => (
              <ScoreFloater key={`float-${merge.id}`} merge={merge} layout={layout} />
            ))}
          </div>
        )}
      </motion.div>
      {children}
    </motion.div>
  );
}
