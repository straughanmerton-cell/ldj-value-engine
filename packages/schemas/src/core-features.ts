/**
 * 核心功能锁定清单（规格 §4、§5、§6、§7、§22）。
 * 这些能力属于需求基线，任何阶段都不得裁掉；此处固化为可被测试与文档引用的常量。
 */
export const CORE_FEATURES = [
  {
    key: "BENCHMARK_MODE",
    name: "Benchmark Mode｜高价值对标模式",
    specRef: "§4.1",
    phase: 7
  },
  {
    key: "CATEGORY_CREATOR_MODE",
    name: "Category Creator Mode｜自建高端标准模式",
    specRef: "§4.2 / §17 / §29",
    phase: 8
  },
  {
    key: "PRODUCT_ARCHITECTURE",
    name: "产品结构叙事 Product Architecture",
    specRef: "§5 / §45",
    phase: 10
  },
  {
    key: "FORMULA_PHILOSOPHY",
    name: "配方哲学 Formula Philosophy",
    specRef: "§6 / §46",
    phase: 11
  },
  {
    key: "INTENSIFY_BUTTON",
    name: "“牛逼化”强化按钮",
    specRef: "§7 / §34",
    phase: 13
  },
  {
    key: "LEVEL5_KING_COPY",
    name: "Level 5 王者话术",
    specRef: "§21 / §22 / §30",
    phase: 12
  }
] as const;

export type CoreFeatureKey = (typeof CORE_FEATURES)[number]["key"];

/**
 * 已交付 Phase 清单（规格 §60 的分期交付顺序）。
 *
 * 进度 UI 用它把「还没开发的阶段」显式标成未交付，
 * 避免把 Phase 4 的研究流水线显示成已经能跑完 Phase 14 的事实审核。
 */
export const DELIVERED_PHASES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export function isPhaseDelivered(phase: number): boolean {
  return DELIVERED_PHASES.includes(phase);
}

export const CORE_NAV_MODULES = [
  "首页",
  "产品中心",
  "AI价值研究",
  "高价值茶数据库",
  "市场价格中心",
  "价值密码库",
  "产品结构",
  "配方哲学",
  "强成交文案",
  "主播中心",
  "经销商培训",
  "龙德记知识库",
  "证据中心",
  "版本管理",
  "系统设置"
] as const;
