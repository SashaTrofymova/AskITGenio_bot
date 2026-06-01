import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const inputPath = path.join(rootDir, "knowledge_base", "exports", "Gena_Directions.csv");
const outputPath = path.join(rootDir, "knowledge_base", "exports", "Gena_Directions_public.csv");

const tokenizedUrlPattern = /https?:\/\/(?:alt\.)?editor\.itgen\.io\/s\/[A-Za-z0-9._-]+/g;

const source = await readFile(inputPath, "utf8");
const sanitized = source.replace(tokenizedUrlPattern, "");

await writeFile(outputPath, sanitized, "utf8");
console.log(`Wrote sanitized Gena directions to ${outputPath}`);
