/**
 * 网页结果页解析用的公共工具（免 Key 检索通道共用，不做任何业务判断）。
 *
 * 这些函数只做「把 HTML 还原成能读的文本」：标签剥掉、实体解码、空白压平。
 * 它们**不判断结果是否相关、不补全缺失字段**——解析不到就是解析不到（§62-1）。
 */

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  hellip: "…",
  middot: "·",
  mdash: "—",
  ndash: "–",
  times: "×",
  copy: "©"
};

/** HTML 实体解码：搜索结果里的中文经常被写成 `&#33590;` 这类数字实体。 */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        return match;
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** 去掉标签 + 解码实体 + 压平空白：结果页的标题里常带 `<em>` / `<strong>` 高亮片段。 */
export function stripHtmlTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}
