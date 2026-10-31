import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  AD_COINS_DAILY_LIMIT,
  AD_COINS_REWARD,
  coinEconomy,
  DEFAULT_ECON,
  ECON_ASSUMED_KEYS,
  ECON_ASSUMED_COUNT,
  ECON_PRESETS,
  PAID_SKINS,
  PRODUCTS,
  SKIN_COINS,
  SKIN_SET_COINS,
  applyEconPreset,
  calibrateEcon,
  econFromPreset,
  econMarkdown,
  econPresetDef,
  econPresetOf,
  projectShop,
  type ShopEconInput,
} from '../../engine';
import { AdminError, fetchShopEcon } from '../api';
import type { ShopEconResponse } from '../types';
import { Metric, Panel, StatusLine, Table, formatNumber, formatPercent } from '../ui';

/**
 * Прогноз магазина в лаборатории.
 *
 * Панель отвечает на три вопроса, которые иначе решаются «на глаз»: по чем
 * продавать тему, оставлять ли набор рядом с поштучной продажей и стоит ли
 * брать взнос за публикацию своей. Модель - постоянная эластичность спроса с
 * поправкой на низкую цену: без неё ответ всегда «режь цену», и это не вывод, а
 * артефакт кривой.
 *
 * Восемнадцать полей руками не отдаём: здесь три решения - взгляд (пресет
 * допущений), цены витрины и горизонт. Измеряемое подставляется кнопкой «взять
 * из базы». Все остальные коэффициенты живы и доступны, но спрятаны: ручная
 * правка переключает состояние на «свои допущения», и вывод в отчёте подписывается
 * тем же словом - иначе отчёт с подкрученной эластичностью выглядит базовым.
 */

/** Поля, которые правят в «тонких настройках»: подписываем их числом. */
const FIELDS: Array<{ key: keyof ShopEconInput; label: string; step: number; hint?: string }> = [
  { key: 'visitors', label: 'Открытий витрины в месяц', step: 50, hint: 'из базы: событие shop_open' },
  { key: 'buyerRate', label: 'Доля купивших', step: 0.001, hint: 'из базы: платящие / открытия' },
  { key: 'refPrice', label: 'Цена калибровки, звёзд', step: 1, hint: 'из базы: средний чек' },
  { key: 'elasticity', label: 'Эластичность спроса', step: 0.1 },
  { key: 'anchorPrice', label: 'Якорь позиционирования', step: 1 },
  { key: 'centsPerStar', label: 'Центов за звезду', step: 0.1, hint: 'правило платформы: $0.013 за звезду' },
  { key: 'months', label: 'Горизонт, месяцев', step: 1 },
  { key: 'singlePrice', label: 'Тема поштучно, звёзд', step: 1 },
  { key: 'setPrice', label: 'Набор, звёзд', step: 1 },
  { key: 'setShare', label: 'Доля тех, кто берёт набор', step: 0.05 },
  { key: 'creatorRate', label: 'Доля, что собирает свою тему', step: 0.01 },
  { key: 'publisherRate', label: 'Из них хочет поделиться', step: 0.01 },
  { key: 'shareFee', label: 'Взнос за публикацию', step: 10, hint: 'в витрине его нет: это модель «что если»' },
  { key: 'seriousShare', label: 'Доля осмысленных заявок', step: 0.05 },
  { key: 'reviewMinutes', label: 'Минут на проверку', step: 1 },
  { key: 'hourCostCents', label: 'Ваш час, центов', step: 50 },
];

const HORIZONS = [1, 3, 6, 12];
const PERIODS = [7, 30, 90];

/** Что витрина продаёт на самом деле: цены берём отсюда, а не из головы. */
function shelfPrices() {
  return {
    single: PRODUCTS['skin:gold'].stars,
    set: PRODUCTS.skins.stars,
    slot: PRODUCTS.custom.stars,
  };
}

export function ShopModelPanel({ onUnauthorized }: { onUnauthorized: (message: string) => void }): ReactNode {
  const shelf = shelfPrices();
  const [input, setInput] = useState<ShopEconInput>(() =>
    econFromPreset('base', { singlePrice: shelf.single, setPrice: shelf.set }),
  );
  const [measured, setMeasured] = useState<ShopEconResponse | null>(null);
  // Период, чьими цифрами подставлены visitors/buyerRate/refPrice. null означает
  // «в этих трёх полях база не участвовала», и подпись в панели должна быть
  // про допущение, а не про несуществующее измерение.
  const [calibratedFor, setCalibratedFor] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const report = useMemo(() => projectShop(input), [input]);
  const markdown = useMemo(
    () =>
      econMarkdown(report, {
        date: new Date().toLocaleDateString('ru-RU'),
        calibrated: calibratedFor !== null,
      }),
    [report, calibratedFor],
  );

  const preset = econPresetOf(input);
  const custom = preset === 'custom';

  const loadBase = useCallback(async () => {
    setError('');
    try {
      const data = await fetchShopEcon(days);
      // Ответ может быть пустым (новая база, недоступная таблица) - до нулей,
      // иначе NaN уедет в поля модели и весь отчёт поплывёт.
      const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
      const measured = {
        days: num(data.days) || days,
        shopOpens: num(data.shopOpens),
        newPlayers: num(data.newPlayers),
        paidCount: num(data.paidCount),
        paidStars: num(data.paidStars),
        payers: num(data.payers),
        refundedCount: num(data.refundedCount),
        bySku: data.bySku ?? [],
        queue: data.queue ?? [],
      };
      setMeasured(measured);
      const shopOpens = measured.shopOpens;
      const cal = calibrateEcon({
        shopOpens,
        players: measured.newPlayers,
        paidCount: measured.paidCount,
        paidStars: measured.paidStars,
        refundedCount: measured.refundedCount,
      });
      if (!cal) {
        setCalibratedFor(null);
        setNotice('В базе пока нечего калибровать: нужны и открытия витрины, и оплаченные счета.');
        return;
      }
      setInput((prev) => ({
        ...prev,
        visitors: Math.round((shopOpens / Math.max(1, days)) * 30),
        buyerRate: cal.buyerRate,
        refPrice: cal.refPrice,
      }));
      setCalibratedFor(days);
      setNotice(
        `Подставлено из базы за ${days} дней: открытий ${shopOpens}, платящих ${measured.payers}, ` +
          `средний чек ${cal.refPrice.toFixed(1)} звёзд, доля покупателей ${(cal.buyerRate * 100).toFixed(2)}%, возвратов ${(cal.refundRate * 100).toFixed(1)}%.`,
      );
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return;
      }
      setError(err instanceof Error ? err.message : 'База не ответила');
    }
  }, [days, onUnauthorized]);

  // Самому панель не стучится в базу: лаборатория открывается ради прогонов, и
  // запрос на каждый её рендер означал бы цикл перерисовок. Цифры подставляют
  // кнопкой - заодно видно, какой период подставлен.

  const setField = useCallback((key: keyof ShopEconInput, value: number) => {
    setInput((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }));
  }, []);

  const publish = report.publish;
  // Монетная полка считается движком (та же функция, что печатает таблицу в
  // README): панель не имеет права держать свою арифметику цен.
  const coinRows = coinEconomy();
  const fromShelf = input.singlePrice === shelf.single && input.setPrice === shelf.set;
  const source = (key: keyof ShopEconInput) =>
    (key === 'visitors' || key === 'buyerRate' || key === 'refPrice') && calibratedFor !== null
      ? `из базы за ${calibratedFor} дн.`
      : 'допущение';

  return (
    <div className="adm-stack">
      {error && <StatusLine kind="error">{error}</StatusLine>}
      {notice && <StatusLine kind="ok">{notice}</StatusLine>}

      <Panel
        title="Расчёт"
        note="Три решения: насколько пессимистично смотреть, по чём продаём и за какой горизонт считать. Остальное - пресет"
      >
        <div className="adm-econ-simple">
          <div className="adm-econ-choice">
            <span className="adm-label">Взгляд</span>
            <div className="adm-range" role="group" aria-label="Пресет допущений">
              {ECON_PRESETS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`adm-chip${preset === entry.id ? ' is-active' : ''}`}
                  onClick={() => setInput((prev) => applyEconPreset(prev, entry.id))}
                >
                  {entry.name}
                </button>
              ))}
            </div>
            <p className="adm-note">
              {custom
                ? `Свои допущения: ${customAssumptions(input)} из ${ECON_ASSUMED_COUNT} коэффициентов изменены вручную.`
                : econPresetDef(preset).note}
            </p>
            {custom && (
              <button
                type="button"
                className="adm-link"
                onClick={() => setInput((prev) => applyEconPreset(prev, 'base'))}
              >
                Вернуть базу
              </button>
            )}
          </div>

          <div className="adm-econ-choice">
            <span className="adm-label">Цены витрины, звёзд</span>
            <div className="adm-econ-prices">
              <label className="adm-econ-field">
                <span>Тема поштучно</span>
                <input
                  type="number"
                  min={1}
                  value={input.singlePrice}
                  step={1}
                  onChange={(event) => setField('singlePrice', Number(event.target.value))}
                />
              </label>
              <label className="adm-econ-field">
                <span>Набор тем</span>
                <input
                  type="number"
                  min={1}
                  value={input.setPrice}
                  step={5}
                  onChange={(event) => setField('setPrice', Number(event.target.value))}
                />
              </label>
            </div>
            <p className="adm-note">
              В витрине: тема {shelf.single} · набор {shelf.set} · слот своей темы {shelf.slot}.{' '}
              {fromShelf ? (
                'Модель считает те же цены, что видит игрок.'
              ) : (
                <button type="button" className="adm-link" onClick={() => setInput((prev) => ({ ...prev, singlePrice: shelf.single, setPrice: shelf.set }))}>
                  Взять с витрины
                </button>
              )}{' '}
              Слот в расчёт не входит: он продаётся повторимо и не конкурирует с темами.
            </p>
          </div>

          <div className="adm-econ-choice">
            <span className="adm-label">Горизонт</span>
            <div className="adm-range" role="group" aria-label="Горизонт прогноза">
              {HORIZONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`adm-chip${input.months === value ? ' is-active' : ''}`}
                  onClick={() => setField('months', value)}
                >
                  {value} {value === 1 ? 'месяц' : 'мес.'}
                </button>
              ))}
            </div>
          </div>

          <div className="adm-econ-choice">
            <span className="adm-label">Данные базы</span>
            <div className="adm-econ-inline">
              <div className="adm-range" role="group" aria-label="Период">
                {PERIODS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`adm-chip${days === value ? ' is-active' : ''}`}
                    onClick={() => setDays(value)}
                  >
                    {value} дней
                  </button>
                ))}
              </div>
              <button type="button" className="adm-btn adm-btn-outline" onClick={() => void loadBase()}>
                Взять из базы
              </button>
            </div>
            <p className="adm-note">
              Подставляются три числа, остальные {ECON_ASSUMED_COUNT} - из пресета: открытий{' '}
              {formatNumber(input.visitors)} ({source('visitors')}), доля купивших{' '}
              {formatPercent(input.buyerRate, 2)} ({source('buyerRate')}), средний чек{' '}
              {input.refPrice} ★ ({source('refPrice')}).
            </p>
          </div>
        </div>

        <details className="adm-econ-md">
          <summary>
            Тонкие настройки: {FIELDS.length} коэффициентов{custom ? ' - правлены руками' : ''}
          </summary>
          <p className="adm-note">
            Здесь живут {ECON_ASSUMED_COUNT} допущений модели - эластичность, якорь, охота брать набор,
            цена вашего часа. Их не нужно подбирать, чтобы получить вывод: пресет меняет их сразу
            связкой. Трогайте по одному, только если спорите с конкретной цифрой - и помните, что
            отчёт тогда подписан «допущения вручную».
          </p>
          <div className="adm-econ-grid">
            {FIELDS.map((field) => {
              const value = input[field.key] as number;
              const assumed = (ECON_ASSUMED_KEYS as readonly string[]).includes(field.key);
              return (
                <label className="adm-econ-field" key={field.key}>
                  <span>
                    {field.label}
                    {assumed && <em> допущение</em>}
                  </span>
                  <input
                    type="number"
                    value={value}
                    step={field.step}
                    onChange={(event) => setField(field.key, Number(event.target.value))}
                  />
                  {field.hint && <small>{field.hint}</small>}
                </label>
              );
            })}
          </div>
        </details>
      </Panel>

      <Panel
        title="Что подставляет база"
        note="Открытия витрины считаются событием shop_open, покупки - оплаченными счетами за период"
      >
        {measured ? (
          <div className="adm-metrics">
            <Metric label="Открытий витрины" value={formatNumber(measured.shopOpens)} tone="accent" />
            <Metric label="Платящих" value={formatNumber(measured.payers)} />
            <Metric label="Звёзд" value={formatNumber(measured.paidStars)} />
            <Metric label="Возвратов" value={formatNumber(measured.refundedCount)} tone="danger" />
            <Metric
              label="Заявок в галерею"
              value={formatNumber(measured.queue.find((row) => row.status === 'approved')?.n ?? 0)}
              hint={`в очереди ${formatNumber(measured.queue.find((row) => row.status === 'pending')?.n ?? 0)}`}
            />
            <Metric
              label="Установков чужих тем"
              value={formatNumber(measured.queue.find((row) => row.status === 'approved')?.installs ?? 0)}
            />
          </div>
        ) : (
          <p className="adm-note">Цифр за период нет - модель считает на допущениях.</p>
        )}
        {measured && measured.bySku.length > 0 && (
          <Table head={['Товар', 'Покупок', 'Звёзд', 'Средний чек']} empty="">
            {measured.bySku.map((row) => (
              <tr key={row.sku}>
                <td>{row.sku}</td>
                <td>{formatNumber(row.n)}</td>
                <td>{formatNumber(row.stars)}</td>
                <td>{row.n ? (row.stars / row.n).toFixed(1) : '0'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Кривая цены" note="Спрос на ту же тему при другой цене, на одном и том же потоке открытий">
        <div className="adm-metrics">
          <Metric
            label="Цены витрины"
            value={`${shelf.single} / ${shelf.set} / ${shelf.slot}`}
            hint="тема · набор · слот"
            tone="accent"
          />
          <Metric
            label="Оптимум"
            value={report.best ? `${report.best.price} звёзд` : 'нет'}
            hint={report.best ? `${Math.round(report.best.cents)} центов в месяц` : undefined}
          />
          <Metric
            label={`Выручка за ${input.months} мес.`}
            value={`${report.money.cents.toFixed(0)} ц`}
            hint={`${formatNumber(report.money.stars)} звёзд`}
          />
          <Metric
            label="Чистыми с публикаций"
            value={`${publish.netCents.toFixed(0)} ц`}
            tone={publish.netCents >= 0 ? 'ok' : 'danger'}
            hint={`взнос «что если» ${input.shareFee} ★, заявок ${publish.submissions.toFixed(0)}`}
          />
        </div>
        <Table head={['Цена, звёзд', 'Доля покупателей', 'Покупателей', 'Звёзд', 'Центов']} empty="">
          {report.sweep.map((row) => (
            <tr key={row.price} className={report.best && row.price === report.best.price ? 'is-best' : undefined}>
              <td>{row.price}</td>
              <td>{formatPercent(row.buyerRate, 2)}</td>
              <td>{row.buyers}</td>
              <td>{formatNumber(row.stars)}</td>
              <td>{row.cents.toFixed(0)}</td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Что продавать" note="Один и тот же спрос, три витрины">
        <Table head={['Витрина', 'Средний чек', 'Покупателей', 'Центов', 'К поштучной']} empty="">
          {report.ladder.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.blendedPrice}</td>
              <td>{row.point.buyers}</td>
              <td>{row.point.cents.toFixed(0)}</td>
              <td>
                {row.deltaVsSingle > 0 ? '+' : ''}
                {row.deltaVsSingle}%
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel
        title="Монетная полка тем"
        note={`Тема стоит ${SKIN_COINS} монет, набор - ${SKIN_SET_COINS}: обе цены выведены из звёзд курсом 60, поэтому «поштучно/набор» здесь тот же смысл. Реклама даёт ${AD_COINS_REWARD} монет и не больше ${AD_COINS_DAILY_LIMIT} показов в сутки - без потолка эта таблица превращается в «тема за вечер»`}
      >
        <Metric
          label="Тема за монеты"
          value={`${SKIN_COINS} м`}
          hint={`${PAID_SKINS.length} темы · набор ${SKIN_SET_COINS} м`}
          tone="accent"
        />
        <Metric
          label="Быстрее всех копит"
          value={`${coinRows[coinRows.length - 1].daysForSkin} дн.`}
          hint={`на L${coinRows[coinRows.length - 1].level}, два ролика в день`}
        />
        <Table head={['Уровень', 'Монет в день', 'С рекламой', 'Тема', 'Набор']} empty="">
          {coinRows.map((row) => (
            <tr key={row.level}>
              <td className="adm-num">L{row.level}</td>
              <td className="adm-num">{row.perDay}</td>
              <td className="adm-num">{row.perDayWithAds}</td>
              <td className="adm-num">{row.daysForSkin} дн.</td>
              <td className="adm-num">{row.daysForSet} дн.</td>
            </tr>
          ))}
        </Table>
        <p className="adm-hint">
          Монеты - второй путь к тем же темам, и он не должен быть короче звёздного: счёт на
          20 звёзд закрывается за ~10 побед, а 1 200 монет - за те же ~10 дней. Если строка
          «Тема» падает ниже четырёх дней, цену или потолок рекламы надо пересматривать.
        </p>
      </Panel>

      <Panel
        title="Публикация своей темы"
        note="В витрине взноса нет - панель считает «что было бы, если бы показ продавался»"
      >
        <Table head={['Заявок', 'Отсечено', 'Звёзд', 'Минут на проверку', 'Чистыми', 'Окупаемость с']} empty="">
          <tr>
            <td>
              {publish.submissions.toFixed(1)} из {publish.freeSubmissions.toFixed(1)}
            </td>
            <td>{formatPercent(publish.filtered, 0)}</td>
            <td>{formatNumber(publish.stars)}</td>
            <td>{publish.reviewMinutes}</td>
            <td>{publish.netCents.toFixed(0)} ц</td>
            <td>{publish.breakEvenFee === null ? 'больше 2000' : `${publish.breakEvenFee} звёзд`}</td>
          </tr>
        </Table>
        <p className="adm-note">
          Цена фильтра - молчание части авторов: вместе со спамом уходит{' '}
          {formatPercent(publish.seriousLost, 0)} осмысленных заявок. Это единственная цифра, которую
          нельзя вернуть скидкой, и её стоит смотреть раньше, чем выручку.
        </p>
      </Panel>

      <Panel title="Выводы" note="Посчитаны из этих же цифр, а не набраны руками">
        <ul className="adm-verdicts">
          <li>
            {custom
              ? `Допущения правлены руками (${customAssumptions(input)} из ${ECON_ASSUMED_COUNT}), пресет «${econPresetDef('base').name}» больше не описывает этот расчёт.`
              : `Взгляд «${econPresetDef(preset).name}»: ${econPresetDef(preset).note}.`}
          </li>
          {report.verdicts.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <details className="adm-econ-md">
          <summary>Markdown для docs</summary>
          <pre className="adm-code">{markdown}</pre>
        </details>
      </Panel>
    </div>
  );
}

/**
 * Сколько допущений разошлись с пресетом. Считаем по фактическому состоянию
 * полей, а не по флагу «пользователь что-то нажал»: флаг пережил бы перезагрузку
 * неправильно, а подпись обязана врать ровно столько, сколько врёт вход.
 */
function customAssumptions(input: ShopEconInput): number {
  const base = DEFAULT_ECON;
  let changed = 0;
  for (const key of ECON_ASSUMED_KEYS) {
    if (input[key] !== base[key]) changed += 1;
  }
  // Пресет, отличный от базы, меняет свои поля - и это не «ручная правка»:
  // сравниваем с тем же пресетом, который нажат.
  const preset = econPresetOf(input);
  if (preset === 'custom') return changed;
  const same = econFromPreset(preset);
  let delta = 0;
  for (const key of ECON_ASSUMED_KEYS) {
    if (input[key] !== same[key]) delta += 1;
  }
  return delta;
}
