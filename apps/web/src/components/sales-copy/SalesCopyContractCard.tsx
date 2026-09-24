import type { ReactElement } from "react";
import type {
  CopyIntensityMeta,
  SalesCopyContract,
  SalesCopyDownstreamItem,
  SalesCopyEngineInfo
} from "../../lib/sales-copy.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface SalesCopyContractCardProps {
  contract: SalesCopyContract | null;
  engine: SalesCopyEngineInfo | null;
  downstream: SalesCopyDownstreamItem[];
  loading: boolean;
  error: string | null;
  /** 默认展开：口径是这个模块的必读内容，不是补充说明。 */
  open: boolean;
  onToggle: () => void;
}

function tonePill(tone: CopyIntensityMeta["tone"]): "neutral" | "info" | "warn" | "brand" | "ok" {
  return tone;
}

/**
 * 强成交话术合同卡（规格 §21 / §22 / §23 / §26 / §27 / §33 / §34 / §47）。
 *
 * 这张卡要让人在动手之前先看懂五件事：
 * 1. §21 的五档强度是固定的（研究 / 专业 / 强销售 / 直播爆款 / 王者），默认 Level 4，不得增删或重排；
 * 2. §23 八项评分合计 100：Level 4 ≥ 85、Level 5 ≥ 90，< 70 自动重写、不得发布；
 * 3. §22 Level 5 七项强制，缺一项就不是王者话术；
 * 4. §22 没有可靠价格锚点时，价格高度叙事必须逐字改用标准句，且不得写任何具体价格故事；
 * 5. §34「再狠一点」最多自动增强 3 次，且每次都不允许增加新事实。
 */
export function SalesCopyContractCard({
  contract,
  engine,
  downstream,
  loading,
  error,
  open,
  onToggle
}: SalesCopyContractCardProps): ReactElement {
  const levels = contract?.levels ?? [];
  const outputs = contract?.outputs ?? [];
  const scoreItems = contract?.impact_score.items ?? [];

  return (
    <Card
      title="强成交话术合同"
      spec="§21 / §22 / §23 / §26 / §27 / §33 / §34 / §47"
      subtitle="这张表决定「主播拿起来怎么讲、讲到多狠」，前端不另写一套口径。"
      actions={
        <>
          <Pill tone="neutral">{levels.length || 5} 档强度</Pill>
          <Pill tone="neutral">§26 {outputs.length || 9} 种输出</Pill>
          <Pill tone="neutral">§23 评分 {contract?.impact_score.max ?? 100} 分制</Pill>
          <button type="button" className="secondary sm" onClick={onToggle}>
            {open ? "收起合同" : "展开合同"}
          </button>
        </>
      }
    >
      {loading && !contract ? <LoadingState label="正在读取强成交话术合同" /> : null}
      {error && !contract ? <ErrorState title="合同读取失败" description={error} /> : null}

      {contract ? (
        <>
          <div className="alert info">
            §24 明文：<strong>允许极强修辞（反问 / 比喻 / 排比 / 对比 / 身份塑造 / 情绪放大）</strong>，
            但只要一个字编了事实、编了价格或承诺了收益，整版直接判 RED、不得发布。没有可靠价格锚点时，
            价格高度叙事必须逐字改用 §22 标准句（§22 / §25 / §62-11）。
          </div>

          {!open ? (
            <p className="muted mt-2">
              展开后可查看五档强度与各自要求、§7 牛逼化按钮映射、§23 八项评分与分档、§22 Level 5 七项、
              §26 九种输出、§27 三分钟八段、§33 价值重点八项、实现红线、规则清单与下游 Phase 交接。
            </p>
          ) : (
            <>
              <div className="sub-title mt-3">§21 五档强度（顺序固定，默认 Level 4）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>档位</th>
                      <th>它在做什么</th>
                      <th>必须满足什么</th>
                      <th>规格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levels.map((level) => (
                      <tr key={level.level}>
                        <td className="nowrap">
                          <Pill tone={tonePill(level.tone)}>{level.label}</Pill>
                          <div className="muted mono mt-1">Level {level.level}</div>
                          {level.is_king ? <Pill tone="outline">王者档</Pill> : null}
                        </td>
                        <td>{level.definition}</td>
                        <td className="muted">{level.requirement}</td>
                        <td className="nowrap muted">{level.spec_ref}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">§7 / §34 牛逼化按钮（「再狠一点」）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>按钮档</th>
                      <th>映射强度</th>
                      <th>它的含义</th>
                      <th>规格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.intensify_button.levels.map((button) => (
                      <tr key={button.level}>
                        <td className="nowrap mono">{button.level}</td>
                        <td className="nowrap">
                          <Pill tone="info">
                            Level {button.copy_intensity}｜{button.label}
                          </Pill>
                        </td>
                        <td className="muted">{button.note}</td>
                        <td className="nowrap muted">{button.spec_ref}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="alert warn mt-2">
                {contract.intensify_button.note}（最多自动增强 {contract.intensify_button.max_auto_rounds} 轮，
                每次都要重新评分；强化只新增版本、源版本原封不动保留，且**一条新事实都不许增加**）。
              </div>

              <div className="sub-title mt-4">§48 Agent 10 八项自检（缺一项都不算达标）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>自检项</th>
                      <th>它看什么</th>
                      <th>复用 §23 的哪几条机械判定</th>
                      <th>规格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(contract.intensify_button.self_check ?? []).map((item) => (
                      <tr key={item.key}>
                        <td className="nowrap">
                          {item.label}
                          {item.negative ? <Pill tone="outline">负向检查</Pill> : null}
                          <div className="muted mono mt-1">{item.key}</div>
                        </td>
                        <td>{item.check}</td>
                        <td className="muted mono">
                          {item.criteria.length > 0 ? item.criteria.join(" / ") : "—"}
                        </td>
                        <td className="nowrap muted">{item.spec_ref}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted mt-2">
                {contract.intensify_button.fact_rule ??
                  "强化后的正文逐字回查到的引用清单必须是源版本的子集：不许出现源版本没用过的已录入事实（不增加新事实，多一条就拒绝落库）；源版本已经引用的已录入事实如果被改写写弱，会写进新版本的自动备注供人工抽查（§34）。"}
              </p>

              <div className="sub-title mt-4">§23 成交冲击力八项评分（合计 100）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>评分项</th>
                      <th>权重</th>
                      <th>它在成稿里对应什么</th>
                      <th>打分依赖</th>
                      <th>逐条机械判定</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoreItems.map((item) => (
                      <tr key={item.key}>
                        <td className="nowrap">
                          <strong>{item.label}</strong>
                          <div className="muted mono mt-1">{item.key}</div>
                        </td>
                        <td className="nowrap">{item.weight} 分</td>
                        <td>{item.criterion}</td>
                        <td className="muted">{item.source}</td>
                        <td>
                          <ul className="muted">
                            {item.criteria.map((criterion) => (
                              <li key={criterion.key}>
                                {criterion.check}（{criterion.points} 分）
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">§23 分档与最低分要求</div>
              <div className="chip-list">
                {contract.impact_score.bands.map((band) => (
                  <span className="chip" key={band.band}>
                    {band.label}：{band.note}
                  </span>
                ))}
                <span className="chip">Level 4 必须 ≥ {contract.impact_score.min_score_by_intensity[4] ?? 85} 分</span>
                <span className="chip">Level 5 必须 ≥ {contract.impact_score.min_score_by_intensity[5] ?? 90} 分</span>
                <span className="chip">研究 / 专业 / 强销售档不设硬性分数门槛</span>
              </div>

              <div className="sub-title mt-4">
                §22 Level 5 七项强制（共 {contract.level5_requirement_count} 项，缺一项就不是王者话术）
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>强制项</th>
                      <th>要求</th>
                      <th>怎么判定</th>
                      <th>看哪个字段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.level5_requirements.map((requirement) => (
                      <tr key={requirement.key}>
                        <td className="nowrap">
                          <strong>{requirement.label}</strong>
                          <div className="muted mono mt-1">{requirement.key}</div>
                        </td>
                        <td>{requirement.requirement}</td>
                        <td className="muted">{requirement.check}</td>
                        <td className="muted mono">{requirement.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">§26 九种输出（缺一种即输出未完成）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>输出</th>
                      <th>数量要求</th>
                      <th>来自哪个字段</th>
                      <th>规格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outputs.map((output, index) => (
                      <tr key={output.key}>
                        <td className="nowrap muted">{index + 1}</td>
                        <td className="nowrap">
                          <strong>{output.label}</strong>
                          <div className="muted mono mt-1">{output.key}</div>
                        </td>
                        <td>{output.requirement}</td>
                        <td className="muted mono">{output.source}</td>
                        <td className="nowrap muted">{output.spec_ref}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">§27 三分钟八段时序</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>这一段</th>
                      <th>它必须完成什么</th>
                      <th>三分钟稿里看什么</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.min3_timeline.map((segment) => (
                      <tr key={segment.key}>
                        <td className="nowrap mono">{segment.time_range}</td>
                        <td className="nowrap">{segment.label}</td>
                        <td>{segment.requirement}</td>
                        <td className="muted mono">{segment.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">§33 价值重点八项（默认全选）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>价值重点</th>
                      <th>它要讲什么</th>
                      <th>允许引用的事实</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.value_focus.map((focus) => (
                      <tr key={focus.key}>
                        <td className="nowrap">
                          <strong>{focus.label}</strong>
                          <div className="muted mono mt-1">{focus.key}</div>
                        </td>
                        <td>{focus.requirement}</td>
                        <td>
                          <div className="chip-list">
                            {focus.evidence_refs.map((ref) => (
                              <span className="chip derived mono" key={ref}>
                                {ref}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">实现红线（缺一条都不算交付）</div>
              <div className="chip-list">
                <span className="chip">
                  无锚点不降级成平庸版：{contract.no_anchor_not_weak ? "已开启" : "未开启"}
                </span>
                <span className="chip">强化不新增事实：{contract.no_new_fact ? "已开启" : "未开启"}</span>
                <span className="chip">
                  研发关系需 RND_CONFIRMED：{contract.rnd_requires_confirmation ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  价格高度叙事仅在有锚点时：{contract.price_story_only_with_anchor ? "已开启" : "未开启"}
                </span>
                <span className="chip">允许极强修辞：{contract.rhetoric_allowed ? "已开启" : "未开启"}</span>
                <span className="chip">RED 禁止发布：{contract.red_blocks_publish ? "已开启" : "未开启"}</span>
                <span className="chip">正文不得写成说明书：{contract.no_manual_style ? "已开启" : "未开启"}</span>
                <span className="chip">所有版本必须保留：{contract.keep_all_versions ? "已开启" : "未开启"}</span>
                <span className="chip">
                  本阶段不接 AI：{engine ? (engine.ai_wired ? "已接线" : "未接线（纯规则引擎）") : "未知"}
                </span>
                <span className="chip">引擎策略：{engine?.strategy ?? "RULE_BASED"}</span>
              </div>

              <div className="sub-title mt-4">§22 无价格锚点时的标准句（逐字，不得改写）</div>
              <p className="quote">{contract.no_anchor_standard_sentence}</p>

              <div className="sub-title mt-4">十条规则</div>
              <ol>
                {contract.rules.map((rule) => (
                  <li key={rule} className="muted">
                    {rule}
                  </li>
                ))}
              </ol>

              <div className="sub-title mt-4">下游交接（§60：本阶段只登记，不得显示为已完成）</div>
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
              {downstream.length === 0 ? (
                <EmptyState title="暂无下游交接记录" description="合同接口未返回下游 Phase 列表。" />
              ) : null}

              <Alert tone="warn">
                {engine?.note ??
                  "Phase 13 仍为纯规则引擎：只把已录入事实与上游成稿写成成交稿，「再狠一点」也只换说法、不换事实，不调用 AI。"}
              </Alert>
              {engine ? (
                <p className="muted">
                  引擎：{engine.name}　｜　已登记 Prompt：{engine.prompt_keys.join(" / ")}
                  （Prompt 正文已固化，接入 AI 时直接生效；本阶段全部走规则实现）
                </p>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Card>
  );
}
