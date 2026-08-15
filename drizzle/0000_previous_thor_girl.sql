CREATE TABLE "export_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filters" jsonb NOT NULL,
	"row_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_norm" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"submission_ref" text,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"email_norm" text NOT NULL,
	"first_name_norm" text NOT NULL,
	"last_name_norm" text NOT NULL,
	"highest_qualification" text NOT NULL,
	"graduation_institution" text NOT NULL,
	"graduation_year" integer NOT NULL,
	"postgraduation_institution" text,
	"postgraduation_year" integer,
	"doctoral_institution" text,
	"doctoral_year" integer,
	"current_location" text NOT NULL,
	"current_organisation" text,
	"designation" text,
	"current_role_start_date" date,
	"organisation_function" text NOT NULL,
	"total_years_experience" numeric(4, 1) NOT NULL,
	"experience_band" text NOT NULL,
	"industry_group" text NOT NULL,
	"experience_summary" text NOT NULL,
	"key_skills" text NOT NULL,
	"achievements_certifications" text,
	"resume_filename" text NOT NULL,
	"resume_format" text NOT NULL,
	"resume_size_kb" integer NOT NULL,
	"parse_method" text NOT NULL,
	"ref_code" text,
	"duplicate_flag" text DEFAULT 'none' NOT NULL,
	"consent_notice_version" text NOT NULL,
	"consent_timestamp" timestamp with time zone NOT NULL,
	"retention_expiry_date" date NOT NULL,
	"withdrawal_token_hash" text NOT NULL,
	"consent_ip" text,
	"resume_blob_path" text NOT NULL,
	"renewed_at" timestamp with time zone,
	"reconsent_notice_sent_at" timestamp with time zone,
	CONSTRAINT "submissions_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"path" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filename" text NOT NULL,
	"size_kb" integer NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_name_norm_unique" ON "institutions" USING btree ("name_norm");--> statement-breakpoint
CREATE INDEX "outbox_created_at_idx" ON "outbox" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_identity_unique" ON "submissions" USING btree ("email_norm","first_name_norm","last_name_norm");--> statement-breakpoint
CREATE INDEX "submissions_email_norm_idx" ON "submissions" USING btree ("email_norm");--> statement-breakpoint
CREATE INDEX "submissions_name_norm_idx" ON "submissions" USING btree ("first_name_norm","last_name_norm");--> statement-breakpoint
CREATE INDEX "submissions_band_idx" ON "submissions" USING btree ("experience_band");--> statement-breakpoint
CREATE INDEX "submissions_industry_idx" ON "submissions" USING btree ("industry_group");--> statement-breakpoint
CREATE INDEX "submissions_ref_code_idx" ON "submissions" USING btree ("ref_code");--> statement-breakpoint
CREATE INDEX "submissions_graduation_year_idx" ON "submissions" USING btree ("graduation_year");--> statement-breakpoint
CREATE INDEX "submissions_retention_idx" ON "submissions" USING btree ("retention_expiry_date");--> statement-breakpoint
CREATE INDEX "uploads_claimed_created_idx" ON "uploads" USING btree ("claimed_at","created_at");