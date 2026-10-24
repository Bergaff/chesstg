import {
  MAX_LIVES,
  PAID_SKINS,
  PRODUCTS,
  isProductSku as isKnownSku,
  materializeLives,
  skinProductOwned,
  type CustomSkin,
  type ProductSku,
  SKINS,
  type SkinId,
} from '../src/engine';
import { ownedSkins } from './db';
import { logEvent } from './events';
import { fail } from './http';
import { callTelegram } from './telegram';
import type { UserRow, WorkerEnv } from './types';

export interface PaymentRow {
  charge_id: string;
  user_id: string;
  sku: ProductSku;
  stars: number;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  telegram_charge_id: string | null;
  created_at: number;
  paid_at: number | null;
}

/**
 * Товары описаны в движке одним словарём: цена, выдача и проверка «уже куплено»
 * берутся оттуда же, поэтому тема не может оказаться в витрине без платежа и
 * наоборот. Отдельный список sku здесь однажды разошёлся бы с PRODUCTS.
 */
export function isProductSku(value: unknown): value is ProductSku {
  return isKnownSku(value);
}

/** Тема поштучно: `skin:gold` и так далее. */
export function skuSkin(sku: ProductSku): SkinId | null {
  if (!sku.startsWith('skin:')) return null;
  const id = sku.slice(5) as SkinId;
  return id in SKINS ? id : null;
}

export interface ShareDraft {
  skin: CustomSkin;
}

export async function getPayment(env: WorkerEnv, chargeId: string): Promise<PaymentRow | null> {
  return env.DB.prepare('SELECT * FROM payments WHERE charge_id = ?').bind(chargeId).first<PaymentRow>();
}

export async function createInvoice(
  env: WorkerEnv,
  user: UserRow,
  sku: ProductSku,
  /** Тема, которую публикуют: для `sku = 'share'` без неё выставлять счёт не за что. */
  share?: ShareDraft,
): Promise<{ url: string; chargeId: string }> {
  if (!env.BOT_TOKEN?.trim()) {
    fail(503, 'payments_not_configured', 'Платежи доступны после настройки бота');
  }
  if (!isProductSku(sku)) fail(400, 'bad_sku', 'Неизвестный товар');

  const product = PRODUCTS[sku];
  const now = Date.now();
  const lives = materializeLives(user.lives, user.lives_at, now);
  const owned = ownedSkins(user);

  if (sku === 'noads' && user.ad_free) fail(409, 'already_owned', 'Реклама уже отключена');
  if (sku === 'lives' && lives.lives >= MAX_LIVES) fail(409, 'lives_full', 'Жизни уже полны');
  if (skinProductOwned(sku, owned)) {
    fail(409, 'already_owned', sku === 'skins' ? 'Все темы уже куплены' : 'Эта тема уже ваша');
  }
  if (sku === 'share' && !share) fail(400, 'skin_missing', 'Нужна тема для публикации');
  // Одной теме - одна заявка: иначе можно поставить в очередь десять копий и
  // смотреть, какая пройдёт.
  if (sku === 'share') {
    const waiting = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM skin_shares WHERE user_id = ? AND status IN ('draft', 'pending', 'approved')`,
    )
      .bind(user.id)
      .first<{ n: number }>();
    if (Number(waiting?.n ?? 0) > 0) fail(409, 'share_pending', 'У вас уже есть тема в очереди или в галерее');
  }

  const chargeId = crypto.randomUUID();

  if (sku === 'share' && share) {
    await env.DB.prepare(
      `INSERT INTO skin_shares (user_id, charge_id, name, payload, status, created_at)
       VALUES (?, ?, ?, ?, 'draft', ?)`,
    )
      .bind(user.id, chargeId, share.skin.name, JSON.stringify(share.skin), now)
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO payments (charge_id, user_id, sku, stars, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(chargeId, user.id, sku, product.stars, now)
    .run();

  const url = await callTelegram<string>(env, 'createInvoiceLink', {
    title: product.title,
    description: product.description.slice(0, 255),
    payload: chargeId,
    currency: 'XTR',
    prices: [{ label: product.title.slice(0, 32), amount: product.stars }],
  });

  if (!url) {
    await env.DB.prepare(`UPDATE payments SET status = 'failed' WHERE charge_id = ?`).bind(chargeId).run();
    fail(502, 'payment_provider_error', 'Telegram не выдал ссылку на оплату');
  }

  return { url, chargeId };
}

function entitlementStatements(env: WorkerEnv, payment: PaymentRow, user: UserRow, now: number) {
  const guard = `EXISTS (SELECT 1 FROM payments WHERE charge_id = ? AND status = 'paid' AND paid_at = ?)`;
  if (payment.sku === 'lives') {
    return [
      env.DB.prepare(
        `UPDATE users SET lives = ?, lives_at = ?, updated_at = ? WHERE id = ? AND ${guard}`,
      ).bind(MAX_LIVES, now, now, user.id, payment.charge_id, now),
    ];
  }
  if (payment.sku === 'noads') {
    return [
      env.DB.prepare(`UPDATE users SET ad_free = 1, updated_at = ? WHERE id = ? AND ${guard}`).bind(
        now,
        user.id,
        payment.charge_id,
        now,
      ),
    ];
  }
  if (payment.sku === 'skins') {
    const current = ownedSkins(user);
    const all = [...new Set(['classic', ...current, ...PAID_SKINS])].join(',');
    const skin = current.includes('classic') || current.length <= 1 ? 'gold' : user.skin;
    return [
      env.DB.prepare(`UPDATE users SET skins = ?, skin = ?, updated_at = ? WHERE id = ? AND ${guard}`).bind(
        all,
        skin,
        now,
        user.id,
        payment.charge_id,
        now,
      ),
    ];
  }
  const single = skuSkin(payment.sku);
  if (single) {
    const all = [...new Set<SkinId>(['classic', ...ownedSkins(user), single])].join(',');
    return [
      env.DB.prepare(`UPDATE users SET skins = ?, skin = ?, updated_at = ? WHERE id = ? AND ${guard}`).bind(
        all,
        single,
        now,
        user.id,
        payment.charge_id,
        now,
      ),
    ];
  }
  if (payment.sku === 'share') {
    // Оплаченный черновик становится заявкой в очереди. Сама выдача - не товар,
    // а право встать в очередь: тему ещё должен одобрить тот, кто её проверяет.
    return [
      env.DB.prepare(`UPDATE skin_shares SET status = 'pending' WHERE charge_id = ? AND status = 'draft'`).bind(
        payment.charge_id,
      ),
    ];
  }
  return [];
}

/** Идемпотентно помечает платёж оплаченным и выдаёт товар. */
export async function fulfillPayment(
  env: WorkerEnv,
  chargeId: string,
  telegramChargeId: string | null,
): Promise<boolean> {
  const payment = await getPayment(env, chargeId);
  if (!payment) {
    console.warn('Unknown payment', chargeId);
    return false;
  }
  if (payment.status !== 'pending') return false;

  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payment.user_id).first<UserRow>();
  if (!user) return false;

  const now = Date.now();
  const statements = [
    env.DB.prepare(
      `UPDATE payments SET status = 'paid', paid_at = ?, telegram_charge_id = ?
       WHERE charge_id = ? AND status = 'pending'`,
    ).bind(now, telegramChargeId, chargeId),
    ...entitlementStatements(env, payment, user, now),
  ];

  const results = await env.DB.batch(statements);
  const applied = Number(results[0]?.meta?.changes ?? 0) > 0;
  if (applied) {
    await logEvent(env, payment.user_id, 'purchase', payment.stars, { sku: payment.sku });
  }
  return applied;
}

export async function refundPayment(env: WorkerEnv, chargeId: string): Promise<boolean> {
  const payment = await getPayment(env, chargeId);
  if (!payment || payment.status === 'refunded') return false;
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payment.user_id).first<UserRow>();
  if (!user) return false;

  const now = Date.now();
  const statements = [
    env.DB.prepare(`UPDATE payments SET status = 'refunded' WHERE charge_id = ?`).bind(chargeId),
  ];
  if (payment.sku === 'noads') {
    statements.push(
      env.DB.prepare(`UPDATE users SET ad_free = 0, updated_at = ? WHERE id = ?`).bind(now, user.id),
    );
  }
  if (payment.sku === 'skins') {
    statements.push(
      env.DB.prepare(`UPDATE users SET skins = 'classic', skin = 'classic', updated_at = ? WHERE id = ?`).bind(
        now,
        user.id,
      ),
    );
  }
  const single = skuSkin(payment.sku);
  if (single) {
    // Возврат снимает ровно одну тему. «Пепел» и бесплатные темы при этом не
    // трогаются: их не покупали, и отбирать их за чужой возврат не за что.
    const kept = ownedSkins(user)
      .filter((id) => id !== single && id !== 'classic')
      .join(',');
    statements.push(
      env.DB.prepare(`UPDATE users SET skins = ?, skin = ?, updated_at = ? WHERE id = ?`).bind(
        kept ? `classic,${kept}` : 'classic',
        user.skin === single ? 'classic' : user.skin,
        now,
        user.id,
      ),
    );
  }
  if (payment.sku === 'share') {
    // Вернули взнос - забираем и место в галерее: платная витрина не может
    // остаться бесплатной.
    statements.push(
      env.DB.prepare(
        `UPDATE skin_shares SET status = 'rejected', note = 'refund', reviewed_at = ?
         WHERE charge_id = ? AND status IN ('draft', 'pending', 'approved')`,
      ).bind(now, payment.charge_id),
    );
  }
  await env.DB.batch(statements);
  await logEvent(env, user.id, 'refund', payment.stars, { sku: payment.sku });
  return true;
}
