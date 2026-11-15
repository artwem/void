# Разделение Drive backend и Telegram-бота

## Цель

Упростить сопровождение и полное отключение Telegram-бота, сохранив один Apps Script-проект, общий Drive JSON и текущее поведение PWA, Mini App, бота и синхронизации.

## Решение

- `apps-script/Code.gs` остаётся самостоятельным backend: `doPost`/`doGet`, Drive, чтение и запись данных, резервные копии, SHA-256 и общие константы.
- `apps-script/Telegram.gs` содержит Telegram API, webhook/polling, клавиатуру, добавление и отмену расходов, а также merge расходов с `source:'telegram'`.
- Точка входа backend вызывает `_telegramHandleUpdate(body, parameters)`, только если модуль присутствует. Без `Telegram.gs` Telegram-обновления игнорируются, а Drive API работает.
- `saveData()` вызывает `_mergeTelegramExpenses(currentDb, incomingDb)`, только если эта функция присутствует.
- `disableTelegram()` удаляет все триггеры `pollTelegramUpdates`, затем вызывает `deleteTelegramWebhook()`. Script Properties и расходы сохраняются для возможного повторного включения.
- В редактор Apps Script для работы бота копируются оба файла. Для одного Drive backend достаточно `Code.gs`.

## Ограничения и нецели

- Не разделять проект на два независимо развёртываемых Apps Script-проекта: общие блокировки и защита от гонок должны сохраниться.
- Не менять протокол, `VERSION`, `APPS_SCRIPT_VERSION`, версию PWA или service worker.
- Не менять Telegram Mini App и клиентский адаптер.
- Не удалять Script Properties, старые расходы или резервные копии при отключении.
- Ручной ввод произвольной суммы по категориям в Telegram — возможное следующее расширение `Telegram.gs`, но не часть этой работы.

## Проверка

- `disableTelegram()` идемпотентно удаляет только триггеры polling и отключает webhook; при ошибке Bot API триггеры уже удалены.
- Существующие проверки bot/sync проходят при совместной загрузке обоих файлов в один VM-контекст.
- Backend без `Telegram.gs` продолжает обрабатывать Drive push/pull и безопасно игнорирует Telegram-обновления.
- Полный `node tools/gs-check.mjs` и браузерный `node tools/dt-check.mjs` проходят.
