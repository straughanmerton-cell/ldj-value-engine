import { SELLPOINT_SECTIONS, type SellpointLine, type SellpointSheet } from "./sellpoint.js";
import { safeFileName } from "./slide.js";

/**
 * 把屏幕上那张纸**原样导成一份真正的 .pptx**（客户 2026-09-26：「我就要做到 PPT 这种效果」）。
 *
 * 版式逐块对齐网页上的放映纸（也就是对齐客户给的《八角亭卖点手卡（7.30）》）：
 * 16:9 / 左上大标题 / 左侧并排两张产品图 / 右侧 01–04 四条同色箭头块 / 底部收口。
 * 只用固定框 + `fit: 'shrink'` 承载文字，所以内容再长也不会溢出到纸外（文字会自动缩，不会丢）。
 *
 * 库体积不小（pptxgenjs ≈ 500KB），所以**点「导出 PPTX」时才动态加载**，平时不进首页包。
 */

const INCH_W = 13.333;
const INCH_H = 7.5;

/**
 * 纸面几何（in）：与 `styles.css` 里 `.slide` 的 padding / `.slide-body` 的列宽逐条换算。
 * 1280px × 720px 的纸 @96dpi = 13.333in × 7.5in，所以 1in = 96px。
 */
const PAD_X = 44 / 96;
const PAD_TOP = 32 / 96;
const TITLE_H = 42 / 96;
const BODY_TOP = PAD_TOP + TITLE_H + 14 / 96;
const MEDIA_W = 442 / 96;
const MEDIA_H = 551 / 96;
const COL_GAP = 24 / 96;
const MEDIA_GAP = 14 / 96;
const COL_X = PAD_X + MEDIA_W + COL_GAP;
const COL_W = INCH_W - PAD_X - COL_X;
const ROW_GAP = 9 / 96;
const ROW_H = (MEDIA_H - ROW_GAP * (SELLPOINT_SECTIONS.length - 1)) / SELLPOINT_SECTIONS.length;

const INK_900 = "1F2329";
const INK_400 = "A9B0BA";
const LINE = "E3E5E8";

/** 四段配色逐字取自参考手卡的 Office 主题色 + 同色系深一档的正文色（lumMod 75/50）。 */
const DEFAULT_SECTION_COLOR = { main: "4472C4", ink: "2F5597" };

const SECTION_COLORS: Record<string, { main: string; ink: string }> = {
  intro: DEFAULT_SECTION_COLOR,
  points: { main: "ED7D31", ink: "C55A11" },
  taste: { main: "A5A5A5", ink: "595959" },
  facts: { main: "70AD47", ink: "548235" }
};

function sectionColor(key: string): { main: string; ink: string } {
  return SECTION_COLORS[key] ?? DEFAULT_SECTION_COLOR;
}

/** 四段正文：与 `SELLPOINT_SECTIONS` 顺序一致，`SellpointLine[]` → 一段可放进 PPT 的文字。 */
function sectionText(key: string, items: readonly SellpointLine[]): string {
  if (items.length === 0) {
    return "这一版没有足够依据，先留白（不许编）。";
  }
  if (key === "intro") {
    return items.map((item) => item.text).join("\n");
  }
  return items.map((item, index) => `${index + 1}. ${item.label}：${item.text}`).join("\n");
}

export interface SlidePptxInput {
  sheet: SellpointSheet;
  /** 纸面标题（产品名） */
  title: string;
  /** 纸面副标（强度 / 对标条数） */
  meta: string;
  /** 这一页放的产品图（dataURL，最多两张；没有就是空数组） */
  images: readonly string[];
}

/** 生成一份单页 .pptx 并触发下载。失败时抛错，由调用方提示用户。 */
export async function exportSellpointPptx(input: SlidePptxInput): Promise<string> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "LDJ_16x9", width: INCH_W, height: INCH_H });
  pptx.layout = "LDJ_16x9";
  pptx.author = "龙德记";
  pptx.company = "龙德记";
  pptx.title = input.title;

  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };

  // 顶部：左上大标题 + 右侧强度 / 对标（参考手卡没有金条与分隔线，这里也不加）
  slide.addText(input.title, {
    x: PAD_X,
    y: PAD_TOP,
    w: INCH_W - PAD_X * 2 - 3.5,
    h: TITLE_H,
    fontSize: 21,
    bold: true,
    color: INK_900,
    valign: "middle",
    fit: "shrink",
    fontFace: "微软雅黑"
  });
  slide.addText(input.meta, {
    x: INCH_W - PAD_X - 3.5,
    y: PAD_TOP,
    w: 3.5,
    h: TITLE_H,
    fontSize: 9,
    color: "86909C",
    align: "right",
    valign: "middle",
    fit: "shrink",
    fontFace: "微软雅黑"
  });

  // 左：产品图（最多两张并排；一张就铺满，没有就留一个说得清楚的图位）
  const images = input.images.filter((item) => item.startsWith("data:image/")).slice(0, 2);
  if (images.length > 0) {
    const slotW = (MEDIA_W - MEDIA_GAP * (images.length - 1)) / images.length;
    images.forEach((data, index) => {
      slide.addImage({
        data,
        x: PAD_X + (slotW + MEDIA_GAP) * index,
        y: BODY_TOP,
        w: slotW,
        h: MEDIA_H,
        sizing: { type: "contain", w: slotW, h: MEDIA_H }
      });
    });
  } else {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: PAD_X,
      y: BODY_TOP,
      w: MEDIA_W,
      h: MEDIA_H,
      fill: { color: "F7F8FA" },
      line: { color: LINE, pt: 1 },
      rectRadius: 0.08
    });
    slide.addText("产品图位\n（在网页上点这块放图，导出时自动带上，最多两张）", {
      x: PAD_X,
      y: BODY_TOP + MEDIA_H / 2 - 0.4,
      w: MEDIA_W,
      h: 0.8,
      fontSize: 11,
      color: "86909C",
      align: "center",
      valign: "middle",
      fontFace: "微软雅黑"
    });
  }

  // 右：01–04 四段；每段 = 同色箭头编号 + 段名，下面接正文；文字过长自动缩，不溢出
  SELLPOINT_SECTIONS.forEach((section, index) => {
    const top = BODY_TOP + (ROW_H + ROW_GAP) * index;
    const tone = sectionColor(section.key);
    // 箭头：参考手卡里的「五边形（homePlate）」——右侧收成尖角，白字编号
    slide.addShape("homePlate", {
      x: COL_X,
      y: top + 0.02,
      w: 0.68,
      h: 0.3,
      fill: { color: tone.main },
      line: { color: tone.main, pt: 0.5 }
    });
    slide.addText(String(section.index).padStart(2, "0"), {
      x: COL_X,
      y: top + 0.02,
      w: 0.6,
      h: 0.3,
      fontSize: 11,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
      fontFace: "Arial"
    });
    slide.addText(section.label, {
      x: COL_X + 0.78,
      y: top,
      w: COL_W - 0.78,
      h: 0.34,
      fontSize: 13,
      bold: true,
      color: tone.ink,
      valign: "middle",
      charSpacing: 1,
      fit: "shrink",
      fontFace: "微软雅黑"
    });
    slide.addText(sectionText(section.key, input.sheet[section.key]), {
      x: COL_X,
      y: top + 0.38,
      w: COL_W,
      h: ROW_H - 0.44,
      fontSize: 10,
      color: tone.ink,
      valign: "top",
      fit: "shrink",
      lineSpacingMultiple: 1.25,
      fontFace: "微软雅黑"
    });
  });

  // 底部：收口金句 + 草稿声明（与屏幕上逐字一致）
  const footTop = BODY_TOP + MEDIA_H + 12 / 96;
  if (input.sheet.closing) {
    slide.addText(`“${input.sheet.closing}”`, {
      x: PAD_X,
      y: footTop,
      w: INCH_W - PAD_X * 2,
      h: 0.3,
      fontSize: 11,
      bold: true,
      color: INK_900,
      fit: "shrink",
      fontFace: "微软雅黑"
    });
  }
  slide.addText(
    "草稿：发布前必须过事实审核。标了占位符的硬事实一律不能对外讲；对标只用来讲价格高度与市场认知。",
    {
      x: PAD_X,
      y: footTop + 0.3,
      w: INCH_W - PAD_X * 2,
      h: 0.26,
      fontSize: 8,
      color: INK_400,
      fontFace: "微软雅黑"
    }
  );

  const fileName = `${safeFileName(input.title, "龙德记卖点")}-卖点.pptx`;
  await pptx.writeFile({ fileName });
  return fileName;
}
