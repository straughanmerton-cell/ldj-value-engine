import { useState, type ReactElement } from "react";
import {
  approvalStatusLabel,
  deliveryExportBlockedOf,
  downloadExportFile,
  formatDateTime,
  gateStateMetaOf,
  requestDeliveryExport,
  type DeliveryExportBlocked,
  type DeliveryExportFormat,
  type DeliveryExportFormatMeta,
  type DeliveryExportScope,
  type DeliveryExportScopeMeta,
  type DeliveryExportView,
  type DeliveryGate,
  type DeliveryLabels
} from "../../lib/delivery.js";
import { Card } from "../ui/Card.js";
import { Alert, Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";

const FALLBACK_FORMATS: DeliveryExportFormatMeta[] = [
  {
    key: "MARKDOWN",
    label: "Markdown",
    extension: ".md",
    content_type: "text/markdown; charset=utf-8",
    hint: "带标题层级与编号列表，适合贴进飞书 / Notion / 公众号后台"
  },
  {
    key: "TEXT",
    label: "纯文本",
    extension: ".txt",
    content_type: "text/plain; charset=utf-8",
    hint: "去掉所有符号，适合直接进提词器或打印成主播手卡"
  },
  {
    key: "HANDCARD",
    label: "卖点一页纸",
    extension: ".html",
    content_type: "text/html; charset=utf-8",
    hint: "01 介绍 / 02 卖点 / 03 口感特点 / 04 补充清单排成一页纸，浏览器打开即可打印或另存 PDF"
  }
];

const FALLBACK_SCOPES: DeliveryExportScopeMeta[] = [
  { key: "HOST", label: "只要主播中心", hint: "§51 十项：主播自己上台要用的那一份" },
  { key: "DEALER", label: "只要经销商中心", hint: "§52 十项：给经销商 / 终端讲的那一份" },
  { key: "ALL", label: "主播 + 经销商完整资料", hint: "两个中心合成一份文件，默认选项" }
];

export interface DeliveryExportCardProps {
  productId: string;
  token: string | null;
  labels: DeliveryLabels | null;
  gate: DeliveryGate;
  defaultFormat?: DeliveryExportFormat;
  defaultScope?: DeliveryExportScope;
}

/**
 * §60 导出：把已经审过的那一版成稿导成可带走的文件。
 *
 * 三条不允许打折的规则：
 * 1. 导出的是**派生视图**——只做排版，不产生任何新内容，正文逐字来自两个中心（§62-15）；
 * 2. 闸门不通过时后端返回 409，这里把 `gate_label / blocking_sentences / next_action` 原样摆出来，
 *    绝不悄悄导出一份「看起来能用其实没审过」的文件（§53 / §57 / §62-14）；
 * 3. 导出只做三种格式：Markdown 给人看、纯文本给提词器、卖点一页纸（HTML）给客户看与打印；
 *    三种都是只读派生视图，不导出可编辑的 PDF / Word（§62-15）。
 */
export function DeliveryExportCard({
  productId,
  token,
  labels,
  gate,
  defaultFormat = "MARKDOWN",
  defaultScope = "ALL"
}: DeliveryExportCardProps): ReactElement {
  const { notify } = useToast();
  const [format, setFormat] = useState<DeliveryExportFormat>(defaultFormat);
  const [scope, setScope] = useState<DeliveryExportScope>(defaultScope);
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);
  const [blocked, setBlocked] = useState<DeliveryExportBlocked | null>(null);
  const [preview, setPreview] = useState<DeliveryExportView | null>(null);

  const formats = labels?.export_formats?.length ? labels.export_formats : FALLBACK_FORMATS;
  const scopes = labels?.export_scopes?.length ? labels.export_scopes : FALLBACK_SCOPES;
  const formatMeta = formats.find((item) => item.key === format) ?? FALLBACK_FORMATS[0]!;
  const scopeMeta = scopes.find((item) => item.key === scope) ?? FALLBACK_SCOPES[2]!;
  const gateMeta = gateStateMetaOf(gate, labels);

  const run = async (mode: "preview" | "download"): Promise<void> => {
    setBusy(mode);
    try {
      const view = await requestDeliveryExport(token, productId, format, scope);
      setBlocked(null);
      setPreview(view);
      if (mode === "download") {
        downloadExportFile(view);
        notify(`已导出「${view.filename}」`, "ok");
      }
    } catch (caught) {
      const info = deliveryExportBlockedOf(caught);
      setPreview(null);
      if (info) {
        setBlocked(info);
      } else {
        notify("导出失败：请稍后重试", "error");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="导出最终资料包"
      spec="§60 / §62-15"
      subtitle="导出只是把两个中心排成一份文件：正文一个字都不新增，并永远标注成稿版本与第几次审核。"
      actions={
        <>
          <Pill tone={gateMeta.tone}>{gateMeta.label}</Pill>
          {gate.copy_version !== null ? <Pill tone="neutral">成稿 v{gate.copy_version}</Pill> : null}
          {gate.review_version !== null ? (
            <Pill tone="neutral">第 {gate.review_version} 次审核</Pill>
          ) : null}
          <Pill tone={gate.approved ? "ok" : "warn"}>
            {approvalStatusLabel(gate.approval_status)}
          </Pill>
        </>
      }
    >
      <div className="filter-bar">
        <label>
          导出格式
          <select
            value={format}
            onChange={(event) => {
              setFormat(event.target.value as DeliveryExportFormat);
              setPreview(null);
            }}
          >
            {formats.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}（{item.extension}）
              </option>
            ))}
          </select>
        </label>
        <label>
          导出范围
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as DeliveryExportScope);
              setPreview(null);
            }}
          >
            {scopes.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary sm" disabled={busy !== null} onClick={() => void run("preview")}>
          {busy === "preview" ? "生成中…" : "生成预览"}
        </button>
        <button
          type="button"
          className="sm"
          disabled={busy !== null || !gate.ready}
          title={gate.ready ? "导出为文件" : gateMeta.reason ?? "当前版本还不能导出"}
          onClick={() => void run("download")}
        >
          {busy === "download" ? "导出中…" : "导出文件"}
        </button>
      </div>

      <p className="muted">
        {formatMeta.hint}｜{scopeMeta.hint}
      </p>

      {!gate.ready ? (
        <Alert tone="warn">
          {gateMeta.reason}
          {gateMeta.next_action ? <>　下一步：{gateMeta.next_action}</> : null}
          　（点「生成预览」可以让后端把拒绝理由原样再报一次。）
        </Alert>
      ) : null}

      {blocked ? (
        <Alert tone={blocked.status === 409 ? "error" : "warn"}>
          <div>
            <strong>导出被拒：{blocked.gateLabel ?? "当前版本还不能导出"}</strong>
          </div>
          <div className="mt-1">{blocked.message}</div>
          {blocked.blockingSentences.length > 0 ? (
            <ul className="blocking-list">
              {blocked.blockingSentences.map((sentence) => (
                <li key={sentence}>
                  <span className="quote">{sentence}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {blocked.overLimit ? (
            <div className="mt-1">
              正文 {blocked.overLimit.chars} 字，超过单次上限 {blocked.overLimit.maxChars} 字：请缩小导出范围后重试。
            </div>
          ) : null}
          {blocked.nextAction ? <div className="mt-1">下一步：{blocked.nextAction}</div> : null}
        </Alert>
      ) : null}

      {preview ? (
        <div className="mt-2">
          <div className="row between">
            <strong>{preview.filename}</strong>
            <span className="muted">
              {preview.chars} 字 · 成稿 v{preview.copy_version ?? "—"} · 第 {preview.review_version ?? "—"} 次审核 ·
              生成于 {formatDateTime(preview.generated_at)}
            </span>
          </div>
          {/* 卖点一页纸是 HTML：放进无脚本沙箱预览，所见即打印所见；仍然要能落盘成 .html */}
          {preview.content_type.includes("text/html") ? (
            <iframe
              className="export-preview-frame"
              title={preview.filename}
              sandbox=""
              srcDoc={preview.content}
            />
          ) : (
            <pre className="code-block export-preview">{preview.content}</pre>
          )}
        </div>
      ) : null}

      {!preview && !blocked ? (
        <p className="muted">
          预览不会下载任何文件；点「导出文件」才落盘，文件名由后端给出（含产品名与成稿版本）。
        </p>
      ) : null}
    </Card>
  );
}
