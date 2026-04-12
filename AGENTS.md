# AGENTS.md

## Project Purpose

This project is an interactive website for exploring scalar first-order ordinary differential equations of the form `y' = f(t, y)`. It is intended to be deployable later as a static site, including via GitHub Pages.

The current product goals are:

- Show a `t-y` grid.
- Let the user choose visible axis limits.
- Let the user enter the ODE right-hand side `f(t, y)`.
- Draw slope markers so the flow direction is visually apparent.
- Plot the integral curve through any clicked point in the plot.
- For autonomous equations, detect equilibrium points and show them as horizontal lines.
- For autonomous equations with visible equilibria, optionally show a phase-flow rail with arrows along the `y` direction.

## Engineering Expectations

- Keep the implementation maintainable, modular, and easy to extend.
- Prefer clear separation between UI, math/parsing, solver logic, and rendering.
- Preserve static-site compatibility.
- Avoid introducing unnecessary complexity for basic interactions.

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
- Clicking should feel forgiving: snap near important targets such as equilibrium lines and visible axes when that improves usability.
- Equilibrium-line snapping should be gentler than general axis snapping so clicks near a fixed line do not attach too aggressively.
- If the phase-flow rail is shown, it should feel visually integrated with the plot rather than like a separate bright widget.
- Toggling the phase-flow overlay should not cause the x-axis labels or `t` label to jump vertically.

## Visual Verification Workflow

- For UI/layout changes, do not rely only on code inspection.
- Use browser-based visual inspection as part of the feedback loop.
- Prefer Playwright-based verification for layout-sensitive changes.
- Check realistic desktop/laptop viewports, not only large screens.
- When adjusting layout, confirm that the actual rendered page matches the intended result before considering the task complete.

## Current Interaction Expectations

- Clicking inside the plot adds an integral curve through that point.
- Multiple curves may remain visible simultaneously until cleared.
- Autonomous fixed-point behavior should remain easy to interpret through both equilibrium lines and the optional phase-flow rail.

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
