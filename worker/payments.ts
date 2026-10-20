import {
  MAX_LIVES,
  PAID_SKINS,
  PRODUCTS,
  materializeLives,
  type ProductSku,
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

export function isProductSku(value: unknown): value is ProductSku {
  return value === 'lives' || value === 'noads' || value === 'skins';
}

export async function getPayment(env: WorkerEnv, chargeId: string): Promise<PaymentRow | null> {
  return env.DB.prepare('SELECT * FROM payments WHERE charge_id = ?').bind(chargeId).first<PaymentRow>();
}

export async function createInvoice(
  env: WorkerEnv,
  user: UserRow,
  sku: ProductSku,
): Promise<{ url: string; chargeId: string }> {
  if (!env.BOT_TOKEN?.trim()) {
    fail(503, 'payments_not_configured', 'Платежи доступны после настройки бота');
  }
  if (!isProductSku(sku)) fail(400, 'bad_sku', 'Неизвестный товар');

  const product = PRODUCTS[sku];
  const now = Date.now();
  const lives = materializeLives(user.lives, user.lives_at, now);

  if (sku === 'noads' && user.ad_free) fail(409, 'already_owned', 'Реклама уже отключена');
  if (sku === 'lives' && lives.lives >= MAX_LIVES) fail(409, 'lives_full', 'Жизни уже полны');
  if (sku === 'skins' && PAID_SKINS.every((s) => ownedSkins(user).includes(s))) {
    fail(409, 'already_owned', 'Все скины уже куплены');
  }

  const chargeId = crypto.randomUUID();
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
  await env.DB.batch(statements);
  await logEvent(env, user.id, 'refund', payment.stars, { sku: payment.sku });
  return true;
}
