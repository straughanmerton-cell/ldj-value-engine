CREATE TABLE "formula_philosophies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"backbone_component" jsonb NOT NULL,
	"aroma_component" jsonb NOT NULL,
	"sweetness_component" jsonb NOT NULL,
	"body_component" jsonb NOT NULL,
	"finish_component" jsonb NOT NULL,
	"formula_strategy" text DEFAULT '' NOT NULL,
	"design_goal" text DEFAULT '' NOT NULL,
	"sales_explanation" text DEFAULT '' NOT NULL,
	"ingredient_roles" jsonb NOT NULL,
	"taste_roles" jsonb NOT NULL,
	"known_ratio" boolean DEFAULT false NOT NULL,
	"ratio_data" jsonb,
	"ratio_evidence" jsonb NOT NULL,
	"ratio_source" text,
	"evidence_ids" jsonb NOT NULL,
	"version" integer NOT NULL,
	"is_confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "formula_philosophies" ADD CONSTRAINT "formula_philosophies_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_philosophies" ADD CONSTRAINT "formula_philosophies_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_philosophies" ADD CONSTRAINT "formula_philosophies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "formula_philosophies_product_version_idx" ON "formula_philosophies" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "formula_philosophies_product_idx" ON "formula_philosophies" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "formula_philosophies_confirmed_idx" ON "formula_philosophies" USING btree ("product_id","is_confirmed");