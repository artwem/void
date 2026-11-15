# Application hygiene cleanup

## Цель

Удалить только подтверждённый аудитом мусор, не меняя поведение приложения, зависимости или пользовательские данные.

## Решение

- Добавить `.DS_Store` и `.claude/settings.local.json` в `.gitignore`.
- Удалить два локальных `.DS_Store`; `settings.local.json` убрать из git index, но оставить локально как игнорируемый файл.
- Удалить production-helper `_orphanExpenseCount()`; тест сирот `catId` считает их непосредственно через `DB.expenses.filter(...)`, а `CLAUDE.md` описывает поведение без ссылки на helper.
- Повысить PWA до `v1.91.4` и обновить service worker cache из-за изменения `index.html`.
- Не обновлять Puppeteer в этой задаче, не трогать backups, миграции, docs и runtime-зависимости.

## Проверка

- Тест сирот продолжает проверять то же поведение без production-helper.
- Полные `gs-check`, `dt-check`, syntax check и runtime check проходят.
- `git status` не содержит `.DS_Store` или `settings.local.json`.
