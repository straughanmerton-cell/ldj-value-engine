CREATE TYPE "public"."source_extraction_status" AS ENUM('NOT_EXTRACTED', 'EXTRACTED', 'PARTIAL', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."source_fetch_status" AS ENUM('PENDING', 'FETCHED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('SEARCH_RESULT', 'PRODUCT_PAGE', 'PRICE_PAGE', 'MARKETPLACE', 'AUCTION_PAGE', 'ARTICLE', 'FORUM', 'SOCIAL', 'OTHER');--> statement-breakpoint
CREATE TABLE "source_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"extraction" jsonb NOT NULL,
	"dropped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_content" jsonb DEFAULT 'false'::jsonb NOT NULL,
	"price_count" integer DEFAULT 0 NOT NULL,
	"price_type_counts" jsonb,
	"prompt_key" text DEFAULT 'WEB_EXTRACTOR' NOT NULL,
	"prompt_version" integer,
	"provider" text,
	"model" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"query" text,
	"query_type" text,
	"stage" text,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"domain" text DEFAULT 'unknown' NOT NULL,
	"title" text,
	"snippet" text,
	"source_kind" "source_kind" DEFAULT 'OTHER' NOT NULL,
	"published_at" text,
	"note" text,
	"fetch_status" "source_fetch_status" DEFAULT 'PENDING' NOT NULL,
	"http_status" integer,
	"fetch_error" text,
	"content_text" text,
	"content_chars" integer,
	"extraction_status" "source_extraction_status" DEFAULT 'NOT_EXTRACTED' NOT NULL,
	"extracted_at" timestamp with time zone,
	"last_extraction" jsonb,
	"last_extraction_dropped" jsonb,
	"last_extraction_warnings" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"dna_version" integer,
	"plan" jsonb NOT NULL,
	"query_count" integer DEFAULT 0 NOT NULL,
	"generator" text DEFAULT 'RULE_BASED' NOT NULL,
	"dropped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_version" integer,
	"provider" text,
	"model" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"status" "research_job_status" DEFAULT 'PENDING' NOT NULL,
	"current_stage" text,
	"progress" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_extractions" ADD CONSTRAINT "source_extractions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_extractions" ADD CONSTRAINT "source_extractions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_extractions" ADD CONSTRAINT "source_extractions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_plans" ADD CONSTRAINT "search_plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_plans" ADD CONSTRAINT "search_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_extractions_source_idx" ON "source_extractions" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "source_extractions_product_idx" ON "source_extractions" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_canonical_product_idx" ON "sources" USING btree ("canonical_url","product_id");--> statement-breakpoint
CREATE INDEX "sources_product_idx" ON "sources" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sources_domain_idx" ON "sources" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "sources_kind_idx" ON "sources" USING btree ("source_kind");--> statement-breakpoint
CREATE INDEX "search_plans_product_idx" ON "search_plans" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "search_plans_created_at_idx" ON "search_plans" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "research_jobs_product_idx" ON "research_jobs" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "research_jobs_status_idx" ON "research_jobs" USING btree ("status");