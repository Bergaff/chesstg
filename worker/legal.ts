import {
  LEGAL_CONTACT,
  PRIVACY,
  TERMS,
  type LegalDocument,
  type LegalSection,
} from '../src/legal/content';
import { pick, type BotLang } from './i18n';

/**
 * Юридические тексты в чате бота.
 *
 * Приложение отдаёт условия и политику экраном внутри SPA - публичного URL у
 * них нет, а каталог Mini Apps и правила Telegram просят, чтобы продающий
 * Stars бот умел показать документ по команде. Поэтому текст печатается прямо
 * в чате, из того же источника, что и экран: второй копии документа в репо
 * быть не должно, иначе через квартал они разойдутся, и виноватой окажется та,
 * что в чате.
 *
 * Telegram режет сообщение на 4096 знаков. Держимся ниже с запасом и режем по
 * границам пунктов, а не по середине абзаца: документ, оборванный на слове
 * «не», читается как отказ.
 */

export type LegalKind = 'terms' | 'privacy';

/** Запас от лимита Telegram: на него не рассчитываем вёрстку клиентом. */
export const LEGAL_CHUNK_LIMIT = 3500;

export function legalDocument(kind: LegalKind): LegalDocument {
  return kind === 'privacy' ? PRIVACY : TERMS;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Блоки документа: шапка с датой редакции, затем каждый раздел одним куском.
 * Дробить дальше будет упаковщик - сами блоки незыблемы, потому что раздел
 * «7. Правила поведения» пополам - это список без заголовка.
 */
export function legalBlocks(doc: LegalDocument): string[] {
  const blocks: string[] = [
    `<b>${escapeHtml(doc.title)}</b>\n${escapeHtml(doc.updated)}\n\n${escapeHtml(doc.intro)}`,
  ];
  for (const section of doc.sections) {
    const parts = [`<b>${escapeHtml(section.title)}</b>`];
    for (const paragraph of section.paragraphs ?? []) parts.push(escapeHtml(paragraph));
    const items = (section.items ?? []).map((item) => `— ${escapeHtml(item)}`);
    if (items.length > 0) parts.push(items.join('\n'));
    blocks.push(parts.join('\n'));
  }
  return blocks;
}

/** Упаковывает блоки в сообщения. Один блок длиннее лимита режется по строкам. */
export function legalChunks(doc: LegalDocument, limit = LEGAL_CHUNK_LIMIT): string[] {
  const chunks: string[] = [];
  let current = '';
  const push = (): void => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const block of legalBlocks(doc)) {
    const pieces = block.length <= limit ? [block] : block.split('\n');
    for (const piece of pieces) {
      // Пустое сообщение Telegram не примет, а слишком длинный кусок надо
      // начать заново, а не клеить к предыдущему.
      if (current && current.length + piece.length + 2 > limit) push();
      current += `${current ? '\n\n' : ''}${piece}`;
    }
    if (current.length >= limit) push();
  }
  push();
  return chunks;
}

/** Ответ `/paysupport`: что возвращаем, когда нет, и что прислать. */
export function paySupportText(lang: BotLang): string {
  return lang === 'en'
    ? '<b>Payments and refunds</b>\n\n' +
        'Purchases in Board Edge go through Telegram Stars: lives, board themes, the theme set and custom theme slots. ' +
        'Stars leave your Telegram balance; the game never stores payment details.\n\n' +
        '<b>We refund</b> when the charge went through but the item did not arrive: themes did not unlock, ' +
        'lives did not come back, the slot stayed locked. We check the invoice and either deliver it or refund it.\n\n' +
        '<b>To find the payment</b>, send: the @username or the name the bot sees, the date of the purchase ' +
        'and the number of Stars.\n\n' +
        '<b>We do not refund</b> a delivered and used purchase: refunds inside Telegram are the platform\u2019s rules, ' +
        'not ours. Docs: /terms\n\n' +
        `Support: ${LEGAL_CONTACT}`
    : '<b>Оплата и возвраты</b>\n\n' +
        'Покупки в «Край доски» идут через Telegram Stars: жизни, темы поля, набор тем и слоты своей темы. ' +
        'Звёзды списываются с вашего баланса Telegram, платёжные данные игра не хранит.\n\n' +
        '<b>Возвращаем</b>, если счёт оплачен, а товар не выдался: темы не открылись, жизни не вернулись, ' +
        'слот своей темы остался закрытым. Проверим статус счёта и выдадим товар либо вернём звёзды.\n\n' +
        '<b>Чтобы мы нашли платёж</b>, пришлите: @username или имя, как вас видит бот, дату покупки и число звёзд.\n\n' +
        '<b>Не возвращаем</b> выданное и использованное: порядок возвратов внутри Telegram задаёт платформа, а не игра. ' +
        'Документ целиком: /terms\n\n' +
        `Почта: ${LEGAL_CONTACT}`;
}

/** Ответ `/support`: куда писать и что приложить, чтобы не гонять человека кругами. */
export function supportText(lang: BotLang): string {
  return lang === 'en'
    ? '<b>Support</b>\n\n' +
        `Write to ${LEGAL_CONTACT} - about the terms, purchases and how the game works.\n\n` +
        'If something is broken, add: the mode and level, what happened, your device and the Telegram version. ' +
        'A screenshot of the board settles most cases in one message.\n\n' +
        'Terms: /terms · Payments: /paysupport'
    : '<b>Поддержка</b>\n\n' +
        `Пишите на ${LEGAL_CONTACT} - по условиям, покупкам и работе игры.\n\n` +
        'Если что-то ломается, пришлите: режим и уровень, что произошло, модель устройства и версию Telegram. ' +
        'Скриншот поля закрывает большинство вопросов одним сообщением.\n\n' +
        'Условия: /terms · Оплата и возвраты: /paysupport';
}

const LEGAL_STYLE =
  '<style>:root{color-scheme:light dark;--ink:#1b1a16;--muted:#5d5a50;--bg:#f6f4ee;--line:#ddd8cb}' +
  '@media (prefers-color-scheme:dark){:root{--ink:#eae6d8;--muted:#a29c8a;--bg:#17160f;--line:#312e24}}' +
  'body{margin:0;background:var(--bg);color:var(--ink);' +
  'font:16px/1.65 ui-serif,Georgia,"Times New Roman",serif}' +
  'main{max-width:44rem;margin:0 auto;padding:32px 20px 8px}' +
  'h1{font-size:26px;line-height:1.3;margin:0 0 6px}' +
  'h2{font-size:18px;margin:26px 0 8px}' +
  'p{margin:0 0 14px}ul{margin:0 0 16px;padding-left:20px}li{margin:0 0 6px}' +
  '.updated,.intro{color:var(--muted)}.foot{max-width:44rem;margin:0 auto;padding:18px 20px 40px;' +
  'border-top:1px solid var(--line);color:var(--muted);font-size:13px}a{color:inherit}</style>';

function legalSectionHtml(section: LegalSection): string {
  const parts = [`<h2>${escapeHtml(section.title)}</h2>`];
  for (const paragraph of section.paragraphs ?? []) parts.push(`<p>${escapeHtml(paragraph)}</p>`);
  const items = (section.items ?? []).map((item) => `<li>${escapeHtml(item)}</li>`);
  if (items.length > 0) parts.push(`<ul>${items.join('')}</ul>`);
  return `<section>${parts.join('')}</section>`;
}

/**
 * Публичная страница документа.
 *
 * Каталог Mini Apps и модерация рекламы просят ссылку, по которой документ
 * открывается без Telegram: экран внутри приложения для проверяющего не
 * аргумент, а спарсить его он не может. Текст берётся тот же, что печатает бот
 * и что показывает игра, - разметка своя, копия текста нет.
 */
export function legalHtml(kind: LegalKind, appUrl: string): string {
  const doc = legalDocument(kind);
  const back = appUrl ? ` · <a href="${escapeHtml(appUrl)}">открыть игру</a>` : '';
  return [
    '<!doctype html>',
    '<html lang="ru">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(doc.title)} - Край доски</title>`,
    `<meta name="description" content="${escapeHtml(doc.intro)}">`,
    LEGAL_STYLE,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${escapeHtml(doc.title)}</h1>`,
    `<p class="updated">${escapeHtml(doc.updated)}</p>`,
    `<p class="intro">${escapeHtml(doc.intro)}</p>`,
    doc.sections.map(legalSectionHtml).join(''),
    '</main>',
    `<footer class="foot">«Край доски» · ${escapeHtml(LEGAL_CONTACT)}${back}</footer>`,
    '</body>',
    '</html>',
  ].join('\n');
}
