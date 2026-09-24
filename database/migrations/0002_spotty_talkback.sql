CREATE TYPE "public"."prompt_key" AS ENUM('FACT_NORMALIZER', 'SEARCH_PLANNER', 'WEB_EXTRACTOR', 'COMPARABLE_REVIEWER', 'VALUE_ANALYZER', 'VALUE_MAPPER', 'PRODUCT_ARCHITECT', 'FORMULA_PHILOSOPHY', 'SALES_COPYWRITER', 'COPY_INTENSIFIER', 'FACT_REVIEWER');--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_key" "prompt_key" NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"based_on_version" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "value_dna" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "value_dna_meta" jsonb;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_key_version_idx" ON "prompt_versions" USING btree ("prompt_key","version");--> statement-breakpoint
CREATE INDEX "prompt_versions_key_active_idx" ON "prompt_versions" USING btree ("prompt_key","is_active");