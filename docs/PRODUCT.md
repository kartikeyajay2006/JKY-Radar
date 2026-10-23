# Product brief

**JKY-Radar** — One Radar. Every API. Know What Breaks Before You Ship.

## Problem

API providers change contracts constantly. A renamed field, a new required parameter or a tightened OAuth scope ships, and a mobile app, a partner integration or a nightly job breaks. Text diffs show what moved but not what it breaks, and most breaking-change checkers are tied to a single format or vendor.

## Who it is for

- **API owners and platform teams** deciding whether a release is safe.
- **Reviewers** who need evidence, not opinions, before approving.
- **Consumer teams** who want to know when a change affects them.

## What it does

1. Accepts two versions of a contract in a supported format (upload, paste, or manual builder). Format is detected from the content and can be overridden.
2. Stores each version immutably with SHA-256 hashes, after redacting secrets.
3. Runs a deterministic, versioned analysis: parse safely, normalise, match by stable keys, classify with direction-aware rules, compute coverage, evaluate the release gate.
4. Explains every finding: what changed, why it is risky, evidence with line numbers, how to fix it, which rule decided, what is unknown.
5. Maps changes to registered consumers and their declared dependencies.
6. Records review decisions and overrides in an append-only audit log.
7. Exports JSON, Markdown and PDF reports.

## Differentiators

- **Rule explainability.** Immutable rule IDs with documented severity and positive/negative tests.
- **Honest coverage.** Constructs that are not decided formally (oneOf, regex, bindings) produce needs-review findings and an inconclusive gate rather than a false pass.
- **Radar Replay.** Every analysis keeps input hashes and engine, rule, adapter and policy versions; identical inputs return the stored result.
- **Impact graph.** Built only from registered consumers; never invented telemetry.
- **Same engine everywhere.** Server, browser playground and offline CLI.

## Non-goals

- Observing live traffic or calling the APIs being analysed.
- Fetching remote references or URLs on behalf of users.
- Comparing REST against GraphQL, gRPC or AsyncAPI as if they were equivalent.
