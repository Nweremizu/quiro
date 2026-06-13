import { promises as fs } from "node:fs";
import path from "node:path";

const exporterDir = path.resolve("src/lib/exporter");

const toKebabCase = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, "$1-$2")
    .toLowerCase();

const renameMap = new Map();

const entries = await fs.readdir(exporterDir, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".ts")) {
    continue;
  }

  const baseName = entry.name.slice(0, -3);
  const kebabName = toKebabCase(baseName);

  if (kebabName === baseName) {
    continue;
  }

  renameMap.set(`./${baseName}`, `./${kebabName}`);
  await fs.rename(
    path.join(exporterDir, entry.name),
    path.join(exporterDir, `${kebabName}.ts`),
  );
}

if (renameMap.size === 0) {
  console.log("No exporter filenames needed renaming.");
  process.exit(0);
}

const sourceRoot = path.resolve("src");
const scriptExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const updateImports = (content) => {
  let updated = content;

  for (const [from, to] of renameMap) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(String.raw`(from\s+["'])${escaped}(\2)`, "g");
    updated = updated.replace(pattern, `$1${to}$2`);
  }

  return updated;
};

const walk = async (dir) => {
  const children = await fs.readdir(dir, { withFileTypes: true });

  for (const child of children) {
    const fullPath = path.join(dir, child.name);

    if (child.isDirectory()) {
      if (
        child.name === "node_modules" ||
        child.name === "dist" ||
        child.name === "dist-electron"
      ) {
        continue;
      }

      await walk(fullPath);
      continue;
    }

    if (!scriptExtensions.has(path.extname(child.name))) {
      continue;
    }

    const original = await fs.readFile(fullPath, "utf8");
    const updated = updateImports(original);

    if (updated !== original) {
      await fs.writeFile(fullPath, updated, "utf8");
    }
  }
};

await walk(sourceRoot);

console.log(`Renamed ${renameMap.size} exporter file(s).`);
