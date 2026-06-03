import { submitFullDamubalaSheets } from '../server/damubalaAnalytics.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, message: 'Метод не поддерживается' });
    return;
  }

  try {
    const cityId = req.body?.cityId;
    const result = await submitFullDamubalaSheets(cityId);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(result.ok ? 200 : 207).json(result);
  } catch (error) {
    res.status(error?.statusCode || 500).json({
      ok: false,
      message: error?.message || 'Не удалось отправить табеля'
    });
  }
}
