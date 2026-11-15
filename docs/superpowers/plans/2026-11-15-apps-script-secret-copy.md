# Apps Script SECRET Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автоматически подставлять `DB.syncToken` в `SECRET` при копировании Apps Script.

**Architecture:** Объединённый исходник остаётся публичным и кэшируется без изменений. Токен сериализуется через `JSON.stringify` только при формировании текста для clipboard или fallback textarea.

**Tech Stack:** Vanilla JS, Puppeteer tests.

**Spec:** `docs/superpowers/specs/2026-11-15-apps-script-secret-copy-design.md`

## Global Constraints

- Не записывать токен в `_APPS_SCRIPT_CODE`, backups, Drive-payload или логи.
- PWA `v1.91.5`; Apps Script `11.2` и sync protocol не меняются.
- Не использовать реальный секрет в тестах.

## Review Focus

- Кавычки, backslash, Unicode и newline не ломают `const SECRET = ...`; проверяется в Task 1.
- Пустой токен оставляет `SECRET=''`; проверяется в Task 1.
- Fallback без clipboard содержит тот же код, что clipboard; проверяется в Task 1.

---

### Task 1: Подстановка SECRET при копировании

**Files:**
- Modify: `index.html`, `sw.js`, `tools/dt-check.mjs`, `README.md`, `AGENTS.md`, `CLAUDE.md`

**Interfaces:**
- Produces: `_appsScriptWithSecret(code: string): string` с единственной заменой `const SECRET = '';` через `JSON.stringify(DB.syncToken || '')`.
- Preserves: `loadAppsScriptCode(): Promise<string>` кэширует исходник без секрета.

- [ ] **Step 1: Добавить failing-тест**

В сюите копирования задать тестовый `DB.syncToken` с Unicode, кавычками, backslash и newline. Вызвать `copyAppsScript()`, проверить literal в clipboard, вызвать `showScriptModal()` и сравнить textarea. Проверить, что `_APPS_SCRIPT_CODE` токена не содержит, а пустой токен даёт `SECRET=''`.

- [ ] **Step 2: Запустить browser tests до реализации**

Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: FAIL, потому что clipboard не содержит сериализованный токен.

- [ ] **Step 3: Реализовать подстановку**

Добавить `_appsScriptWithSecret(code)` и использовать его в `copyAppsScript()` и `showScriptModal()`. Не менять кэш исходника.

- [ ] **Step 4: Обновить версию и документацию**

Установить About/SW `v1.91.4` → `v1.91.5`, обновить `AGENTS.md`; в `README.md` и `CLAUDE.md` указать автоматическую подстановку токена и его наличие в копируемом коде.

- [ ] **Step 5: Полная проверка**

Run: `node tools/gs-check.mjs`, полный `dt-check`, syntax check и `git diff --check`.
Expected: все PASS; секретные значения появляются только как явно заданный тестовый литерал.
