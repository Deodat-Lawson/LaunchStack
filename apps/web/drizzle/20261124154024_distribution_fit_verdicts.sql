CREATE TABLE "pdr_ai_v2_distribution_fit_verdicts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"program_id" varchar(256) NOT NULL,
	"resolve_key" varchar(512) NOT NULL,
	"name" varchar(512) NOT NULL,
	"text" text NOT NULL,
	"fit" boolean NOT NULL,
	"reason" text,
	"basis" varchar(16) NOT NULL,
	"segment_key" varchar(64) NOT NULL,
	"run_id" varchar(256),
	"judged_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_fit_verdicts" ADD CONSTRAINT "pdr_ai_v2_distribution_fit_verdicts_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_fit_verdicts" ADD CONSTRAINT "pdr_ai_v2_distribution_fit_verdicts_program_id_pdr_ai_v2_distribution_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdr_ai_v2_distribution_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_fit_verdicts" ADD CONSTRAINT "pdr_ai_v2_distribution_fit_verdicts_run_id_pdr_ai_v2_distribution_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_distribution_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "distribution_fit_verdicts_program_org_unique" ON "pdr_ai_v2_distribution_fit_verdicts" USING btree ("company_id","program_id","resolve_key");--> statement-breakpoint
CREATE INDEX "distribution_fit_verdicts_company_idx" ON "pdr_ai_v2_distribution_fit_verdicts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "distribution_fit_verdicts_program_idx" ON "pdr_ai_v2_distribution_fit_verdicts" USING btree ("program_id","judged_at");