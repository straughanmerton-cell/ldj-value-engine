CREATE TABLE "product_architectures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"backbone" text DEFAULT '' NOT NULL,
	"identity" text DEFAULT '' NOT NULL,
	"aroma_role" text DEFAULT '' NOT NULL,
	"body_role" text DEFAULT '' NOT NULL,
	"front_stage_role" text DEFAULT '' NOT NULL,
	"middle_stage_role" text DEFAULT '' NOT NULL,
	"finish_role" text DEFAULT '' NOT NULL,
	"memory_point" text DEFAULT '' NOT NULL,
	"value_role" text DEFAULT '' NOT NULL,
	"narrative" text DEFAULT '' NOT NULL,
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
ALTER TABLE "product_architectures" ADD CONSTRAINT "product_architectures_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_architectures" ADD CONSTRAINT "product_architectures_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_architectures" ADD CONSTRAINT "product_architectures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_architectures_product_version_idx" ON "product_architectures" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "product_architectures_product_idx" ON "product_architectures" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_architectures_confirmed_idx" ON "product_architectures" USING btree ("product_id","is_confirmed");