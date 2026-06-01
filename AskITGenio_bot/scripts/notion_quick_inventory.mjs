import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.NOTION_TOKEN;
if (!token) throw new Error("NOTION_TOKEN env var is required");

const rootPageId = (process.env.NOTION_PAGE_ID || "5b5efb1a90db82bfb1fe01d822442f07").replaceAll("-", "");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const docsDir = path.join(projectDir, "docs");

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
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${body.message || body.raw || ""}`);
  return body;
}

const plain = (rich = []) => {
  if (typeof rich === "string") return rich;
  if (!Array.isArray(rich)) return "";
  return rich.map((item) => item.plain_text || "").join("");
};

const pageTitle = (page) => {
  for (const prop of Object.values(page.properties || {})) {
    if (prop.type === "title") return plain(prop.title);
  }
  return page.id;
};

const blockText = (block) => {
  const data = block[block.type] || {};
  return plain(data.rich_text || data.title || "");
};

async function children(blockId, limitPages = 3) {
  const out = [];
  let cursor;
  let pages = 0;
  do {
    const qs = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : "?page_size=100";
    const data = await notion(`/blocks/${blockId}/children${qs}`);
    out.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
    pages += 1;
  } while (cursor && pages < limitPages);
  return out;
}

async function queryDb(databaseId) {
  const data = await notion(`/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({ page_size: 30 }),
  });
  return data.results;
}

await fs.mkdir(docsDir, { recursive: true });

const root = await notion(`/pages/${rootPageId}`);
const rootBlocks = await children(rootPageId, 2);
const direct = [];

for (const block of rootBlocks) {
  const data = block[block.type] || {};
  const item = {
    id: block.id,
    type: block.type,
    text: blockText(block),
    title: data.title || undefined,
    has_children: block.has_children,
  };

  if (block.type === "child_database") {
    const db = await notion(`/databases/${block.id}`);
    const rows = await queryDb(block.id);
    item.database = {
      title: plain(db.title),
      properties: Object.fromEntries(Object.entries(db.properties || {}).map(([key, prop]) => [key, prop.type])),
      row_count_sampled: rows.length,
      rows: rows.map((row) => ({
        id: row.id,
        title: pageTitle(row),
        url: row.url,
        properties: Object.fromEntries(Object.entries(row.properties || {}).map(([key, prop]) => [key, prop.type])),
      })),
    };
  }

  if (block.type === "child_page") {
    const childPage = await notion(`/pages/${block.id}`).catch(() => null);
    const childBlocks = await children(block.id, 1).catch(() => []);
    item.page = {
      title: childPage ? pageTitle(childPage) : item.text,
      url: childPage?.url,
      block_count_sampled: childBlocks.length,
      child_blocks: childBlocks.slice(0, 40).map((child) => ({
        id: child.id,
        type: child.type,
        text: blockText(child),
        title: child[child.type]?.title || undefined,
        has_children: child.has_children,
      })),
    };
  }

  direct.push(item);
}

const output = {
  generated_at: new Date().toISOString(),
  root: {
    id: root.id,
    title: pageTitle(root),
    url: root.url,
    last_edited_time: root.last_edited_time,
  },
  direct_blocks_count: rootBlocks.length,
  direct,
};

await fs.writeFile(path.join(docsDir, "notion_quick_inventory.json"), JSON.stringify(output, null, 2), "utf8");

console.log(JSON.stringify({
  root: output.root,
  direct_blocks_count: output.direct_blocks_count,
  child_pages: direct.filter((item) => item.type === "child_page").map((item) => item.page?.title || item.text),
  child_databases: direct.filter((item) => item.type === "child_database").map((item) => ({
    title: item.database?.title || item.text,
    rows: item.database?.row_count_sampled,
    properties: item.database?.properties,
  })),
}, null, 2));
