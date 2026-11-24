# Reproducing the course deliverables

Use the pinned Node version and `npm ci`. PostgreSQL, Docker and the pinned oasdiff binary are required for the full evidence run. Set `DATABASE_URL` using `.env.example`. The acceptance runner resets **sma_acceptance_test** and the regression suites reset **sma_test**; neither is your development database. GitHub CI provisions these services and publishes a `course-deliverables` artifact.

```sh
npm run typecheck
npm run lint
npm run test:coverage
npm run consumer:install
npm run docs
npm run diagrams
npm run acceptance
npm run report:final -- eval/results/<label>/report.md
npm run submission -- --draft
```

Diagram and terminal screenshot rendering requires Puppeteer's browser. To reuse an installed Chromium, set `PUPPETEER_EXECUTABLE_PATH` to its executable. CI reuses Playwright Chromium.

`test:coverage` writes actual per-file test counts and V8 percentages to `docs/unit-tests.md`, with JSON evidence in `coverage/`. It includes the evaluation workspace automatically once Increment 16 adds its test script. You can select groups for local checks, for example `npm run test:coverage -- packages/core scripts`; omitted groups are explicitly marked NOT RUN.

`acceptance` records all twelve checks. PARTIAL means at least one required portion was not executed; a successful regression suite does not turn a missing live/provider or reviewed-study check into PASS. The four later checks invoke real test suites with scripted adapters as documented in their records. Inspect the terminal transcripts alongside the browser screenshots in `docs/acceptance/screenshots/inc14/`.

`report:final` imports the selected generated evaluation report verbatim and records its SHA-256. With no argument it writes an explicit pending-evaluation report. A scripted fake-adapter study must remain labelled as such; the report importer does not certify semantic reviews or model effectiveness.

The draft ZIP uses the current committed branch source, is named `Group13_SelfMaintainingAPIs_DRAFT.zip`, and lists gaps in `MANIFEST.json`. Uncommitted source edits are not included by `git archive`. Both modes reject symlinks and credential-shaped content, including in tests and chat logs. Synthetic security-test inputs are assembled at runtime to preserve the tests without embedding token-shaped literals in the archive.

For the final ZIP, first merge the reviewed work through GitHub, fetch the latest `origin/main`, check out that commit and rerun the evidence commands there. The final command is `npm run submission`; it archives **origin/main**, requires the source tree to be clean, and permits newly generated evidence files. It refuses incomplete acceptance records, missing generated evaluation evidence, or missing presentation artifacts. Do not use the draft ZIP as the final submission.

Human completion steps:

- Complete and review the evaluation study, including named semantic reviews and failure analysis.
- Review acceptance evidence and finish the portions explicitly marked PARTIAL.
- Save GitHub → Insights → Network as `docs/presentation/git-network.png`.
- Build `docs/presentation/presentation.pptx` from the [outline](presentation-outline.md).
- Inspect the final ZIP and upload it to Canvas.
