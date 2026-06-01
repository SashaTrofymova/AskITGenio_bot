# AskITGenio Bot

Локальный прототип веб-бота для тестирования ответов AskITGenio.

Бот читает:

- таблицу базы знаний из `knowledge_base/exports/AskITGenio_Knowledge_Base.csv`
- API mapping из `knowledge_base/exports/AskITGenio_API_Mapping.csv`
- демо-сценарии из `knowledge_base/exports/AskITGenio_Demo_Script.csv`
- направления из безопасной выгрузки `knowledge_base/exports/Gena_Directions_public.csv`
- локальный индекс Notion из `docs/notion_text_index.json`

## Запуск

```powershell
npm start
```

Откройте `http://localhost:5177`.

## Обновление безопасной выгрузки направлений

Если локально обновился `Gena_Directions.csv`, перед коммитом выполните:

```powershell
npm run sanitize:gena
```

Сырая выгрузка `Gena_Directions.csv` не коммитится: в ней могут быть токенизированные ссылки на установщики и материалы.

## Секреты

Реальные `GENA_TOKEN` и `NOTION_TOKEN` храните только в `.env` или переменных окружения. Не коммитьте их в GitHub.
