CREATE TABLE "category_creator_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"trigger" "category_creator_trigger" NOT NULL,
	"mode_at_generation" "resolved_research_mode" NOT NULL,
	"readiness" "category_readiness" NOT NULL,
	"supported_axes" integer DEFAULT 0 NOT NULL,
	"total_axes" integer DEFAULT 6 NOT NULL,
	"standard" jsonb NOT NULL,
	"style_identity" jsonb NOT NULL,
	"value_logic" jsonb NOT NULL,
	"evidence_gaps" jsonb NOT NULL,
	"fact_refs" jsonb NOT NULL,
	"value_dna_refs" jsonb NOT NULL,
	"is_confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_creator_profiles" ADD CONSTRAINT "category_creator_profiles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_creator_profiles" ADD CONSTRAINT "category_creator_profiles_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_creator_profiles" ADD CONSTRAINT "category_creator_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_creator_profiles_product_version_idx" ON "category_creator_profiles" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "category_creator_profiles_product_idx" ON "category_creator_profiles" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "category_creator_profiles_readiness_idx" ON "category_creator_profiles" USING btree ("product_id","readiness");