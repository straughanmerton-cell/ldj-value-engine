CREATE TYPE "public"."product_fact_group" AS ENUM('BASICS', 'MATERIAL', 'CRAFT', 'SENSORY', 'RND', 'OTHER');--> statement-breakpoint
CREATE TABLE "product_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"fact_key" text NOT NULL,
	"fact_label" text,
	"fact_group" "product_fact_group" DEFAULT 'OTHER' NOT NULL,
	"fact_value" text NOT NULL,
	"fact_status" "fact_status" DEFAULT 'UNCONFIRMED' NOT NULL,
	"evidence_note" text,
	"evidence_source_id" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasting_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
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
	"taster_name" text,
	"tasted_at" timestamp with time zone,
	"conclusion" text,
	"evidence_source_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "r_and_d_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"reference_product_id" uuid,
	"reference_product_name" text NOT NULL,
	"reference_type" "rnd_reference_type" NOT NULL,
	"description" text NOT NULL,
	"verification_status" "fact_status" DEFAULT 'UNCONFIRMED' NOT NULL,
	"evidence_source_id" uuid,
	"evidence_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_facts" ADD CONSTRAINT "product_facts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_facts" ADD CONSTRAINT "product_facts_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_facts" ADD CONSTRAINT "product_facts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasting_profiles" ADD CONSTRAINT "tasting_profiles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasting_profiles" ADD CONSTRAINT "tasting_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "r_and_d_references" ADD CONSTRAINT "r_and_d_references_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "r_and_d_references" ADD CONSTRAINT "r_and_d_references_reference_product_id_products_id_fk" FOREIGN KEY ("reference_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "r_and_d_references" ADD CONSTRAINT "r_and_d_references_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_facts_product_id_idx" ON "product_facts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_facts_fact_status_idx" ON "product_facts" USING btree ("fact_status");--> statement-breakpoint
CREATE INDEX "product_facts_fact_key_idx" ON "product_facts" USING btree ("fact_key");--> statement-breakpoint
CREATE INDEX "tasting_profiles_product_id_idx" ON "tasting_profiles" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "tasting_profiles_tasted_at_idx" ON "tasting_profiles" USING btree ("tasted_at");--> statement-breakpoint
CREATE INDEX "r_and_d_references_product_id_idx" ON "r_and_d_references" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "r_and_d_references_reference_product_id_idx" ON "r_and_d_references" USING btree ("reference_product_id");--> statement-breakpoint
CREATE INDEX "r_and_d_references_verification_status_idx" ON "r_and_d_references" USING btree ("verification_status");