// Cross-platform replacement for `cp -r` (the old build script broke on Windows).
// Copies static assets next to the standalone server so it can serve them.
const fs = require("fs");
const path = require("path");
const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(standalone)) {
  console.error("[postbuild] .next/standalone not found — did `next build` succeed?");
  process.exit(1);
}
fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
console.log("[postbuild] copied .next/static and public into .next/standalone");
