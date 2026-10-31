/**
 * Проверка initData локально, чтобы не гадать, какую строку подписал Telegram.
 *
 *   BOT_TOKEN="123:ABC" node scripts/check-initdata.mjs "auth_date=...&user=...&hash=..."
 *
 * Выводит, какие схемы склейки совпали со значением `hash`.
 */
import { createHmac, createHash } from 'node:crypto';

const initData = process.argv[2] ?? (await readStdin());
const token = (process.env.BOT_TOKEN ?? '').trim();
if (!token || !initData) {
  console.error('Нужны BOT_TOKEN в окружении и initData первым аргументом');
  process.exit(1);
}

const params = [...new URLSearchParams(initData).entries()];
const hash = (params.find(([key]) => key === 'hash')?.[1] ?? '').toLowerCase();
const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();

const rules = {
  'hash и пустые выброшены': { drop: ['hash'], dropEmpty: true },
  'hash, signature': { drop: ['hash', 'signature'], dropEmpty: true },
  'hash, без правила про пустые': { drop: ['hash'], dropEmpty: false },
  'hash, signature, без правила про пустые': { drop: ['hash', 'signature'], dropEmpty: false },
  'сырые значения из query': { drop: ['hash'], dropEmpty: true, raw: true },
};

const rawPairs = initData.split('&').map((pair) => {
  const index = pair.indexOf('=');
  return [pair.slice(0, index), pair.slice(index + 1)];
});

const matches = [];
for (const [name, rule] of Object.entries(rules)) {
  const source = rule.raw ? rawPairs : params;
  const check = source
    .filter(([key, value]) => !rule.drop.includes(key) && (rule.dropEmpty ? value !== '' : true))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const hmac = createHmac('sha256', secretKey).update(check).digest('hex');
  const sha = createHash('sha256').update(check).digest('hex');
  const verdict = hmac === hash ? 'HMAC совпал' : sha === hash ? 'это SHA-256, подпись по ключу приложения' : 'нет';
  if (verdict !== 'нет') matches.push(name);
  console.log(`${name}: ${verdict}`);
}

if (matches.length === 0) {
  console.log('\nНи одна схема не совпала. Значит initData подписана другим токеном или другим приложением.');
  console.log(`Строка, которую ожидаем мы: \n${params.filter(([key]) => key !== 'hash').map(([k, v]) => `${k}=${v}`).join('\n')}`);
} else {
  console.log(`\nСовпало схем: ${matches.length}, первая ${matches[0]}`);
}
