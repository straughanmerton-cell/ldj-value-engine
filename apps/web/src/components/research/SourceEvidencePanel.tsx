import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  DROP_REASON_LABELS,
  EXTRACTION_STATUS_LABELS,
  EXTRACTION_STATUS_TONES,
  FETCH_STATUS_LABELS,
  FETCH_STATUS_TONES,
  PRICE_TYPE_LABELS,
  PRICE_TYPE_TONES,
  UNIT_SCOPE_LABELS,
  formatDateTime,
  formatPrice,
  type SourceDetail,
  type SourceExtraction
} from "../../lib/research.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";

const SOURCE_KIND_LABELS: Record<string, string> = {
  SEARCH_RESULT: "搜索结果",
  PRODUCT_PAGE: "产品页",
  PRICE_PAGE: "价格页",
  MARKETPLACE: "交易平台",
  AUCTION_PAGE: "拍卖页",
  ARTICLE: "行业文章",
  FORUM: "论坛",
  SOCIAL: "社交媒体",
  OTHER: "其他"
};

export interface SourceEvidencePanelProps {
  productId: string;
  sourceId: string;
  token: string | null;
  canWrite: boolean;
  refreshKey?: number;
}

/**
 * 单条来源的证据详情（规格 §11 / §24 / §41）。
 *
 * 页面必须把「证据」与「产品事实」分开表达：网页抽到什么只是来源证据，
 * 是否成为产品事实必须由人工在 §11 六态中确认（Phase 14 审核）。
 */
export function SourceEvidencePanel({
  productId,
  sourceId,
  token,
  canWrite,
  refreshKey
}: SourceEvidencePanelProps): ReactElement {
  const { notify } = useToast();
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [extractions, setExtractions] = useState<SourceExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullText, setShowFullText] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const [detail, extractionList] = await Promise.all([
        apiRequest<SourceDetail>(`/api/products/${productId}/sources/${sourceId}`, { token }),
        apiRequest<{ items: SourceExtraction[] }>(
          `/api/products/${productId}/sources/${sourceId}/extractions`,
          { token }
        )
      ]);
      setSource(detail);
      setExtractions(extractionList.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "读取来源证据失败");
    } finally {
      setLoading(false);
    }
  }, [productId, sourceId, token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey, tick]);

  async function fetchBody(force: boolean): Promise<void> {
    setBusy(true);
    try {
      await apiRequest<SourceDetail>(`/api/products/${productId}/sources/${sourceId}/fetch`, {
        method: "POST",
        token,
        body: { force }
      });
      notify("抓取完成", "ok");
      setTick((current) => current + 1);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "抓取失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runExtract(force: boolean): Promise<void> {
    setBusy(true);
    try {
      const result = await apiRequest<SourceExtraction>(
        `/api/products/${productId}/sources/${sourceId}/extract`,
        { method: "POST", token, body: { force } }
      );
      notify(
        `抽取完成：价格证据 ${result.price_count} 条${result.has_content ? "" : "（页面未明确写出可用信息）"}`,
        result.has_content ? "ok" : "warn"
      );
      setTick((current) => current + 1);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "网页抽取失败", "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !source) {
    return (
      <Card title="来源证据" spec="§11 / §41">
        <LoadingState label="正在读取来源证据" />
      </Card>
    );
  }

  if (error && !source) {
    return (
      <Card title="来源证据" spec="§11 / §41">
        <ErrorState description={error} onRetry={() => void load()} />
      </Card>
    );
  }

  if (!source) {
    return (
      <Card title="来源证据" spec="§11 / §41">
        <EmptyState title="请选择一条来源" description="在左侧列表中点击来源标题即可查看其抓取正文与抽取证据。" />
      </Card>
    );
  }

  const latest = extractions[0] ?? null;

  return (
    <>
      <Card
        title={source.title ?? source.domain}
        spec="§11 / §41"
        subtitle={
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.url}
          </a>
        }
        actions={
          <>
            <Pill tone={FETCH_STATUS_TONES[source.fetch_status] ?? "neutral"}>
              {FETCH_STATUS_LABELS[source.fetch_status] ?? source.fetch_status}
            </Pill>
            <Pill tone={EXTRACTION_STATUS_TONES[source.extraction_status] ?? "neutral"}>
              {EXTRACTION_STATUS_LABELS[source.extraction_status] ?? source.extraction_status}
            </Pill>
            {canWrite ? (
              <>
                <button
                  type="button"
                  className="secondary sm"
                  disabled={busy}
                  onClick={() => void fetchBody(source.fetch_status === "FETCHED")}
                >
                  {source.fetch_status === "FETCHED" ? "重新抓取" : "抓取正文"}
                </button>
                <button
                  type="button"
                  className="sm"
                  disabled={busy}
                  onClick={() => void runExtract(extractions.length > 0)}
                >
                  运行 Agent 3 抽取
                </button>
              </>
            ) : null}
          </>
        }
      >
        <Alert tone="info">
          抽取结果只作<strong>来源证据</strong>存在：网页写了什么就记什么，不换算价格类型、不换算单位、
          不自动写入产品事实；是否成为产品事实必须由人工在「事实清单」中按六态确认（规格 §11 / §24 / §41）。
        </Alert>

        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">来源类型</div>
            <div className="metric-value" style={{ fontSize: 15 }}>
              {SOURCE_KIND_LABELS[source.source_kind] ?? source.source_kind}
            </div>
            <div className="metric-hint mono">{source.domain}</div>
          </div>
          <div className="metric">
            <div className="metric-label">命中查询</div>
            <div className="metric-value" style={{ fontSize: 13 }}>
              {source.query ?? "手工登记"}
            </div>
            <div className="metric-hint mono">{source.query_type ?? source.stage ?? "—"}</div>
          </div>
          <div className="metric">
            <div className="metric-label">正文长度</div>
            <div className="metric-value">{source.content_chars ?? 0}</div>
            <div className="metric-hint">
              {source.http_status ? `HTTP ${source.http_status}` : "尚未抓取"}
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">价格证据</div>
            <div className="metric-value">{source.price_count}</div>
            <div className="metric-hint">类型与单位按原文判定</div>
          </div>
          <div className="metric">
            <div className="metric-label">网页事实</div>
            <div className="metric-value">{source.fact_count}</div>
            <div className="metric-hint">逐条带原文引文</div>
          </div>
          <div className="metric">
            <div className="metric-label">登记时间</div>
            <div className="metric-value" style={{ fontSize: 13 }}>
              {formatDateTime(source.created_at)}
            </div>
            <div className="metric-hint">抽取 {formatDateTime(source.extracted_at)}</div>
          </div>
        </div>

        {source.fetch_error ? <Alert tone="error">抓取失败原因：{source.fetch_error}</Alert> : null}
        {source.note ? <p className="muted mt-3">登记备注：{source.note}</p> : null}
      </Card>

      {source.content_text ? (
        <Card
          title="页面正文"
          spec="§41"
          subtitle="正文用于人工核对：任何抽取结果都必须能在这段文字里逐字回溯。"
          actions={
            <button type="button" className="ghost sm" onClick={() => setShowFullText(!showFullText)}>
              {showFullText ? "收起" : `展开全文（${source.content_chars ?? 0} 字）`}
            </button>
          }
        >
          <div className="code-block">
            {showFullText
              ? source.content_text
              : `${source.content_text.slice(0, 1200)}${source.content_text.length > 1200 ? "\n…" : ""}`}
          </div>
        </Card>
      ) : (
        <Card title="页面正文" spec="§41">
          <EmptyState
            title="尚未抓到正文"
            description="没有正文就无法抽取：系统不会用模型记忆代替页面内容（规格 §62-1）。"
          />
        </Card>
      )}

      <Card
        title="抽取证据"
        spec="§41"
        subtitle="按时间倒序保留每一次抽取（§62-15：所有版本保留）。"
        actions={latest ? <Pill tone="neutral">共 {extractions.length} 次抽取</Pill> : null}
      >
        {extractions.length === 0 ? (
          <EmptyState
            title="尚未抽取"
            description="抓取正文后运行 Agent 3，即可得到带原文引文的价格与事实证据。"
          />
        ) : (
          extractions.map((extraction) => (
            <div className="evidence-block" key={extraction.id}>
              <div className="evidence-head">
                <div>
                  <strong>抽取于 {formatDateTime(extraction.created_at)}</strong>
                  <div className="muted">
                    {extraction.prompt_key}
                    {extraction.prompt_version ? ` v${extraction.prompt_version}` : ""}
                    {extraction.provider ? `　·　${extraction.provider}/${extraction.model ?? "—"}` : "　·　规则抽取"}
                  </div>
                </div>
                <div className="btn-row">
                  <Pill tone={extraction.has_content ? "ok" : "warn"}>
                    {extraction.has_content ? "有可用信息" : "页面无明确可用信息"}
                  </Pill>
                  <Pill tone="warn">价格 {extraction.price_count}</Pill>
                  <Pill tone="info">事实 {extraction.extraction.facts.length}</Pill>
                </div>
              </div>

              {extraction.extraction.null_reason ? (
                <Alert tone="warn">抽取说明：{extraction.extraction.null_reason}</Alert>
              ) : null}

              <h4 className="sub-title">价格证据（按原文类型，不换算）</h4>
              {extraction.extraction.prices.length === 0 ? (
                <p className="muted">本条来源未抽到价格。</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>金额</th>
                        <th>价格类型</th>
                        <th>单位口径</th>
                        <th>原文引文</th>
                        <th>判定说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extraction.extraction.prices.map((price, index) => (
                        <tr key={`${extraction.id}-price-${index}`}>
                          <td className="nowrap">{formatPrice(price.value, price.currency)}</td>
                          <td>
                            <Pill tone={PRICE_TYPE_TONES[price.price_type] ?? "neutral"}>
                              {PRICE_TYPE_LABELS[price.price_type] ?? price.price_type}
                            </Pill>
                          </td>
                          <td className="muted">
                            {UNIT_SCOPE_LABELS[price.unit_scope ?? "UNKNOWN"] ?? price.unit_scope}
                            {price.weight_g ? <div>{price.weight_g}g</div> : null}
                          </td>
                          <td className="quote">{price.quote}</td>
                          <td className="muted">{price.note ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4 className="sub-title">网页事实（每条带原文引文）</h4>
              {extraction.extraction.facts.length === 0 ? (
                <p className="muted">本条来源未抽到可回溯的事实条目。</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>字段</th>
                        <th>内容</th>
                        <th>原文引文</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extraction.extraction.facts.map((fact, index) => (
                        <tr key={`${extraction.id}-fact-${index}`}>
                          <td className="mono">{fact.field}</td>
                          <td>{fact.value}</td>
                          <td className="quote">{fact.quote}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {extraction.dropped.length > 0 ? (
                <>
                  <h4 className="sub-title">被丢弃的条目（护栏拦截）</h4>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>字段</th>
                          <th>原始内容</th>
                          <th>丢弃原因</th>
                          <th>说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {extraction.dropped.map((drop, index) => (
                          <tr key={`${extraction.id}-drop-${index}`}>
                            <td className="mono">{drop.field}</td>
                            <td>{drop.value}</td>
                            <td>
                              <Pill tone="danger">{DROP_REASON_LABELS[drop.reason] ?? drop.reason}</Pill>
                            </td>
                            <td className="muted">{drop.details.join("；")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              {extraction.warnings.length > 0 ? (
                <div className="mt-3">
                  {extraction.warnings.map((warning) => (
                    <Alert key={warning} tone="warn">
                      {warning}
                    </Alert>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </Card>
    </>
  );
}
