---
name: void-forecast
description: Движок прогноза расходов на конец месяца в V.O.I.D. (_monthForecast и хелперы особых трат): формулы pace/specRemain/futPlanned, почему резерв = среднее×частота, что уже проверялось и отвергнуто, как связаны линия на графике и печатаемая сумма. Use when touching _monthForecast, _specialForecastByCat, _budgetFree, the «Прогноз» line on «День за днём», or the «прогноз» chip in the Budget header.
---
# Прогноз конца месяца — один движок, два потребителя

**Month-end spend forecast — one engine, two consumers (since v1.49.0).** `_monthForecast(y, m)` (in `═══ stats.js ═══`, right before `function renderStats(){`, with helpers `_specialCatStats`, `_guessSpecialDay`, `_specialForecastByCat`, `_specialForecastCumLine`) is the single source for both the «Прогноз» line/total on «День за днём» and the «прогноз» chip in the Budget header. Returns `null` for a non-current month or a month with nothing spent or planned, otherwise `{cD, daysInMonth, fact, pace, futPlanned, futLine, futLineReg, specRemain, specLine, forecast, total}`:

```
total = fact + futPlanned + pace × (daysInMonth − cD) + specRemain
fact  = all expenses dated ≤ today (future-dated entries excluded)
futPlanned = expenses dated > today within the month — entered ahead, not yet due
pace  = non-special spend / cD          ← today is lived, so it's in the divisor and NOT in the multiplier
specRemain = Σ unpaid from _specialForecastByCat (per-category expectation over ≤6 prior
             months: mean amount × frequency, ≥2 months of history required)
```

**`futPlanned` (since v1.49.1)** — before it, an expense dated later this month vanished from the forecast entirely: the date filter kept it out of `fact` and out of `pace`, while `_specialForecastByCat` (which reads the whole month) counted it as already paid and zeroed its category's `unpaid`. Rent entered ahead understated the forecast by exactly its own amount. There is no double count: `spent` still spans the whole month, so a future-dated special yields `unpaid = 0` and lives only in `futPlanned`. `futLine`/`futLineReg` are its cumulative-by-day forms so the drawn line steps where the total counts it (Reg = non-special only, for when the «Особые» toggle is off).

**Reserve = mean × frequency, not minimum (since v1.50.0).** The old `Math.min` under-reserved every month: rent over Mar–Jul ran 47411/37314/33000/38580/34073, so `min` gave 33000 against a 38076 mean — 5k short each month, and specials are ~half of monthly spend here. That, not `pace`, was the main bias source: the forecast still ran 6% low on day 26, where `pace` only extrapolates 4 days. Frequency guards the other way — «Хотелки» was special in 2 months of 5 (32788, 17990), so a bare mean would reserve 25389 every month including months with no such purchase; × 2/5 gives ≈10156. **Do not relax the ≥2-months filter**: allowing single-month history makes a one-off purchase reserve forever and flips the bias from −10.7% to +11%. Backtest May+Jun+Jul: mean |error| 13.1% → 10.3%, bias −10.7% → −6.3%. Swapping the `pace` formula was tried and rejected — five variants (day-of-month share, blends, floors) all landed within noise, because the intra-month profile itself scatters 6–11pp month to month.

Before v1.49.0 the two places had independent formulas and never matched: Budget divided by `today−1` but multiplied by days-left *including* today (counting today twice, ~+1 day of pace) and reserved specials as a whole-month minimum, while the chart used the per-category forecast. If no non-special spend exists yet this month, `pace` falls back to the average of the previous 6 months' non-special spend up to the same day-of-month rather than flatlining at zero. `_budgetFree(y, m, totalSpent, totalLimit, fc)` takes the same `fc` so the «особые» reserve row and the «/день» allowance rest on the same numbers (its old whole-month-minimum path survives only as the `fc === null` fallback).

**The drawn line and the printed total are decoupled w.r.t. `dayInclSpecial`** (since v1.38.3): the line is anchored at `selCum[cD-1]` (same point the visible fact line ends at — never jumps away from it) and adds `fc.specLine` steps only when the toggle is on, so with it off the line is pure `fc.pace`, matching the plain fact line next to it. The total below the chart is always `fc.total` — full spend including specials the toggle hides, because real expected spend isn't the same question as what's drawn.
