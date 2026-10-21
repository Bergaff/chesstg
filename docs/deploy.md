# Деплой и настройка

Инструкция для продакшена: Cloudflare Worker и D1, Telegram Mini App, Stars и Adsgram. Для локальной разработки достаточно раздела о запуске в README.

## 0. Что понадобится

- аккаунт Cloudflare с включённым Workers и D1;
- Node.js 20+ и npm;
- бот, созданный в [@BotFather](https://t.me/BotFather), и его токен;
- аккаунт в кабинете [Adsgram](https://adsgram.ai) (для rewarded-видео);
- публичный HTTPS-домен: подойдёт `*.workers.dev` или свой домен в Cloudflare.

Проверьте авторизацию wrangler:

```bash
npx wrangler login
npx wrangler whoami
```

## 1. База D1

```bash
npx wrangler d1 create pawn-vs-all
```

Команда выведет `database_id`. Вставь его в `wrangler.jsonc` вместо заглушки:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "pawn-vs-all",
    "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "migrations_dir": "migrations"
  }
]
```

Боевой ID базы для этого проекта: `9fc9827a-6f88-49c0-9e9a-cd41418f621b`, он уже вписан в `wrangler.jsonc`. Если создаёте новую базу, замените его на свой.

Примени схему удалённо:

```bash
npm run db:remote
```

Проверить таблицы:

```bash
npx wrangler d1 execute pawn-vs-all --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

Должны быть `users`, `runs`, `grants`, `ad_events`, `payments`.

### Проверка боевой базы

Миграции применяются отдельно к локальной и к боевой базе. `npm run db:local` боевую не трогает.

```bash
npm run db:status        # какие миграции уже есть в боевой базе
npm run db:remote        # применить недостающие
```

Если таблиц нет, `/api/session` отвечает 503 `db_not_ready`, а `/api/health` перечисляет отсутствующие таблицы в поле `missing`.

## 2. Переменные

Публичные значения в `wrangler.jsonc`:

```jsonc
"vars": {
  "WEBAPP_URL": "https://pawn-vs-all.<account>.workers.dev",
  "BOT_USERNAME": "pawn_vs_all_bot",
  "ALLOW_GUESTS": "true",
  "DEV_MODE": "false",
  "ADSGRAM_SRC": "https://sad.adsgram.ai/js/sad.min.js",
  "ADSGRAM_BLOCK_ID": "12345"
}
```

- `WEBAPP_URL` можно оставить пустым: тогда ссылки в сообщениях бота собираются из домена, на который пришёл вебхук. Явное значение нужно для своего домена и для корректных ссылок в клиенте.
- `DEV_MODE: "false"` отключает демо-рекламу и требует секрет для webhook. Это значение по умолчанию в репозитории. Локально демо включается строкой `DEV_MODE=true` в `.dev.vars`.
- `ALLOW_GUESTS` оставь `true`, если хочешь, чтобы ссылку можно было открыть в обычном браузере. Для полностью закрытого продукта поставь `false` и удали гостевые записи.
- `WEBAPP_URL` должен быть HTTPS и без слэша на конце.

Секреты:

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SECRET
```

`ADMIN_PASSWORD` это пароль для входа в админку `/admin`, `ADMIN_SECRET` любая случайная строка для подписи сессий (`openssl rand -hex 32`). Вместо открытого пароля можно задать `ADMIN_PASSWORD_HASH` с sha256 в hex:

```bash
printf '%s' 'пароль' | sha256sum | cut -d' ' -f1
npx wrangler secret put ADMIN_PASSWORD_HASH
```

Если `ADMIN_SECRET` не задан, админка отвечает 503 и не пускает никого.

`WEBHOOK_SECRET` любая случайная строка (например, `openssl rand -hex 32`). Telegram будет присылать её в заголовке `X-Telegram-Bot-Api-Secret-Token`.

Для локальной разработки секреты можно положить в `.dev.vars` (шаблон `.dev.vars.example`). Этот файл уже в `.gitignore`.

## 3. Сборка и деплой

```bash
npm ci
npm run typecheck
npm test
npm run deploy
```

`npm run deploy` собирает SPA в `dist/`, затем выполняет `wrangler deploy`. Worker раздаёт статику через binding `ASSETS`, а `/api/*` обрабатывает Hono. SPA-фолбэк настроен, поэтому прямые ссылки работают.

### Деплой из панели Cloudflare (Workers Builds)

Если проект подключён к git в панели, Cloudflare сам ставит зависимости и запускает команду деплоя. Сборку он не угадывает, поэтому её нужно указать явно, иначе `wrangler deploy` падает с ошибкой:

```
The directory specified by the "assets.directory" field in your configuration file does not exist: /opt/buildhome/repo/dist
```

Это значит, что `npm run build` не выполнялся и папки `dist` нет. Откройте проект в панели: `Workers & Pages` → проект → `Settings` → `Build`, и заполните:

| Поле | Значение |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Второй вариант: оставить поле сборки пустым, а в деплой вписать `npm run deploy`. Этот скрипт сначала собирает, потом деплоит. Смешивать не нужно: если в деплое стоит `npm run deploy`, сборка выполнится дважды.

Проверка:

```bash
curl https://<worker>.workers.dev/api/health
# {"ok":true,...}
```

Если `health` вернул 503, значит не применены миграции или неверный `database_id`. Ответ `health` содержит поле `warnings` со списком того, что забыли настроить: `webapp_url_not_https`, `webapp_url_origin_mismatch`, `bot_token_missing`, `webhook_secret_missing`, `admin_secret_missing`, `adsgram_block_missing`, `dev_mode` и другие. Пустой массив значит, что всё на месте.

## 4. Telegram: Mini App и меню

1. Открой [@BotFather](https://t.me/BotFather) → `/newbot`, получи токен.

> Важно: это Mini App, а не игра Telegram. Используй `/newapp` (раздел Mini Apps), а не `/newgame`. Игровая платформа `/newgame` рассчитана на `sendGame`, `game_short_name` и таблицу очков через `setGameScore`, в ней нет `initData`, оплаты Stars и полноценного WebApp API, поэтому наш сценарий там не работает.
2. `/newapp` → выбери бота → название `Пешка против всех` → описание → иконка 512×512 (файл `public/icon-512.png`) → URL `https://<worker>.workers.dev/`.
   Для карточки в каталогах и превью описания подготовлена обложка `docs/assets/cover-640x360.png` в том же визуальном языке.
3. `/setmenubutton` → выбери бота → URL приложения → текст кнопки `Играть`.
4. Команды:

```
start Открыть игру
play Играть
help Как играть
```

5. Для ссылок-вызовов и рефералов задай `BOT_USERNAME` и перезапусти деплой.

### Подключение вебхука

Токен и секрет кладутся в секреты воркера:

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npm run deploy
```

Дальше проще всего через админку: открой `https://<worker>.workers.dev/admin`, вкладка `Бот`. Нажми `Сгенерировать`, впиши адрес приложения и нажми `Подключить бота`. Страница сама вызовет `setWebhook`, поставит команды `start`, `play`, `help` и кнопку меню «Играть», затем покажет ответ Telegram по каждому шагу и состояние очереди обновлений.

Вручную то же самое:

```bash
export BOT_TOKEN="123456:AA..."
export WEBHOOK_SECRET="$(openssl rand -hex 32)"

curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=https://<worker>.workers.dev/api/telegram/webhook" \
  -d "secret_token=${WEBHOOK_SECRET}" \
  -d 'allowed_updates=["message","pre_checkout_query"]'
```

Проверить:

```bash
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
```

В `last_error_message` должно быть пусто. Если видишь `401 Unauthorized`, неверный токен. Если `403 Forbidden`, секрет в `setWebhook` не совпадает с `WEBHOOK_SECRET` воркера. Адрес в `WEBAPP_URL` должен совпадать с доменом, на котором открыта админка, иначе ссылки в сообщениях бота будут вести не туда: вкладка `Бот` предупреждает об этом отдельной строкой.

> Для локального теста бота нужен публичный туннель (Cloudflare Tunnel, ngrok). Укажи его в `WEBAPP_URL` и в webhook. Telegram не достучится до `localhost`.

## 5. Telegram Stars

Отдельный платёжный провайдер для Stars не нужен. Worker создаёт счёт через `createInvoiceLink` в валюте `XTR`:

- `lives` 25 звёзд, восстанавливает все 5 жизней;
- `noads` 150 звёзд, навсегда отключает рекламу;
- `skins` 50 звёзд, открывает золото/неон/королевский скин и сразу надевает золотой.

Поток:

1. Клиент → `POST /api/shop/invoice` → Worker создаёт запись `payments` и ссылку Stars.
2. `Telegram.WebApp.openInvoice` открывает окно оплаты.
3. Telegram присылает `pre_checkout_query` → Worker отвечает меньше чем за 10 секунд.
4. Приходит `successful_payment` → товар выдаётся ровно один раз (guard по `paid_at`).
5. Клиент опрашивает `GET /api/pay/status`, обновляет профиль и показывает успех.
6. При возврате приходит `refunded_payment` → покупка откатывается.

Чек-лист:

- протестируй оплату в реальном Telegram (тестовый режим Stars недоступен в обычном браузере);
- проверь, что после оплаты профиль обновился без перезапуска;
- проверь, что повторный webhook не выдаёт товар второй раз;
- проверь возврат: `noads` должен снова включить рекламу, `skins` вернуть классический скин;
- выплаты Stars доступны в кабинете бота через BotFather (условия Telegram могут меняться).

## 6. Adsgram

1. В кабинете Adsgram создай приложение и Rewarded Video блок.
2. Скопируй `Block ID` в `ADSGRAM_BLOCK_ID`.
3. Оставь `ADSGRAM_SRC=https://sad.adsgram.ai/js/sad.min.js`.
4. Задеплой и проверь на реальном устройстве в Telegram.

Особенности:

- В браузере SDK не загрузится (CORS/окружение) это нормально, клиент показывает демо-заглушку только при `DEV_MODE=true`. В продакшене при недоступной рекламе пользователь увидит тост «Реклама временно недоступна».
- Один контроллер `init()` кэшируется на странице; не вызывай `init` на каждый показ.
- Награда начисляется только после `done` от SDK. Сервер дополнительно проверяет кулдауны: жизнь 45 секунд, монеты 60, щит 20, и запрещает награды при `ad_free`.
- Для больших объёмов можно подключить server-side verification Adsgram (см. их документацию); текущая реализация клиентский `done` + серверные лимиты.

## 7. Продакшен-чек-лист

- [ ] `database_id` заменён, миграции применены.
- [ ] `BOT_TOKEN` и `WEBHOOK_SECRET` заданы как секреты.
- [ ] `DEV_MODE: "false"`, `WEBAPP_URL` HTTPS, `BOT_USERNAME` заполнен.
- [ ] `getWebhookInfo` без ошибок.
- [ ] Почта поддержки в `src/legal/content.ts` актуальна и принимает письма.
- [ ] Mini App открывается из кнопки бота и из меню.
- [ ] В Telegram проходит первый уровень, сохранение переживает закрытие.
- [ ] Победа начисляет монеты, поражение списывает жизнь.
- [ ] Покупки Stars: успех, отказ, возврат.
- [ ] Rewarded: +1 жизнь, +30 монет, щит; после `noads` кнопки исчезают.
- [ ] Бесконечный режим открывается на 10 уровне.
- [ ] Рекорды: глобально и по друзьям, реферальная ссылка начисляет +25.
- [ ] Нет ошибок в `wrangler tail` при типичных сценариях.

## 8. Админка и статистика

Страница `https://<worker>.workers.dev/admin` живёт отдельно от Mini App: свой `admin.html`, свой бандл, `noindex` и `Cache-Control: no-store`. Вход только по паролю, регистрации нет. Сессия подписанным токеном на 12 часов лежит в `sessionStorage`, после восьми неудачных попыток с одного IP вход блокируется на 15 минут.

После первого входа доступны вкладки:

- `Обзор`: игроки, забеги, победность, новые и активные по дням, ретеншн D1/D7, экономика, воронка по максимальному уровню, попытки по уровням, бесконечный режим, топы.
- `Уровни`: точечная проверка генератора (уровень и число сидов) и прогон диапазона 1–60 с кэшем в `level_checks`.
- `Лаборатория`: полный перебор расстановок уровня до 12000 вариантов, оценка решений и сохранение отчётов в `audit_runs`.
- `Игроки`: поиск и сортировка, карточка с забегами, покупками и событиями.
- `Платежи`: сводка по товарам и последние счета в звёздах.
- `Бот`: состояние вебхука, адрес приложения, очередь обновлений и последняя ошибка доставки. Кнопка подключения ставит вебхук, команды и кнопку меню, кнопка отключения снимает вебхук.

Данные лежат в D1: миграция `0002_admin.sql` создаёт `events`, `admin_attempts`, `level_checks` и `audit_runs`. События (`coins_earned`, `coins_spent`, `life_lost`, `ad_reward`, `bonus_used`, `purchase`, `refund`) пишутся через `waitUntil` и не задерживают ответ. Если миграцию не применить, админка откроется, но статистика будет пустой, а проверки уровней не сохранятся.

Локально:

```bash
# .dev.vars: ADMIN_PASSWORD и ADMIN_SECRET
npm run db:local
npm run dev:worker     # /admin на http://localhost:8787
npm run dev            # /admin проксируется на API через vite
```

## 9. Эксплуатация

Логи:

```bash
npx wrangler tail
```

Бэкап D1:

```bash
npx wrangler d1 export pawn-vs-all --remote --output=backup-$(date +%F).sql
```

Новая миграция:

```bash
# migrations/0002_admin.sql
npm run db:remote
npm run deploy
```

Откат Worker:

```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

Откат миграции делай отдельным SQL-скриптом: D1 не поддерживает `down`-миграции автоматически.

## 10. Частые проблемы

| Симптом | Причина и решение |
| --- | --- |
| `401 invalid_init_data` | Открыто не из Telegram, либо `BOT_TOKEN` не тот, либо initData старше 48 часов. Открой через кнопку бота. |
| `503 auth_not_configured` | Не задан `BOT_TOKEN`. |
| `401 guests_disabled` | `ALLOW_GUESTS=false`, а запрос без `tma`-заголовка. |
| `health` 503, `error: db_not_ready` | Боевая база пустая или не та. `npm run db:status`, затем `npm run db:remote`. Поле `missing` показывает, каких таблиц не хватает. |
| `/api/session` 500 | До этой правки означало отсутствующие таблицы. Сейчас такой запрос возвращает 503 `db_not_ready`. Если всё ещё 500, смотрите `wrangler tail`: ошибка внутри кода, а не в схеме. |
| `health` 503, `error: db_unavailable` | Воркер не может открыть D1: проверьте `database_id` и привязку `DB`. |
| `health` без поля `schemaVersion` | Задеплоен старый коммит. Проверьте, какая ветка стоит веткой продакшена в Workers Builds. |
| `assets.directory ... does not exist: .../dist` при сборке в панели | В Workers Builds не указана команда сборки. Поставьте `npm run build` либо деплой-команду `npm run deploy`. |
| `health` отдаёт `dev_mode` в `warnings` | В `wrangler.jsonc` остался `DEV_MODE: "true"`. Для продакшена нужно `false` и повторный деплой. |
| `webapp_url_origin_mismatch` | `WEBAPP_URL` не совпадает с доменом воркера. Ссылки в сообщениях бота будут вести не туда. |
| Пустая страница на `/` | Не собран `dist/`; запусти `npm run build` и задеплой. |
| Реклама не показывается | Не задан `ADSGRAM_BLOCK_ID`, блок отклонён модерацией или открыт браузер вместо Telegram. |
| Платёж «обрабатывается» | Webhook не доставлен: проверь `getWebhookInfo`, секрет и `allowed_updates`. |
| `403` на webhook | Не совпадает `WEBHOOK_SECRET` или не задан, а `DEV_MODE=false`. |
| Сбросился прогресс | Открыто в другом браузере/гостевом режиме; гостевой ID хранится в localStorage. |

## 11. Стоимость и лимиты

- Workers Free: 100k запросов/сутки; D1 Free: 5 ГБ и 5 млн чтений/сутки. Для старта хватает, при росте включи Workers Paid.
- Статика отдаётся бесплатно через assets; API на каждый ход делает несколько чтений/записей D1.
- Сохранения дебаунсятся на клиенте (450 мс) и дублируются `keepalive` при закрытии, поэтому лишних запросов немного.
- Если нагрузка вырастет: кэшируй `/api/config`, вынеси лидерборд в отдельную таблицу/кэш, включи D1 read replication.
