#!/usr/bin/env bash
# Разовая нарезка вендоренных гарнитур. Результат коммитится в vendor/.
# Перезапускать только при смене версии шрифта или набора символов.
set -euo pipefail
cd "$(dirname "$0")"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -sL -o "$TMP/Golos.ttf" \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/golostext/GolosText%5Bwght%5D.ttf"
curl -sL -o "$TMP/JB.ttf" \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf"

# Текст: латиница, кириллица, ₽, №, типографские тире и кавычки, ‹ ›, −,
# плюс знаки, реально встречающиеся в интерфейсе: € (переключатель валют),
# ≈ (пересчёт итога), … → ≤ ≥. Без них они молча уезжали в системный шрифт.
# ⌀ (U+2300) в Golos Text нет вовсе — подсказки средних так и остаются
# в фолбэке, добавлять его в диапазон бессмысленно.
TEXT_RANGE='U+0020-007E,U+00A0-00FF,U+0400-045F,U+0490-0491,U+2010-2015,U+2018-201F,U+2026,U+2039-203A,U+2116,U+20AC,U+20BD,U+2192,U+2212,U+2248,U+2264-2265'
# Цифры: только то, что встречается в денежных строках
NUM_RANGE='U+0020,U+00A0,U+0025,U+002B,U+002C,U+002D,U+002E,U+002F,U+0030-0039,U+20BD,U+2212'

uv run --quiet --with fonttools --with brotli python -m fontTools.subset \
  "$TMP/Golos.ttf" --unicodes="$TEXT_RANGE" --flavor=woff2 \
  --layout-features='ccmp,locl,kern,tnum,calt' \
  --output-file=../vendor/golos-text.woff2

uv run --quiet --with fonttools --with brotli python -m fontTools.subset \
  "$TMP/JB.ttf" --unicodes="$NUM_RANGE" --flavor=woff2 \
  --layout-features='tnum,kern' \
  --output-file=../vendor/jetbrains-digits.woff2

ls -l ../vendor/golos-text.woff2 ../vendor/jetbrains-digits.woff2 |
  awk '{printf "%-34s %6.1f KB\n", $9, $5/1024}'
