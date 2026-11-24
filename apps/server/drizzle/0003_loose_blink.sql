CREATE TABLE "evaluation_studies" (
	"label" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_results" DROP CONSTRAINT "evaluation_results_label_scenario_baseline_uq";--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD COLUMN "repeat" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_label_scenario_baseline_uq" UNIQUE("eval_label","scenario_id","baseline","repeat");--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_repeat_1_3" CHECK ("evaluation_results"."repeat" BETWEEN 1 AND 3);