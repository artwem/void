# Apps Script SECRET copy

## Цель

При копировании Apps Script автоматически переносить токен из настроек приложения, чтобы пользователь не восстанавливал `SECRET` вручную.

## Решение

- `loadAppsScriptCode()` продолжает кэшировать только объединённый исходник без секрета.
- Новый `_appsScriptWithSecret(code)` заменяет ровно `const SECRET = '';` на `const SECRET = ${JSON.stringify(DB.syncToken || '')};`.
- `copyAppsScript()` и fallback `showScriptModal()` используют эту подстановку, поэтому clipboard и textarea содержат одинаковый готовый код.
- Токен не записывается в `_APPS_SCRIPT_CODE`, Drive-payload, backups или логи. Пустой токен сохраняет текущее поведение.
- PWA повышается до `v1.91.5`, Apps Script остаётся `11.2`.

## Проверка

- Тестовый токен с Unicode, кавычками, обратной косой чертой и переводом строки сериализуется как валидный JS literal.
- Clipboard и fallback textarea содержат тот же литерал; кэшированный исходник токена не содержит.
- Полные `gs-check`, `dt-check` и syntax check проходят.
