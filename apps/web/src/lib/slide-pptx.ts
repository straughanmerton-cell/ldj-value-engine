import { SELLPOINT_SECTIONS, type SellpointLine, type SellpointSheet } from "./sellpoint.js";
import { safeFileName } from "./slide.js";

/**
 * 把屏幕上那张纸**原样导成一份真正的 .pptx**（客户 2026-09-26：「我就要做到 PPT 这种效果」）。
 *
 * 版式与网页上的放映纸一一对应：16:9 / 顶部标题条 / 左边产品图 / 右边 01–04 四段 / 底部收口。
 * 只用固定框 + `fit: 'shrink'` 承载文字，所以内容再长也不会溢出到纸外（文字会自动缩，不会丢）。
 *
 * 库体积不小（pptxgenjs ≈ 500KB），所以**点「导出 PPTX」时才动态加载**，平时不进首页包。
 */

const INCH_W = 13.333;
const INCH_H = 7.5;

const GOLD = "C99A4A";
const BRAND = "8A5A2B";
const BRAND_STRONG = "6F4520";
const INK_900 = "16181D";
const INK_700 = "333A45";
const INK_500 = "86909C";
const LINE = "E3E5E8";

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
  /** 这一页放的产品图（dataURL，可为空） */
  imageDataUrl: string | null;
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

  // 顶部：金色压条 + 品牌行 + 产品名 + 右侧强度 / 对标
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: INCH_W, h: 0.055, fill: { color: GOLD } });
  slide.addText("龙德记 · 产品卖点一页纸", {
    x: 0.6,
    y: 0.26,
    w: 6,
    h: 0.26,
    fontSize: 10,
    color: BRAND,
    charSpacing: 2,
    fontFace: "微软雅黑"
  });
  slide.addText(input.title, {
    x: 0.6,
    y: 0.5,
    w: 8.5,
    h: 0.66,
    fontSize: 24,
    bold: true,
    color: INK_900,
    valign: "middle",
    fit: "shrink",
    fontFace: "微软雅黑"
  });
  slide.addText(input.meta, {
    x: 9.3,
    y: 0.55,
    w: 3.4,
    h: 0.6,
    fontSize: 10,
    color: INK_500,
    align: "right",
    valign: "middle",
    fit: "shrink",
    fontFace: "微软雅黑"
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.6,
    y: 1.3,
    w: 12.13,
    h: 0.012,
    fill: { color: LINE }
  });

  // 左：产品图（有就铺满，没有就留一个说得清楚的图位）
  const media = { x: 0.6, y: 1.55, w: 4.16, h: 4.62 };
  if (input.imageDataUrl) {
    slide.addImage({
      data: input.imageDataUrl,
      x: media.x,
      y: media.y,
      w: media.w,
      h: media.h,
      sizing: { type: "contain", w: media.w, h: media.h }
    });
  } else {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: media.x,
      y: media.y,
      w: media.w,
      h: media.h,
      fill: { color: "F7F8FA" },
      line: { color: LINE, pt: 1 },
      rectRadius: 0.08
    });
    slide.addText("产品图位\n（在网页上点这块放图，导出时自动带上）", {
      x: media.x,
      y: media.y + media.h / 2 - 0.4,
      w: media.w,
      h: 0.8,
      fontSize: 11,
      color: INK_500,
      align: "center",
      valign: "middle",
      fontFace: "微软雅黑"
    });
  }

  // 右：01–04 四段，等分四行；文字过长自动缩，不溢出
  const colX = 5.0;
  const colW = 7.73;
  const rowsTop = 1.55;
  const rowsH = 4.62;
  const rowH = rowsH / SELLPOINT_SECTIONS.length;

  SELLPOINT_SECTIONS.forEach((section, index) => {
    const top = rowsTop + rowH * index;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: colX,
      y: top + 0.02,
      w: 0.34,
      h: 0.34,
      fill: { color: GOLD },
      line: { color: GOLD, pt: 1 },
      rectRadius: 0.06
    });
    slide.addText(String(section.index).padStart(2, "0"), {
      x: colX,
      y: top + 0.02,
      w: 0.34,
      h: 0.34,
      fontSize: 11,
      bold: true,
      color: "221A10",
      align: "center",
      valign: "middle",
      fontFace: "微软雅黑"
    });
    slide.addText(section.label, {
      x: colX + 0.46,
      y: top,
      w: colW - 0.46,
      h: 0.32,
      fontSize: 13,
      bold: true,
      color: INK_900,
      valign: "middle",
      charSpacing: 1,
      fontFace: "微软雅黑"
    });
    slide.addText(sectionText(section.key, input.sheet[section.key]), {
      x: colX + 0.46,
      y: top + 0.34,
      w: colW - 0.46,
      h: rowH - 0.42,
      fontSize: 10,
      color: INK_700,
      valign: "top",
      fit: "shrink",
      lineSpacingMultiple: 1.25,
      fontFace: "微软雅黑"
    });
  });

  // 底部：收口金句 + 草稿声明（与屏幕上逐字一致）
  if (input.sheet.closing) {
    slide.addText(`“${input.sheet.closing}”`, {
      x: 0.6,
      y: 6.35,
      w: 12.13,
      h: 0.42,
      fontSize: 12,
      bold: true,
      color: BRAND_STRONG,
      fit: "shrink",
      fontFace: "微软雅黑"
    });
  }
  slide.addText(
    "草稿：发布前必须过事实审核。标了占位符的硬事实一律不能对外讲；对标只用来讲价格高度与市场认知。",
    {
      x: 0.6,
      y: 6.78,
      w: 12.13,
      h: 0.3,
      fontSize: 9,
      color: INK_500,
      fontFace: "微软雅黑"
    }
  );

  const fileName = `${safeFileName(input.title, "龙德记卖点")}-卖点.pptx`;
  await pptx.writeFile({ fileName });
  return fileName;
}
