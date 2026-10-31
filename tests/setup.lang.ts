/**
 * Тестовая среда притворяется англоязычным браузером (jsdom ставит `en-US`), а
 * интерфейс теперь берёт язык из клиента Telegram или браузера. Русская копия -
 * основной сценарий и источник подписей во всех фикстурах, поэтому тестовый
 * браузер объявлен русским: `localStorage` чистят между тестами, а `navigator`
 * никто не чистит, и на нём выбор языка держится надёжнее.
 *
 * Файл подключён как `test.setupFiles`, то есть он едет и в node-тесты воркера,
 * где нет ни `window`, ни `navigator` - там он обязан пройти молча.
 *
 * Английская ветка проверяется отдельно - там язык ставлен явным `setLang('en')`.
 */
const nav = typeof navigator === 'undefined' ? undefined : navigator;
if (nav) {
  Object.defineProperty(nav, 'language', { value: 'ru', configurable: true });
  Object.defineProperty(nav, 'languages', { value: ['ru', 'en'], configurable: true });
}
