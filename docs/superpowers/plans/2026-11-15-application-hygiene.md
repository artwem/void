# Application Hygiene Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Удалить локальные служебные файлы и единственный test-only helper из production без изменения поведения.

**Architecture:** Git-игнорирование отделяет machine-local файлы от репозитория. Подсчёт сирот `catId` остаётся в тесте, который раньше вызывал production-helper; приложение больше не экспортирует эту функцию.

**Tech Stack:** Vanilla JS, Node/Puppeteer tests, git ignore.

**Spec:** `docs/superpowers/specs/2026-11-15-application-hygiene-design.md`

## Global Constraints

- Не менять финансовые данные, backups, миграции и зависимости.
- PWA `v1.91.4`; Apps Script `11.2` и sync protocol не меняются.
- `settings.local.json` остаётся локально, но игнорируется.

## Review Focus

- Сирота `catId` по-прежнему рисуется в категории 0 и возвращается после синка; существующий тест адаптируется в Task 1.
- Offline cache обновляется после изменения `index.html`; версия SW повышается в Task 1.
- Локальные backup и `.claude` skills не затрагиваются; проверяется финальным `git status`.

---

### Task 1: Удалить подтверждённый мусор

**Files:**
- Modify: `.gitignore`, `.claude/settings.local.json` (только untrack), `index.html`, `sw.js`, `tools/dt-check.mjs`, `CLAUDE.md`, `AGENTS.md`
- Delete locally: `.DS_Store`, `tools/.DS_Store`

**Interfaces:**
- Removes: `_orphanExpenseCount()` из глобального production scope.
- Test replacement: `DB.expenses.filter(e => e.catId && !DB.catIds.includes(e.catId) && !e._deleted).length`.

- [ ] **Step 1: Адаптировать тест и добавить failing-проверку удаления helper**

В тесте сирот использовать непосредственный подсчёт вместо `_orphanExpenseCount()`. Проверить `typeof _orphanExpenseCount === 'undefined'` — до удаления это FAIL, остальные ожидания сирот сохраняются.

- [ ] **Step 2: Запустить browser tests до удаления**

Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: FAIL только из-за присутствующего `_orphanExpenseCount`.

- [ ] **Step 3: Удалить helper и machine-local файлы**

Удалить функцию из `index.html`; добавить `.DS_Store` и `.claude/settings.local.json` в `.gitignore`; удалить локальные `.DS_Store`; выполнить `git rm --cached .claude/settings.local.json`, оставив файл на диске.

- [ ] **Step 4: Обновить версии и документацию**

Установить About/SW `v1.91.4`, обновить текущую версию в `AGENTS.md`; убрать ссылку на helper из `CLAUDE.md`, сохранив описание поведения сирот.

- [ ] **Step 5: Полная проверка**

Run: `node tools/gs-check.mjs`, полный `dt-check`, syntax check и `git diff --check`.
Expected: все PASS; `.DS_Store` и `settings.local.json` отсутствуют в `git status`.
