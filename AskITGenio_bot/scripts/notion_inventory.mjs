import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.NOTION_TOKEN;
if (!token) throw new Error("NOTION_TOKEN env var is required");

const rootPageId = (process.env.NOTION_PAGE_ID || "5b5efb1a90db82bfb1fe01d822442f07").replaceAll("-", "");
const notionVersion = "2022-06-28";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const docsDir = path.join(projectDir, "docs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function notion(pathname, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    const message = body.message || body.raw || JSON.stringify(body).slice(0, 500);
    throw new Error(`${options.method || "GET"} ${pathname} failed: HTTP ${response.status}: ${message}`);
  }
  return body;
}

function richTextToPlain(richText = []) {
  if (typeof richText === "string") return richText;
  if (!Array.isArray(richText)) return "";
  return richText.map((item) => item.plain_text || "").join("");
}

function titleFromPage(page) {
  const props = page.properties || {};
  for (const prop of Object.values(props)) {
    if (prop?.type === "title") return richTextToPlain(prop.title);
  }
  return page.id;
}

function textFromBlock(block) {
  const data = block[block.type] || {};
  if (data.rich_text) return richTextToPlain(data.rich_text);
  if (data.title) return richTextToPlain(data.title);
  if (block.type === "child_page") return data.title || "";
  if (block.type === "child_database") return data.title || "";
  return "";
}

function compactBlock(block) {
  const data = block[block.type] || {};
  return {
    id: block.id,
    type: block.type,
    has_children: block.has_children,
    text: textFromBlock(block),
    title: data.title || undefined,
    url: data.url || undefined,
    language: data.language || undefined,
  };
}

async function listBlockChildren(blockId) {
  const results = [];
  let startCursor;
  do {
    const query = startCursor ? `?page_size=100&start_cursor=${encodeURIComponent(startCursor)}` : "?page_size=100";
    const data = await notion(`/blocks/${blockId}/children${query}`);
    results.push(...data.results);
    startCursor = data.has_more ? data.next_cursor : undefined;
    if (startCursor) await sleep(250);
  } while (startCursor);
  return results;
}

async function queryDatabase(databaseId) {
  const results = [];
  let start_cursor;
  do {
    const body = { page_size: 100 };
    if (start_cursor) body.start_cursor = start_cursor;
    const data = await notion(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    results.push(...data.results);
    start_cursor = data.has_more ? data.next_cursor : undefined;
    if (start_cursor) await sleep(250);
  } while (start_cursor);
  return results;
}

async function traversePage(pageId, depth = 0, maxDepth = 5, seen = new Set()) {
  if (seen.has(pageId) || depth > maxDepth) return null;
  seen.add(pageId);

  const page = await notion(`/pages/${pageId}`);
  const pageNode = {
    id: page.id,
    type: "page",
    title: titleFromPage(page),
    url: page.url,
    last_edited_time: page.last_edited_time,
    properties: Object.fromEntries(Object.entries(page.properties || {}).map(([key, prop]) => [key, prop.type])),
    blocks: [],
    child_pages: [],
    child_databases: [],
    extracted_text: "",
  };

  const blocks = await listBlockChildren(pageId);
  const textParts = [];

  for (const block of blocks) {
    const compact = compactBlock(block);
    pageNode.blocks.push(compact);
    if (compact.text) textParts.push(compact.text);

    if (block.type === "child_page" && depth < maxDepth) {
      await sleep(150);
      const child = await traversePage(block.id, depth + 1, maxDepth, seen).catch((error) => ({
        id: block.id,
        type: "page",
        title: compact.text,
        error: String(error.message || error),
      }));
      pageNode.child_pages.push(child);
    }

    if (block.type === "child_database") {
      await sleep(150);
      const database = await notion(`/databases/${block.id}`);
      const rows = await queryDatabase(block.id);
      const dbNode = {
        id: block.id,
        type: "database",
        title: database.title ? richTextToPlain(database.title) : compact.text,
        url: database.url,
        last_edited_time: database.last_edited_time,
        properties: Object.fromEntries(Object.entries(database.properties || {}).map(([key, prop]) => [key, prop.type])),
        row_count: rows.length,
        rows: rows.map((row) => ({
          id: row.id,
          title: titleFromPage(row),
          url: row.url,
          last_edited_time: row.last_edited_time,
          properties: Object.fromEntries(Object.entries(row.properties || {}).map(([key, prop]) => [key, prop.type])),
        })),
      };
      pageNode.child_databases.push(dbNode);
    }
  }

  pageNode.extracted_text = textParts.join("\n").trim();
  return pageNode;
}

function collectSummary(node, acc = { pages: [], databases: [] }) {
  if (!node) return acc;
  if (node.type === "page") {
    acc.pages.push({
      id: node.id,
      title: node.title,
      url: node.url,
      last_edited_time: node.last_edited_time,
      blocks: node.blocks?.length || 0,
      child_pages: node.child_pages?.length || 0,
      child_databases: node.child_databases?.length || 0,
      text_chars: node.extracted_text?.length || 0,
    });
    for (const child of node.child_pages || []) collectSummary(child, acc);
    for (const db of node.child_databases || []) collectSummary(db, acc);
  } else if (node.type === "database") {
    acc.databases.push({
      id: node.id,
      title: node.title,
      url: node.url,
      last_edited_time: node.last_edited_time,
      row_count: node.row_count,
      properties: node.properties,
    });
  }
  return acc;
}

await fs.mkdir(docsDir, { recursive: true });
const inventory = await traversePage(rootPageId);
const summary = collectSummary(inventory);

const output = {
  generated_at: new Date().toISOString(),
  root_page_id: rootPageId,
  summary,
  inventory,
};

await fs.writeFile(path.join(docsDir, "notion_inventory.json"), JSON.stringify(output, null, 2), "utf8");
await fs.writeFile(path.join(docsDir, "notion_inventory_summary.json"), JSON.stringify({
  generated_at: output.generated_at,
  root_page_id: rootPageId,
  pages: summary.pages,
  databases: summary.databases,
}, null, 2), "utf8");

console.log(JSON.stringify({
  pages: summary.pages.length,
  databases: summary.databases.length,
  root: summary.pages[0],
  database_titles: summary.databases.map((db) => ({ title: db.title, row_count: db.row_count })),
}, null, 2));
