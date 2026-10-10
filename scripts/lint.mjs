import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { findOutsideDocReferences, findPlatformImports } from "./checks.mjs";

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (path.endsWith(".ts")) yield path;
  }
}

let failures = 0;
for (const file of sourceFiles("src")) {
  const source = readFileSync(file, "utf8");
  for (const specifier of findPlatformImports(source)) {
    console.error(`${file}: imports non-relative module "${specifier}"`);
    failures++;
  }
  for (const problem of findOutsideDocReferences(source)) {
    console.error(`${file}: ${problem}`);
    failures++;
  }
}
if (failures > 0) process.exit(1);
