import type { ReactElement } from "react";
import {
  CLAIM_TYPE_ORDER,
  FACT_EVIDENCE_KIND_ORDER,
  RISK_LEVEL_ORDER,
  claimTypeLabel,
  claimTypeTone,
  evidenceKindLabel,
  riskLabel,
  riskTone,
  type FactEvidenceKind,
  type FactReviewContract,
  type FactReviewDownstreamItem,
  type FactReviewEngineInfo,
  type FactReviewLabels,
  type FactReviewLimits
} from "../../lib/fact-review.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface FactReviewContractCardProps {
  contract: FactReviewContract | null;
  engine: FactReviewEngineInfo | null;
  downstream: FactReviewDownstreamItem[];
  limits: FactReviewLimits | null;
  labels: FactReviewLabels | null;
  loading: boolean;
  error: string | null;
  /** 默认展开：口径是这个模块的必读内容，不是补充说明。 */
  open: boolean;
  onToggle: () => void;
}

/** §53 五列的填写口径（前端展示用的人话说明，判定本身全部在后端）。 */
const SENTENCE_COLUMN_GUIDE: Record<string, string> = {
  句子: "成稿里逐字切出来的那一句，顺序与 §26 九种输出一致；切分后一句都不许漏。",
  "Claim Type": "§24 三层标记：事实（可逐字回查）/ 解释（讲作用与逻辑）/ 修辞（比喻、反问、身份句）。",
  Risk: "§49 三档：可发布 / 需人工确认 / 禁止发布；RED 即阻断句，直接卡住审批。",
  Evidence: "机械逐字回查的出处（字段路径=逐字值），可点回本产品录入的那条事实；AI 不得增删。",
  修改建议: "不能通过时给出可执行的改法（改写 / 删除 / 先补证据），不给建议的判定不算完成。"
};

/** §49 十三项焦点：每一项对应「必须能点回出处」的那类说法。 */
const FOCUS_GUIDE: Record<string, string> = {
  对标关系: "「跟某款对标产品什么关系」必须有可靠对标证据，不得暗示同款、同配方。",
  研发关系: "只有 RND_CONFIRMED 才允许「研发时曾作为风格参考之一」「团队拆解过它的香气与结构」。",
  配方: "无配方证据时，只能说设计逻辑，不得写「按某款配方做」「同款配方」。",
  原料: "原料 / 用料必须逐字落在已录入字段上，不能加料、换料、抬料。",
  树龄: "树龄只能引用已录入值；不得出现 300 年古树这类未录入数字。",
  山头: "山头 / 产区 / 村寨必须与已录入字段逐字一致，不得换成名山。",
  年份: "年份与仓储必须来自已录入字段，不得虚构年份、干仓 / 头春等表述。",
  历史: "历史沿革、老厂旧事必须有来源，不得凭空编一段传承。",
  价格: "价格高度叙事只在有可靠价格锚点时才允许；没有锚点逐字改用 §22 标准句。",
  市场第一: "「市场第一 / 全国第一 / 销量第一」一律 RED。",
  最贵: "「最贵 / 只有它 / 绝无仅有」一律 RED。",
  唯一: "「唯一 / 独一无二」这类排他断言没有证据一律 RED。",
  投资回报: "「必涨 / 稳赚 / 保值 / 未来到某价 / 固定回报」一律 RED。"
};

/**
 * 事实审核合同卡（规格 §24 / §25 / §49 / §53 / §57）。
 *
 * 这张卡要让人在动手之前先看懂五件事：
 * 1. §24 三层标记是**句级标记**——修辞不是事实造假，比喻 / 反问 / 排比 / 身份塑造本身不判 RED；
 * 2. §49 三档风险里只有 RED 是阻断句：存在任何一条就禁止审批、禁止发布；
 * 3. §53 每一句都必须给出 `句子 / Claim Type / Risk / Evidence / 修改建议` 五列；
 * 4. §25 没有 RND_CONFIRMED 时的研发关系暗示、以及「复刻 X / 同款配方」一律 RED；
 * 5. AI（Agent 11）只能在这套机械结论上加严，判出的 RED 不会被洗白（§62-14）。
 */
export function FactReviewContractCard({
  contract,
  engine,
  downstream,
  limits,
  labels,
  loading,
  error,
  open,
  onToggle
}: FactReviewContractCardProps): ReactElement {
  const claimTypes = contract?.claim_types ?? [];
  const riskLevels = contract?.risk_levels ?? [];
  const focusItems = contract?.focus_items ?? [];
  const evidenceKinds = contract?.evidence_kinds ?? [];
  const sentenceColumns = contract?.sentence_columns ?? [];
  const maxVersions = limits?.maxVersionsPerCopy ?? labels?.limits.maxVersionsPerCopy ?? null;

  return (
    <Card
      title="事实审核合同"
      spec="§24 / §25 / §49 / §53 / §57"
      subtitle="这张表决定「哪句话不能对外讲」，前端不另写一套口径。"
      actions={
        <>
          <Pill tone="neutral">{claimTypes.length || 3} 层标记</Pill>
          <Pill tone="neutral">§49 {focusItems.length || 13} 项焦点</Pill>
          <Pill tone="neutral">§53 {sentenceColumns.length || 5} 列逐句表</Pill>
          <button type="button" className="secondary sm" onClick={onToggle}>
            {open ? "收起合同" : "展开合同"}
          </button>
        </>
      }
    >
      {loading && !contract ? <LoadingState label="正在读取事实审核合同" /> : null}
      {error && !contract ? <ErrorState title="合同读取失败" description={error} /> : null}

      {contract ? (
        <>
          <div className="alert info">
            §24 明文：<strong>修辞不是事实造假</strong>——比喻、反问、排比、身份塑造可以极强；
            唯一的关键检查是「会不会让消费者误以为存在一个并不存在的可核验事实」。
            但只要有 RED 阻断句，这一版就<strong>禁止审批、禁止发布</strong>（§49 / §53 / §57）。
          </div>

          {!open ? (
            <p className="muted mt-2">
              展开后可查看 §24 三层标记与各自口径、§49 三档风险、审批状态、证据类型、
              §53 五列逐句表、§49 十三项重点、实现红线、十条规则与下游 Phase 交接。
            </p>
          ) : (
            <>
              <div className="sub-title mt-3">§24 三层标记（句级标记，顺序固定）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>标记</th>
                      <th>它在说什么</th>
                      <th>怎么判定</th>
                      <th>规格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CLAIM_TYPE_ORDER.map((key) => {
                      const meta = claimTypes.find((item) => item.key === key);
                      return (
                        <tr key={key}>
                          <td className="nowrap">
                            <Pill tone={claimTypeTone(key)}>
                              {meta?.label ?? claimTypeLabel(key, labels)}
                            </Pill>
                            <div className="muted mono mt-1">{key}</div>
                          </td>
                          <td>{meta?.hint ?? "—"}</td>
                          <td className="muted">
                            {key === "FACT"
                              ? "句子里的硬事实必须能在产品字段或上游成稿里逐字找到；找不到就是缺口。"
                              : key === "INTERPRETATION"
                                ? "讲事实起了什么作用（提供 / 撑起 / 决定 / 因此），不新增硬事实。"
                                : "机械特征：反问、比喻、身份句、对比句；允许极限，但不许让人误以为有可核验事实。"}
                          </td>
                          <td className="nowrap muted">{meta?.spec_ref ?? "§24"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">§49 三档风险（RED = 阻断句，禁止审批）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>风险</th>
                      <th>含义</th>
                      <th>它怎么影响审批</th>
                      <th>规格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RISK_LEVEL_ORDER.map((key) => {
                      const meta = riskLevels.find((item) => item.key === key);
                      return (
                        <tr key={key}>
                          <td className="nowrap">
                            <Pill tone={riskTone(key)}>{meta?.label ?? riskLabel(key, labels)}</Pill>
                            <div className="muted mono mt-1">{key}</div>
                          </td>
                          <td>{meta?.hint ?? "—"}</td>
                          <td className="muted">
                            {key === "RED"
                              ? "直接阻断：审批接口 400，并把阻断句原文回给前端（§53 / §57）。"
                              : key === "YELLOW"
                                ? "可以发布，但发布前必须人工确认出处；缺出处要改写或删除。"
                                : "机械层面没有发现虚构，正常进入人工审批。"}
                          </td>
                          <td className="nowrap muted">{meta?.spec_ref ?? "§49"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">审批状态与证据类型</div>
              <div className="chip-list">
                {contract.statuses.map((status) => (
                  <span className="chip" key={status.key}>
                    {status.label}（{status.spec_ref}）
                  </span>
                ))}
                {FACT_EVIDENCE_KIND_ORDER.map((kind: FactEvidenceKind) => (
                  <span className="chip derived" key={kind}>
                    {evidenceKindLabel(kind, labels)}
                  </span>
                ))}
              </div>
              <p className="muted mt-1">
                Evidence 只能是**机械逐字回查**的结果：本产品已录入字段 / Value DNA / 上游成稿正文 /
                研发记录里逐字命中才算一条；AI 不得新增、改写或删除证据行（§24 / §46 / §62-14）。
              </p>

              <div className="sub-title mt-4">
                §53 逐句标注页的五列（共 {sentenceColumns.length || 5} 列，缺一列不算交付）
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>列</th>
                      <th>这一列必须写什么</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sentenceColumns.length > 0 ? sentenceColumns : Object.keys(SENTENCE_COLUMN_GUIDE)).map(
                      (column, index) => (
                        <tr key={column}>
                          <td className="nowrap muted">{index + 1}</td>
                          <td className="nowrap">
                            <strong>{column}</strong>
                          </td>
                          <td className="muted">{SENTENCE_COLUMN_GUIDE[column] ?? "—"}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">
                §49 十三项重点审核（逐项检查，无据断言一律 RED）
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>审核焦点</th>
                      <th>这一项在看什么</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(focusItems.length > 0 ? focusItems : []).map((item, index) => (
                      <tr key={item}>
                        <td className="nowrap muted">{index + 1}</td>
                        <td className="nowrap">
                          <strong>{item}</strong>
                        </td>
                        <td className="muted">{FOCUS_GUIDE[item] ?? "必须能在本产品自己的资料里逐字回查。"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {focusItems.length === 0 ? (
                <EmptyState
                  title="合同未返回 §49 焦点清单"
                  description="界面不会用本地清单替代后端口径。"
                />
              ) : null}

              <div className="sub-title mt-4">实现红线（缺一条都不算交付）</div>
              <div className="chip-list">
                <span className="chip">
                  修辞不判造假：{contract.rhetoric_not_fraud ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  RED 阻断审批：{contract.red_blocks_approval ? "已开启" : "未开启"}
                </span>
                <span className="chip">修辞可保留：{contract.rhetoric_kept ? "已开启" : "未开启"}</span>
                <span className="chip">
                  所有版本必须保留：{contract.keep_all_versions ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  研发关系需 RND_CONFIRMED：
                  {contract.rnd_requires_confirmation ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  AI 只能加严：{contract.ai_can_only_tighten ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  {maxVersions === null
                    ? "同一版成稿的审核次数上限：以后端返回为唯一准"
                    : `同一版成稿最多保留 ${maxVersions} 次审核`}
                </span>
                <span className="chip">
                  Agent 11：{engine ? (engine.ai_wired ? "已接线" : "未接线（纯规则引擎）") : "未知"}
                </span>
                <span className="chip">
                  纯规则引擎优先：
                  {engine ? (engine.rule_engine_authoritative ? "是" : "否") : "未知"}
                </span>
              </div>

              <div className="sub-title mt-4">十条规则</div>
              <ol>
                {contract.rules.map((rule) => (
                  <li key={rule} className="muted">
                    {rule}
                  </li>
                ))}
              </ol>

              <div className="sub-title mt-4">下游交接（§60：本阶段只登记，不得显示为已完成）</div>
              {downstream.length === 0 ? (
                <EmptyState title="暂无下游交接记录" description="合同接口未返回下游 Phase 列表。" />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Phase</th>
                        <th>交付物</th>
                        <th>规格</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {downstream.map((item) => (
                        <tr key={`${item.phase}-${item.deliverable}`}>
                          <td className="nowrap">Phase {item.phase}</td>
                          <td>{item.deliverable}</td>
                          <td className="nowrap muted">{item.spec_ref}</td>
                          <td className="nowrap">
                            <Pill tone="outline">{item.status}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <Alert tone="info">
                引擎：{engine ? engine.prompt_key : "—"}（
                {engine?.ai_wired ? "已接线，AI 只能加严" : "未接线，纯规则引擎"}）；
                纯规则引擎始终先跑一遍，Agent 11 只能把风险判得更严，判出的 RED 不会被洗成
                GREEN（§62-14）。
              </Alert>
            </>
          )}
        </>
      ) : null}
    </Card>
  );
}
