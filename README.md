# Integral Curve Explorer

> **Access here:** [Scalar ODEs Visualizer](https://rayleighlord.github.io/ScalarODEsVisualizer/)

An interactive browser-based explorer for scalar first-order ordinary differential equations of
the form

$$
y' = f(t,y)
$$

[![Animated showcase of the Integral Curve Explorer](docs/integral-curve-explorer-showcase.gif)](https://rayleighlord.github.io/ScalarODEsVisualizer/)

## Development

The project targets Node.js 24 (Node 22.12 or newer is also supported).

```sh
nvm use
npm ci
npm run dev
```

The fast unit suite covers parsing, domain analysis, equilibria, the adaptive solver, controller
invalidation, and plot helpers. The browser smoke suite builds the production site and verifies the
main interactions, retained rendering layers, and responsive annotation alignment in Chromium.

```sh
npm test
npm run test:browser
```

To record the optional high-resolution showcase after starting a preview server, run
`npm run record:showcase`. `SHOWCASE_URL` and `CHROME_PATH` can override its defaults.
