import type { WorkerEnv } from './types';
import { authCallbackData } from './authLink';
import { type BotLang, pick } from './i18n';
import { botToken } from './token';

const API_BASE = 'https://api.telegram.org';

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
          'Commands: /play opens the game, /help is this note.\n' +
          'Support: silviojurk70@gmail.com.'
        : '<b>Как играть</b>\n\n' +
          'Пешка ходит только вперёд и по диагонали вперёд. Назад и вбок нельзя.\n' +
          'Фигуры ходят по классическим шахматным правилам и охотятся на игрока.\n' +
          'Дойдите до верхнего ряда, и уровень пройден.\n\n' +
          'Жизни восстанавливаются по одной каждые 30 минут.\n' +
          'Монеты дают за победы, они тратятся на бонусы.\n\n' +
          'Команды: /play открыть игру, /help эта справка.\n' +
          'Поддержка: silviojurk70@gmail.com.',
    parse_mode: 'HTML',
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
