import pathlib

def patch(path, pairs):
    p = pathlib.Path(path); s = p.read_text()
    for old, new, count in pairs:
        assert s.count(old) == count, f'{path}: {old[:70]!r} count={s.count(old)}'
        s = s.replace(old, new)
    p.write_text(s); print('ok:', path)

patch('worker/app.ts', [
("    reward = outcome === 'lost' ? raceCoinReward(survived, snapshot.captures ?? 0) : 0;",
 "    reward = outcome === 'lost' ? raceCoinReward(survived, state.captures ?? 0) : 0;", 1),
])

patch('src/admin/views/VariantsPanel.tsx', [
("""'«Награда» - проекция: слева то, сколько платит движок сегодня (`raceCoinReward` - за пережитые ходы и только за проигранный забег), справа сколько было бы, если платить по `монет за взятие` из панели; выпад идёт за половину взятия. Колонка сравнения - тот же бот и те же зёрна на базовом правиле.',""",
 """'«Награда» - проекция: слева сколько платит движок сейчас (`raceCoinReward` - небольшая база за длину плюс ставка за снятую фигуру, и только за проигранный забег), справа - сколько было бы при ставке `монет за взятие` из панели; выпад там считается за половину взятия. Колонка сравнения - тот же бот и те же зёрна на базовом правиле.',""", 1),
])
