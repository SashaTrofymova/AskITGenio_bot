import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(require.resolve("@oai/artifact-tool")).href);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const docsDir = path.join(projectDir, "docs");
const kbDir = path.join(projectDir, "knowledge_base");
const workbookPath = path.join(kbDir, "AskITGenio_knowledge_base.xlsx");
const backupPath = path.join(kbDir, "AskITGenio_knowledge_base.before_user_facing_answers.xlsx");
const probePath = path.join(docsDir, "gena_probe_results.json");
const directionsJsonPath = path.join(kbDir, "gena_directions.json");
const directionsCsvPath = path.join(kbDir, "exports", "Gena_Directions.csv");

const probe = JSON.parse(await fs.readFile(probePath, "utf8"));
const getResult = (methodName, predicate = () => true) => {
  const item = probe.find((entry) => entry.methodName === methodName && entry.body?.status === "ok" && predicate(entry));
  if (!item) throw new Error(`No successful result for ${methodName}`);
  return item.body.result;
};

const skillsById = getResult("api.skills.getSkills");
const skillsList = getResult("api.skills.getSkillsList", (entry) => JSON.stringify(entry.params) === "[{}]");

const groupById = new Map();
for (const groupBlock of skillsList) {
  const group = groupBlock.group || {};
  groupById.set(group.groupId, group.title?.ru || group.title?.en || group.groupId || "");
}

const compact = (value) => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value)
    .replaceAll("&NewLine;", "\n")
    .replace(/\\([#\-])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const directions = Object.entries(skillsById).map(([skillId, variants]) => {
  const languageCodes = Object.keys(variants);
  const ru = variants.ru || variants.en || Object.values(variants)[0] || {};
  const visibleLanguages = languageCodes
    .filter((lang) => ["visible", "onlyTrial", "onlyAdmin"].includes(variants[lang]?.visibility))
    .join(", ");
  return {
    skillId,
    title: compact(ru.title),
    group: groupById.get(ru.groupId) || "",
    visibility: compact(ru.visibility),
    minAge: ru.minAge ?? "",
    maxAge: ru.maxAge ?? "",
    requiredSkillId: ru.requiredSkillId || "",
    lessonsFormats: compact(ru.lessonsFormats),
    operationSystems: compact(ru.operationSystems),
    tabletSystems: compact(ru.tabletSystems),
    languages: languageCodes.join(", "),
    visibleLanguages,
    desc: compact(ru.desc),
    note: compact(ru.note),
    downloadLink: compact(ru.downloadLink),
    tildaLinkForParent: compact(ru.tildaLinkForParent),
  };
}).sort((a, b) => a.title.localeCompare(b.title, "ru"));

const csvEscape = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

await fs.writeFile(directionsJsonPath, JSON.stringify(directions, null, 2), "utf8");
await fs.mkdir(path.dirname(directionsCsvPath), { recursive: true });
const directionHeaders = [
  "skillId",
  "title",
  "group",
  "visibility",
  "minAge",
  "maxAge",
  "requiredSkillId",
  "lessonsFormats",
  "operationSystems",
  "tabletSystems",
  "languages",
  "visibleLanguages",
  "desc",
  "note",
  "downloadLink",
  "tildaLinkForParent",
];
await fs.writeFile(
  directionsCsvPath,
  "\uFEFF" + [directionHeaders, ...directions.map((row) => directionHeaders.map((key) => row[key]))]
    .map((row) => row.map(csvEscape).join(";"))
    .join("\r\n"),
  "utf8"
);

const answerRows = {
  1: {
    source: "Гена: Gena_Directions, поля title, minAge, maxAge",
    where: "Лист Gena_Directions или карточка направления в Гене",
    answer: "Ответ для сотрудника: «На {направление} можно записаться с {minAge} лет». Если в Гене заполнен maxAge, добавить: «обычно до {maxAge} лет». Если возраст в Гене не заполнен, сказать: «В Гене возраст для {направление} не указан, нужно уточнить у заведующего направления».",
    note: "Бот подставляет minAge/maxAge из Гены. Без возраста не отвечает числом."
  },
  2: {
    source: "Гена: Gena_Directions, поля visibility, lessonsFormats",
    where: "Лист Gena_Directions или карточка направления в Гене",
    answer: "Ответ для сотрудника: если направление видимо и нужный формат есть в Гене, сказать: «Да, {направление} доступно для этого формата». Если направление скрыто или нужного формата нет, сказать: «В Гене сейчас нет подтверждения, что {направление} доступно для этого формата; лучше уточнить у продаж или заведующего направления».",
    note: "Нужно подтвердить расшифровку кодов lessonsFormats, чтобы бот уверенно отличал форматы."
  },
  3: {
    source: "Нужен отдельный источник: владельцы направлений",
    where: "Пока не найдено в Гене; уточнять у руководителя методистов",
    answer: "Ответ для сотрудника: «В текущих данных Гены я не вижу заведующего направлением {направление}. Уточните, пожалуйста, у руководителя методистов или в чате методистов». Не называть ответственного без отдельной таблицы владельцев направлений.",
    note: "В данных направлений из Гены нет поля заведующего."
  },
  4: {
    source: "Гена: Gena_Directions, поля desc, note, downloadLink",
    where: "Лист Gena_Directions, описание/заметка направления, материал по ссылке downloadLink",
    answer: "Ответ для сотрудника: если в описании или заметке направления есть нужная тема, сказать: «Да, на {направление} есть {тема}: {краткое подтверждение из Гены}». Если темы нет, сказать: «В актуальном описании {направление} тема {тема} не указана. Можно уточнить у заведующего направления или подобрать ближайшее направление».",
    note: "Бот ищет тему в desc/note/downloadLink. Если не нашел, не обещает обучение теме."
  },
  5: {
    source: "Гена: Gena_Directions, поля title, group, desc, note, minAge, requiredSkillId",
    where: "Лист Gena_Directions",
    answer: "Ответ для сотрудника: «Под запрос {интерес} подходят: {1-3 направления}. Почему: {короткое совпадение из описания Гены}. По возрасту: {minAge/maxAge}. Если у направления есть prerequisite, добавить: «лучше после {requiredSkillId/предыдущего направления}». Если совпадение слабое, сначала уточнить возраст, опыт, цель и устройство ребенка.",
    note: "Бот подбирает варианты по названию, группе, описанию, заметке и возрасту."
  },
  12: {
    source: "Гена: Gena_Directions, поля note, operationSystems, tabletSystems",
    where: "Лист Gena_Directions, заметка направления",
    answer: "Ответ для сотрудника: если в заметке Гены указана установка, сказать: «Да, для {направление} нужна предварительная установка/помощь установщика: {что именно указано в Гене}». Если в заметке явно написано, что ничего устанавливать не нужно, сказать: «Для {направление} установщик не нужен». Если в Гене нет такой информации, сказать: «Не вижу подтверждения в Гене, нужно уточнить в техподдержке».",
    note: "В Гене нет отдельного поля installerRequired, проверяем текст заметки."
  },
  18: {
    source: "Гена: Gena_Directions, направление по нейросетям, поля desc, note, downloadLink",
    where: "Лист Gena_Directions и материал направления",
    answer: "Ответ для сотрудника: «На курсе по нейросетям используются инструменты, которые указаны в Гене: {список из описания/заметки/материала}. Актуальный набор может меняться, поэтому если инструмент не указан в Гене, его не обещаем». Если список инструментов в Гене не найден, сказать: «В описании Гены инструменты не перечислены, нужно уточнить у заведующего нейросетей».",
    note: "Бот не придумывает список AI-инструментов; берет только из Гены/материала."
  },
  20: {
    source: "Гена: Gena_Directions, поля visibility, note, lessonsFormats",
    where: "Лист Gena_Directions, заметка направления",
    answer: "Ответ для сотрудника: «На пробное по {направление}: {нужен/не нужен} установщик». Основание брать из заметки Гены. Если там написано, что перед пробным ничего устанавливать не нужно, отвечать «не нужен». Если указана подготовка или установка, отвечать «нужен» и перечислить ее. Если данных нет, сказать: «В Гене нет подтверждения по пробному, уточните в техподдержке».",
    note: "Важно отличать пробное от основного курса и onlyTrial-направления."
  },
  21: {
    source: "Нужен отдельный источник: таблица актуальности AI-сервисов",
    where: "Пока не найдено в Гене; уточнять у заведующего нейросетей/техподдержки",
    answer: "Ответ для сотрудника: «В Гене нет свежей проверки, работают ли эти нейросети в РФ/РБ и нужен ли VPN. Для точного ответа нужна таблица актуальности сервисов с датой проверки. Без нее не обещаем доступность». Если таблица появится, отвечать по ней: сервис, страна, работает/не работает, нужен ли VPN, дата проверки.",
    note: "В Gena_Directions нет статуса сервисов по странам."
  },
  24: {
    source: "Гена: Gena_Directions, поля visibility, minAge, maxAge, requiredSkillId, desc, note",
    where: "Лист Gena_Directions",
    answer: "Ответ для сотрудника: «Рекомендовать можно направления, которые подходят по возрасту, видимы для записи и соответствуют запросу в описании Гены. Не рекомендовать как первый шаг: скрытые направления, направления с prerequisite без нужной базы, неподходящие по возрасту или с ограничениями в заметке. Вместо запрета предлагать альтернативу: {альтернатива из Гены}».",
    note: "Это правило для рекомендаций поверх реальных полей Гены."
  },
  27: {
    source: "Гена: Gena_Directions, поля desc, note, downloadLink",
    where: "Лист Gena_Directions и материал направления",
    answer: "Ответ для сотрудника: «В Гене направление {направление} описано так: {краткое описание из desc/note}. Если в описании указана методика или основа, назвать ее. Если методика отдельно не указана, сказать: «Методическая основа в Гене не прописана, нужно уточнить у заведующего направления». Не придумывать педагогическую систему».",
    note: "Для методической основы часто нужен владелец направления, если ее нет в описании."
  },
  28: {
    source: "Нужен отдельный источник: справочник услуг/продаж",
    where: "Пока не найдено в данных направлений Гены",
    answer: "Ответ для сотрудника: «В данных направлений Гены нет услуги по поступлению, подбору вуза или консультации по поступлению. Мы можем развивать навыки в рамках направлений, но не обещаем поступление и не заменяем консультацию приемной комиссии/профориентолога. Нестандартный запрос передать в продажи или продукт».",
    note: "Нужен отдельный справочник услуг, если такая услуга есть."
  },
  30: {
    source: "Гена: Gena_Directions, поля title, visibility, desc",
    where: "Лист Gena_Directions",
    answer: "Ответ для сотрудника: если направление найдено в Гене, сказать: «Да, у нас есть {направление}. Кратко: {desc}. Возраст: с {minAge}, если указан». Если направление найдено, но скрыто/только для админов, сказать: «В Гене направление есть, но обычную запись нужно уточнить». Если не найдено, сказать: «В актуальном списке Гены такого направления нет» и предложить ближайшие похожие направления из Гены.",
    note: "Бот ищет по названию и описанию, не обещает запуск нового направления."
  },
  31: {
    source: "Гена: Gena_Directions, поля languages, visibleLanguages, downloadLink",
    where: "Лист Gena_Directions",
    answer: "Ответ для сотрудника: «По {направление} в Гене есть языковые версии: {languages}. Доступные/видимые версии: {visibleLanguages}». Если нужного языка нет, сказать: «В Гене материалы/версия на {язык} не указаны». Не обещать перевод или наличие полного комплекта материалов без подтверждения по материалам.",
    note: "GENA показывает языковые версии направления; полный комплект материалов может требовать проверки downloadLink/materials."
  },
  32: {
    source: "Нужен отдельный источник: CRM/таблица тренеров",
    where: "Пока не найдено в данных направлений Гены",
    answer: "Ответ для сотрудника: «По Гене видно языковые версии направления, но не видно готовность конкретных тренеров вести на этом языке. Чтобы подтвердить занятия на {язык}, нужно проверить таблицу тренеров/CRM и расписание. Пока не подтверждено, отвечаем: “Можем проверить возможность и передать запрос координатору тренеров”».",
    note: "Данные направлений не подтверждают наличие свободного тренера."
  },
  33: {
    source: "Гена: Gena_Directions, поля operationSystems, tabletSystems, note",
    where: "Лист Gena_Directions",
    answer: "Ответ для сотрудника: «Для {направление} подходят устройства/ОС: {operationSystems}; планшеты: {tabletSystems или “не указаны”}. Если в заметке написано, что нужен компьютер/ноутбук, сказать это прямо. Если планшет разрешен, уточнить ограничения. Телефон считать неподтвержденным, если он прямо не указан в Гене».",
    note: "Бот берет устройства из operationSystems/tabletSystems/note."
  },
  42: {
    source: "Гена: Gena_Directions, поля title, group, desc, minAge, maxAge, requiredSkillId, operationSystems, tabletSystems",
    where: "Лист Gena_Directions",
    answer: "Ответ для сотрудника: «По профилю ученика подходят {1-3 направления из Гены}. Обоснование: возраст подходит ({minAge/maxAge}), запрос совпадает с описанием ({краткое совпадение}), устройство подходит ({operationSystems/tabletSystems}). Если данных о возрасте, цели или устройстве не хватает, сначала задать уточняющие вопросы».",
    note: "Главный сценарий рекомендаций по реальным данным Гены."
  },
  43: {
    source: "Нужен отдельный источник: регламент инклюзии и таблица тренеров",
    where: "Пока не найдено в данных направлений Гены",
    answer: "Ответ для сотрудника: «В данных направлений Гены нет отметки, какие тренеры готовы работать с РАС или другими особенностями. Мы не даем медицинских советов и не обещаем тренера без проверки. Нужно передать запрос координатору тренеров/ответственному за инклюзию и уточнить подходящий формат».",
    note: "Нужна отдельная таблица special_needs_ready или регламент."
  },
  45: {
    source: "Гена: Gena_Directions, поля desc, note, downloadLink",
    where: "Лист Gena_Directions и материал направления",
    answer: "Ответ для сотрудника: если тема есть в описании/заметке/материале Гены, сказать: «Да, на {направление} изучают {тема}: {подтверждение из Гены}». Если темы нет, сказать: «В актуальном описании {направление} тема {тема} не указана». Затем предложить ближайшую тему/направление из Гены или передать запрос заведующему направления.",
    note: "Бот не обещает кастомизацию без подтверждения."
  },
};

await fs.copyFile(workbookPath, backupPath);

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const kb = workbook.worksheets.getItem("Knowledge_Base");
const used = kb.getUsedRange();
const values = used.values;

for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
  const id = Number(values[rowIndex][0]);
  const update = answerRows[id];
  if (!update) continue;
  values[rowIndex][6] = update.source;
  values[rowIndex][7] = "Данные берутся из Гены; технические детали см. docs/GENA_API_notes.md";
  values[rowIndex][8] = update.answer;
  values[rowIndex][9] = update.where;
  values[rowIndex][12] = "на проверке";
  values[rowIndex][17] = update.note;
}

used.values = values;
kb.getRangeByIndexes(1, 6, values.length - 1, 4).format = { wrapText: true, verticalAlignment: "top" };
kb.getRangeByIndexes(1, 17, values.length - 1, 1).format = { wrapText: true, verticalAlignment: "top" };
kb.getRangeByIndexes(0, 6, values.length, 1).format.columnWidthPx = 300;
kb.getRangeByIndexes(0, 7, values.length, 1).format.columnWidthPx = 250;
kb.getRangeByIndexes(0, 8, values.length, 1).format.columnWidthPx = 620;
kb.getRangeByIndexes(0, 9, values.length, 1).format.columnWidthPx = 300;
kb.getRangeByIndexes(0, 17, values.length, 1).format.columnWidthPx = 310;
kb.getRangeByIndexes(1, 0, values.length - 1, values[0].length).format.rowHeightPx = 115;

let directionsSheet;
try {
  directionsSheet = workbook.worksheets.getItem("Gena_Directions");
} catch {
  directionsSheet = workbook.worksheets.add("Gena_Directions");
}

directionsSheet.getRangeByIndexes(0, 0, directions.length + 1, directionHeaders.length).values = [
  directionHeaders,
  ...directions.map((row) => directionHeaders.map((key) => row[key])),
];
directionsSheet.freezePanes.freezeRows(1);
directionsSheet.getRangeByIndexes(0, 0, 1, directionHeaders.length).format = {
  fill: "#1F4E79",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
  horizontalAlignment: "center",
};
directionsSheet.getRangeByIndexes(1, 0, directions.length, directionHeaders.length).format = {
  wrapText: true,
  verticalAlignment: "top",
};
[90, 220, 180, 110, 80, 80, 120, 120, 200, 170, 140, 140, 420, 520, 260, 260]
  .forEach((width, index) => {
    directionsSheet.getRangeByIndexes(0, index, directions.length + 1, 1).format.columnWidthPx = width;
  });
directionsSheet.getRangeByIndexes(1, 0, directions.length, directionHeaders.length).format.rowHeightPx = 80;
try { directionsSheet.tables.add(`A1:P${directions.length + 1}`, true, "GenaDirections"); } catch {}

await workbook.inspect({
  kind: "table",
  range: "Knowledge_Base!A1:R6",
  include: "values",
  tableMaxRows: 6,
  tableMaxCols: 18,
});
await workbook.inspect({
  kind: "table",
  range: "Gena_Directions!A1:P8",
  include: "values",
  tableMaxRows: 8,
  tableMaxCols: 16,
});
await workbook.render({ sheetName: "Knowledge_Base", range: "A1:R12", scale: 1, format: "png" });
await workbook.render({ sheetName: "Gena_Directions", range: "A1:P12", scale: 1, format: "png" });

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);
console.log(workbookPath);
console.log(backupPath);
console.log(directionsJsonPath);
console.log(directionsCsvPath);
