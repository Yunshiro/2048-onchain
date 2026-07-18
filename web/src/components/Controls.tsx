import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Keyboard } from "@phosphor-icons/react";
import { Direction } from "../lib/engine";

export function Controls({ disabled, onMove }: { disabled: boolean; onMove: (direction: Direction) => void }) {
  return (
    <section className="controls" aria-label="移动控制">
      <div className="controls-heading">
        <Keyboard size={20} />
        <div>
          <strong>移动棋盘</strong>
          <span>方向键或滑动</span>
        </div>
      </div>
      <div className="dpad">
        <button className="dpad-up" type="button" disabled={disabled} onClick={() => onMove(Direction.Up)} aria-label="向上">
          <ArrowUp size={21} />
        </button>
        <button className="dpad-left" type="button" disabled={disabled} onClick={() => onMove(Direction.Left)} aria-label="向左">
          <ArrowLeft size={21} />
        </button>
        <button className="dpad-right" type="button" disabled={disabled} onClick={() => onMove(Direction.Right)} aria-label="向右">
          <ArrowRight size={21} />
        </button>
        <button className="dpad-down" type="button" disabled={disabled} onClick={() => onMove(Direction.Down)} aria-label="向下">
          <ArrowDown size={21} />
        </button>
      </div>
    </section>
  );
}
