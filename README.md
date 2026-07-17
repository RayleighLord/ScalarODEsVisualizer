# Scalar Differential Equation Explorer

[Open the live explorer](https://rayleighlord.github.io/ScalarODEsVisualizer/)

A light, full-window browser application for exploring scalar first-order ordinary differential equations of the form

$$
y' = f(y,t).
$$

It combines a direction field, interactive integral curves, autonomous equilibria, and an optional phase-flow view in a static site with no backend.

## Highlights

- Full-viewport, responsive `t`–`y` plane with compact floating controls.
- Live KaTeX rendering for the current equation, axis labels, ticks, and equilibria.
- Grid-aligned direction marks and distinct colors for multiple integral curves.
- Domain-aware adaptive solving that stops curves near singular or undefined barriers.
- Detection of isolated equilibrium solutions and continuous equilibrium intervals for autonomous equations.
- Optional phase-flow rail on the visible `t=0` axis with stable, unstable, and semistable markers.
- Hideable controls that leave the rendered equation and plotting plane visible.
- Static Vite build suitable for GitHub Pages.

## Using the explorer

The initial example is

```text
y * (2 - y)
```

with `t ∈ [-6,6]`, `y ∈ [-3,3]`, and phase flow disabled.

| Action | Result |
| --- | --- |
| Edit the equation field | Updates the direction field, rendered equation, equilibria, and retained curves after a short debounce. |
| Edit a complete valid axis limit | Applies the new window immediately. |
| Click in the plot | Adds the integral curve through that point. |
| Right-click near a curve | Removes the nearest curve. |
| Shift + right-click in the plot | Clears every curve. |
| **Clear curves** | Clears every curve through the visible control. |
| **Show phase flow** | Shows the one-dimensional flow for eligible autonomous equations. |
| **Hide UI** | Hides the editor and information cards while retaining the centered equation and restore/help controls. |
| **?** | Opens the compact shortcut guide. |
| **↺** | Restores the default equation and window and clears the session. |

## Expression syntax

Enter only the right-hand side `f(y,t)`. Multiplication must be explicit.

- Variables: `y`, `t`
- Constants: `pi`, `e`
- Operators: `+`, `-`, `*`, `/`, `^`
- Parentheses and scientific notation are supported.
- Functions: `abs`, `acos`, `asin`, `atan`, `ceil`, `cos`, `cosh`, `exp`, `floor`, `log`, `max`, `min`, `pow`, `round`, `sin`, `sinh`, `sqrt`, `tan`, `tanh`

Examples:

```text
sin(t) - y
y * (1 - y^2)
1 / (y - 1)
```

`log` is the natural logarithm. `pow` accepts two arguments; `min` and `max` accept one or more.

## Mathematical behavior

Expressions are parsed without runtime code generation and classified semantically as autonomous or non-autonomous. For autonomous equations, the application numerically searches the visible `y` range for isolated equilibria and equilibrium intervals. These appear as black horizontal lines or restrained bands and are listed in the equilibria card.

Integral curves are traced forward and backward with an adaptive Dormand-Prince RK45 solver. Domain diagnostics distinguish undefined barriers, near-singular behavior, invalid values, visible-boundary exits, and accuracy limits so curves do not simply continue across invalid branches.

The phase-flow overlay is available only when the equation is autonomous, `t=0` is visible, and the equilibrium structure is compatible with isolated markers. Equilibrium discovery is numerical and domain-aware; it is not a general symbolic solver.

## Local development

Requirements:

- Node.js 24 via `.nvmrc` (supported range: `>=22.12.0 <25`)
- npm

```bash
nvm use
npm ci
npm run dev
```

Vite prints the local development URL. To inspect a production build:

```bash
npm run build
npm run preview
```

## Validation

| Command | Purpose |
| --- | --- |
| `npm test` | Run the Vitest unit suite. |
| `npm run typecheck` | Run TypeScript checks without emitting files. |
| `npm run build` | Type-check and create the production bundle. |
| `npm run test:browser` | Build and exercise the production site in Chromium. |

The browser smoke suite checks rendering, retained SVG nodes, responsive annotation placement, live/debounced edits, curve removal, phase flow, equilibrium intervals, and Hide UI behavior. Its ignored screenshot artifact is written to `output/playwright/browser-smoke.png`.

If Chromium is unavailable locally, install it with:

```bash
npx playwright install chromium
```

## Project structure

- `src/app.ts` — DOM wiring, debounced input, shortcuts, and UI rendering.
- `src/ui/controller.ts` — application state, derived results, and selective cache invalidation.
- `src/math/parser.ts` and `src/math/expression/` — expression facade, parser, evaluator, diagnostics, domain analysis, and LaTeX.
- `src/math/equilibria.ts` — isolated and interval equilibrium detection.
- `src/solver/rk4.ts` — adaptive Dormand-Prince RK45 solver; the filename is retained for compatibility.
- `src/plot/` — coordinates, grid, direction field, trajectories, snapping, and phase flow.
- `scripts/browser-smoke.mjs` — production Chromium smoke checks.

## Deployment

`.github/workflows/ci.yml` is the single CI and GitHub Pages workflow. Pull requests test and build without deploying. Pushes to `main` run the same checks, upload the tested `dist` artifact, and deploy it to Pages.

The Vite configuration intentionally keeps `base: "./"` so the static build works at the repository subpath.
