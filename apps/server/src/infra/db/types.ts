import type {
  apis,
  attempts,
  callSites,
  changes,
  coverageEntries,
  evaluationResults,
  migrationNotes,
  repositories,
  runStageResults,
  runs,
  specChecks,
  specVersions,
} from './schema.js';

/** Stored repository row. */ export type Repository = typeof repositories.$inferSelect;
/** Values to insert a repository. */ export type NewRepository = typeof repositories.$inferInsert;
/** Stored API row. */ export type Api = typeof apis.$inferSelect;
/** Values to insert an API. */ export type NewApi = typeof apis.$inferInsert;
/** Stored spec version row. */ export type SpecVersion = typeof specVersions.$inferSelect;
/** Values to insert a spec version. */ export type NewSpecVersion =
  typeof specVersions.$inferInsert;
/** Stored spec check row. */ export type SpecCheck = typeof specChecks.$inferSelect;
/** Values to insert a spec check. */ export type NewSpecCheck = typeof specChecks.$inferInsert;
/** Stored migration note row. */ export type MigrationNote = typeof migrationNotes.$inferSelect;
/** Values to insert a migration note. */ export type NewMigrationNote =
  typeof migrationNotes.$inferInsert;
/** Stored change row. */ export type Change = typeof changes.$inferSelect;
/** Values to insert a change. */ export type NewChange = typeof changes.$inferInsert;
/** Stored run row. */ export type Run = typeof runs.$inferSelect;
/** Values to insert a run. */ export type NewRun = typeof runs.$inferInsert;
/** Stored stage result row. */ export type RunStageResult = typeof runStageResults.$inferSelect;
/** Values to insert a stage result. */ export type NewRunStageResult =
  typeof runStageResults.$inferInsert;
/** Stored call site row. */ export type CallSite = typeof callSites.$inferSelect;
/** Values to insert a call site. */ export type NewCallSite = typeof callSites.$inferInsert;
/** Stored coverage entry row. */ export type CoverageEntry = typeof coverageEntries.$inferSelect;
/** Values to insert a coverage entry. */ export type NewCoverageEntry =
  typeof coverageEntries.$inferInsert;
/** Stored attempt row. */ export type Attempt = typeof attempts.$inferSelect;
/** Values to insert an attempt. */ export type NewAttempt = typeof attempts.$inferInsert;
/** Stored evaluation result row. */ export type EvaluationResult =
  typeof evaluationResults.$inferSelect;
/** Values to insert an evaluation result. */ export type NewEvaluationResult =
  typeof evaluationResults.$inferInsert;
