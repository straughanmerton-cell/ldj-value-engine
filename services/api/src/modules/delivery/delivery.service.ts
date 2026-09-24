import { and, count, desc, eq, ilike, max, or, sql, type SQL } from "drizzle-orm";
import type { CopyOutputRow, Database } from "@ldj/database";
import { brands, copyOutputs, generatedClaims, products } from "@ldj/database";
import {
  DELIVERY_CONTRACT,
  DELIVERY_DOWNSTREAM,
  DELIVERY_EXPORT_FORMAT_META,
  DELIVERY_EXPORT_SCOPE_META,
  DELIVERY_LIMITS,
  DEALER_CENTER_SLOT_META,
  FACT_REVIEW_SPEC_REF,
  HOST_CENTER_SLOT_META,
  HOST_CENTER_SPEC_REF,
  buildDealerCenterView,
  buildDeliveryGate,
  buildHostCenterView,
  copyIntensitySchema,
  deliveryGateLabel,
  deliveryGateTone,
  deliveryReviewSummarySchema,
  hostCenterRowSchema,
  renderDeliveryExport,
  type DeliveryExportQuery,
  type DeliveryExportView,
  type DeliveryGate,
  type DeliveryReviewSummary,
  type DeliveryViewInput,
  type DealerCenterView,
  type FactReviewStatus,
  type HostCenterListQuery,
  type HostCenterRow,
  type HostCenterView,
  type SalesCopyRecordView
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import type { FactReviewService } from "../fact-review/fact-review.service.js";
import type { SalesCopyService } from "../sales-copy/sales-copy.service.js";

/**
 * 交付服务（规格 §31 一级导航 / §32 产品详情 / §51 主播中心 / §52 经销商中心 / §53 / §57 / §60）。
 *
 * 这一层**只读**：不新增表、不写任何业务行（§62-15「派生视图」）。它做三件事：
 *
 * 1. **算出唯一一份发布闸门**（`buildDeliveryGate()`）——主播中心、经销商中心、跨产品排产列表、
 *    导出四条链路全部读同一个 `ready`，不存在「页面能看、导出能出、列表却说不合格」的分叉；
 * 2. **把一版已审批成稿重排成两个中心**：`buildHostCenterView()` / `buildDealerCenterView()`，
 *    排版在 `@ldj/schemas`，服务层只负责凑齐「最新一版成稿 + 它的最新一次审核」；
 * 3. **导出**：闸门不通过直接 409 并在 `details` 回阻断句与下一步，绝不产出半成品文件。
 *
 * 关键口径：**交付的是「最新一版成稿 + 这一版自己的审核」**。上一版审批通过、当前版刚生成
 * 还没审，是最容易出假绿灯的场景，因此历史审批不参与当前判断（§53 / §57）。
 */

/** 闸门状态字典：六种状态（含可交付）全部由唯一实现推出来，运维与前端不另写文案。 */
function gateStates(): readonly {
  label: string;
  tone: ReturnType<typeof deliveryGateTone>;
  ready: boolean;
  reason: string | null;
  next_action: string | null;
}[] {
  const sampleProductId = "00000000-0000-0000-0000-000000000000";
  /** Zod v4 的 `.uuid()` 校验版本位：全同字符（`1111…`）非法，必须用真实形状的 UUID。 */
  const sampleCopyId = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const review = (over: Partial<DeliveryReviewSummary>): DeliveryReviewSummary =>
    deliveryReviewSummarySchema.parse({
      copy_output_id: sampleCopyId,
      review_version: 1,
      approval_status: "PENDING",
      publishable: true,
      red_count: 0,
      sentence_count: 8,
      blocking_sentences: [],
      approved: false,
      spec_ref: FACT_REVIEW_SPEC_REF,
      ...over
    });
  const gate = (
    copyRecordId: string | null,
    copyVersion: number | null,
    summary: DeliveryReviewSummary | null
  ): DeliveryGate =>
    buildDeliveryGate({
      product_id: sampleProductId,
      product_name: "示例产品",
      copy_record_id: copyRecordId,
      copy_version: copyVersion,
      review: summary
    });

  return [
    gate(null, null, null),
    gate(sampleCopyId, 1, null),
    gate(sampleCopyId, 1, review({ publishable: false, red_count: 1, blocking_sentences: ["示例阻断句"] })),
    gate(sampleCopyId, 1, review({ approval_status: "REJECTED" })),
    gate(sampleCopyId, 1, review({})),
    gate(sampleCopyId, 1, review({ approval_status: "APPROVED", approved: true }))
  ].map((item) => ({
    label: deliveryGateLabel(item),
    tone: deliveryGateTone(item),
    ready: item.ready,
    reason: item.reason,
    next_action: item.next_action
  }));
}

export class DeliveryService {
  constructor(
    private readonly db: Database,
    private readonly salesCopy: SalesCopyService,
    private readonly factReview: FactReviewService
  ) {}

  /* ------------------------------------------------------------- 合同与标签 */

  /** 合同自检：十项 × 2 / 导出格式 / 发布闸门 / 七条铁律（§51 / §52 / §53 / §57 / §60）。 */
  contractBody(): {
    contract: typeof DELIVERY_CONTRACT;
    downstream: typeof DELIVERY_DOWNSTREAM;
    limits: typeof DELIVERY_LIMITS;
  } {
    return {
      contract: DELIVERY_CONTRACT,
      downstream: DELIVERY_DOWNSTREAM,
      limits: DELIVERY_LIMITS
    };
  }

  /** 标签文案一律从 schema 层读（§51 / §52 / §53 / §60），前端不另写一套。 */
  labelsBody(): {
    host_center_slots: typeof HOST_CENTER_SLOT_META;
    dealer_center_slots: typeof DEALER_CENTER_SLOT_META;
    export_formats: typeof DELIVERY_EXPORT_FORMAT_META;
    export_scopes: typeof DELIVERY_EXPORT_SCOPE_META;
    gate_states: ReturnType<typeof gateStates>;
    limits: typeof DELIVERY_LIMITS;
    rules: typeof DELIVERY_CONTRACT.rules;
  } {
    return {
      host_center_slots: HOST_CENTER_SLOT_META,
      dealer_center_slots: DEALER_CENTER_SLOT_META,
      export_formats: DELIVERY_EXPORT_FORMAT_META,
      export_scopes: DELIVERY_EXPORT_SCOPE_META,
      gate_states: gateStates(),
      limits: DELIVERY_LIMITS,
      rules: DELIVERY_CONTRACT.rules
    };
  }

  /* ----------------------------------------------------- §31 跨产品排产列表 */

  /**
   * 「主播中心」跨产品列表：一行 = 一款产品的最新一版成稿 + 这一版自己的审核结论。
   *
   * 与产品级视图同源：一行里的 `ready` / `gate_reason` 由 `buildDeliveryGate()` 现场算出，
   * 不再单独写一套「列表里的合格判断」，否则列表与详情页会给出两个结论（§62-14）。
   */
  async listHostCenter(query: HostCenterListQuery): Promise<Paginated<HostCenterRow>> {
    const filters: SQL[] = [];
    if (query.q) {
      const pattern = `%${query.q}%`;
      const condition = or(ilike(products.productName, pattern), ilike(brands.name, pattern));
      if (condition) {
        filters.push(condition);
      }
    }

    /**
     * `(product_id, version)` 唯一，所以「最新一版成稿」与「它的最新一次审核」都能用聚合子查询定位；
     * 聚合别名**不能**叫 `version`（被 join 的 `copy_outputs` 自己也有 version 列，Postgres 直接报 42702）。
     */
    const latestCopy = this.db
      .select({
        productId: copyOutputs.productId,
        latestVersion: max(copyOutputs.version).as("delivery_latest_copy_version")
      })
      .from(copyOutputs)
      .groupBy(copyOutputs.productId)
      .as("delivery_latest_copy");

    const latestReview = this.db
      .select({
        copyOutputId: generatedClaims.copyOutputId,
        reviewVersion: max(generatedClaims.reviewVersion).as("delivery_latest_review_version")
      })
      .from(generatedClaims)
      .groupBy(generatedClaims.copyOutputId)
      .as("delivery_latest_review");

    const reviewRow = this.db
      .select({
        copyOutputId: generatedClaims.copyOutputId,
        reviewVersion: generatedClaims.reviewVersion,
        approvalStatus: generatedClaims.approvalStatus,
        publishable: generatedClaims.publishable,
        /**
         * 子查询里的原始 SQL 字段**必须**用 `.as()` 起别名：Drizzle 的 SelectionProxy 在外层引用
         * 未命名的原始 SQL 字段时会直接抛错（`doesn't have an alias declared`），表现为整条
         * `GET /api/host-center` 500。
         */
        redCount: sql<number>`count(*) filter (where ${generatedClaims.isBlocking})`
          .mapWith(Number)
          .as("delivery_review_red_count"),
        sentenceCount: sql<number>`count(*)`.mapWith(Number).as("delivery_review_sentence_count"),
        blocking: sql<
          string[]
        >`coalesce(array_agg(${generatedClaims.text} order by ${generatedClaims.sentenceIndex}) filter (where ${generatedClaims.isBlocking}), '{}')`.as(
          "delivery_review_blocking"
        )
      })
      .from(generatedClaims)
      .groupBy(
        generatedClaims.copyOutputId,
        generatedClaims.reviewVersion,
        generatedClaims.approvalStatus,
        generatedClaims.publishable
      )
      .as("delivery_review_row");

    /** 交付闸门的三条件与 `buildDeliveryGate()` 一字不差；`coalesce` 兜住「还没成稿 / 还没审」的空值。 */
    const readyExpr = sql`coalesce((${copyOutputs.id} is not null and ${reviewRow.publishable} is true and ${reviewRow.approvalStatus} = 'APPROVED'), false)`;
    if (query.ready === true) {
      filters.push(sql`${readyExpr} = true`);
    } else if (query.ready === false) {
      filters.push(sql`(not ${readyExpr})`);
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const joined = () =>
      this.db
        .select({
          productId: products.id,
          productName: products.productName,
          year: products.year,
          teaType: products.teaType,
          mountain: products.mountain,
          record: copyOutputs,
          reviewVersion: reviewRow.reviewVersion,
          approvalStatus: reviewRow.approvalStatus,
          publishable: reviewRow.publishable,
          redCount: reviewRow.redCount,
          sentenceCount: reviewRow.sentenceCount,
          blocking: reviewRow.blocking
        })
        .from(products)
        .leftJoin(brands, eq(brands.id, products.brandId))
        .leftJoin(latestCopy, eq(latestCopy.productId, products.id))
        .leftJoin(
          copyOutputs,
          and(eq(copyOutputs.productId, products.id), eq(copyOutputs.version, latestCopy.latestVersion))
        )
        .leftJoin(latestReview, eq(latestReview.copyOutputId, copyOutputs.id))
        .leftJoin(
          reviewRow,
          and(
            eq(reviewRow.copyOutputId, latestReview.copyOutputId),
            eq(reviewRow.reviewVersion, latestReview.reviewVersion)
          )
        )
        .where(where);

    const pagination = normalizePagination({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DELIVERY_LIMITS.defaultPageSize
    });

    const rows = await joined()
      .orderBy(sql`${readyExpr} desc`, products.productName, products.id)
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const totalRows = await this.db
      .select({ value: count() })
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(latestCopy, eq(latestCopy.productId, products.id))
      .leftJoin(
        copyOutputs,
        and(eq(copyOutputs.productId, products.id), eq(copyOutputs.version, latestCopy.latestVersion))
      )
      .leftJoin(latestReview, eq(latestReview.copyOutputId, copyOutputs.id))
      .leftJoin(
        reviewRow,
        and(
          eq(reviewRow.copyOutputId, latestReview.copyOutputId),
          eq(reviewRow.reviewVersion, latestReview.reviewVersion)
        )
      )
      .where(where);

    return buildPage(
      rows.map((row) => this.toHostCenterRow(row)),
      Number(totalRows[0]?.value ?? 0),
      pagination
    );
  }

  /* --------------------------------------------- 产品级：两个中心与导出 */

  /** §51 主播中心：一版已审批成稿重排成「主播拿起来就能念」的十项。 */
  async hostCenter(productId: string): Promise<HostCenterView> {
    return buildHostCenterView(await this.deliveryInput(productId));
  }

  /** §52 经销商中心：同一版成稿重排成「讲给终端听」的十项。 */
  async dealerCenter(productId: string): Promise<DealerCenterView> {
    return buildDealerCenterView(await this.deliveryInput(productId));
  }

  /**
   * §60 导出：把两个中心渲染成 Markdown / 纯文本。
   *
   * 闸门不通过一律 409，并在 `details` 里回「卡在哪一步 + 阻断句 + 下一步」：
   * 宁可让运营看到一句明确的拒绝，也不产出「看起来能用其实没审过」的文件（§53 / §57 / §62-14）。
   */
  async export(productId: string, query: DeliveryExportQuery): Promise<DeliveryExportView> {
    const input = await this.deliveryInput(productId);
    if (!input.gate.ready) {
      throw new AppError("CONFLICT", input.gate.reason ?? "当前版本还不能导出", 409, {
        gate: input.gate,
        gate_label: deliveryGateLabel(input.gate),
        blocking_sentences: input.gate.blocking_sentences,
        next_action: input.gate.next_action
      });
    }

    const view = renderDeliveryExport({
      product_id: input.product_id,
      product_name: input.product_name,
      format: query.format,
      scope: query.scope,
      host: buildHostCenterView(input),
      dealer: buildDealerCenterView(input),
      generated_at: new Date().toISOString()
    });

    if (view.chars > DELIVERY_LIMITS.maxExportChars) {
      throw AppError.validation(
        `导出正文 ${view.chars} 字，超过单次上限 ${DELIVERY_LIMITS.maxExportChars} 字：请缩小导出范围后重试`,
        { chars: view.chars, max_export_chars: DELIVERY_LIMITS.maxExportChars }
      );
    }
    return view;
  }

  /* ------------------------------------------------------------- 读取助手 */

  /**
   * 两个中心与导出的唯一入参来源：**最新一版成稿 + 这一版自己的最新一次审核**。
   *
   * 成稿视图复用 `SalesCopyService.getRecord()`，所以「页面上的正文」与「强成交话术 Tab 里的正文」
   * 逐字相同；审核结论复用 `FactReviewService.deliveryReviewSummary()`，所以「哪一版算审过」
   * 也只有一份实现。任何一处漂移都会让同一条茶出现两种说法（Phase 11 的教训）。
   */
  private async deliveryInput(productId: string): Promise<DeliveryViewInput> {
    const product = await this.loadProduct(productId);
    const latest = await this.latestCopyRow(productId);
    const record: SalesCopyRecordView | null = latest
      ? await this.salesCopy.getRecord(productId, latest.id)
      : null;
    const review = latest ? await this.factReview.deliveryReviewSummary(latest.id) : null;
    return {
      product_id: product.id,
      product_name: product.productName,
      record,
      gate: buildDeliveryGate({
        product_id: product.id,
        product_name: product.productName,
        copy_record_id: latest?.id ?? null,
        copy_version: latest?.version ?? null,
        review
      })
    };
  }

  /** 列表一行 → 交付行：`ready` / `gate_reason` 与详情页同源（§62-14）。 */
  private toHostCenterRow(row: HostCenterSourceRow): HostCenterRow {
    const record = row.record && row.record.id ? row.record : null;
    const draft = record ? record.record : null;
    const summary = this.reviewSummaryOf(record, row);
    const gate = buildDeliveryGate({
      product_id: row.productId,
      product_name: row.productName,
      copy_record_id: record?.id ?? null,
      copy_version: record?.version ?? null,
      review: summary
    });

    return hostCenterRowSchema.parse({
      product_id: row.productId,
      product_name: row.productName,
      year: row.year,
      tea_type: row.teaType,
      mountain: row.mountain,
      copy_record_id: record?.id ?? null,
      copy_version: record?.version ?? null,
      one_liner: draft ? draft.headline.one_liner : null,
      intensity: record ? copyIntensitySchema.parse(record.intensity) : null,
      impact_score: draft ? draft.impact_score.total : null,
      impact_band: draft ? draft.impact_score.band : null,
      level5_passed: draft ? draft.level5.satisfied : false,
      compliance_passed: draft ? draft.compliance.risk !== "RED" : false,
      generated_at: record ? record.createdAt.toISOString() : null,
      review_version: summary?.review_version ?? null,
      approval_status: summary?.approval_status ?? "PENDING",
      publishable: summary ? summary.publishable : null,
      red_count: summary?.red_count ?? 0,
      ready: gate.ready,
      gate_reason: gate.reason,
      spec_ref: HOST_CENTER_SPEC_REF
    });
  }

  /** 列表行里的审核列 → 冻结摘要；没有成稿或没审过一律 null（不猜、不补默认）。 */
  private reviewSummaryOf(
    record: CopyOutputRow | null,
    row: HostCenterSourceRow
  ): DeliveryReviewSummary | null {
    if (!record || row.reviewVersion === null) {
      return null;
    }
    const status = row.approvalStatus ?? "PENDING";
    return deliveryReviewSummarySchema.parse({
      copy_output_id: record.id,
      review_version: row.reviewVersion,
      approval_status: status,
      publishable: row.publishable ?? false,
      red_count: row.redCount ?? 0,
      sentence_count: row.sentenceCount ?? 0,
      blocking_sentences: row.blocking ?? [],
      approved: status === "APPROVED",
      spec_ref: FACT_REVIEW_SPEC_REF
    });
  }

  private async loadProduct(productId: string): Promise<{ id: string; productName: string }> {
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

  /** 最新一版成稿：交付永远只认它，历史版本只用于版本管理页（§57 / §62-15）。 */
  private async latestCopyRow(productId: string): Promise<CopyOutputRow | null> {
    const rows = await this.db
      .select()
      .from(copyOutputs)
      .where(eq(copyOutputs.productId, productId))
      .orderBy(desc(copyOutputs.version))
      .limit(1);
    return rows[0] ?? null;
  }
}

/** 跨产品列表的一行原始列（含 left join 的空值，必须逐个兜底）。 */
interface HostCenterSourceRow {
  productId: string;
  productName: string;
  year: number;
  teaType: string;
  mountain: string | null;
  record: CopyOutputRow | null;
  reviewVersion: number | null;
  approvalStatus: FactReviewStatus | null;
  publishable: boolean | null;
  redCount: number | null;
  sentenceCount: number | null;
  blocking: string[] | null;
}
