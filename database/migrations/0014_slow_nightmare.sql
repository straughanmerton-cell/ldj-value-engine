CREATE TABLE "generated_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"copy_output_id" uuid NOT NULL,
	"copy_version" integer NOT NULL,
	"review_version" integer NOT NULL,
	"engine" text NOT NULL,
	"overall_risk" "risk_level" NOT NULL,
	"publishable" boolean NOT NULL,
	"rnd_confirmed" boolean NOT NULL,
	"has_reliable_price_anchor" boolean NOT NULL,
	"price_high_story_ready" boolean NOT NULL,
	"facts_used" integer DEFAULT 0 NOT NULL,
	"compliance" jsonb NOT NULL,
	"evidence_gaps" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"sentence_index" integer NOT NULL,
	"text" text NOT NULL,
	"claim_type" "claim_type" NOT NULL,
	"risk" "risk_level" NOT NULL,
	"issue" text,
	"suggestion" text,
	"is_blocking" boolean DEFAULT false NOT NULL,
	"approval_status" text DEFAULT 'PENDING' NOT NULL,
	"approval_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"source_ref" text NOT NULL,
	"source_id" uuid,
	"excerpt" text NOT NULL,
	"evidence_kind" text NOT NULL,
	"traceable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_claims" ADD CONSTRAINT "generated_claims_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_claims" ADD CONSTRAINT "generated_claims_copy_output_id_copy_outputs_id_fk" FOREIGN KEY ("copy_output_id") REFERENCES "public"."copy_outputs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_claims" ADD CONSTRAINT "generated_claims_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_claims" ADD CONSTRAINT "generated_claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_generated_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."generated_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generated_claims_version_sentence_idx" ON "generated_claims" USING btree ("copy_output_id","review_version","sentence_index");--> statement-breakpoint
CREATE INDEX "generated_claims_product_idx" ON "generated_claims" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "generated_claims_review_idx" ON "generated_claims" USING btree ("copy_output_id","review_version");--> statement-breakpoint
CREATE INDEX "generated_claims_approval_idx" ON "generated_claims" USING btree ("product_id","approval_status","review_version");--> statement-breakpoint
CREATE INDEX "claim_evidence_claim_idx" ON "claim_evidence" USING btree ("claim_id");