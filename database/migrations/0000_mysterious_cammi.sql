CREATE TYPE "public"."anchor_type" AS ENUM('HIGHEST_VALUE', 'SIMILARITY_HIGH_VALUE', 'SALES_ANCHOR');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('FACT', 'INTERPRETATION', 'RHETORIC');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('OFFICIAL_CONFIRMED', 'INTERNAL_CONFIRMED', 'TASTING_CONFIRMED', 'RND_CONFIRMED', 'SUPPLIER_PROVIDED', 'UNCONFIRMED');--> statement-breakpoint
CREATE TYPE "public"."price_type" AS ENUM('OFFICIAL_RETAIL', 'LISTING', 'VERIFIED_TRANSACTION', 'AUCTION_HAMMER', 'HISTORICAL_REFERENCE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."research_job_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'WAITING_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."research_mode" AS ENUM('AUTO', 'BENCHMARK', 'CATEGORY_CREATOR');--> statement-breakpoint
CREATE TYPE "public"."resolved_research_mode" AS ENUM('BENCHMARK', 'CATEGORY_CREATOR');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('GREEN', 'YELLOW', 'RED');--> statement-breakpoint
CREATE TYPE "public"."rnd_reference_type" AS ENUM('sensory', 'formula_structure', 'positioning', 'concept', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'RESEARCHER', 'COPYWRITER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."value_code_key" AS ENUM('PEACOCK_IDENTITY', 'CORE_ORIGIN', 'PREMIUM_MATERIAL', 'FORMULA_ARCHITECTURE', 'SMOKY_SIGNATURE', 'STRONG_BODY', 'FAST_HUIGAN', 'STRONG_SALIVATION', 'CHA_QI', 'SCARCITY', 'AGE_VALUE', 'BRAND_PREMIUM', 'COLLECTION_RECOGNITION', 'MARKET_LIQUIDITY', 'STYLE_RECOGNITION', 'CRAFT_VALUE');--> statement-breakpoint
CREATE TYPE "public"."value_code_status" AS ENUM('ALREADY_HAVE', 'PARTIAL', 'TIME_DEPENDENT', 'NOT_HAVE', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'RESEARCHER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"product_name" text NOT NULL,
	"series_name" text,
	"year" integer NOT NULL,
	"tea_type" text NOT NULL,
	"tea_subtype" text,
	"origin_province" text,
	"origin_city" text,
	"origin_region" text,
	"mountain" text,
	"village" text,
	"weight_g" numeric(10, 2) NOT NULL,
	"pieces_per_box" integer,
	"boxes_per_case" integer,
	"suggested_retail_price" numeric(14, 2),
	"internal_cost" numeric(14, 2),
	"raw_material" text,
	"tree_type" text,
	"tree_age" text,
	"season" text,
	"harvest_standard" text,
	"grade" text,
	"blend_description" text,
	"material_notes" text,
	"kill_green_method" text,
	"rolling_method" text,
	"drying_method" text,
	"pressing_method" text,
	"fermentation_degree" text,
	"fermentation_method" text,
	"storage" text,
	"processing_notes" text,
	"dry_leaf_aroma" text,
	"hot_cup_aroma" text,
	"liquor_aroma" text,
	"cold_cup_aroma" text,
	"entry_taste" text,
	"bitterness" text,
	"astringency" text,
	"sweetness" text,
	"huigan" text,
	"salivation" text,
	"cha_qi" text,
	"thickness" text,
	"viscosity" text,
	"water_texture" text,
	"early_stage" text,
	"middle_stage" text,
	"late_stage" text,
	"finish" text,
	"endurance" text,
	"leaf_bottom" text,
	"benchmark_mode_preference" "research_mode" DEFAULT 'AUTO' NOT NULL,
	"copy_intensity_default" smallint DEFAULT 4 NOT NULL,
	"r_and_d_reference_enabled" boolean DEFAULT false NOT NULL,
	"r_and_d_reference_notes" text,
	"has_explicit_benchmark" boolean,
	"has_rnd_reference" boolean,
	"rnd_evidence_available" boolean,
	"formula_philosophy" jsonb,
	"product_architecture" jsonb,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_hash_unique" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_unique" ON "brands" USING btree ("name");--> statement-breakpoint
CREATE INDEX "products_product_name_idx" ON "products" USING btree ("product_name");--> statement-breakpoint
CREATE INDEX "products_tea_type_idx" ON "products" USING btree ("tea_type");--> statement-breakpoint
CREATE INDEX "products_mountain_idx" ON "products" USING btree ("mountain");--> statement-breakpoint
CREATE INDEX "products_brand_id_idx" ON "products" USING btree ("brand_id");