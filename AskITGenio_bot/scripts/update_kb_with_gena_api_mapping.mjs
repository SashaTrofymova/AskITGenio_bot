import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(require.resolve("@oai/artifact-tool")).href);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const workbookPath = path.join(projectDir, "knowledge_base", "AskITGenio_knowledge_base.xlsx");
const backupPath = path.join(projectDir, "knowledge_base", "AskITGenio_knowledge_base.before_gena_api_mapping.xlsx");

const selectedIds = new Set([1, 2, 3, 4, 5, 12, 18, 20, 21, 24, 27, 28, 30, 31, 32, 33, 42, 43, 45]);

const rowsById = {
  1: {
    api: "POST /api/gena: api.skills.getSkills / api.skills.getSkillsList({}); поля minAge, maxAge, title, visibility",
    answer: "Проверить направление в Гене через api.skills.getSkills или api.skills.getSkillsList({}). Найти языковую версию направления, обычно ru, и взять minAge/maxAge. Если minAge заполнен, отвечать: «На {направление} можно записаться с {minAge} лет». Если maxAge заполнен, добавить верхнюю границу. Если возраста нет в полях направления, не придумывать возраст и передать вопрос заведующему направления.",
    note: "GENA подтверждает поля minAge/maxAge у части направлений. Если поле пустое, нужен владелец направления."
  },
  2: {
    api: "POST /api/gena: api.skills.getSkillsList({}); поля visibility, lessonsFormats, payCoefficientIF/payCoefficientGF при наличии",
    answer: "Проверить направление в api.skills.getSkillsList({}). Доступность определять только по данным Гены: visibility и lessonsFormats. Если направление видимое и нужный формат есть в lessonsFormats, можно отвечать, что направление доступно в этом формате. Если visibility = hidden/invisibly/onlyAdmin или нужного формата нет, не обещать запись и предложить уточнить у продаж/заведующего направления.",
    note: "Нужно отдельно закрепить расшифровку кодов lessonsFormats, чтобы бот уверенно отличал ИФ/ГФ/ИГФ."
  },
  3: {
    api: "В найденных GENA skills-методах поля owner/заведующий нет",
    answer: "В найденных методах api.skills.* заведующий направлением не возвращается. Бот не должен отвечать из Гены на этот вопрос. Нужен отдельный источник: таблица владельцев направлений или поле owner в API. До появления источника отвечать: «В базе не нашел подтвержденного заведующего по {направление}; уточните у руководителя методистов/в чате методистов».",
    note: "Требуется доработка источника: owner/responsible для направления."
  },
  4: {
    api: "POST /api/gena: api.skills.getSkills / api.skills.getSkillsList({}); поля desc, note, downloadLink",
    answer: "Проверить desc, note и downloadLink по направлению. Если тема явно упомянута в desc/note или в документе по downloadLink, отвечать: «Да, тема {тема} есть в программе {направление}: {кратко где именно}». Если тема не найдена, отвечать: «В актуальном описании направления {направление} тема {тема} не указана». Не обещать, что тему добавят; предложить альтернативное направление или эскалацию заведующему.",
    note: "Для глубокого поиска по урокам может понадобиться api.materials.getMaterialsByFilter."
  },
  5: {
    api: "POST /api/gena: api.skills.getSkillsList({}), api.skills.getSkillsGroups; поля title, desc, groupId, minAge, requiredSkillId",
    answer: "Для подбора проверить title, desc, группу направления, minAge/maxAge и requiredSkillId. Дать 1-3 варианта с причиной: «Под запрос {интерес} подходят {направления}, потому что в описании/группе указано {обоснование}». Если интерес широкий, сначала уточнить возраст, опыт, цель и устройство. Не выбирать направление без совпадения в Гене.",
    note: "Можно строить поиск по title+desc+note и фильтровать по возрасту."
  },
  12: {
    api: "POST /api/gena: api.skills.getSkillsList({}); поля note, operationSystems, tabletSystems",
    answer: "Проверить note и технические поля направления. Если в note указано, что нужна установка/установщик/подготовка, ответить: «Да, для {направление} нужна предварительная установка/помощь установщика: {что именно}». Если в note явно сказано, что ничего устанавливать не нужно, так и ответить. Если в note нет информации, не говорить «не нужен» и передать вопрос в техподдержку или заведующему направления.",
    note: "В GENA нет отдельного булевого поля installerRequired; проверка идет по note."
  },
  18: {
    api: "POST /api/gena: api.skills.getSkillsList({}); для направления по нейросетям поля desc, note, downloadLink",
    answer: "Найти направление по нейросетям в api.skills.getSkillsList({}) и проверить desc, note, downloadLink. Перечислять только инструменты, которые прямо указаны в этих источниках. Формулировка: «В описании курса указаны {инструменты}. Актуальный набор может обновляться, поэтому проверяем по Гене/материалу направления». Если инструменты не перечислены, не придумывать список и передать вопрос заведующему нейросетей.",
    note: "Для точного списка инструментов может понадобиться материал по downloadLink или api.materials."
  },
  20: {
    api: "POST /api/gena: api.skills.getSkillsList({}); поля visibility=onlyTrial, note, lessonsFormats",
    answer: "Проверять требования именно для пробного: направление может иметь visibility=onlyTrial или отдельные заметки в note. Если note говорит, что перед пробным нужна установка/подготовка, ответить «нужна» и указать что именно. Если note явно говорит, что на пробное ничего устанавливать не нужно, ответить «не нужна». Если данных нет, не переносить требования полного курса на пробное без проверки.",
    note: "Для пробных важно отличать отдельные onlyTrial-направления от основного курса."
  },
  21: {
    api: "В найденных GENA skills-методах нет статуса AI-сервисов по странам/VPN",
    answer: "GENA skills не содержит проверенного статуса работы AI-инструментов по РФ/РБ и VPN. Бот должен отвечать только при наличии отдельной таблицы актуальности сервисов с датой проверки. Формат ответа: «По состоянию на {дата}: {сервис} работает/не работает в {страна}; VPN нужен/не нужен; ограничения: {если есть}». Если свежей проверки нет, сказать, что подтвержденных данных нет, и отправить к заведующему нейросетей/техподдержке.",
    note: "Нужен отдельный источник services/status или таблица актуальности AI-сервисов."
  },
  24: {
    api: "POST /api/gena: api.skills.getSkillsList({}), api.skills.getSkillsGroups; поля visibility, minAge, maxAge, requiredSkillId, groupId, desc, note",
    answer: "Рекомендовать направления по данным Гены: возраст, описание, группа, prerequisites и видимость. Не рекомендовать как стартовое направление, если visibility скрывает его от обычной записи, если есть requiredSkillId без выполненного prerequisite, если возраст не подходит или note содержит ограничение. Формулировать мягко: «Для этого запроса лучше начать с {альтернатива}, потому что у {направление} есть условие {условие}».",
    note: "Это можно автоматизировать как матрицу правил поверх fields из api.skills."
  },
  27: {
    api: "POST /api/gena: api.skills.getSkillsList({}); поля desc, note, downloadLink",
    answer: "По не-IT направлениям проверять desc, note и downloadLink. Отвечать только тем, что есть в описании: цели, структура, подход, материалы, возрастная логика. Если методическая система не названа, не добавлять ее самостоятельно. Ответ: «В Гене направление описано так: {краткое описание}. Методическая основа отдельно не указана; для точного ответа нужно уточнить у заведующего направления».",
    note: "Нужны более полные методические описания, если требуется педагогическая система."
  },
  28: {
    api: "В найденных GENA skills-методах нет услуги поступления/подбора вуза",
    answer: "Не отвечать через направления Гены, если вопрос про поступление, подбор вуза или консультации. Нужен справочник услуг/продаж. Если такой услуги в справочнике нет, безопасный ответ: «Мы можем развивать навыки в рамках наших программ, но не обещаем поступление и не заменяем консультацию приемной комиссии или профориентолога». Нестандартный запрос передать в продажи/продукт.",
    note: "Нужен отдельный источник: sales/services."
  },
  30: {
    api: "POST /api/gena: api.skills.getSkillsList({}), api.skills.getSkills; поля title, lang, visibility",
    answer: "Искать направление по title во всех языковых версиях api.skills.getSkills или в api.skills.getSkillsList({}). Если найдено и visibility позволяет запись, дать название и следующий шаг. Если найдено, но hidden/invisibly/onlyAdmin, не обещать запись и отправить на уточнение. Если не найдено, сказать: «В актуальном списке Гены такого направления нет», предложить ближайшие совпадения по title/desc и зафиксировать запрос для продукта.",
    note: "Можно сделать fuzzy-поиск по title + desc."
  },
  31: {
    api: "POST /api/gena: api.skills.getSkills; языковые ключи ru/en/es/de/fr/he/ukr, поля downloadLink, visibility",
    answer: "Проверить, есть ли у направления языковая версия с нужным lang и есть ли у нее downloadLink/описание. Если версия есть и не скрыта для нужного сценария, ответить: «По {направление} есть версия/материалы на {язык}». Если языковой версии нет или она скрыта, ответить, что в актуальной базе материалы на {язык} не указаны. Не обещать перевод без владельца локализации.",
    note: "GENA показывает языковые версии направлений; наличие полного комплекта материалов надо подтверждать по downloadLink/materials."
  },
  32: {
    api: "В api.skills нет готовности тренеров по языкам; кандидаты: api.users.getTrainersWithFullName / CRM, но нужен безопасный фильтр",
    answer: "Не использовать список направлений как подтверждение, что есть тренер на нужном языке. Нужно проверять CRM/таблицу тренеров с языком, направлением и текущей доступностью. Без такого источника ответ: «Можем проверить возможность занятий на {язык}; передам запрос координатору тренеров/админам». Не обещать конкретного тренера до подтверждения расписания.",
    note: "Нужен отдельный read-only метод/фильтр по trainers: directionId + language + availability."
  },
  33: {
    api: "POST /api/gena: api.skills.getSkillsList({}); поля operationSystems, tabletSystems, note",
    answer: "Проверить operationSystems, tabletSystems и note. Если tabletSystems заполнен или note разрешает планшет/телефон, указать условия. Если в operationSystems указан только desktop-набор или note говорит про компьютер/ноутбук, ответить: «Для {направление} нужен компьютер/ноутбук; телефон/планшет не подходит для полноценного занятия». Если данных нет, уточнить в техподдержке.",
    note: "Телефон как полноценное устройство в найденных полях отдельно не подтверждается."
  },
  42: {
    api: "POST /api/gena: api.skills.getSkillsList({}), api.skills.getSkillsGroups; поля title, desc, minAge, maxAge, groupId, requiredSkillId, operationSystems, tabletSystems",
    answer: "Собрать профиль ученика: возраст, запрос, опыт, цель, язык, устройство. Затем отфильтровать направления Гены по minAge/maxAge, языку, visibility, prerequisite и устройствам; ранжировать по совпадению запроса с title/desc/note. Ответить 1-3 вариантами с обоснованием и уточнениями. Если профиль неполный, сначала задать вопросы, а не выбирать одно направление.",
    note: "Это основной сценарий рекомендательного поиска по GENA skills."
  },
  43: {
    api: "В найденных GENA skills-методах нет готовности тренеров к РАС/особым запросам",
    answer: "Не давать медицинских советов и не обещать тренера через базу направлений. Нужен отдельный регламент инклюзии и таблица/CRM с отметкой готовности тренера работать с особыми запросами. Ответ: «Мы можем проверить подходящего тренера и формат; передам запрос координатору тренеров». При рисках безопасности эскалировать по регламенту.",
    note: "Нужен отдельный источник special_needs_ready или ручной маршрут через координатора."
  },
  45: {
    api: "POST /api/gena: api.skills.getSkillsList({}); поля desc, note, downloadLink; при необходимости api.materials.getMaterialsByFilter",
    answer: "Проверить тему в desc, note и материале по downloadLink. Если тема найдена, ответить, где она указана. Если темы нет, сказать: «В актуальном описании {направление} тема {тема} не указана». Затем предложить ближайшее направление/тему по поиску в Гене или передать кастомный запрос заведующему. Не обещать индивидуальную доработку программы без подтверждения.",
    note: "Для поиска внутри уроков нужен доступ к materials API или документу направления."
  }
};

await fs.copyFile(workbookPath, backupPath);

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const sheet = workbook.worksheets.getItem("Knowledge_Base");
const used = sheet.getUsedRange();
const values = used.values;

for (let r = 1; r < values.length; r += 1) {
  const id = Number(values[r][0]);
  if (!selectedIds.has(id)) continue;
  const update = rowsById[id];
  values[r][6] = update.api.includes("не") || update.api.includes("нет")
    ? values[r][6]
    : "GENA API: skills";
  values[r][7] = update.api;
  values[r][8] = update.answer;
  values[r][9] = "GENA API notes: docs/GENA_API_notes.md; результат probe: docs/gena_probe_results.json";
  values[r][12] = "на проверке";
  values[r][17] = update.note;
}

used.values = values;
sheet.getRangeByIndexes(1, 7, values.length - 1, 3).format = { wrapText: true, verticalAlignment: "top" };
sheet.getRangeByIndexes(1, 17, values.length - 1, 1).format = { wrapText: true, verticalAlignment: "top" };
sheet.getRangeByIndexes(0, 7, values.length, 1).format.columnWidthPx = 360;
sheet.getRangeByIndexes(0, 8, values.length, 1).format.columnWidthPx = 540;
sheet.getRangeByIndexes(0, 9, values.length, 1).format.columnWidthPx = 330;
sheet.getRangeByIndexes(0, 17, values.length, 1).format.columnWidthPx = 330;
sheet.getRangeByIndexes(1, 0, values.length - 1, values[0].length).format.rowHeightPx = 110;

await workbook.inspect({
  kind: "table",
  range: "Knowledge_Base!A1:R6",
  include: "values",
  tableMaxRows: 6,
  tableMaxCols: 18,
});

await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});

await workbook.render({ sheetName: "Knowledge_Base", range: "A1:R12", scale: 1, format: "png" });

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);
console.log(workbookPath);
console.log(backupPath);
