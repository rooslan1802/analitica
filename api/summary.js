import { getArtsportSummary } from '../server/artsportAnalytics.js';
import { getDamubalaSummary } from '../server/damubalaAnalytics.js';
import { getQosymshaSummary } from '../server/qosymshaAnalytics.js';

export default async function handler(req, res) {
  try {
    const [damubala, artsport, qosymsha] = await Promise.all([
      getDamubalaSummary(),
      getArtsportSummary(),
      getQosymshaSummary()
    ]);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(200).json({
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
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error?.message || 'Ошибка аналитики' });
  }
}
