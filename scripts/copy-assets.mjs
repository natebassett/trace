import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src/adapters/python/parse.py", import.meta.url));
const destination = fileURLToPath(new URL("../dist/src/adapters/python/parse.py", import.meta.url));
await mkdir(fileURLToPath(new URL("../dist/src/adapters/python/", import.meta.url)), { recursive: true });
await copyFile(source, destination);
