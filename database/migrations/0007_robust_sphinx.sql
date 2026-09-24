CREATE TABLE "value_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"anchor_type" "anchor_type" NOT NULL,
	"candidate_id" uuid,
	"market_offer_id" uuid,
	"similarity_score" integer DEFAULT 0 NOT NULL,
	"price_evidence_score" integer DEFAULT 0 NOT NULL,
	"price_percentile" integer,
	"sales_anchor_score" numeric(5, 2),
	"sales_anchor" jsonb,
	"rank" integer DEFAULT 1 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"rationale" text NOT NULL,
	"selected_by" uuid,
	"selected_at" timestamp with time zone,
	"snapshot" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "value_anchors" ADD CONSTRAINT "value_anchors_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_anchors" ADD CONSTRAINT "value_anchors_candidate_id_comparable_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."comparable_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_anchors" ADD CONSTRAINT "value_anchors_market_offer_id_market_offers_id_fk" FOREIGN KEY ("market_offer_id") REFERENCES "public"."market_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_anchors" ADD CONSTRAINT "value_anchors_selected_by_users_id_fk" FOREIGN KEY ("selected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_anchors" ADD CONSTRAINT "value_anchors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "value_anchors_product_idx" ON "value_anchors" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "value_anchors_type_idx" ON "value_anchors" USING btree ("anchor_type");--> statement-breakpoint
CREATE INDEX "value_anchors_rank_idx" ON "value_anchors" USING btree ("product_id","anchor_type","rank");--> statement-breakpoint
CREATE INDEX "value_anchors_primary_idx" ON "value_anchors" USING btree ("product_id","is_primary");