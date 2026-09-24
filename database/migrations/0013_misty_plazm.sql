CREATE TABLE "copy_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"preference" "research_mode" DEFAULT 'AUTO' NOT NULL,
	"mode_at_generation" "resolved_research_mode" NOT NULL,
	"resolved_by" text NOT NULL,
	"mode_reason" text NOT NULL,
	"intensity" smallint DEFAULT 4 NOT NULL,
	"intensify_rounds" integer DEFAULT 0 NOT NULL,
	"value_focus" jsonb NOT NULL,
	"record" jsonb NOT NULL,
	"impact_score_total" integer DEFAULT 0 NOT NULL,
	"impact_score_band" text DEFAULT 'REWRITE' NOT NULL,
	"level5_passed" boolean DEFAULT false NOT NULL,
	"is_confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copy_outputs" ADD CONSTRAINT "copy_outputs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_outputs" ADD CONSTRAINT "copy_outputs_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_outputs" ADD CONSTRAINT "copy_outputs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "copy_outputs_product_version_idx" ON "copy_outputs" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "copy_outputs_product_idx" ON "copy_outputs" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "copy_outputs_confirmed_idx" ON "copy_outputs" USING btree ("product_id","is_confirmed");--> statement-breakpoint
CREATE INDEX "copy_outputs_score_idx" ON "copy_outputs" USING btree ("impact_score_total");