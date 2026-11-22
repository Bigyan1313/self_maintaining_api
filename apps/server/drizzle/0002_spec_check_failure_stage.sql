-- Records WHICH stage a failed spec check failed in (UC-02 postcondition, NFR-02).
-- Checks that failed before this migration all failed in ingest (only ingest wrote checks).
ALTER TABLE "spec_checks" ADD COLUMN "failure_stage" "stage";--> statement-breakpoint
UPDATE "spec_checks" SET "failure_stage" = 'ingest' WHERE "outcome" = 'failed';--> statement-breakpoint
ALTER TABLE "spec_checks" ADD CONSTRAINT "spec_checks_failed_iff_failure_stage" CHECK (("spec_checks"."outcome" = 'failed') = ("spec_checks"."failure_stage" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "spec_checks" ADD CONSTRAINT "spec_checks_failure_stage_in_check" CHECK ("spec_checks"."failure_stage" IS NULL OR "spec_checks"."failure_stage" IN ('ingest', 'detect', 'classify'));