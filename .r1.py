import pathlib

def patch(path, pairs):
    p = pathlib.Path(path); s = p.read_text()
    for old, new, count in pairs:
        assert s.count(old) == count, f'{path}: {old[:70]!r} count={s.count(old)}'
        s = s.replace(old, new)
    p.write_text(s); print('ok:', path)

patch('worker/app.ts', [
("""    // Монеты платим только когда фигуры реально поймали короля: выйти из забега
    // на двадцатом ходу и получить награду было бы слишком просто.
    reward = outcome === 'lost' ? raceCoinReward(survived) : 0;""",
 """    // Монеты платим только когда фигуры реально поймали короля: выйти из забега
    // на двадцатом ходу и получить награду было бы слишком просто. Платим за
    // снятые фигуры, а не за ожидание: база от длины нарочно маленькая.
    reward = outcome === 'lost' ? raceCoinReward(survived, snapshot.captures ?? 0) : 0;""", 1),
])

patch('src/admin/views/VariantsPanel.tsx', [
("""/**
 * Проекция награды. Движок платит за пережитые ходы и только за проигранный
 * забег (`raceCoinReward`), взятие пока бесплатно. Колонка отвечает на вопрос
 * «сколько было бы, если платить за фигуру»: медиану, а не среднее - редкие
 * длинные партии тянут средний вверх, а платить приходится за обычный забег.
 * Выпад идёт за половину взятия: фигура та же, но король не ушёл с клетки.
 */
function rewardText(row: RaceMeasure, coins: number): string {
  // Платёж начисляется за проигранный забег. Если половина партий упёрлась в
  // потолок прогона, игрок не проигрывает - и награды нет, как бы ни рос счёт.
  if (row.samples > 0 && row.capped / row.samples > 0.5) return '0: забег не проигран';
  const now = raceCoinReward(Math.round(row.lengthAvg));
  const takes = row.capturesMedian * coins + Math.round(row.strikesAvg * Math.floor(coins / 2));
  return `${now} → ${now + Math.round(takes)}`;
}""",
 """/**
 * Проекция награды. Движок платит за проигранный забег и уже берёт по
 * `RACE_COIN_PER_CAPTURE` за снятую фигуру; колонка отвечает на вопрос «что
 * будет, если ставка другая»: слева текущая выплата, справа - при `монет за
 * взятие` из панели. Считаем по медиане, а не по среднему: редкие длинные
 * партии тянут среднее вверх, а платить приходится за обычный забег. Выпад в
 * ставке панели идёт за половину взятия: фигура та же, но король не ушёл.
 */
function rewardText(row: RaceMeasure, coins: number): string {
  // Платёж начисляется за проигранный забег. Если половина партий упёрлась в
  // потолок прогона, игрок не проигрывает - и награды нет, как бы ни рос счёт.
  if (row.samples > 0 && row.capped / row.samples > 0.5) return '0: забег не проигран';
  const length = Math.round(row.lengthAvg);
  const now = raceCoinReward(length, Math.round(row.capturesMedian));
  const other = raceCoinReward(
    length,
    Math.round(row.capturesMedian + row.strikesAvg / 2),
    coins,
  );
  return `${now} → ${other}`;
}""", 1),
("""  const now = Math.round(mean(rows, (row) => raceCoinReward(Math.round(row.lengthAvg))));
  const takes = mean(rows, (row) => row.capturesMedian);""",
 """  const now = Math.round(mean(rows, (row) => raceCoinReward(Math.round(row.lengthAvg), Math.round(row.capturesMedian))));
  const takes = mean(rows, (row) => row.capturesMedian);""", 1),
("""      `«Награда» - проекция: слева то, сколько платит движок сегодня (`raceCoinReward` - за пережитые ходы и только за проигранный забег), справа сколько было бы, если платить по `монет за взятие` из панели; выпад идёт за половину взятия. Колонка сравнения - тот же бот и те же зёрна на базовом правиле.`""",
 """      `«Награда» - проекция: слева сколько платит движок сейчас (`raceCoinReward` - база за длину плюс `RACE_COIN_PER_CAPTURE` за снятую фигуру, и только за проигранный забег), справа - сколько было бы при ставке `монет за взятие` из панели; выпад там идёт за половину взятия. Колонка сравнения - тот же бот и те же зёрна на базовом правиле.`""", 1),
])
