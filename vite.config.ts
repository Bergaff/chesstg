import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** В разработке /admin отдаёт admin.html, в сборке это отдельная страница. */
function adminRoute(): Plugin {
  return {
    name: 'admin-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '';
        if (url === '/admin' || url === '/admin/' || url.startsWith('/admin?')) {
          req.url = '/admin.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), adminRoute()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
