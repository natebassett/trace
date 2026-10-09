import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const assets = [
  ["../src/adapters/python/parse.py", "../dist/src/adapters/python/parse.py"],
  ["../src/viewer/index.html", "../dist/src/viewer/index.html"],
  ["../src/viewer/style.css", "../dist/src/viewer/style.css"],
  ["../src/viewer/app.js", "../dist/src/viewer/app.js"],
];

for (const [sourcePath, destinationPath] of assets) {
  const source = fileURLToPath(new URL(sourcePath, import.meta.url));
  const destination = fileURLToPath(new URL(destinationPath, import.meta.url));
  await mkdir(fileURLToPath(new URL(".", new URL(destinationPath, import.meta.url))), { recursive: true });
  await copyFile(source, destination);
}
