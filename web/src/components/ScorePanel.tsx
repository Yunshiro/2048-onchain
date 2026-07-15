import { motion, useReducedMotion } from "motion/react";
import { Lightning, Trophy } from "@phosphor-icons/react";
import { maxTile } from "../lib/engine";

export function ScorePanel({ board, score, highScore, pending }: { board: bigint; score: bigint; highScore: bigint; pending: number }) {
  const reducedMotion = useReducedMotion();
  return (
    <section className="score-panel" aria-label="游戏分数">
      <div className="score-primary">
        <span>CURRENT SCORE</span>
        <motion.strong
          key={score.toString()}
          initial={reducedMotion ? false : { opacity: 0.45, y: 7, scale: 1.08 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 23 }}
        >
          {score.toLocaleString()}
        </motion.strong>
      </div>
      <div className="score-secondary">
        <div>
          <Trophy size={18} weight="regular" />
          <span>最高</span>
          <strong>{highScore.toLocaleString()}</strong>
        </div>
        <div>
          <Lightning size={18} weight="regular" />
          <span>最大方块</span>
          <strong>{maxTile(board) || "-"}</strong>
        </div>
      </div>
      {pending > 0 && <div className="pending-strip"><span />LOCAL OK // {pending} MOVES SYNCING</div>}
    </section>
  );
}
