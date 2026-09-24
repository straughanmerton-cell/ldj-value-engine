import { useState, type ReactElement } from "react";
import { Alert, Pill } from "../ui/State.js";
import {
  JOB_STATUS_LABELS,
  STAGE_STATE_LABELS,
  STAGE_STATE_TONES,
  type ResearchJob,
  type StageProgress as StageProgressItem
} from "../../lib/research.js";

export interface StageProgressProps {
  job: ResearchJob | null;
  /** 从未跑过研究时使用空进度（22 个阶段全部 PENDING）。 */
  progress: StageProgressItem[];
  modeNotes: { BENCHMARK: string; CATEGORY_CREATOR: string };
}

function StageRow({ item, index }: { item: StageProgressItem; index: number }): ReactElement {
  const detailEntries = Object.entries(item.detail ?? {});
  return (
    <li className={`stage step-${item.status.toLowerCase()}${item.implemented ? "" : " later"}`}>
      <span className="stage-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="stage-body">
        <div className="stage-title">
          <strong>{item.label}</strong>
          <code>{item.stage}</code>
          <Pill tone={STAGE_STATE_TONES[item.status]}>{STAGE_STATE_LABELS[item.status]}</Pill>
          {item.implemented ? null : <Pill tone="outline">Phase {item.phase} 交付</Pill>}
        </div>
        {item.message ? <div className="stage-message">{item.message}</div> : null}
        {detailEntries.length > 0 ? (
          <div className="stage-detail">
            {detailEntries.map(([key, value]) => (
              <span key={key} className="chip muted">
                {key}
                <strong style={{ marginLeft: 6 }}>
                  {typeof value === "object" ? JSON.stringify(value) : String(value)}
                </strong>
              </span>
            ))}
          </div>
        ) : null}
        {item.finished_at ? (
          <div className="stage-time">完成于 {new Date(item.finished_at).toLocaleString("zh-CN")}</div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * 研究进度 UI（规格 §56）：22 个阶段逐阶段展示状态。
 * 未交付阶段显式标注所属 Phase，绝不显示成「已完成」，避免进度 UI 说谎。
 */
export function StageProgress({ job, progress, modeNotes }: StageProgressProps): ReactElement {
  const [onlyImplemented, setOnlyImplemented] = useState(false);
  const items = onlyImplemented ? progress.filter((item) => item.implemented) : progress;
  const succeeded = progress.filter((item) => item.status === "SUCCEEDED").length;
  const percent = progress.length === 0 ? 0 : Math.round((succeeded / progress.length) * 100);

  return (
    <>
      <div className="progress-head">
        <div>
          <div className="progress-percent">{percent}%</div>
          <div className="muted">
            已完成 {succeeded} / {progress.length} 个阶段
            {job ? `　·　本轮任务状态：${JOB_STATUS_LABELS[job.status] ?? job.status}` : ""}
          </div>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={onlyImplemented}
            onChange={(event) => setOnlyImplemented(event.target.checked)}
          />
          只看已交付阶段
        </label>
      </div>
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="mode-notes">
        <div className="mode-note">
          <Pill tone="info">Benchmark Mode</Pill>
          <span>{modeNotes.BENCHMARK}</span>
        </div>
        <div className="mode-note">
          <Pill tone="warn">Category Creator Mode</Pill>
          <span>{modeNotes.CATEGORY_CREATOR}</span>
        </div>
      </div>

      {job?.error ? <Alert tone="error">本轮任务失败：{job.error}</Alert> : null}

      <ol className="stage-list">
        {items.map((item, index) => (
          <StageRow key={item.stage} item={item} index={index} />
        ))}
      </ol>

      <p className="muted">
        Phase 1–7 已交付的阶段会真实执行；其余阶段在进度中保持「待执行」并标注计划 Phase，
        不会以简化形式替代基线要求的能力（规格 §55 / §56 / §60）。
      </p>
    </>
  );
}
