import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { getDamubalaSummary, submitFullDamubalaSheets } from './server/damubalaAnalytics.js';
import { getArtsportSummary } from './server/artsportAnalytics.js';
import { getQosymshaSummary } from './server/qosymshaAnalytics.js';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'damubala-api',
      configureServer(server) {
        server.middlewares.use('/api/summary', async (req, res) => {
          try {
            const settled = await Promise.allSettled([
              getDamubalaSummary(),
              getArtsportSummary(),
              getQosymshaSummary()
            ]);
            const [damubala, artsport, qosymsha] = settled.map((result, index) => {
              if (result.status === 'fulfilled') return result.value;
              const source = ['damubala', 'artsport', 'qosymsha'][index];
              return { ok: false, source, cities: [], errors: [result.reason?.message || `Ошибка ${source}`] };
            });
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
        server.middlewares.use('/api/damubala-submit-full', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('allow', 'POST');
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, message: 'Метод не поддерживается' }));
            return;
          }

          try {
            const body = await readBody(req);
            const result = await submitFullDamubalaSheets(body.cityId);
            res.statusCode = result.ok ? 200 : 207;
            res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(result));
          } catch (error) {
            res.statusCode = error?.statusCode || 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, message: error?.message || 'Не удалось отправить табеля' }));
          }
        });
      }
    }
  ]
});
