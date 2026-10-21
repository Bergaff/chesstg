import { describe, expect, it } from 'vitest';
import { INIT_DATA_MESSAGES, validateInitData } from './auth';
import { botToken } from './token';

const encoder = new TextEncoder();
const TOKEN = '123456:AAExampleTokenForTests';

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(values: Record<string, string>, token: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const secretKey = await crypto.subtle.sign('HMAC', base, encoder.encode('WebAppData'));
  const dataCheckString = Object.entries(values)
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const key = await crypto.subtle.importKey('raw', new Uint8Array(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(dataCheckString)));
}

async function initData(values: Record<string, string>, token = TOKEN): Promise<string> {
  const hash = await sign(values, token);
  const params = new URLSearchParams({ ...values, hash });
  return params.toString();
}

const USER = JSON.stringify({ id: 777, first_name: 'Аня', username: 'anya' });

function values(authDate: number): Record<string, string> {
  return { auth_date: String(authDate), user: USER, query_id: 'aaa' };
}

describe('проверка initData', () => {
  it('принимает корректную подпись', async () => {
    const result = await validateInitData(await initData(values(Math.floor(Date.now() / 1000))), TOKEN);
    expect(result.reason).toBeNull();
    expect(result.check?.user.id).toBe(777);
    expect(result.check?.user.first_name).toBe('Аня');
    expect(result.fields).toEqual(['auth_date', 'hash', 'query_id', 'user']);
  });

  it('принимает заглавные буквы в подписи', async () => {
    const raw = await initData(values(Math.floor(Date.now() / 1000)));
    const upper = raw.replace(/hash=([^&]+)/, (_m, hash: string) => `hash=${hash.toUpperCase()}`);
    const result = await validateInitData(upper, TOKEN);
    expect(result.check?.user.id).toBe(777);
  });

  it('ругается на подпись от другого бота', async () => {
    const raw = await initData(values(Math.floor(Date.now() / 1000)), '999:other');
    const result = await validateInitData(raw, TOKEN);
    expect(result.reason).toBe('bad_signature');
    expect(INIT_DATA_MESSAGES.bad_signature).toContain('BOT_TOKEN');
  });

  it('ловит подменённого пользователя', async () => {
    const honest = await initData(values(Math.floor(Date.now() / 1000)));
    const params = new URLSearchParams(honest);
    params.set('user', JSON.stringify({ id: 1, first_name: 'Чужой' }));
    const result = await validateInitData(params.toString(), TOKEN);
    expect(result.reason).toBe('bad_signature');
  });

  it('различает устаревшие данные, пустой ввод и отсутствие подписи', async () => {
    const old = await initData(values(Math.floor(Date.now() / 1000) - 60 * 60 * 49));
    expect((await validateInitData(old, TOKEN)).reason).toBe('too_old');
    expect((await validateInitData('', TOKEN)).reason).toBe('no_params');
    expect((await validateInitData(new URLSearchParams(values(1)).toString(), TOKEN)).reason).toBe('no_hash');
    expect((await validateInitData(await initData(values(1)), '')).reason).toBe('no_params');
  });

  it('не верит будущему auth_date', async () => {
    const future = await initData(values(Math.floor(Date.now() / 1000) + 3600));
    expect((await validateInitData(future, TOKEN)).reason).toBe('clock_skew');
  });

  it('требует профиль', async () => {
    const noUser = await initData({ auth_date: String(Math.floor(Date.now() / 1000)) });
    expect((await validateInitData(noUser, TOKEN)).reason).toBe('no_user');
  });
});

describe('поле signature от ссылок в канале', () => {
  const fresh = () => Math.floor(Date.now() / 1000);

  it('принимает подпись, где signature участвует в склейке', async () => {
    const values = { ...values2(fresh()), signature: 'ChannelName' };
    const result = await validateInitData(await initData(values), TOKEN);
    expect(result.reason).toBeNull();
    expect(result.variant).toBe('canonical');
  });

  it('принимает подпись, где signature добавлена уже после склейки', async () => {
    const base = values2(fresh());
    const signed = await initData(base);
    const result = await validateInitData(`${signed}&signature=ChannelName`, TOKEN);
    expect(result.reason).toBeNull();
    expect(result.variant).toBe('no_signature');
  });

  it('принимает подпись с пустым полем внутри', async () => {
    const values = { ...values2(fresh()), start_param: '' };
    const result = await validateInitData(await initData(values), TOKEN);
    expect(result.reason).toBeNull();
    expect(result.variant).toBe('keep_empty');
  });

  it('не принимает подменённого пользователя рядом с signature', async () => {
    const values = { ...values2(fresh()), signature: 'ChannelName' };
    const raw = await initData(values);
    const params = new URLSearchParams(raw);
    params.set('user', JSON.stringify({ id: 1, first_name: 'Чужой' }));
    const result = await validateInitData(params.toString(), TOKEN);
    expect(result.reason).toBe('bad_signature');
  });
});

function values2(authDate: number): Record<string, string> {
  return { auth_date: String(authDate), user: USER, chat_instance: 'abc', chat_type: 'sender' };
}

describe('стороннее приложение', () => {
  it('отличает подпись чужого приложения от опечатки в токене', async () => {
    const values = { auth_date: String(Math.floor(Date.now() / 1000)), user: USER, chat_type: 'sender' };
    const params = new URLSearchParams(values);
    const dataCheckString = Object.entries(values)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataCheckString));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    params.set('hash', hash);
    params.set('signature', 'base64sig');

    const result = await validateInitData(params.toString(), TOKEN);
    expect(result.reason).toBe('third_party');
    expect(INIT_DATA_MESSAGES.third_party).toContain('чужого бота');
  });
});

describe('подпись по ключу приложения', () => {
  const signedData = async () => {
    const values = { auth_date: String(Math.floor(Date.now() / 1000)), user: USER, chat_type: 'sender' };
    const dataCheckString = Object.entries(values)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataCheckString));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return new URLSearchParams({ ...values, hash, signature: 'c2ln' }).toString();
  };

  it('принимает initData, когда подпись ключа сошлась', async () => {
    const raw = await signedData();
    const seen: string[] = [];
    const result = await validateInitData(raw, TOKEN, async (candidates, signature) => {
      seen.push(signature);
      return candidates.length >= 2 && signature === "c2ln";
    });
    expect(result.reason).toBeNull();
    expect(result.variant).toBe('signed');
    expect(result.check?.user.id).toBe(777);
    expect(seen).toEqual(['c2ln']);
  });

  it('отказывается, если подпись ключа не прошла', async () => {
    const raw = await signedData();
    const result = await validateInitData(raw, TOKEN, async () => false);
    expect(result.reason).toBe('third_party');
  });
});

describe('значения с плюсиками', () => {
  const signOver = async (check: string, token: string) => {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const secretKey = await crypto.subtle.sign('HMAC', base, new TextEncoder().encode('WebAppData'));
    const key = await crypto.subtle.importKey('raw', new Uint8Array(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(check)))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };

  it('не ломает base64 со знаком плюс', async () => {
    const instance = 'Q+Zk/abc==';
    const user = encodeURIComponent(USER);
    const check = `auth_date=${'1792560000'}\nchat_instance=${instance}\nuser=${user}`;
    const hash = await signOver(check, TOKEN);
    const result = await validateInitData(`auth_date=1792560000&chat_instance=${instance}&user=${user}&hash=${hash}`, TOKEN);
    expect(result.reason).toBeNull();
    expect(result.check?.user.id).toBe(777);
  });
});

describe('токен бота', () => {
  it('срезает пробелы и невидимые символы', () => {
    expect(botToken({ BOT_TOKEN: `\n ${TOKEN}\u200b \r` })).toBe(TOKEN);
    expect(botToken({})).toBe('');
  });
});

describe('ключ подписи по документам Telegram', () => {
  /** secret_key = HMAC-SHA256(key="WebAppData", msg=bot_token). Порядок зафиксирован в документах. */
  async function signDocs(values: Record<string, string>, token: string): Promise<string> {
    const base = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    const secretKey = await crypto.subtle.sign('HMAC', base, encoder.encode(token));
    const dataCheckString = Object.entries(values)
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const key = await crypto.subtle.importKey('raw', new Uint8Array(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(dataCheckString)));
  }

  it('принимает подпись, посчитанную как в документах', async () => {
    const payload = { ...values(Math.floor(Date.now() / 1000)), chat_type: 'private' };
    const hash = await signDocs(payload, TOKEN);
    const raw = new URLSearchParams({ ...payload, hash }).toString();
    const result = await validateInitData(raw, TOKEN);
    expect(result.check?.user.id).toBe(777);
    expect(result.reason).toBeNull();
  });

  it('золотой вектор из документов Telegram', async () => {
    const raw =
      'query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2';
    const result = await validateInitData(
      raw,
      '5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8',
    );
    // Подпись совпадает, а данные двухлетней давности: отказ по возрасту, не по подписи.
    expect(result.variant).toBe('canonical');
    expect(result.reason).toBe('too_old');
  });
});
