CREATE TYPE "public"."market_offer_attribution" AS ENUM('MANUAL', 'CANDIDATE', 'SOURCE_UNATTRIBUTED');--> statement-breakpoint
CREATE TYPE "public"."price_evidence_band" AS ENUM('STRONG', 'USABLE', 'WEAK');--> statement-breakpoint
CREATE TABLE "market_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"candidate_id" uuid,
	"source_id" uuid,
	"subject_name" text,
	"subject_brand" text,
	"subject_year" integer,
	"subject_spec" text,
	"identity_key" text,
	"price_type" "price_type" NOT NULL,
	"unit_scope" text,
	"value" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"weight_g" integer,
	"pieces_per_case" integer,
	"price_per_kg" numeric(16, 2),
	"price_357g" numeric(16, 2),
	"piece_equivalent_allowed" boolean DEFAULT true NOT NULL,
	"evidence_score" integer DEFAULT 0 NOT NULL,
	"evidence_band" "price_evidence_band" DEFAULT 'WEAK' NOT NULL,
	"evidence" jsonb,
	"attribution" "market_offer_attribution" DEFAULT 'MANUAL' NOT NULL,
	"quote" text NOT NULL,
	"note" text,
	"manual_note" text,
	"observed_at" text,
	"published_at" text,
	"is_outlier" boolean DEFAULT false NOT NULL,
	"outlier_reason" text,
	"outlier_median" numeric(14, 2),
	"outlier_sample_size" integer,
	"outlier_group_key" text,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"dedup_key" text NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_count" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_candidate_id_comparable_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."comparable_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_offers_dedup_idx" ON "market_offers" USING btree ("product_id","dedup_key");--> statement-breakpoint
CREATE INDEX "market_offers_product_idx" ON "market_offers" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "market_offers_candidate_idx" ON "market_offers" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "market_offers_type_idx" ON "market_offers" USING btree ("price_type");--> statement-breakpoint
CREATE INDEX "market_offers_band_idx" ON "market_offers" USING btree ("evidence_band");--> statement-breakpoint
CREATE INDEX "market_offers_outlier_idx" ON "market_offers" USING btree ("is_outlier");