import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const kbPath = path.join(rootDir, "knowledge_base", "exports", "AskITGenio_Knowledge_Base.csv");
const apiMappingPath = path.join(rootDir, "knowledge_base", "exports", "AskITGenio_API_Mapping.csv");
const demoScriptPath = path.join(rootDir, "knowledge_base", "exports", "AskITGenio_Demo_Script.csv");
const genaPublicPath = path.join(rootDir, "knowledge_base", "exports", "Gena_Directions_public.csv");
const genaPrivatePath = path.join(rootDir, "knowledge_base", "exports", "Gena_Directions.csv");
const genaPath = existsSync(genaPublicPath) ? genaPublicPath : genaPrivatePath;
const notionPath = path.join(rootDir, "docs", "notion_text_index.json");
const port = Number(process.env.PORT || 5177);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}\s+#.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const stopWords = new Set([
  "что",
  "как",
  "если",
  "это",
  "для",
  "про",
  "при",
  "или",
  "его",
  "она",
  "они",
  "мне",
  "нам",
  "тебе",
  "урок",
  "уроке",
  "занятии",
  "ребенок",
  "ребенка",
  "ребенку",
  "ребёнок",
  "ребёнка",
  "ребёнку",
  "ученик",
  "ученика",
  "ученику",
]);

const tokenize = (value) =>
  normalize(value)
    .split(" ")
    .filter((token) => token.length > 2 && !stopWords.has(token));

function detectDelimiter(text) {
  const header = text.split(/\r?\n/, 1)[0] || "";
  const commaCount = (header.match(/,/g) || []).length;
  const semicolonCount = (header.match(/;/g) || []).length;
  return commaCount > semicolonCount ? "," : ";";
}

function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift() ?? [];
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? ""])),
  );
}

async function loadCsv(filePath) {
  if (!existsSync(filePath)) return [];
  const text = await readFile(filePath, "utf8");
  return parseCsv(text);
}

async function loadNotion(filePath) {
  if (!existsSync(filePath)) return [];
  const data = JSON.parse(await readFile(filePath, "utf8"));
  if (Array.isArray(data.pages)) return data.pages;
  if (Array.isArray(data)) return data;
  return [];
}

const state = {
  knowledgeBase: await loadCsv(kbPath),
  apiMapping: await loadCsv(apiMappingPath),
  demoScript: await loadCsv(demoScriptPath),
  directions: await loadCsv(genaPath),
  notionPages: await loadNotion(notionPath),
};

const sheetRows = [
  ...state.knowledgeBase.map((row) => ({ sheet: "Knowledge_Base", row })),
  ...state.apiMapping.map((row) => ({ sheet: "API_Mapping", row })),
  ...state.demoScript.map((row) => ({ sheet: "Demo_Script", row })),
  ...state.directions.map((row) => ({ sheet: "Gena_Directions", row })),
];

function scoreText(questionTokens, text) {
  const normalized = normalize(text);
  return questionTokens.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0);
}

function pick(row, keys) {
  for (const key of keys) {
    if (row?.[key]) return row[key];
  }
  return "";
}

function getDraftAnswer(row) {
  return pick(row, ["Черновик ответа", "Готовый ответ"]);
}

function getSourceText(row) {
  return pick(row, ["Источники", "Источник", "Главный источник"]);
}

function getSelfCheckText(row) {
  return pick(row, ["Где посмотреть самому", "Где искать"]);
}

function rowText(row) {
  return Object.values(row ?? {}).join(" ");
}

function getDirectionTitle(direction) {
  return direction["Название"] || direction.title || direction.name || "";
}

function isDirectionQuestion(question) {
  const q = normalize(question);
  return [
    "направлен",
    "курс",
    "программ",
    "возраст",
    "завед",
    "установ",
    "требован",
    "формат",
    "шаблон",
    "пробн",
    "предлож",
  ].some((marker) => q.includes(marker));
}

function isSensitiveCase(question) {
  const q = normalize(question);
  const markers = [
    "удар",
    "бьет",
    "бьёт",
    "побил",
    "насили",
    "агресс",
    "унижа",
    "дурак",
    "оскорб",
    "ссор",
    "конфликт",
    "опасн",
    "безопас",
    "плач",
    "истер",
    "родител",
    "мама",
    "папа",
  ];
  return markers.some((marker) => q.includes(marker));
}

function findDirection(question) {
  const q = normalize(question);
  const tokens = tokenize(question);

  const exact = state.directions.find((direction) => {
    const title = normalize(getDirectionTitle(direction));
    return title && q.includes(title);
  });
  if (exact) return exact;

  if (!isDirectionQuestion(question) || isSensitiveCase(question)) return undefined;

  return state.directions
    .map((direction) => ({
      direction,
      score: scoreText(tokens, [
        getDirectionTitle(direction),
        direction["Описание направления"],
        direction["Внутренняя заметка"],
        direction["Шаблон"],
      ].join(" ")),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.direction;
}

function findKbRow(question) {
  const q = normalize(question);
  const tokens = tokenize(question);

  const hints = [
    ["завед", "Заведующий"],
    ["возраст", "Мин. возраст"],
    ["лет", "Мин. возраст"],
    ["webgl", "WebGL"],
    ["горяч", "горячие клавиши"],
    ["illustrator", "Illustrator"],
    ["vpn", "VPN"],
    ["направлен", "направления"],
    ["удар", "родитель"],
    ["бьет", "родитель"],
    ["бьёт", "родитель"],
    ["насили", "безопасность"],
    ["агресс", "сложные ситуации"],
    ["унижа", "унижении"],
    ["оскорб", "унижении"],
    ["дурак", "дурак"],
    ["ссор", "Ссора родителей"],
    ["конфликт", "конфликт"],
  ];

  return state.knowledgeBase
    .map((row) => {
      const haystack = [
        row.ID,
        pick(row, ["Блок", "Категория"]),
        pick(row, ["Вопрос/сценарий", "Вопрос пользователя", "Нормализованный вопрос"]),
        getDraftAnswer(row),
        getSourceText(row),
        getSelfCheckText(row),
        pick(row, ["Теги", "Заметки"]),
      ].join(" ");
      let score = scoreText(tokens, haystack);
      for (const [needle, boost] of hints) {
        if (q.includes(needle) && normalize(haystack).includes(normalize(boost))) score += 4;
      }
      return { row, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.row;
}

function findSheetMatches(question) {
  const tokens = tokenize(question);
  return sheetRows
    .map(({ sheet, row }) => ({
      sheet,
      row,
      score: scoreText(tokens, rowText(row)),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function findNotionMatches(question) {
  const tokens = tokenize(question);
  const sensitive = isSensitiveCase(question);
  return state.notionPages
    .map((page) => {
      const text = [
        page.title,
        page.url,
        page.text,
        page.content,
        page.plain_text,
      ].join(" ");
      const normalizedText = normalize(text);
      let score = scoreText(tokens, text);
      if (sensitive) {
        for (const marker of ["советы психолога", "сложные ситуации", "практические кейсы", "родител", "безопас", "конфликт", "агресс", "насили", "унижа"]) {
          if (normalizedText.includes(marker)) score += 3;
        }
      }
      return {
        title: page.title || "Страница Notion",
        url: page.url || "",
        snippet: String(page.text || page.content || page.plain_text || "").slice(0, 240),
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function directionValue(direction, keys) {
  for (const key of keys) {
    if (direction?.[key]) return direction[key];
  }
  return "";
}

function buildDirectionAnswer(question, direction) {
  if (!direction) return "";

  const q = normalize(question);
  const title = getDirectionTitle(direction);
  const head = directionValue(direction, ["Заведующий", "head", "manager"]);
  const minAge = directionValue(direction, ["Мин. возраст", "minAge"]);
  const maxAge = directionValue(direction, ["Макс. возраст", "maxAge"]);
  const description = directionValue(direction, ["Описание направления", "description"]);
  const template = directionValue(direction, ["Шаблон", "template"]);
  const note = directionValue(direction, ["Внутренняя заметка", "innerNote"]);
  const os = directionValue(direction, ["ОС", "os"]);
  const tablet = directionValue(direction, ["Планшет", "tablet"]);
  const installer = directionValue(direction, ["Установщик", "installer"]);

  if (q.includes("завед")) {
    return head
      ? `За направление ${title} отвечает ${head}.`
      : `В карточке направления ${title} заведующий не указан.`;
  }

  if (q.includes("возраст") || q.includes("лет")) {
    if (minAge && maxAge) return `На ${title} можно записывать детей с ${minAge} лет, обычно до ${maxAge} лет.`;
    if (minAge) return `На ${title} можно записывать детей с ${minAge} лет.`;
  }

  if (q.includes("установ") || q.includes("требован") || q.includes("ос") || q.includes("webgl")) {
    const parts = [
      os ? `Поддерживаемые ОС: ${os}.` : "",
      tablet ? `Планшеты: ${tablet}.` : "",
      installer ? `Установщик: ${installer}.` : "",
    ].filter(Boolean);
    return parts.length ? parts.join("\n") : "";
  }

  if (template) return template.replaceAll("_ИмяУ_", "ученику");
  if (description) return description;
  if (note) return note.slice(0, 900);
  return "";
}

function fillTemplate(answer, row, direction) {
  if (!answer) return "";
  const title = getDirectionTitle(direction);
  const replacements = new Map([
    ["{направление}", title],
    ["{Заведующий из Гены}", directionValue(direction, ["Заведующий", "head"])],
    ["{minAge}", directionValue(direction, ["Мин. возраст", "minAge"])],
    ["{maxAge}", directionValue(direction, ["Макс. возраст", "maxAge"])],
    ["{operationSystems}", directionValue(direction, ["ОС", "os"])],
    ["{tabletSystems или “не указаны”}", directionValue(direction, ["Планшет", "tablet"]) || "не указаны"],
    ["{languages}", directionValue(direction, ["Языки", "languages"])],
    ["{visibleLanguages}", directionValue(direction, ["Языки", "languages"])],
  ]);

  let output = answer;
  for (const [token, value] of replacements) {
    output = output.replaceAll(token, value || "");
  }

  const selfCheck = getSelfCheckText(row);
  if (selfCheck && output.includes("{")) {
    output += `\n\nДля проверки деталей: ${selfCheck}.`;
  }

  return output.replace(/\n{3,}/g, "\n\n").trim();
}

function answerQuestion(question) {
  const sensitive = isSensitiveCase(question);
  const direction = sensitive ? undefined : findDirection(question);
  const kbRow = findKbRow(question);
  const sheetMatches = findSheetMatches(question);
  const notionMatches = findNotionMatches(question);
  const directionAnswer = buildDirectionAnswer(question, direction);
  const kbAnswer = fillTemplate(getDraftAnswer(kbRow), kbRow, direction);
  const notionAnswer = notionMatches[0]?.snippet;

  const answer =
    kbAnswer ||
    (sensitive ? notionAnswer || directionAnswer : directionAnswer || notionAnswer) ||
    "Пока не нашла готовый ответ в подключенных источниках. Лучше уточнить формулировку или добавить этот сценарий в таблицу базы знаний.";

  const sources = [];
  if (kbRow) {
    sources.push({
      type: "table",
      title: `Таблица: вопрос ${kbRow.ID || "без ID"}`,
      detail: [
        pick(kbRow, ["Категория", "Блок"]),
        getSourceText(kbRow),
        getSelfCheckText(kbRow),
      ].filter(Boolean).join(" | "),
    });
  }
  for (const match of sheetMatches.slice(0, 3)) {
    const title =
      pick(match.row, [
        "Вопрос пользователя",
        "Демо-вопрос",
        "Объект",
        "Название",
        "Нормализованный вопрос",
      ]) || "строка таблицы";
    sources.push({
      type: "sheet",
      title: `${match.sheet}: ${title}`,
      detail: `совпадение: ${match.score}`,
    });
  }
  if (notionMatches.length) {
    sources.push({
      type: "notion",
      title: `Notion: ${notionMatches[0].title}`,
      detail: notionMatches[0].url || "локальный индекс Notion",
    });
  }
  if (direction) {
    sources.push({
      type: "gena",
      title: `Гена: ${getDirectionTitle(direction)}`,
      detail: [
        directionValue(direction, ["Заведующий", "head"]) && `заведующий: ${directionValue(direction, ["Заведующий", "head"])}`,
        directionValue(direction, ["Мин. возраст", "minAge"]) && `возраст: ${directionValue(direction, ["Мин. возраст", "minAge"])}-${directionValue(direction, ["Макс. возраст", "maxAge"])} лет`,
      ].filter(Boolean).join(", "),
    });
  }

  return {
    answer,
    matchedQuestion: pick(kbRow, ["Вопрос/сценарий", "Вопрос пользователя", "Нормализованный вопрос"]),
    direction: direction ? getDirectionTitle(direction) : "",
    sources,
    notionMatches,
  };
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data, null, 2));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(__dirname, rawPath));

  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(path.extname(filePath)) || "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/status") {
      sendJson(response, {
        knowledgeBaseRows: state.knowledgeBase.length,
        apiMappingRows: state.apiMapping.length,
        demoScriptRows: state.demoScript.length,
        genaDirections: state.directions.length,
        notionPages: state.notionPages.length,
        indexedSheetRows: sheetRows.length,
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/ask") {
      const body = JSON.parse(await readBody(request) || "{}");
      const question = String(body.question || "").trim();
      if (!question) {
        sendJson(response, { error: "question is required" }, 400);
        return;
      }
      sendJson(response, answerQuestion(question));
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, { error: error.message }, 500);
  }
});

server.listen(port, () => {
  console.log(`AskITGenio web is running at http://localhost:${port}`);
  console.log(`KB: ${state.knowledgeBase.length}, Gena: ${state.directions.length}, Notion: ${state.notionPages.length}`);
});
