import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Card, PageHeader } from "../components/ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../components/ui/State.js";
import { useToast } from "../components/ui/Toast.js";
import { ApiError, apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";

/**
 * 系统设置：AI Provider 状态 + Prompt 管理后台（规格 §50）。
 *
 * 五项能力在 UI 上的落点：
 * - version   → 版本历史列表
 * - edit      → 「基于该版本新建」派生新版本（历史不回写）
 * - active    → 「启用」
 * - rollback  → 对任一历史版本「启用」（同一动作，语义即回滚）
 * - test run  → 只读当前启用版本试跑，结果明确标注不落库
 */

interface PromptSummary {
  key: string;
  agent: string;
  file: string;
  spec_version: string;
  active_version: number | null;
  version_count: number;
  updated_at: string | null;
}

interface PromptListResponse {
  capabilities: string[];
  spec_ref: string;
  items: PromptSummary[];
}

interface PromptVersionShape {
  key: string;
  version: number;
  content: string;
  notes: string | null;
  is_active: boolean;
  based_on_version: number | null;
  created_by: string | null;
  created_at: string;
}

interface PromptDetail extends PromptSummary {
  versions: PromptVersionShape[];
}

interface TestRunResult {
  key: string;
  prompt_version: number | null;
  prompt_source: "DB" | "FILE";
  provider: string;
  model: string;
  output: string;
  schema_valid: boolean | null;
  test_run: true;
  persisted: false;
}

interface CoreFeaturesMeta {
  ai_provider: string;
  prompt_management: { spec_ref: string; capabilities: string[] };
}

const CAPABILITY_LABELS: Record<string, string> = {
  version: "版本历史",
  active: "启用",
  rollback: "回滚",
  edit: "基于历史版本编辑",
  test_run: "试跑"
};

const SOURCE_LABELS: Record<string, string> = {
  DB: "数据库启用版本",
  FILE: "仓库文件兜底版本"
};

function formatTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("zh-CN");
}

export function SettingsPage(): ReactElement {
  const { token, user } = useAuth();
  const { notify } = useToast();

  const [list, setList] = useState<PromptListResponse | null>(null);
  const [meta, setMeta] = useState<CoreFeaturesMeta | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [filter, setFilter] = useState("");

  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftActivate, setDraftActivate] = useState(true);
  const [draftBaseVersion, setDraftBaseVersion] = useState<number | null>(null);

  const [testInput, setTestInput] = useState("");
  const [testVariables, setTestVariables] = useState("");
  const [testTemperature, setTestTemperature] = useState("0.4");
  const [testResult, setTestResult] = useState<TestRunResult | null>(null);

  const isAdmin = user?.role === "ADMIN";
  const canTestRun =
    user?.role === "ADMIN" || user?.role === "RESEARCHER" || user?.role === "COPYWRITER";

  const loadList = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoadingList(true);
    try {
      const [prompts, features] = await Promise.all([
        apiRequest<PromptListResponse>("/api/prompts", { token }),
        apiRequest<CoreFeaturesMeta>("/api/meta/core-features", { token })
      ]);
      setList(prompts);
      setMeta(features);
      setListError(null);
      setSelectedKey((current) => current ?? prompts.items[0]?.key ?? null);
    } catch (caught) {
      setListError(caught instanceof ApiError ? caught.message : "读取 Prompt 列表失败");
    } finally {
      setLoadingList(false);
    }
  }, [token]);

  const loadDetail = useCallback(
    async (key: string) => {
      if (!token) {
        return;
      }
      setLoadingDetail(true);
      try {
        const result = await apiRequest<PromptDetail>(`/api/prompts/${key}`, { token });
        setDetail(result);
        setDetailError(null);
        const active = result.versions.find((item) => item.is_active) ?? result.versions[0] ?? null;
        setExpandedVersion(active?.version ?? null);
        setDraftBaseVersion(active?.version ?? null);
        setDraftContent(active?.content ?? "");
        setDraftNotes("");
        setTestResult(null);
      } catch (caught) {
        setDetail(null);
        setDetailError(caught instanceof ApiError ? caught.message : "读取 Prompt 版本失败");
      } finally {
        setLoadingDetail(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedKey) {
      void loadDetail(selectedKey);
    }
  }, [selectedKey, loadDetail]);

  const visibleItems = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!list) {
      return [];
    }
    if (!keyword) {
      return list.items;
    }
    return list.items.filter((item) =>
      `${item.agent} ${item.key} ${item.file}`.toLowerCase().includes(keyword)
    );
  }, [list, filter]);

  async function createVersion(): Promise<void> {
    if (!selectedKey) {
      return;
    }
    if (!draftContent.trim()) {
      notify("Prompt 内容不能为空", "warn");
      return;
    }
    setBusy("create");
    try {
      const created = await apiRequest<PromptVersionShape>(`/api/prompts/${selectedKey}/versions`, {
        method: "POST",
        token,
        body: {
          content: draftContent,
          based_on_version: draftBaseVersion ?? undefined,
          notes: draftNotes.trim() ? draftNotes.trim() : undefined,
          activate: draftActivate
        }
      });
      notify(`已创建 v${created.version}${created.is_active ? " 并启用" : ""}`, "ok");
      await Promise.all([loadList(), loadDetail(selectedKey)]);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "创建版本失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function activateVersion(version: number): Promise<void> {
    if (!selectedKey) {
      return;
    }
    setBusy(`activate-${version}`);
    try {
      await apiRequest<PromptVersionShape>(`/api/prompts/${selectedKey}/activate`, {
        method: "POST",
        token,
        body: { version }
      });
      notify(`已启用 v${version}`, "ok");
      await Promise.all([loadList(), loadDetail(selectedKey)]);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "启用失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function runTest(): Promise<void> {
    if (!selectedKey) {
      return;
    }
    if (!testInput.trim()) {
      notify("请先填写试跑输入", "warn");
      return;
    }
    let variables: Record<string, string> = {};
    if (testVariables.trim()) {
      try {
        const parsed = JSON.parse(testVariables) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("变量必须是 JSON 对象");
        }
        variables = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([name, value]) => [name, String(value)])
        );
      } catch (caught) {
        notify(caught instanceof Error ? `变量 JSON 解析失败：${caught.message}` : "变量 JSON 解析失败", "warn");
        return;
      }
    }
    const temperature = Number(testTemperature);
    if (Number.isNaN(temperature) || temperature < 0 || temperature > 2) {
      notify("temperature 需在 0–2 之间", "warn");
      return;
    }
    setBusy("test");
    try {
      const result = await apiRequest<TestRunResult>(`/api/prompts/${selectedKey}/test-run`, {
        method: "POST",
        token,
        body: { input: testInput, variables, temperature }
      });
      setTestResult(result);
      notify(`试跑完成（${result.provider} / 未写库）`, "ok");
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "试跑失败", "error");
    } finally {
      setBusy(null);
    }
  }

  const providerNote =
    meta?.ai_provider === "mock"
      ? "当前 Provider 为 mock（未配置 OPENAI_API_KEY），输出仅用于链路验证，不代表内容质量。"
      : `当前 Provider：${meta?.ai_provider ?? "未知"}。`;

  return (
    <section>
      <PageHeader
        title="系统设置"
        subtitle="AI Provider 状态与 Prompt 管理后台（需求基线 §50：版本 / 启用 / 回滚 / 编辑 / 试跑）。"
        actions={
          <div className="btn-row">
            <Pill tone={meta?.ai_provider === "mock" ? "warn" : "ok"}>
              AI Provider：{meta?.ai_provider ?? "读取中"}
            </Pill>
            <Pill tone="neutral">{list?.items.length ?? 0} 个 Prompt Key</Pill>
          </div>
        }
      />

      <Card title="运行环境" spec="§63-7" subtitle={providerNote}>
        <div className="grid-3">
          <div className="metric">
            <div className="metric-label">AI Provider</div>
            <div className="metric-value">{meta?.ai_provider ?? "…"}</div>
            <div className="metric-hint">
              {meta?.ai_provider === "mock" ? "缺少 Key 时自动回退" : "已连接真实 Provider"}
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">Prompt Key</div>
            <div className="metric-value">{list?.items.length ?? "…"}</div>
            <div className="metric-hint">覆盖 11 个 Agent</div>
          </div>
          <div className="metric">
            <div className="metric-label">管理能力</div>
            <div className="metric-value">{list?.capabilities.length ?? "…"}</div>
            <div className="metric-hint">
              {(list?.capabilities ?? []).map((item) => CAPABILITY_LABELS[item] ?? item).join(" / ") || "…"}
            </div>
          </div>
        </div>
        {!isAdmin ? (
          <div className="mt-3">
            <Alert tone="info">
              当前角色（{user?.role}）可查看版本与试跑；新建版本与启用 / 回滚仅限 ADMIN。
            </Alert>
          </div>
        ) : null}
      </Card>

      {loadingList && !list ? (
        <Card title="Prompt 管理" spec="§50">
          <LoadingState label="正在读取 Prompt 列表" />
        </Card>
      ) : null}

      {listError ? (
        <Card title="Prompt 管理" spec="§50">
          <ErrorState description={listError} onRetry={() => void loadList()} />
        </Card>
      ) : null}

      {list ? (
        <div className="prompt-layout">
          <Card title="Prompt Key" spec={list.spec_ref} className="prompt-list-card">
            <label className="mb-3">
              检索
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="按 Agent / Key / 文件名检索"
              />
            </label>
            <div className="prompt-list">
              {visibleItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.key === selectedKey ? "prompt-item active" : "prompt-item"}
                  onClick={() => setSelectedKey(item.key)}
                >
                  <span>{item.agent}</span>
                  <span className="pi-key">{item.key}</span>
                  <span className="row">
                    <Pill tone={item.active_version ? "ok" : "warn"}>
                      启用 v{item.active_version ?? "—"}
                    </Pill>
                    <Pill tone="neutral">{item.version_count} 版</Pill>
                  </span>
                </button>
              ))}
              {visibleItems.length === 0 ? (
                <EmptyState title="没有匹配的 Prompt" description="调整检索关键词后重试。" />
              ) : null}
            </div>
          </Card>

          <div>
            {loadingDetail && !detail ? (
              <Card title="版本历史" spec="§50">
                <LoadingState label="正在读取版本历史" />
              </Card>
            ) : null}

            {detailError ? (
              <Card title="版本历史" spec="§50">
                <ErrorState
                  description={detailError}
                  onRetry={() => selectedKey && void loadDetail(selectedKey)}
                />
              </Card>
            ) : null}

            {detail ? (
              <>
                <Card
                  title={detail.agent}
                  spec={detail.spec_version}
                  subtitle={
                    <>
                      Key <code className="mono">{detail.key}</code>　·　文件{" "}
                      <code className="mono">prompts/{detail.file}</code>　·　最后更新{" "}
                      {formatTime(detail.updated_at)}
                    </>
                  }
                  actions={
                    <>
                      <Pill tone={detail.active_version ? "ok" : "warn"}>
                        启用版本 v{detail.active_version ?? "—"}
                      </Pill>
                      <Pill tone="neutral">共 {detail.version_count} 个版本</Pill>
                    </>
                  }
                >
                  <div className="version-list">
                    {detail.versions.map((version) => (
                      <div
                        key={version.version}
                        className={version.is_active ? "version-row active" : "version-row"}
                      >
                        <div>
                          <div className="row">
                            <strong>v{version.version}</strong>
                            {version.is_active ? <Pill tone="ok">当前启用</Pill> : null}
                            {version.based_on_version ? (
                              <Pill tone="neutral">派生自 v{version.based_on_version}</Pill>
                            ) : null}
                          </div>
                          <div className="version-meta">
                            {formatTime(version.created_at)}　·　
                            {version.created_by ? `创建人 ${version.created_by.slice(0, 8)}` : "系统种子版本"}
                            {version.notes ? `　·　${version.notes}` : ""}
                          </div>
                        </div>
                        <div className="btn-row">
                          <button
                            type="button"
                            className="secondary sm"
                            onClick={() =>
                              setExpandedVersion(expandedVersion === version.version ? null : version.version)
                            }
                          >
                            {expandedVersion === version.version ? "收起内容" : "查看内容"}
                          </button>
                          <button
                            type="button"
                            className="ghost sm"
                            disabled={!isAdmin}
                            title={isAdmin ? undefined : "仅 ADMIN 可编辑"}
                            onClick={() => {
                              setDraftBaseVersion(version.version);
                              setDraftContent(version.content);
                              setDraftNotes("");
                              notify(`已载入 v${version.version} 内容到编辑器`, "info");
                            }}
                          >
                            基于此版本编辑
                          </button>
                          <button
                            type="button"
                            className="sm"
                            disabled={!isAdmin || version.is_active || busy === `activate-${version.version}`}
                            title={isAdmin ? undefined : "仅 ADMIN 可启用"}
                            onClick={() => void activateVersion(version.version)}
                          >
                            {busy === `activate-${version.version}`
                              ? "处理中…"
                              : version.is_active
                                ? "使用中"
                                : "启用 / 回滚到这版"}
                          </button>
                        </div>
                        {expandedVersion === version.version ? (
                          <pre className="code-block w-100">{version.content}</pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Card>

                <Card
                  title="新建版本（编辑派生）"
                  spec="§62-15"
                  subtitle="按「所有版本必须保留」：保存不会改写历史版本，而是从选定版本派生出一个新版本。"
                >
                  <div className="grid-2">
                    <label>
                      派生自
                      <select
                        value={draftBaseVersion ?? ""}
                        onChange={(event) => {
                          const value = event.target.value ? Number(event.target.value) : null;
                          setDraftBaseVersion(value);
                          const matched = detail.versions.find((item) => item.version === value);
                          if (matched) {
                            setDraftContent(matched.content);
                          }
                        }}
                        disabled={!isAdmin}
                      >
                        <option value="">（基于当前启用版本）</option>
                        {detail.versions.map((version) => (
                          <option key={version.version} value={version.version}>
                            v{version.version}
                            {version.is_active ? "（当前启用）" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      版本说明（可选）
                      <input
                        value={draftNotes}
                        onChange={(event) => setDraftNotes(event.target.value)}
                        placeholder="例如：强化 §58-3 禁止虚构年份的约束"
                        disabled={!isAdmin}
                      />
                    </label>
                  </div>
                  <label className="mt-3">
                    内容
                    <textarea
                      value={draftContent}
                      onChange={(event) => setDraftContent(event.target.value)}
                      disabled={!isAdmin}
                      spellCheck={false}
                    />
                  </label>
                  <div className="row between mt-3">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={draftActivate}
                        onChange={(event) => setDraftActivate(event.target.checked)}
                        disabled={!isAdmin}
                      />
                      保存后立即启用该版本
                    </label>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="secondary"
                        disabled={!isAdmin}
                        onClick={() => {
                          const active = detail.versions.find((item) => item.is_active) ?? detail.versions[0];
                          setDraftBaseVersion(active?.version ?? null);
                          setDraftContent(active?.content ?? "");
                          setDraftNotes("");
                        }}
                      >
                        重置为启用版本
                      </button>
                      <button type="button" disabled={!isAdmin || busy === "create"} onClick={() => void createVersion()}>
                        {busy === "create" ? "保存中…" : "保存为新版本"}
                      </button>
                    </div>
                  </div>
                </Card>

                <Card
                  title="试跑（不落库）"
                  spec="§62-13"
                  subtitle="只读取当前启用版本调用 Provider；产物仅用于人工评估，不写入任何业务数据。"
                >
                  <label>
                    试跑输入
                    <textarea
                      value={testInput}
                      onChange={(event) => setTestInput(event.target.value)}
                      placeholder="粘贴一条待处理的输入，例如产品事实原文或产品名称"
                      disabled={!canTestRun}
                    />
                  </label>
                  <div className="grid-2 mt-3">
                    <label>
                      变量（JSON 对象，可选）
                      <textarea
                        className="short"
                        value={testVariables}
                        onChange={(event) => setTestVariables(event.target.value)}
                        placeholder='{"product_name":"龙德记六星孔雀"}'
                        disabled={!canTestRun}
                      />
                    </label>
                    <label>
                      temperature
                      <input
                        value={testTemperature}
                        onChange={(event) => setTestTemperature(event.target.value)}
                        disabled={!canTestRun}
                      />
                    </label>
                  </div>
                  <div className="btn-row mt-3">
                    <button
                      type="button"
                      disabled={!canTestRun || busy === "test"}
                      onClick={() => void runTest()}
                    >
                      {busy === "test" ? "试跑中…" : "运行试跑"}
                    </button>
                    {!canTestRun ? <span className="muted">当前角色无试跑权限。</span> : null}
                  </div>

                  {testResult ? (
                    <div className="mt-4">
                      <div className="row">
                        <Pill tone="info">Provider：{testResult.provider}</Pill>
                        <Pill tone="neutral">模型：{testResult.model}</Pill>
                        <Pill tone="neutral">
                          版本：{testResult.prompt_version ?? "文件兜底"}（
                          {SOURCE_LABELS[testResult.prompt_source] ?? testResult.prompt_source}）
                        </Pill>
                        {testResult.schema_valid === null ? (
                          <Pill tone="outline">未定义 schema</Pill>
                        ) : (
                          <Pill tone={testResult.schema_valid ? "ok" : "danger"}>
                            schema 校验：{testResult.schema_valid ? "通过" : "未通过"}
                          </Pill>
                        )}
                        <Pill tone="warn">未写库</Pill>
                      </div>
                      <pre className="code-block mt-3">{testResult.output || "（空输出）"}</pre>
                    </div>
                  ) : null}
                </Card>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
