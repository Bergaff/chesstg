/**
 * Токен бота в одной нормальной форме.
 * Значение копируют из BotFather и вставляют в панель Cloudflare, поэтому
 * пробелы, переносы и невидимые символы приходят чаще, чем опечатки.
 * Подпись initData Telegram считает по исходному токену, так что любая
 * лишняя буква или пробел дают 401 вместо работающей игры.
 */
export function botToken(env: { BOT_TOKEN?: string }): string {
  return (env.BOT_TOKEN ?? '').replace(/[\s​‎﻿]/g, '');
}

/** Есть ли токен вообще, без нормализации значения. */
export function hasBotToken(env: { BOT_TOKEN?: string }): boolean {
  return botToken(env).length > 0;
}
