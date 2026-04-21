#!/usr/bin/env bun
/**
 * Post-build: stamp dist/main/ with a package.json that marks it as CommonJS.
 *
 * Why: vite-plugin-electron/simple picks the module format by looking at the
 * root package.json. We removed "type":"module" from the root so the main
 * process compiles cleanly to CJS (Electron + native deps like better-sqlite3
 * + sharp work best as CJS). This post-build just pins dist/main/ explicitly
 * so Electron's Node resolves it deterministically even if we later add
 * "type":"module" at the root again.
 *
 * Node honors per-directory package.json: nodejs.org/api/packages.html#type
 */
import fs from "node:fs/promises";
import path from "node:path";

const cjsPkgPath = path.join(process.cwd(), "dist/main/package.json");
await fs.mkdir(path.dirname(cjsPkgPath), { recursive: true });
await fs.writeFile(
  cjsPkgPath,
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n"
);
// eslint-disable-next-line no-console
console.log("stamped dist/main/package.json as CommonJS");
