import type { ReactElement } from "react";
import {
  MIN3_SEGMENT_ORDER,
  SALES_COPY_OUTPUT_ORDER,
  outputLabel,
  type Min3SegmentView,
  type SalesCopyLabels,
  type SalesCopyRecordView
} from "../../lib/sales-copy.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, Pill } from "../ui/State.js";

export interface SalesCopyOutputPanelsProps {
  record: SalesCopyRecordView | null;
  labels: SalesCopyLabels | null;
}

/** 文案骨架 13 格的展示顺序与中文标签：与 §23 八项评分逐格对应，缺哪格一眼可见。 */
const HEADLINE_ROWS: { key: keyof SalesCopyRecordView["headline"]; label: string; spec: string }[] = [
  { key: "one_liner", label: "一句话定位", spec: "§47" },
  { key: "opening_hook", label: "开场钩子（3 秒抓人）", spec: "§23 / §48" },
  { key: "identity_definition", label: "身份定义（它不是 X，它是 Y）", spec: "§22" },
  { key: "price_or_standard_story", label: "价格高度叙事 / 自建标准句", spec: "§22 / §25" },
  { key: "value_story", label: "价值故事", spec: "§23 / §47" },
  { key: "product_architecture_story", label: "产品结构叙事", spec: "§5 / §22" },
  { key: "formula_philosophy_story", label: "配方哲学故事", spec: "§6 / §22" },
  { key: "style_identity", label: "风格身份证", spec: "§4.2 / §22" },
  { key: "differentiation", label: "差异化", spec: "§8 / §23" },
  { key: "imagery", label: "画面感", spec: "§8 / §23" },
  { key: "memory_point", label: "记忆点", spec: "§22 / §23" },
  { key: "who_for", label: "适合谁讲给谁", spec: "§27 / §52" },
  { key: "closing", label: "成交收口", spec: "§22 / §23" }
];

/**
 * §26 / §27 / §47 输出面板。
 *
 * 这一块是「主播拿起来就能讲」的正面：骨架十三格、九种输出的完成状态、5 句核心金句与 20 句备用金句、
 * 15 / 30 / 60 秒与 3 分钟四档稿、Level 5 新品发布稿、经销商版与异议处理。
 *
 * 每一项都标出它对应的规格，以及九种输出里哪一种还没完成——**输出缺一种就不算交付**（§26 / §57）。
 */
export function SalesCopyOutputPanels({
  record,
  labels
}: SalesCopyOutputPanelsProps): ReactElement {
  if (!record) {
    return (
      <Card title="九种输出与文案骨架（§26 / §27）" spec="§26 / §27 / §47">
        <EmptyState
          title="还没有生成强成交话术"
          description="生成之后这里会给出骨架十三格、九种输出、四档时长稿、经销商版与异议处理。"
        />
      </Card>
    );
  }

  const statuses = SALES_COPY_OUTPUT_ORDER.map((key) =>
    record.output_statuses.find((item) => item.key === key)
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const doneCount = statuses.filter((item) => item.status === "DONE").length;
  const agent9Outputs = labels?.agent9_outputs ?? [];
  const segments: Min3SegmentView[] = MIN3_SEGMENT_ORDER.map((key) =>
    record.scripts.min3.segments.find((segment) => segment.key === key)
  ).filter((segment): segment is Min3SegmentView => Boolean(segment));

  return (
    <div className="stack">
      <Card
        title="文案骨架十三格（§47）"
        spec="§47 / §23"
        subtitle="每一格正好对应 §23 的一项评分；空着的格子不是「可以后面补」，而是这一版还没写成。"
        actions={
          <Pill tone={record.headline.closing ? "ok" : "warn"}>
            {HEADLINE_ROWS.filter((row) => record.headline[row.key].length > 0).length} /{" "}
            {HEADLINE_ROWS.length} 格已写
          </Pill>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>格子</th>
                <th>成稿内容</th>
                <th>规格</th>
              </tr>
            </thead>
            <tbody>
              {HEADLINE_ROWS.map((row) => (
                <tr key={row.key}>
                  <td className="nowrap">
                    <strong>{row.label}</strong>
                    <div className="muted mono mt-1">{row.key}</div>
                  </td>
                  <td>
                    {record.headline[row.key] ? (
                      <span className="quote">{record.headline[row.key]}</span>
                    ) : (
                      <Pill tone="warn">空缺</Pill>
                    )}
                  </td>
                  <td className="nowrap muted">{row.spec}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="§26 九种输出"
        spec="§26 / §57"
        subtitle="5 句核心金句 / 20 句备用金句 / 15 秒 / 30 秒 / 60 秒 / 3 分钟 / Level 5 新品发布 / 经销商版 / 异议处理——缺一种即输出未完成。"
        actions={
          <Pill tone={record.acceptance.outputs_complete ? "ok" : "danger"}>
            {doneCount} / {SALES_COPY_OUTPUT_ORDER.length} 已完成
          </Pill>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>输出</th>
                <th>要求</th>
                <th>状态</th>
                <th>数量 / 字数</th>
              </tr>
            </thead>
            <tbody>
              {statuses.map((status, index) => (
                <tr key={status.key}>
                  <td className="nowrap muted">{index + 1}</td>
                  <td className="nowrap">
                    <strong>{status.label || outputLabel(status.key, labels)}</strong>
                    <div className="muted mono mt-1">{status.key}</div>
                  </td>
                  <td className="muted">{status.requirement}</td>
                  <td className="nowrap">
                    <Pill tone={status.status === "DONE" ? "ok" : "danger"}>
                      {status.status === "DONE" ? "已完成" : "缺失"}
                    </Pill>
                  </td>
                  <td className="nowrap muted">
                    {status.count} 条 / {status.chars} 字
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!record.acceptance.outputs_complete ? (
          <Alert tone="warn">
            缺失输出：
            {record.acceptance.missing_outputs.map((key) => outputLabel(key, labels)).join(" / ")}
            。九种输出是 §26 的硬性要求，补齐之前这一版不能当成交付稿使用。
          </Alert>
        ) : null}
      </Card>

      <Card
        title="金句库（§26）"
        spec="§26 / §48"
        subtitle="5 句核心金句用来打穿记忆点，20 句备用金句用来换着讲、剪短视频。每一句都必须能回查到本产品已录入事实。"
        actions={
          <>
            <Pill tone="brand">核心 {record.quotes.core_quotes.length} 句</Pill>
            <Pill tone="neutral">备用 {record.quotes.backup_quotes.length} 句</Pill>
          </>
        }
      >
        <div className="sub-title">核心金句（必须 5 句）</div>
        <ol>
          {record.quotes.core_quotes.map((quote, index) => (
            <li key={`core-${index}`}>
              <span className="quote">{quote}</span>
            </li>
          ))}
        </ol>
        <div className="sub-title mt-3">备用金句（必须 20 句）</div>
        <ol className="grid-2">
          {record.quotes.backup_quotes.map((quote, index) => (
            <li key={`backup-${index}`}>
              <span className="quote">{quote}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card
        title="四档时长稿（§26 / §27）"
        spec="§26 / §27"
        subtitle="15 秒抓人、30 秒立身份、60 秒讲清价值逻辑、3 分钟按八段时序完整讲一遍。"
      >
        <div className="grid-3">
          <div>
            <div className="sub-title">15 秒稿</div>
            <pre className="code-block">{record.scripts.sec15}</pre>
          </div>
          <div>
            <div className="sub-title">30 秒稿</div>
            <pre className="code-block">{record.scripts.sec30}</pre>
          </div>
          <div>
            <div className="sub-title">60 秒稿</div>
            <pre className="code-block">{record.scripts.sec60}</pre>
          </div>
        </div>

        <div className="sub-title mt-4">3 分钟八段时序（§27）</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>这一段</th>
                <th>它必须完成什么</th>
                <th>成稿</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => (
                <tr key={segment.key}>
                  <td className="nowrap mono">{segment.time_range}</td>
                  <td className="nowrap">
                    <strong>{segment.label}</strong>
                    <div className="muted mono mt-1">{segment.key}</div>
                  </td>
                  <td className="muted">{segment.requirement}</td>
                  <td>
                    {segment.text ? (
                      <span className="quote">{segment.text}</span>
                    ) : (
                      <Pill tone="warn">空缺</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sub-title mt-3">3 分钟稿全文</div>
        <pre className="code-block">{record.scripts.min3.text}</pre>
      </Card>

      <div className="grid-2">
        <Card
          title="Level 5 新品发布稿"
          spec="§22 / §30"
          subtitle="王者档的发布稿：身份、价值、结构与收口一次讲完，主播可以直接照读。"
          actions={
            <Pill tone={record.level5_release ? "ok" : "danger"}>
              {record.level5_release ? `${record.level5_release.length} 字` : "缺失"}
            </Pill>
          }
        >
          {record.level5_release ? (
            <pre className="code-block">{record.level5_release}</pre>
          ) : (
            <Alert tone="warn">本版未生成 Level 5 发布稿（§26 九种输出之一）。</Alert>
          )}
        </Card>

        <Card
          title="经销商版"
          spec="§52"
          subtitle="让经销商清楚产品怎么定位、怎么解释、怎么卖：为什么值这个价，同赛道认知是什么。"
          actions={
            <Pill tone={record.dealer_copy ? "ok" : "danger"}>
              {record.dealer_copy ? `${record.dealer_copy.length} 字` : "缺失"}
            </Pill>
          }
        >
          {record.dealer_copy ? (
            <pre className="code-block">{record.dealer_copy}</pre>
          ) : (
            <Alert tone="warn">本版未生成经销商版（§26 九种输出之一）。</Alert>
          )}
        </Card>
      </div>

      <Card
        title="卖点与异议处理（§26 / §47）"
        spec="§26 / §47 / §57"
        subtitle="卖点最多 7 条，异议最多 8 条；每一条异议都必须给出可核查的回应，而不是含糊一句「放心」。"
        actions={
          <>
            <Pill tone="neutral">卖点 {record.selling_points.length} 条</Pill>
            <Pill tone="neutral">异议 {record.objections.length} 条</Pill>
          </>
        }
      >
        <div className="sub-title">卖点</div>
        <ol>
          {record.selling_points.map((point, index) => (
            <li key={`point-${index}`} className="muted">
              {point}
            </li>
          ))}
        </ol>

        <div className="sub-title mt-3">异议处理</div>
        {record.objections.length === 0 ? (
          <p className="muted">本版没有登记异议处理。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>异议</th>
                  <th>回应</th>
                  <th>层级</th>
                  <th>规格</th>
                </tr>
              </thead>
              <tbody>
                {record.objections.map((item, index) => (
                  <tr key={`objection-${index}`}>
                    <td>{item.objection}</td>
                    <td>
                      <span className="quote">{item.response}</span>
                    </td>
                    <td className="nowrap">
                      <Pill tone={item.layer === "RHETORIC" ? "warn" : "info"}>{item.layer}</Pill>
                    </td>
                    <td className="nowrap muted">{item.spec_ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="§47 Agent 9 十五项输出清单"
        spec="§47 / §26"
        subtitle="Agent 9 强成交文案师必须产出的十五项；本阶段由规则引擎逐项落位，缺哪一项在上面九种输出里会显示为缺失。"
      >
        {agent9Outputs.length === 0 ? (
          <p className="muted">正在读取 §47 输出清单…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>输出</th>
                  <th>来自哪里</th>
                  <th>规格</th>
                </tr>
              </thead>
              <tbody>
                {agent9Outputs.map((output, index) => (
                  <tr key={output.key}>
                    <td className="nowrap muted">{index + 1}</td>
                    <td className="nowrap">
                      <strong>{output.label}</strong>
                      <div className="muted mono mt-1">{output.key}</div>
                    </td>
                    <td className="muted mono">{output.source}</td>
                    <td className="nowrap muted">{output.spec_ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
