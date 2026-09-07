import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const roots = ["src", "public", "test", "scripts", "docs"];
const extensions = new Set([".js", ".html", ".css", ".md", ".json", ".yml", ".yaml"]);
const files = [];

for (const root of roots) {
  await collectFiles(root, files);
}

const failures = [];
for (const file of files) {
  const content = await readFile(file, "utf8");
  if (content.includes("\t")) {
    failures.push(`${file}: contains tab characters`);
  }
  if (/[ \t]$/m.test(content)) {
    failures.push(`${file}: contains trailing whitespace`);
  }
  if (!content.endsWith("\n")) {
    failures.push(`${file}: missing final newline`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Format check passed for ${files.length} files.`);

async function collectFiles(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, files);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
}
