import type { FastifyInstance } from "fastify";
import { createAiProvider } from "@ldj/ai";
import { createSearchProvider } from "@ldj/search";
import {
  CORE_NAV_MODULES,
  CORE_FEATURES,
  DELIVERED_PHASES,
  PROMPT_MANAGEMENT_CAPABILITIES,
  VALUE_DNA_DIMENSIONS
} from "@ldj/schemas";
import { listPrompts } from "@ldj/prompts";
import { AuthService } from "./modules/auth/service.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { BrandService } from "./modules/brands/service.js";
import { registerBrandRoutes } from "./modules/brands/routes.js";
import { ProductService } from "./modules/products/service.js";
import { registerProductRoutes } from "./modules/products/routes.js";
import { ProductFactService } from "./modules/product-records/facts.service.js";
import { RndReferenceService } from "./modules/product-records/rnd.service.js";
import { TastingProfileService } from "./modules/product-records/tasting.service.js";
import { registerProductRecordRoutes } from "./modules/product-records/routes.js";
import { PromptManagerService } from "./modules/prompts/service.js";
import { registerPromptRoutes } from "./modules/prompts/routes.js";
import { ValueDnaService } from "./modules/value-dna/service.js";
import { registerValueDnaRoutes } from "./modules/value-dna/routes.js";
import { CrawlerService } from "./modules/research/crawler.service.js";
import { SearchPlanService } from "./modules/research/search-plan.service.js";
import { SourceService } from "./modules/research/source.service.js";
import { ResearchService } from "./modules/research/research.service.js";
import { registerResearchRoutes } from "./modules/research/routes.js";
import { CandidatePoolService } from "./modules/candidates/similarity.service.js";
import { CandidatesService } from "./modules/candidates/candidates.service.js";
import { registerCandidateRoutes } from "./modules/candidates/routes.js";
import { MarketPricesService } from "./modules/prices/market-prices.service.js";
import { registerMarketPriceRoutes } from "./modules/prices/routes.js";
import { AnchorsService } from "./modules/anchors/anchors.service.js";
import { registerAnchorRoutes } from "./modules/anchors/routes.js";
import { CategoryCreatorService } from "./modules/category-creator/category-creator.service.js";
import { registerCategoryCreatorRoutes } from "./modules/category-creator/routes.js";
import { ValueCodesService } from "./modules/value-codes/value-codes.service.js";
import { registerValueCodeRoutes } from "./modules/value-codes/routes.js";
import { ProductArchitectureService } from "./modules/product-architecture/product-architecture.service.js";
import { registerProductArchitectureRoutes } from "./modules/product-architecture/routes.js";
import { FormulaPhilosophyService } from "./modules/formula-philosophy/formula-philosophy.service.js";
import { registerFormulaPhilosophyRoutes } from "./modules/formula-philosophy/routes.js";
import { SalesCopyService } from "./modules/sales-copy/sales-copy.service.js";
import { registerSalesCopyRoutes } from "./modules/sales-copy/routes.js";
import { FactReviewService } from "./modules/fact-review/fact-review.service.js";
import { registerFactReviewRoutes } from "./modules/fact-review/routes.js";
import { DeliveryService } from "./modules/delivery/delivery.service.js";
import { registerDeliveryRoutes } from "./modules/delivery/routes.js";
import { ChatService } from "./modules/chat/chat.service.js";
import { registerChatRoutes } from "./modules/chat/routes.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import type { AppConfig } from "./config.js";

export function registerRoutes(app: FastifyInstance, config: AppConfig): void {
  const db = app.dbHandle.db;
  const authService = new AuthService(db, {
    jwtSecret: config.jwtSecret,
    accessTokenTtlMinutes: config.accessTokenTtlMinutes,
    refreshTokenTtlDays: config.refreshTokenTtlDays
  });
  const brandService = new BrandService(db);
  const productService = new ProductService(db);
  const productRecordServices = {
    facts: new ProductFactService(db),
    tasting: new TastingProfileService(db),
    rnd: new RndReferenceService(db)
  };
  const ai = config.aiProvider ?? createAiProvider(config.env);
  const promptManager = new PromptManagerService(db, ai);
  const valueDna = new ValueDnaService(db, ai, promptManager);
  const search = config.searchProvider ?? createSearchProvider(config.env);
  const crawler = config.crawler ?? new CrawlerService();
  const searchPlanService = new SearchPlanService(db, ai, promptManager);
  const sourceService = new SourceService(db, ai, promptManager, crawler);
  const candidatePool = new CandidatePoolService(db);
  const candidatesService = new CandidatesService(db, candidatePool);
  const marketPrices = new MarketPricesService(db);
  const anchors = new AnchorsService(db);
  const categoryCreator = new CategoryCreatorService(db, anchors);
  const valueCodes = new ValueCodesService(db, anchors);
  const productArchitecture = new ProductArchitectureService(db, anchors);
  const formulaPhilosophy = new FormulaPhilosophyService(db, anchors);
  const salesCopy = new SalesCopyService(db, anchors);
  const factReview = new FactReviewService(db, salesCopy, ai, promptManager);
  const delivery = new DeliveryService(db, salesCopy, factReview);
  /** 对话工作台要按产品名去全网找对标，所以和 Phase 4 共用同一个检索通道（§12 Adapter）。 */
  const chat = new ChatService(db, anchors, ai, search);
  const researchService = new ResearchService(
    db,
    search,
    searchPlanService,
    sourceService,
    crawler,
    candidatesService,
    marketPrices,
    anchors
  );

  registerHealthRoutes(app);
  registerAuthRoutes(app, { authService });
  registerBrandRoutes(app, brandService);
  registerProductRoutes(app, productService);
  registerProductRecordRoutes(app, productRecordServices);
  registerValueDnaRoutes(app, valueDna);
  registerPromptRoutes(app, promptManager);
  registerResearchRoutes(app, {
    research: researchService,
    sources: sourceService,
    searchPlans: searchPlanService
  });
  registerCandidateRoutes(app, { candidates: candidatesService });
  registerMarketPriceRoutes(app, { prices: marketPrices });
  registerAnchorRoutes(app, { anchors });
  registerCategoryCreatorRoutes(app, { categoryCreator });
  registerValueCodeRoutes(app, { valueCodes });
  registerProductArchitectureRoutes(app, { productArchitecture });
  registerFormulaPhilosophyRoutes(app, { formulaPhilosophy });
  registerSalesCopyRoutes(app, { salesCopy });
  registerFactReviewRoutes(app, { factReview });
  registerDeliveryRoutes(app, { delivery });
  registerChatRoutes(app, { chat });

  /** 需求基线自检：让前端与运维能确认六大核心功能与信息架构没有被裁剪。 */
  app.get("/api/meta/core-features", { preHandler: [app.requireAuth] }, async () => ({
    core_features: CORE_FEATURES.map((feature) => ({
      key: feature.key,
      name: feature.name,
      spec_ref: feature.specRef,
      phase: feature.phase
    })),
    navigation: CORE_NAV_MODULES,
    prompts: listPrompts().map((prompt) => ({
      key: prompt.key,
      agent: prompt.agent,
      file: prompt.file,
      version: prompt.version
    })),
    value_dna: {
      spec_ref: "§9",
      dimensions: VALUE_DNA_DIMENSIONS
    },
    delivered_phases: DELIVERED_PHASES,
    research_pipeline: {
      spec_ref: "§55 / §56",
      stages: 22,
      mode_notes: {
        BENCHMARK: "有可靠锚点：进入高价值对标模式（Benchmark Mode）",
        CATEGORY_CREATOR: "没有可靠锚点：强制切换自建高端标准模式（Category Creator Mode）"
      }
    },
    prompt_management: {
      spec_ref: "§50",
      capabilities: PROMPT_MANAGEMENT_CAPABILITIES
    },
    ai_provider: ai.name,
    ai_model: ai.name === "deepseek" ? config.env.DEEPSEEK_MODEL : null
  }));
}
