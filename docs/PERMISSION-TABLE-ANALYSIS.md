# Does Edu7 need a `Permission` table?

**Question asked:** should access control be driven by a `Permission` /
`RolePermission` table keyed to roles, or is that not needed now?

**Answer: not now.** Keep role-level RBAC. The R1 trigger has *not* fired, and
the legacy evidence argues against porting its permission system rather than for
it. This document records the measurement so the decision is revisitable rather
than inherited.

Decision date: 2026-09-13 · Supersedes nothing · Amends R1 (trigger sharpened,
not removed).

---

## 1. What R1 actually committed to

R1 (`ARCHITECTURAL-GATE.md`) deferred permissions with a **named trigger**:

> The moment any check needs finer granularity than the six roles — e.g. "a
> TEACHER may edit questions for their own subject but not publish a textbook"
> — permissions must be introduced rather than encoded as another role.

So the question is not "are permissions nicer?" It is narrow and factual:
**has any authorization check needed sub-role granularity?**

## 2. Measuring the legacy system

The argument for permissions is normally "legacy had it, so we lost a
capability." That claim does not survive contact with the legacy code.

| Measurement | Result |
|---|---|
| Permissions defined in `db/db_data/roles_permissions.json` | **48** |
| Roles defined | 7 |
| Legacy route files total | **20** |
| Route files enforcing *any* permission (`requirePermission`) | **1** |
| Route files enforcing a role instead | 5 |
| Route files with **no guard at all** | **14** |
| Distinct permission keys actually referenced at a call site | **8 of 48** |
| `ADMIN`'s permission set in the matrix | `['*']` — a wildcard |

Reproduce:

```bash
grep -rln "requirePermission\|requireAnyPermission" src/routes/ | wc -l   # 1
ls src/routes/*.ts | wc -l                                               # 20
```

Three conclusions follow, and they matter more than the design debate:

1. **Legacy's permission system was mostly decorative.** 40 of 48 permissions
   were seeded, joined and never checked. A permission that is never checked is
   not access control; it is a row that makes an audit look reassuring.
2. **The real legacy exposure was unguarded routes**, not coarse roles. 14 of 20
   route files had no authorization at all — including `exam.routes.ts`,
   `learning.routes.ts`, `parent.routes.ts` and `question.routes.ts`. Porting
   the permission tables would have copied the paperwork and missed the hole.
3. **`ADMIN: ['*']` proves the granularity was unused in practice.** The one role
   most likely to need fine control was given a wildcard instead.

The new system, by contrast, has **zero unguarded route files** — every router
under `src/interface/http/` goes through `requireAuth` plus an explicit role
predicate. That is the property legacy lacked, and it was achieved without a
permission table.

## 3. Has the R1 trigger fired?

I checked every authorization decision in the codebase. There are exactly three
shapes, and none of them is a permission.

**Shape 1 — role lists.** Eleven call sites, all delegating to the single pure
`hasRole` in `contexts/identity/domain/roles.ts`:

| Predicate | Roles |
|---|---|
| `STRUCTURE_ROLES` (catalogue writes) | `SYSTEM_ADMIN` |
| `ADMIN_ROLES` (provisioning) | `SYSTEM_ADMIN`, `SCHOOL_ADMIN` |
| `AUTHORING_ROLES` (content, item bank) | + `CONTENT_AUTHOR` |
| `APPROVAL_ROLES` (publish) | `SYSTEM_ADMIN`, `SCHOOL_ADMIN` |
| `STAFF_ROLES` (analytics, engagement, remediation) | + `TEACHER` |
| `INSTRUCTOR_ROLES` (instruction) | + `TEACHER` |

Six distinct sets over six roles. This is small enough to read in one screen and
is already centralised — the scatter R1 feared has not happened.

**Shape 2 — scope, not permission.** `hasRole(grants, allowed, schoolId)` takes
the school into account, because a `TEACHER` at school A is not a `TEACHER` at
school B. A permission table does **not** solve this; `users:update` says nothing
about *whose* user. Scope is an orthogonal axis, and it is already modelled on
`UserRole.schoolId`.

**Shape 3 — relationship, not permission.** `learner-access.ts` answers "may
this actor touch *this* learner, in READ or ACT mode". The answer depends on a
verified `GuardianLink` row, and ACT is never delegable — a parent must not
submit answers as their child, because that corrupts the evidence stream mastery
is computed from. **No permission table can express this**: it is a per-row
relationship plus a pedagogical rule, not a static grant.

The closest thing to a trigger is content approval — *an author may not approve
their own submission*. But note what that rule actually needs: the **identity of
the submitter** compared against the **identity of the approver**. That is a
row-level relationship (shape 3), not a capability grant. `content:approve` as a
permission would not express it either; you would still need the submitter check.

**Verdict: the trigger has not fired.** Every check today is answered by
(role × scope × relationship), and permissions address only the first factor —
the one that is already the least troublesome.

## 4. What a permission table would cost today

- **A join on every request.** Currently an actor's grants arrive in the JWT and
  `hasRole` is a pure array scan with no I/O. Permissions mean resolving
  role→permission per request, or caching it and inheriting a staleness bug on
  every role change.
- **Two tables and a seeding surface** that must stay consistent with the code.
  Legacy demonstrates the failure mode precisely: the matrix drifted until 40 of
  48 entries described nothing.
- **Weaker, not stronger, review.** `hasRole(actor.roles, APPROVAL_ROLES)` is
  checkable by reading the file. `requirePermission('content:approve')` moves the
  real policy into data, where no compiler and no architecture rule can see it.
  Today `RoleName` is a TypeScript union — an invalid role is a **compile error**.
  A permission string is not.
- **False assurance.** The dangerous outcome is a permission matrix that *looks*
  like fine-grained control while the wildcard rows and unchecked routes do the
  actual deciding. That is exactly what legacy shipped.

## 5. When to build it — a sharpened trigger

Introduce `Permission` / `RolePermission` when **either** holds:

1. **Sub-role granularity is genuinely needed within one role** — i.e. two users
   who are both `TEACHER` must legitimately be allowed different actions, and the
   difference is *not* explainable by school scope or a row-level relationship.
   The canonical case: subject-restricted authoring ("a TEACHER may edit
   questions for their own subject"), which requires a `subjectId` dimension that
   no current role carries.
2. **Customers must configure authorization without a deploy.** The instant an
   administrator needs to change who can do what through a UI, policy must live
   in data. This is a product requirement, not a technical one, and it is the
   more likely trigger of the two.

Two explicit **non**-triggers, recorded because they will be tempting:

- *Adding a seventh role* is not a trigger. `ROLE_NAMES` is a union type; adding
  one value is a compile-checked change.
- *Wanting an audit of who may do what* is not a trigger. That is a report, and
  it can be generated from the six role-set constants above.

## 6. Recommendation

Keep role-level RBAC. Spend the effort instead on the gap the legacy measurement
actually exposes: **making sure every route is guarded and every guard is
tested** — the property legacy lacked in 14 of 20 files and the new system
currently holds in all of them. That is the control that prevents incidents; the
permission table is the one that documents them.

Re-evaluate when a `TEACHER` must be restricted by subject, or when
authorization becomes customer-configurable. Until then this is a deliberate
simplification with a measured basis, not an omission.
