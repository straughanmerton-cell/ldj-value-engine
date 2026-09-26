import type { ChatBenchmark, ChatCopyBlock, ChatReply } from "./chat.js";
import type { CopyIntensity } from "./sales-copy.js";

/**
 * 卖点一页纸（客户 2026-09-26 追加需求）：把 AI 出的一稿卖点，**排成一张纸**。
 *
 * 参考物是客户给的《八角亭卖点手卡》：一页摆完四段（01 产品介绍 / 02 核心卖点 /
 * 03 口感特点 / 04 补充清单）。这一层**只做排版归类**，一个字都不改写：
 *
 * - 四段正文逐字来自 `chatReplySchema` 的 `copy_blocks`（§62-13 出稿已过 schema）；
 * - 对标来源、待补硬事实、已录事实**不进纸面**，放在纸下方单独展示（§24 事实与修辞分离）；
 * - 归不了类的块一律并进「02 核心卖点」，宁可多摆一条，也不让内容凭空消失（§62-15）。
 */

export type SellpointSectionKey = "intro" | "points" | "taste" | "facts";

export interface SellpointSectionMeta {
  key: SellpointSectionKey;
  /** 纸面编号（01–04），与参考手卡一致 */
  index: number;
  label: string;
  /** 这一段要交代什么（只印在界面上，不印进纸里） */
  hint: string;
}

export const SELLPOINT_SECTIONS: readonly SellpointSectionMeta[] = [
  {
    key: "intro",
    index: 1,
    label: "产品介绍",
    hint: "一句话说清它是谁、凭什么、记在哪一点上"
  },
  { key: "points", index: 2, label: "核心卖点", hint: "每条先给结论，再给依据" },
  { key: "taste", index: 3, label: "口感特点", hint: "香气 / 滋味 / 汤感 / 回甘 / 茶气" },
  { key: "facts", index: 4, label: "补充清单", hint: "配方、工艺、规格、常见异议，一条一行" }
];

/** 出稿时的四段块名（Prompt 硬要求）；模型没照做时下面的关键词表兜底。 */
export const SELLPOINT_BLOCK_LABELS: readonly string[] = SELLPOINT_SECTIONS.map(
  (section) => section.label
);

const SECTION_KEYWORDS: Record<SellpointSectionKey, readonly string[]> = {
  intro: ["产品介绍", "产品名", "一句话定位", "定位", "介绍", "是谁", "开场"],
  points: ["核心卖点", "卖点", "价值高度", "价值", "高度", "凭什么", "优势", "值得", "对标"],
  taste: ["口感", "香气", "滋味", "汤感", "汤色", "回甘", "生津", "茶气", "喉韵", "叶底", "味道", "品饮"],
  facts: ["补充清单", "补充", "清单", "配方", "工艺", "结构", "规格", "仓储", "参数", "异议", "收口", "坚持"]
};

/** 把一块话术派到四段里：先认四段名，再按关键词命中「最长的那个词」，都不中进核心卖点。 */
export function classifySellpointBlock(label: string): SellpointSectionKey {
  const text = (label ?? "").trim();
  for (const section of SELLPOINT_SECTIONS) {
    if (text.includes(section.label)) {
      return section.key;
    }
  }
  let bestKey: SellpointSectionKey = "points";
  let bestScore = 0;
  for (const section of SELLPOINT_SECTIONS) {
    const score = SECTION_KEYWORDS[section.key].reduce(
      (longest, keyword) => (text.includes(keyword) ? Math.max(longest, keyword.length) : longest),
      0
    );
    if (score > bestScore) {
      bestScore = score;
      bestKey = section.key;
    }
  }
  return bestKey;
}

/** 纸面上的一行：`label` 是它的作用（如「价值高度」），`text` 是可以直接念的原话。 */
export interface SellpointLine {
  label: string;
  text: string;
  /** 需要金色强调的行（目前只有「价值高度」） */
  highlight?: boolean;
}

export interface SellpointSheet {
  product_name: string | null;
  /** 纸上的主标题（定位句），没有时为 null */
  headline: string | null;
  intro: SellpointLine[];
  points: SellpointLine[];
  taste: SellpointLine[];
  facts: SellpointLine[];
  /** 收口的那一句（取第一句金句），没有时为 null */
  closing: string | null;
  benchmarks: ChatBenchmark[];
  intensity: CopyIntensity;
  /** 四段全空：这一稿没排出任何内容（页面据此显示空态而不是一张白纸） */
  empty: boolean;
}

function firstParagraph(text: string): string {
  const [head = ""] = text.trim().split(/\n{1,}/);
  return head.trim();
}

/** 归类后的四段：键固定，值是要摆到纸上的行。 */
function groupBlocks(blocks: readonly ChatCopyBlock[]): Record<SellpointSectionKey, SellpointLine[]> {
  const grouped: Record<SellpointSectionKey, SellpointLine[]> = {
    intro: [],
    points: [],
    taste: [],
    facts: []
  };
  for (const block of blocks) {
    const key = classifySellpointBlock(block.label);
    grouped[key].push({ label: block.label, text: block.text });
  }
  return grouped;
}

export interface BuildSellpointSheetInput {
  reply: ChatReply;
  /** 用户这次写的产品名（只用于纸面标题，不是事实来源） */
  product_name?: string | null;
}

export function buildSellpointSheet(input: BuildSellpointSheetInput): SellpointSheet {
  const { reply } = input;
  const grouped = groupBlocks(reply.copy_blocks ?? []);

  // 01：定位句放最前面；模型没给「产品介绍」块时，用正文第一段顶上（不新增一个字）。
  if (reply.headline) {
    grouped.intro.unshift({ label: "一句话定位", text: reply.headline });
  }
  if (grouped.intro.length === 0 && reply.reply.trim()) {
    grouped.intro.push({ label: "产品介绍", text: firstParagraph(reply.reply) });
  }

  // 02：价值高度单列一行，界面用金色强调（§22 / §33）。
  const valueHeight = (reply.value_height ?? "").trim();
  if (valueHeight) {
    grouped.points.unshift({ label: "价值高度", text: valueHeight, highlight: true });
  }

  // 04：客户当场会问的问题，一条一行；第一句金句留作收口，其余金句并进清单。
  for (const objection of reply.objections ?? []) {
    grouped.facts.push({ label: `异议 · ${objection.question}`, text: objection.answer });
  }
  const quotes = reply.quotes ?? [];
  for (const quote of quotes.slice(1)) {
    grouped.facts.push({ label: "金句", text: quote });
  }

  const empty =
    grouped.intro.length === 0 &&
    grouped.points.length === 0 &&
    grouped.taste.length === 0 &&
    grouped.facts.length === 0;

  return {
    product_name: (input.product_name ?? "").trim() || null,
    headline: reply.headline ?? null,
    intro: grouped.intro,
    points: grouped.points,
    taste: grouped.taste,
    facts: grouped.facts,
    closing: quotes[0] ?? null,
    benchmarks: reply.benchmarks ?? [],
    intensity: reply.intensity,
    empty
  };
}

/** 纸面的纯文本版：与屏幕上的四段一一对应，贴进微信就能用。 */
export function sellpointSheetCopyText(sheet: SellpointSheet): string {
  const lines: string[] = [];
  lines.push(sheet.product_name ? `${sheet.product_name} · 产品卖点` : "产品卖点");
  for (const section of SELLPOINT_SECTIONS) {
    const items = sheet[section.key];
    lines.push("", `${String(section.index).padStart(2, "0")} ${section.label}`);
    if (items.length === 0) {
      lines.push("（这一版没有足够依据，先留白）");
      continue;
    }
    if (section.key === "intro") {
      for (const item of items) {
        lines.push(item.text);
      }
      continue;
    }
    items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.label}：${item.text}`);
    });
  }
  if (sheet.closing) {
    lines.push("", `收口：${sheet.closing}`);
  }
  lines.push("", `（成交强度：Level ${sheet.intensity}｜对标来源 ${sheet.benchmarks.length} 条｜草稿，发布前须过事实审核）`);
  return lines.join("\n");
}
