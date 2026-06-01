import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(require.resolve("@oai/artifact-tool")).href);

const token = process.env.GENA_TOKEN;
if (!token) throw new Error("GENA_TOKEN env var is required");

const baseUrl = process.env.GENA_BASE_URL || "https://portal.itgen.io";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const kbDir = path.join(projectDir, "knowledge_base");
const exportsDir = path.join(kbDir, "exports");
const docsDir = path.join(projectDir, "docs");
const workbookPath = path.join(kbDir, "AskITGenio_knowledge_base.xlsx");
const backupPath = path.join(kbDir, "AskITGenio_knowledge_base.before_full_gena_directions.xlsx");

async function callGena(methodName, params) {
  const res = await fetch(`${baseUrl}/api/gena`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      authorization: token,
    },
    body: JSON.stringify({ methodName, params }),
  });
  const body = await res.json().catch(async () => ({ raw: await res.text() }));
  if (!res.ok || body.status !== "ok") {
    throw new Error(`${methodName} failed: HTTP ${res.status}; ${body.error || body.raw || JSON.stringify(body).slice(0, 500)}`);
  }
  return body.result;
}

const compact = (value) => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.filter((item) => item != null && item !== "").join(", ");
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return String(value)
    .replaceAll("&NewLine;", "\n")
    .replace(/\\([#\-])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const formatFormats = (formats) => {
  const names = { 0: "Индивидуально-групповой", 1: "Индивидуальный", 2: "Групповой" };
  return Array.isArray(formats) ? formats.map((item) => names[item] || item).join(", ") : compact(formats);
};

const csvEscape = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const allSkills = await callGena("api.skills.getSkills", []);
const allSkillIds = Object.keys(allSkills);
const groups = await callGena("api.skills.getSkillsGroups", []);
const trainers = await callGena("api.users.getTrainersWithFullName", [{}]);

const groupById = new Map(groups.map((group) => [group._id, group.title?.ru || group.title?.en || group._id]));
const trainerById = new Map(trainers.map((trainer) => [trainer._id, trainer]));

const fullCards = [];
for (const skillId of allSkillIds) {
  const cards = await callGena("api.skills.getSkill", [{ skillId }]);
  fullCards.push({ skillId, cards });
}

const allFieldNames = new Map();
for (const { cards } of fullCards) {
  for (const card of cards) {
    for (const key of Object.keys(card)) allFieldNames.set(key, (allFieldNames.get(key) || 0) + 1);
  }
}

const directions = fullCards.map(({ skillId, cards }) => {
  const ru = cards.find((card) => card.lang === "ru") || cards.find((card) => card.lang === "en") || cards[0] || {};
  const head = trainerById.get(ru.headId);
  const headName = head ? `${head.lastName || ""} ${head.firstName || ""}`.trim() : "";
  const languages = cards.map((card) => card.lang).filter(Boolean).join(", ");
  const visibleLanguages = cards
    .filter((card) => ["visible", "onlyTrial", "onlyAdmin"].includes(card.visibility))
    .map((card) => card.lang)
    .join(", ");

  return {
    skillId,
    title: compact(ru.title),
    headName,
    headId: compact(ru.headId),
    minAge: ru.minAge ?? "",
    maxAge: ru.maxAge ?? "",
    availability: ru.visibility === "visible" ? "Доступно" : compact(ru.visibility),
    maxDuration: ru.maxDuration ?? "",
    installer: compact(ru.downloadLink),
    presentationAttachmentId: compact(ru.presentationAttachmentId),
    operationSystems: compact(ru.operationSystems),
    tabletSystems: compact(ru.tabletSystems),
    needRemindAboutLesson: compact(ru.needRemindAboutLesson),
    format: formatFormats(ru.lessonsFormats),
    desc: compact(ru.desc),
    tildaLink: compact(ru.tildaLink),
    tildaLinkForParent: compact(ru.tildaLinkForParent),
    template: compact(ru.template),
    internalNote: compact(ru.note),
    payCoefficient: ru.payCoefficient ?? "",
    payCoefficientIF: ru.payCoefficientIF ?? "",
    payCoefficientGF: ru.payCoefficientGF ?? "",
    languageDirection: "Нет",
    noTrainerPayment: "",
    isDisplayingWish: compact(ru.isDisplayingWish),
    requiredParentWish: "",
    group: groupById.get(ru.groupId) || "",
    visibility: compact(ru.visibility),
    requiredSkillId: compact(ru.requiredSkillId),
    languages,
    visibleLanguages,
    downloadLink: compact(ru.downloadLink),
  };
}).sort((a, b) => a.title.localeCompare(b.title, "ru"));

const headers = [
  "skillId",
  "Название",
  "Заведующий",
  "headId",
  "Мин. возраст",
  "Макс. возраст",
  "Доступность для записи",
  "Максимальная длительность",
  "Установщик",
  "Видео презентация",
  "ОС",
  "Планшет",
  "Пинок по АЗ",
  "Формат",
  "Описание направления",
  "Страница на Tilda",
  "Ссылка для ЛК с Tilda",
  "Шаблон",
  "Внутренняя заметка",
  "Коэффициент",
  "ИГФ",
  "ИФ",
  "ГФ",
  "Языковое направление",
  "Без оплаты тренеру",
  "Отображение пожелания родителя",
  "Обязательное пожелание родителя",
  "Группа",
  "visibility",
  "requiredSkillId",
  "languages",
  "visibleLanguages",
  "downloadLink",
];

const rowFor = (row) => [
  row.skillId,
  row.title,
  row.headName,
  row.headId,
  row.minAge,
  row.maxAge,
  row.availability,
  row.maxDuration,
  row.installer,
  row.presentationAttachmentId,
  row.operationSystems,
  row.tabletSystems,
  row.needRemindAboutLesson,
  row.format,
  row.desc,
  row.tildaLink,
  row.tildaLinkForParent,
  row.template,
  row.internalNote,
  row.payCoefficient,
  row.payCoefficient,
  row.payCoefficientIF,
  row.payCoefficientGF,
  row.languageDirection,
  row.noTrainerPayment,
  row.isDisplayingWish,
  row.requiredParentWish,
  row.group,
  row.visibility,
  row.requiredSkillId,
  row.languages,
  row.visibleLanguages,
  row.downloadLink,
];

await fs.mkdir(exportsDir, { recursive: true });
await fs.mkdir(docsDir, { recursive: true });
await fs.writeFile(path.join(kbDir, "gena_directions_full.json"), JSON.stringify(directions, null, 2), "utf8");
await fs.writeFile(path.join(docsDir, "gena_full_skill_fields.json"), JSON.stringify([...allFieldNames.entries()].sort((a, b) => b[1] - a[1]), null, 2), "utf8");
await fs.writeFile(
  path.join(exportsDir, "Gena_Directions.csv"),
  "\uFEFF" + [headers, ...directions.map(rowFor)].map((row) => row.map(csvEscape).join(";")).join("\r\n"),
  "utf8"
);

await fs.copyFile(workbookPath, backupPath);
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));

let directionsSheet;
try {
  directionsSheet = workbook.worksheets.getItem("Gena_Directions");
} catch {
  directionsSheet = workbook.worksheets.add("Gena_Directions");
}
directionsSheet.getRangeByIndexes(0, 0, directions.length + 1, headers.length).values = [
  headers,
  ...directions.map(rowFor),
];
directionsSheet.freezePanes.freezeRows(1);
directionsSheet.freezePanes.freezeColumns(2);
directionsSheet.getRangeByIndexes(0, 0, 1, headers.length).format = {
  fill: "#1F4E79",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
  horizontalAlignment: "center",
};
directionsSheet.getRangeByIndexes(1, 0, directions.length, headers.length).format = {
  wrapText: true,
  verticalAlignment: "top",
};
[
  90, 220, 170, 150, 90, 90, 130, 120, 260, 150, 190, 150, 100, 230, 420, 240, 240,
  460, 620, 100, 80, 80, 80, 130, 130, 150, 150, 180, 120, 130, 140, 140, 260,
].forEach((width, index) => {
  directionsSheet.getRangeByIndexes(0, index, directions.length + 1, 1).format.columnWidthPx = width;
});
directionsSheet.getRangeByIndexes(1, 0, directions.length, headers.length).format.rowHeightPx = 95;
try { directionsSheet.tables.add(`A1:AG${directions.length + 1}`, true, "GenaDirectionsFull"); } catch {}

const kb = workbook.worksheets.getItem("Knowledge_Base");
const kbValues = kb.getUsedRange().values;
const mapUpdates = {
  1: "Gena_Directions: Название, Мин. возраст, Макс. возраст",
  2: "Gena_Directions: Доступность для записи, Формат, visibility",
  3: "Gena_Directions: Заведующий, headId",
  4: "Gena_Directions: Описание направления, Внутренняя заметка, Установщик",
  5: "Gena_Directions: Название, Группа, Описание направления, Внутренняя заметка, Мин./Макс. возраст",
  12: "Gena_Directions: Установщик, Внутренняя заметка, ОС, Планшет",
  18: "Gena_Directions: Описание направления, Внутренняя заметка, Установщик для направления нейросетей",
  20: "Gena_Directions: Установщик, Внутренняя заметка, visibility, Формат",
  24: "Gena_Directions: Доступность для записи, visibility, requiredSkillId, Мин./Макс. возраст, Внутренняя заметка",
  27: "Gena_Directions: Описание направления, Внутренняя заметка, Установщик",
  30: "Gena_Directions: Название, Доступность для записи, Описание направления",
  31: "Gena_Directions: languages, visibleLanguages, downloadLink",
  33: "Gena_Directions: ОС, Планшет, Внутренняя заметка",
  42: "Gena_Directions: Название, Группа, Описание, возраст, ОС/Планшет, requiredSkillId",
  45: "Gena_Directions: Описание направления, Внутренняя заметка, Установщик",
};
const sourceUpdates = {
  3: "Гена: полная карточка направления",
};
const answerUpdates = {
  3: "Ответ для сотрудника: «За направление {направление} отвечает {Заведующий из Гены}». Если в полной карточке направления заведующий не заполнен, сказать: «В Гене не указан заведующий направления {направление}; уточните у руководителя методистов или в чате методистов».",
};
const noteUpdates = {
  3: "Заведующий берется из полной карточки направления: headId -> api.users.getTrainersWithFullName({}).",
  12: "Установщик берется из поля downloadLink полной карточки направления; внутренние детали — из note.",
  20: "Для пробного проверять downloadLink/note полной карточки и onlyTrial-направления.",
};
for (let i = 1; i < kbValues.length; i++) {
  const id = Number(kbValues[i][0]);
  if (mapUpdates[id]) kbValues[i][7] = mapUpdates[id];
  if (sourceUpdates[id]) kbValues[i][6] = sourceUpdates[id];
  if (answerUpdates[id]) kbValues[i][8] = answerUpdates[id];
  if (noteUpdates[id]) kbValues[i][17] = noteUpdates[id];
}
kb.getUsedRange().values = kbValues;

const api = workbook.worksheets.getItem("API_Mapping");
const apiValues = api.getUsedRange().values;
const existingObjects = new Set(apiValues.slice(1).map((row) => row[0]));
const addRows = [
  [
    "skill_full_card",
    "Полная карточка направления: заведующий, внутренняя заметка, шаблон, установщик, Tilda, коэффициенты, ОС/планшет",
    "methodName: api.skills.getSkill; params: [{ skillId }]",
    "direction_owner_lookup; direction_content_check; installer_required; trial_installer_required; ai_course_tools; methodology_basis; custom_request_handling",
    "Это основной источник для карточки направления. Список api.skills.getSkillsList удобен для поиска, но полные поля нужно брать отсюда.",
  ],
  [
    "trainers_full_name",
    "Расшифровка headId в имя заведующего/тренера",
    "methodName: api.users.getTrainersWithFullName; params: [{}]",
    "direction_owner_lookup; teacher_language_availability; special_needs_teacher_match",
    "Для заведующего: взять headId из api.skills.getSkill и найти пользователя по _id. Для Scratch headId=sWz3o373r3Mgff2Ec -> Мурина Ольга.",
  ],
];
const mergedApiValues = existingObjects.has("skill_full_card")
  ? apiValues
  : [...apiValues, ...addRows];
api.getRangeByIndexes(0, 0, mergedApiValues.length, mergedApiValues[0].length).values = mergedApiValues;
api.getRangeByIndexes(1, 0, mergedApiValues.length - 1, mergedApiValues[0].length).format = { wrapText: true, verticalAlignment: "top" };

await workbook.inspect({ kind: "table", range: "Gena_Directions!A1:AG6", include: "values", tableMaxRows: 6, tableMaxCols: 33 });
await workbook.inspect({ kind: "table", range: "Knowledge_Base!A1:R6", include: "values", tableMaxRows: 6, tableMaxCols: 18 });
await workbook.render({ sheetName: "Gena_Directions", range: "A1:AG12", scale: 1, format: "png" });

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);

console.log(workbookPath);
console.log(backupPath);
console.log(path.join(exportsDir, "Gena_Directions.csv"));
