import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "katex-woff2-only",
      enforce: "pre",
      transform(source, id) {
        if (!id.includes("/katex/dist/katex.min.css")) {
          return null;
        }

        // The app targets modern browsers, so shipping KaTeX's duplicate WOFF
        // and TTF fallbacks only enlarges the static Pages artifact.
        return source.replace(
          /src:url\(([^)]+\.woff2)\) format\("woff2"\),url\([^)]+\.woff\) format\("woff"\),url\([^)]+\.ttf\) format\("truetype"\)/g,
          'src:url($1) format("woff2")'
        );
      }
    }
  ]
});
