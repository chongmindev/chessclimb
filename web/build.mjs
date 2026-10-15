// Copies the site into dist/: page, sources, chess.js and the lite engine. No bundler.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const out = new URL("./dist/", import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL("vendor/", out), { recursive: true });
mkdirSync(new URL("engine/", out), { recursive: true });
cpSync(new URL("./index.html", import.meta.url), new URL("index.html", out));
cpSync(new URL("./src/", import.meta.url), new URL("src/", out), { recursive: true });
cpSync(new URL("./styles/", import.meta.url), new URL("styles/", out), { recursive: true });
cpSync(new URL("./node_modules/chess.js/dist/esm/chess.js", import.meta.url), new URL("vendor/chess.js", out));
for (const f of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"])
  cpSync(new URL(`./node_modules/stockfish/bin/${f}`, import.meta.url), new URL(`engine/${f}`, out));
cpSync(new URL("./node_modules/stockfish/Copying.txt", import.meta.url), new URL("engine/COPYING.txt", out));
writeFileSync(new URL("_headers", out), [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "/engine/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
].join("\n"));
console.log("built", out.pathname);
