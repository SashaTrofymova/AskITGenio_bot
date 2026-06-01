import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(require.resolve("@oai/artifact-tool")).href);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const kbDir = path.join(projectDir, "knowledge_base");
const workbookPath = path.join(kbDir, "AskITGenio_knowledge_base.xlsx");
const backupPath = path.join(kbDir, "AskITGenio_knowledge_base.before_api_mapping_update.xlsx");

const kbMappings = {
  1: "Gena_Directions: title, minAge, maxAge",
  2: "Gena_Directions: visibility, lessonsFormats",
  3: "Не найдено в Gena_Directions; нужен источник owners",
  4: "Gena_Directions: desc, note, downloadLink",
  5: "Gena_Directions: title, group, desc, note, minAge, requiredSkillId",
  12: "Gena_Directions: note, operationSystems, tabletSystems",
  18: "Gena_Directions: desc, note, downloadLink; при необходимости Materials",
  20: "Gena_Directions: visibility, note, lessonsFormats",
  21: "Не найдено в Gena_Directions; нужна таблица AI services status",
  24: "Gena_Directions: visibility, minAge, maxAge, requiredSkillId, desc, note",
  27: "Gena_Directions: desc, note, downloadLink",
  28: "Не найдено в Gena_Directions; нужен справочник услуг/продаж",
  30: "Gena_Directions: title, visibility, desc, minAge",
  31: "Gena_Directions: languages, visibleLanguages, downloadLink",
  32: "Не найдено в Gena_Directions; нужен источник trainers/languages/availability",
  33: "Gena_Directions: operationSystems, tabletSystems, note",
  42: "Gena_Directions: title, group, desc, minAge, maxAge, requiredSkillId, devices",
  43: "Не найдено в Gena_Directions; нужен источник inclusion/special_needs_ready",
  45: "Gena_Directions: desc, note, downloadLink; при необходимости Materials",
};

const apiRows = [
  ["Объект", "Что нужно боту", "GENA API / источник", "Используется в интентах", "Комментарий для проекта"],
  [
    "gena_http_bridge",
    "Единая точка вызова методов Гены",
    "POST https://portal.itgen.io/api/gena; headers: authorization; body: { methodName, params }",
    "все GENA-интенты",
    "Токен хранить только на сервере будущей веб-страницы. Не класть в Excel, фронтенд, README или публичные файлы.",
  ],
  [
    "directions_snapshot",
    "Локальный снимок направлений, удобный для бота и редакторов базы",
    "Лист Gena_Directions; формируется из api.skills.getSkills и api.skills.getSkillsList({})",
    "direction_age_check; direction_availability_igf; direction_content_check; student_interest_to_direction; installer_required; trial_installer_required; direction_recommendation_policy; methodology_basis; missing_direction_handling; materials_language_availability; device_compatibility; student_profile_direction_match; custom_request_handling",
    "Это рабочий слой для сотрудников: здесь уже лежат названия, возраст, языки, устройства, описание и заметки без технических вызовов API.",
  ],
  [
    "skills_full",
    "Полные данные направлений по skillId и языковым версиям",
    "methodName: api.skills.getSkills; params: []",
    "direction_age_check; materials_language_availability; missing_direction_handling",
    "Возвращает объект, где ключ - skillId, внутри языковые версии ru/en/es/de/fr/he/ukr. Полезно для проверки языков, возраста, ссылок и видимости.",
  ],
  [
    "skills_list",
    "Список направлений по группам, удобный для поиска и рекомендаций",
    "methodName: api.skills.getSkillsList; params: [{}]",
    "student_interest_to_direction; direction_recommendation_policy; student_profile_direction_match; missing_direction_handling",
    "Возвращает массив групп со списком skills. Важные поля: title, desc, minAge, maxAge, visibility, lessonsFormats, operationSystems, tabletSystems, note.",
  ],
  [
    "skills_groups",
    "Группы направлений и порядок внутри групп",
    "methodName: api.skills.getSkillsGroups; params: []",
    "student_interest_to_direction; student_profile_direction_match; direction_recommendation_policy",
    "Нужно для понятных рекомендаций: программирование, дизайн, школьные предметы и т.п.",
  ],
  [
    "skills_order",
    "Порядок отображения направлений",
    "methodName: api.skills.getSkillsOrder; params: []",
    "student_interest_to_direction; missing_direction_handling",
    "Можно использовать, чтобы показывать рекомендации в привычном для Гены порядке.",
  ],
  [
    "skill_ids",
    "Список всех ID направлений",
    "methodName: api.skills.getAllSkillsIds; params: []",
    "missing_direction_handling; technical integrity checks",
    "Полезно для сверки полноты локального снимка Gena_Directions.",
  ],
  [
    "materials",
    "Материалы, уроки и детали программы, если desc/note недостаточно",
    "Кандидаты из бандла: api.materials.getMaterialsByFilter; api.materials.getMaterialDataById; api.materials.getModulesByFilter",
    "direction_content_check; ai_course_tools; custom_request_handling; materials_language_availability",
    "Методы найдены в клиентском бандле, но параметры нужно дополнительно подтвердить на реальных примерах. До подтверждения бот использует desc/note/downloadLink.",
  ],
  [
    "trainers",
    "Тренеры по языкам, направлениям и доступности",
    "Нужен отдельный подтвержденный источник; кандидаты из бандла: api.users.getTrainersWithFullName, api.users.getPublicTrainerDataById",
    "teacher_language_availability; special_needs_teacher_match",
    "Gena_Directions показывает языки направления, но не подтверждает, что есть свободный тренер на этом языке.",
  ],
  [
    "owners",
    "Заведующие/ответственные за направления",
    "Не найдено в api.skills.*",
    "direction_owner_lookup",
    "Нужна отдельная таблица владельцев или новое поле в Гене. Без нее бот не называет ответственного.",
  ],
  [
    "ai_services_status",
    "Актуальность AI-инструментов по странам, РФ/РБ и VPN",
    "Не найдено в api.skills.*",
    "ai_tools_availability",
    "Нужна отдельная таблица с сервисом, страной, статусом, VPN и датой проверки.",
  ],
  [
    "sales_services",
    "Услуги поступления, подбора вуза, консультаций",
    "Не найдено в api.skills.*",
    "admission_consulting",
    "Нужен справочник услуг/продаж. Через направления Гены такие обещания делать нельзя.",
  ],
  [
    "inclusion",
    "Готовность тренеров работать с РАС/особыми запросами",
    "Не найдено в api.skills.*",
    "special_needs_teacher_match",
    "Нужен регламент инклюзии и таблица/CRM с отметкой готовности тренера.",
  ],
  [
    "formats_dictionary",
    "Расшифровка кодов lessonsFormats",
    "Нужен словарь кодов платформы",
    "direction_availability_igf; trial_installer_required; direction_recommendation_policy",
    "В данных направлений есть lessonsFormats, но для уверенного ответа нужно закрепить, какой код означает какой формат.",
  ],
];

await fs.copyFile(workbookPath, backupPath);

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const kb = workbook.worksheets.getItem("Knowledge_Base");
const kbValues = kb.getUsedRange().values;

for (let rowIndex = 1; rowIndex < kbValues.length; rowIndex += 1) {
  const id = Number(kbValues[rowIndex][0]);
  if (kbMappings[id]) {
    kbValues[rowIndex][7] = kbMappings[id];
  }
}

kb.getUsedRange().values = kbValues;
kb.getRangeByIndexes(1, 7, kbValues.length - 1, 1).format = { wrapText: true, verticalAlignment: "top" };
kb.getRangeByIndexes(0, 7, kbValues.length, 1).format.columnWidthPx = 330;

const api = workbook.worksheets.getItem("API_Mapping");
api.getRangeByIndexes(0, 0, apiRows.length, apiRows[0].length).values = apiRows;
api.getRangeByIndexes(0, 0, 1, apiRows[0].length).format = {
  fill: "#1F4E79",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
  horizontalAlignment: "center",
};
api.getRangeByIndexes(1, 0, apiRows.length - 1, apiRows[0].length).format = {
  wrapText: true,
  verticalAlignment: "top",
};
[190, 310, 360, 330, 420].forEach((width, index) => {
  api.getRangeByIndexes(0, index, apiRows.length, 1).format.columnWidthPx = width;
});
api.getRangeByIndexes(1, 0, apiRows.length - 1, apiRows[0].length).format.rowHeightPx = 95;
try { api.tables.add(`A1:E${apiRows.length}`, true, "ApiMappingUpdated"); } catch {}

await workbook.inspect({
  kind: "table",
  range: "API_Mapping!A1:E15",
  include: "values",
  tableMaxRows: 15,
  tableMaxCols: 5,
});
await workbook.inspect({
  kind: "table",
  range: "Knowledge_Base!A1:R6",
  include: "values",
  tableMaxRows: 6,
  tableMaxCols: 18,
});
await workbook.render({ sheetName: "API_Mapping", range: "A1:E15", scale: 1, format: "png" });

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);

console.log(workbookPath);
console.log(backupPath);
