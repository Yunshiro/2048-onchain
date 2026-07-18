import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";

/** 数字滚动：分数变化时从旧值平滑滚到新值。 */
export function CountUp({ value, className }: { value: bigint; className?: string }) {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const target = Number(value);
    if (reducedMotion || previous.current === target) {
      element.textContent = target.toLocaleString();
      previous.current = target;
      return;
    }
    const controls = animate(previous.current, target, {
      duration: 0.55,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        element.textContent = Math.round(latest).toLocaleString();
      },
    });
    previous.current = target;
    return () => controls.stop();
  }, [value, reducedMotion]);

  return <strong ref={ref} className={className} />;
}
