import { getArtsportSummary } from '../server/artsportAnalytics.js';
import { getDamubalaSummary } from '../server/damubalaAnalytics.js';

export default async function handler(req, res) {
  try {
    const [damubala, artsport] = await Promise.all([
      getDamubalaSummary(),
      getArtsportSummary()
    ]);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(200).json({
      ok: damubala.ok || artsport.ok,
      source: [damubala.ok ? 'damubala' : null, artsport.ok ? 'artsport' : null].filter(Boolean).join('+'),
      updatedAt: new Date().toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      cities: [...(damubala.cities || []), ...(artsport.cities || [])],
      errors: [...(damubala.errors || []), ...(artsport.errors || [])]
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error?.message || 'Ошибка аналитики' });
  }
}
