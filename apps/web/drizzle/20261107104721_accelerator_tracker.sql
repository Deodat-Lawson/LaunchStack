CREATE TABLE "pdr_ai_v2_accelerator_tracker_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" bigint NOT NULL,
	"program_id" varchar(64) NOT NULL,
	"cycle_id" varchar(64),
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'shortlisted' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"submitted_on" date,
	"next_action" text,
	"planned_deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_accelerator_tracker_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" bigint NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_on" date,
	"priority" text DEFAULT 'medium' NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accelerator_tracker_id_company_unique" ON "pdr_ai_v2_accelerator_tracker_opportunities" USING btree ("id","company_id");--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_accelerator_tracker_opportunities" ADD CONSTRAINT "pdr_ai_v2_accelerator_tracker_opportunities_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_accelerator_tracker_opportunities" ADD CONSTRAINT "pdr_ai_v2_accelerator_tracker_opportunities_program_id_pdr_ai_v2_accelerator_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdr_ai_v2_accelerator_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_accelerator_tracker_tasks" ADD CONSTRAINT "accelerator_tracker_tasks_opportunity_company_fk" FOREIGN KEY ("opportunity_id","company_id") REFERENCES "public"."pdr_ai_v2_accelerator_tracker_opportunities"("id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accelerator_tracker_company_program_cycle_unique" ON "pdr_ai_v2_accelerator_tracker_opportunities" USING btree ("company_id","program_id","cycle_id") WHERE "pdr_ai_v2_accelerator_tracker_opportunities"."cycle_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accelerator_tracker_company_program_only_unique" ON "pdr_ai_v2_accelerator_tracker_opportunities" USING btree ("company_id","program_id") WHERE "pdr_ai_v2_accelerator_tracker_opportunities"."cycle_id" IS NULL;--> statement-breakpoint
CREATE INDEX "accelerator_tracker_tasks_company_opportunity_idx" ON "pdr_ai_v2_accelerator_tracker_tasks" USING btree ("company_id","opportunity_id");