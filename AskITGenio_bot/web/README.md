# AskITGenio web

Локальная веб-страница для тестирования ответов бота.

## Запуск

```powershell
cd D:\AskITGenio_bot\web
node .\server.mjs
```

Откройте `http://localhost:5177`.

## Источники

Сервер читает локальные файлы проекта:

- `D:\AskITGenio_bot\knowledge_base\exports\AskITGenio_Knowledge_Base.csv`
- `D:\AskITGenio_bot\knowledge_base\exports\Gena_Directions.csv`
- `D:\AskITGenio_bot\docs\notion_text_index.json`

Токены Гены и Notion не попадают в браузер. Для теста страница использует уже сохраненные локальные выгрузки.
