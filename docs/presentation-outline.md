# Presentation outline

1. Purpose: detect breaking API changes and deliver reviewable consumer repairs.
2. Problem: OpenAPI differences do not automatically imply a safe code mapping. Explain confirmed mappings.
3. Pipeline: ingest → detect → classify → locate → repair → validate → deliver. Use the architecture description.
4. Class diagram: use `diagrams/png/class-diagram.png`; contrast the AST-derived diagram with function-based services.
5. Statecharts: show the run, spec check and attempt diagrams. Explain immutable terminal runs and new-run retries.
6. Demo: configuration → specification upload → changes → confirmed mapping → run detail → export. Use the actual screenshots in `acceptance/screenshots/inc14/`; identify fixture demonstrations as such.
7. Acceptance: use the generated `acceptance/README.md` table. Show failures and partial checks as well as passes; inspect the linked transcripts.
8. Evaluation: include the generated tables from the selected `eval/results/<label>/report.md`. State the model, sample, baselines and named review procedure. Do not present scripted adapter runs as model effectiveness evidence.
9. Failures: display failing scenarios, guard rejections, excluded cases and false confidence. Explain measurement limitations.
10. Collaboration: **human task** — GitHub → Insights → Network. Save a real screenshot as `docs/presentation/git-network.png` and show branch/merge history.
11. Lessons: guardrails, reproducibility, immutable evidence and why a human reviews every delivered patch.

The team builds `docs/presentation/presentation.pptx` from this outline. Review all acceptance records, run the final archive command after the work is merged to main, and upload the resulting ZIP to Canvas. The archive tool refuses to label an incomplete bundle as final.
