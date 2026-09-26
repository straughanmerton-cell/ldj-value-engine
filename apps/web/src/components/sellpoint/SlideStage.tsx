import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { SLIDE_H, SLIDE_W } from "../../lib/slide.js";

/**
 * 放映台：把一张 1280 × 720 的纸，**整张**放进当前屏幕。
 *
 * 客户要的是「一屏一页」的体感，所以这里不滚动、不切页：
 * 缩放值同时受容器宽和高约束，窗口越矮纸越小，纸永远完整看得见。
 * 纸里的字号全部用 px 写死，缩放的是整张纸 —— 所以屏幕上、打印、导出 PPT 三者比例一致。
 */

export interface SlideStageProps {
  children: ReactNode;
  /** 打底样式（新建页与成稿页共用同一个台子） */
  className?: string;
}

export function SlideStage({ children, className }: SlideStageProps): ReactElement {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) {
      return;
    }
    const measure = (): void => {
      const width = holder.clientWidth;
      const height = holder.clientHeight;
      if (!width || !height) {
        return;
      }
      const next = Math.min(width / SLIDE_W, height / SLIDE_H);
      // 0.32 是极小窗口下的兜底：再小就没法读了，宁可让外层滚动。
      setScale(Math.max(0.32, Number(next.toFixed(4))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={className ? `deck-stage ${className}` : "deck-stage"} ref={holderRef}>
      <div
        className="deck-frame"
        style={{ width: `${SLIDE_W * scale}px`, height: `${SLIDE_H * scale}px` }}
      >
        {/*
          缩放壳故意**不叫** `.slide`：纸本体（`.slide` / `.slide-card`）必须只有一层。
          以前两层都带 `.slide`，外层 flex 容器会把里层纸压矮 70px，右栏文字被裁。
        */}
        <div className="slide-scaler" style={{ transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
