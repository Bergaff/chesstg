import app from './app';
import type { WorkerEnv } from './types';

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
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
