import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { AiProvider } from "@ldj/ai";
import type { CopyOutputRow, Database } from "@ldj/database";
import { claimEvidence, copyOutputs, generatedClaims, products } from "@ldj/database";
import {
  CLAIM_TYPE_HINTS,
  CLAIM_TYPE_LABELS,
  FACT_EVIDENCE_KIND_LABELS,
  FACT_REVIEW_CONTRACT,
  FACT_REVIEW_DOWNSTREAM,
  FACT_REVIEW_ENGINE_INFO,
  FACT_REVIEW_FOCUS_LABELS,
  FACT_REVIEW_LIMITS,
  FACT_REVIEW_SENTENCE_COLUMNS,
  FACT_REVIEW_SPEC_REF,
  FACT_REVIEW_STATUS_LABELS,
  RISK_LEVEL_HINTS,
  RISK_LEVEL_LABELS,
  buildFactReview,
  factEvidenceSchema,
  factReviewAiOutputSchema,
  factReviewEvidenceOf,
  factReviewOverviewSchema,
  factReviewRecord,
  factReviewVersionSummarySchema,
  deliveryReviewSummarySchema,
  mergeFactReviewAi,
  salesCopyBodyOf,
  salesCopyRecordedValues,
  usableValueDna,
  type FactEvidence,
  type DeliveryReviewSummary,
  type FactReview,
  type FactReviewApproval,
  type FactReviewBuildInput,
  type FactReviewClaimCounts,
  type FactReviewDecisionInput,
  type FactReviewGenerateInput,
  type FactReviewOverview,
  type FactReviewSentence,
  type FactReviewStatus,
  type FactReviewSummary,
  type FactReviewVersionSummary
} from "@ldj/schemas";
import { AppError } from "@ldj/shared";
import type { PromptManagerService } from "../prompts/service.js";
import { assertProductExists } from "../product-records/product-guard.js";
import type { SalesCopyService } from "../sales-copy/sales-copy.service.js";

/**
 * 事实审核与人工审批服务（规格 §24 / §25 / §36 / §49 / §53 / §57 / §62-14）。
 *
 * 这一层与 Phase 12 的强成交话术服务分工清晰：
 *
 * - **判定全部在 schema 层**：逐句切分、三层标记、三档风险、阻断与证据行都来自
 *   `@ldj/schemas` 的 `buildFactReview()` / `mergeFactReviewAi()`，服务层不另写一条判定规则；
 * - **落库即冻结**：一句一行写进 `generated_claims`，证据逐条写进 `claim_evidence`；
 *   回看时只读这些行，**不重新判定**（§57 / §62-15）——产品事实今天补录了，
 *   也不会把三个月前那一次审核结论悄悄改掉；
 * - **AI 只能加严**：Agent 11 的标注按句合并进规则结论，风险取更严的一档，
 *   Evidence 永远用机械逐字回查结果，Mock / 失败时整份回落纯规则引擎（§62-14）；
 * - **审批只写状态**：`approve` / `reject` 只改被审批那一版的状态与备注，
 *   存在 RED 时审批直接 400 并把阻断句回给前端（§53 / §57）。
 */
export interface FactReviewRecordView {
  review: FactReview;
  evidence: FactEvidence[];
}

interface ProductIdentity {
  id: string;
  productName: string;
}

export class FactReviewService {
  constructor(
    private readonly db: Database,
    private readonly salesCopy: SalesCopyService,
    private readonly ai: AiProvider,
    private readonly prompts: PromptManagerService
  ) {}

  /* ------------------------------------------------------------- 合同与标签 */

  /** 合同自检：三层标记 / 三档风险 / 审批状态 / 证据类型 / §53 五列与全部规则。 */
  contractBody(): {
    contract: typeof FACT_REVIEW_CONTRACT;
    engine: typeof FACT_REVIEW_ENGINE_INFO;
    downstream: typeof FACT_REVIEW_DOWNSTREAM;
    limits: typeof FACT_REVIEW_LIMITS;
  } {
    return {
      contract: FACT_REVIEW_CONTRACT,
      engine: FACT_REVIEW_ENGINE_INFO,
      downstream: FACT_REVIEW_DOWNSTREAM,
      limits: FACT_REVIEW_LIMITS
    };
  }

  /** 标签文案全部从 schema 层读取，前端不另写一套（§24 / §49 / §53）。 */
  labelsBody(): {
    claim_type_labels: typeof CLAIM_TYPE_LABELS;
    claim_type_hints: typeof CLAIM_TYPE_HINTS;
    risk_level_labels: typeof RISK_LEVEL_LABELS;
    risk_level_hints: typeof RISK_LEVEL_HINTS;
    status_labels: typeof FACT_REVIEW_STATUS_LABELS;
    evidence_kind_labels: typeof FACT_EVIDENCE_KIND_LABELS;
    focus_items: typeof FACT_REVIEW_FOCUS_LABELS;
    sentence_columns: typeof FACT_REVIEW_SENTENCE_COLUMNS;
    limits: typeof FACT_REVIEW_LIMITS;
    rules: typeof FACT_REVIEW_CONTRACT.rules;
  } {
    return {
      claim_type_labels: CLAIM_TYPE_LABELS,
      claim_type_hints: CLAIM_TYPE_HINTS,
      risk_level_labels: RISK_LEVEL_LABELS,
      risk_level_hints: RISK_LEVEL_HINTS,
      status_labels: FACT_REVIEW_STATUS_LABELS,
      evidence_kind_labels: FACT_EVIDENCE_KIND_LABELS,
      focus_items: FACT_REVIEW_FOCUS_LABELS,
      sentence_columns: FACT_REVIEW_SENTENCE_COLUMNS,
      limits: FACT_REVIEW_LIMITS,
      rules: FACT_REVIEW_CONTRACT.rules
    };
  }

  /* ------------------------------------------------------------- 读取 */

  /**
   * 产品级总览（§53 页面首屏）：可审核的那一版成稿 + 它的最新一次审核 + 版本列表 + 审批状态。
   *
   * 「审核对象」永远是最新一版成稿：生成新版话术之后要重新审，
   * 因为一句话有没有证据与它在哪一版里是同一件事（§57 / §62-15）。
   */
  async overview(productId: string): Promise<FactReviewOverview> {
    const product = await this.loadProduct(productId);
    const copy = await this.latestCopyRow(productId);
    if (!copy) {
      return factReviewOverviewSchema.parse({
        product_id: productId,
        product_name: product.productName,
        copy_record_id: null,
        copy_version: null,
        can_review: false,
        block_reason: "还没有可审核的强成交话术：请先生成一版主播稿，再逐句做事实审核（§53）",
        review: null,
        versions: [],
        approval: emptyApproval(),
        spec_ref: "§24 / §49 / §53"
      });
    }

    const rows = await this.loadProductRows(productId);
    const versions = versionSummariesOf(rows.filter((row) => row.copyOutputId === copy.id));
    const latest = versions.length > 0 ? await this.readVersion(copy.id, versions[0]?.version, product.productName) : null;

    return factReviewOverviewSchema.parse({
      product_id: productId,
      product_name: product.productName,
      copy_record_id: copy.id,
      copy_version: copy.version,
      can_review: true,
      block_reason: null,
      review: latest ? latest.review : null,
      versions,
      approval: await this.approvalOf(productId),
      spec_ref: "§24 / §49 / §53"
    });
  }

  /** 审核版本列表：按「成稿版本 → 审核序号」倒序，全部保留（§62-15）。 */
  async listVersions(productId: string): Promise<FactReviewVersionSummary[]> {
    await assertProductExists(this.db, productId);
    return versionSummariesOf(await this.loadProductRows(productId));
  }

  /* ------------------------------------------- 交付层闸门（§53 / §57 / §62-14） */

  /**
   * 交付层要用的**冻结审核摘要**：这一版成稿的最新一次事实审核结论。
   *
   * 单开这个公开方法而不是让 Phase 15 自己去查 `generated_claims`，是为了让「发布闸门读哪一行」
   * 永远只有一份实现：Phase 15 的发布闸门（主播中心 / 经销商中心 / 导出）只看这里的结论。
   *
   * 关键口径：**审的是哪一版成稿是结论的一部分**。只返回「最近一次审批通过」是不够的——
   * 上一版通过、当前版刚生成还没审，正是最容易出假绿灯的场景，因此本方法一律以
   * `copy_output_id` 为入参、只回该版成稿自己的最新审核（`review_version` 最大者）。
   */
  async deliveryReviewSummary(copyOutputId: string): Promise<DeliveryReviewSummary | null> {
    const summaries = await this.deliveryReviewSummaries([copyOutputId]);
    return summaries.get(copyOutputId) ?? null;
  }

  /** 批量版本（跨产品列表用）：一次查询回答多款产品「审核到哪一步、有没有 RED」。 */
  async deliveryReviewSummaries(
    copyOutputIds: readonly string[]
  ): Promise<Map<string, DeliveryReviewSummary>> {
    const ids = [...new Set(copyOutputIds)];
    const summaries = new Map<string, DeliveryReviewSummary>();
    if (ids.length === 0) {
      return summaries;
    }

    const rows = await this.db
      .select({
        copyOutputId: generatedClaims.copyOutputId,
        reviewVersion: generatedClaims.reviewVersion,
        approvalStatus: generatedClaims.approvalStatus,
        publishable: generatedClaims.publishable,
        redCount: sql<number>`count(*) filter (where ${generatedClaims.isBlocking})`.mapWith(Number),
        sentenceCount: sql<number>`count(*)`.mapWith(Number),
        blocking: sql<
          string[]
        >`coalesce(array_agg(${generatedClaims.text} order by ${generatedClaims.sentenceIndex}) filter (where ${generatedClaims.isBlocking}), '{}')`
      })
      .from(generatedClaims)
      .where(inArray(generatedClaims.copyOutputId, ids))
      .groupBy(
        generatedClaims.copyOutputId,
        generatedClaims.reviewVersion,
        generatedClaims.approvalStatus,
        generatedClaims.publishable
      );

    const latest = new Map<string, number>();
    for (const row of rows) {
      const current = latest.get(row.copyOutputId);
      if (current === undefined || row.reviewVersion > current) {
        latest.set(row.copyOutputId, row.reviewVersion);
      }
    }

    for (const row of rows) {
      if (latest.get(row.copyOutputId) !== row.reviewVersion) {
        continue;
      }
      summaries.set(
        row.copyOutputId,
        deliveryReviewSummarySchema.parse({
          copy_output_id: row.copyOutputId,
          review_version: row.reviewVersion,
          approval_status: row.approvalStatus,
          publishable: row.publishable,
          red_count: row.redCount,
          sentence_count: row.sentenceCount,
          blocking_sentences: row.blocking ?? [],
          approved: row.approvalStatus === "APPROVED",
          spec_ref: FACT_REVIEW_SPEC_REF
        })
      );
    }
    return summaries;
  }

  /** 单次审核的完整视图：逐句结论 + 逐条证据行（`reviewId` = 审核版本首句行的 id）。 */
  async getReview(productId: string, reviewId: string): Promise<FactReviewRecordView> {
    const product = await this.loadProduct(productId);
    const rows = await this.db
      .select()
      .from(generatedClaims)
      .where(and(eq(generatedClaims.id, reviewId), eq(generatedClaims.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("事实审核版本不存在");
    }
    return this.readVersion(row.copyOutputId, row.reviewVersion, product.productName);
  }

  /* ------------------------------------------------------------- 写入 */

  /**
   * 运行一次事实审核（§49 / §53）：纯规则引擎先判一遍，Agent 11 只能在此基础上加严。
   *
   * 审核对象是**已落库的成稿**：正文从 `copy_outputs.record` 取，锚点与「能不能讲价格高度」
   * 取那一版冻结的值，研发证据取那一版冻结的 `compliance.rnd_confirmed`
   * ——历史版本不会因为今天新增了研发记录或下架了对标价格而被重判（§57）。
   */
  async generate(
    productId: string,
    input: FactReviewGenerateInput,
    actorId: string
  ): Promise<FactReviewRecordView> {
    const product = await this.loadProduct(productId);
    const copy = input.record_id
      ? await this.findCopyRow(productId, input.record_id)
      : await this.latestCopyRow(productId);
    if (!copy) {
      throw AppError.validation("没有可审核的强成交话术版本：请先生成一版主播稿再送审（§53）");
    }

    const existing = (await this.loadProductRows(productId)).filter(
      (row) => row.copyOutputId === copy.id
    );
    const usedVersions = new Set(existing.map((row) => row.reviewVersion));
    if (usedVersions.size >= FACT_REVIEW_LIMITS.maxVersionsPerCopy) {
      throw AppError.validation(
        `同一版成稿最多保留 ${FACT_REVIEW_LIMITS.maxVersionsPerCopy} 次事实审核，请先生成新版强成交话术（§62-15）`
      );
    }

    const reviewVersion = usedVersions.size === 0 ? 1 : Math.max(...usedVersions) + 1;
    const buildInput = this.toBuildInput(copy, await this.salesCopy.buildInputForRow(productId, copy));
    const warnings: string[] = input.notes ? [`送审备注：${input.notes}`] : [];
    let draft = buildFactReview(buildInput);

    const wantAi = input.use_ai ?? this.ai.name !== "mock";
    if (wantAi) {
      try {
        const active = await this.prompts.getActiveContent("FACT_REVIEWER");
        const { data } = await this.ai.generateJson({
          schema: factReviewAiOutputSchema,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: [
                active.content,
                "",
                "附加约束（§49 / §62-14）：只输出 schema 规定的 JSON；",
                "逐句结论必须与输入句子的顺序、文本逐字对应；",
                "Evidence 一律以规则引擎的机械逐字回查结果为准，不要新增出处；",
                "你只能把风险判得更严，不能把规则引擎判出的 RED 说成 GREEN。"
              ].join("\n")
            },
            {
              role: "user",
              content: JSON.stringify({
                product_name: product.productName,
                copy_version: copy.version,
                rnd_confirmed: buildInput.rnd_confirmed,
                has_reliable_price_anchor: buildInput.anchor.has_reliable_price_anchor,
                price_high_story_ready: buildInput.price_high_story_ready,
                recorded_facts: recordedValuesOf(buildInput),
                sentences: draft.sentences.map((sentence) => ({
                  index: sentence.index,
                  text: sentence.text,
                  claim_type: sentence.claim_type,
                  risk: sentence.risk,
                  evidence_refs: sentence.evidence_refs
                }))
              })
            }
          ]
        });
        const merged = mergeFactReviewAi(draft, data);
        draft = merged.draft;
        warnings.push(`Agent 11 已参与本次审核（Prompt v${active.version}）：AI 只能加严（§62-14）`);
      } catch (error) {
        warnings.push(
          `AI 审核未完成，已退回纯规则引擎：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const storedWarnings = [...draft.warnings, ...warnings];
    await this.persist(copy, reviewVersion, buildInput, draft, storedWarnings, actorId);
    return this.readVersion(copy.id, reviewVersion, product.productName);
  }

  /** 人工审批：只有「逐句无 RED 且 §24 合规不是 RED」才允许通过（§53 / §57 / §62-14）。 */
  async approve(
    productId: string,
    input: FactReviewDecisionInput,
    actorId: string
  ): Promise<FactReviewRecordView> {
    return this.decide(productId, input, actorId, "APPROVED");
  }

  /** 人工否决：不改任何判定结论，只记录「这一版没通过」（§62-15）。 */
  async reject(
    productId: string,
    input: FactReviewDecisionInput,
    actorId: string
  ): Promise<FactReviewRecordView> {
    return this.decide(productId, input, actorId, "REJECTED");
  }

  private async decide(
    productId: string,
    input: FactReviewDecisionInput,
    actorId: string,
    status: FactReviewStatus
  ): Promise<FactReviewRecordView> {
    const product = await this.loadProduct(productId);
    const copy = await this.latestCopyRow(productId);
    if (!copy) {
      throw AppError.validation("还没有可审批的强成交话术版本（§53）");
    }

    const rows = (await this.loadProductRows(productId)).filter((row) => row.copyOutputId === copy.id);
    const versions = [...new Set(rows.map((row) => row.reviewVersion))].sort((a, b) => b - a);
    const target = input.version ?? versions[0];
    if (target === undefined || !versions.includes(target)) {
      throw AppError.notFound("要审批的事实审核版本不存在");
    }

    const targetRows = rows.filter((row) => row.reviewVersion === target);
    const first = targetRows[0];
    if (!first) {
      throw AppError.notFound("要审批的事实审核版本不存在");
    }
    const blocking = targetRows.filter((row) => row.isBlocking).map((row) => row.text);
    if (status === "APPROVED" && (blocking.length > 0 || !first.publishable)) {
      throw AppError.validation(
        "这一版存在 RED 阻断句，禁止审批：必须改写或删除后才允许通过（§53 / §57 / §62-14）",
        {
          reviewed_version: target,
          blocking_sentences: blocking,
          publishable: false
        }
      );
    }

    await this.db
      .update(generatedClaims)
      .set({
        approvalStatus: status,
        approvalNote: input.note ?? null,
        reviewedBy: actorId,
        reviewedAt: new Date(),
        updatedAt: new Date()
      })
      .where(
        and(eq(generatedClaims.copyOutputId, copy.id), eq(generatedClaims.reviewVersion, target))
      );

    return this.readVersion(copy.id, target, product.productName);
  }

  /* ------------------------------------------------------------- 内部实现 */

  /**
   * 冻结成稿 → 纯函数入参。
   *
   * 三处取值一律用**成稿落库时冻结的那一份**：
   * `record.anchor`（§17 结论）、`record.price_high_story_ready`（§22 价格高度）、
   * `record.compliance.rnd_confirmed`（§25 研发证据是否存在）。
   */
  private toBuildInput(copy: CopyOutputRow, input: Awaited<ReturnType<SalesCopyService["buildInputForRow"]>>): FactReviewBuildInput {
    const draft = copy.record;
    return {
      product: input.product,
      value_dna: input.value_dna,
      architecture: input.architecture ?? null,
      philosophy: input.philosophy ?? null,
      category: input.category ?? null,
      body: salesCopyBodyOf(draft),
      anchor: draft.anchor,
      price_high_story_ready: draft.price_high_story_ready,
      rnd_confirmed: draft.compliance.rnd_confirmed
    };
  }

  private async persist(
    copy: CopyOutputRow,
    reviewVersion: number,
    input: FactReviewBuildInput,
    draft: ReturnType<typeof buildFactReview>,
    warnings: string[],
    actorId: string
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(generatedClaims)
        .values(
          draft.sentences.map((sentence) => ({
            productId: copy.productId,
            copyOutputId: copy.id,
            copyVersion: copy.version,
            reviewVersion,
            engine: draft.engine,
            overallRisk: draft.overall_risk,
            publishable: draft.publishable,
            rndConfirmed: input.rnd_confirmed,
            hasReliablePriceAnchor: input.anchor.has_reliable_price_anchor,
            priceHighStoryReady: input.price_high_story_ready,
            factsUsed: draft.facts_used,
            compliance: draft.compliance,
            evidenceGaps: draft.evidence_gaps,
            warnings,
            sentenceIndex: sentence.index,
            text: sentence.text,
            claimType: sentence.claim_type,
            risk: sentence.risk,
            issue: sentence.issue,
            suggestion: sentence.suggestion,
            isBlocking: sentence.is_blocking,
            approvalStatus: "PENDING" as FactReviewStatus,
            createdBy: actorId
          }))
        )
        .returning({ id: generatedClaims.id, sentenceIndex: generatedClaims.sentenceIndex });

      const idByIndex = new Map(inserted.map((row) => [row.sentenceIndex, row.id]));
      const evidenceRows = draft.sentences.flatMap((sentence) => {
        const claimId = idByIndex.get(sentence.index);
        if (!claimId) {
          throw new AppError("INTERNAL_ERROR", "事实审核写入失败：句子行缺失");
        }
        return factReviewEvidenceOf(sentence.evidence_refs).map((item) => ({
          claimId,
          sourceRef: item.source_ref,
          sourceId: item.source_id,
          excerpt: item.excerpt,
          evidenceKind: item.evidence_kind,
          traceable: item.traceable
        }));
      });
      if (evidenceRows.length > 0) {
        await tx.insert(claimEvidence).values(evidenceRows);
      }
    });
  }

  private async loadProduct(productId: string): Promise<ProductIdentity> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select({ id: products.id, productName: products.productName })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("产品不存在");
    }
    return row;
  }

  /** 审核对象默认是最新一版成稿（§62-15：旧版本原样保留，不会被改写）。 */
  private async latestCopyRow(productId: string): Promise<CopyOutputRow | null> {
    const rows = await this.db
      .select()
      .from(copyOutputs)
      .where(eq(copyOutputs.productId, productId))
      .orderBy(desc(copyOutputs.version))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findCopyRow(productId: string, recordId: string): Promise<CopyOutputRow | null> {
    const rows = await this.db
      .select()
      .from(copyOutputs)
      .where(and(eq(copyOutputs.id, recordId), eq(copyOutputs.productId, productId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 一次取全产品的审核行：按「成稿版本 → 审核序号 → 句序」倒序，供版本列表与总览分组。 */
  private async loadProductRows(productId: string) {
    return this.db
      .select()
      .from(generatedClaims)
      .where(eq(generatedClaims.productId, productId))
      .orderBy(
        desc(generatedClaims.copyVersion),
        desc(generatedClaims.reviewVersion),
        asc(generatedClaims.sentenceIndex)
      );
  }

  private async loadVersionRows(copyOutputId: string, reviewVersion: number) {
    return this.db
      .select()
      .from(generatedClaims)
      .where(
        and(
          eq(generatedClaims.copyOutputId, copyOutputId),
          eq(generatedClaims.reviewVersion, reviewVersion)
        )
      )
      .orderBy(asc(generatedClaims.sentenceIndex));
  }

  /**
   * 回看一次审核：**只读落库冻结行**，不重新跑任何判定（§57 / §62-15）。
   *
   * `summary` / `claim_counts` 由这些行机械计数得出（计数不是重新判定），
   * 其余结论一律取落库值，因此「今天再看一次」与「三个月前审核时」永远一致。
   */
  private async readVersion(
    copyOutputId: string,
    reviewVersion: number | undefined,
    productName: string
  ): Promise<FactReviewRecordView> {
    if (reviewVersion === undefined) {
      throw AppError.notFound("事实审核版本不存在");
    }
    const rows = await this.loadVersionRows(copyOutputId, reviewVersion);
    const first = rows[0];
    if (!first) {
      throw AppError.notFound("事实审核版本不存在");
    }

    const evidence = await this.loadEvidence(rows.map((row) => row.id));
    const sentences: FactReviewSentence[] = rows.map((row) => ({
      index: row.sentenceIndex,
      text: row.text,
      claim_type: row.claimType,
      risk: row.risk,
      evidence_refs: (evidence.get(row.id) ?? []).map((item) => `${item.source_ref}=${item.excerpt}`),
      issue: row.issue,
      suggestion: row.suggestion,
      is_blocking: row.isBlocking
    }));

    const review = factReviewRecord(
      {
        engine: first.engine,
        sentences,
        claim_counts: claimCountsOf(rows),
        summary: summaryOf(rows),
        overall_risk: first.overallRisk,
        publishable: first.publishable,
        blocking_sentences: sentences.filter((sentence) => sentence.is_blocking).map((s) => s.text),
        evidence_gaps: first.evidenceGaps,
        facts_used: first.factsUsed,
        compliance: first.compliance,
        warnings: first.warnings
      },
      {
        id: first.id,
        product_id: first.productId,
        product_name: productName,
        copy_output_id: first.copyOutputId,
        copy_version: first.copyVersion,
        version: first.reviewVersion,
        rnd_confirmed: first.rndConfirmed,
        has_reliable_price_anchor: first.hasReliablePriceAnchor,
        price_high_story_ready: first.priceHighStoryReady,
        created_at: first.createdAt.toISOString()
      }
    );

    return {
      review,
      evidence: rows.flatMap((row) =>
        (evidence.get(row.id) ?? []).map((item) =>
          factEvidenceSchema.parse({
            id: item.id,
            claim_id: row.id,
            source_ref: item.source_ref,
            source_id: item.source_id,
            excerpt: item.excerpt,
            evidence_kind: item.evidence_kind,
            traceable: item.traceable,
            created_at: item.created_at
          })
        )
      )
    };
  }

  private async loadEvidence(claimIds: string[]): Promise<Map<string, FactEvidence[]>> {
    const grouped = new Map<string, FactEvidence[]>();
    if (claimIds.length === 0) {
      return grouped;
    }
    const rows = await this.db
      .select()
      .from(claimEvidence)
      .where(inArray(claimEvidence.claimId, claimIds))
      .orderBy(asc(claimEvidence.createdAt), asc(claimEvidence.sourceRef));

    for (const row of rows) {
      const item: FactEvidence = {
        id: row.id,
        claim_id: row.claimId,
        source_ref: row.sourceRef,
        source_id: row.sourceId,
        excerpt: row.excerpt,
        evidence_kind: row.evidenceKind,
        traceable: row.traceable,
        created_at: row.createdAt.toISOString()
      };
      const list = grouped.get(row.claimId);
      if (list) {
        list.push(item);
      } else {
        grouped.set(row.claimId, [item]);
      }
    }
    return grouped;
  }

  /**
   * 当前有效审批：取**最近一次被审批或否决过的审核版本**（没有就返回 PENDING）。
   *
   * 审批记在被审批的那一版上，因此新生成一版话术不会「继承」上一版的审批结论：
   * 前端会看到「上一版已通过 v2 / 当前 v3 待审批」这样的事实，而不是一个会骗人的绿灯（§53）。
   */
  private async approvalOf(productId: string): Promise<FactReviewApproval> {
    const rows = await this.db
      .select({
        version: generatedClaims.reviewVersion,
        status: generatedClaims.approvalStatus,
        note: generatedClaims.approvalNote,
        reviewedBy: generatedClaims.reviewedBy,
        reviewedAt: generatedClaims.reviewedAt
      })
      .from(generatedClaims)
      .where(
        and(
          eq(generatedClaims.productId, productId),
          ne(generatedClaims.approvalStatus, "PENDING"),
          eq(generatedClaims.sentenceIndex, 1)
        )
      )
      .orderBy(desc(generatedClaims.copyVersion), desc(generatedClaims.reviewVersion))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return emptyApproval();
    }
    return {
      status: row.status,
      reviewed_version: row.version,
      note: row.note,
      reviewed_by: row.reviewedBy,
      reviewed_at: row.reviewedAt ? row.reviewedAt.toISOString() : null
    };
  }
}

/** 三层标记与三档风险的计数：由落库行机械计数得出（§53 / §49）。 */
function claimCountsOf(rows: readonly { claimType: FactReviewSentence["claim_type"] }[]): FactReviewClaimCounts {
  const counts: FactReviewClaimCounts = { FACT: 0, INTERPRETATION: 0, RHETORIC: 0 };
  for (const row of rows) {
    counts[row.claimType] += 1;
  }
  return counts;
}

function summaryOf(rows: readonly { risk: FactReviewSentence["risk"] }[]): FactReviewSummary {
  return {
    green: rows.filter((row) => row.risk === "GREEN").length,
    yellow: rows.filter((row) => row.risk === "YELLOW").length,
    red: rows.filter((row) => row.risk === "RED").length
  };
}

type ReviewRow = Awaited<ReturnType<FactReviewService["loadProductRows"]>>[number];

/** 版本列表：按「成稿版本 → 审核序号」倒序，只读冻结结论（§62-15）。 */
function versionSummariesOf(rows: readonly ReviewRow[]): FactReviewVersionSummary[] {
  const grouped = new Map<string, ReviewRow[]>();
  for (const row of rows) {
    const key = `${row.copyOutputId}:${row.reviewVersion}`;
    const list = grouped.get(key);
    if (list) {
      list.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }

  return [...grouped.values()]
    .map((group) => {
      const first = group[0];
      if (!first) {
        throw new AppError("INTERNAL_ERROR", "事实审核数据异常：审核版本没有句子行");
      }
      const summary = summaryOf(group);
      return factReviewVersionSummarySchema.parse({
        id: first.id,
        version: first.reviewVersion,
        copy_version: first.copyVersion,
        engine: first.engine,
        overall_risk: first.overallRisk,
        publishable: first.publishable,
        green: summary.green,
        yellow: summary.yellow,
        red: summary.red,
        facts_used: first.factsUsed,
        created_at: first.createdAt.toISOString()
      });
    })
    .sort((a, b) => b.copy_version - a.copy_version || b.version - a.version);
}

function emptyApproval(): FactReviewApproval {
  return {
    status: "PENDING",
    reviewed_version: null,
    note: null,
    reviewed_by: null,
    reviewed_at: null
  };
}

/** Agent 11 的用户侧输入：本产品已录入事实 + Value DNA 逐字值（不含任何对标产品事实，§62-5）。 */
function recordedValuesOf(input: FactReviewBuildInput): string[] {
  return salesCopyRecordedValues({
    product: input.product,
    dna: usableValueDna(input.value_dna)
  }).slice(0, 200);
}
