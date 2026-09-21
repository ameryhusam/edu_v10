# Documentation Governance

**Status:** ADOPTED.

## 1. One canonical documentation tree

All current project architecture and engineering documentation belongs under `Docs_v10/`.

Do not create another `docs2`, `documentation-new`, dated plan directory, or ad-hoc instruction file.

## 2. Document classes

Use only these classes:

- Architecture — stable boundaries and ownership.
- Domain contract — business invariants.
- Capability — current behavior and API contract.
- Decision — a deliberate architectural/product ruling.
- Runbook — operational procedure.
- Roadmap — future work.
- Audit — evidence of a current review.

Do not create a new document for every implementation commit unless the decision is durable.

## 3. Required header

Each normative document should state:

- Status;
- scope;
- last reviewed date;
- authoritative dependencies where useful;
- CURRENT vs ADOPTED vs TARGET distinctions.

## 4. No duplicated algorithms

Docs must describe the contract, not reproduce production algorithms line by line.

If an algorithm is implemented in code, document:

- owner;
- inputs/outputs;
- invariants;
- failure behavior;
- test location.

Do not copy pseudocode that can drift from the implementation unless the pseudocode is itself the formal contract.

## 5. No stale rule inheritance

When a decision changes:

1. update the canonical document;
2. mark the old decision as superseded if retained;
3. update cross-links;
4. search the repository for the old rule/field/name;
5. add a regression test if the change is machine-enforceable.

## 6. Historical material

Old `docs/` files may remain temporarily for auditability.

They are not instructions for new development.

After migration verification, delete them from the working tree; Git history preserves them.

## 7. Documentation review gate

Before deleting `docs/`:

- compare all old documents against Docs_v10;
- classify each as absorbed, superseded, historical, or still missing;
- verify all important current code changes since the old documents;
- update README links;
- run repository verification.

## 8. Naming

Use stable English filenames with numeric ordering.

Avoid ambiguous names such as `final`, `new`, `latest`, `temp`, or `New folder`.

Use domain terms consistently.

## 9. Documentation as architecture contract

Docs_v10 may define target architecture ahead of implementation. Such decisions must be labeled ADOPTED/TARGET so an AI developer knows whether to preserve current behavior or implement the target.

This prevents documentation from becoming either stale history or a hidden source of contradictory requirements.
