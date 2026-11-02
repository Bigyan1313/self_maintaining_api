-- Append-only protection (FR-39), enforced by the database itself.
-- Hand-written: drizzle-kit cannot express triggers.
--
--   attempts, run_stage_results, call_sites, coverage_entries, spec_versions:
--       no UPDATE, no DELETE, no TRUNCATE.
--   runs:    no DELETE / TRUNCATE; no UPDATE once the OLD row is finished (finished_at IS NOT NULL).
--            Reanalysis = a new run with parent_run_id.
--   changes: no DELETE / TRUNCATE; UPDATE may only touch the human-confirmation columns
--            mapping_status, mapping_source, mapping, confirmed_by, confirmed_at.
--
-- Errors use SQLSTATE 'P0001' (raise_exception) and start with "append-only:".

CREATE FUNCTION sma_block_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on table "%" is not allowed (FR-39)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION sma_runs_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'append-only: run % is finished and cannot be updated (FR-39); start a reanalysis run with parent_run_id instead', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION sma_changes_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['mapping_status', 'mapping_source', 'mapping', 'confirmed_by', 'confirmed_at'];
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'append-only: change % may only update mapping confirmation columns (FR-39)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attempts_block_update_delete BEFORE UPDATE OR DELETE ON attempts
  FOR EACH ROW EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER attempts_block_truncate BEFORE TRUNCATE ON attempts
  FOR EACH STATEMENT EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER run_stage_results_block_update_delete BEFORE UPDATE OR DELETE ON run_stage_results
  FOR EACH ROW EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER run_stage_results_block_truncate BEFORE TRUNCATE ON run_stage_results
  FOR EACH STATEMENT EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER call_sites_block_update_delete BEFORE UPDATE OR DELETE ON call_sites
  FOR EACH ROW EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER call_sites_block_truncate BEFORE TRUNCATE ON call_sites
  FOR EACH STATEMENT EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER coverage_entries_block_update_delete BEFORE UPDATE OR DELETE ON coverage_entries
  FOR EACH ROW EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER coverage_entries_block_truncate BEFORE TRUNCATE ON coverage_entries
  FOR EACH STATEMENT EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER spec_versions_block_update_delete BEFORE UPDATE OR DELETE ON spec_versions
  FOR EACH ROW EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER spec_versions_block_truncate BEFORE TRUNCATE ON spec_versions
  FOR EACH STATEMENT EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER runs_block_delete BEFORE DELETE ON runs
  FOR EACH ROW EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER runs_block_truncate BEFORE TRUNCATE ON runs
  FOR EACH STATEMENT EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER runs_guard_update BEFORE UPDATE ON runs
  FOR EACH ROW EXECUTE FUNCTION sma_runs_guard_update();
--> statement-breakpoint
CREATE TRIGGER changes_block_delete BEFORE DELETE ON changes
  FOR EACH ROW EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER changes_block_truncate BEFORE TRUNCATE ON changes
  FOR EACH STATEMENT EXECUTE FUNCTION sma_block_modification();
--> statement-breakpoint
CREATE TRIGGER changes_guard_update BEFORE UPDATE ON changes
  FOR EACH ROW EXECUTE FUNCTION sma_changes_guard_update();
