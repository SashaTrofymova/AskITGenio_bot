import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(require.resolve("@oai/artifact-tool")).href);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..", "..");
const input = await FileBlob.load(path.join(projectDir, "knowledge_base", "AskITGenio_knowledge_base.xlsx"));
const wb = await SpreadsheetFile.importXlsx(input);
const info = await wb.inspect({
  kind: "sheet,table",
  maxChars: 4000,
  tableMaxRows: 3,
  tableMaxCols: 6
});
console.log(info.ndjson);
