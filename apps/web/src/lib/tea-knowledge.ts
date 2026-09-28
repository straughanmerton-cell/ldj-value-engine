/**
 * 普洱茶卖点知识库（**品类通识，不是这款茶的事实**）。
 *
 * 客户 2026-09-28：「不要这个选项（成交强度），改成一个卖点选择，例如普洱茶里面的每个香型…
 * 每一个茶区的卖点、香型特别直接弄成知识库，做成一个选项卡；包括生茶的卖点、熟茶的卖点…
 * 目的就一个，如何能把产品的卖点介绍写得更好」。
 *
 * 这一层只做两件事，**不碰后端、不碰 Prompt、不改写一个字**：
 * 1. 给「空白页」和「继续改一版」提供**点一下就带方向**的选项（产区风格 / 香型 / 生茶 / 熟茶 / 价值角度）；
 * 2. 把勾中的项拼成一段可读的「需求补充」，随用户的需求一起发出去（`teaPicksPhrase`）。
 *
 * 三条纪律（与 §62 同源，选项不能变成编造事实的入口）：
 * 1. 这里写的是**产区 / 品类通识**（「易武 = 香扬水柔」是行业共识），**不是**在断言这一饼茶是易武、是蜜香；
 *    勾选只代表「我想往这个方向讲」，最终判定仍在 AI 与已录事实那一侧；
 * 2. 树龄 / 山头 / 年份 / 获奖 / 大师这类硬事实必须来自已录记录，勾了也只算方向，
 *    没录入时出稿照旧写【待补充：xxx】（§62-8）；
 * 3. 选项里**不写价格**，也不承诺收益（§62-9 / §62-14）。
 */

export type TeaKnowledgeGroupKey = "region" | "aroma" | "raw" | "ripe" | "angle";

export interface TeaKnowledgeItem {
  /** 全局唯一：`<组>:<标签>`，直接当 React key 与勾选态用 */
  key: string;
  /** 选项名（拼音 / 山头 / 香型 / 卖点） */
  label: string;
  /** 一句话识别度（≤ 14 字）：既当副标题，也会跟在 label 后面拼进需求文本 */
  note: string;
}

export interface TeaKnowledgeGroup {
  key: TeaKnowledgeGroupKey;
  /** 页签名（尽量 4 个字以内，好排） */
  label: string;
  /** 拼进需求文本时的行首名 */
  promptLabel: string;
  /** 这一组是干什么的：一句话，不写空话 */
  hint: string;
  items: TeaKnowledgeItem[];
}

function buildGroup(
  key: TeaKnowledgeGroupKey,
  label: string,
  promptLabel: string,
  hint: string,
  entries: Array<[string, string]>
): TeaKnowledgeGroup {
  return {
    key,
    label,
    promptLabel,
    hint,
    items: entries.map(([itemLabel, note]) => ({
      key: `${key}:${itemLabel}`,
      label: itemLabel,
      note
    }))
  };
}

/**
 * 产区风格：普洱茶最常被讲、也最容易被客户识别的产地标签。
 *
 * 「易武 · 香扬水柔」是行业里说了几十年的共识，所以它敢直接写进选项；
 * 但**这一饼茶是不是易武，要产品方自己说、或由已录事实支撑**——勾选不等于事实（见文件头纪律）。
 */
const TEA_REGION_GROUP = buildGroup(
  "region",
  "产区风格",
  "产区风格",
  "产地风格是卖点最省力的入口：勾了它，AI 会往这个风格找词（等于产地通识，不等于这款茶就是这里）",
  [
    ["易武", "香扬水柔 · 细腻回甘"],
    ["曼松", "香高细甜 · 汤感柔"],
    ["老班章", "霸气山韵 · 回甘迅猛"],
    ["老曼峨", "苦底厚重 · 回甘强烈"],
    ["布朗山", "浓强厚重 · 山韵足"],
    ["那卡", "香高水细 · 竹韵清"],
    ["冰岛", "冰糖甜韵 · 水含香"],
    ["昔归", "岩骨花香 · 汤厚滑"],
    ["景迈", "兰花香显 · 山野甜韵"],
    ["南糯山", "蜜香柔甜 · 回甘快"],
    ["勐宋", "香高水甜 · 山野气"],
    ["巴达山", "野韵蜜香 · 汤感厚"],
    ["攸乐", "香高味醇 · 柔中带劲"],
    ["倚邦", "细柔香高 · 甜醇"],
    ["革登", "香高汤柔 · 均衡"],
    ["蛮砖", "汤厚甜润 · 香内敛"],
    ["莽枝", "香细味柔 · 清甜"],
    ["大雪山", "野韵蜜香 · 汤质厚"],
    ["无量山", "香柔味甜 · 平和"],
    ["勐库", "花果甜醇 · 汤饱满"]
  ]
);

/**
 * 香型：客户点名要的那一类（「普洱茶里面的每个香型」）。
 *
 * 香气是卖点里最好卖的一层：一条正文只要香气说得准，客户就觉得「懂茶」。
 * 但香气**因人因泡而异**，所以选项写成「香型倾向」，勾 1–2 个主香型就够，别贪多。
 */
const TEA_AROMA_GROUP = buildGroup(
  "aroma",
  "香型倾向",
  "香型倾向",
  "香气最好卖，也最容易讲飘：勾 1–2 个主香型就够，不要一次勾满",
  [
    ["蜜香", "蜜糖甜香 · 好原料常见"],
    ["兰花香", "清幽兰香 · 高雅"],
    ["花果香", "花果交织 · 有层次"],
    ["陈香", "岁月陈香 · 老茶标识"],
    ["木香", "木质沉稳 · 老茶常见"],
    ["药香", "药香沉稳 · 陈期感"],
    ["参香", "淡参香 · 老生茶常见"],
    ["樟香", "樟木清香 · 老仓储感"],
    ["荷香", "荷叶清雅 · 细嫩料常见"],
    ["枣香", "红枣甜香 · 熟茶常见"],
    ["焦糖香", "焦糖甜香 · 温润"],
    ["糯香", "糯米甜香 · 顺滑"],
    ["桂圆香", "干桂圆甜 · 醇厚"],
    ["杏仁香", "杏仁微苦 · 回甜"],
    ["烟香", "松烟柴火 · 个性鲜明"],
    ["菌香", "老茶菌韵 · 层次丰富"],
    ["山野气", "山场气息 · 乔木感"],
    ["青味", "新茶青气 · 陈放会散"]
  ]
);

/** 生茶卖点（客户 2026-09-28 追加：「包括生茶的卖点」）。 */
const TEA_RAW_GROUP = buildGroup(
  "raw",
  "生茶卖点",
  "生茶要突出的点",
  "生茶卖点清单：勾 2–4 条，正文自然会往这些点聚，别一条都不勾",
  [
    ["回甘生津", "苦尽甘来 · 口腔冒甜"],
    ["茶气足", "体感明显 · 有存在感"],
    ["山野气韵", "高级感的来源"],
    ["苦涩化得快", "原料与工艺见功底"],
    ["汤色金黄透亮", "PPT 上一眼看得见"],
    ["汤感细腻顺滑", "入口柔，不锁喉"],
    ["香气高扬", "香高扬 · 有辨识度"],
    ["水含香", "香溶于汤 · 喝得到甜"],
    ["汤水稠厚", "有胶质感 · 不寡淡"],
    ["冷杯香显", "杯底留香 · 久不散"],
    ["层次变化", "一泡一个样"],
    ["后期转化空间", "越陈越香的潜力"],
    ["新茶鲜爽", "春茶的活力"],
    ["喉韵深长", "喉咙回甘不断"],
    ["耐泡度高", "十几泡不掉水"]
  ]
);

/** 熟茶卖点（客户 2026-09-28 追加：「熟茶的卖点是什么」）。 */
const TEA_RIPE_GROUP = buildGroup(
  "ripe",
  "熟茶卖点",
  "熟茶要突出的点",
  "熟茶卖点清单：讲熟茶只有三个字最管用——顺、甜、干净；再挑 1–2 条加厚",
  [
    ["醇厚顺滑", "入口不扎不涩"],
    ["甜润不苦", "大众都喝得顺"],
    ["汤色红浓明亮", "一眼看出好熟茶"],
    ["陈香纯正", "干净、没有杂味"],
    ["糯香枣香", "甜香最讨喜"],
    ["米汤感稠滑", "汤感有厚度"],
    ["无堆味", "干净是熟茶第一关"],
    ["暖胃体感", "温和舒服"],
    ["金毫显露", "干茶就好看"],
    ["年份陈化", "时间堆出来的醇"],
    ["宫廷细嫩料", "料细、汤更糯"],
    ["日常口粮", "好喝不心疼"],
    ["耐煮耐泡", "煮着喝更甜 · 口粮友好"],
    ["叶底油润匀整", "料好不好看得见"],
    ["陈韵悠长", "喝完嘴巴舒服 · 不留杂"]
  ]
);

/**
 * 价值角度：把卖点「吹大」时真正撑得住高度的几项。
 *
 * 注意：这一组里**每一项都是硬事实的入口**（树龄 / 年份 / 工艺 / 稀缺 / 背书）。
 * 勾选只表示「我想往这个角度讲」——产品方没录入的，AI 仍然写【待补充：xxx】（§62-8）。
 */
const TEA_ANGLE_GROUP = buildGroup(
  "angle",
  "价值角度",
  "想突出的价值角度",
  "价值高度靠这几项撑：勾了表示你想往这个角度讲，没录入的硬事实 AI 仍会写【待补充】",
  [
    ["古树纯料", "稀缺性最强的一档"],
    ["单株", "一棵树一饼 · 极少"],
    ["头春", "一年只采这一季"],
    ["乔木大树", "树龄感 · 用料硬"],
    ["拼配配方", "有配方就是有体系"],
    ["干仓储存", "干净 · 转化好"],
    ["年份老茶", "时间堆出来的厚度"],
    ["稀缺限量", "就这么多饼"],
    ["正山原料", "山头正、来路清"],
    ["手工石磨", "工艺情怀"],
    ["传统晒青", "工艺正宗"],
    ["收藏级", "越放越有价值感"],
    ["送礼体面", "拿得出手"],
    ["品牌背书", "须有已录事实支撑"]
  ]
);

/** 选项分组固定顺序（页签名 ≥ 4 个字时会被压窄，别再往里塞字）。 */
export const TEA_KNOWLEDGE_GROUPS: TeaKnowledgeGroup[] = [
  TEA_REGION_GROUP,
  TEA_AROMA_GROUP,
  TEA_RAW_GROUP,
  TEA_RIPE_GROUP,
  TEA_ANGLE_GROUP
];

/** 勾选 / 取消勾选（返回新数组，不改原数组）。 */
export function toggleTeaPick(picks: string[], key: string): string[] {
  return picks.includes(key) ? picks.filter((item) => item !== key) : [...picks, key];
}

/** 某一组里勾了几项（页签上的小圆点用）。 */
export function teaPickedKeys(group: TeaKnowledgeGroup, picks: string[]): string[] {
  return group.items.filter((item) => picks.includes(item.key)).map((item) => item.key);
}

/**
 * 把勾中的项拼成一段可读的「需求补充」，随需求一起发给 AI。
 *
 * 三条纪律写进正文第一行，免得模型把这些选项当成已确认事实（§62-5 / §62-8）；
 * 一条都没勾时返回空串，调用方**不要**再拼空段落。
 */
export function teaPicksPhrase(picks: string[]): string {
  const lines = TEA_KNOWLEDGE_GROUPS.flatMap((group) => {
    const chosen = group.items.filter((item) => picks.includes(item.key));
    if (chosen.length === 0) {
      return [];
    }
    const text = chosen.map((item) => `${item.label}（${item.note}）`).join("、");
    return [`${group.promptLabel}：${text}`];
  });
  if (lines.length === 0) {
    return "";
  }
  return [
    "【我勾的卖点方向（只是方向：没有录入的硬事实仍然写【待补充：xxx】）】",
    ...lines
  ].join("\n");
}

/**
 * 把「用户写的需求」与「勾选的卖点方向」合成一条消息。
 *
 * 顺序刻意是**需求在前、方向在后**：先让模型看懂人要什么，再补素材；
 * 两边都空时返回空串，交给调用方判 `canSend`。
 */
export function composeRequirement(draft: string, picks: string[], spec?: TeaSpecInput): string {
  const base = draft.trim();
  const specLine = teaSpecPhrase(spec);
  const extra = teaPicksPhrase(picks);
  const parts = [base, specLine, extra].filter((part) => part.length > 0);
  return parts.join("\n\n");
}

/** 用户在卖点页里**明确填写**的产品规格（年份 / 克数）：这是产品方自报的事实，只原样用，不扩写。 */
export interface TeaSpecInput {
  year?: string;
  weight?: string;
}

/**
 * 把「年份 / 克数」拼成一段「产品方自报规格」，随需求发给 AI。
 *
 * 与卖点方向不同：这两项是用户明确给出的数字 / 单位，**可以当事实用**；
 * 但仍只允许使用这里出现的数字与单位，山头 / 树龄 / 价格等其余硬事实照旧写【待补充：xxx】。
 * 两项都空时返回空串，调用方不要拼空段落。
 */
export function teaSpecPhrase(spec?: TeaSpecInput): string {
  const year = spec?.year?.trim();
  const weight = spec?.weight?.trim();
  const parts: string[] = [];
  if (year) {
    parts.push(`年份：${year}`);
  }
  if (weight) {
    parts.push(`克数 / 规格：${weight}`);
  }
  if (parts.length === 0) {
    return "";
  }
  return [
    "【产品方本次自报的规格（仅使用下面明确给出的数字与单位，其余硬事实仍写【待补充：xxx】）】",
    ...parts
  ].join("\n");
}
