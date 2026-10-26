/**
 * Прогноз магазина: сколько принесёт та или иная цена.
 *
 * Модель простая и потому честная. Спрос на косметику в мини-аппе считают
 * постоянной эластичностью: `доля покупает × (цена / цена_калибровки) ^ -e`.
 * При e = 1 выручка не зависит от цены, при e > 1 цена режет спрос сильнее, и
 * повышение цены выручку уже уменьшает. Всё остальное - только следствие:
 * оптимум, сравнение «поштучно или набор», и отдельный блок про взнос за
 * публикацию, где кривая складывается из двух слоёв платёжеспособности.
 *
 * Цифры, которые модель не знает, она не выдумывает: `buyerRate`, `visitors` и
 * средний чек берутся из базы (`calibrateEcon`), остальное - из пресета
 * допущений (`ECON_PRESETS`). Поэтому здесь нет «выручки в месяц» без
 * источника: каждая строка либо измерена, либо подписана допущением.
 *
 * Править восемнадцать коэффициентов руками бесполезно: человек честно называет
 * три вещи - насколько пессимистично смотреть, по чём продаёт витрина и за какой
 * горизонт считать. Всё остальное меняет пресет, а ручная правка помечается как
 * «свои допущения», чтобы отчёт не притворялся базовым.
 */

export interface ShopEconInput {
  /** Открытий магазина за месяц: считается событием `shop_open`. */
  visitors: number;
  /** Доля открывших, которая купила хоть что-то по цене `refPrice`. */
  buyerRate: number;
  /** Цена, на которой эта доля измерена, звёзд. */
  refPrice: number;
  /** Эластичность спроса: 1 - выручка не меняется, 2 - цена больно бьёт по спросу. */
  elasticity: number;
  /**
   * Якорь позиционирования: ниже этой цены тему считают мусором и берут реже,
   * чем обещает голая эластичность. `0` выключает эффект - тогда у модели
   * остаётся одна кривая спроса, и при e > 1 она всегда отвечает «режь цену».
   * С якорем оптимум появляется внутри диапазона, и это то, зачем модель нужна.
   */
  anchorPrice: number;
  /**
   * Центов разработчика за одну звезду после вычета комиссии платформы: Telegram
   * считает звезду как $0.013 (вывод через Fragment). Завышать цифру нельзя -
   * весь отчёт в «центах» масштабирован ею.
   */
  centsPerStar: number;
  /** Горизонт прогноза, месяцы. */
  months: number;
  /** Цена одной темы и цена набора. */
  singlePrice: number;
  setPrice: number;
  /** Доля покупателей темы, которые берут набор вместо одной темы. */
  setShare: number;
  /** Доля открывших магазин, которые собирают свою тему в студии. */
  creatorRate: number;
  /** Доля кастомизаторов, которые хотят, чтобы тему видели чужие. */
  publisherRate: number;
  /** Взнос за публикацию, звёзд. */
  shareFee: number;
  /** Доля осмысленных заявок: они платят и за 300 звёзд. */
  seriousShare: number;
  /** Чувствительность к цене у осмысленных и у потока «накидал за минуту». */
  seriousResistance: number;
  spamResistance: number;
  /** Минут на проверку одной заявки (превью, контраст, имя). */
  reviewMinutes: number;
  /** Сколько стоит ваш час, в центах. */
  hourCostCents: number;
}

/** Всё, что модель считает допущениями, а не данными: подписываем в UI. */
export const ECON_ASSUMED_KEYS = [
  'elasticity',
  'anchorPrice',
  'centsPerStar',
  'setShare',
  'creatorRate',
  'publisherRate',
  'seriousShare',
  'seriousResistance',
  'spamResistance',
  'reviewMinutes',
  'hourCostCents',
] as const;

export const DEFAULT_ECON: ShopEconInput = {
  visitors: 1200,
  buyerRate: 0.02,
  refPrice: 25,
  elasticity: 1.3,
  anchorPrice: 15,
  centsPerStar: 1.3,
  months: 1,
  singlePrice: 20,
  setPrice: 50,
  setShare: 0.35,
  creatorRate: 0.12,
  publisherRate: 0.3,
  shareFee: 100,
  seriousShare: 0.4,
  seriousResistance: 400,
  spamResistance: 60,
  reviewMinutes: 4,
  hourCostCents: 900,
};

/**
 * Пресеты допущений - то, за что человек думать не должен.
 *
 * `base` описан пустым патчем и означает «как в `DEFAULT_ECON`», поэтому база
 * пресета и цифры в README не разъедутся: пресет хранит только отклонения.
 * «Пессимист» и «Оптимист» меняют не одну цифру, а связку - эластичность, силу
 * якоря, охоту брать набор и цену вашего часа, - потому что вручную такие
 * коэффициенты правуются по одному и модель начинает врать согласованнее, чем раньше.
 */
export type EconPreset = 'pessimistic' | 'base' | 'optimistic';

export interface EconPresetDef {
  id: EconPreset;
  /** Как пресет называется в интерфейсе. */
  name: string;
  /** Одна строка о том, на что смотрит пессимист и на что - оптимист. */
  note: string;
  patch: Partial<ShopEconInput>;
}

export const ECON_PRESETS: readonly EconPresetDef[] = [
  {
    id: 'pessimistic',
    name: 'Пессимист',
    note: 'цена бьёт по спросу, набор берут неохотно, свою тему рисуют редкие, проверка дорогая',
    patch: {
      elasticity: 1.8,
      anchorPrice: 10,
      setShare: 0.2,
      creatorRate: 0.05,
      publisherRate: 0.2,
      seriousShare: 0.3,
      reviewMinutes: 6,
      hourCostCents: 1500,
    },
  },
  {
    id: 'base',
    name: 'База',
    note: 'то, что записано в README и docs/skins-economy.md: ни запаса, ни надежды',
    patch: {},
  },
  {
    id: 'optimistic',
    name: 'Оптимист',
    note: 'на косметику цена почти не влияет, набор берут охотно, авторов много и они щедрые',
    patch: {
      elasticity: 1.1,
      anchorPrice: 30,
      setShare: 0.5,
      creatorRate: 0.2,
      publisherRate: 0.45,
      seriousShare: 0.6,
      reviewMinutes: 3,
      hourCostCents: 600,
    },
  },
];

/**
 * Ключи, которые пресет не трогает: их измеряет база (`visitors`, `buyerRate`,
 * `refPrice`) или выбирает сам человек (цены, горизонт, курс звезды, взнос).
 */
export const ECON_KEPT_KEYS = [
  'visitors',
  'buyerRate',
  'refPrice',
  'singlePrice',
  'setPrice',
  'months',
  'centsPerStar',
  'shareFee',
] as const;

export type EconKeptKey = (typeof ECON_KEPT_KEYS)[number];

export function econPresetDef(id: EconPreset): EconPresetDef {
  return ECON_PRESETS.find((entry) => entry.id === id) ?? ECON_PRESETS[1];
}

/** Полный вход из пресета: допущения пресета, поверх - то, что выбрали вы. */
export function econFromPreset(id: EconPreset, base: Partial<ShopEconInput> = {}): ShopEconInput {
  return { ...DEFAULT_ECON, ...econPresetDef(id).patch, ...base };
}

/** Сменить взгляд, не потеряв измеренное и выбранное руками. */
export function applyEconPreset(input: ShopEconInput, id: EconPreset): ShopEconInput {
  const kept: Partial<ShopEconInput> = {};
  for (const key of ECON_KEPT_KEYS) kept[key as EconKeptKey] = input[key as EconKeptKey];
  return econFromPreset(id, kept);
}

/**
 * Какому пресету вход равен по всем допущениям. 'custom' означает «правили
 * руками»: интерфейс обязан показывать это состоянием, а не подписью в подсказке.
 */
export function econPresetOf(input: ShopEconInput): EconPreset | 'custom' {
  for (const preset of ECON_PRESETS) {
    const full = econFromPreset(preset.id);
    if (ECON_ASSUMED_KEYS.every((key) => input[key] === full[key])) return preset.id;
  }
  return 'custom';
}

/** Сколько коэффициентов модель считает допущениями - для подписи в интерфейсе. */
export const ECON_ASSUMED_COUNT = ECON_ASSUMED_KEYS.length;

/** Сетка цен для разведки: тот же шаг, что и в реальной витрине. */
export const PRICE_GRID = [10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150];

/** Выше этой доли покупателей модель не заходит: 50% мини-апп не продают. */
export const MAX_BUYER_RATE = 0.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Доля покупателей при другой цене: кривая постоянной эластичности, умноженная
 * на discount за низкую цену. Спрос считаем от цены калибровки, поэтому
 * `refPrice <= 0` или нулевая база означают «данных нет» - и модель отдаёт 0,
 * а не бесконечность, которую потом кто-то напечатает в отчёте.
 */
export function buyerRateAt(input: ShopEconInput, price: number): number {
  const base = input.buyerRate;
  const ref = input.refPrice;
  if (!(base > 0) || !(ref > 0) || !(price > 0)) return 0;
  const elasticity = Number.isFinite(input.elasticity) ? input.elasticity : 1;
  const anchor = input.anchorPrice > 0 ? input.anchorPrice : 0;
  const positioning = anchor > 0 ? price / (price + anchor) : 1;
  const rate = base * (price / ref) ** -elasticity * positioning;
  return Math.min(MAX_BUYER_RATE, Math.max(0, rate));
}

export interface EconPoint {
  price: number;
  buyerRate: number;
  buyers: number;
  stars: number;
  cents: number;
}

export function offerAt(input: ShopEconInput, price: number): EconPoint {
  const buyers = input.visitors * buyerRateAt(input, price);
  const stars = buyers * price;
  return {
    price,
    buyerRate: Number(buyerRateAt(input, price).toFixed(4)),
    buyers: Number(buyers.toFixed(1)),
    stars: Math.round(stars),
    cents: Number((stars * input.centsPerStar).toFixed(1)),
  };
}

/** Разведка по ценам: строки отчёта, отсортированные по цене. */
export function priceSweep(input: ShopEconInput, grid: readonly number[] = PRICE_GRID): EconPoint[] {
  return grid
    .filter((price) => price > 0)
    .map((price) => offerAt(input, price))
    .sort((a, b) => a.price - b.price);
}

export function bestOffer(points: readonly EconPoint[]): EconPoint | null {
  let best: EconPoint | null = null;
  for (const point of points) {
    if (!best || point.cents > best.cents) best = point;
  }
  return best;
}

export interface OfferComparison {
  name: string;
  /** Средняя цена чека, звёзд. */
  blendedPrice: number;
  point: EconPoint;
  /** Относительно первой строки: то, на что смотрят, когда решают, менять ли витрину. */
  deltaVsSingle: number;
}

/**
 * Три варианта витрины на одном спросе: только поштучно, только набором, и
 * связка, где покупатель сам выбирает. Связка считает средний чек как смесь -
 * это грубо (никто не запрещает взять и то и другое), но в плюс не врёт:
 * перекрёстная скидка в наборе съедает ровно то, что ей положено.
 */
export function offerLadder(input: ShopEconInput): OfferComparison[] {
  const single = offerAt(input, input.singlePrice);
  const setOnly = offerAt(input, input.setPrice);
  const blended = input.setShare > 0
    ? input.singlePrice * (1 - input.setShare) + input.setPrice * input.setShare
    : input.singlePrice;
  const combo = offerAt(input, blended);
  const rows = [
    { name: 'только поштучно', blendedPrice: input.singlePrice, point: single },
    { name: 'только набор', blendedPrice: input.setPrice, point: setOnly },
    { name: 'поштучно + набор', blendedPrice: Number(blended.toFixed(1)), point: combo },
  ];
  return rows.map((row) => ({
    ...row,
    deltaVsSingle: single.cents > 0 ? Number(((row.point.cents / single.cents - 1) * 100).toFixed(1)) : 0,
  }));
}

export interface PublishEconomics {
  creators: number;
  /** Сколько заявок пришло бы бесплатно. */
  freeSubmissions: number;
  /** Сколько приносит взнос в столько-то звёзд. */
  submissions: number;
  /** Доля потока, которую отсекает взнос. */
  filtered: number;
  stars: number;
  cents: number;
  reviewMinutes: number;
  reviewCostCents: number;
  netCents: number;
  /** Наименьший взнос, при котором проверка перестаёт быть в минус. */
  breakEvenFee: number | null;
  /** Сколько осмысленных заявок уходит вместе со спамом - цена любого взноса. */
  seriousLost: number;
}

/**
 * Публикация своей темы: деньги против труда.
 *
 * Взнос работает фильтром дважды: поток «накидал за минуту» режется сильно
 * (маленькое сопротивление), а тот, кто делал тему себе и хочет показать её
 * людям, платит и за 300. Отсюда и главная цена решения: вместе со спамом
 * уходит часть настоящих авторов - `seriousLost` показывает эту долю, чтобы
   взнос не выглядел бесплатным.
 */
export function publishNumbers(input: ShopEconInput): Omit<PublishEconomics, 'breakEvenFee'> {
  const creators = Math.max(0, input.visitors * clamp01(input.creatorRate));
  const share = clamp01(input.seriousShare);
  const want = clamp01(input.publisherRate);
  const serious = creators * want * share;
  const spam = creators * want * (1 - share);
  const fee = Math.max(0, input.shareFee);
  const seriousKeep = serious * Math.exp(-fee / Math.max(1, input.seriousResistance));
  const spamKeep = spam * Math.exp(-fee / Math.max(1, input.spamResistance));
  const submissions = seriousKeep + spamKeep;
  const total = serious + spam;
  const reviewMinutes = submissions * Math.max(0, input.reviewMinutes);
  const reviewCostCents = (reviewMinutes / 60) * Math.max(0, input.hourCostCents);
  const stars = submissions * fee;
  const cents = stars * input.centsPerStar;
  return {
    creators: Number(creators.toFixed(1)),
    freeSubmissions: Number(total.toFixed(1)),
    submissions: Number(submissions.toFixed(1)),
    filtered: total > 0 ? Number((1 - submissions / total).toFixed(3)) : 0,
    stars: Math.round(stars),
    cents: Number(cents.toFixed(1)),
    reviewMinutes: Math.round(reviewMinutes),
    reviewCostCents: Number(reviewCostCents.toFixed(1)),
    netCents: Number((cents - reviewCostCents).toFixed(1)),
    seriousLost: serious > 0 ? Number((1 - seriousKeep / serious).toFixed(3)) : 0,
  };
}

/**
 * Экономика публикации целиком. Отдельная функция, а не поле внутри расчёта:
 * поиск окупаемости пересобирает вход с другой ценой, и при взаимном вызове
 * это бесконечная рекурсия (стек в воркере никто не раздвигает).
 */
export function publishEconomics(input: ShopEconInput): PublishEconomics {
  return { ...publishNumbers(input), breakEvenFee: breakEvenPublishFee(input) };
}

function breakEvenPublishFee(input: ShopEconInput): number | null {
  for (let fee = 0; fee <= 2000; fee += 10) {
    if (publishNumbers({ ...input, shareFee: fee }).netCents >= 0) return fee;
  }
  return null;
}

export interface EconReport {
  input: ShopEconInput;
  sweep: EconPoint[];
  best: EconPoint | null;
  current: EconPoint;
  ladder: OfferComparison[];
  publish: PublishEconomics;
  /** Выручка за горизонт, центы: то, ради чего всё это открывается. */
  money: { stars: number; cents: number };
  verdicts: string[];
}

/** Один проход: то, что рисует лаборатория, и то, что можно переслать как есть. */
export function projectShop(input: Partial<ShopEconInput>): EconReport {
  const full: ShopEconInput = { ...DEFAULT_ECON, ...input };
  const sweep = priceSweep(full);
  const best = bestOffer(sweep);
  const current = offerAt(full, full.singlePrice);
  const ladder = offerLadder(full);
  const publish = publishEconomics(full);
  const bestOfferRow = ladder.reduce<OfferComparison | null>((acc, row) => (!acc || row.point.cents > acc.point.cents ? row : acc), null);
  const money = bestOfferRow ? bestOfferRow.point : current;
  return {
    input: full,
    sweep,
    best,
    current,
    ladder,
    publish,
    money: {
      stars: Math.round(money.stars * Math.max(1, full.months)),
      cents: Number((money.cents * Math.max(1, full.months)).toFixed(1)),
    },
    verdicts: verdicts(full, { sweep, best, current, ladder, publish }),
  };
}

function verdicts(
  input: ShopEconInput,
  parts: { sweep: EconPoint[]; best: EconPoint | null; current: EconPoint; ladder: OfferComparison[]; publish: PublishEconomics },
): string[] {
  const out: string[] = [];
  const { best, current } = parts;
  if (best && best.price !== input.singlePrice) {
    const loss = current.cents > 0 ? (1 - best.cents / current.cents) * 100 : 0;
    out.push(
      `Оптимум по выручке - ${best.price} звёзд (${best.cents.toFixed(0)} центов в месяц при ${input.visitors} открытий). ` +
        (loss > 0
          ? `Сейчас с ценой ${input.singlePrice} вы теряете ${loss.toFixed(0)}% выручки.`
          : `Текущая цена ${input.singlePrice} уже лучше оптимума: держим, не поднимаем.`),
    );
  } else {
    out.push(
      `Текущая цена ${input.singlePrice} совпадает с оптимумом из этой модели - двигать нечего. ` +
        (input.anchorPrice > 0
          ? `Оптимум держится на двух силах: эластичность ${input.elasticity} тянет цену вниз, якорь ${input.anchorPrice} звёзд - вверх.`
          : 'Якорь позиционирования выключен, поэтому модель видит только эластичность.'),
    );
  }
  if (parts.sweep.length >= 2) {
    const flat = parts.sweep.every((row) => Math.abs(row.cents - parts.sweep[0].cents) / Math.max(1, parts.sweep[0].cents) < 0.05);
    if (flat) {
      out.push(
        'Эластичность около единицы: выручка почти не зависит от цены. Значит цена сейчас - вопрос позиционирования, а не денег, и ставить тему дешевле смысла нет.',
      );
    }
  }
  const combo = parts.ladder.find((row) => row.name === 'поштучно + набор');
  const single = parts.ladder.find((row) => row.name === 'только поштучно');
  if (combo && single && single.point.cents > 0) {
    const gain = (combo.point.cents / single.point.cents - 1) * 100;
    out.push(
      gain >= 0
        ? `Набор поверх поштучной продажи даёт ${gain.toFixed(0)}% выручки при доле ${Math.round(input.setShare * 100)}% покупателей, выбирающих его.`
        : `Набор отнимает ${Math.abs(gain).toFixed(0)}% выручки: скидка слишком велика или набор берут те, кто и так купил бы три темы.`,
    );
  }
  const fee = parts.publish;
  out.push(
    `Взнос ${input.shareFee} звёзд: заявок ${fee.submissions.toFixed(0)} вместо ${fee.freeSubmissions.toFixed(0)} (отсечено ${Math.round(fee.filtered * 100)}%), ` +
      `проверка съедает ${fee.reviewMinutes} минут и ${fee.reviewCostCents.toFixed(0)} центов, чистыми ${fee.netCents.toFixed(0)} цента. ` +
      (fee.breakEvenFee === null
        ? 'Даже при 2000 звёзд проверка не окупается: это не источник дохода, а фильтр, и считать его надо трудом, а не выручкой.'
        : `Окупается с ${fee.breakEvenFee} звёзд.`),
  );
  if (fee.seriousLost > 0.05) {
    out.push(
      `Тем временем взнос уносит ${Math.round(fee.seriousLost * 100)}% осмысленных заявок: цена фильтрации - молчание части авторов, и это единственный минус, который нельзя вернуть скидкой.`,
    );
  }
  return out;
}

export interface EconSample {
  /** Открытий магазина за период. */
  shopOpens: number;
  /** Игроков в периоде. */
  players: number;
  /** Оплаченных платежей за период. */
  paidCount: number;
  /** Звёзд за период. */
  paidStars: number;
  /** Возвратов за период. */
  refundedCount: number;
}

/**
 * Что модель берёт из базы, а не из головы: доля покупателей считается от
 * открытий магазина (не от игроков - тот, кто витрину не открывал, и не
 * покупатель), средний чек от суммы и числа платежей. Пустая база даёт null по
 * всем полям, и лаборатория обязана показать «калибровки нет», а не ноль.
 */
export function calibrateEcon(sample: EconSample): { buyerRate: number; refPrice: number; refundRate: number } | null {
  if (!(sample.shopOpens > 0) || !(sample.paidCount > 0)) return null;
  const avgPrice = sample.paidStars / sample.paidCount;
  return {
    buyerRate: Number(Math.min(MAX_BUYER_RATE, sample.paidCount / sample.shopOpens).toFixed(4)),
    refPrice: Number(avgPrice.toFixed(1)),
    refundRate: Number(Math.min(1, sample.refundedCount / sample.paidCount).toFixed(3)),
  };
}

/** Markdown для вставки в docs: тот же формат, что у остальных прогонов лаборатории. */
export function econMarkdown(report: EconReport, meta: { date: string; calibrated: boolean }): string {
  const lines: string[] = [];
  lines.push(`Прогноз магазина от ${meta.date}, ${meta.calibrated ? 'калибровано по базе' : 'допущения вручную'}.`);
  lines.push('');
  lines.push('| Цена, звёзд | Доля покупателей | Покупателей | Звёзд | Центов |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const row of report.sweep) {
    lines.push(
      `| ${row.price} | ${(row.buyerRate * 100).toFixed(2)}% | ${row.buyers} | ${row.stars} | ${row.cents.toFixed(0)} |`,
    );
  }
  lines.push('');
  lines.push('| Витрина | Средний чек, звёзд | Покупателей | Центов | К поштучной |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const row of report.ladder) {
    lines.push(
      `| ${row.name} | ${row.blendedPrice} | ${row.point.buyers} | ${row.point.cents.toFixed(0)} | ${row.deltaVsSingle > 0 ? '+' : ''}${row.deltaVsSingle}% |`,
    );
  }
  lines.push('');
  const pub = report.publish;
  lines.push(
    `Публикации: заявок ${pub.submissions} из ${pub.freeSubmissions}, взнос даёт ${pub.stars} звёзд (${pub.cents.toFixed(0)} центов), ` +
      `проверка - ${pub.reviewMinutes} минут (${pub.reviewCostCents.toFixed(0)} центов), чистыми ${pub.netCents.toFixed(0)} цента, ` +
      `окупаемость с ${pub.breakEvenFee ?? 'больше 2000'} звёзд, осмысленных заявок теряется ${Math.round(pub.seriousLost * 100)}%.`,
  );
  lines.push('');
  for (const verdict of report.verdicts) lines.push(`- ${verdict}`);
  return lines.join('\n');
}
