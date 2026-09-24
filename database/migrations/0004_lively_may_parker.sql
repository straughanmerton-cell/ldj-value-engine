CREATE TYPE "public"."candidate_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."similarity_band" AS ENUM('REJECT', 'PERIPHERAL_REFERENCE', 'VALID_COMPARABLE', 'CORE_COMPARABLE');--> statement-breakpoint
CREATE TABLE "comparable_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand_name" text,
	"year" integer,
	"tea_type" text,
	"mountain" text,
	"origin_region" text,
	"raw_material" text,
	"weight_g" integer,
	"spec_notes" text,
	"identity_key" text NOT NULL,
	"facet" jsonb NOT NULL,
	"similarity_total" integer DEFAULT 0 NOT NULL,
	"similarity_band" "similarity_band" DEFAULT 'REJECT' NOT NULL,
	"similarity" jsonb,
	"status" "candidate_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observed_prices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"merged_sources" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comparable_candidates" ADD CONSTRAINT "comparable_candidates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparable_candidates" ADD CONSTRAINT "comparable_candidates_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparable_candidates" ADD CONSTRAINT "comparable_candidates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comparable_candidates_identity_idx" ON "comparable_candidates" USING btree ("product_id","identity_key");--> statement-breakpoint
CREATE INDEX "comparable_candidates_product_idx" ON "comparable_candidates" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "comparable_candidates_score_idx" ON "comparable_candidates" USING btree ("similarity_total");--> statement-breakpoint
CREATE INDEX "comparable_candidates_band_idx" ON "comparable_candidates" USING btree ("similarity_band");--> statement-breakpoint
CREATE INDEX "comparable_candidates_status_idx" ON "comparable_candidates" USING btree ("status");