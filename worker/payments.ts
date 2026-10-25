import {
  MAX_LIVES,
  SKIN_CUSTOM_SLOTS_MAX,
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
import { customSlotsOf, ownedSkins } from './db';
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

/**
 * Своя тема становится заявкой в очереди. Взноса нет: платят за слот, а не за
 * то, что чужие увидят рисунок, поэтому строка сразу едет в `pending` и без
 * `payments` - статистика покупок остаётся статистикой покупок. Очередь при этом
 * живая: поток «накидал за минуту» отсекает не цена, а руки модератора.
 *
 * `limit` - сколько открытых тем разрешено автору: по числу купленных слотов.
 * Три слота - три темы в галерее; одна заявка на аккаунт означала бы, что
 * купленное место простаивает.
 */
export async function publishSkinShare(
  env: WorkerEnv,
  user: UserRow,
  skin: CustomSkin,
  limit = 1,
): Promise<void> {
  const open = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM skin_shares WHERE user_id = ? AND status IN ('draft', 'pending', 'approved')`,
  )
    .bind(user.id)
    .first<{ n: number }>();
  if (Number(open?.n ?? 0) >= Math.max(1, limit)) {
    fail(409, 'share_pending', 'Все ваши слоты уже стоят в очереди или в галерее');
  }
  await env.DB.prepare(
    `INSERT INTO skin_shares (user_id, charge_id, name, payload, status, created_at)
     VALUES (?, NULL, ?, ?, 'pending', ?)`,
  )
    .bind(user.id, skin.name, JSON.stringify(skin), Date.now())
    .run();
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
  const owned = ownedSkins(user);

  if (sku === 'noads' && user.ad_free) fail(409, 'already_owned', 'Реклама уже отключена');
  // Мастерскую покупают один раз на аккаунт: права «нарисовать ещё одну» за те
  // же звёзды не существует - вторая покупка была бы платой за ничто.
  // Мастерская продаётся слотами: первая покупка открывает её, вторая и третья
  // докупают место по той же цене. Отказывать «уже открыто» значило бы запретить
  // вторую тему - поэтому упираться можно только в потолок.
  if (sku === 'custom' && customSlotsOf(user) >= SKIN_CUSTOM_SLOTS_MAX) {
    fail(409, 'slots_full', `Больше ${SKIN_CUSTOM_SLOTS_MAX} своих тем на аккаунт нельзя`);
  }
  if (sku === 'lives' && lives.lives >= MAX_LIVES) fail(409, 'lives_full', 'Жизни уже полны');
  if (skinProductOwned(sku, owned)) {
    fail(409, 'already_owned', sku === 'skins' ? 'Все темы уже куплены' : 'Эта тема уже ваша');
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
  if (payment.sku === 'custom') {
    // Товар - место, а не тема: рисунки в слотах и надетая тема остаются как
    // есть, платёж поднимает число слотов на единицу. `custom_paid` пишем и
    // дальше: так строка, купленная до миграции 0007, читается одинаково с
    // новой, а возврат откатывает ровно то, за что платили.
    return [
      env.DB.prepare(
        `UPDATE users
            SET custom_paid = 1,
                custom_slots = MIN(?, MAX(custom_slots, ?) + 1),
                updated_at = ?
          WHERE id = ? AND ${guard}`,
      ).bind(SKIN_CUSTOM_SLOTS_MAX, customSlotsOf(user), now, user.id, payment.charge_id, now),
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
  if (payment.sku === 'custom') {
    // Возврат забирает последнее купленное место, но рисунки не стирает: их
    // делал игрок, и при следующей покупке он получит свою тему обратно. Слот
    // за пределами купленного числа невидим (`customSlotsOf`), поэтому тема
    // лежит в колонке до тех пор, пока место не купят снова.
    statements.push(
      env.DB.prepare(
        `UPDATE users SET custom_slots = MAX(0, custom_slots - 1), custom_paid = 0,
         skin = CASE WHEN skin = 'custom' THEN 'classic' ELSE skin END,
         updated_at = ? WHERE id = ?`,
      ).bind(now, user.id),
    );
    // Флаг `custom_paid` больше не обгоняет число слотов: он означает «мастерская
    // открыта», и открыта она, пока хотя бы одно место оплачено.
    statements.push(
      env.DB.prepare(`UPDATE users SET custom_paid = CASE WHEN custom_slots >= 1 THEN 1 ELSE 0 END WHERE id = ?`).bind(
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
  await env.DB.batch(statements);
  await logEvent(env, user.id, 'refund', payment.stars, { sku: payment.sku });
  return true;
}
