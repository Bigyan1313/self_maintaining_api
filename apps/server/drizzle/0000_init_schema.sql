CREATE TYPE "public"."attempt_outcome" AS ENUM('pass', 'fail', 'cheating', 'error', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."baseline" AS ENUM('B1', 'B2', 'B3');--> statement-breakpoint
CREATE TYPE "public"."call_pattern" AS ENUM('fetch', 'axios_instance', 'axios_static', 'generated_client');--> statement-breakpoint
CREATE TYPE "public"."change_category" AS ENUM('field_renamed', 'field_type_changed', 'required_param_added', 'endpoint_removed', 'other');--> statement-breakpoint
CREATE TYPE "public"."classification" AS ENUM('breaking', 'safe', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."guard_name" AS ENUM('test_file_changed', 'test_count_changed', 'type_suppression', 'config_changed');--> statement-breakpoint
CREATE TYPE "public"."mapping_source" AS ENUM('migration_note', 'human');--> statement-breakpoint
CREATE TYPE "public"."mapping_status" AS ENUM('confirmed', 'unconfirmed');--> statement-breakpoint
CREATE TYPE "public"."review_verdict" AS ENUM('correct', 'incorrect', 'not_reviewed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'not_affected', 'needs_review', 'flagged', 'repaired', 'failed', 'aborted', 'cheating_rejected', 'stage_failure');--> statement-breakpoint
CREATE TYPE "public"."source_mode" AS ENUM('retrieved', 'uploaded', 'fixture');--> statement-breakpoint
CREATE TYPE "public"."spec_check_outcome" AS ENUM('baseline_established', 'no_change', 'changed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('ingest', 'detect', 'classify', 'locate', 'repair', 'validate', 'deliver');--> statement-breakpoint
CREATE TYPE "public"."stage_result_status" AS ENUM('ok', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "apis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"spec_source_url" text,
	"poll_interval_seconds" integer,
	"baseline_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apis_name_uq" UNIQUE("name"),
	CONSTRAINT "apis_poll_interval_min_60" CHECK ("apis"."poll_interval_seconds" IS NULL OR "apis"."poll_interval_seconds" >= 60)
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"patch" text NOT NULL,
	"validation_output" text,
	"compile_errors" integer,
	"tests_passed" integer,
	"tests_total" integer,
	"outcome" "attempt_outcome" NOT NULL,
	"guard_name" "guard_name",
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"model_id" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempts_run_attempt_uq" UNIQUE("run_id","attempt_number"),
	CONSTRAINT "attempts_number_1_4" CHECK ("attempts"."attempt_number" BETWEEN 1 AND 4),
	CONSTRAINT "attempts_cheating_iff_guard" CHECK (("attempts"."outcome" = 'cheating') = ("attempts"."guard_name" IS NOT NULL)),
	CONSTRAINT "attempts_tests_consistent" CHECK (("attempts"."tests_passed" IS NULL OR "attempts"."tests_passed" >= 0) AND ("attempts"."tests_total" IS NULL OR "attempts"."tests_total" >= 0) AND ("attempts"."tests_passed" IS NULL OR "attempts"."tests_total" IS NULL OR "attempts"."tests_passed" <= "attempts"."tests_total")),
	CONSTRAINT "attempts_usage_non_negative" CHECK ("attempts"."tokens_in" >= 0 AND "attempts"."tokens_out" >= 0 AND "attempts"."cost_usd" >= 0 AND "attempts"."duration_ms" >= 0 AND ("attempts"."compile_errors" IS NULL OR "attempts"."compile_errors" >= 0))
);
--> statement-breakpoint
CREATE TABLE "call_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"line" integer NOT NULL,
	"column" integer NOT NULL,
	"pattern" "call_pattern" NOT NULL,
	"excerpt" text NOT NULL,
	CONSTRAINT "call_sites_position_positive" CHECK ("call_sites"."line" >= 1 AND "call_sites"."column" >= 1)
);
--> statement-breakpoint
CREATE TABLE "changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_id" uuid NOT NULL,
	"from_version_id" uuid NOT NULL,
	"to_version_id" uuid NOT NULL,
	"category" "change_category" NOT NULL,
	"oasdiff_rule_id" text NOT NULL,
	"classification" "classification" NOT NULL,
	"confidence" double precision NOT NULL,
	"path" text NOT NULL,
	"method" text,
	"json_pointer" text NOT NULL,
	"evidence_before" jsonb,
	"evidence_after" jsonb,
	"mapping_status" "mapping_status" DEFAULT 'unconfirmed' NOT NULL,
	"mapping_source" "mapping_source",
	"mapping" jsonb,
	"migration_note_id" uuid,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "changes_confidence_0_1" CHECK ("changes"."confidence" >= 0 AND "changes"."confidence" <= 1),
	CONSTRAINT "changes_confirmed_iff_source" CHECK (("changes"."mapping_status" = 'confirmed') = ("changes"."mapping_source" IS NOT NULL)),
	CONSTRAINT "changes_human_source_has_confirmer" CHECK ("changes"."mapping_source" IS DISTINCT FROM 'human' OR ("changes"."confirmed_by" IS NOT NULL AND "changes"."confirmed_at" IS NOT NULL)),
	CONSTRAINT "changes_versions_differ" CHECK ("changes"."from_version_id" <> "changes"."to_version_id")
);
--> statement-breakpoint
CREATE TABLE "coverage_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"inspected" boolean NOT NULL,
	"skip_reason" text,
	CONSTRAINT "coverage_entries_skipped_has_reason" CHECK ("coverage_entries"."inspected" OR "coverage_entries"."skip_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "evaluation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_label" text NOT NULL,
	"scenario_id" text NOT NULL,
	"baseline" "baseline" NOT NULL,
	"outcome" "run_status" NOT NULL,
	"attempts_used" integer NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"duration_ms" integer NOT NULL,
	"model_ms" integer,
	"container_ms" integer,
	"review_verdict" "review_verdict" DEFAULT 'not_reviewed' NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"exclusion_reason" text,
	"is_partial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_results_label_scenario_baseline_uq" UNIQUE("eval_label","scenario_id","baseline"),
	CONSTRAINT "evaluation_results_excluded_has_reason" CHECK (NOT "evaluation_results"."excluded" OR "evaluation_results"."exclusion_reason" IS NOT NULL),
	CONSTRAINT "evaluation_results_attempts_0_4" CHECK ("evaluation_results"."attempts_used" BETWEEN 0 AND 4),
	CONSTRAINT "evaluation_results_non_negative" CHECK ("evaluation_results"."cost_usd" >= 0 AND "evaluation_results"."duration_ms" >= 0 AND ("evaluation_results"."model_ms" IS NULL OR "evaluation_results"."model_ms" >= 0) AND ("evaluation_results"."container_ms" IS NULL OR "evaluation_results"."container_ms" >= 0))
);
--> statement-breakpoint
CREATE TABLE "migration_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_id" uuid NOT NULL,
	"from_version_id" uuid NOT NULL,
	"to_version_id" uuid NOT NULL,
	"raw_yaml" text NOT NULL,
	"parsed" jsonb NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"default_branch" text NOT NULL,
	"credential_ref" text,
	"local_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_owner_name_uq" UNIQUE("owner","name"),
	CONSTRAINT "repositories_credential_ref_is_env_var_name" CHECK ("repositories"."credential_ref" IS NULL OR "repositories"."credential_ref" ~ '^[A-Z_][A-Z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "run_stage_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" "stage" NOT NULL,
	"status" "stage_result_status" NOT NULL,
	"result" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_stage_results_run_stage_uq" UNIQUE("run_id","stage"),
	CONSTRAINT "run_stage_results_finished_after_start" CHECK ("run_stage_results"."finished_at" >= "run_stage_results"."started_at")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"parent_run_id" uuid,
	"stage_reached" "stage" NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"failure_stage" "stage",
	"failure_detail" text,
	"flagged_reason" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"model_id" text,
	"is_fixture" boolean DEFAULT false NOT NULL,
	"pr_url" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "runs_attempt_count_0_4" CHECK ("runs"."attempt_count" BETWEEN 0 AND 4),
	CONSTRAINT "runs_stage_failure_has_stage" CHECK ("runs"."status" <> 'stage_failure' OR "runs"."failure_stage" IS NOT NULL),
	CONSTRAINT "runs_running_iff_unfinished" CHECK (("runs"."status" = 'running') = ("runs"."finished_at" IS NULL)),
	CONSTRAINT "runs_finished_after_start" CHECK ("runs"."finished_at" IS NULL OR "runs"."finished_at" >= "runs"."started_at"),
	CONSTRAINT "runs_commit_sha_format" CHECK ("runs"."commit_sha" ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
	CONSTRAINT "runs_usage_non_negative" CHECK ("runs"."tokens_in" >= 0 AND "runs"."tokens_out" >= 0 AND "runs"."cost_usd" >= 0),
	CONSTRAINT "runs_not_own_parent" CHECK ("runs"."parent_run_id" IS NULL OR "runs"."parent_run_id" <> "runs"."id")
);
--> statement-breakpoint
CREATE TABLE "spec_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" "spec_check_outcome" NOT NULL,
	"spec_version_id" uuid,
	"error_detail" text,
	CONSTRAINT "spec_checks_failed_has_error_detail" CHECK ("spec_checks"."outcome" <> 'failed' OR "spec_checks"."error_detail" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "spec_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_id" uuid NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_mode" "source_mode" NOT NULL,
	"source_identifier" text NOT NULL,
	"content_sha256" text NOT NULL,
	"normalized" jsonb NOT NULL,
	CONSTRAINT "spec_versions_api_hash_uq" UNIQUE("api_id","content_sha256"),
	CONSTRAINT "spec_versions_sha256_format" CHECK ("spec_versions"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "apis" ADD CONSTRAINT "apis_baseline_version_id_spec_versions_id_fk" FOREIGN KEY ("baseline_version_id") REFERENCES "public"."spec_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sites" ADD CONSTRAINT "call_sites_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_api_id_apis_id_fk" FOREIGN KEY ("api_id") REFERENCES "public"."apis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_from_version_id_spec_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."spec_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_to_version_id_spec_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."spec_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_migration_note_id_migration_notes_id_fk" FOREIGN KEY ("migration_note_id") REFERENCES "public"."migration_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_entries" ADD CONSTRAINT "coverage_entries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_notes" ADD CONSTRAINT "migration_notes_api_id_apis_id_fk" FOREIGN KEY ("api_id") REFERENCES "public"."apis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_notes" ADD CONSTRAINT "migration_notes_from_version_id_spec_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."spec_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_notes" ADD CONSTRAINT "migration_notes_to_version_id_spec_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."spec_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_stage_results" ADD CONSTRAINT "run_stage_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_parent_run_id_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_checks" ADD CONSTRAINT "spec_checks_api_id_apis_id_fk" FOREIGN KEY ("api_id") REFERENCES "public"."apis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_checks" ADD CONSTRAINT "spec_checks_spec_version_id_spec_versions_id_fk" FOREIGN KEY ("spec_version_id") REFERENCES "public"."spec_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_versions" ADD CONSTRAINT "spec_versions_api_id_apis_id_fk" FOREIGN KEY ("api_id") REFERENCES "public"."apis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apis_baseline_version_id_idx" ON "apis" USING btree ("baseline_version_id");--> statement-breakpoint
CREATE INDEX "call_sites_run_id_idx" ON "call_sites" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "changes_api_id_idx" ON "changes" USING btree ("api_id");--> statement-breakpoint
CREATE INDEX "changes_from_version_id_idx" ON "changes" USING btree ("from_version_id");--> statement-breakpoint
CREATE INDEX "changes_to_version_id_idx" ON "changes" USING btree ("to_version_id");--> statement-breakpoint
CREATE INDEX "changes_migration_note_id_idx" ON "changes" USING btree ("migration_note_id");--> statement-breakpoint
CREATE INDEX "coverage_entries_run_id_idx" ON "coverage_entries" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "migration_notes_api_id_idx" ON "migration_notes" USING btree ("api_id");--> statement-breakpoint
CREATE INDEX "migration_notes_from_version_id_idx" ON "migration_notes" USING btree ("from_version_id");--> statement-breakpoint
CREATE INDEX "migration_notes_to_version_id_idx" ON "migration_notes" USING btree ("to_version_id");--> statement-breakpoint
CREATE INDEX "runs_change_id_idx" ON "runs" USING btree ("change_id");--> statement-breakpoint
CREATE INDEX "runs_repository_id_idx" ON "runs" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "runs_parent_run_id_idx" ON "runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "spec_checks_api_id_idx" ON "spec_checks" USING btree ("api_id");--> statement-breakpoint
CREATE INDEX "spec_checks_spec_version_id_idx" ON "spec_checks" USING btree ("spec_version_id");--> statement-breakpoint
CREATE INDEX "spec_versions_api_id_idx" ON "spec_versions" USING btree ("api_id");