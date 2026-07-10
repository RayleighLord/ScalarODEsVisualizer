# AGENTS.md

## Project Purpose

This project is an interactive website for exploring scalar first-order ordinary differential equations of the form `y' = f(t, y)`. It is a static Vite site deployed through GitHub Pages and must remain usable without a backend.

The current product goals are:

- Show a `t-y` grid.
- Let the user choose visible axis limits.
- Let the user enter the ODE right-hand side `f(t, y)`.
- Draw slope markers so the flow direction is visually apparent.
- Plot the integral curve through any clicked point in the plot.
- For autonomous equations, detect isolated equilibrium levels and equilibrium intervals; show them as horizontal lines or shaded horizontal bands.
- For autonomous equations with visible isolated equilibria, optionally show a phase-flow rail with arrows along the `y` direction.

## Engineering Expectations

- Keep the implementation maintainable, modular, and easy to extend.
- Prefer clear separation between UI, math/parsing, solver logic, and rendering.
- Preserve static-site compatibility.
- Avoid introducing unnecessary complexity for basic interactions.
- Keep GitHub Actions CI in place so tests run automatically on pushes and pull requests, and make deployments depend on passing tests.

## Current Architecture And Performance Invariants

- Treat `src/math/parser.ts` as the stable public facade for expression compilation. Parser implementation details live in `src/math/expression/`, with supported functions centralized in `catalog.ts` and separate modules for syntax, evaluation, diagnostics, domain analysis, intervals, and LaTeX.
- Do not introduce `eval`, `new Function`, or another runtime code-generation path for user expressions.
- Preserve semantic autonomy detection. Algebraically canceled time dependence such as `t - t` may be autonomous, but simplification must not erase genuine domain restrictions such as the hole in `0 / t` or `0 * t^-1`.
- Compile the AST evaluator once per expression and prepare diagnostic evaluation once per numerical pass, then reuse it throughout that equilibria scan, slope-field render, phase-flow analysis, or solve. Avoid reparsing or rebuilding evaluators in numerical inner loops.
- Keep segment-domain checks conservative but bounded. They must detect sign-changing, even-order, paired, and oblique undefined barriers without inventing barriers for safe correlated or exactly canceled expressions.
- `EquilibriumResult` can contain both isolated `levels` and continuous `intervals`. Do not approximate a continuous equilibrium interval with a large collection of individual roots.
- Treat an equation as zero everywhere only when an exact, domain-safe identity proves it. A small nonzero constant is not an all-equilibria equation.
- Equilibrium detection must reject poles, retain even-multiplicity roots, and represent exact zero continua as intervals.
- The phase-flow rail is for isolated equilibrium levels and is suppressed when equilibrium intervals are present. Its directional bands must respect singular domain gaps, and marker stability must use local probes so a remote singularity cannot change the classification.
- Despite the legacy filename `src/solver/rk4.ts`, the solver is adaptive Dormand-Prince RK45 with an embedded error estimate and FSAL derivative reuse. Do not replace it with fixed-step RK4 based on the filename alone.
- Keep solver outcomes distinct: a domain singularity, a non-domain invalid value, a visible-boundary exit, and accuracy-driven `step-underflow` are different termination cases.
- `AppController.applyUpdate` is the atomic state-transition API. Related expression, bounds, clear, and phase-flow changes should be batched so expensive derived state is invalidated at most once and listeners see one final update.
- Preserve controller caches and selective invalidation. Adding one seed should solve only the new curve; toggling an overlay or clearing curves should not recompile the expression, rescan equilibria, or solve unrelated trajectories.
- Expression input is debounced. Bounds submission, clear, and phase-flow changes must batch any pending expression into the same controller update. A plot click must commit the pending expression before validating, snapping, or solving its seed. An expression-only publish must not overwrite axis-limit edits the user has not submitted yet. Same-expression no-ops must still restore the `Ready` status and clear `aria-busy`.
- The plot renderer uses retained, dependency-keyed SVG layers. Reuse unchanged grid, direction-field, equilibrium, phase-flow, curve, and KaTeX nodes instead of rebuilding the complete plot on every update.
- Grid and direction-field geometry should remain compact SVG paths. For autonomous equations, evaluate a slope once per visible `y` row rather than once per marker.
- Responsive resize should reposition existing HTML/KaTeX annotations; it should not rebuild unchanged SVG geometry or annotation nodes. Adding a curve should retain all existing curve groups and append only the new group.

## Established UI And UX Preferences

- Prefer a light, pleasant, exploratory visual style over a dark theme.
- Use a polished light palette with some personality; avoid plain default styling.
- Avoid odd or heavy blue washes behind the plot; prefer softer, more pleasant plot backgrounds.
- Keep the left control panel readable and compact.
- On a typical laptop-sized desktop viewport, the main controls should be visible without requiring inconvenient scrolling.
- Outer top and bottom margins should adapt to window size and stay modest on larger screens rather than leaving large empty bands.
- Do not regress the top headers out of view when tuning layout density.
- Each integral curve should use a distinct color from a broad, rich palette, with enough variation that multiple curves remain distinguishable.
- Slope-field segments should be rendered in a light black/gray tone.
- Equilibrium lines should be solid black, without dashes.
- Equilibrium solutions should read clearly as black thick horizontal lines, and the UI should make that meaning explicit.
- The phase-flow rail for autonomous ODEs should appear on the left side of the plot area.
- The phase-flow rail should be controlled by a toggle option in the UI, not always forced on, and should be off by default.
- The explanation for equilibrium solutions should live in the lower-left status area rather than in the plot header.
- When shown, the phase-flow rail should sit on top of the left edge of the plot rather than floating away from it.
- The phase-flow panel should be fully opaque and should render above plotted curves and lines rather than letting them show through it.
- Phase-flow equilibrium markers should encode stability: filled circle for stable, hollow circle for unstable, and half-filled circle for semistable.
- Keep the overlay toggle label concise; prefer `Show phase flow` over longer wording.
- Avoid unnecessary utility headings such as `Session tools` when the buttons are self-explanatory.
- Describe equilibrium lines in a polished way, not bluntly.
- The `Show phase flow` label should fit on a single line.
- Do not keep a separate `Plot overlays` header if the toggle itself is self-explanatory.
- In the `Equilibria` area, list the actual equilibrium solutions instead of only reporting how many were detected.
- Keep overall sizing slightly compact so the controls still fit within one viewport when possible.
- Use `Direction field` as the correct plot naming; do not label the plot as `Phase portrait`.
- Show a rendered LaTeX version of the current ODE above the diagram.
- Use LaTeX rendering where it adds clarity for equations and mathematical symbols in the UI.
- Make the rendered differential equation visually prominent and pleasant, not tiny or incidental.
- Plot numbers and axis labels should also use LaTeX styling.
- Plot numbers and axis labels should be visually a bit larger rather than delicate or tiny.
- X-axis labels and the `t` label should sit low enough to avoid clashing visually with the slope field.
- Changing the window size must not leave the plot ticks or axis labels misaligned; responsive resizes should preserve their correct positions.
- Prefer a flatter, cleaner plot background over decorative color washes when the latter do not look good.
- Use a crosshair cursor over the clickable plotting region so its point-selection behavior is immediately apparent.
- Clicking should feel forgiving: snap near important targets such as equilibrium lines and visible axes when that improves usability.
- Equilibrium-line snapping should be gentler than general axis snapping so clicks near a fixed line do not attach too aggressively.
- If the phase-flow rail is shown, it should feel visually integrated with the plot rather than like a separate bright widget.
- Toggling the phase-flow overlay should not cause the x-axis labels or `t` label to jump vertically.

## Visual Verification Workflow

- For UI/layout changes, do not rely only on code inspection.
- Use browser-based visual inspection as part of the feedback loop.
- Prefer Playwright-based verification for layout-sensitive changes.
- Check realistic desktop/laptop viewports such as `1180x780` and `1440x900`, not only large screens.
- Run `npm run test:browser` for changes that affect interactions, rendering, responsive layout, expression editing, or production assets. The smoke script builds the production site before exercising it in Chromium.
- Use `output/playwright/browser-smoke.png` as a quick artifact check, but still inspect a headed browser when making substantial visual changes.
- When adjusting layout, confirm that the actual rendered page matches the intended result before considering the task complete.

## Current Interaction Expectations

- Clicking inside the plot adds an integral curve through that point.
- Multiple curves may remain visible simultaneously until cleared.
- Autonomous fixed-point behavior should remain easy to interpret through both equilibrium lines and the optional phase-flow rail.
- Continuous families of equilibrium solutions should appear as restrained shaded bands and be listed as intervals in the lower-left status area.
- Integral curves for ODEs with singular terms should stop near undefined barriers rather than overshooting or crossing onto an invalid branch.

## Development, Testing, And Deployment

- Use Node.js 24 through `.nvmrc`; `package.json` supports Node `>=22.12.0 <25`. Use `npm ci` for reproducible installs.
- Use `npm test` for the fast Vitest suite, `npm run typecheck` for TypeScript-only validation, `npm run build` for the production build, and `npm run test:browser` for the production Chromium smoke suite.
- Add focused regression tests whenever changing parsing precedence, domain semantics, equilibrium classification, adaptive stepping, controller invalidation, retained rendering, or debounced form behavior.
- The browser smoke suite intentionally checks node retention, batched/debounced edits, invalid expressions, equilibrium intervals, canceled domain dependencies, and annotation alignment after resize. Keep those checks deterministic rather than weakening timeouts to hide a race.
- GitHub Actions is consolidated in `.github/workflows/ci.yml`. Pull requests test and build without deploying; a push to `main` uploads the already-tested `dist` artifact and deploys it from a dependent `deploy` job.
- Do not reintroduce a second Pages build workflow without a specific reason. Building independently for deployment duplicates work and can deploy an artifact different from the one exercised by browser smoke tests.
- Preserve Vite's relative `base: "./"` so the static build works at the repository subpath on GitHub Pages.
- The Vite KaTeX transform deliberately retains only modern WOFF2 fonts. If KaTeX or its CSS changes, verify both equation rendering and production bundle size.
- Keep generated builds, caches, and browser artifacts out of version control: `dist/`, `.vite/`, `.playwright-cli/`, `output/playwright/`, and showcase Playwright logs are ignored.

## Showcase Videos

- Showcase videos should use a visible cursor or cursor overlay so mouse motion and clicks are clearly seen.
- If the equation is typed during a showcase, the visible cursor should not cover the typed expression.
- Early showcase clicks should demonstrate a variety of solution curves, not only equilibrium solutions.
- For quick window-adjustment demos, prefer a simple change such as extending `t max` to `6` rather than changing several bounds at once.
- When practical, render showcase videos at higher resolution.

## If Making Further UI Changes

- Re-check spacing, viewport fit, and readability after every substantial CSS/layout change.
- Favor changes that preserve discoverability of the controls while keeping the plot visually prominent.
- Treat layout regressions as real bugs even if typecheck/tests still pass.

## Maintaining This File

- If the user gives a new instruction that complements, refines, or contradicts this file, update `AGENTS.md` accordingly.
- Prefer editing existing guidance when the new instruction supersedes prior guidance, instead of leaving conflicting rules in place.
