CREATE TABLE "product_value_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"preference" "research_mode" DEFAULT 'AUTO' NOT NULL,
	"mode_at_generation" "resolved_research_mode" NOT NULL,
	"resolved_by" text NOT NULL,
	"mode_reason" text NOT NULL,
	"anchor_context" jsonb,
	"codes" jsonb NOT NULL,
	"code_counts" jsonb NOT NULL,
	"stories" jsonb NOT NULL,
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
CREATE TABLE "value_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "value_code_key" NOT NULL,
	"label" text NOT NULL,
	"definition" text NOT NULL,
	"dimensions" jsonb NOT NULL,
	"requirement" text NOT NULL,
	"contribution" text NOT NULL,
	"evidence_refs" jsonb NOT NULL,
	"time_dependent" boolean DEFAULT false NOT NULL,
	"spec_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_value_codes" ADD CONSTRAINT "product_value_codes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_value_codes" ADD CONSTRAINT "product_value_codes_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_value_codes" ADD CONSTRAINT "product_value_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_value_codes_product_version_idx" ON "product_value_codes" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "product_value_codes_product_idx" ON "product_value_codes" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_value_codes_confirmed_idx" ON "product_value_codes" USING btree ("product_id","is_confirmed");--> statement-breakpoint
CREATE UNIQUE INDEX "value_codes_code_idx" ON "value_codes" USING btree ("code");