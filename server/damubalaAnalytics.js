const BASE_URL = 'https://damubala.kz';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

function getAccounts() {
  return [
    {
      id: 'north',
      iin: requiredEnv('DAMUBALA_NORTH_IIN'),
      password1: requiredEnv('DAMUBALA_NORTH_PASSWORD'),
      password2: requiredEnv('DAMUBALA_NORTH_PASSWORD_ALT'),
      cities: [
        { id: 'petropavlovsk', name: 'Петропавловск', region: 'СКО' },
        { id: 'rudny', name: 'Рудный', region: 'Костанайская область' }
      ]
    },
    {
      id: 'turkestan',
      iin: requiredEnv('DAMUBALA_TURKESTAN_IIN'),
      bin: requiredEnv('DAMUBALA_TURKESTAN_BIN'),
      password1: requiredEnv('DAMUBALA_TURKESTAN_PASSWORD'),
      password2: requiredEnv('DAMUBALA_TURKESTAN_PASSWORD_ALT'),
      cities: [{ id: 'turkestan', name: 'Туркестан', region: 'Туркестан' }]
    }
  ];
}

function jsonHeaders(token) {
  return {
    accept: 'application/json, text/plain, */*',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    pragma: 'no-cache',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function apiRequest(path, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function pickAuth(data) {
  const token = data?.token?.token || data?.token?.accessToken || data?.token;
  const userId = data?.userId;
  if (!token || !userId) return null;
  return { token, userId };
}

async function signIn(account, password) {
  const body = {
    iin: account.iin,
    password
  };
  if (account.bin) body.bin = account.bin;

  const response = await apiRequest('/v1/Account/SignIn', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body)
  });
  const data = await readJson(response);
  const auth = pickAuth(data);
  const message = String(data?.message || data?.error || '').toLowerCase();
  const expired = Boolean(data?.expired) || message.includes('update password') || message.includes('обнов') || message.includes('устар');

  return {
    ok: response.ok,
    status: response.status,
    token: auth?.token || null,
    userId: auth?.userId || null,
    expired
  };
}

async function updateExpiredPassword(token, currentPassword, newPassword) {
  const response = await apiRequest('/v1/Account/UpdateUserPassword', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ currentPassword, newPassword })
  });
  return response.ok;
}

function alternatePassword(currentPassword, account) {
  return currentPassword === account.password1 ? account.password2 : account.password1;
}

async function signInWithFallback(account) {
  const passwords = [account.password1, account.password2].filter(Boolean);
  for (const password of passwords) {
    const login = await signIn(account, password);
    if (!login.ok || !login.token || !login.userId) continue;

    if (login.expired) {
      const nextPassword = alternatePassword(password, account);
      if (!nextPassword || nextPassword === password) continue;
      const changed = await updateExpiredPassword(login.token, password, nextPassword);
      if (!changed) continue;
      const retry = await signIn(account, nextPassword);
      if (retry.ok && retry.token && retry.userId) {
        return { token: retry.token, userId: retry.userId, passwordUpdated: true };
      }
      continue;
    }

    return { token: login.token, userId: login.userId, passwordUpdated: false };
  }
  throw new Error(`Не удалось войти в Damubala для ${account.id}`);
}

async function getTimeSheets(headers, month, year) {
  const pageSize = 100;
  const all = [];

  for (let page = 1; page <= 30; page += 1) {
    const params = new URLSearchParams({
      PageNumber: String(page),
      PageSize: String(pageSize)
    });
    if (month) params.set('month', String(month));
    if (year) params.set('year', String(year));

    const response = await apiRequest(`/v1/timeSheet/Get?${params.toString()}`, {
      method: 'GET',
      headers
    });
    if (!response.ok) break;
    const data = await readJson(response);
    const rows = Array.isArray(data?.data) ? data.data : [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
  }

  return all;
}

function getActivePeriods() {
  const now = new Date();
  const almatyDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Almaty' }));
  const current = {
    month: almatyDate.getMonth() + 1,
    year: almatyDate.getFullYear()
  };
  const previousDate = new Date(almatyDate);
  previousDate.setMonth(previousDate.getMonth() - 1);
  const previous = {
    month: previousDate.getMonth() + 1,
    year: previousDate.getFullYear()
  };
  return [current, previous];
}

async function getActiveTimeSheets(headers) {
  const seen = new Set();
  const all = [];
  for (const period of getActivePeriods()) {
    const sheets = await getTimeSheets(headers, period.month, period.year);
    for (const sheet of sheets) {
      const key = sheet?.id || `${period.year}-${period.month}-${all.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(sheet);
    }
  }
  return all;
}

async function getSignatureHistory(attendanceId, headers) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await apiRequest(`/v1/timeSheet/GetSignatureHistoryV2/${attendanceId}`, {
      method: 'GET',
      headers
    }, 30000);
    if (!response.ok) continue;
    const data = await readJson(response);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.result)) return data.result;
  }
  return [];
}

function pickRegionName(sheet) {
  return (
    sheet?.class?.course?.application?.hRegionNameRu ||
    sheet?.class?.course?.application?.hRegion?.nameRu ||
    sheet?.class?.course?.application?.region?.nameRu ||
    sheet?.hRegionNameRu ||
    'Другое'
  );
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е');
}

function matchesRegion(actualRegion, targetRegion) {
  const actual = normalize(actualRegion);
  const target = normalize(targetRegion);
  if (!target) return true;
  if (target === 'ско') return actual.includes('ско') || actual.includes('северо-казахстан');
  if (target.includes('костанай')) return actual.includes('костанай');
  if (target.includes('туркестан')) return actual.includes('туркестан') || actual === 'другое';
  return actual.includes(target);
}

function countParentStatuses(history) {
  return history.reduce(
    (acc, item) => {
      if (String(item?.role || '').toUpperCase() !== 'PARENT') return acc;
      if (!item?.childId) return acc;
      const status = normalize(item?.hVisitHistoryStatus?.nameRu);
      if (status === 'не подписан') acc.unsigned += 1;
      else acc.signed += 1;
      return acc;
    },
    { signed: 0, unsigned: 0 }
  );
}

function childName(item) {
  return [item?.childLastName, item?.childFirstName, item?.childMiddleName]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function pickDirectionName(sheet) {
  return (
    sheet?.class?.course?.hCourseDirection?.nameRu ||
    sheet?.class?.course?.application?.hCourseDirection?.nameRu ||
    sheet?.class?.course?.organization?.nameRu ||
    'Кружок'
  );
}

function pickGroupName(sheet) {
  return sheet?.class?.commentRu || sheet?.class?.commentKz || 'группа';
}

function pickSignedAt(item) {
  return (
    item?.signedAt ||
    item?.signDate ||
    item?.signedDate ||
    item?.updatedAt ||
    item?.modifiedAt ||
    item?.createdAt ||
    item?.dateCreate ||
    item?.createdDate ||
    ''
  );
}

function sortRecentSigned(children) {
  return [...children]
    .sort((left, right) => {
      const leftTime = new Date(left.signedAt || 0).getTime() || 0;
      const rightTime = new Date(right.signedAt || 0).getTime() || 0;
      return rightTime - leftTime;
    })
    .slice(0, 10);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function countAccount(account) {
  const auth = await signInWithFallback(account);
  const headers = jsonHeaders(auth.token);
  const sheets = await getActiveTimeSheets(headers);

  const cityMap = new Map(
    account.cities.map((city) => [
      city.id,
      {
        ...city,
        platform: 'Damubala',
        status: 'active',
        signed: 0,
        unsigned: 0,
        totalSheets: 0,
        unsignedChildren: [],
        signedChildren: [],
        passwordUpdated: auth.passwordUpdated
      }
    ])
  );

  await mapWithConcurrency(sheets, 3, async (sheet) => {
    const attendanceId = sheet?.id;
    if (!attendanceId) return;
    const region = pickRegionName(sheet);
    const city = account.cities.find((item) => matchesRegion(region, item.region));
    if (!city) return;

    const history = await getSignatureHistory(attendanceId, headers);
    const counts = countParentStatuses(history);
    const record = cityMap.get(city.id);
    record.signed += counts.signed;
    record.unsigned += counts.unsigned;
    record.totalSheets += counts.signed + counts.unsigned;
    const baseChild = (item) => ({
      id: `${attendanceId}-${item.childId}-${item.subscriptionId || item.index}`,
      name: childName(item) || 'Без ФИО',
      circle: pickDirectionName(sheet),
      group: pickGroupName(sheet),
      phone: item?.phoneNumber || '',
      signedAt: pickSignedAt(item)
    });
    const parentRows = history.filter((item) => String(item?.role || '').toUpperCase() === 'PARENT' && item?.childId);
    record.unsignedChildren.push(
      ...parentRows
        .filter((item) => normalize(item?.hVisitHistoryStatus?.nameRu) === 'не подписан')
        .map(baseChild)
    );
    record.signedChildren.push(
      ...parentRows
        .filter((item) => normalize(item?.hVisitHistoryStatus?.nameRu) !== 'не подписан')
        .map(baseChild)
    );
  });

  return Array.from(cityMap.values()).map((city) => ({
    ...city,
    recentSignedChildren: sortRecentSigned(city.signedChildren)
  }));
}

export async function getDamubalaSummary() {
  const settled = await Promise.allSettled(getAccounts().map((account) => countAccount(account)));
  const cities = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  const errors = settled
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || 'Ошибка Damubala');

  return {
    ok: cities.length > 0,
    source: 'damubala',
    updatedAt: new Date().toLocaleString('ru-RU', {
      timeZone: 'Asia/Almaty',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }),
    cities,
    errors
  };
}
