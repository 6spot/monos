import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const apiURL = new URL(process.env.MONOS_API_ORIGIN ?? 'http://127.0.0.1:18443');
if (!['http:', 'https:'].includes(apiURL.protocol) || apiURL.username || apiURL.password || apiURL.pathname !== '/' || apiURL.search || apiURL.hash) {
  throw new Error('MONOS_API_ORIGIN must be an HTTP(S) origin');
}
const apiOrigin = apiURL.origin;
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: {
      '/v1': {
        target: apiOrigin, secure: true, changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (upstream, request) => {
            // Only the fixed local development origin may cross this proxy.
            // Missing or foreign Origins remain unchanged and fail server guards.
            if (request.headers.origin === 'http://127.0.0.1:5173') upstream.setHeader('Origin', apiOrigin);
          });
        },
      },
    },
  },
});
