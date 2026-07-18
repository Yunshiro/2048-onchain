import { motion, useReducedMotion } from "motion/react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { CountUp } from "./CountUp";

export function GameOverOverlay({ score, highScore, onRestart }: { score: bigint; highScore: bigint; onRestart: () => void }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className="game-over"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
    >
      <motion.div
        className="game-over-card"
        initial={reducedMotion ? false : { opacity: 0, y: 28, scale: 0.94, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        transition={{ type: "spring", stiffness: 240, damping: 22, delay: 0.08 }}
      >
        <span className="over-label">GAME OVER · FINALIZED</span>
        <h2 id="game-over-title">数字空间已经填满。</h2>
        <div className="over-score">
          <div><span>当前分数</span><CountUp value={score} /></div>
          <div><span>历史最高</span><CountUp value={highScore} /></div>
        </div>
        <button className="button button-primary" type="button" onClick={onRestart}>
          <ArrowCounterClockwise size={18} />
          再玩一次
        </button>
      </motion.div>
    </motion.div>
  );
}
