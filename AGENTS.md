# AGENTS.md

## Product

This is a client-only Vite application for exploring scalar first-order ODEs. It must remain deployable as a static GitHub Pages site without a backend.

Use `y' = f(y,t)` in product-facing copy. Internal numerical APIs accept arguments as `(t, y)`; preserve that ordering in code.

The application provides a full-window direction field, live axis limits, integral curves through clicked points, autonomous equilibrium detection, and an optional one-dimensional phase-flow overlay.

Current defaults:

- Equation: `y * (2 - y)`
- Window: `t ∈ [-6,6]`, `y ∈ [-3,3]`
- Phase flow: off

## Architecture And Numerical Invariants

- `src/app.ts` owns DOM wiring, debouncing, and interactions. `src/ui/controller.ts` owns state, derived data, and cache invalidation. Plotting belongs under `src/plot/`, solving under `src/solver/`, and expression/equilibrium logic under `src/math/`.
- Keep `src/math/parser.ts` as the public expression facade. Syntax, evaluation, diagnostics, domain analysis, intervals, functions, and LaTeX remain separated under `src/math/expression/`. Never use `eval`, `new Function`, or runtime code generation.
- Preserve semantic autonomy and domain information. Cancellation such as `t - t` may remove genuine time dependence, but must not erase holes such as those in `0 / t` or `0 * t^-1`.
- Parse and compile once per expression. Prepare diagnostic evaluation once per numerical pass and reuse it in equilibrium searches, solving, direction fields, and phase-flow analysis.
- Domain checks must detect sign-changing, even-order, paired, and oblique undefined barriers without inventing barriers for safe correlated or exactly cancelled expressions.
- Equilibrium results may contain isolated `levels`, continuous `intervals`, or an exact all-equilibria result. Reject poles, retain even-multiplicity roots, and never replace a continuous interval with sampled roots. Only a domain-safe exact identity may establish that an equation is identically zero.
- Phase-flow analysis applies only to autonomous equations with isolated equilibria. Suppress it for equilibrium intervals; preserve singular gaps and classify stability using local probes.
- Despite its filename, `src/solver/rk4.ts` implements adaptive Dormand-Prince RK45 with an embedded error estimate and FSAL reuse. Preserve distinct termination outcomes for domain limits, singularities, invalid values, visible-boundary exits, step underflow, and other solver failures.
- Use `AppController.applyUpdate` for related state changes. Batch expression, bounds, phase-flow, removal, and clear intents so listeners receive one final update and expensive derived data is invalidated once.
- Preserve selective recomputation: adding a seed solves only that curve; removing or clearing curves and toggling overlays must not recompile expressions, rescan equilibria, or resolve unrelated curves.
- Expression edits are debounced and complete, valid finite bounds apply live. Bounds, clear, removal, and phase-flow actions must batch any pending expression into the same update. Plot clicks must commit a pending expression before validating, snapping, or solving the seed. Partial or invalid bounds must remain editable, and expression no-ops must restore the ready state.
- Keep dependency-keyed retained SVG layers. Grid and direction-field geometry should use compact paths. Adding or removing curves should retain unaffected groups; resize should reposition existing annotations and screen-compensated symbols without rebuilding unchanged geometry.
- For autonomous equations, evaluate the direction-field slope once per visible `y` row and reuse it across that row.

## UI And Interaction Contract

- Keep the application light-only. The off-white direction-field plane fills the viewport edge to edge; controls are compact floating cards, never a permanent sidebar, framed chart, or padded plot.
- Preserve fluid desktop control scaling against the 2560×1284 reference viewport: use `clamp(0.8, min(viewport width / 2560, viewport height / 1284), 1)` for the three corner control groups. Keep their corner anchors fixed, leave the centered equation pill unchanged, and use full-size controls for the mobile layout at 760px wide or less.
- Use faint neutral minor lines, quiet teal major lines, and stronger charcoal zero axes. Nice major spacing remains adaptive; the default window produces unit major intervals on both axes. Divide each major interval into five equal subdivisions.
- Sample short, thin gray direction marks at interior grid intersections so edge marks are not clipped.
- Render large KaTeX tick and axis labels inside the plotting plane beside the real zero axes. If zero is outside the window, clamp labels to the nearest edge without inventing an edge axis. Suppress the duplicate origin label and preserve alignment on resize.
- Keep the title/editor at top left, rendered equation pill at top center, two-row window controls at bottom left, and equilibrium information with `Show phase flow` at bottom right.
- The editor identifies the application as `Scalar Differential Equation`, includes the first-order-ODE eyebrow and rendered `y'=f(y,t)` hint, and uses a KaTeX `y'=` prefix. Keep generated LaTeX conventional; for example, put a whole-numerator minus before its fraction.
- Window controls place `t_{\min},t_{\max}` on one row and `y_{\min},y_{\max}` on the next, with KaTeX labels, Clear curves, and Reset.
- The equilibrium card shows the KaTeX criterion and actual constant solutions or intervals. Do not show a curve counter. Isolated equilibria are thick solid black lines; continuous families are restrained bands.
- Keep shortcut guidance in the small non-modal Help popover above the lower-left utility controls; do not add a permanent interaction panel.
- `Hide UI` hides the editor, window card, and equilibrium card while retaining the centered equation, plot, Help button, and restore control.
- Clicking adds a curve, with gentle snapping to axes and lighter snapping to equilibrium lines. Right-click near a curve removes it. `Shift` + right-click clears all curves. Keep the visible Clear curves alternative.
- Use a crosshair cursor and a broad, distinguishable trajectory palette. Curves near singularities must stop rather than cross undefined barriers.
- The optional phase-flow strip is opaque, full height, above curves, and centered on a visible `t=0` axis. Suppress it when `t=0` is outside the window. Use teal filled-head arrows and circular stable, unstable, or half-filled semistable markers; compensate for nonuniform SVG scaling.
- Use the term `Direction field`, not `Phase portrait`.

## Verification And Delivery

- Use Node 24 from `.nvmrc` and `npm ci`.
- Run `npm test`, `npm run typecheck`, and `npm run build`. Add focused regression tests for parser/domain behavior, equilibria, solver outcomes, controller invalidation, retained rendering, and debounced/live inputs.
- For rendering or interaction changes, run `npm run test:browser` and inspect the application in a real browser. Check `1180x780`, `1440x900`, `1536x730`, and `1920x1080`; treat clipping, overlap, scrolling, or annotation drift as bugs.
- Keep the single `.github/workflows/ci.yml` pipeline. Pull requests test and build; pushes to `main` deploy the already-tested `dist` artifact.
- Preserve Vite's relative `base: "./"` and the KaTeX WOFF2-only transform.
- Do not commit generated builds, caches, or browser artifacts.

## Maintenance

Keep `README.md` minimal and showcase-led: retain only the title, live explorer link, a brief description, and a current demo visual when one is available. Do not turn it into a detailed user or developer guide, and never present stale interface media.

When a permanent requirement changes this contract, update the existing guidance instead of appending a contradictory rule.
