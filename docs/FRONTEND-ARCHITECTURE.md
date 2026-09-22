# Edu7 — Frontend Architecture Specification

**Status:** specification, the **Phase 0 audit (§16)**, the **design model +
Phase 1 foundation (§17)**, the **first Phase 2 learner screens (§18)**, and the
**redesigned auth screen with self-service registration (§19)**, and the
**visual-richness pass on the semantic foundation (§20)**, and the
**closure of gaps G3 and G4 (§21)**, the **administration surface and G6
(§22)**, the **completed visual brief (§23)**, and the **cross-site cookie
defect that made the app unusable in the preview (§24)**. Sign-in,
registration, the student dashboard, the learning path, the parent home screen,
the teacher roster and the user directory are live on real data. **All six gaps
G1–G6 are closed.**

**Audience:** the agent (Codex/GitHub) that will build the Edu7 frontend, and
any human reviewing that work.

**Prime directive:** the frontend renders decisions the backend has already
made. It composes canonical outputs and **calculates no educational meaning**.
Every rule below exists to keep that true under pressure.

> **How to use this document.** §0 is a mandatory audit — perform it and report
> before writing any component. §1–§13 are the specification. §14 lists what
> must be approved before implementation starts. Do not skip to §4.

---

## 0. MANDATORY FIRST STEP — audit the project root before proposing anything

Do **not** create files, install packages, or scaffold a UI on the first pass.
Read the repository first and produce a written report.

### 0.1 What to read, in this order

| # | Path | Why |
|---|---|---|
| 1 | `README.md` | Canonical doc reading order |
| 2 | `docs/ARCHITECTURAL-GATE.md` | Layer boundaries; Identity is frozen |
| 3 | `docs/CAPABILITY-LEDGER.md` | What is ✅ vs 🟡 — **only ✅ may get UI** |
| 4 | `docs/NEXT-WAVE-REVIEW.md` §7 | Current verified state of the gaps |
| 5 | `src/shared/http/envelope.ts` | The one response shape |
| 6 | `src/interface/http/*.routes.ts` | The real endpoint surface |
| 7 | `src/interface/http/learner-access.ts` | The learner-scoping boundary |
| 8 | `prisma/schema.prisma` | Enums the UI must render |
| 9 | `scripts/check-architecture.ts` | The 27 rules you will be judged by |

### 0.2 The report to produce (before any code)

1. **Endpoint inventory** — every route, its auth requirement, its role
   requirement, and the exact success payload shape. Derive this from the
   router and its Zod schemas, not from this document.
2. **Role → capability matrix** — for each of the six roles, which endpoints it
   may call.
3. **Gap list** — every screen a role needs for which **no endpoint exists**.
   Report it; do **not** fill the gap in the client.
4. **Enum inventory** — every backend enum the UI must display, with the
   proposed Arabic and English string for each. These are translation tables,
   not logic.
5. **Proposed build order**, with the smallest useful vertical slice first.
6. **Anything in this document contradicted by the code.** The code wins; say
   so explicitly rather than quietly following the document.

### 0.3 Verified starting state — SUPERSEDED

> **These figures are stale. See §16 for the executed audit.** The counts below
> were written before Identity provisioning and the item-bank/exam surfaces
> landed; the real numbers are **82 endpoints across 11 mounts** and **28**
> architecture rules. Left in place so the drift is visible rather than edited
> away.

Confirmed by inspection, so you can detect drift:

- **There is no frontend.** Zero `.tsx` files, no Vite, no React in
  `package.json`. This is greenfield — nothing to migrate, nothing to preserve.
- Backend dependencies are Express 5, Prisma 7, Zod 4. React 19 + Vite are
  **required by the stack decision but not yet installed**.
- **48 endpoints** across 10 mounts, all under `/api/v1/*`.
- Six roles: `SYSTEM_ADMIN`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`, `PARENT`,
  `CONTENT_AUTHOR`.
- `User.locale` defaults to **`"ar"`** → the product is **Arabic-first, RTL-first**.

---

## 1. The rule that governs everything else

```
UI  →  Server State  →  API client  →  HTTP  →  Application  →  Domain  →  DB
```

Never:

```
UI  →  business logic  →  database assumptions
```

**Concretely forbidden in frontend code:**

| Forbidden | Why | Use instead |
|---|---|---|
| Computing mastery, or any weighted average of scores | Mastery has exactly one owner; four competing formulas is the legacy defect being rebuilt away from | `GET /learning/mastery` |
| Deciding what the learner should do next | `decideNextActivity` is an ordered pedagogical policy | `GET /learning/next-step` |
| Deriving overdue from `dueAt` in the client | Overdue is a domain verdict with role-scoped consequences | `GET /instruction/due-work` |
| Deciding whether an activity is complete | Completion is an ordered gate policy returning a named reason | `GET /learning/completion` |
| Re-scoring an attempt | Scored once at submit; recomputing is the AW1 defect | attempt submit response |
| Hiding an action the API would reject | Security by concealment; the UI is not the boundary | render from role, still handle 403 |
| Treating `PARENT` work as academic | Advisory-only is a domain rule | the `origin` field on each item |

**The one legitimate client-side derivation** is presentation formatting:
`0.42` → `"42%"`, an ISO timestamp → a localised date, a `gate` code → a
translated sentence. Formatting is not meaning.

> **Test for any computation you are tempted to write:** if two clients
> (web and Android) could disagree about the answer, it belongs in the backend.

---

## 2. One design system, two layouts — not two designs

Agreed target:

```
                    Edu7 Design System
               (tokens · primitives · education)
                            │
                ┌───────────┴───────────┐
             Web UI                 Android UI
                └───────────┬───────────┘
                     same components
                     same API / state
                     same domain
```

Shared: colours, typography, spacing, buttons, cards, forms, dialogs, icons,
the education components, the API contract, the state layer, all business
meaning.

**Not necessarily shared: layout at a given viewport.** A table on desktop and
a stacked card list on mobile are the *same component* choosing a presentation —
not two components, and never two codebases.

**The anti-goal** (the legacy failure this prevents):

```
Page A → its own button      Page C → its own modal
Page B → a different button  Page D → a different card
```

---

## 3. Project layout

The frontend is a **sibling of `src/`, not a child of it**. Backend and
frontend must never import from one another except through §6.

```
<repo root>/
  src/                     ← backend (untouched)
  web/                     ← NEW: the React application
    index.html
    vite.config.ts
    src/
      main.tsx
      app/
        router.tsx
        providers.tsx
      shared/
        api/               ← fetch client, envelope, error mapping
        auth/              ← session context, role helpers
        i18n/              ← ar/en dictionaries, enum translation tables
        format/            ← percent, date, number formatters
        hooks/             ← useBreakpoint, useDirection
      design-system/
        tokens/
        ui/                ← primitives, zero domain knowledge
        layout/            ← AppShell, Sidebar, MobileNav, PageHeader
        patterns/          ← ResponsiveTable, ResponsiveDialog, FilterBar
      education/           ← domain-aware, role-agnostic components
      features/            ← one folder per capability
        learning/
        assessment/
        instruction/
        analytics/
        content/
        engagement/
      pages/
        student/
        teacher/
        parent/
        author/
        admin/
```

### 3.1 The dependency rule

```
pages → features → education → design-system/patterns → design-system/ui → tokens
                 ↘ shared/api · shared/i18n · shared/format
```

Imports flow **downward only**.

- `design-system/ui` must not know what a concept, mastery or learner is.
- `education/` may know domain *vocabulary*, but holds **no fetching and no
  business rules** — it takes props and renders.
- `features/` owns fetching (via §6) and composition.
- `pages/` owns routing and layout assembly. **Pages contain no business logic.**

This mirrors the backend's own layering, and should be enforced by a frontend
rule appended to `scripts/check-architecture.ts` (§13).

---

## 4. Design tokens

Tokens are the single source of visual truth. **No raw hex, px or font-family
literals in any component.** Define once as CSS custom properties, consume
everywhere; a future Android target re-maps the token values, not the components.

Required token groups:

| Group | Notes |
|---|---|
| Colour | Semantic names only — `--color-surface`, `--color-danger`, never `--color-blue-500`. Must include a **mastery scale** and a **status scale** (see §5.3). |
| Typography | Must specify an **Arabic-capable family first**, with a Latin fallback. Arabic glyphs need more line-height than Latin at the same size — set it deliberately. |
| Spacing | One scale, 4px base. |
| Radius / elevation | Small closed sets. |
| Breakpoints | §7. |
| Motion | Durations + easings; must respect `prefers-reduced-motion`. |
| Z-index | A named ladder. Ad-hoc `z-index: 9999` is banned. |

**Dark mode:** decide now whether it ships. If yes, tokens must be defined as
semantic pairs from day one — retrofitting dark mode over literal colours is a
full rewrite. *(Product decision — §14.)*

---

## 5. Component layers

### 5.1 `design-system/ui` — primitives

`Button` · `IconButton` · `Input` · `Textarea` · `Select` · `Checkbox` ·
`Radio` · `Switch` · `Badge` · `Card` · `Dialog` · `Drawer` · `Sheet` · `Tabs` ·
`Tooltip` · `Popover` · `Menu` · `Toast` · `Avatar` · `Skeleton` · `Spinner` ·
`Pagination` · `Breadcrumb` · `Alert`

Rules: no domain vocabulary · no data fetching · fully keyboard accessible ·
RTL-correct (§8) · every interactive element has visible focus · variants via
props, never via page-level CSS overrides.

### 5.2 State components — mandatory, not optional

`LoadingState` · `EmptyState` · `ErrorState` · `ForbiddenState` ·
`OfflineState`

**Every data-bound view must handle all five.** A screen that renders only the
happy path is incomplete and must fail review. `ErrorState` renders a
**translated error code** (§9), never a raw backend string, and must offer a
retry where the operation is idempotent.

### 5.3 `education/` — the components that carry Edu7's meaning

These are what make the product coherent; they must exist **before** any page.

| Component | Renders | Must NOT |
|---|---|---|
| `MasteryIndicator` | A 0–1 mastery from the API | Compute or average mastery |
| `MasteryTrend` | A server-provided series | Infer a trend from two points |
| `NextStepCard` | One of the 7 decision kinds (§5.4) | Choose the kind |
| `ConceptCard` / `LessonCard` / `UnitCard` | Hierarchy nodes | Decide visibility |
| `QuestionCard` | Stem, choices, media | Know the correct answer |
| `AnswerFeedback` | The server's verdict + explanation | Evaluate correctness |
| `MisconceptionChip` | An open misconception + confidence | Diagnose one |
| `RemediationEpisodeCard` | An episode + its recommendations | Generate recommendations |
| `AssignmentCard` | An obligation + **origin badge** | Treat PARENT as academic |
| `DueWorkList` | The server's `academic[]` / `advisory[]` split | Merge the two lists |
| `ExamCard` / `ExamResultSummary` | Exam metadata, server-computed score | Recompute a score |
| `ProgressCard` | Server-computed progress | Count completed items itself |
| `FlashcardDeck` | Server-ordered deck | Reorder by its own tiering |
| `PrerequisiteChain` | Blocking prerequisites | Evaluate eligibility |
| `XPBadge` / `LevelProgress` / `StreakIndicator` | Engagement reads | Award XP |
| `GateExplanation` | A translated `CompletionGate` code | Invent a reason |

### 5.4 Enum rendering — translation tables, never logic

The backend deliberately returns **stable codes** so the UI can translate them.
Each set below gets one table in `shared/i18n`, mapping code → `{ar, en, icon,
tone}`. A `switch` that *changes behaviour* on these values is a smell; a
lookup that changes *wording* is correct.

- **Next-step kinds (7):** `REMEDIATE` · `REVIEW` · `UNBLOCK` · `LEARN` ·
  `ASSESS` · `PRACTISE` · `ADVANCE`
- **Completion gates (6):** `NONE` · `NOT_ATTEMPTED` · `ASSESSMENT_REQUIRED` ·
  `CONTENT_REQUIRED` · `PRACTICE_REQUIRED` · `MASTERY_BELOW_THRESHOLD`
- **Obligation statuses (5):** `PENDING` · `IN_PROGRESS` · `COMPLETED` ·
  `EXPIRED` · `WAIVED`
- **Assignment origins (5):** `TEACHER` · `PARENT` · `REMEDIAL` · `ADAPTIVE` ·
  `SELF` — and see §11.
- **Content readiness (4):** `DRAFT` · `IN_REVIEW` · `PUBLISHED` · `ARCHIVED`.
  ⚠ **`PUBLISHED` must be shown to users as "متاح / Available", never
  "منشور / Published".** Edu7 does not publish textbooks — see
  `PUBLISHING-LIFECYCLE-GATE.md` §10. This is a hard requirement, and the
  clearest example of why enum rendering is a table and not a passthrough.
- **Roles (6):** as listed in §0.3.

---

## 6. Server state — the only way data enters the UI

**Rule: components never call `fetch`.** All access goes through a typed
feature hook over a shared client. TanStack Query (React Query) is the assumed
tool; any equivalent must provide caching, deduplication, retry, and
invalidation.

### 6.1 The envelope

Every endpoint — success or failure, no exceptions — returns:

```ts
{ ok: true,  data: T,                                    meta: { requestId, at } }
{ ok: false, error: { code, message, details? },         meta: { requestId, at } }
```

The client unwraps this in **exactly one place**. Features receive `T` or a
typed error; they never see the envelope. `requestId` must be attached to every
error report — it is the join key to backend logs.

### 6.2 Status mapping

The backend maps domain error kinds to status codes in one place. Mirror it in
one place:

| Status | Kind | Client behaviour |
|---|---|---|
| 400 | VALIDATION | Field errors from `details.issues` |
| 401 | UNAUTHENTICATED | Refresh once, then sign out |
| 403 | FORBIDDEN | `ForbiddenState` — never a blank screen |
| 404 | NOT_FOUND | `EmptyState` |
| 409 | CONFLICT | Explain and offer refresh |
| 422 | PRECONDITION | Show the domain reason — usually actionable |
| 503 | UNAVAILABLE | Retry with backoff |
| 500 | INTERNAL | `ErrorState` + `requestId` |

**422 is the interesting one:** it carries pedagogical refusals. Never render it
as "something went wrong" — render the translated code.

### 6.3 Auth

Login returns tokens in the body **and** sets the refresh token as an
`httpOnly` cookie. **Browser clients must use the cookie** — JavaScript cannot
read it, which is the point. Do not put the refresh token in `localStorage`.

The access token is short-lived (900s). Implement refresh as a single-flight
operation: concurrent 401s must trigger **one** refresh, not one per request.

### 6.4 Query key and invalidation discipline

Key by `[capability, resource, params]`. After any mutation, invalidate by the
**capability that owns the changed truth**, not by the screen showing it:

- Submitting an answer → invalidate `learning`, `mastery`, `remediation`,
  `engagement`. Mastery is recomputed server-side on submit, so a stale mastery
  card after answering is a real bug.
- Waiving/cancelling an obligation → invalidate `instruction`.
- A content transition → invalidate `content`.

**Never** write a computed value into the cache to avoid a refetch. Read the
server's number.

### 6.5 Learner scoping

Learner-scoped endpoints resolve the learner from the authenticated actor
through one canonical backend boundary. **The client must not send a
`learnerKey` for "my own data" requests.** Staff and parent views pass an
explicit learner only where the endpoint accepts one — and the backend, not the
client, decides whether that is allowed.

---

## 7. Responsive strategy — behaviour, not just width

Responsive here means **the component changes its interaction model**, not only
its size. These are design-system decisions, made once, not per page.

### 7.1 Breakpoints

| Token | Width | Target |
|---|---|---|
| `sm` | < 640 | Phone |
| `md` | 640–1023 | Large phone / small tablet |
| `lg` | 1024–1439 | Tablet landscape / laptop |
| `xl` | ≥ 1440 | Desktop |

Primary split: **`< lg` = compact**, **`≥ lg` = expanded**. Mobile-first
defaults; add complexity upward.

### 7.2 The mandated adaptations

| Element | Expanded (≥ lg) | Compact (< lg) |
|---|---|---|
| Navigation | Persistent sidebar | Top bar + **bottom tab bar** (≤ 5 items) |
| Sidebar | Fixed | `Drawer`, focus-trapped |
| Table | `DataTable` | **Stacked cards** (§7.3) |
| Dialog | Centred modal | **Bottom sheet** or full-screen |
| Filters | Inline row | Filter button → sheet, with an active-count badge |
| Page header | Title + actions inline | Title, actions collapsed into a menu |
| Forms | Multi-column | Single column, ≥ 44px touch targets |
| Charts | Full | Simplified; horizontal scroll over illegible shrinking |

### 7.3 The table case — stated explicitly because it is where this usually fails

Desktop:

```
Student | Concept   | Mastery | Status | Action
Ahmed   | Fractions | 42%     | Risk   | View
```

Mobile — same data, same component, same API, different presentation:

```
┌─────────────────────────┐
│ Ahmed                   │
│ Fractions               │
│ Mastery 42%             │
│ ⚠ Needs support         │
│ [View]                  │
└─────────────────────────┘
```

Implement as **one `ResponsiveTable`** taking a column set plus a
`renderCompactRow`. Forbidden: two components, or a horizontally scrolling
desktop table on a phone.

### 7.4 Implementation rule

Prefer CSS (container queries, flex/grid) for layout. Use a `useBreakpoint`
hook **only** when the component tree genuinely differs (modal vs sheet, table
vs cards) — JS breakpoints cause hydration and flash issues and must not be the
default tool.

---

## 8. RTL and internationalisation — first-class, not a later pass

`User.locale` defaults to **`"ar"`**. Arabic is the primary language and RTL is
the primary direction. The backend already refuses to embed UI language in
domain rules — it returns codes precisely so the UI can translate.

**Requirements:**

1. `dir="rtl"` driven by the user's locale, set at the document root.
2. **Logical CSS properties only** — `margin-inline-start`, not `margin-left`.
   A physical property in a component is a bug.
3. Directional icons (chevrons, arrows, progress) must mirror; logos and media
   controls must not.
4. Numerals, dates and percentages formatted through `Intl` with the active
   locale. Decide Arabic-Indic vs Western digits explicitly. *(§14.)*
5. **No string literals in components.** All copy from the i18n layer, keyed.
6. Test every primitive in both directions. RTL is not "Arabic mode"; it is a
   layout axis.

---

## 9. Errors, empty states and refusals

The backend distinguishes *failures* from *refusals*. A refusal (403/422) is
often the most pedagogically meaningful response in the product — "you cannot
advance yet because mastery is below threshold" is a **feature**.

- Map every rendered error code to translated copy. Unknown code → generic
  message **plus the code and `requestId`**, never a silent swallow.
- **Never** show a raw backend `message` to a learner. Those strings are
  developer-facing and English.
- Empty states must distinguish *no data yet* from *nothing matched your
  filter* — different copy, different actions.

---

## 10. Role-based composition

Six roles: `SYSTEM_ADMIN`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`, `PARENT`,
`CONTENT_AUTHOR`. Users may hold several.

- Navigation and available actions are composed from the actor's roles.
- **The UI is a convenience layer, not a security boundary.** Every protected
  action must still handle 403. Never assume hiding a button is protection.
- Prefer **one component, role-varied props** over per-role component copies. A
  `MasteryIndicator` is the same for a student and a teacher.
- Role-specific *pages* are legitimate; role-specific *design systems* are not.

---

## 11. PARENT is advisory — a UI-visible domain rule

The domain enforces that `PARENT`-origin work never gates progression, never
affects mastery, and never emits evidence. **The UI must make this visible, not
just avoid contradicting it:**

- `DueWorkList` renders the server's `academic[]` and `advisory[]` **separately**
  and must never merge or re-sort them into one list.
- Every `AssignmentCard` shows an origin badge.
- Advisory items must not appear in academic completion counts or progress
  rings.
- No UI affordance may imply a parent task blocks a lesson.

This is listed in the frontend spec because a merged list is the most likely way
a correct backend rule gets defeated in practice.

---

## 12. Web today, Android later — what to protect now

**Recommendation: build Web-first responsive now. Do not build React Native
now, and do not maintain two UI projects.** Decide the Android path
(Capacitor wrapper vs React Native) *after* the web UI stabilises, based on
real requirements for offline, push notifications, camera and background work.

To keep both doors open, the following must hold from the first commit:

**Shareable (keep platform-free):** API contracts and types · Zod-derived
validation · design tokens · i18n dictionaries and enum tables · server-state
hooks · all educational meaning.

**Must be isolated behind a thin adapter — never called directly from features:**
`window` · `document` · `localStorage` · `navigator` · `File`/`Blob` ·
`IntersectionObserver` · URL/history access outside the router.

Concretely: one `platform/` module exporting `storage`, `clipboard`,
`share`, `download`, `notify`. Web implements them with browser APIs; Android
re-implements the same interface. **A `localStorage` call inside a feature is a
portability bug even though it works.**

Also avoid: hover-only interactions (no hover on touch) · fixed pixel widths
assuming a desktop viewport · keyboard shortcuts as the only path to an action ·
right-click menus.

---

## 13. Quality gates

**Add a frontend section to `scripts/check-architecture.ts`** — the backend's 27
rules are the reason its boundaries held, and the frontend needs the same
mechanism. Proposed rules:

| Rule | Assertion |
|---|---|
| FE1 | No `fetch(`/`axios` outside `shared/api/` |
| FE2 | No raw hex colours or `px` font sizes outside `design-system/tokens/` |
| FE3 | No physical CSS direction properties (`margin-left`, `padding-right`, `left:`, `right:`) |
| FE4 | No `localStorage`/`window`/`document` outside `platform/` |
| FE5 | No hardcoded user-facing strings in components — i18n keys only |
| FE6 | `design-system/ui` imports nothing from `education/`, `features/`, `pages/` |
| FE7 | No imports from `../src/` (backend) except generated types (§6) |
| FE8 | No mastery/score arithmetic outside `shared/format` |

Also required: typecheck clean · unit tests for `education/` components with
both an Arabic and an English render · accessibility checks (keyboard path,
focus trap in Drawer/Dialog, visible focus, contrast) · every data view proven
to render all five states from §5.2.

**Testing discipline matches the backend's:** focused tests for the capability
being built; full regression only at the feature/PR gate.

---

## 14. Gates — what must be decided or true before any UI is written

**Product decisions needed (I am not taking these):**

1. **Dark mode** — ships or not? Determines token structure now.
2. **Digits** — Arabic-Indic (٤٢٪) or Western (42%) for Arabic locale?
3. **Bottom-nav destinations** — which ≤5 for student, and for teacher?
4. **Offline expectations** — any, or online-only for v1? Changes caching
   strategy fundamentally.
5. **Android intent** — is it committed, or possible? Committed pushes toward
   stricter platform isolation now.

**Backend prerequisites — the honest constraint:**

Per `CAPABILITY-LEDGER.md` and `NEXT-WAVE-REVIEW.md` §7, **build UI only on ✅
capabilities.** Learning next-step, mastery, path, assessment attempts,
remediation, misconceptions, flashcards, XP, assignments/obligations and due
work are ✅ and have endpoints.

**Teacher exam results has no endpoint** (`NEXT-WAVE-REVIEW.md` §7.4) and
**dashboards are deferred** until it exists. Do not build a teacher results
screen against an invented contract — that is exactly how a UI ends up owning
educational meaning.

**Recommended first slice:** the student learning loop —
`AppShell` + `next-step` + `mastery` + answer an attempt. It exercises tokens,
primitives, responsive shell, server state, error handling, RTL, and the
invalidation chain (answer → mastery recompute) on fully proven endpoints.

---

## 15. Summary

| Decision | Ruling |
|---|---|
| Two designs for web and Android? | **No.** One design system, responsive layouts. |
| Two codebases? | **No.** Web-first now; Android path decided later. |
| React Native now? | **No.** Not until the web UI stabilises. |
| Same layout at every size? | **No.** Same meaning, adapted presentation. |
| Where does educational meaning live? | **Backend only.** |
| Design system before pages? | **Yes.** Tokens → primitives → education → features → pages. |
| RTL later? | **No.** Arabic-first from the first commit. |
| Start building UI now? | **No.** §0 audit and §14 gates first. |

---

## 16. PHASE 0 AUDIT — executed 2026-09-12

This section is the report §0.2 demanded, produced by reading the routers and
by **calling the running API as each seeded role**. Where a claim below is
marked *(probed)* it was verified over HTTP, not inferred from code.

**Headline:** the backend is in far better shape than a typical pre-frontend
audit finds — the entire student learning loop works end to end today. But
**five discovery gaps block Phase 2**, and they share one cause: every
learner-facing endpoint takes a `textbookKey`, `lessonKey` or `conceptKey` as
*input*, and **nothing returns one**. Every existing proof of the system —
seed, tests, nine check scripts — hardcodes `EDU-MATH-G07-T1-ED2026`. That
hardcoding hid the gap, because no caller ever had to ask "which book?".

### 16.1 Drift found in this document

| §0.3 claimed | Reality *(probed)* |
|---|---|
| 48 endpoints across 10 mounts | **82 endpoints across 11 mounts** |
| 27 architecture rules | **28 rules** |
| Identity has no provisioning | **15 provisioning endpoints exist** (ledger Rev 28) |
| Teacher exam results has no endpoint | **`GET /analytics/exams/:examKey/results` exists** |

§0.3 is stale and must not be used as the baseline. The tables below supersede it.

### 16.2 Endpoint inventory — 82 endpoints, 11 mounts

| Mount | Count | Authorization gate |
|---|---|---|
| `/auth` | 4 | public login; rest authenticated |
| `/learning` | 5 | `resolveLearnerKey` (self, or delegated to verified guardian/staff) |
| `/assessment` | 4 | `requireSelfLearner` — **acting**, never delegable |
| `/instruction` | 13 | mixed: planner writes, `resolveLearnerKey` reads, `requireGuardian` parent tasks |
| `/content` | 28 | `requireAuthor`; transitions additionally `requireApprover` |
| `/analytics` | 6 | staff by school scope; `/learner` via `resolveLearnerKey` |
| `/remediation` | 4 | learner reads; `tracker` + `history` staff |
| `/engagement` | 2 | `/xp` learner-scoped; `/leaderboard` staff |
| `/provisioning` | 15 | `requireAdmin` (SYSTEM_ADMIN, SCHOOL_ADMIN) |
| `/tutoring` | 1 | `requireSelfLearner` |

The READ-vs-ACT split is real and must be respected by the client: a parent may
read `/learning/*` for a verified child *(probed: 200)*, but
`/assessment/answers` is `requireSelfLearner` — **nobody answers on a learner's
behalf.** A UI must never offer a parent an "answer for my child" affordance.

### 16.3 What already works end to end *(probed)*

Called as seeded `student` / `teacher` / `parent` / `admin`, password `demo1234`:

- `GET /learning/next-step?textbookKey=…` → `REVIEW` with `rule:"spaced_review_due"`,
  a human `rationale`, and **embedded `resources[]`** — so a lesson screen gets
  its material without touching the author-only content API. 
- `GET /learning/path?textbookKey=…` → `progress` rolled up at overall/unit/lesson
  level, `path[]` of nodes carrying `state`, `effectiveMastery`, `masteryThreshold`,
  `blockedBy`, and `currentConceptKey`. **This is a Duolingo-style path, server-computed.**
- `GET /learning/mastery`, `/completion`, `/flashcards` → all 200.
- Attempt loop: `POST /assessment/attempts` → `GET …/next-item?conceptKeys=…` →
  `POST /assessment/answers` → graded verdict + misconception diagnosis.
- `GET /instruction/due-work` → **`academic[]` and `advisory[]` already arrive as
  separate arrays** with a summary. §11 of this document is directly supported
  by the payload shape; the UI cannot accidentally merge them without effort.
- `GET /engagement/xp` → `totalXp`, `level`, `intoLevel`, `toNextLevel`, `currentStreak`.
- Teacher, given `schoolId`: `/analytics/cohort`, `/remediation/tracker`,
  `/engagement/leaderboard` all 200.
- Parent, given a `learnerKey`: all four delegated reads 200.

**Conclusion: Phase 2's student loop is buildable today** — except that the
client cannot obtain the keys those calls require. Hence §16.4.

### 16.4 BLOCKING GAPS — discovery, not capability

Each was probed and returned `404 route.not_found` or `400 request.invalid_input`.

| # | Gap | Probe result | Blocks |
|---|---|---|---|
| **G1** | **No learner textbook/subject list.** `learning/textbooks`, `content/textbooks`, `learning/subjects`, `learning/enrollments` all 404. `GET /learning/path` without `textbookKey` → 400. | *(probed)* | Every student screen. Phase 2 cannot start. |
| **G2** | **No parent → children list.** `learning/children` 404. The data exists only at `GET /provisioning/guardians/:key/children`, which is `requireAdmin` — a parent calling it gets **403 `identity.provisioning_forbidden`** *(probed)*. | *(probed)* | All of Phase 4. A parent cannot reach their own child. |
| **G3** | **No teacher roster / class list.** Every staff analytic requires `schoolId`, and `gradeId`/`termId` to narrow it. `schoolId` **is** available from `/auth/me` role grants, but `gradeId`/`termId` are not obtainable anywhere. `instruction/plans` has no list endpoint (404). | *(probed)* | Phase 3 teacher landing page. |
| **G4** | **No learner exam/assessment list and no attempt history.** `assessment/exams`, `content/exams`, `learning/exams`, `assessment/attempts` all 404. A learner cannot see what exams exist or what they scored before. | *(probed)* | "Exams" and "Results" nav items. |
| **G5** | **`/auth/me` omits the display name.** Returns only `userKey`, `roles`, `learnerKey`. `fullName` ("طالب تجريبي") is returned by **login** but not by `me`, so it is lost on refresh unless the client caches it. | *(probed)* | App shell header on every page, every role. |

**None of these is a product decision.** Each is a missing read model over data
that already exists, and each has an obvious canonical owner (G1/G4 → Learning
or Content read port; G2 → Identity, exposing the existing guardian-link query
to the guardian themselves; G3 → Identity/Instruction; G5 → one field on an
existing response). Per the standing "do not defer missing backend
capabilities" rule these should be closed **before** Phase 1 UI work, not
worked around in React.

**They must not be worked around.** The temptation is a hardcoded
`EDU-MATH-G07-T1-ED2026` in a constants file, exactly as the check scripts do.
That would make the frontend's correctness depend on the seed — the
"hidden seed-only dependency" the completion criterion names.

### 16.5 Non-blocking observations

- **`schoolId` is a raw UUID** in every analytics query, while the rest of the
  API speaks business keys (`sch_demo`, `EDU-MATH-…`). The client can get it
  from `/auth/me`, so this is not blocking, but it is an inconsistency worth
  settling before it spreads into every teacher URL.
- **`GET /content/concepts/:key/resources` is `requireAuthor`.** Learners get
  resources embedded in `next-step`, so there is no gap — but a lesson page
  that wants resources for an arbitrary concept has no learner-safe route.
- **`next-item` requires `conceptKeys` as a query parameter** and 400s without
  it. Workable (the client holds them from the path), but it means the attempt
  does not remember its own scope — worth revisiting if exams get a UI.

### 16.6 Defect found and fixed during this audit

**The learner payload leaked the answer.** `GET /assessment/attempts/:key/next-item`
returned each choice with its `misconceptionKey`, which is only ever set on a
*distractor*. On the seeded four-option question, three choices were tagged —
so the untagged one was the correct answer, derivable without reading the stem.

Root cause: the use case stripped `irt` and `conceptLinks` with a rest-spread,
which removes only what it names and passes everything else through. Replaced
with an explicit allow-list (`toLearnerSafe`), so a field added to
`QuestionView` later is withheld by default. The diagnosis is still returned
**after** grading, in `submit-answer` feedback, so remediation is unaffected
(`check-misconceptions` 14/14, `check-remediation` 58/58 after the change).

Covered by `tests/unit/learner-safe-question.test.ts`, which asserts over the
**serialised** payload — a field can be absent from a type and present at
runtime, and it is the runtime object that reaches the browser. Mutation-tested:
restoring the leaky spread fails the test.

This is recorded here because it is the clearest possible argument for §1 of
this document: the frontend must be handed *only* what a learner may see, and
that filtering is the backend's job.

### 16.7 Proposed build order

Phase 0 is complete with this section. **Phase 1 must be preceded by a short
backend slice closing G1–G5** — five read models, no new domain rules:

0. **Backend discovery slice** — G5 (`/auth/me` name), G1 (learner textbooks),
   G2 (parent children), G3 (teacher scope/roster), G4 (exams + attempt history).
1. **Phase 1 foundation** — Vite/React/Tailwind/shadcn, tokens, RTL, API client,
   auth, shell, the five states from §5.2.
2. **Phase 2 student loop** — the smallest honest vertical slice remains the one
   §14 already recommends: shell → `next-step` → answer → mastery invalidation.
   It is proven working over HTTP today.

Phases 3–7 as specified in the master brief, unchanged.

### 16.8 Gates still open

The five product decisions in §14 (dark mode, digit style, bottom-nav
destinations, offline expectations, Android intent) remain **unanswered** and
are still required before Phase 1. Two are structural: dark mode determines
token shape, and digit style determines the formatter contract.

---

## 17. THE ADOPTED DESIGN MODEL (owner's ruling, 2026-09-12)

Recorded because it settles questions §2 and §14 left open. The template is
**fixed**; this is not a theme choice.

| Layer | Adopted | What we take |
|---|---|---|
| Technical/visual base | **shadcn/ui + Tailwind + TypeScript** | Component foundation, headless primitives |
| Identity | **Edu7 design tokens** | Colour, type, spacing, mastery + status scales |
| App shell | **Shadcn Admin pattern** | Sidebar, header, command, notifications, mobile nav |
| Learning + progress UX | **Khan Academy** | Mastery-oriented progress, journey, next action |
| Learning path | **Duolingo** | Visual sequential path, practice/review loops |
| Next step + adaptation | **ALEKS** | Explicit "what to do next" guidance |
| Early learner (براعم) | **Khan Academy Kids** | Low density, large targets, immediate feedback |
| Work and deadlines | **Moodle** | Today/upcoming, due work, operational teacher views |
| AI + interactive | **EduSync** | AI tutor, interactive activities, voice, live |
| Staff analytics | **Tremor-style** | KPIs, charts, trends, distributions |

**The constraint that governs all of it:** these are *pattern* sources. The
educational behaviour is Edu7's and comes from the backend. We are not building
a copy of any of them, and the student dashboard does not become an analytics
dashboard.

**The backend is not rebuilt to fit the template.** Where the UI needs a
capability that does not exist, it is recorded as a gap (§16.4 method) and
decided case by case: add an endpoint/use case, or defer the feature. It is
never faked in React.

### 17.1 Phase 1 — delivered

Built in `web/`, a sibling of `src/`, with its own `package.json`.

| Area | Files | Notes |
|---|---|---|
| Tokens | `design-system/tokens/tokens.css` | Semantic only; light + dark defined together; mastery, work-status and advisory scales separate |
| Primitives | `design-system/ui/` | `button`, `card`, `badge`, `skeleton`, `cn` |
| States | `design-system/patterns/data-states.tsx` | Loading, Empty (empty vs filtered), Error, Forbidden, Offline, **AbsentValue** |
| Shell | `design-system/layout/` | `app-shell`, `sidebar`, `navigation-drawer`, `user-menu`, `navigation` (data), `nav-icon` |
| API | `shared/api/` | `client` (only `fetch` in the app), `errors`, `error-messages`, `query-keys` |
| Session | `shared/auth/session.tsx` | In-memory access token; httpOnly refresh cookie |
| i18n | `shared/i18n/` | ar + en, `ar` default, direction derived from locale |
| Platform | `shared/platform/storage.ts` | The only `localStorage` access (FE4) |
| Theme | `shared/theme/theme.tsx` | `data-theme`, OS default, explicit override persists |
| Pages | `pages/sign-in.tsx`, `pages/placeholder.tsx` | Sign-in is the only real screen |
| Guard | `scripts/check-frontend-architecture.ts` | FE1–FE23 |

**Answers to the §14 gates, as implemented:**

1. **Dark mode — yes**, defined from the first commit as semantic pairs.
2. **Digits — Western**, via `numberingSystem: 'latn'`. Every key, score and
   page number in Edu7 is Western, and mixing numeral systems inside one Arabic
   sentence is harder to read than either alone. Reversible in one place.
3. **Bottom nav** — student: Home, Path, Review, Exams, Progress. Teacher:
   Dashboard, Classes, Assignments, Results, Interventions. Capped at 5, tested.
4. **Offline** — online-only for v1; `OfflineState` distinguishes unreachable
   from refused, so adding caching later does not change the error contract.
5. **Android** — not committed. The platform adapter and token indirection keep
   the door open at no present cost.

### 17.2 Verification performed

- `typecheck` clean; production build succeeds (351 kB JS / 111 kB gzip).
- **FE1–FE23 are the enforced frontend boundary set.** The newer rules explicitly forbid `education/admin`, require declared education-domain ownership, require role-scoped presentation routes, forbid free-text learner/entity identifiers, and require learner profiles to flow through provisioning. A rule that has never failed proves nothing.
- 23 focused tests. The single-flight refresh test is mutation-proven:
  removing the guard yields four concurrent refreshes instead of one.
- **Live against the running API through the Vite proxy:** sign-in returns real
  Arabic seed data; `/auth/me` restores the session; refresh works from the
  httpOnly cookie alone (the reload path); `learning/next-step` returns
  `PRACTISE` on a real concept; a 403 arrives as `analytics.forbidden` and
  renders as a refusal rather than a crash.

### 17.3 One correction to §3 of the master brief

The brief's directory model lists `app/` inside `web/src/` for router and
providers, and separately an `app-shell.tsx` at that level. Implemented with
the shell under `design-system/layout/` instead, because the shell is a layout
primitive shared by every role, and FE6 has to be able to state that the design
system imports nothing from `features/` or `pages/`. Placing the shell beside
the router would have made that rule unenforceable. Everything else follows the
brief.

### 17.4 What Phase 2 still needs first

Unchanged from §16.4: **G1–G5 are missing backend read models**, and Phase 2's
data screens cannot be built honestly without them. Phase 1 deliberately needed
none of them, which is why it could proceed.

---

## 18. PHASE 2 — first learner screens (2026-09-12)

### 18.1 Terminology correction

`app.name` was **`إدو7`** — a transliteration of a Latin brand, and a non-word
in Arabic. It carries no meaning, cannot be read aloud naturally, and reads as
a typo. The rule now stated and enforced by review:

> **Latin product names are not transliterated.** The Arabic surface uses a
> descriptive name (`منصّة التعلّم الذكي`); the Latin wordmark stays Latin in
> both languages.

Other literal translations replaced with the terms schools actually use:

| Key | Was | Now | Why |
|---|---|---|---|
| `nav.classes` | الصفوف | **الشُّعَب** | الصفوف = grade-levels; a teacher's groups are شُعَب |
| `nav.interventions` | التدخّلات | **خطط الدعم** | clinical calque of "interventions" |
| `nav.textbooks` | الكتب | **الكتب المدرسيّة** | these are specifically textbooks |
| `nav.childLearning` | تعلّم ابني | **تعلُّم الطالب** | assumed a son |
| `nav.subjects` | الموادّ | **الموادّ الدراسيّة** | ambiguous: materials vs subjects |
| `nav.dashboard` | لوحة المتابعة | **لوحة المؤشّرات** | established term |

The `rule.*` keys follow the same principle: the backend's `rationale` is
accurate English developer prose and the wrong register for a learner, so the
seven decision rules are translated by **rule id** instead.

### 18.2 Sign-in follows the previous system

Kept, because the shape was right: two-panel layout, product explained beside a
compact form, theme and language reachable **before** authenticating, one
screen for every role with the role coming from the server session.

**Demo prefill is carried over with the rule that made it safe.** Clicking an
account fills identifier + password and **stops** — no `signIn`, no session, no
role selection. Authentication is always `POST /auth/login`. The module is
lazily imported behind `import.meta.env.DEV`; verified that `grep demo1234
dist/` finds nothing while the dev graph serves it.

**Dropped deliberately:** the registration tab and Google button (no such
endpoints exist — a tab that cannot work is worse than no tab), and the
psychometrics copy ("3PL IRT", "Bayesian Knowledge Tracing"), which addressed a
procurement panel rather than the teacher signing in.

### 18.3 Backend gaps closed

| Gap | Was | Now |
|---|---|---|
| **G1** | Every learner endpoint *took* a textbook key; nothing *returned* one | `GET /learning/textbooks` derives entitlement: current enrollment → school + year + grade + term → school's adoptions → publication gate |
| **G5** | `/auth/me` returned token claims only | Reads the account via the existing `UserRepository.findById` + `toAuthenticatedUser`, so `/me` and `/login` cannot describe a user differently |

G1's adoption scoping is the part worth keeping: "textbooks for the learner's
grade" is the obvious implementation and it is **wrong** — two schools in the
same year can adopt different editions of the same subject for the same grade.
Mutation-tested, as is the `isCurrent` filter.

G2 (parent→children), G3 (teacher roster) and G4 (learner exam list) remain
open and block the parent and teacher screens.

### 18.4 Defect found while building: absent mastery rendered as zero

A LOCKED concept came back with `attemptsCount: 0` and `effectiveMastery: 0`,
so `AbsentValue` — written precisely to stop "not measured" rendering as "0%" —
could never fire. **The UI would have told a learner they scored zero on a
concept the system deliberately never let them attempt.**

The subtlety is that one value served two purposes:

- **Gating** must treat absent as `0`, or an unmeasured prerequisite satisfies
  the readiness check and unlocks everything behind it.
- **Display** must not.

Only the `PathNode` mapping changed. Both halves are pinned: reverting display
to `?? 0` fails two tests; making gating `null` fails the typechecker.

### 18.5 Verification

- typecheck clean; build succeeds with the learner screens **code-split**
  (`dashboard` 4.9 kB, `learning-path` 2.5 kB) so staff never download them.
- **12/12 frontend rules**, **28/28 backend rules**, **811 backend tests**.
- Live through the Vite proxy as the seeded student: greeting by real name
  (G5), one textbook so **no picker is shown** (a picker with one option is a
  decision the interface pretends to offer), `PRACTISE → العنصر والانتماء`,
  progress 33%, and the LOCKED node rendering `لم يُقَس بعد` rather than `0%`.

### 18.6 Known flaw recorded, not silently fixed

`resolveLearnerAccess` calls `canReadAnyLearner(actor.roles)` with **no
schoolId**, and `hasRole` treats a null resource school as "scope is not a
meaningful constraint" — so a TEACHER in school A can read a learner in school
B through **every** learner-scoped route. Pre-dates this work. Not fixed in
passing: it needs the learner's school and a cross-school fixture, and the seed
has one school, so any fix would ship unproven. Documented at the call site.

---

## 19. THE AUTH SCREEN AND SELF-SERVICE REGISTRATION (2026-09-12)

### 19.1 Registration: a backend change that was in scope

§18.2 dropped the registration tab because no endpoint existed. The owner's
ruling clarified that a **core user journey missing its backend** is precisely
a case where the backend may be changed. It was built rather than hidden.

| Layer | What was added | Why not something else |
|---|---|---|
| Domain | `SELF_SERVICE_ROLES` + `validateSelfServiceRole` | "Which roles may a stranger claim" is a policy, not a route detail |
| Application | `RegisterAccountUseCase` | Different **authorization** story from `provisionUser`; identical **writing** |
| HTTP | `POST /auth/register`, `GET /auth/self-service-roles` | Public by necessity — the caller has no session |

**The write delegates entirely to `ProvisioningService.provisionUser`.** A
private user-creating branch would skip the uniqueness refusals, the profile a
role implies, the key derivation and the audit entry — each producing an
account that looks fine until something fails much later.

**`SELF_SERVICE_ROLES = STUDENT, TEACHER, PARENT.`** The exclusions share one
reason: a role with authority over *other people's* data cannot be
self-asserted. TEACHER is included because a freshly registered teacher reaches
nothing until an administrator enrols them — the role name carries no roster.

**No school may be named by the registrant.** `hasRole` reads a null school as
platform-wide, so a school chosen by the caller is a cross-tenant access
decision made by the attacker. Once a second school exists, registration
refuses outright (`identity.registration_requires_invitation`) rather than
guessing.

On success the user is signed in **through the ordinary login use case**, so a
registered session is indistinguishable from a signed-in one and there is no
second token-minting path.

### 19.2 The mark

Inline SVG, not an asset: it inherits `currentColor` so one drawing serves both
themes, stays sharp at any density, and costs no request on the screen that
must paint fastest.

**Seven ascending nodes on a connected path.** It reads as a learning path —
what this product actually models — and the seven nodes are the "7". The last
node is *ringed rather than filled*, the same language the path screen uses for
`currentConceptKey`, so the mark and the product agree.

Not a graduation cap or an open book: every education product uses them, they
say "school" rather than anything about this system, and a cap symbolises
**finishing**, the opposite of a mastery platform's premise. The mark is **not
mirrored in RTL** — a brand is a fixed shape.

### 19.3 Motion, and what was deliberately refused

Three effects, all on the brand panel: two blurred colour fields, a masked
grid, one slow drift. **Transform and opacity only**, so they run on the
compositor and never trigger layout or paint. The global
`prefers-reduced-motion` rule in `styles.css` stops them.

Refused: particle canvases, mouse-tracking parallax, animated gradient text.
They look impressive in a screenshot, cost real battery on the mid-range
Android phones this product's users carry, and delay first paint on the one
screen where speed is felt. New `--color-brand-*` tokens carry the panel, so it
themes correctly and FE2 stays enforceable.

The panel is `aria-hidden`: everything in it is repeated in the form heading,
so assistive technology goes straight to the work.

### 19.4 Verification

- 822 backend tests (11 new, privilege boundary **mutation-tested**: widening
  `SELF_SERVICE_ROLES` fails five), 28 backend rules, 12 frontend rules.
- Live through the proxy: PARENT registers → signed in without retyping →
  `/auth/me` returns the new identity → refresh works from the httpOnly cookie
  alone. Duplicate username **409**, `SCHOOL_ADMIN` **403**, unknown role
  **400**, injected `schoolKey`/`roles` fields ignored.
- Demo credentials still **absent from the production bundle**.

### 19.5 Two corrections to my own assumptions, recorded

Both were guesses that the system disproved:

1. `POST /provisioning/users/:key/deactivate` **does not exist** — the real
   surface is `POST /provisioning/users/status`, and `changeUserStatus` was
   always exposed. *Probe the route table before declaring a gap.*
2. Valid statuses are `ACTIVE | SUSPENDED | INVITED | ARCHIVED`. **`INACTIVE`
   is not one.**

And one genuine mistake: cleaning up probe accounts with a prefix
`deleteMany` cascaded into the seeded student and wiped all learner evidence.
Recovered with `npm run db:seed`. **Delete test data by exact key.**

---

## 20. VISUAL RICHNESS ON A SEMANTIC FOUNDATION (owner's ruling, 2026-09-13)

The owner's ruling after reading §DESIGN-SYSTEM-COMPARISON: **keep the new
architecture and the new semantic tokens, recover the old system's visual
character.** The new system was judged correct but at risk of becoming *flat* —
right for an admin console, wrong for a learning platform.

The target, in the owner's words:

> NEW ARCHITECTURE + NEW SEMANTIC TOKENS + OLD VISUAL RICHNESS +
> Khan Academy / Duolingo learning language + EduSync interactive feel

Explicitly **not** a return to `bg-slate-700`. Richness is rebuilt *through* the
token layer, which means it stays themeable, stays enforceable, and stays one
decision rather than 10,292.

### 20.1 The surface ladder is now real

Three layers, matching the owner's `Page Canvas → Surface → Elevated Surface`:

| token | used for |
|---|---|
| `canvas` | the page itself |
| `surface` | sections, lists, the ordinary card |
| `surface-raised` | dialogs, popovers, the one learning object that matters |

This was **declared but not real**: `--color-surface` and
`--color-surface-raised` were both `oklch(1 0 0)` — a measured contrast ratio of
**1.000**, the same white. Every dialog sat flat on the page.

Light mode has almost no room to build depth from lightness — the entire span
from `canvas` to pure white is a ratio of about **1.14**. So light mode spends
that little room on canvas-vs-surface, where a large flat area makes it
readable, and carries the rest with border and shadow. Dark mode has real
headroom and uses it (`0.155 → 0.205 → 0.255`).

`surface-hover` and `surface-raised-hover` are steps *along the same ladder*,
not tints: hovering lifts a surface toward the next layer. That is why a
hovering card and a hovering secondary button behave like one system.

### 20.2 Contrast is solved, not chosen — and FE13 enforces it

Every semantic tone has two real usages: as **text on its own `-subtle`
background**, and under **white text on the solid fill**. Choosing a
pleasant-looking mid tone silently fails one of them. Measured, before this
section:

| tone | as text on `-subtle` | white on solid |
|---|---|---|
| `warning` | 2.82 ✗ | **3.18 ✗** |
| `success` | 3.52 ✗ | 4.01 ✗ |
| `accent` | 3.86 ✗ | 4.43 ✗ |
| `advisory` | 3.96 ✗ | 4.50 ✗ |
| `info` | 4.14 ✗ | 4.67 ✓ |
| mastery scale (all five) | 2.04–3.43 ✗ | — |

Each light-theme tone is now the **lightest value that clears 4.5:1 in both
directions**, solved numerically rather than picked. All pass.

**FE13** parses `tokens.css`, converts every `oklch()` declaration to relative
luminance and computes WCAG ratios at build time. It also asserts the surface
ladder is a real ladder (adjacent layers must differ by >1.02), because that is
the bug that already happened once. Both halves were proven by mutation:
reverting `warning` to its old value and re-flattening `surface-raised` each
fail the build.

### 20.3 Buttons: three tiers, plus destructive

`primary` / `secondary` / `ghost`, with `danger` kept apart so it is never a
tier. The fifth variant, `spotlight`, was **deleted — it had zero usages**, and
its job is what `primary` at `size="lg"` already means.

Richness comes from elevation and feedback, not extra variants: `primary`
carries `shadow-sm → shadow-md` on hover, and every button gets
`active:translate-y-px` (1px, so it reads as feedback and not as the layout
moving), suppressed under `motion-reduce`.

### 20.4 Activity tones: five, for seven activities

Seven server activities previously collapsed onto three generic tones, so
**REMEDIATE and UNBLOCK were identical** and PRACTISE was indistinguishable
from LEARN. A learner could not tell "clear up a misunderstanding" from "a
prerequisite is missing" without reading.

Now five: `remediate` (warm orange), `unblock` (violet), `learn` (teal),
`practise` (blue), `advance` (green). REVIEW, ASSESS and PRACTISE share one
because all three are consolidation of material already met, and the icon and
verb separate them. Seven hues would be the rainbow soup that makes colour stop
carrying meaning.

REMEDIATE is deliberately **not** danger red. Needing support is not an error
state, and colouring it like one teaches a learner that being wrong is failure.

The table lives in `education/learning/activity-tone.ts` — one file, because a
learner and their parent looking at the same concept must see the same colour.
It briefly lived in two components and had already started to drift.

### 20.5 Education-aware components

`LearningObjectCard` is the shape the product needs — subject, title, mastery
state, progress, action — instead of Card + Title + Text + Button reassembled
per screen. Its **mastery rail** down the leading edge is why it exists: a flat
band of the mastery colour that makes a column of them scan as a progress
column. It is a logical inset, so it moves to the right in Arabic with no
second rule, and it is `aria-hidden` because `MasteryBadge` already says the
state in words (§42: colour is never the only channel).

The learning path gains the same rail plus a connector line running *behind*
the rows, so it reads as one sequence rather than a stack of cards — the
Duolingo shape, carrying the server's ordering and nothing of its own. The
current node is the only raised row: one focal point per screen.

`ProgressBar` takes an optional `tone` so a bar and its badge never disagree.

### 20.6 What was refused

Per the owner: no glass everywhere, no large gradients, no excessive shadows,
no bouncing cards, no decorative motion competing with reading. Ambient motion
remains confined to the auth showcase, transform/opacity only, and every
transition added here is suppressed under `prefers-reduced-motion`.

---

## 21. GAPS G3 AND G4 CLOSED — ALL FIVE CLOSED (2026-09-13)

| gap | endpoint | status |
|---|---|---|
| G1 textbooks | `GET /learning/textbooks` | ✅ |
| G2 children | `GET /learning/children` | ✅ |
| G3 roster | `GET /analytics/roster` | ✅ |
| G4 history | `GET /assessment/attempts` | ✅ |
| G5 identity | `GET /auth/me` | ✅ |

### 21.1 G3 — a roster is a scope, not a stored class

Edu7 has **no class or section model**, by decision: *a class is a query* over
current enrollments. The roster endpoint therefore takes a scope (school, and
optionally grade and term) and resolves it. There is no class id, and the UI
does not invent one.

`rosterInScope` is a **second method** on `AnalyticsReader`, not a widening of
`learnersInScope`. That one feeds every cohort computation and must stay a
one-column read; this one joins the user and the grade because a teacher needs
to see people, not keys. Ordered by grade ordinal then name, because Postgres
gives no ordering guarantee without an `ORDER BY` and a roster that reshuffles
between loads cannot be read down.

Authorization is `requireRoles(actor, STAFF_ROLES, input.schoolId)` — roles are
school-scoped, so a teacher asking for another school's roster is refused by
the same gate the cohort report uses. Verified live: student **403**, parent
**403**, other school **403**.

**Honest limit, shown in the UI rather than only in a comment:** the roster is
school-and-grade scoped, not teacher-and-subject scoped, because no
teaching-assignment model exists. Every teacher at a school sees the same grade
roster. `teacher.scopeNote` says so on the screen — otherwise a teacher would
read the list as "my students" when it is "this grade".

### 21.2 G4 — history excludes what is still in progress

`AttemptHistoryReader` is separate from `AttemptRepository`: that is the
write-side aggregate used while an attempt runs, this is a paged read model for
a list. Merging them would put a projected query on the interface
`start-attempt` and `submit-answer` depend on.

Two rules carry the weight, both mutation-proven:

- **`IN_PROGRESS` is excluded.** An attempt being sat is not history, and it
  would render with a null score — so a learner would see the exam they are
  *currently taking* listed as though it had gone badly. Verified live: 0 rows
  while in progress, 1 row after submit.
- **The stored totals are the result.** Re-deriving a score from `AttemptItem`
  rows would be a second grading implementation that diverges the first time
  partial credit changes. The test plants a `correctCount` that disagrees with
  `score` to catch exactly that.

`score: null` means *not graded* (ABANDONED, EXPIRED) and renders as
`AbsentValue`, never 0%. A learner who walked away did not score zero.

`limit` is clamped server-side at 50; `limit=999` returns **400**.

### 21.3 Dashboard hierarchy

The page is now the four questions a learner asks, in order:

1. **What do I do now?** — the next-step card, the only raised element
2. **Where have I got to?** — progress and mastery, flat, supporting
3. **What have I done?** — recent finished attempts (G4), five rows
4. **Where does it lead?** — one link to the path, not a second copy of it

One focal point per screen: if every card is elevated, none of them is.

### 21.4 `formatDate` — Gregorian in both locales

`ar-YE` is free to resolve to the Islamic calendar and to Eastern Arabic
numerals. Academic years, terms and exam schedules are all administered in
Gregorian dates, so a Hijri date against a Gregorian timetable is a conversion
the learner has to do in their head. `calendar: 'gregory'` and
`numberingSystem: 'latn'` are set explicitly, matching the existing digit rule.

---

## 22. ADMINISTRATION, AND TWO REAL BUGS FOUND BY RENDERING (2026-09-13)

### 22.1 G6 — the user directory

A sixth gap, found while building the administration screens: there was **no
way to list or search users**. `GET /provisioning/users/:userKey` existed, so
an administrator had to already know a key — which made "who is in this
system" unanswerable and every administration screen unbuildable.

`GET /provisioning/users` now takes `search`, `role`, `status`, `schoolKey`,
`limit` and `offset`, and returns rows plus a **true total** so the pager does
not have to guess. Three rules, all mutation-proven:

- **A role filter is a predicate on the grants** (`roles: { some: … }`), not a
  filter on the included rows. Filtering the include would return every user
  and merely hide their roles — wrong rather than empty, which is worse.
- **Ordered by username**, which is unique. Paging over an unordered query
  skips and repeats rows; Postgres guarantees nothing without `ORDER BY`.
- **`limit` is clamped in the service, not only at the route.** The route
  protects the wire; the service protects every other caller.

The UI offers suspend, reinstate and archive — and **no delete**, because the
provisioning router has none by design: a person who has answered a question is
part of the evidence record. Archive is confirmed inline, being one click from
suspend and the action that removes someone from every working list.

### 22.2 The student page "not opening"

It was opening. The dev servers were running inside the agent sandbox without a
published preview, so nothing reached the user's browser. Restarting them as a
managed preview process fixed the access problem — no application code was
involved.

But rendering the app in jsdom against the live API, rather than only probing
endpoints with curl, found **two genuine bugs that every endpoint test had
passed**:

**1. A teacher was told they had no school.** `adoptSession` maps the login
response's bare role names to `{ role, schoolId: null }`. `schoolIds` was
therefore empty immediately after sign-in, and the roster screen honestly
reported "no school is linked to your account" — until a reload, where the
restore path fetches `/auth/me` and gets the scoped grants. Sign-in and reload
must produce the same session, so `adoptSession` now refines the scope from
`/auth/me` too. Failure there is silent: the session is already valid.

**2. A parent saw "unavailable" where their child's progress belonged.**
`useJourney` put `learnerKey` in the **query key** but never passed it to the
fetcher. The request therefore asked for the caller's own journey, and a parent
is not a learner. The endpoint was correct throughout; only the client was
wrong, which is exactly the class of bug an API probe cannot see.

Both are the same lesson: **an endpoint returning 200 does not mean the screen
works.** Verification now renders the real app, signs in as each role, and
asserts what the page actually says.

### 22.3 Role landing, verified

Each role signs in and lands on a working screen, with zero runtime errors:

| role | lands on | shows |
|---|---|---|
| student | `/` | next step, progress, recent work |
| teacher | `/teacher` | roster, 1 learner |
| parent | `/parent` | child, focus concept, 49% progress |
| admin | `/admin` | directory, 6 accounts, filters |
| author | `/author` | placeholder (Phase 2, honest) |

---

## 24. THE STUDENT PAGE THAT "WOULD NOT OPEN" — A COOKIE, NOT A PAGE (2026-09-13)

Reported three times. Twice I checked the wrong thing and declared it fixed.

`curl http://localhost:5173/` returned 200. Rendering the whole app in jsdom,
signing in as the student, produced the complete dashboard with **zero**
console errors. Every endpoint answered. By every check I had, the page worked
— and the user still could not use it.

**The checks were wrong, not the report.** `curl` and jsdom have no same-site
cookie policy. A real browser does, and the preview is the one context where it
bites: the app is served over **HTTPS** and embedded as a **cross-site
iframe**.

The refresh cookie was issued `HttpOnly; SameSite=Lax` with no `Secure`. A
browser **silently withholds a Lax cookie in a cross-site context**. So:

- sign-in succeeded and the in-memory access token worked for a few minutes;
- the cookie was either rejected outright or never sent back;
- the restore path called `/auth/me`, the refresh 401'd, and the session
  cleared — bouncing the user to sign-in on every reload;
- **nothing logged an error**, because a withheld cookie is not an error. It
  is the browser behaving exactly as specified.

### 24.1 The fix

`SameSite` cannot be a constant, so it is now decided per request:

- `COOKIE_SAMESITE` (`lax` | `none`, default **`lax`**). Cross-site cookies are
  a genuine CSRF surface and must be opted into, never defaulted on.
- `SameSite=None` is emitted **only** over a secure connection and **always**
  with `Secure`. `None` without `Secure` is rejected by every modern browser —
  strictly worse than `Lax`, because the user ends up with no cookie at all —
  so that combination is downgraded to `Lax` rather than shipped broken.
- `app.set('trust proxy', 1)`. Behind a TLS-terminating proxy Express sees
  plain HTTP while the browser sees HTTPS, so without this `req.secure` is
  always false and the Secure decision is always wrong. Scoped to **one hop**:
  trusting every hop lets a client forge `X-Forwarded-For` and poison the IP
  recorded on a session.
- `clearCookie` repeats the same attributes. Removal matches on
  name+path+secure+sameSite, so a mismatched clear leaves the cookie behind.

### 24.2 Proof

Five unit tests in `tests/unit/refresh-cookie.test.ts`, including an exhaustive
check that **no** configuration can yield `None` without `Secure`.
Mutation-proven twice: restoring the original always-`Lax` behaviour fails a
test, and allowing `None` on an insecure connection fails a test.

Over the wire:

| request | cookie emitted |
|---|---|
| HTTPS, preview host | `HttpOnly; Secure; SameSite=None` |
| plain HTTP | `HttpOnly; SameSite=Lax` |

And the reload path end to end: login → capture cookie → `POST /auth/refresh`
with only that cookie → **200, new access token issued**.

### 24.3 The lesson

**A green check against `localhost` is not evidence about the user's browser.**
`curl` ignores same-site policy; jsdom ignores it; both said the page was fine
while it was unusable. When a user reports a failure I cannot reproduce, the
reproduction is wrong until it reproduces — the report is data, not noise.
