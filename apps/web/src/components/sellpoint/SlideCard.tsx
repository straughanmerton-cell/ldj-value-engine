import {
  useCallback,
  useLayoutEffect,
  useRef,
  type DragEvent as ReactDragEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type ReactElement
} from "react";
import { SELLPOINT_SECTIONS, type SellpointSheet } from "../../lib/sellpoint.js";

/**
 * 一页卖点（PPT 放映纸本体）。
 *
 * 版式对齐客户给的《八角亭卖点手卡》：顶部标题条 → 左边产品图 → 右边 01–04 四段 → 底部收口。
 * 纸里**一个字都不改写**：内容全部来自 `buildSellpointSheet()` 排好的四段。
 *
 * 内建**自适应字号**：四段塞不下时整体降字号（最多降到 8.5px），保证永远不被裁掉半句话。
 * 这也是「像 PPT 而不是像网页」的关键 —— 不会出现滚动条，也不会把最后一条卖点挤到纸外。
 */

export interface SlideCardProps {
  sheet: SellpointSheet;
  /** 纸面大标题（产品名） */
  title: string;
  /** 标题右侧的小标（强度 / 对标条数） */
  meta: string[];
  imageDataUrl: string | null;
  imageBusy: boolean;
  onPickImage: () => void;
  onDropImage: (file: File) => void;
  onClearImage: () => void;
}

export function SlideCard({
  sheet,
  title,
  meta,
  imageDataUrl,
  imageBusy,
  onPickImage,
  onDropImage,
  onClearImage
}: SlideCardProps): ReactElement {
  const rootRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const fit = (): void => {
      const columns = root.querySelector<HTMLElement>(".slide-cols");
      if (!columns) {
        return;
      }
      let size = 17;
      root.style.setProperty("--slide-fit", `${size}px`);
      let guard = 0;
      // 真实出稿常常比参考手卡长得多，所以宁可让它一直降到 8.5px，
      // 也不许把最后一条卖点挤到纸外（纸面永远不出滚动条）。
      while (size > 8.5 && columns.scrollHeight > columns.clientHeight + 1 && guard < 60) {
        size -= 0.25;
        root.style.setProperty("--slide-fit", `${size}px`);
        guard += 1;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    return () => observer.disconnect();
  }, [sheet, imageDataUrl]);

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>): void => {
      const [file] = Array.from(event.dataTransfer?.files ?? []);
      if (!file) {
        return;
      }
      event.preventDefault();
      onDropImage(file);
    },
    [onDropImage]
  );

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>): void => {
      const [file] = Array.from(event.clipboardData?.files ?? []);
      if (!file) {
        return;
      }
      event.preventDefault();
      onDropImage(file);
    },
    [onDropImage]
  );

  return (
    <article className="slide slide-card" id="sellpoint-sheet" ref={rootRef}>
      <header className="slide-top">
        <div className="slide-brand">龙德记 · 产品卖点一页纸</div>
        <h1 className="slide-title">{title}</h1>
        <div className="slide-meta">
          {meta.map((item) => (
            <span className="slide-meta-item" key={item}>
              {item}
            </span>
          ))}
        </div>
      </header>

      <div className="slide-body">
        <div
          className={imageDataUrl ? "slide-media has-image" : "slide-media"}
          role="button"
          tabIndex={0}
          title={imageDataUrl ? "点击换一张产品图（也可以直接拖进来 / 粘贴）" : "点击放产品图（也可以直接拖进来 / 粘贴）"}
          onClick={onPickImage}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onPickImage();
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onPaste={handlePaste}
        >
          {imageDataUrl ? (
            <img alt="" className="slide-media-img" src={imageDataUrl} />
          ) : (
            <div className="slide-media-empty">
              <span className="slide-media-seal">龙</span>
              <strong>产品图位</strong>
              <span className="slide-media-hint">
                点击 / 拖入 / 粘贴一张产品图
                <br />
                图上会跟着这页一起打印、一起导出 PPT
              </span>
            </div>
          )}
          {imageBusy ? <span className="slide-media-busy">正在处理图片…</span> : null}
          {imageDataUrl ? (
            <button
              className="slide-media-clear no-print"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClearImage();
              }}
            >
              移除图片
            </button>
          ) : null}
        </div>

        <div className="slide-cols">
          {SELLPOINT_SECTIONS.map((section) => {
            const items = sheet[section.key];
            return (
              <section className={`slide-sec slide-sec-${section.key}`} key={section.key}>
                <header className="slide-sec-head">
                  <span className="slide-no">{String(section.index).padStart(2, "0")}</span>
                  <span className="slide-sec-label">{section.label}</span>
                </header>
                {items.length === 0 ? (
                  <p className="slide-blank">这一版没有足够依据，先留白（不许编）。</p>
                ) : section.key === "intro" ? (
                  items.map((item, index) => (
                    <p className="slide-lead" key={`${item.label}-${index}`}>
                      {item.text}
                    </p>
                  ))
                ) : (
                  <ol className="slide-list">
                    {items.map((item, index) => (
                      <li
                        className={item.highlight ? "slide-line highlight" : "slide-line"}
                        key={`${item.label}-${index}`}
                      >
                        <span className="slide-line-label">{item.label}</span>
                        <span className="slide-line-text">{item.text}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <footer className="slide-foot">
        {sheet.closing ? <p className="slide-closing">“{sheet.closing}”</p> : null}
        <p className="slide-note">
          草稿：发布前必须过事实审核。标了占位符的硬事实一律不能对外讲；对标只用来讲价格高度与市场认知。
        </p>
      </footer>
    </article>
  );
}
