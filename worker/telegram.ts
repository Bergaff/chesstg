import type { WorkerEnv } from './types';
import { authCallbackData } from './authLink';
import { type BotLang, pick } from './i18n';
import { legalChunks, legalDocument, paySupportText, supportText, type LegalKind } from './legal';
import { LEGAL_CONTACT } from '../src/legal/content';
import { botToken } from './token';

const API_BASE = 'https://api.telegram.org';

/**
 * Команды бота одним списком: их печатает `setMyCommands` из админки, их же
 * пересказывает /help. Розъезд означает меню, пункт из которого бот молчит, -
 * и именно так выглядит бот, которого не пустили в каталог приложений.
 *
 * `paysupport`, `terms` и `support` - не украшение: продающий Telegram Stars bot
 * обязан отвечать на них в чате, а не прятать условия за кнопкой.
 */
export const BOT_COMMANDS: ReadonlyArray<{ command: string; description: string }> = [
  { command: 'start', description: 'Открыть игру' },
  { command: 'play', description: 'Продолжить партию' },
  { command: 'help', description: 'Правила и поддержка' },
  { command: 'terms', description: 'Условия использования' },
  { command: 'privacy', description: 'Политика данных' },
  { command: 'paysupport', description: 'Оплата и возвраты' },
  { command: 'support', description: 'Написать в поддержку' },
];

/**
 * Английский список отдаётся без language_code: по правилам Bot API он
 * действует для всех языков, которым нет отдельного набора. Язык интерфейса
 * приложения выбирается так же - ru для русской копии клиента, дальше английский.
 */
export const BOT_COMMANDS_EN: ReadonlyArray<{ command: string; description: string }> = [
  { command: 'start', description: 'Open the game' },
  { command: 'play', description: 'Resume your run' },
  { command: 'help', description: 'Rules and support' },
  { command: 'terms', description: 'Terms of use' },
  { command: 'privacy', description: 'Privacy policy' },
  { command: 'paysupport', description: 'Payments and refunds' },
  { command: 'support', description: 'Contact support' },
];

export interface TgButton {
  text: string;
  web_app?: { url: string };
  url?: string;
}

export async function callTelegram<T = unknown>(
  env: WorkerEnv,
  method: string,
  payload: Record<string, unknown>,
): Promise<T | null> {
  const token = botToken(env);
  if (!token) return null;
  try {
    const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
      error_code?: number;
    };
    if (!data.ok) {
      console.error(`Telegram ${method} failed: ${data.error_code} ${data.description ?? ''}`);
      return null;
    }
    return data.result ?? null;
  } catch (error) {
    console.error(`Telegram ${method} network error`, String(error).slice(0, 200));
    return null;
  }
}

export function appLink(env: WorkerEnv, startParam?: string): string {
  const configured = (env.WEBAPP_URL?.trim() ?? '').replace(/\/+$/, '');
  // Без https кнопка web_app в Telegram не работает. Пусть лучше останется
  // ссылка на бота, чем вебхук, ведущий на localhost.
  if (!configured.startsWith('https://')) return '';
  const safe = startParam?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return safe ? `${configured}/?startapp=${encodeURIComponent(safe)}` : `${configured}/`;
}

export function botStartLink(env: WorkerEnv, payload?: string): string | null {
  const username = env.BOT_USERNAME?.trim().replace(/^@/, '');
  if (!username) return null;
  const safe = payload?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return `https://t.me/${username}${safe ? `?startapp=${encodeURIComponent(safe)}` : ''}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendWelcome(
  env: WorkerEnv,
  chatId: number,
  firstName: string,
  payload?: string,
  lang: BotLang = 'ru',
): Promise<void> {
  const link = appLink(env, payload);
  const start = botStartLink(env, payload);
  const play = pick(lang, 'Играть', 'Play');
  const text =
    lang === 'en'
      ? `<b>Board Edge</b>\n\n` +
        `${escapeHtml(firstName)}, three chess puzzles on one board: lead the pawn through the pieces, clear the jam, hold the king in his lane.\n\n` +
        `Five lives, a campaign, an endless mode, Parking and Races.\n` +
        `Hints, freeze and undo.\n\n` +
        `Press "${play}" to start.`
      : `<b>Край доски</b>\n\n` +
        `${escapeHtml(firstName)}, три шахматные головоломки на одной доске: провести пешку сквозь фигуры, разобрать пробку и удержать короля в полосе.\n\n` +
        `Пять жизней, кампания, бесконечный режим, «Парковка» и «Гонки».\n` +
        `Подсказки, заморозка и отмена хода.\n\n` +
        `Нажмите «Играть», чтобы начать.`;
  const shareText = pick(
    lang,
    'Край доски: три головоломки на одной доске. Дойти до края и не попасться.',
    'Board Edge: three puzzles on one board. Reach the edge and do not get caught.',
  );
  const playButton = link
    ? { text: play, web_app: { url: link } }
    : start
      ? { text: play, url: start }
      : null;
  const reply_markup = {
    inline_keyboard: [
      ...(playButton ? [[playButton]] : []),
      ...(start
        ? [
            [
              {
                text: pick(lang, 'Поделиться игрой', 'Share the game'),
                url: `https://t.me/share/url?url=${encodeURIComponent(start)}&text=${encodeURIComponent(shareText)}`,
              },
            ],
          ]
        : []),
    ],
  };
  await callTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup,
    disable_web_page_preview: true,
  });
}

/**
 * Строка команд в справке печатается из того же списка, что ставится в меню
 * (`setMyCommands`). Перечислить их руками - значит через полгода получить
 * «такого команды нет» в меню, где она есть, и наоборот.
 */
function commandLines(list: ReadonlyArray<{ command: string; description: string }>): string {
  const items = list.map((entry) => `/${entry.command} - ${entry.description}`);
  const half = Math.ceil(items.length / 2);
  return `${items.slice(0, half).join(' · ')}\n${items.slice(half).join(' · ')}`;
}

export async function sendHelp(env: WorkerEnv, chatId: number, lang: BotLang = 'ru'): Promise<void> {
  await callTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text:
      lang === 'en'
        ? '<b>How to play</b>\n\n' +
          'The pawn moves forward and captures diagonally forward. Never back, never sideways.\n' +
          'Pieces move by classic chess rules and hunt the player.\n' +
          'Reach the top row and the level is cleared.\n\n' +
          'Lives come back one at a time every 30 minutes.\n' +
          'Coins are paid for wins and spent on bonuses.\n\n' +
          `Commands:\n${commandLines(BOT_COMMANDS_EN)}\n` +
          `Support: ${LEGAL_CONTACT}`
        : '<b>Как играть</b>\n\n' +
          'Пешка ходит только вперёд и по диагонали вперёд. Назад и вбок нельзя.\n' +
          'Фигуры ходят по классическим шахматным правилам и охотятся на игрока.\n' +
          'Дойдите до верхнего ряда, и уровень пройден.\n\n' +
          'Жизни восстанавливаются по одной каждые 30 минут.\n' +
          'Монеты дают за победы, они тратятся на бонусы.\n\n' +
          `Команды:\n${commandLines(BOT_COMMANDS)}\n` +
          `Поддержка: ${LEGAL_CONTACT}`,
    parse_mode: 'HTML',
  });
}

/**
 * Документ (условия или политика) в чат. Печатается тем же текстом, что и
 * экран в игре: `src/legal/content.ts` - один источник на оба. Кнопка «открыть
 * в игре» ведёт на `?startapp=terms`: приложение по этому параметру само
 * раскрывает нужный экран, и человеку не надо искать его в меню.
 */
export async function sendLegal(
  env: WorkerEnv,
  chatId: number,
  kind: LegalKind,
  lang: BotLang = 'ru',
): Promise<void> {
  const chunks = legalChunks(legalDocument(kind));
  const app = appLink(env, kind);
  const markup = app
    ? {
        inline_keyboard: [
          [
            {
              text: pick(lang, 'Открыть в игре', 'Open in the game'),
              web_app: { url: app },
            },
          ],
        ],
      }
    : null;
  for (let index = 0; index < chunks.length; index += 1) {
    const last = index === chunks.length - 1;
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: chunks[index],
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(last && markup ? { reply_markup: markup } : {}),
    });
    if (last && !markup && chunks.length > 1) {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: pick(
          lang,
          'Это весь документ: в игре он на экране «Условия».',
          'That is the whole document: in the game it lives on the Terms screen.',
        ),
      });
    }
  }
}

/** /paysupport: обязательная Telegram команда про оплату и возвраты. */
export async function sendPaySupport(env: WorkerEnv, chatId: number, lang: BotLang = 'ru'): Promise<void> {
  await callTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: paySupportText(lang),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

/** /support: куда писать, и что написать, чтобы не гонять игрока кругами. */
export async function sendSupport(
  env: WorkerEnv,
  chatId: number,
  lang: BotLang = 'ru',
): Promise<void> {
  const text = supportText(lang);
  const app = appLink(env);
  await callTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(app
      ? { reply_markup: { inline_keyboard: [[{ text: pick(lang, 'Играть', 'Play'), web_app: { url: app } }]] } }
      : {}),
  });
}

export async function answerPreCheckout(
  env: WorkerEnv,
  queryId: string,
  ok: boolean,
  errorMessage?: string,
): Promise<void> {
  await callTelegram(env, 'answerPreCheckoutQuery', {
    pre_checkout_query_id: queryId,
    ok,
    ...(errorMessage ? { error_message: errorMessage.slice(0, 200) } : {}),
  });
}

export async function notifyReferrer(env: WorkerEnv, chatId: number, name: string, bonus: number): Promise<void> {
  await callTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: `По вашей ссылке пришёл ${escapeHtml(name)}. Начислено ${bonus} монет.`,
    disable_web_page_preview: true,
  });
}

// ─────────────────── привязка сайта к Telegram ───────────────────

export const AUTH_PROMPT_TTL_MINUTES = Math.round(5 * 60 * 1000 / 60000);

export async function sendAuthPrompt(
  env: WorkerEnv,
  chatId: number,
  firstName: string,
  code: string,
  lang: BotLang = 'ru',
): Promise<void> {
  const text =
    lang === 'en'
      ? `<b>Linking progress</b>\n\n` +
        `${escapeHtml(firstName)}, this request came from the game page in a browser. ` +
        `If you are the one who pressed "Link Telegram", confirm it: the progress from the site moves into your account ` +
        `and becomes available on any device.\n\n` +
        `The request lives for ${AUTH_PROMPT_TTL_MINUTES} minutes and is used once.`
      : `<b>Привязка прогресса</b>\n\n` +
        `${escapeHtml(firstName)}, этот запрос пришёл со страницы игры в браузере. ` +
        `Если кнопку «Привязать Telegram» нажал именно ты, подтверди: прогресс с сайта переедет в твой аккаунт ` +
        `и будет доступен с любого устройства.\n\n` +
        `Запрос живёт ${AUTH_PROMPT_TTL_MINUTES} минуты и используется один раз.`;
  await callTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: pick(lang, 'Да, привязать', 'Yes, link it'), callback_data: authCallbackData('yes', code) }],
        [{ text: pick(lang, 'Не надо', 'No'), callback_data: authCallbackData('no', code) }],
      ],
    },
  });
}

/** Сообщение без разметки: для коротких служебных ответов. */
export async function sendPlain(env: WorkerEnv, chatId: number, text: string): Promise<void> {
  await callTelegram(env, 'sendMessage', { chat_id: chatId, text });
}

export async function editAuthMessage(
  env: WorkerEnv,
  chatId: number,
  messageId: number,
  text: string,
  returnUrl?: string,
  lang: BotLang = 'ru',
): Promise<void> {
  await callTelegram(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' });
  // Кнопку оставляем только если есть куда вернуться: без неё повторные нажатия
  // висели бы на сообщении.
  await callTelegram(env, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: returnUrl ? [[{ text: pick(lang, 'Открыть игру', 'Open the game'), url: returnUrl }]] : [],
    },
  });
}

export async function answerCallbackQuery(
  env: WorkerEnv,
  queryId: string,
  options: { text?: string; alert?: boolean; url?: string } = {},
): Promise<void> {
  await callTelegram(env, 'answerCallbackQuery', {
    callback_query_id: queryId,
    ...(options.text ? { text: options.text.slice(0, 190), show_alert: options.alert ?? false } : {}),
    // Поле url заставляет клиент открыть ссылку сразу после нажатия: игрок
    // возвращается на сайт сам, без ручного переключения вкладок.
    ...(options.url ? { url: options.url } : {}),
  });
}

/** Адрес сайта с кодом привязки: по нему страница забирает токен сеанса. */
export function authReturnUrl(env: WorkerEnv, code: string): string {
  const base = (env.WEBAPP_URL?.trim() ?? '').replace(/\/+$/, '');
  if (!base.startsWith('https://')) return '';
  return `${base}/?link=${encodeURIComponent(code)}`;
}
