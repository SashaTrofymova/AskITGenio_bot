import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.NOTION_TOKEN;
if (!token) throw new Error("NOTION_TOKEN env var is required");

const rootPageId = (process.env.NOTION_PAGE_ID || "5b5efb1a90db82bfb1fe01d822442f07").replaceAll("-", "");
const maxPages = Number(process.env.NOTION_MAX_PAGES || 220);
const maxDepth = Number(process.env.NOTION_MAX_DEPTH || 5);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const docsDir = path.join(projectDir, "docs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function notion(pathname, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    const message = body.message || body.raw || JSON.stringify(body).slice(0, 500);
    throw new Error(`${options.method || "GET"} ${pathname}: HTTP ${response.status}: ${message}`);
  }
  return body;
}

const plain = (rich = []) => {
  if (typeof rich === "string") return rich;
  if (!Array.isArray(rich)) return "";
  return rich.map((item) => item.plain_text || "").join("");
};

function richMentions(rich = []) {
  if (!Array.isArray(rich)) return [];
  return rich.flatMap((item) => {
    if (item.type !== "mention") return [];
    const mention = item.mention;
    if (mention?.type === "page") return [{ type: "page", id: mention.page.id, text: item.plain_text || "" }];
    if (mention?.type === "database") return [{ type: "database", id: mention.database.id, text: item.plain_text || "" }];
    return [];
  });
}

function pageTitle(page) {
  for (const prop of Object.values(page.properties || {})) {
    if (prop.type === "title") return plain(prop.title);
  }
  return page.id;
}

function propPlain(prop) {
  if (!prop) return "";
  if (prop.type === "title") return plain(prop.title);
  if (prop.type === "rich_text") return plain(prop.rich_text);
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "multi_select") return prop.multi_select?.map((x) => x.name).join(", ") || "";
  if (prop.type === "status") return prop.status?.name || "";
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "email") return prop.email || "";
  if (prop.type === "phone_number") return prop.phone_number || "";
  if (prop.type === "checkbox") return prop.checkbox ? "Да" : "Нет";
  if (prop.type === "number") return prop.number == null ? "" : String(prop.number);
  if (prop.type === "date") return prop.date?.start || "";
  if (prop.type === "people") return prop.people?.map((p) => p.name || p.id).join(", ") || "";
  if (prop.type === "relation") return prop.relation?.map((r) => r.id).join(", ") || "";
  return "";
}

function blockTextAndMentions(block) {
  const data = block[block.type] || {};
  const rich = data.rich_text || data.title || [];
  const text = plain(rich);
  return { text, mentions: richMentions(rich) };
}

async function listChildren(blockId, pageSize = 100) {
  const results = [];
  let cursor;
  do {
    const qs = cursor ? `?page_size=${pageSize}&start_cursor=${encodeURIComponent(cursor)}` : `?page_size=${pageSize}`;
    const data = await notion(`/blocks/${blockId}/children${qs}`);
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
    if (cursor) await sleep(120);
  } while (cursor);
  return results;
}

async function queryDatabase(databaseId, limit = 120) {
  const results = [];
  let start_cursor;
  do {
    const body = { page_size: Math.min(100, limit - results.length) };
    if (start_cursor) body.start_cursor = start_cursor;
    const data = await notion(`/databases/${databaseId}/query`, { method: "POST", body: JSON.stringify(body) });
    results.push(...data.results);
    start_cursor = data.has_more && results.length < limit ? data.next_cursor : undefined;
    if (start_cursor) await sleep(120);
  } while (start_cursor && results.length < limit);
  return results;
}

await fs.mkdir(docsDir, { recursive: true });

const queue = [{ id: rootPageId, kind: "page", depth: 0, parent: null, hint: "root" }];
const seenPages = new Set();
const seenDatabases = new Set();
const pages = [];
const databases = [];
const errors = [];

while (queue.length && pages.length < maxPages) {
  const item = queue.shift();
  if (item.kind === "page") {
    const pageId = item.id.replaceAll("-", "");
    if (seenPages.has(pageId) || item.depth > maxDepth) continue;
    seenPages.add(pageId);
    try {
      const page = await notion(`/pages/${item.id}`);
      const blocks = await listChildren(item.id);
      const textParts = [];
      const compactBlocks = [];
      const mentions = [];

      for (const block of blocks) {
        const data = block[block.type] || {};
        const { text, mentions: blockMentions } = blockTextAndMentions(block);
        if (text) textParts.push(text);
        mentions.push(...blockMentions);
        compactBlocks.push({
          id: block.id,
          type: block.type,
          text,
          title: data.title || undefined,
          has_children: block.has_children,
        });

        if (block.type === "child_page") {
          queue.push({ id: block.id, kind: "page", depth: item.depth + 1, parent: page.id, hint: data.title || text });
        } else if (block.type === "child_database") {
          queue.push({ id: block.id, kind: "database", depth: item.depth + 1, parent: page.id, hint: data.title || text });
        }
        for (const mention of blockMentions) {
          queue.push({ id: mention.id, kind: mention.type, depth: item.depth + 1, parent: page.id, hint: mention.text });
        }
      }

      const propText = Object.entries(page.properties || {})
        .map(([key, prop]) => `${key}: ${propPlain(prop)}`)
        .filter((line) => !line.endsWith(": "));

      pages.push({
        id: page.id,
        title: pageTitle(page),
        url: page.url,
        parent: item.parent,
        depth: item.depth,
        hint: item.hint,
        last_edited_time: page.last_edited_time,
        properties: Object.fromEntries(Object.entries(page.properties || {}).map(([key, prop]) => [key, prop.type])),
        property_text: propText,
        blocks: compactBlocks,
        extracted_text: [...propText, ...textParts].join("\n").trim(),
      });
    } catch (error) {
      errors.push({ item, error: String(error.message || error) });
    }
  } else if (item.kind === "database") {
    const databaseId = item.id.replaceAll("-", "");
    if (seenDatabases.has(databaseId) || item.depth > maxDepth) continue;
    seenDatabases.add(databaseId);
    try {
      const db = await notion(`/databases/${item.id}`);
      const rows = await queryDatabase(item.id);
      databases.push({
        id: db.id,
        title: plain(db.title) || item.hint || db.id,
        url: db.url,
        parent: item.parent,
        depth: item.depth,
        last_edited_time: db.last_edited_time,
        properties: Object.fromEntries(Object.entries(db.properties || {}).map(([key, prop]) => [key, prop.type])),
        row_count_sampled: rows.length,
        rows: rows.map((row) => {
          const propText = Object.entries(row.properties || {})
            .map(([key, prop]) => `${key}: ${propPlain(prop)}`)
            .filter((line) => !line.endsWith(": "));
          queue.push({ id: row.id, kind: "page", depth: item.depth + 1, parent: db.id, hint: pageTitle(row) });
          return {
            id: row.id,
            title: pageTitle(row),
            url: row.url,
            last_edited_time: row.last_edited_time,
            properties: Object.fromEntries(Object.entries(row.properties || {}).map(([key, prop]) => [key, prop.type])),
            property_text: propText,
          };
        }),
      });
    } catch (error) {
      errors.push({ item, error: String(error.message || error) });
    }
  }
  await sleep(80);
}

const textIndex = pages.map((page) => ({
  id: page.id,
  title: page.title,
  url: page.url,
  depth: page.depth,
  parent: page.parent,
  last_edited_time: page.last_edited_time,
  text: page.extracted_text,
}));

const output = {
  generated_at: new Date().toISOString(),
  root_page_id: rootPageId,
  limits: { maxPages, maxDepth },
  counts: { pages: pages.length, databases: databases.length, errors: errors.length, queue_remaining: queue.length },
  pages,
  databases,
  errors,
};

await fs.writeFile(path.join(docsDir, "notion_deep_inventory.json"), JSON.stringify(output, null, 2), "utf8");
await fs.writeFile(path.join(docsDir, "notion_text_index.json"), JSON.stringify(textIndex, null, 2), "utf8");

console.log(JSON.stringify({
  counts: output.counts,
  topPages: pages.slice(0, 20).map((p) => ({ title: p.title, depth: p.depth, chars: p.extracted_text.length })),
  databases: databases.map((db) => ({ title: db.title, rows: db.row_count_sampled })),
  errors: errors.slice(0, 5),
}, null, 2));
