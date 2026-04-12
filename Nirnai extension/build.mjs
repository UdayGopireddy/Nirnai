import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const isDev = process.env.NODE_ENV === "development";

const API_URL = isDev
  ? "http://localhost:8000"
  : "https://nirnai.app";

console.log(`\n🔧 Building for ${isDev ? "DEVELOPMENT" : "PRODUCTION"} → ${API_URL}\n`);

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  sourcemap: true,
  target: "es2022",
  logLevel: "info",
  define: {
    "__API_BASE_URL__": JSON.stringify(API_URL),
  },
};

// Content script — IIFE so it runs in page context without module system
const contentScript = esbuild.build({
  ...common,
  entryPoints: ["src/content/content.ts"],
  outfile: "dist/content.js",
  format: "iife",
});

// Service worker — ESM (Chrome MV3 service workers support ES modules)
const serviceWorker = esbuild.build({
  ...common,
  entryPoints: ["src/background/service-worker.ts"],
  outfile: "dist/service-worker.js",
  format: "esm",
});

// Popup script — IIFE (loaded via <script> tag)
const popup = esbuild.build({
  ...common,
  entryPoints: ["src/popup/popup.ts"],
  outfile: "dist/popup.js",
  format: "iife",
});

await Promise.all([contentScript, serviceWorker, popup]);
