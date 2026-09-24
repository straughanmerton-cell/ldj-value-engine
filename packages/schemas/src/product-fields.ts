/**
 * 规格 §10 字段目录。
 *
 * 说明：products 表已按 §10.1–10.5 建列，本文件把这些列抽成可被
 * 「事实清单（product_facts）」与「品饮档案（tasting_profiles）」复用的键目录，
 * 避免各模块各写一套字段名。目录只描述字段与中文标签，不产生任何事实值。
 */

/** 感官字段（规格 §10.4，共 20 项），品饮档案逐项记录。 */
export const SENSORY_FIELDS = [
  { key: "dry_leaf_aroma", label: "干茶香" },
  { key: "hot_cup_aroma", label: "热杯香" },
  { key: "liquor_aroma", label: "汤香" },
  { key: "cold_cup_aroma", label: "冷杯香" },
  { key: "entry_taste", label: "入口滋味" },
  { key: "bitterness", label: "苦感" },
  { key: "astringency", label: "涩感" },
  { key: "sweetness", label: "甜感" },
  { key: "huigan", label: "回甘" },
  { key: "salivation", label: "生津" },
  { key: "cha_qi", label: "茶气" },
  { key: "thickness", label: "厚度" },
  { key: "viscosity", label: "黏稠度" },
  { key: "water_texture", label: "水路" },
  { key: "early_stage", label: "前段" },
  { key: "middle_stage", label: "中段" },
  { key: "late_stage", label: "尾段" },
  { key: "finish", label: "回味" },
  { key: "endurance", label: "耐泡度" },
  { key: "leaf_bottom", label: "叶底" }
] as const;

export type SensoryFieldKey = (typeof SENSORY_FIELDS)[number]["key"];

/** 事实清单分组（用于事实清单分组展示，不是事实状态） */
export const productFactGroups = ["BASICS", "MATERIAL", "CRAFT", "SENSORY", "RND", "OTHER"] as const;
export type ProductFactGroup = (typeof productFactGroups)[number];

export interface FactKeyDefinition {
  readonly key: string;
  readonly label: string;
  readonly group: ProductFactGroup;
}

const factKey = (key: string, label: string, group: ProductFactGroup): FactKeyDefinition => ({ key, label, group });

/**
 * 事实键目录：与 §10.1–10.5 的产品字段一一对应。
 * fact_key 不强制限于本目录（允许录入目录外的补充事实），仅作为默认选项与分组依据；
 * 未在目录中的键按 OTHER 分组处理。
 */
export const FACT_KEY_CATALOG: readonly FactKeyDefinition[] = [
  factKey("product_name", "产品名称", "BASICS"),
  factKey("series_name", "系列名称", "BASICS"),
  factKey("year", "年份", "BASICS"),
  factKey("tea_type", "茶类", "BASICS"),
  factKey("tea_subtype", "茶子类", "BASICS"),
  factKey("origin_province", "省份", "BASICS"),
  factKey("origin_city", "城市", "BASICS"),
  factKey("origin_region", "产区", "BASICS"),
  factKey("mountain", "山头", "BASICS"),
  factKey("village", "村寨", "BASICS"),
  factKey("weight_g", "净重（g）", "BASICS"),
  factKey("pieces_per_box", "每盒饼数", "BASICS"),
  factKey("boxes_per_case", "每件盒数", "BASICS"),
  factKey("suggested_retail_price", "建议零售价", "BASICS"),
  factKey("raw_material", "原料", "MATERIAL"),
  factKey("tree_type", "树型", "MATERIAL"),
  factKey("tree_age", "树龄", "MATERIAL"),
  factKey("season", "季节", "MATERIAL"),
  factKey("harvest_standard", "采摘标准", "MATERIAL"),
  factKey("grade", "等级", "MATERIAL"),
  factKey("blend_description", "拼配说明", "MATERIAL"),
  factKey("material_notes", "原料备注", "MATERIAL"),
  factKey("kill_green_method", "杀青方式", "CRAFT"),
  factKey("rolling_method", "揉捻方式", "CRAFT"),
  factKey("drying_method", "干燥方式", "CRAFT"),
  factKey("pressing_method", "压制方式", "CRAFT"),
  factKey("fermentation_degree", "发酵程度", "CRAFT"),
  factKey("fermentation_method", "发酵方式", "CRAFT"),
  factKey("storage", "仓储", "CRAFT"),
  factKey("processing_notes", "工艺备注", "CRAFT"),
  ...SENSORY_FIELDS.map((field) => factKey(field.key, field.label, "SENSORY")),
  factKey("benchmark_mode_preference", "对标模式偏好", "RND"),
  factKey("has_explicit_benchmark", "是否有明确对标产品", "RND"),
  factKey("has_rnd_reference", "是否有研发参考产品", "RND"),
  factKey("rnd_evidence_available", "是否有内部研发证据", "RND"),
  factKey("r_and_d_reference_notes", "研发参考备注", "RND")
];

const FACT_KEY_GROUP_MAP = new Map<string, ProductFactGroup>(
  FACT_KEY_CATALOG.map((definition) => [definition.key, definition.group])
);

/** 未收录的补充事实键按 OTHER 分组，避免因目录外事实键被拒绝或误分组。 */
export function resolveFactGroup(factKeyValue: string): ProductFactGroup {
  return FACT_KEY_GROUP_MAP.get(factKeyValue) ?? "OTHER";
}

export function findFactKeyDefinition(factKeyValue: string): FactKeyDefinition | undefined {
  return FACT_KEY_CATALOG.find((definition) => definition.key === factKeyValue);
}
