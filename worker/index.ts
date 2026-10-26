import app from './app';
import type { WorkerEnv } from './types';

/** Хост без сертификата: локальный запуск и dev-сервер. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host.startsWith('127.')
  );
}

function clientAddress(request: Request): string {
  const cf = (request as { cf?: { clientIp?: string } }).cf;
  return (cf?.clientIp ?? request.headers.get('CF-Connecting-IP') ?? '').trim();
}

/**
 * На workers.dev обычный http обслуживается воркером, Cloudflare его не редиректит.
 * Telegram такое приложение не откроет, а ссылки initData уйдут по http,
 * поэтому сами отвечаем 308 на https. Локальный запуск не трогаем: там сертификата нет.
 * Если адрес клиента не виден, тоже не редиректим, это всегда локальная проверка.
 */
function enforceHttps(url: URL, request: Request): Response | null {
  if (url.protocol !== 'http:') return null;
  if (isLoopbackHost(url.hostname)) return null;
  const ip = clientAddress(request);
  if (!ip || ip === '::1' || ip.startsWith('127.')) return null;
  url.protocol = 'https:';
  return Response.redirect(url.toString(), 308);
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const redirect = enforceHttps(url, request);
    if (redirect) return redirect;

    // Публичные документы отдаёт воркер: в собранном клиенте их нет, а
    // single-page-application fallback показал бы вместо документа игру.
    if (url.pathname.startsWith('/api/') || url.pathname === '/terms' || url.pathname === '/privacy') {
      return app.fetch(request, env, ctx);
    }
    // Админка живёт отдельной страницей и не индексируется.
    if (url.pathname === '/admin' || url.pathname === '/admin.html' || url.pathname.startsWith('/admin/')) {
      const response = await env.ASSETS.fetch(new Request(new URL('/admin.html', url), request));
      const headers = new Headers(response.headers);
      headers.set('X-Robots-Tag', 'noindex, nofollow');
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;

export { enforceHttps };
