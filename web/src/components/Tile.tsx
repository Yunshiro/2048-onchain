import { motion, useReducedMotion } from "motion/react";
import { Direction, formatTile } from "../lib/engine";

const directionClass: Record<Direction, string> = {
  [Direction.Up]: "tile-enter-up",
  [Direction.Down]: "tile-enter-down",
  [Direction.Left]: "tile-enter-left",
  [Direction.Right]: "tile-enter-right",
};

export function Tile({
  exponent,
  index,
  changed,
  merged,
  direction,
}: {
  exponent: number;
  index: number;
  changed: boolean;
  merged: boolean;
  direction: Direction | null;
}) {
  const reducedMotion = useReducedMotion();
  const effectClass = changed && direction !== null ? directionClass[direction] : "";
  return (
    <motion.div
      className={`tile tile-${Math.min(exponent, 12)} ${exponent === 0 ? "tile-empty" : ""} ${effectClass} ${merged ? "tile-merged" : ""}`}
      data-index={index}
      initial={reducedMotion || exponent === 0 ? false : { opacity: 0.38, scale: merged ? 1.3 : 0.88 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: merged ? 520 : 390, damping: merged ? 18 : 24 }}
      aria-label={exponent === 0 ? "空格" : String(2 ** exponent)}
    >
      {formatTile(exponent)}
    </motion.div>
  );
}
