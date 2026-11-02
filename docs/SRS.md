<!-- Converted from docs/SRS.docx (Group 13 SRS v1.0). The .docx is the original; this Markdown copy exists so prompts and Claude Code can read and cite requirement IDs. -->

# Self-Maintaining APIs

Software Requirements Specification

CS 4398 | Software Engineering Project | Fall 2026

**Group 13**

Sishir Chalise

Bibek Paudel

Bigyan Dhakal

Version 1.0 | September 24, 2026

## Contents

- [1  Introduction](#1--introduction)
  - [1.1  Purpose and intended audience](#11--purpose-and-intended-audience)
  - [1.2  Problem statement](#12--problem-statement)
  - [1.3  Product scope](#13--product-scope)
  - [1.4  Definitions and conventions](#14--definitions-and-conventions)
- [2  Overall description](#2--overall-description)
  - [2.1  System boundary and dependencies](#21--system-boundary-and-dependencies)
  - [2.2  Operating environment](#22--operating-environment)
  - [2.3  User characteristics](#23--user-characteristics)
  - [2.4  Pipeline overview](#24--pipeline-overview)
- [3  Functional requirements](#3--functional-requirements)
  - [3.1  Specification ingestion and change detection](#31--specification-ingestion-and-change-detection)
  - [3.2  Call-site location](#32--call-site-location)
  - [3.3  Repair](#33--repair)
  - [3.4  Validation and cheat detection](#34--validation-and-cheat-detection)
  - [3.5  Delivery and human review](#35--delivery-and-human-review)
  - [3.6  Run records, dashboard, and reporting](#36--run-records-dashboard-and-reporting)
  - [3.7  Use cases](#37--use-cases)
  - [3.8  External interfaces](#38--external-interfaces)
  - [3.9  Data requirements and business rules](#39--data-requirements-and-business-rules)
- [4  Nonfunctional requirements](#4--nonfunctional-requirements)
- [5  Design and implementation constraints](#5--design-and-implementation-constraints)
  - [5.1  Constraints](#51--constraints)
  - [5.2  Supported inputs and operating limits](#52--supported-inputs-and-operating-limits)
  - [5.3  Environmental assumptions](#53--environmental-assumptions)
- [6  Evaluation study](#6--evaluation-study)
  - [6.1  Purpose](#61--purpose)
  - [6.2  Scenario set](#62--scenario-set)
  - [6.3  Baselines](#63--baselines)
  - [6.4  Metrics](#64--metrics)
  - [6.5  Evaluation requirements](#65--evaluation-requirements)
  - [6.6  Reporting and honesty rules](#66--reporting-and-honesty-rules)
- [7  Release deliverables and milestones](#7--release-deliverables-and-milestones)
  - [7.1  Deliverables](#71--deliverables)
  - [7.2  Milestones](#72--milestones)
  - [7.3  Risks and cut order](#73--risks-and-cut-order)
  - [7.4  Deferred extensions](#74--deferred-extensions)
- [8  References](#8--references)
- [Appendix A  Acceptance criteria](#appendix-a--acceptance-criteria)
- [Appendix B  Requirements traceability](#appendix-b--requirements-traceability)

**Reading guide.** Sections 1 and 2 define the product and its boundary. Section 3 specifies behavior, interactions, and data. Sections 4 and 5 establish quality requirements and implementation limits. **Section 6 specifies the measured study the release must produce, and carries the same force as Section 3.** Appendix A defines the acceptance checks; Appendix B maps objectives to requirements.

## 1  Introduction

### 1.1  Purpose and intended audience

This Software Requirements Specification defines the functional behavior, interfaces, data, quality attributes, constraints, evaluation obligations, and acceptance criteria for Self-Maintaining APIs. It is the requirements baseline for implementation, testing, and final evaluation.

Intended readers are the project developers, testers, and course evaluators, together with developers who would use the system to maintain their own API integrations.

### 1.2  Problem statement

Applications depend on external APIs whose endpoints, parameters, and response fields change over time. When a provider makes a breaking change, the work of noticing it, finding the affected code, editing that code, and proving the edit is correct falls on a developer. That work is repetitive, easy to get wrong, and usually discovered late — after an integration has already failed.

Existing tools each solve one piece. Dependabot and Renovate raise the version number but do not change the code. OpenRewrite, ast-grep, and similar tools apply reliable rewrites, but only after a person has written the rewrite rule. Review tools that run specification diffs report changes in the API an organization publishes, not in the APIs it consumes.

This project addresses two gaps. The first is integration: the tools above each cover one stage, and the end-to-end path from a provider’s specification history to a validated change in a consumer’s codebase is not joined up.

The second is measurement. **How often an automated agent repairs a breaking API change correctly, and under what conditions, is the question this project sets out to answer.** A survey of prior published results is part of the work: any existing measurement that is found will be cited, and the results of Section 6 will be reported against it. Where no comparable prior measurement exists, that will be stated as a limitation of the comparison rather than as a claim of novelty.

### 1.3  Product scope

The system records a baseline OpenAPI specification for a configured API, compares later versions against that baseline, classifies which differences will break calling code, locates the affected call sites in a TypeScript repository, and — where a migration note confirms the mapping — asks a language model to produce a patch. The patch is applied to an isolated working copy and validated by compiling the project and running its test suite inside a container. A patch that passes becomes a pull request for a human to review. A patch that fails, is refused, or is caught cheating is recorded as a flagged finding with its reason.

#### In scope for this release

- TypeScript repositories, using the three call patterns documented in Section 5.2.
- One demonstration REST API under the team’s control, published at two specification versions.
- Four change categories: endpoint removed, field renamed, field type changed, and required parameter added.
- Repair only where a migration note or a human confirms the mapping. Everything else is reported, not patched.
- Sandboxed validation by type check and test execution, with cheat detection.
- Pull-request delivery for review. The system never merges.
- A measured evaluation over a frozen scenario set, reported in full including its failures (Section 6).

#### Out of scope for this release

- Languages other than TypeScript; GraphQL and gRPC interfaces.
- Inferring a field mapping that no migration note or human has confirmed.
- Merging, auto-merging, pushing to a default branch, or deploying.
- Response-shape migrations (single object to paged collection), which are deferred to Section 7.4.
- Comparing multiple models, a GitHub App installation flow, and multi-tenant hosting, all deferred to Section 7.4.
- Guarantees of production availability or of correctness beyond the scenarios measured in Section 6.

### 1.4  Definitions and conventions

“Shall” denotes a mandatory requirement. All numbered requirements are required for the final release unless explicitly marked optional. FR identifies functional requirements, UI interface requirements, DR data requirements, NFR nonfunctional requirements, EV evaluation requirements, BR business rules, C constraints, UC use cases, AT acceptance checks, and OBJ product objectives.

| **Term** | **Meaning** |
|---|---|
| Specification / spec | An OpenAPI 3.0 or 3.1 document describing the provider’s API. |
| Baseline | The stored specification version that later versions are compared against. |
| Change | One structured difference between two specification versions, with its location in the document. |
| Classification | The verdict on a change: breaking, safe, or unknown. |
| Confirmed mapping | An old-to-new correspondence stated by a migration note or by an explicit human decision. Never inferred. |
| Call site | A location in the repository that calls the changed part of the API, identified by file, line, and call pattern. |
| Run | One attempt to carry one change through the pipeline for one repository. |
| Attempt | One cycle of patch generation and validation inside a run. A run allows at most four. |
| Patch | A unified diff produced by the model and applied only to an isolated working copy. |
| Validation | Type checking and test execution inside a container, producing pass, fail, or cheating. |
| Cheating | A patch that makes tests pass by weakening the tests, the types, or the configuration rather than fixing the code. |
| Scenario | A frozen evaluation case: a repository at a fixed commit, two specifications, an optional migration note, and tests that pass before the change and fail after it. |

## 2  Overall description

The primary user is a developer who maintains a TypeScript application that calls an external REST API. The developer registers a repository and an API, reviews what the system finds, and decides whether to merge the pull requests it opens. The system is operated by one user at a time; account registration, role administration, and multi-tenant access are not required.

### 2.1  System boundary and dependencies

The system reads a specification source, a migration note when one is supplied, and a checked-out copy of the target repository. It writes its own database, its own working copies, exported reports, and — through the GitHub REST API — branches and pull requests on the target repository. It never writes to the developer’s working copy and never merges anything.

Three external dependencies exist: the specification source, one configured language-model service reached through a single adapter module, and the GitHub REST API. Each may be unavailable, and Section 4 requires each failure to be reported as its own stage rather than as a generic error.

### 2.2  Operating environment

The application runs on a developer workstation or a continuous-integration runner, and is used through a browser on the same machine. A container runtime is required: validation executes generated code, and generated code is never run on the host. Network access is required for specification retrieval, model calls, and pull-request delivery, but is explicitly denied to the validation container.

The release includes a demonstration API served locally at two versions and a sample repository that consumes it, so every supported change category can be demonstrated without waiting for a real provider to publish a breaking change.

### 2.3  User characteristics

The intended operator is a developer or student developer who reads TypeScript, understands HTTP and REST conventions, can check out a repository, and can review a pull request. No administrator role, account system, or non-technical workflow is required for this release.

### 2.4  Pipeline overview

Work moves through seven stages. Every stage writes its result to the database before the next begins, so a run can be replayed and a failure can be attributed to the stage that caused it.

| **#** | **Stage** | **Input** | **Recorded result** |
|---|---|---|---|
| 1 | Ingest | Specification URL or uploaded file | Stored specification version and content hash |
| 2 | Detect | Two specification versions | Structured list of differences |
| 3 | Classify | One difference | Breaking, safe, or unknown, with confidence and mapping status |
| 4 | Locate | Change and repository | Call sites with file, line, and pattern; coverage report |
| 5 | Repair | Change, sites, migration note, prior errors | Patch, tokens, cost, model, attempt number |
| 6 | Validate | Patch and isolated working copy | Pass, fail, or cheating with the guard that fired |
| 7 | Deliver | Validated patch | Pull request URL, or a flagged finding and its reason |

**The rule the pipeline does not break.** A difference between two specifications is not proof that two fields mean the same thing. If customer_name disappears and full_name appears, that correspondence is a guess until a migration note or a human confirms it, and acting on a guess is how an automated tool corrupts data. Stage 5 is entered only for a change with a confirmed mapping; everything else stops at stage 4 and is reported for a human (BR-04, C-04).

## 3  Functional requirements

Requirements are grouped by pipeline stage. Each is verifiable by at least one acceptance check in Appendix A.

### 3.1  Specification ingestion and change detection

Detection answers one question: what is different between two versions of this API, and which differences will break code? A difference that cannot be attributed to a specific API item is reported as unknown rather than guessed at.

| **ID** | **Requirement** | **Verification** |
|---|---|---|
| FR-01 | The system shall allow the developer to register a repository (owner and name, default branch, and a reference to the credential, never the credential itself) and an API (name, specification URL or uploaded file). | AT-01 |
| FR-02 | The system shall validate configuration and repository reachability before starting a run, identifying each invalid field without starting analysis. | AT-01 |
| FR-03 | The system shall accept an OpenAPI 3.0 or 3.1 document as JSON or YAML, normalize it to JSON, and record the source identifier, retrieval time, and a SHA-256 content hash. | AT-02 |
| FR-04 | When no baseline exists for an API, the system shall retain the first successful specification as the baseline and report “Baseline established” without reporting any change. | AT-02 |
| FR-05 | The system shall store each distinct specification version. A retrieval whose content hash matches an existing version for that API shall not create a second version. | AT-02 |
| FR-06 | For each specification pair, the system shall produce a structured list of differences using a specification-aware difference tool, and shall record each difference with its path, HTTP method where applicable, and JSON pointer into the operation. | AT-02, AT-03 |
| FR-07 | The system shall classify each difference as breaking, safe, or unknown, using documented rules, and shall record a confidence value between 0 and 1 with each classification. | AT-03, AT-04 |
| FR-08 | The system shall retain the before and after evidence for every difference, so a classification can be checked against the specification text that produced it. | AT-03, AT-08 |
| FR-09 | The system shall accept a migration note associated with a specification pair and extract the old-to-new mappings it states. | AT-03, AT-06 |
| FR-10 | The system shall mark a change’s mapping as confirmed only when a migration note states it or a human explicitly confirms it. In all other cases the mapping shall remain unconfirmed, and the change shall be reported rather than repaired. | AT-04, AT-05 |
| FR-11 | The system shall report a retrieval or parse failure as a failed check, distinguish it from “no change,” leave the baseline unchanged, and allow a later retry. | AT-07 |
| FR-12 | The system shall support manual specification upload. Scheduled polling at a configured interval of at least 60 seconds is optional for this release; when enabled, checks shall run one at a time. | AT-02 |

### 3.2  Call-site location

Location answers the second question: does this repository actually use the part of the API that changed? The analysis reads the TypeScript syntax tree rather than matching text, because a textual search cannot distinguish a call from a comment, a string, or an unrelated identifier of the same name.

| **ID** | **Requirement** | **Verification** |
|---|---|---|
| FR-13 | The system shall locate call sites in TypeScript source using a TypeScript syntax-tree analysis, for the call patterns documented in Section 5.2. | AT-05 |
| FR-14 | For each located site, the system shall record the file path, line and column, the call pattern matched, and the surrounding code excerpt. | AT-05 |
| FR-15 | The system shall report which files were inspected and which were skipped, with a reason for each skip, so the developer can see the limits of the analysis. | AT-05, AT-09 |
| FR-16 | When no call site is found and coverage was complete, the system shall report “Not affected within supported scope” and shall not open a pull request. | AT-05 |
| FR-17 | The system shall report “Needs review” for dynamic call construction, unsupported patterns, or incomplete coverage, and shall not infer compatibility from code it did not inspect. | AT-05, AT-09 |

### 3.3  Repair

Repair is entered only for a breaking change that has both a confirmed mapping and at least one located call site. What goes into the model’s context matters more than how the request is worded: the release sends the changed section of the specification, the migration note, the files containing call sites, and the errors from the previous attempt — never the whole repository.

| **ID** | **Requirement** | **Verification** |
|---|---|---|
| FR-18 | The system shall attempt repair only for a change classified breaking, with a confirmed mapping, and with at least one located call site. Any other combination shall be recorded as a flagged finding. | AT-04, AT-06 |
| FR-19 | The system shall assemble model context from the changed specification section, the migration note, the files containing located call sites, and the validator errors from previous attempts within the same run. It shall not send unrelated repository contents. | AT-06, AT-10 |
| FR-20 | The system shall apply each generated patch to an isolated working copy and shall never modify the developer’s checked-out repository. | AT-06, AT-11 |
| FR-21 | The system shall retry a failed repair, feeding the validator output from the previous attempt into the next context, for at most four attempts in total. | AT-06 |
| FR-22 | When four attempts have been used without a passing validation, the system shall stop, record the outcome as failed, and flag the change for a human. | AT-06 |
| FR-23 | The system shall record, for each attempt, the patch, input and output token counts, monetary cost, model identifier, and duration. | AT-08, AT-12 |
| FR-24 | The system shall enforce a configured token ceiling per run; a run that would exceed it shall be aborted and recorded as aborted, not failed. | AT-07 |

### 3.4  Validation and cheat detection

**This section is the one the rest of the release depends on.** A patch that has not been compiled and tested is a suggestion, and a suggestion cannot be measured. Validation converts the model’s output into evidence by running the project’s own type checker and test suite against it, inside a container with no network access and no host credentials.

Models are known to make failing tests pass dishonestly — by deleting the test, loosening a type, or editing the configuration. The guards below exist because a patch that cheats would otherwise be counted as a success and would quietly corrupt the evaluation in Section 6.

| **ID** | **Requirement** | **Verification** |
|---|---|---|
| FR-25 | The system shall run the project’s type check and test suite against the patched working copy inside a container that has no network access and no host credentials mounted. | AT-06, AT-11 |
| FR-26 | The system shall parse the validation output into a structured result: compile errors, tests passed, tests total, and duration, and shall retain the raw output alongside it. | AT-06, AT-08 |
| FR-27 | The system shall reject a patch that adds, modifies, deletes, or skips any test file. | AT-07 |
| FR-28 | The system shall reject a patch after which the number of passing tests has decreased, or the total number of tests has changed, relative to the pre-patch baseline. | AT-07 |
| FR-29 | The system shall reject a patch that introduces a type-suppression comment, an unchecked any type, or an empty catch block within the lines it changed. | AT-07 |
| FR-30 | The system shall reject a patch that modifies compiler or test-runner configuration instead of source code. | AT-07 |
| FR-31 | The system shall record which guard rejected a patch. A rejection for cheating shall end the run immediately without further attempts. | AT-07, AT-08 |
| FR-32 | The system shall never execute generated code outside the validation container, and shall never execute it on the host. | AT-11 |

### 3.5  Delivery and human review

The system stops at the pull request. A human reads the diff, the evidence, and the test output, and decides. Nothing else in this release is permitted to change the target repository.

| **ID** | **Requirement** | **Verification** |
|---|---|---|
| FR-33 | For a patch that passes validation, the system shall push a branch and open a pull request containing the change summary, the specification evidence, the migration note citation, the affected files, and the test output. | AT-08 |
| FR-34 | The system shall never merge a pull request, never enable automatic merging, and never push to the repository’s default branch. | AT-08, AT-11 |
| FR-35 | The system shall label every pull request it opens as machine-generated and awaiting human review. | AT-08 |
| FR-36 | When repair is refused, fails, or is rejected for cheating, the system shall open no pull request and shall record a flagged finding stating the reason. | AT-04, AT-07 |
| FR-37 | A pull-request delivery failure shall be reported as its own stage failure without discarding the validated patch, and delivery shall be retryable. | AT-07 |

### 3.6  Run records, dashboard, and reporting

| **ID** | **Requirement** | **Verification** |
|---|---|---|
| FR-38 | Every pipeline stage shall write its result before the next stage begins, so that a run can be replayed and a failure attributed to the stage that caused it. | AT-08 |
| FR-39 | Run records shall be append-only. A reanalysis shall create a new run and shall not overwrite the evidence of an earlier one. | AT-08 |
| FR-40 | The dashboard shall provide views for repositories and APIs, detected changes, runs, run detail, and evaluation results. | AT-01, AT-08, AT-12 |
| FR-41 | The system shall export a run as JSON and as a readable HTML report containing evidence, patches, validation output, outcomes, and any pull-request reference. | AT-08 |
| FR-42 | The dashboard shall distinguish every outcome state by a text label, not by color alone. | AT-08 |

### 3.7  Use cases

#### UC-01  Register a repository and an API

| **Field** | **Description** |
|---|---|
| Actor and priority | Developer (primary). Required. |
| Trigger and preconditions | The developer opens Configuration. The application is running and its storage is writable. |
| Normal flow | 1. Enter repository owner and name, default branch, and credential reference. 2. Enter the API name and specification source. 3. Attach a migration note if one exists. 4. Validate reachability and limits. 5. Save. |
| Alternatives | Missing fields, an unreachable repository, an unparseable specification, or a repository exceeding the size limits: report the specific error and do not start a run. |
| Postconditions | A valid configuration is stored, or the view shows field-level errors and no run has started. |
| Requirements | FR-01, FR-02, FR-03; UI-01; AT-01. |

#### UC-02  Detect and classify changes

| **Field** | **Description** |
|---|---|
| Actor and priority | Developer (primary); specification source (supporting external system). Required. |
| Trigger and preconditions | A new specification is uploaded or retrieved, and a valid configuration exists. |
| Normal flow | 1. Retrieve and normalize the specification. 2. Hash and store it as a version. 3. Difference it against the baseline. 4. Classify each difference and record confidence. 5. Resolve mapping status from the migration note. 6. Advance the baseline. |
| Alternatives | First specification establishes the baseline and reports no change. An identical hash produces no new version. A retrieval or parse failure leaves the baseline unchanged and is reported as a failed check. |
| Postconditions | A classified change list exists, or the failure and its stage are recorded. A difference is never by itself labeled a breaking change. |
| Requirements | FR-03 to FR-12; AT-02, AT-03, AT-04, AT-07. |

#### UC-03  Locate affected code

| **Field** | **Description** |
|---|---|
| Actor and priority | Developer (primary); target repository (supporting data source). Required. |
| Trigger and preconditions | A classified change exists and the repository is readable. |
| Normal flow | 1. Record the repository commit under analysis. 2. Parse supported files into a syntax tree. 3. Match call sites against the changed API item. 4. Record file, line, pattern, and excerpt. 5. Report inspected and skipped files. |
| Alternatives | No sites with complete coverage: not affected within supported scope. Dynamic or unsupported construction: needs review. Unreadable repository: failed analysis. |
| Postconditions | Evidence-backed findings are stored with their coverage report. Code is read, never executed. |
| Requirements | FR-13 to FR-17; AT-05, AT-09. |

#### UC-04  Repair, validate, and deliver

| **Field** | **Description** |
|---|---|
| Actor and priority | Developer (primary); model service and GitHub API (supporting external services). Required. |
| Trigger and preconditions | A breaking change with a confirmed mapping and at least one located call site. |
| Normal flow | 1. Assemble context. 2. Generate a patch. 3. Apply it to an isolated working copy. 4. Type check and test inside the container. 5. Apply the cheat guards. 6. On pass, push a branch and open a pull request. 7. Record cost, tokens, and attempt count. |
| Alternatives | Validation fails: feed the errors back and retry, to a maximum of four attempts, then flag. A guard fires: end the run immediately and record which guard. Model or container unavailable: record the stage failure and retain the finding. Delivery failure: retain the validated patch and allow retry. |
| Postconditions | A pull request awaiting review exists, or a flagged finding states why none was opened. The developer’s working copy is unchanged. |
| Requirements | FR-18 to FR-37; UI-03; BR-03; C-02, C-03; AT-06, AT-07, AT-08, AT-11. |

#### UC-05  Run the evaluation

| **Field** | **Description** |
|---|---|
| Actor and priority | Developer (primary). Required. |
| Trigger and preconditions | The frozen scenario set is present and the validator is operational. |
| Normal flow | 1. Verify each scenario still fails before repair. 2. Execute each baseline over every scenario. 3. Collect outcomes, attempts, guard rejections, cost, and duration. 4. Write a machine-readable results file. 5. Render the results tables. |
| Alternatives | A scenario whose tests do not fail before repair is excluded and reported as excluded, with its reason. A model or container outage suspends the run and is recorded; partial results are never presented as complete. |
| Postconditions | A reproducible results file and report tables exist, including the cases where the system did not work. |
| Requirements | EV-01 to EV-09; AT-12. |

### 3.8  External interfaces

| **ID** | **Interface requirement** | **Check** |
|---|---|---|
| UI-01 | The dashboard shall provide Configuration, Changes, Runs, Run Detail, and Results views, with actions to upload a specification, check for changes, start a run, and export a report. | AT-01, AT-08 |
| UI-02 | The interface shall distinguish baseline established, no change, breaking, safe, unknown, not affected, needs review, repaired, failed, cheating rejected, and stage failure using text labels. | AT-02 to AT-08 |
| UI-03 | Run Detail shall show the specification evidence, the migration note citation, the affected call sites, the patch, the validation output, the attempt count, and the pull-request link or the reason none exists. | AT-06, AT-08 |
| UI-04 | The Results view shall present the evaluation tables of Section 6.4, including the per-change-type breakdown and the cases that failed. | AT-12 |

#### External connections

- Specification source: retrieve an OpenAPI document over HTTPS, or accept an uploaded file. Page scripts are never executed.
- Repository: read supported TypeScript files within the checked-out copy; write only to an isolated working copy.
- Model service: send only the assembled context of FR-19 through a single adapter module, and receive a patch or an explicit failure.
- Container runtime: execute type check and tests with no network access and no host credentials.
- GitHub REST API: create a branch and a pull request using a credential supplied by local environment configuration.

### 3.9  Data requirements and business rules

| **Record** | **Minimum information and relationships** |
|---|---|
| Repository | Owner and name, default branch, credential reference, and the commit identifier analyzed by each run. Credentials themselves are never stored in this record or in any export. |
| API | Name, specification source, optional schedule, and the current baseline version. |
| Specification version | API reference, retrieval time, normalized document, SHA-256 content hash, and source mode (retrieved, uploaded, or fixture). A change links the before and after versions. |
| Change | The two specification versions, category, classification, confidence, path, method, JSON pointer, evidence, and mapping-confirmation source, which is null when unconfirmed. |
| Run | Change reference, repository reference, stage reached, status, attempt count, tokens, cost, model identifier, timestamps, failure detail, and an optional parent run for reanalysis. |
| Attempt | Run reference, attempt number, patch, validation output, tests passed and total, outcome, and the cheat guard that fired when one did. |
| Evaluation result | Scenario identifier, baseline identifier, outcome, attempts used, cost, duration, and the human review verdict required by EV-07. |

| **ID** | **Data requirement** | **Check** |
|---|---|---|
| DR-01 | The system shall persist configuration, specification versions, changes, runs, attempts, and evaluation results so they remain available after a restart. | AT-08 |
| DR-02 | The system shall link each change to its specification evidence, each run to its change and repository commit, and each attempt to its run. | AT-08 |
| DR-03 | The system shall record the four-attempt limit as a storage constraint, so a fifth attempt cannot be recorded even in error. | AT-06, AT-08 |
| DR-04 | The system shall require a cheating outcome to name the guard that produced it, and shall forbid a guard name on any other outcome. | AT-07, AT-08 |
| DR-05 | If a report or results file cannot be written, the system shall report the failure and shall not mark the report as saved. | AT-07 |

#### Business rules

- BR-01: A difference between two specifications describes the specification only. It does not by itself establish that any code is broken.
- BR-02: “Not affected within supported scope” applies only to the inspected supported code. Incomplete coverage or ambiguous usage requires “Needs review.”
- BR-03: A patch that passes validation is evidence, not proof. It remains subject to human review, and the system never merges it.
- BR-04: A field mapping is confirmed by a migration note or a human, never by resemblance between names. An unconfirmed mapping is reported, never repaired.
- BR-05: A deprecation or removal with no documented replacement is reported as affected with no proposed migration. The system does not invent one.
- BR-06: A fixture or demonstration run shall be labeled as such and shall never be presented as a live provider event.

## 4  Nonfunctional requirements

These targets are assessed on the recorded demonstration workstation: at least four CPU cores, 16 GB of memory, a working container runtime, and one run at a time.

| **ID and quality** | **Requirement** | **Check** |
|---|---|---|
| NFR-01 Reliability | The system shall complete three consecutive executions of each valid fixed scenario without an unhandled failure, retaining the required evidence each time. Model wording need not be identical between executions. | AT-12 |
| NFR-02 Robustness | The system shall handle an unavailable specification source, an unreadable repository, a model failure, a container failure, and a delivery failure by naming the failed stage, without reporting success and without corrupting the stored baseline. | AT-07 |
| NFR-03 Isolation | Validation shall run in a container with no network access, no host credentials mounted, a non-root user, memory and CPU ceilings, and a wall-clock limit. Generated code shall never execute on the host. | AT-11 |
| NFR-04 Security of data | The system shall omit credentials from logs, reports, exports, and pull-request bodies; exclude credential and configuration files from analysis and from model context; and treat retrieved specifications, migration notes, and repository code as untrusted data rather than as instructions. | AT-10, AT-11 |
| NFR-05 Performance | Detection, classification, and call-site location shall complete within 60 seconds for a repository of at most 200 TypeScript files and 20,000 selected source lines. Model time and container time shall be measured and reported separately. | AT-12 |
| NFR-06 Bounded waits | A model request shall time out at 120 seconds and a container validation at 10 minutes, each reported as a timeout without an automatic retry inside the same attempt. | AT-07 |
| NFR-07 Cost control | A run shall use at most four attempts and shall not exceed its configured token ceiling. Cost and token counts shall be recorded per attempt and reported per repair. | AT-06, AT-12 |
| NFR-08 Maintainability | All model access shall pass through a single adapter module, so the provider can be replaced without changing any other component. Detection, classification, and location shall be testable without network access, a container, or a model. | AT-10 |
| NFR-09 Reproducibility | The project shall pin dependency versions and the validation container image by digest, and shall document the commands needed for another team member to reproduce the evaluation of Section 6 on the declared environment. | AT-12 |

## 5  Design and implementation constraints

### 5.1  Constraints

- C-01: The release shall analyze TypeScript repositories only, using the call patterns and change categories defined in Section 5.2.
- C-02: The system shall never merge a pull request, enable automatic merging, push to a default branch, deploy, or modify the developer’s working copy.
- C-03: Generated code shall execute only inside the validation container, never on the host.
- C-04: The system shall repair only a change whose mapping is confirmed by a migration note or a human. It shall not infer an undocumented mapping, and it shall not claim to understand arbitrary API documentation.
- C-05: The implementation shall separate domain logic, HTTP handling, and presentation. Detection, classification, and location shall each be testable without the browser, the container, or a live model.
- C-06: All model calls shall pass through one adapter module with a pinned provider version, so that replacing the provider touches exactly one file.
- C-07: Runtime, dependency, and container-image versions shall be pinned in the release installation files.

The implementation baseline is TypeScript [2] on Node, specification-aware differencing of OpenAPI documents [1], [4], a TypeScript syntax-tree library for call-site location [3], a relational database for run records [8], a container runtime for sandboxed validation [5] running the project’s type check and test suite [6], and the GitHub REST API for delivery [7]. Exact versions are pinned per C-07.

### 5.2  Supported inputs and operating limits

| **Area** | **Release limit** |
|---|---|
| Specification | One OpenAPI 3.0 or 3.1 document per API, JSON or YAML, at most 5 MiB. A document that fails schema validation is rejected with the parser error. |
| Change categories | Endpoint removed; field renamed; field type changed; required parameter added. A repair is offered only when the old-to-new mapping is documented. Response-shape and authentication migrations are outside this release. |
| Call patterns | Direct fetch calls with a literal or template-literal URL; axios calls through a static import or a configured instance; generated-client function calls. Dynamically constructed URLs, wrappers, and re-exported aliases are unsupported and shall be reported as coverage limits. |
| Repository limits | At most 200 selected TypeScript files and 20,000 selected source lines. Symbolic links are not followed. Dependency directories, version-control metadata, build output, and credential or environment files are excluded. Oversized input is refused with a clear limit message. |
| Validation container | A pinned image digest, no network, non-root, memory and CPU ceilings, and a 10-minute wall-clock limit. The repository’s own type-check and test commands are used unchanged. |
| Repair loop | At most four attempts per run, with a configured token ceiling per run. Validator output from the previous attempt is included in the next context. |
| Delivery | One branch and one pull request per validated change, using a personal access token supplied by local environment configuration. No merge, no automatic merge, no default-branch push. |

### 5.3  Environmental assumptions

The operator has read access to the target repository, write access to application storage, a working container runtime, and a credential permitting branch and pull-request creation. The specification source supplies a parseable OpenAPI document. External services may be unavailable or rate limited; the system reports those conditions and preserves the last valid baseline. A fixture run is always labeled as a fixture and is never represented as a live provider event.

## 6  Evaluation study

### 6.1  Purpose

A working pipeline is not by itself a result. The question this project exists to answer is: **how often does an automated agent repair a breaking API change correctly, and where does it fail?** The evaluation is therefore a required deliverable of the release, not an optional extra, and this section specifies it with the same force as Section 3.

The release shall report what the system achieved and what it did not. A result showing that the method fails on a particular change category is a finding. A release that quietly omits its failures does not satisfy these requirements.

### 6.2  Scenario set

A scenario is a frozen, self-contained case: a sample repository at a fixed commit, a before and an after specification, a migration note where the category calls for one, and a test suite that passes against the old API and fails against the new one. Twenty scenarios are required, five per change category.

The failing-before condition is what makes a scenario admissible. If the tests do not fail before the repair, a pass afterwards proves nothing — so EV-02 requires that condition to be verified automatically rather than assumed.

| **Category** | **Count** | **Migration note** | **Expected difficulty** |
|---|---|---|---|
| Field renamed | 5 | Present, confirming the mapping | Low: the mapping is stated and the edit is local |
| Field type changed | 5 | Present | Moderate: conversion sites may sit far from the call |
| Required parameter added | 5 | Present | Moderate: a value must be threaded from the caller |
| Endpoint removed | 5 | Two with a replacement, three without | High: the three without a replacement must be refused |

*The three endpoint-removal scenarios without a documented replacement are included deliberately. The correct behavior is refusal, and a system that produces a confident patch for them has failed the scenario even when its tests pass.*

### 6.3  Baselines

Three baselines run over the identical scenario set, so the contribution of validation and retries can be separated from the contribution of the model itself.

| **ID** | **Baseline** | **What it establishes** |
|---|---|---|
| B1 | Do nothing | That every scenario genuinely breaks. The floor against which any repair rate is read. |
| B2 | One model call: no validation, no retries, no guards | What the model alone achieves. The gap between B2 and B3 is this project’s engineering contribution. |
| B3 | Full pipeline: validation, error feedback, up to four attempts, cheat guards | The system as specified in Section 3. |

### 6.4  Metrics

Every metric below is reported for each baseline over the same twenty scenarios.

- Detection precision and recall for the breaking / safe / unknown classification, measured against labels written by hand before the run.
- Repair rate: the share of scenarios whose tests pass at the end, reported overall and broken down by change category.
- Refusal correctness: the share of scenarios lacking a documented mapping that the system correctly declined to patch.
- Attempts needed: the distribution of attempt counts for successful repairs, not only the mean.
- Cheat attempts caught: the count and the guard that fired, reported per change category.
- False confidence: patches that passed validation but were judged wrong on human review, per EV-07. This is the most important number in the study.
- Cost and time per repair: tokens, monetary cost, and wall-clock time, with model and container time separated.

### 6.5  Evaluation requirements

| **ID** | **Requirement** | **Check** |
|---|---|---|
| EV-01 | The release shall include 20 frozen scenarios, 5 per change category, each pinned to a fixed repository commit and a fixed pair of specifications. | AT-12 |
| EV-02 | The evaluation shall verify automatically that each scenario’s tests pass before the API change and fail after it. A scenario failing this check shall be excluded and reported as excluded, with its reason. | AT-12 |
| EV-03 | The evaluation shall execute baselines B1, B2, and B3 over the identical scenario set, under the same model configuration and the same container image. | AT-12 |
| EV-04 | The evaluation shall report detection precision and recall against hand-written labels prepared before the run. | AT-12 |
| EV-05 | The evaluation shall report repair rate overall and per change category, and refusal correctness for scenarios with no documented mapping. | AT-12 |
| EV-06 | The evaluation shall report the attempt distribution, the cheat rejections with the guard that fired, and cost and time per repair. | AT-12 |
| EV-07 | Every patch that passed validation shall be reviewed by a team member and recorded as correct or incorrect. The count of patches that passed validation but were judged incorrect shall be reported as false confidence. | AT-12 |
| EV-08 | The evaluation shall be a repeatable script that writes a machine-readable results file, from which the reported tables are generated. Tables shall not be transcribed by hand. | AT-12 |
| EV-09 | The final report shall state the scenarios on which the system failed, the categories where it performed worst, and the limitations of the measurement, alongside its successes. | AT-12 |

### 6.6  Reporting and honesty rules

- A scenario excluded for any reason is reported as excluded, with its reason. Exclusions are never silent.
- A patch that passes validation is reported as passing validation, not as correct, until a human has reviewed it under EV-07.
- Results from a partial run are labeled partial and are never presented as the full study.
- The evaluation is expected to show that renames repair well and that removals without a replacement do not. Reporting that honestly is the intended outcome, not a shortfall.

## 7  Release deliverables and milestones

### 7.1  Deliverables

- Application source with pinned dependency files, a pinned container image digest, installation and run instructions, and configuration examples that contain no credentials.
- The demonstration API at two specification versions, its migration note, and the sample TypeScript repository that consumes it.
- The twenty frozen evaluation scenarios, published so that the study can be repeated.
- The evaluation script, its machine-readable results file, and the generated result tables.
- Automated tests and their execution records, plus completed acceptance records for Appendix A.
- Design documentation: a class diagram, a pipeline state chart covering detection through delivery and failure, and a short architecture description that agrees with the delivered code.
- The final report, including the failures and limitations required by EV-09.

### 7.2  Milestones

| **Weeks** | **Milestone** | **Done means** |
|---|---|---|
| 1 | Setup | Repository, database, continuous integration, and a sample TypeScript application with passing tests. |
| 2 | Demonstration API | Both specification versions served, with tests that pass on v1 and fail on v2. |
| 3 | Detection | Differences produced, classified, and stored, with evidence retained. |
| 4 | Location | Call sites found for all four change categories, with a coverage report. |
| 5 | Validator | Type check and tests running in the container, output parsed, cheat guards firing correctly. |
| 6–7 | Repair loop | The rename category repaired end to end, with error feedback across attempts. |
| 8 | Delivery | A real pull request with diff, evidence, and test output. |
| 9 | Scenario set | All twenty scenarios built and frozen, each verified to fail before repair. |
| 10 | Evaluation | All three baselines executed; results file and tables generated. |
| 11 | Dashboard and review | All views complete; human review under EV-07 recorded. |
| 12 | Report and demonstration | Final report, slides, and a rehearsed demonstration. |

**Week 5 is the checkpoint.** Nothing after week 5 produces a trustworthy result without a working validator: the repair loop needs its error output, and the evaluation needs its pass and fail verdicts. If the validator is not running reliably by the end of week 5, scope shall be cut elsewhere — never here.

### 7.3  Risks and cut order

| **Risk** | **Response** |
|---|---|
| Container validation proves slow or unreliable in continuous integration | Built first, in week 5, before the agent depends on it. If it slips, the dashboard and the scheduled watcher are cut to protect it. |
| The model produces patches that pass tests but are wrong | Cheat guards, plus the human review of every passing patch required by EV-07. False confidence is reported as a result, not hidden. |
| Weak tests in a scenario hide a bad repair | EV-02 admits a scenario only when its tests actually fail before the repair. |
| Model cost grows without bound | Four-attempt cap, per-run token ceiling, and cost recorded per attempt. |
| Scope creep | Section 1.3 lists what is excluded. The cut order is: dashboard polish first, then scheduled polling, then change categories from four down to three. The evaluation is never cut. |
| Provider or model service outage during the evaluation | Partial results are labeled partial; the run is repeated once services return. |

### 7.4  Deferred extensions

The following are explicitly outside this release and are recorded here so that scope discussions have a fixed reference: response-shape migrations; a second analyzed language; comparison across two or more models over the same scenario set; a GitHub App installation flow in place of a personal access token; scheduled polling as a required rather than optional feature; and publishing the scenario set as a standalone public benchmark.

## 8  References

[1]	OpenAPI Initiative, “OpenAPI Specification, version 3.1.1,” OpenAPI Initiative, 2024. [Online]. Available: https://spec.openapis.org/oas/latest.html. [Accessed: Sep. 24, 2026].

[2]	Microsoft Corporation, “TypeScript documentation,” Microsoft, 2026. [Online]. Available: https://www.typescriptlang.org/docs/. [Accessed: Sep. 24, 2026].

[3]	ts-morph Project, “ts-morph: TypeScript compiler API wrapper,” 2026. [Online]. Available: https://ts-morph.com/. [Accessed: Sep. 24, 2026].

[4]	oasdiff Project, “oasdiff: OpenAPI diff and breaking-change detection,” 2026. [Online]. Available: https://github.com/oasdiff/oasdiff. [Accessed: Sep. 24, 2026].

[5]	Docker, Inc., “Docker documentation,” Docker, Inc., 2026. [Online]. Available: https://docs.docker.com/. [Accessed: Sep. 24, 2026].

[6]	Vitest Project, “Vitest: a next-generation testing framework,” 2026. [Online]. Available: https://vitest.dev/. [Accessed: Sep. 24, 2026].

[7]	GitHub, Inc., “GitHub REST API documentation,” GitHub, Inc., 2026. [Online]. Available: https://docs.github.com/en/rest. [Accessed: Sep. 24, 2026].

[8]	PostgreSQL Global Development Group, “PostgreSQL documentation,” 2026. [Online]. Available: https://www.postgresql.org/docs/. [Accessed: Sep. 24, 2026].

These references describe the implementation technologies. The requirements in this document govern release scope and acceptance.

## Appendix A  Acceptance criteria

Acceptance checks use the sample repository, the frozen specification pairs, and the expected results published with the release. Each execution record identifies the build, environment, inputs, actual output, and pass or fail outcome. A requirement is not marked passed merely because an interface or a model response exists.

| **Check** | **Procedure and pass condition** |
|---|---|
| AT-01 Configuration | Save and reload a valid configuration. Reject missing fields, an unreachable repository, an unparseable specification, and a repository over the size limits. FR-01, FR-02; UI-01. |
| AT-02 Ingestion | Verify baseline establishment, an identical-hash upload producing no new version, and a changed specification producing a version and a difference list. Verify a failed retrieval leaves the baseline unchanged. FR-03 to FR-06, FR-11, FR-12. |
| AT-03 Detection | Over the frozen pairs, verify every expected difference is found with its path, method, and pointer, and that evidence is retained. FR-06 to FR-09. |
| AT-04 Classification and refusal | Verify breaking, safe, and unknown verdicts against hand-written labels. Verify that a change with no confirmed mapping is flagged and never enters repair. FR-07, FR-10, FR-18, FR-36; BR-04, BR-05. |
| AT-05 Location and coverage | Verify all three call patterns are located with file and line, and that dynamic URLs, wrappers, aliases, and excluded files are reported as coverage limits rather than treated as absent. FR-13 to FR-17; BR-02. |
| AT-06 Repair loop | Verify a repair succeeds end to end for the rename category, that validator errors reach the next attempt, and that the loop stops at four attempts. Verify attempts, tokens, and cost are recorded. FR-18 to FR-23, FR-25, FR-26. |
| AT-07 Failures and guards | Inject a source failure, a model failure, a container failure, a delivery failure, and a token-ceiling breach. Verify stage-specific reporting with no false success. Separately, submit patches that delete a test, reduce passing tests, add a type suppression, and edit configuration; verify each is rejected and names its guard. FR-11, FR-24, FR-27 to FR-31, FR-37; DR-04, DR-05; NFR-02, NFR-06. |
| AT-08 Records, delivery, and export | Verify every stage wrote its result, that reanalysis creates a new run without overwriting the old one, and that a validated patch produces a pull request with evidence and test output and no merge. Export JSON and HTML and compare against stored data. FR-33 to FR-35, FR-38 to FR-42; DR-01 to DR-03. |
| AT-09 Boundaries | Test an oversized repository, an oversized specification, a symbolic link, and an ambiguous change. Verify limits are reported and compatibility is never inferred from uninspected code. FR-15, FR-17; C-01. |
| AT-10 Context and data protection | Verify the model receives only the context defined in FR-19. Using planted fake credentials and instruction-like text in a specification and in repository code, verify exclusion from context, absence from logs, reports, and pull-request bodies, and that the planted instructions do not alter system behavior. FR-19; NFR-04, NFR-08. |
| AT-11 Isolation | Verify the container runs without network access, without host credentials, and as a non-root user, and that the developer’s working copy and the default branch are unchanged after a full run. FR-20, FR-32, FR-34; NFR-03; C-02, C-03. |
| AT-12 Evaluation | Execute the evaluation script end to end. Verify the pre-repair failure check, all three baselines, every metric in Section 6.4, the recorded human review, and regeneration of the tables from the results file. Verify three consecutive executions complete without unhandled failure. EV-01 to EV-09; NFR-01, NFR-05, NFR-07, NFR-09. |

## Appendix B  Requirements traceability

The table maps product objectives to observable functionality and to the acceptance evidence that demonstrates it. It is used to check coverage during implementation and at final evaluation.

| **Objective** | **Required outcome** | **Requirements and verification** |
|---|---|---|
| OBJ-01 | Detect and classify breaking changes from real specification versions. | FR-03 to FR-12; UC-02; AT-02 to AT-04. |
| OBJ-02 | Locate the code affected by a change and state the limits of that analysis. | FR-13 to FR-17; UC-03; AT-05, AT-09. |
| OBJ-03 | Repair a confirmed change and prove the repair by compiling and testing it in isolation. | FR-18 to FR-26; UC-04; AT-06, AT-11. |
| OBJ-04 | Refuse to guess. Report an unconfirmed mapping rather than patching it. | FR-10, FR-18, FR-36; BR-04, BR-05; C-04; AT-04. |
| OBJ-05 | Detect and reject patches that pass tests dishonestly. | FR-27 to FR-31; DR-04; AT-07. |
| OBJ-06 | Keep the developer in control: deliver a reviewable pull request and never merge. | FR-33 to FR-35; UI-03; BR-03; C-02; AT-08, AT-11. |
| OBJ-07 | Produce a measured, reproducible result stating where the method works and where it fails. | EV-01 to EV-09; NFR-01, NFR-09; UI-04; AT-12. |

*Coverage review. All 42 functional requirements, 4 interface requirements, 5 data requirements, 9 nonfunctional requirements, and 9 evaluation requirements carry acceptance references. A release is acceptable when every mandatory check passes, its limitations are documented, and the delivered code, documentation, and reported results describe the same behavior.*
