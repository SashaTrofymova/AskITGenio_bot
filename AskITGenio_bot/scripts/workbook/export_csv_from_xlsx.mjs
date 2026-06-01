import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(require.resolve("@oai/artifact-tool")).href);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..", "..");
const outputDir = path.join(projectDir, "knowledge_base", "exports");
await fs.mkdir(outputDir, { recursive: true });
const input = await FileBlob.load(path.join(projectDir, "knowledge_base", "AskITGenio_knowledge_base.xlsx"));
const wb = await SpreadsheetFile.importXlsx(input);

const csvEscape = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

for (const [sheetName, range, fileName] of [
  ["Knowledge_Base", "A1:R1000", "AskITGenio_Knowledge_Base.csv"],
  ["Demo_Script", "A1:D11", "AskITGenio_Demo_Script.csv"],
  ["API_Mapping", "A1:E20", "AskITGenio_API_Mapping.csv"]
]) {
  const inspected = await wb.inspect({
    kind: "table",
    range: `${sheetName}!${range}`,
    include: "values",
    tableMaxRows: 100,
    tableMaxCols: 30,
    maxChars: 100000
  });
  const record = inspected.ndjson
    .trim()
    .split(/\n+/)
    .map((line) => JSON.parse(line))
    .find((item) => item.kind === "table" && item.values);
  const rows = record.values;
  while (rows.length && rows[rows.length - 1].every((cell) => cell == null || cell === "")) {
    rows.pop();
  }
  const csv = rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
  await fs.writeFile(path.join(outputDir, fileName), "\uFEFF" + csv, "utf8");
}

console.log(outputDir);
