import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type ReactElement
} from "react";
import { SELLPOINT_SECTIONS, type SellpointSheet } from "../../lib/sellpoint.js";
import { MAX_SLIDE_IMAGES } from "../../lib/slide.js";

/**
 * 一页卖点（PPT 放映纸本体）。
 *
 * 版式对齐客户给的《八角亭卖点手卡（7.30）》：左上大标题 → 左边产品图（可并排两张）→
 * 右边 01–04 四条**同色系箭头块**（蓝 / 橙 / 灰 / 绿，取自 Office 主题色）→ 底部收口。
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
  /** 左栏产品图（只存本机，最多两张） */
  images: string[];
  imageBusy: boolean;
  /** 点第几格：传入 `images.length` 表示「再加一张」 */
  onPickImage: (slot: number) => void;
  onDropImages: (files: File[]) => void;
  onRemoveImage: (slot: number) => void;
}

export function SlideCard({
  sheet,
  title,
  meta,
  images,
  imageBusy,
  onPickImage,
  onDropImages,
  onRemoveImage
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
  }, [sheet, images]);

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>): void => {
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        file.type.startsWith("image/")
      );
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      onDropImages(files);
    },
    [onDropImages]
  );

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>): void => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/")
      );
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      onDropImages(files);
    },
    [onDropImages]
  );

  return (
    <article className="slide slide-card" id="sellpoint-sheet" ref={rootRef}>
      <header className="slide-top">
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
          className="slide-media-grid"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onPaste={handlePaste}
        >
          {images.map((source, index) => (
            <div
              className="slide-media-slot has-image"
              key={`image-${index}`}
              role="button"
              tabIndex={0}
              title="点击换这一张（也可以直接把图拖进来 / 粘贴）"
              onClick={() => onPickImage(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPickImage(index);
                }
              }}
            >
              <img alt="" className="slide-media-img" src={source} />
              <button
                className="slide-media-clear no-print"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveImage(index);
                }}
              >
                移除
              </button>
            </div>
          ))}
          {images.length < MAX_SLIDE_IMAGES ? (
            <div
              className="slide-media-slot is-empty no-print"
              role="button"
              tabIndex={0}
              title="点击放产品图（也可以直接把图拖进来 / 粘贴，一次能放两张）"
              onClick={() => onPickImage(images.length)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPickImage(images.length);
                }
              }}
            >
              <div className="slide-media-empty">
                <span className="slide-media-seal">龙</span>
                <strong>{images.length === 0 ? "产品图位" : "再加一张"}</strong>
                <span className="slide-media-hint">
                  {images.length === 0 ? (
                    <>
                      点击 / 拖入 / 粘贴产品图
                      <br />
                      包装 + 实物可以并排两张
                    </>
                  ) : (
                    <>
                      建议补一张实物 / 茶汤图
                      <br />
                      两张会并排站在左栏
                    </>
                  )}
                </span>
              </div>
            </div>
          ) : null}
          {imageBusy ? <span className="slide-media-busy">正在处理图片…</span> : null}
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
