# Requests for Comments (RFCs)

This directory contains Request for Comments documents that propose architectural decisions, patterns, and refactoring strategies for BrandBlitz.

## Active RFCs

### Architecture & Patterns

- **[RFC 1263: Formalize test naming/boundary convention](./1263-test-naming-convention.md)** — Proposes standardized naming (`*.unit.test.ts`, `*.integration.test.ts`) and allowed dependencies for each tier across `apps/api/src`, with guidelines for CI and local development.

- **[RFC 1266: Standardized web API client](./1266-standardized-web-api-client.md)** — Proposes extracting a single typed API client module (`apps/web/src/lib/api-client.ts`) from scattered fetch calls across routes and components, aligned with `docs/openapi.yml`.

### Domain Refactoring

- **[RFC 1264: Pure scoring engine extraction](./1264-scoring-engine-extraction.md)** — Proposes extracting scoring business logic into a pure, framework-independent module with explicit inputs/outputs, enabling reuse by batch re-scoring tools and offline dispute resolution.

- **[RFC 1267: Referral processor separation](./1267-referral-processor-separation.md)** — Proposes moving referral-bonus eligibility and payout rules from `apps/api/src/queues/processors/referral-bonus.processor.ts` into `services/referrals.ts`, leaving the processor as a thin BullMQ adapter.

- **[RFC 1265: Domain-event pattern](./1265-domain-event-pattern.md)** — Proposes a minimal in-process `EventEmitter` for cross-cutting side effects of payout completion (referral bonus queueing) and session completion (streak updates), with an explicit list of what stays direct (Stellar submission, DB writes, integrity checks) and an honest debuggability trade-off assessment.

## RFC Process

### When to Write an RFC

Write an RFC when proposing:
- A new architectural pattern or convention
- A significant refactoring spanning multiple files or modules
- A change to project-wide practices (testing, API design, etc.)

Do **not** write an RFC for:
- Single bug fixes
- Small feature additions
- Localized refactoring (one file, one domain)

### RFC Structure

Each RFC should include:

1. **Problem Statement** — What's wrong today, why it matters
2. **Current State** — Inventory of existing patterns, code locations
3. **Proposed Solution** — How to fix it, with examples
4. **Benefits** — Why this matters (maintainability, testability, reusability, etc.)
5. **Implementation Plan** — Steps to adopt, migration path for existing code
6. **Open Questions** — For discussion before approval

### Before Merging an RFC

1. **Create the issue** if not already created
2. **Write the RFC document** in `docs/rfc/` with the issue number
3. **Link from this README** (add to list above)
4. **Request review** in the PR description, mentioning maintainers
5. **Incorporate feedback** from reviewers and update the RFC
6. **Merge when approved** — at least one maintainer approval

### Implementing an RFC

Once an RFC is merged:
1. Create a separate PR for implementation
2. Reference the RFC in commit messages and PR description
3. Update the RFC's status to "Implemented" with links to PRs
4. Update `CONTRIBUTING.md` or related docs to reflect new patterns

## See Also

- [CONTRIBUTING.md](../CONTRIBUTING.md) — Contribution guidelines, includes references to RFCs
- [docs/](../README.md) — Project documentation
- GitHub issues: [#1263](../../issues/1263), [#1264](../../issues/1264), [#1266](../../issues/1266), [#1267](../../issues/1267), [#1265](../../issues/1265)
