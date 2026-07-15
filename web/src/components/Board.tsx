import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Direction, unpackBoard } from "../lib/engine";
import { Tile } from "./Tile";

const SWIPE_THRESHOLD = 30;

export function Board({
  board,
  disabled,
  shakeKey,
  onMove,
}: {
  board: bigint;
  disabled: boolean;
  shakeKey: number;
  onMove: (direction: Direction) => void;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousCells = useRef(unpackBoard(board));
  const [lastDirection, setLastDirection] = useState<Direction | null>(null);
  const cells = useMemo(() => unpackBoard(board), [board]);
  const previousCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const exponent of previousCells.current) counts.set(exponent, (counts.get(exponent) ?? 0) + 1);
    return counts;
  }, [cells]);

  useEffect(() => {
    previousCells.current = cells;
  }, [cells]);

  const triggerMove = useCallback((direction: Direction) => {
    if (disabled) return;
    setLastDirection(direction);
    onMove(direction);
  }, [disabled, onMove]);

  const moveFromDelta = useCallback((x: number, y: number) => {
    if (disabled || Math.max(Math.abs(x), Math.abs(y)) < SWIPE_THRESHOLD) return;
    if (Math.abs(x) > Math.abs(y)) triggerMove(x > 0 ? Direction.Right : Direction.Left);
    else triggerMove(y > 0 ? Direction.Down : Direction.Up);
  }, [disabled, triggerMove]);

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

  return (
    <div
      className={`board-shell ${disabled ? "board-disabled" : ""}`}
      aria-label="2048 游戏面板"
      aria-disabled={disabled}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStart.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={(event) => {
        if (!touchStart.current) return;
        const touch = event.changedTouches[0];
        moveFromDelta(touch.clientX - touchStart.current.x, touch.clientY - touchStart.current.y);
        touchStart.current = null;
      }}
    >
      <div key={shakeKey} className={shakeKey > 0 ? "board board-shake" : "board"}>
        {cells.map((exponent, index) => (
          <Tile
            key={`${index}-${exponent}`}
            exponent={exponent}
            index={index}
            changed={exponent !== previousCells.current[index]}
            merged={exponent > 1 && exponent !== previousCells.current[index] && (previousCounts.get(exponent - 1) ?? 0) >= 2}
            direction={lastDirection}
          />
        ))}
      </div>
    </div>
  );
}
