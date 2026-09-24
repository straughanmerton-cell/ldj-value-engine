import type { FastifyInstance } from "fastify";
import {
  PRODUCT_ARCHITECTURE_ACCEPTANCE_QUESTION,
  PRODUCT_ARCHITECTURE_ROLE_STATUS_LABELS,
  PRODUCT_ARCHITECTURE_ROLE_STATUS_TONES,
  productArchitectureGenerateSchema,
  productArchitectureListQuerySchema,
  productArchitectureUpdateSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { ProductArchitectureService } from "./product-architecture.service.js";

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

export interface ProductArchitectureServices {
  productArchitecture: ProductArchitectureService;
}

/**
 * Phase 10 路由（规格 §5 产品结构叙事 / §45 Agent 7 / §57 验收 / §31 一级导航）。
 *
 * - GET   /api/product-architecture/contract                          合同自检（九角色 + §45 八问 + 红线）
 * - GET   /api/product-architecture/labels                            前端标签文案（角色 / 问题 / 验收）
 * - GET   /api/product-architecture                                   跨产品「产品结构」库（筛选排序分页）
 * - GET   /api/products/{id}/architecture                             总览：模式判定 + 最新结构 + 版本列表
 * - GET   /api/products/{id}/architecture/versions                    版本列表（所有版本必须保留 §62-15）
 * - POST  /api/products/{id}/architecture/generate                    生成一版产品结构（201）
 * - GET   /api/products/{id}/architecture/{recordId}                  单版产品结构
 * - PATCH /api/products/{id}/architecture/{recordId}                  人工确认 / 备注
 *
 * 读需登录，写限 ADMIN / RESEARCHER：产品结构是配方哲学（Phase 11）与成交话术（Phase 12）的输入，
 * 不能让只读账号改写「这款茶的每一部分各自在干什么」。
 */
export function registerProductArchitectureRoutes(
  app: FastifyInstance,
  services: ProductArchitectureServices
): void {
  /** 合同自检：前端据此展示九角色、§45 八问、§57 验收与「不允许增加任何原料或配方事实」等红线。 */
  app.get("/api/product-architecture/contract", { preHandler: [app.requireAuth] }, async () =>
    services.productArchitecture.contractBody()
  );

  /** 标签与口径全部从 schema 层读，避免前端另写一套文案。 */
  app.get("/api/product-architecture/labels", { preHandler: [app.requireAuth] }, async () => ({
    // labelsBody() 已含 roles / agent7_questions / acceptance / limits / rules
    ...services.productArchitecture.labelsBody(),
    role_status_labels: PRODUCT_ARCHITECTURE_ROLE_STATUS_LABELS,
    role_status_tones: PRODUCT_ARCHITECTURE_ROLE_STATUS_TONES,
    acceptance_question: PRODUCT_ARCHITECTURE_ACCEPTANCE_QUESTION
  }));

  /** 「产品结构」库：跨产品只读总览（一行 = 一款产品最新一版结构，未生成的也会出现）。 */
  app.get("/api/product-architecture", { preHandler: [app.requireAuth] }, async (request) => {
    const query = productArchitectureListQuerySchema.parse(request.query ?? {});
    return services.productArchitecture.listMatrix(query);
  });

  app.get("/api/products/:id/architecture", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.productArchitecture.overview(id);
  });

  app.get(
    "/api/products/:id/architecture/versions",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      return { items: await services.productArchitecture.listVersions(id) };
    }
  );

  app.post(
    "/api/products/:id/architecture/generate",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = productArchitectureGenerateSchema.parse(request.body ?? {});
      return reply
        .code(201)
        .send(await services.productArchitecture.generate(id, input, actor.id));
    }
  );

  app.get(
    "/api/products/:id/architecture/:recordId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, recordId } = request.params as { id: string; recordId: string };
      return services.productArchitecture.getRecord(id, recordId);
    }
  );

  app.patch(
    "/api/products/:id/architecture/:recordId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id, recordId } = request.params as { id: string; recordId: string };
      const input = productArchitectureUpdateSchema.parse(request.body ?? {});
      return services.productArchitecture.update(id, recordId, input, actor.id);
    }
  );
}
