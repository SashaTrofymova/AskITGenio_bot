import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.GENA_TOKEN;
if (!token) {
  throw new Error("GENA_TOKEN env var is required");
}

const baseUrl = process.env.GENA_BASE_URL || "https://portal.itgen.io";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const outputPath = path.join(projectDir, "docs", "gena_probe_results.json");

const calls = [
  { methodName: "api.skills.getSkills", params: [] },
  { methodName: "api.skills.getSkills", params: [{}] },
  { methodName: "api.skills.getSkillsList", params: [] },
  { methodName: "api.skills.getSkillsList", params: [{}] },
  { methodName: "api.skills.getAllSkillsIds", params: [] },
  { methodName: "api.skills.getSkillsGroups", params: [] },
  { methodName: "api.skills.getSkillsOrder", params: [] },
];

async function callGena(methodName, params) {
  const result = await fetch(`${baseUrl}/api/gena`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      authorization: token,
    },
    body: JSON.stringify({ methodName, params }),
  });

  const text = await result.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 1000);
  }

  return {
    methodName,
    params,
    status: result.status,
    ok: result.ok,
    body,
  };
}

const outputs = [];
for (const call of calls) {
  try {
    outputs.push(await callGena(call.methodName, call.params));
  } catch (error) {
    outputs.push({
      methodName: call.methodName,
      params: call.params,
      error: String(error?.stack || error),
    });
  }
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(outputs, null, 2), "utf8");

const summary = outputs.map((item) => ({
  methodName: item.methodName,
  params: item.params,
  status: item.status,
  ok: item.ok,
  bodyType: Array.isArray(item.body) ? "array" : typeof item.body,
  bodySize: Array.isArray(item.body)
    ? item.body.length
    : item.body && typeof item.body === "object"
      ? Object.keys(item.body).length
      : undefined,
  keys: item.body && typeof item.body === "object" && !Array.isArray(item.body)
    ? Object.keys(item.body).slice(0, 20)
    : undefined,
  sampleKeys: Array.isArray(item.body) && item.body[0] && typeof item.body[0] === "object"
    ? Object.keys(item.body[0]).slice(0, 30)
    : undefined,
  error: item.error,
}));

console.log(JSON.stringify(summary, null, 2));
console.log(outputPath);
