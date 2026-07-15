import { motion, useReducedMotion } from "motion/react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";

export function GameOverOverlay({ score, highScore, onRestart }: { score: bigint; highScore: bigint; onRestart: () => void }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className="game-over"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
    >
      <motion.div
        className="game-over-card"
        initial={reducedMotion ? false : { opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
      >
        <span className="over-label">GAME OVER // FINALIZED</span>
        <h2 id="game-over-title">数字空间已经填满。</h2>
        <div className="over-score">
          <div><span>当前分数</span><strong>{score.toLocaleString()}</strong></div>
          <div><span>最高</span><strong>{highScore.toLocaleString()}</strong></div>
        </div>
        <button className="button button-primary" type="button" onClick={onRestart}>
          <ArrowCounterClockwise size={18} />
          再玩一次
        </button>
      </motion.div>
    </motion.div>
  );
}
