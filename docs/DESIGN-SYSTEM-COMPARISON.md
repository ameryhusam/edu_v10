# The token system, and why the layout differs from the old UI

Written 2026-09-12, in answer to three direct questions. Every number below was
measured against the two codebases in this repository, not recalled.

This is a comparison document, not a redesign proposal. The old system's
choices were mostly reasonable for what it was; two of them were load-bearing
mistakes, and those are the ones that changed.

---

## 1. Which token system is in use

**Tailwind v4 CSS-first `@theme`, with semantic-only names, in
`web/src/design-system/tokens/tokens.css`.**

Three rules define it:

| Rule | Example | What it prevents |
|---|---|---|
| Semantic names, never palette names | `--color-danger`, not `--color-red-500` | A component that asks for "red" has already decided what the colour *means* |
| Both themes declared together | `:root` and `[data-theme='light']` side by side — dark is the base now, light the remap | Retrofitting dark mode over literal colours is a rewrite |
| Separate scales for separate meanings | mastery ≠ work-status ≠ advisory | Being late is administrative; being weak at a concept is pedagogical |

Colours are `oklch()`, which matters for one practical reason: it is
perceptually uniform, so `oklch(0.55 …)` and `oklch(0.72 …)` differ by a
predictable amount of *apparent* lightness. With hex, hand-picking a dark-mode
counterpart that keeps the same contrast is guesswork.

*(Updated 2026-09-14: the old system's look was cloned back in, on purpose —
same slate surfaces, emerald accent, aurora backdrop and Cairo face, now
expressed as this system's semantic values. The arrangement also flipped:
dark is the base theme and light is the remap, which is the inverse of the
old system's mechanism and identical to its intent. The numbers below were
measured before the re-skin and describe the mechanisms, not the current
palette.)*

Enforcement is mechanical, not editorial: **FE2 fails the build** on any hex,
`rgb()`, `hsl()` or px font-size outside the token file.

---

## 2. Measured comparison with the old project

Counted across `src/components/` (old) and `web/src/` (new):

| | Old (EduInsight «Nebula») | New |
|---|---|---|
| Palette-name classes in components | **10,292** | **0** |
| Distinct palette tokens in use | **206** | — |
| Semantic token usages | **0** | **176** |
| Distinct semantic tokens | — | **30** |
| Theme mechanism | Re-map the **palette scale** | Re-map **semantic values** |
| Colour space | hex | `oklch()` |
| Guard | none | FE2 fails the build |

### What the old system actually did

`src/index.css` is genuinely clever, and the header says so plainly: every
Tailwind utility compiles to `var(--color-slate-900)`, so light mode is
produced by **redefining the slate scale itself**:

```css
[data-theme="light"] {
  --color-slate-100: #1e293b;   /* was near-white text → strong ink */
  --color-slate-900: #ffffff;   /* card surface */
  --color-slate-950: #eef2f8;   /* page canvas */
}
```

One stylesheet flips 1,228+ usages with no component edits. As a retrofit onto
a large dark-only codebase, this is the right move — it is the cheapest
possible path to a second theme.

### Why it was not carried forward

**The semantic layer existed and no component used it.** `index.css` defines
`--color-canvas`, `--color-surface`, `--color-ink`, `--color-accent-ink`. The
measured usage of those names across all components is **zero**. Components
were written against `bg-slate-900` instead, so the semantic layer was
decorative.

That produces three concrete consequences:

1. **`slate-100` means "near-white text" in dark and "strong ink" in light.**
   The name is now actively misleading, and the comments in `index.css` have to
   explain it inline. A reader must hold the inversion in their head.
2. **206 distinct tokens is not a system, it is a vocabulary.** Nothing stops
   the 207th. Two components solving the same problem reach for
   `slate-800` and `slate-700` and both look fine.
3. **The inversion only works while every colour participates.** A single
   hardcoded `#10b981` is invisible in dark mode and unreadable in light, and
   nothing catches it.

The new system inverts the dependency: components name **meanings**, the token
file owns **values**, and dark mode changes only the value table. The cost is
that it only works if applied from the first commit — which is exactly why it
was done at the first commit, and why the same approach would have been
unreasonable to retrofit onto the old codebase.

### What was deliberately kept

- **`[data-theme]` on the document element.** Same mechanism, same reason: one
  attribute, no flash, no per-component branching.
- **Dark as a first-class theme.** The old system treated dark as the base and
  light as the projection. The new one declares both, but the instinct that
  dark must not be an afterthought was correct.
- **The accent family.** Teal-leaning, in the same region as Nebula's emerald.
  Recognisably the same product.

---

## 3. Why the layout is not the same

### The honest part of the answer

**The old layout is not a sidebar layout.** `AppShell.tsx:77` says so
explicitly — the sidebar was removed and replaced with a horizontal `TabBar`,
and the `lg:mr-72 / lg:ml-72` content offsets were deleted with it. Meanwhile
`CANONICAL_UI_NAVIGATION.txt` still documents a sidebar with a 10-item admin
list.

So "the old UI" describes two different layouts depending on which file you
read. The new shell matches neither exactly, and that was a decision rather
than an oversight.

### What the new shell does

| Viewport | Old | New |
|---|---|---|
| Desktop | Top navbar + horizontal TabBar | Persistent sidebar (`ps-64`, logical inset) |
| Mobile | Same TabBar, horizontally scrolled | Bottom bar, ≤5 destinations |
| Overflow | Scroll the tab strip | Drawer (`<dialog showModal>`) |

Three reasons for the difference:

**1. Navigation was not role-scoped in practice.** Of 25 defined nav items,
**15 carry no `roles` filter at all** — they are visible to everyone. STUDENT
has 4 explicitly-scoped items and inherits 15 more. A student's navigation
therefore included administrative destinations. The new `destinationsFor` is a
role union with no unscoped fallback: a student sees 6 destinations, and
`/teacher` and `/admin` are absent by construction (tested).

**2. A horizontal tab bar does not survive Arabic at small widths.** Tab
labels in Arabic are longer than their English equivalents, and a strip that
must scroll horizontally on a phone hides destinations behind a gesture with no
affordance. The bottom bar caps at 5 with a drawer for the rest — the count is
enforced by a test, per role.

**3. The mobile-first constraint is different now.** The bottom bar reserves
`pb-[calc(5rem+env(safe-area-inset-bottom))]` so content is never covered, and
every target is ≥44px. The old TabBar was a desktop pattern made to fit a
phone.

### What was kept from the old layout, deliberately

- **Skip-to-content as the first focusable element.** The old shell had this
  and it was right.
- **`max-w-7xl` centred content.** Same measure.
- **Theme and language reachable before sign-in.** Copied directly.
- **One shell for every role.** The old system had this and it prevented four
  divergent layouts.

### The sign-in screen, by contrast, *is* modelled on the old one

Two-panel layout, product explained beside a compact form, demo prefill
buttons, controls in the header. That shape was right and was kept (§18.2,
§19). The divergence is in the application shell, not the front door.

---

## 4. Summary

| Question | Answer |
|---|---|
| Which token system? | Tailwind v4 `@theme`, semantic-only, `oklch()`, FE2-enforced |
| Biggest difference? | Old: components name **colours** (10,292 usages, semantic layer unused). New: components name **meanings** (0 palette usages) |
| Why? | A palette-inversion theme is the correct retrofit and the wrong foundation — it makes `slate-100` mean two opposite things and cannot be enforced |
| Why is the layout different? | The old shell had already dropped its sidebar for a TabBar; 15 of 25 nav items were unscoped so students saw admin destinations; and a horizontal strip fails on an Arabic phone |
| What was kept? | `[data-theme]`, dark as first-class, the accent family, skip-link, `max-w-7xl`, pre-auth controls, one shell per product — and the whole sign-in composition |
