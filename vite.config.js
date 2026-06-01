import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { getDamubalaSummary } from './server/damubalaAnalytics.js';
import { getArtsportSummary } from './server/artsportAnalytics.js';
import { getQosymshaSummary } from './server/qosymshaAnalytics.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'damubala-api',
      configureServer(server) {
        server.middlewares.use('/api/summary', async (req, res) => {
          try {
            const [damubala, artsport, qosymsha] = await Promise.all([
              getDamubalaSummary(),
              getArtsportSummary(),
              getQosymshaSummary()
            ]);
            const payload = {
              ok: damubala.ok || artsport.ok || qosymsha.ok,
              source: [
                damubala.ok ? 'damubala' : null,
                artsport.ok ? 'artsport' : null,
                qosymsha.ok ? 'qosymsha' : null
              ].filter(Boolean).join('+'),
              updatedAt: new Date().toLocaleString('ru-RU', {
                timeZone: 'Asia/Almaty',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              }),
              cities: [...(damubala.cities || []), ...(artsport.cities || []), ...(qosymsha.cities || [])],
              errors: [...(damubala.errors || []), ...(artsport.errors || []), ...(qosymsha.errors || [])]
            };
            res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('pragma', 'no-cache');
            res.setHeader('expires', '0');
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, message: error?.message || 'Ошибка Damubala' }));
          }
        });
      }
    }
  ]
});
