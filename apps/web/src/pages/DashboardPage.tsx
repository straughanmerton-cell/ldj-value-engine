import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Card, PageHeader } from "../components/ui/Card.js";
import { ErrorState, LoadingState, Pill } from "../components/ui/State.js";
import { apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";

interface HealthResponse {
  status: string;
  database: string;
  phase: string;
}

interface CoreFeature {
  key: string;
  name: string;
  spec_ref: string;
  phase: number;
  summary?: string;
}

interface CoreFeaturesResponse {
  core_features: CoreFeature[];
  prompts: Array<{ key: string; agent: string; version: string }>;
  ai_provider: string;
  prompt_management: { spec_ref: string; capabilities: string[] };
  value_dna: { spec_ref: string; dimensions: string[] };
}

interface ProductListResponse {
  total: number;
}

export function DashboardPage(): ReactElement {
  const { token, user } = useAuth();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [meta, setMeta] = useState<CoreFeaturesResponse | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    Promise.all([
      apiRequest<HealthResponse>("/api/health"),
      apiRequest<CoreFeaturesResponse>("/api/meta/core-features", { token }),
      apiRequest<ProductListResponse>("/api/products?pageSize=1", { token })
    ])
      .then(([healthResult, metaResult, productResult]) => {
        setHealth(healthResult);
        setMeta(metaResult);
        setTotal(productResult.total);
        setError(null);
      })
      .catch(() => setError("读取系统状态失败，请确认 API 已启动"));
  }, [token]);

  return (
    <section>
      <PageHeader
        title={`欢迎，${user?.name ?? ""}`}
        subtitle="从产品事实到高价值锚点与强成交话术的一体化研究流水线。"
        actions={
          <>
            <Link to="/products/new">
              <button type="button">新建产品</button>
            </Link>
            <Link to="/products">
              <button type="button" className="secondary">
                产品中心
              </button>
            </Link>
          </>
        }
      />

      {error ? (
        <Card title="系统状态">
          <ErrorState description={error} />
        </Card>
      ) : null}

      {!health && !error ? (
        <Card title="系统状态">
          <LoadingState label="正在读取系统状态" />
        </Card>
      ) : null}

      <Card
        title="运行概况"
        spec="§60"
        actions={
          <Pill tone={health?.status === "ok" ? "ok" : "warn"}>
            服务 {health?.status ?? "…"} · 数据库 {health?.database ?? "…"}
          </Pill>
        }
      >
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">产品档案</div>
            <div className="metric-value">{total ?? "…"}</div>
            <div className="metric-hint">已登记产品数量</div>
          </div>
          <div className="metric">
            <div className="metric-label">核心功能锁定</div>
            <div className="metric-value">{meta?.core_features.length ?? "…"}</div>
            <div className="metric-hint">不得裁剪</div>
          </div>
          <div className="metric">
            <div className="metric-label">Agent Prompt</div>
            <div className="metric-value">{meta?.prompts.length ?? "…"}</div>
            <div className="metric-hint">
              {meta?.prompt_management.capabilities.length ?? 0} 项管理能力
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">AI Provider</div>
            <div className="metric-value">{meta?.ai_provider ?? "…"}</div>
            <div className="metric-hint">
              {meta?.ai_provider === "mock" ? "缺少 Key 时自动回退" : "真实 Provider"}
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">Value DNA 维度</div>
            <div className="metric-value">{meta?.value_dna.dimensions.length ?? "…"}</div>
            <div className="metric-hint">规格 §9 十一个维度</div>
          </div>
        </div>
        <p className="muted mt-3">{health?.phase ?? ""}</p>
      </Card>

      <Card
        title="需求基线核心功能（不得裁剪）"
        spec="§60"
        subtitle="以下功能为唯一需求基线锁定的交付内容，任何阶段都不得以减少形式替代。"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>功能</th>
                <th>基线条款</th>
                <th>计划 Phase</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {meta?.core_features.map((feature) => (
                <tr key={feature.key}>
                  <td>{feature.name}</td>
                  <td className="mono">{feature.spec_ref}</td>
                  <td>Phase {feature.phase}</td>
                  <td>
                    <Pill tone={feature.phase <= 3 ? "ok" : "neutral"}>
                      {feature.phase <= 3 ? "已交付" : "已登记"}
                    </Pill>
                  </td>
                </tr>
              )) ?? null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={`Agent Prompt 注册表（共 ${meta?.prompts.length ?? 0} 个）`}
        spec="§50"
        actions={
          <Link to="/settings">
            <button type="button" className="secondary sm">
              进入 Prompt 管理
            </button>
          </Link>
        }
      >
        <div className="grid-3">
          {(meta?.prompts ?? []).map((prompt) => (
            <div className="metric" key={prompt.key}>
              <div className="metric-label">{prompt.agent}</div>
              <div className="metric-value mono" style={{ fontSize: 13 }}>
                {prompt.key}
              </div>
              <div className="metric-hint">注册版本 {prompt.version}</div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}
