import { Lightning, Trophy } from "@phosphor-icons/react";
import { maxTile } from "../lib/engine";
import { CountUp } from "./CountUp";

export function ScorePanel({ board, score, highScore, pending }: { board: bigint; score: bigint; highScore: bigint; pending: number }) {
  return (
    <section className="score-panel" aria-label="游戏分数">
      <div className="score-primary">
        <span>Score</span>
        <CountUp value={score} />
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
      {pending > 0 && <div className="pending-strip"><span />本地预览 · {pending} 步待链上确认</div>}
    </section>
  );
}
