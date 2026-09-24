import {
  CANDIDATE_LIMITS,
  SIMILARITY_DIMENSION_LABELS,
  SIMILARITY_DIMENSION_WEIGHTS,
  candidateEvidenceSchema,
  candidatePriceObservationSchema,
  candidateSimilaritySchema,
  normalizeComparableText,
  similarityBandForScore,
  similarityDimensions,
  similarityFacetSchema,
  type CandidateEvidence,
  type CandidatePriceObservation,
  type CandidateSimilarity,
  type SimilarityDimension,
  type SimilarityFacet
} from "./comparable.js";
import type { WebExtractionAiOutput } from "./extraction.js";

/**
 * 可比性评分实现（规格 §13 / §42 Agent 4）。
 *
 * 三条判定原则：
 * 1. **价格不参与**：输入面 `SimilarityFacet` 里根本没有价格字段，类型层面就不可能算进去；
 * 2. **未知不等于相似**：任一侧缺信息时该维度按 0 分计并进 `unknown_dimensions`，不做任何推断；
 * 3. **每一步都能解释**：每个维度都带中文 note，说明命中了什么、为什么是 0 分。
 */

export interface SimilarityFacetInput {
  product_name?: string | null;
  series_name?: string | null;
  /** 额外的命名体系信号（例如 Value DNA 的 identity / naming_concepts） */
  naming?: readonly string[] | null;
  tea_type?: string | null;
  tea_subtype?: string | null;
  origin_province?: string | null;
  origin_city?: string | null;
  origin_region?: string | null;
  mountain?: string | null;
  village?: string | null;
  raw_material?: string | null;
  tree_type?: string | null;
  season?: string | null;
  aromas?: readonly string[] | null;
  tastes?: readonly string[] | null;
  positionings?: readonly string[] | null;
  crafts?: readonly string[] | null;
  weight_g?: number | null;
  pieces_per_box?: number | null;
  year?: number | null;
}

const MAX_LIST_ITEMS = 40;

function compactList(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const text = (value ?? "").trim();
    if (text.length === 0 || result.includes(text)) {
      continue;
    }
    result.push(text);
    if (result.length >= MAX_LIST_ITEMS) {
      break;
    }
  }
  return result;
}

function textOrNull(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
}

/** 归一化后「相等或一方包含另一方」视为同一表述（如「布朗山」与「布朗山乡」）。 */
function textMatches(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeComparableText(left ?? "");
  const b = normalizeComparableText(right ?? "");
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 2 && longer.includes(shorter);
}

/** 返回命中的表述对，例如 ["烟香明显 ≈ 烟香"]，用于在 note 里解释分数。 */
function listMatches(left: readonly string[], right: readonly string[]): string[] {
  const matched: string[] = [];
  for (const a of left) {
    for (const b of right) {
      if (textMatches(a, b)) {
        matched.push(`${a} ≈ ${b}`);
        break;
      }
    }
  }
  return matched;
}

function sharedKeywords(left: readonly string[], right: readonly string[], keywords: readonly string[]): string[] {
  const leftText = normalizeComparableText(left.join(" "));
  const rightText = normalizeComparableText(right.join(" "));
  return keywords.filter((keyword) => leftText.includes(keyword) && rightText.includes(keyword));
}

const RAW_MARKERS = ["生茶", "生普", "生饼", "青饼", "生沱", "生砖"] as const;
const RIPE_MARKERS = ["熟茶", "熟普", "熟饼", "熟沱", "熟砖"] as const;

export function teaRipeness(text: string): "RAW" | "RIPE" | null {
  const normalized = normalizeComparableText(text);
  if (RAW_MARKERS.some((marker) => normalized.includes(marker))) {
    return "RAW";
  }
  if (RIPE_MARKERS.some((marker) => normalized.includes(marker))) {
    return "RIPE";
  }
  return null;
}

/** 命名体系关键词表（刻意保持很短）：只认真正的产品命名体系，避免靠常见字误判相似。 */
export const NAMING_SYSTEM_KEYWORDS = [
  "孔雀",
  "生肖",
  "印级",
  "号级",
  "经典",
  "纪念",
  "金瓜",
  "贡饼",
  "圆茶"
] as const;

/** 原料关键词表：树型与季节分开，因为「古树 vs 大树」不能算同一种原料。 */
export const MATERIAL_TREE_KEYWORDS = [
  "古树",
  "大树",
  "小树",
  "台地",
  "乔木",
  "野生",
  "荒山",
  "野放",
  "单株",
  "紫芽",
  "藤条"
] as const;

export const MATERIAL_SEASON_KEYWORDS = [
  "春茶",
  "秋茶",
  "夏茶",
  "雨水茶",
  "谷花",
  "明前",
  "头采",
  "头春"
] as const;

interface DimensionEvaluation {
  ratio: number;
  matched: boolean;
  unknown: boolean;
  note: string;
}

function unknownNote(message: string): DimensionEvaluation {
  return { ratio: 0, matched: false, unknown: true, note: message };
}

function listDimension(
  left: readonly string[],
  right: readonly string[],
  emptyNote: string,
  matchedNote: string,
  missNote: string
): DimensionEvaluation {
  if (left.length === 0 || right.length === 0) {
    return unknownNote(emptyNote);
  }
  const matched = listMatches(left, right);
  if (matched.length === 0) {
    return { ratio: 0, matched: false, unknown: false, note: missNote };
  }
  const coverage = matched.length / Math.min(left.length, right.length);
  const ratio = coverage >= 1 ? 1 : 0.5;
  return {
    ratio,
    matched: true,
    unknown: false,
    note: `${matchedNote}：${matched.slice(0, 4).join("；")}${matched.length > 4 ? " 等" : ""}`
  };
}

function evaluateTeaCategory(target: SimilarityFacet, candidate: SimilarityFacet): DimensionEvaluation {
  const targetText = `${target.tea_type ?? ""} ${target.tea_subtype ?? ""}`.trim();
  const candidateText = `${candidate.tea_type ?? ""} ${candidate.tea_subtype ?? ""}`.trim();
  if (targetText.length === 0 || candidateText.length === 0) {
    return unknownNote("一方未标注茶类，无法判断生熟是否一致（不猜测）");
  }
  const targetRipeness = teaRipeness(targetText);
  const candidateRipeness = teaRipeness(candidateText);
  if (targetRipeness !== null && candidateRipeness !== null) {
    return targetRipeness === candidateRipeness
      ? {
          ratio: 1,
          matched: true,
          unknown: false,
          note: `生熟一致：${targetRipeness === "RAW" ? "生茶" : "熟茶"}`
        }
      : {
          ratio: 0,
          matched: false,
          unknown: false,
          note: "生熟相反，属于完全不同品类"
        };
  }
  if (textMatches(target.tea_type, candidate.tea_type)) {
    return {
      ratio: 0.5,
      matched: true,
      unknown: false,
      note: "茶类一致，但一方未标注生熟，按一半计分"
    };
  }
  return { ratio: 0, matched: false, unknown: false, note: "茶类表述不一致" };
}

function evaluateConcept(target: SimilarityFacet, candidate: SimilarityFacet): DimensionEvaluation {
  if (target.naming.length === 0 || candidate.naming.length === 0) {
    return unknownNote("一方没有产品命名信息，概念维度按 0 分（不猜测）");
  }
  const matched = listMatches(target.naming, candidate.naming);
  if (matched.length > 0) {
    return { ratio: 1, matched: true, unknown: false, note: `命名体系吻合：${matched[0] ?? ""}` };
  }
  const keywords = sharedKeywords(target.naming, candidate.naming, NAMING_SYSTEM_KEYWORDS);
  if (keywords.length > 0) {
    return {
      ratio: 0.5,
      matched: true,
      unknown: false,
      note: `命名体系部分吻合：共同关键词 ${keywords.join("、")}`
    };
  }
  return { ratio: 0, matched: false, unknown: false, note: "命名体系没有交集" };
}

function evaluateOrigin(target: SimilarityFacet, candidate: SimilarityFacet): DimensionEvaluation {
  const mountain = [textOrNull(target.origin.mountain), textOrNull(candidate.origin.mountain)];
  const region = [textOrNull(target.origin.region), textOrNull(candidate.origin.region)];
  const city = [textOrNull(target.origin.city), textOrNull(candidate.origin.city)];
  const province = [textOrNull(target.origin.province), textOrNull(candidate.origin.province)];
  const levels: { name: string; values: (string | null)[]; hit: number }[] = [
    { name: "山头", values: mountain, hit: 1 },
    { name: "茶区", values: region, hit: 0.7 },
    { name: "城市", values: city, hit: 0.5 },
    { name: "省份", values: province, hit: 0.3 }
  ];
  const complete = levels.filter((level) => level.values[0] !== null && level.values[1] !== null);
  if (complete.length === 0) {
    return unknownNote("双方都没有可比的茶区信息，产地维度按 0 分");
  }
  const deepest = complete[0];
  if (!deepest) {
    return unknownNote("双方都没有可比的茶区信息，产地维度按 0 分");
  }
  const [left, right] = deepest.values as [string, string];
  const hit = textMatches(left, right);
  const partial = deepest.name !== "山头";
  const note = hit
    ? `${deepest.name}一致：${left}${partial ? "（一方未标注山头，按可用层级打折）" : ""}`
    : `${deepest.name}不同：${left} ≠ ${right}`;
  return {
    ratio: hit ? deepest.hit : 0,
    matched: hit,
    unknown: partial,
    note
  };
}

function evaluateMaterial(target: SimilarityFacet, candidate: SimilarityFacet): DimensionEvaluation {
  if (target.material.length === 0 || candidate.material.length === 0) {
    return unknownNote("一方没有原料信息，原料维度按 0 分（不推断树龄/树型）");
  }
  const matched = listMatches(target.material, candidate.material);
  if (matched.length > 0) {
    return { ratio: 1, matched: true, unknown: false, note: `原料表述吻合：${matched.join("；")}` };
  }
  const tree = sharedKeywords(target.material, candidate.material, MATERIAL_TREE_KEYWORDS);
  if (tree.length > 0) {
    return { ratio: 1, matched: true, unknown: false, note: `树型关键词一致：${tree.join("、")}` };
  }
  const season = sharedKeywords(target.material, candidate.material, MATERIAL_SEASON_KEYWORDS);
  if (season.length > 0) {
    return {
      ratio: 0.5,
      matched: true,
      unknown: false,
      note: `只有采摘季节一致（${season.join("、")}），树型表述不同，按一半计分`
    };
  }
  return {
    ratio: 0,
    matched: false,
    unknown: false,
    note: "原料表述没有交集，按 0 分（不推断等级）"
  };
}

function evaluateSpecification(target: SimilarityFacet, candidate: SimilarityFacet): DimensionEvaluation {
  const targetWeight = target.weight_g ?? null;
  const candidateWeight = candidate.weight_g ?? null;
  if (targetWeight !== null && candidateWeight !== null) {
    if (Math.round(targetWeight) === Math.round(candidateWeight)) {
      return { ratio: 1, matched: true, unknown: false, note: `规格一致：${Math.round(targetWeight)}g` };
    }
    const gap = Math.abs(targetWeight - candidateWeight) / targetWeight;
    if (gap <= 0.05) {
      return {
        ratio: 0.5,
        matched: true,
        unknown: false,
        note: `规格相近：${Math.round(targetWeight)}g vs ${Math.round(candidateWeight)}g（差 ≤ 5%）`
      };
    }
    return {
      ratio: 0,
      matched: false,
      unknown: false,
      note: `规格不同：${Math.round(targetWeight)}g vs ${Math.round(candidateWeight)}g`
    };
  }
  const targetPieces = target.pieces_per_box ?? null;
  const candidatePieces = candidate.pieces_per_box ?? null;
  if (targetPieces !== null && candidatePieces !== null) {
    return targetPieces === candidatePieces
      ? { ratio: 0.5, matched: true, unknown: true, note: `重量未标注，仅件内数量一致（${targetPieces} 片）` }
      : { ratio: 0, matched: false, unknown: true, note: "重量未标注，件内数量也不一致" };
  }
  return unknownNote("一方没有规格信息，规格维度按 0 分");
}

function evaluateEra(target: SimilarityFacet, candidate: SimilarityFacet): DimensionEvaluation {
  const targetYear = target.year ?? null;
  const candidateYear = candidate.year ?? null;
  if (targetYear === null || candidateYear === null) {
    return unknownNote("一方没有年份信息，年代维度按 0 分");
  }
  if (targetYear === candidateYear) {
    return { ratio: 1, matched: true, unknown: false, note: `年份一致：${targetYear}` };
  }
  if (Math.abs(targetYear - candidateYear) <= 2) {
    return {
      ratio: 0.5,
      matched: true,
      unknown: false,
      note: `年份接近：${targetYear} vs ${candidateYear}（相差 ≤ 2 年）`
    };
  }
  return { ratio: 0, matched: false, unknown: false, note: `年份相差过远：${targetYear} vs ${candidateYear}` };
}

/** 逐维度评估：返回命中度、是否未知与中文解释。 */
export function evaluateSimilarityDimension(
  dimension: SimilarityDimension,
  target: SimilarityFacet,
  candidate: SimilarityFacet
): DimensionEvaluation {
  switch (dimension) {
    case "tea_category":
      return evaluateTeaCategory(target, candidate);
    case "concept":
      return evaluateConcept(target, candidate);
    case "origin":
      return evaluateOrigin(target, candidate);
    case "material":
      return evaluateMaterial(target, candidate);
    case "aroma":
      return listDimension(
        target.aroma,
        candidate.aroma,
        "一方没有香气信息，香气维度按 0 分",
        "香气风格命中",
        "香气风格没有交集"
      );
    case "taste":
      return listDimension(
        target.taste,
        candidate.taste,
        "一方没有滋味信息，滋味维度按 0 分",
        "滋味骨架命中",
        "滋味骨架没有交集"
      );
    case "positioning":
      return listDimension(
        target.positioning,
        candidate.positioning,
        "一方没有市场定位信息，定位维度按 0 分",
        "市场定位命中",
        "市场定位没有交集"
      );
    case "craft":
      return listDimension(
        target.craft,
        candidate.craft,
        "一方没有工艺信息，工艺维度按 0 分",
        "工艺命中",
        "工艺表述没有交集"
      );
    case "specification":
      return evaluateSpecification(target, candidate);
    case "era":
      return evaluateEra(target, candidate);
  }
}

/**
 * §13 可比性评分：总分 100，按十个维度加权。
 * 返回值里的每个维度都带 note，未知维度单独列出，便于人工复核与审计。
 */
export function scoreSimilarity(targetInput: SimilarityFacet, candidateInput: SimilarityFacet): CandidateSimilarity {
  const target = similarityFacetSchema.parse(targetInput);
  const candidate = similarityFacetSchema.parse(candidateInput);
  const evaluated = similarityDimensions.map((dimension) => ({
    dimension,
    evaluation: evaluateSimilarityDimension(dimension, target, candidate)
  }));
  const dimensions = evaluated.map(({ dimension, evaluation }) => {
    const weight = SIMILARITY_DIMENSION_WEIGHTS[dimension];
    return {
      dimension,
      label: SIMILARITY_DIMENSION_LABELS[dimension],
      weight,
      ratio: evaluation.ratio,
      score: Math.round(weight * evaluation.ratio * 10) / 10,
      matched: evaluation.matched,
      note: evaluation.note
    };
  });
  const total = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0));
  const band = similarityBandForScore(total);
  const unknownDimensions = evaluated
    .filter((item) => item.evaluation.unknown)
    .map((item) => item.dimension);
  const matchedDimensions = evaluated
    .filter((item) => item.evaluation.ratio === 1)
    .map((item) => item.dimension);

  const warnings: string[] = [];
  if (unknownDimensions.length > 0) {
    warnings.push(
      `${unknownDimensions.length} 个维度信息缺失（${unknownDimensions
        .map((dimension) => SIMILARITY_DIMENSION_LABELS[dimension])
        .join("、")}）：按 0 分计，未知不等于相似`
    );
  }
  if (total < CANDIDATE_LIMITS.minScoreToStore) {
    warnings.push(`总分低于 §13 拒绝线（${CANDIDATE_LIMITS.minScoreToStore}），不建议作为对标`);
  }
  if (band === "PERIPHERAL_REFERENCE") {
    warnings.push("属于外围参考：只能作为氛围/背景，不得作为价格或价值锚点");
  }
  if (band === "CORE_COMPARABLE") {
    warnings.push("核心对标：可用于 §16 高价值锚点（仍需价格证据达到门槛）");
  }

  return candidateSimilaritySchema.parse({
    total,
    band,
    dimensions,
    matched_dimensions: matchedDimensions,
    unknown_dimensions: unknownDimensions,
    warnings
  });
}

/** 从产品录入字段构建相似度面（不读价格、不读成本）。 */
export function facetFromProductInput(input: SimilarityFacetInput): SimilarityFacet {
  return similarityFacetSchema.parse({
    tea_type: textOrNull(input.tea_type),
    tea_subtype: textOrNull(input.tea_subtype),
    naming: compactList([input.product_name, input.series_name, ...(input.naming ?? [])]),
    origin: {
      province: textOrNull(input.origin_province),
      city: textOrNull(input.origin_city),
      region: textOrNull(input.origin_region),
      mountain: textOrNull(input.mountain),
      village: textOrNull(input.village)
    },
    material: compactList([input.raw_material, input.tree_type, input.season]),
    aroma: compactList(input.aromas ?? []),
    taste: compactList(input.tastes ?? []),
    positioning: compactList(input.positionings ?? []),
    craft: compactList(input.crafts ?? []),
    weight_g: input.weight_g ?? null,
    pieces_per_box: input.pieces_per_box ?? null,
    year: input.year ?? null
  });
}

/** facts 里的字段名由抽取器给出，这里按字段名关键词归类到香气/滋味/定位/工艺。 */
function factValues(extraction: WebExtractionAiOutput, keys: readonly string[]): string[] {
  const values: string[] = [];
  for (const fact of extraction.facts) {
    const field = normalizeComparableText(fact.field);
    if (keys.some((key) => field.includes(normalizeComparableText(key)))) {
      values.push(fact.value);
    }
  }
  return compactList(values);
}

const AROMA_FACT_KEYS = ["aroma", "香气", "干茶", "杯香", "汤香"] as const;
const TASTE_FACT_KEYS = ["taste", "滋味", "口感", "回甘", "生津", "汤感", "浓强度"] as const;
const POSITIONING_FACT_KEYS = ["positioning", "定位", "价格带", "档次", "消费场景"] as const;
const CRAFT_FACT_KEYS = ["craft", "工艺", "杀青", "揉捻", "压制", "发酵", "干燥"] as const;
const MATERIAL_FACT_KEYS = ["material", "原料", "树", "采摘", "season", "季节", "茶区", "山头"] as const;

/** 从网页抽取结果构建候选的相似度面：只搬运网页上写明的字段。 */
export function facetFromExtraction(extraction: WebExtractionAiOutput): SimilarityFacet {
  return similarityFacetSchema.parse({
    tea_type: textOrNull(extraction.tea_type),
    tea_subtype: null,
    naming: compactList([extraction.product_name]),
    origin: {
      province: null,
      city: null,
      region: textOrNull(extraction.origin_region),
      mountain: textOrNull(extraction.mountain),
      village: textOrNull(extraction.village)
    },
    material: compactList([...factValues(extraction, MATERIAL_FACT_KEYS)]),
    aroma: compactList(factValues(extraction, AROMA_FACT_KEYS)),
    taste: compactList(factValues(extraction, TASTE_FACT_KEYS)),
    positioning: compactList(factValues(extraction, POSITIONING_FACT_KEYS)),
    craft: compactList(factValues(extraction, CRAFT_FACT_KEYS)),
    weight_g: extraction.weight_g ?? null,
    pieces_per_box: null,
    year: extraction.year ?? null
  });
}

function clampQuote(quote: string): string {
  const trimmed = quote.trim();
  return trimmed.length <= 600 ? trimmed : `${trimmed.slice(0, 599)}…`;
}

/** 抽取结果 → 候选证据（原话 + 可选来源信息），条数上限见 CANDIDATE_LIMITS。 */
export function evidenceFromExtraction(
  extraction: WebExtractionAiOutput,
  meta: { source_id?: string | null; url?: string | null; domain?: string | null } = {}
): CandidateEvidence[] {
  const evidence: CandidateEvidence[] = [];
  for (const fact of extraction.facts) {
    evidence.push(
      candidateEvidenceSchema.parse({
        kind: "EXTRACTED_FACT",
        field: fact.field,
        value: fact.value,
        quote: clampQuote(fact.quote),
        source_id: meta.source_id ?? null,
        url: meta.url ?? null,
        domain: meta.domain ?? null
      })
    );
  }
  for (const price of extraction.prices) {
    evidence.push(
      candidateEvidenceSchema.parse({
        kind: "PRICE_QUOTE",
        field: "price",
        value: String(price.value),
        quote: clampQuote(price.quote),
        source_id: meta.source_id ?? null,
        url: meta.url ?? null,
        domain: meta.domain ?? null
      })
    );
  }
  const capped = evidence.slice(0, CANDIDATE_LIMITS.maxEvidencePerCandidate);
  return capped.map((item) => candidateEvidenceSchema.parse(item));
}

/** 抽取到的价格 → 候选上的「观察价」原话：只做证据，不参与相似度（§62-4）。 */
export function priceObservationsFromExtraction(
  extraction: WebExtractionAiOutput,
  meta: { source_id?: string | null; url?: string | null } = {}
): CandidatePriceObservation[] {
  return extraction.prices.map((price) =>
    candidatePriceObservationSchema.parse({
      value: price.value,
      currency: price.currency ?? "CNY",
      price_type: price.price_type,
      unit_scope: price.unit_scope ?? null,
      quote: clampQuote(price.quote),
      source_id: meta.source_id ?? null,
      url: meta.url ?? null
    })
  );
}

/** 供 API 自检与前端展示：§13 的十维权重与分档说明。 */
export const SIMILARITY_ENGINE_INFO = {
  spec_ref: "§13 / §42 Agent 4",
  price_in_similarity: false,
  dimensions: similarityDimensions.map((dimension) => ({
    dimension,
    label: SIMILARITY_DIMENSION_LABELS[dimension],
    weight: SIMILARITY_DIMENSION_WEIGHTS[dimension]
  })),
  weight_total: similarityDimensions.reduce(
    (total, dimension) => total + SIMILARITY_DIMENSION_WEIGHTS[dimension],
    0
  )
} as const;
