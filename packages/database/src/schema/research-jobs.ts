import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ResearchProgress, ResearchStage } from "@ldj/schemas";
import { researchJobStatusEnum } from "./enums.js";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * research_jobs（规格 §54 / §55 / §56）。
 *
 * 每次「跑研究」产生一条任务记录，progress 保存 §55 的 22 个阶段状态；
 * 未交付阶段保持 PENDING 并带 phase 标记（由 researchProgressView 输出），
 * 进度 UI 因此不会把「还没开发的阶段」显示成已完成。
 */
export const researchJobs = pgTable(
  "research_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    status: researchJobStatusEnum("status").notNull().default("PENDING"),
    currentStage: text("current_stage").$type<ResearchStage | null>(),
    progress: jsonb("progress").$type<ResearchProgress>().notNull().default([]),

    /** 本轮的执行参数与产出统计（查询条数、来源数、抽取条数等） */
    summary: jsonb("summary").$type<Record<string, unknown> | null>(),
    error: text("error"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("research_jobs_product_idx").on(table.productId),
    index("research_jobs_status_idx").on(table.status)
  ]
);

export type ResearchJob = typeof researchJobs.$inferSelect;
export type NewResearchJob = typeof researchJobs.$inferInsert;
