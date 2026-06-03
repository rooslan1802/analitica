import https from 'node:https';

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
    expires: '0',
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

function apiJsonRequestLenient(path, options = {}, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      insecureHTTPParser: true
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        let data = {};
        try {
          data = body ? JSON.parse(body) : {};
        } catch {
          data = {};
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          data
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    if (options.body) req.write(options.body);
    req.end();
  });
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
  for (const period of getActivePeriods()) {
    const sheets = await getTimeSheets(headers, period.month, period.year);
    const activeSheets = sheets.filter(shouldCountVoucherSheet);
    if (!activeSheets.length) continue;

    const all = [];
    for (const sheet of sheets) {
      const key = sheet?.id || `${period.year}-${period.month}-${all.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(sheet);
    }
    return all;
  }
  return [];
}

async function getActCounts(headers) {
  try {
    const response = await apiJsonRequestLenient('/v1/Act/GetCount', {
      method: 'GET',
      headers
    }, 30000);
    if (!response.ok) return null;
    return response.data;
  } catch {
    return null;
  }
}

function pickRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.data?.result)) return payload.data.result;
  if (Array.isArray(payload?.result?.data)) return payload.result.data;
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      const rows = pickRows(value);
      if (rows.length) return rows;
    }
  }
  return [];
}

async function getActs(headers) {
  const pageSize = 100;
  const all = [];

  for (let page = 1; page <= 20; page += 1) {
    const params = new URLSearchParams({
      PageNumber: String(page),
      PageSize: String(pageSize)
    });
    const response = await apiJsonRequestLenient(`/v1/Act/Get?${params.toString()}`, {
      method: 'GET',
      headers
    }, 30000);
    if (!response.ok) break;
    const rows = pickRows(response.data);
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
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

function countSheetParents(sheet, history) {
  const parentsCount = Number(sheet?.parentsCount || 0);
  const signedParentsCount = Number(sheet?.signedParentsCount || 0);
  if (parentsCount > 0) {
    return {
      signed: signedParentsCount,
      unsigned: Math.max(parentsCount - signedParentsCount, 0)
    };
  }
  return countParentStatuses(history);
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

const DAMUBALA_STATUS_META = {
  review_parent: { id: 'parents', label: 'На согласовании у родителей', tone: 'coral', step: 1 },
  review_operator: { id: 'operator', label: 'На согласовании у оператора', tone: 'amber', step: 2 },
  review_operator_success: { id: 'approved', label: 'Согласован оператором', tone: 'mint', step: 3 }
};

const DAMUBALA_STATUS_BY_ID = {
  1: DAMUBALA_STATUS_META.review_parent,
  3: DAMUBALA_STATUS_META.review_operator,
  4: DAMUBALA_STATUS_META.review_operator_success
};

const DAMUBALA_ACT_STATUS_META = [
  { key: 'allActsCount', id: 'all', label: 'Все акты', tone: 'sky' },
  { key: 'waitingForDocument', id: 'waiting-document', label: 'Ожидает прикрепления ЭСФ', tone: 'amber' },
  { key: 'checkESF', id: 'check-esf', label: 'Согласование специалистом', tone: 'sky' },
  { key: 'notSigned', id: 'not-signed', label: 'На подписании', tone: 'coral' },
  { key: 'done', id: 'done', label: 'Завершенные', tone: 'mint' },
  { key: 'rejected', id: 'rejected', label: 'Отказанные', tone: 'coral' }
];

const DAMUBALA_ACT_COUNT_ALIASES = {
  allActsCount: ['allActsCount', 'allActCount', 'allActs', 'all', 'total', 'count'],
  waitingForDocument: ['waitingForDocument', 'waitingForDocumentCount', 'waitingFileActs', 'waitingFileActsCount', 'waitingFile', 'waitingDocument'],
  checkESF: ['checkESF', 'checkESFCount', 'checkEsf', 'checkEsfCount', 'actESFStatusSuppl', 'actESFStatusSupplCount', 'actEsfStatusSuppl'],
  notSigned: ['notSigned', 'notSignedCount', 'waitingOperatorActs', 'waitingOperatorActsCount', 'waitingOperator', 'onSigning'],
  done: ['done', 'doneCount', 'completed', 'completedCount', 'finished', 'approve', 'approved'],
  rejected: ['rejected', 'rejectedCount', 'denied', 'deniedCount', 'refused']
};

function getEmptyActCounts() {
  return DAMUBALA_ACT_STATUS_META.reduce((acc, status) => {
    acc[status.key] = 0;
    return acc;
  }, {});
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  if (payload.data && !Array.isArray(payload.data) && typeof payload.data === 'object') return unwrapPayload(payload.data);
  if (payload.result && !Array.isArray(payload.result) && typeof payload.result === 'object') return unwrapPayload(payload.result);
  return payload;
}

function readNumberByAliases(payload, aliases) {
  const normalizedEntries = Object.entries(payload || {}).map(([key, value]) => [
    key.toLowerCase().replace(/[^a-z0-9]/g, ''),
    value
  ]);

  for (const alias of aliases) {
    if (payload?.[alias] !== undefined && payload?.[alias] !== null) {
      const value = Number(payload[alias]);
      if (Number.isFinite(value)) return value;
    }

    const lowerAlias = alias.toLowerCase();
    const matchedKey = Object.keys(payload || {}).find((key) => key.toLowerCase() === lowerAlias);
    if (matchedKey) {
      const value = Number(payload[matchedKey]);
      if (Number.isFinite(value)) return value;
    }

    const normalizedAlias = lowerAlias.replace(/[^a-z0-9]/g, '');
    const fuzzy = normalizedEntries.find(([key]) => key === normalizedAlias || key === `${normalizedAlias}count`);
    if (fuzzy) {
      const value = Number(fuzzy[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return 0;
}

function normalizeActCounts(payload) {
  const data = unwrapPayload(payload);
  const counts = getEmptyActCounts();
  for (const status of DAMUBALA_ACT_STATUS_META) {
    counts[status.key] = readNumberByAliases(data, DAMUBALA_ACT_COUNT_ALIASES[status.key] || [status.key]);
  }
  return counts;
}

function hasAnyActCount(counts) {
  return DAMUBALA_ACT_STATUS_META.some((status) => Number(counts?.[status.key] || 0) > 0);
}

function countRawActsByStatus(acts) {
  const counts = getEmptyActCounts();
  counts.allActsCount = acts.length;

  for (const act of acts) {
    const statusId = Number(act?.hActStatus?.id || act?.hActStatusId || 0);
    if (statusId === 2) counts.waitingForDocument += 1;
    else if (statusId === 4) counts.checkESF += 1;
    else if (statusId === 1) counts.notSigned += 1;
    else if (statusId === 5) counts.done += 1;
    else if (statusId === 3) counts.rejected += 1;
  }

  return counts;
}

function pickActStatus(act) {
  const statusId = Number(act?.hActStatus?.id || act?.hActStatusId || act?.statusId || 0);
  if (statusId === 2) return DAMUBALA_ACT_STATUS_META.find((status) => status.key === 'waitingForDocument');
  if (statusId === 4) return DAMUBALA_ACT_STATUS_META.find((status) => status.key === 'checkESF');
  if (statusId === 1) return DAMUBALA_ACT_STATUS_META.find((status) => status.key === 'notSigned');
  if (statusId === 5) return DAMUBALA_ACT_STATUS_META.find((status) => status.key === 'done');
  if (statusId === 3) return DAMUBALA_ACT_STATUS_META.find((status) => status.key === 'rejected');
  return { id: 'unknown', label: act?.hActStatus?.nameRu || 'Статус не определен', tone: 'sky', key: 'unknown' };
}

function collectStrings(value, result = []) {
  if (!value) return result;
  if (typeof value === 'string') {
    result.push(value);
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, result));
    return result;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, result));
  }
  return result;
}

function pickActCityLabel(act, account) {
  const text = normalize(collectStrings(act).join(' '));
  if (text.includes('рудн') || text.includes('костанай')) return 'Рудный';
  if (text.includes('ско') || text.includes('северо-казахстан')) return 'СКО';
  if (text.includes('туркестан')) return 'Туркестан';
  if (account.cities.length === 1) return account.cities[0].region || account.cities[0].name;
  return 'СКО / Рудный';
}

function pickActAmount(act) {
  const candidates = [
    act?.amount,
    act?.totalAmount,
    act?.sum,
    act?.totalSum,
    act?.price,
    act?.paymentAmount
  ];
  const value = candidates.map(Number).find((item) => Number.isFinite(item) && item > 0);
  return value || 0;
}

function pickActPeriod(act) {
  if (act?.month && act?.year) return `${String(act.month).padStart(2, '0')}.${act.year}`;
  if (act?.period) return String(act.period);
  return '-';
}

function formatAct(act, account) {
  const status = pickActStatus(act);
  return {
    id: act?.id || act?.actId || act?.number,
    number: act?.id || act?.actId || act?.number || 'без номера',
    period: pickActPeriod(act),
    statusId: status.id,
    status: status.label,
    tone: status.tone,
    cityLabel: pickActCityLabel(act, account),
    amount: pickActAmount(act)
  };
}

function addActAmounts(counts, acts) {
  const amountByKey = getEmptyActCounts();
  amountByKey.allActsCount = acts.reduce((sum, act) => sum + Number(act.amount || 0), 0);
  for (const act of acts) {
    const status = DAMUBALA_ACT_STATUS_META.find((item) => item.id === act.statusId);
    if (status) amountByKey[status.key] += Number(act.amount || 0);
  }
  return { counts, amountByKey };
}

function countFormattedActsByStatus(acts) {
  const counts = getEmptyActCounts();
  counts.allActsCount = acts.length;
  for (const act of acts) {
    const status = DAMUBALA_ACT_STATUS_META.find((item) => item.id === act.statusId);
    if (status) counts[status.key] += 1;
  }
  return counts;
}

async function getReliableActSummary(headers, account) {
  const counts = normalizeActCounts(await getActCounts(headers));
  let acts = [];
  try {
    acts = (await getActs(headers)).map((act) => formatAct(act, account));
  } catch {
    acts = [];
  }

  if (hasAnyActCount(counts)) {
    return addActAmounts(counts, acts);
  }

  if (acts.length) {
    return addActAmounts(countFormattedActsByStatus(acts), acts);
  }

  return { counts: counts || getEmptyActCounts(), amountByKey: getEmptyActCounts(), acts };
}

function formatActStatusCounts(counts, amountByKey = {}) {
  return DAMUBALA_ACT_STATUS_META.map((status) => ({
    id: status.id,
    label: status.label,
    tone: status.tone,
    count: Number(counts?.[status.key] || 0),
    amount: Number(amountByKey?.[status.key] || 0)
  }));
}

function getSheetStatus(sheet) {
  const status = sheet?.hVisitHistoryStatus || {};
  const code = status.code || `status_${status.id || 'unknown'}`;
  const known = DAMUBALA_STATUS_META[code] || DAMUBALA_STATUS_BY_ID[Number(status.id)];
  return {
    id: known?.id || code,
    code,
    label: known?.label || status.nameRu || 'Статус не определен',
    tone: known?.tone || 'sky',
    step: known?.step || 0
  };
}

function shouldCountVoucherSheet(sheet) {
  return ['parents', 'operator', 'approved'].includes(getSheetStatus(sheet).id);
}

function createApprovalBucket(platform) {
  return {
    platform,
    total: 0,
    completed: 0,
    readyForActs: 0,
    readyToSubmit: 0,
    readyToSubmitSheets: [],
    actStatusCounts: [],
    currentStep: 0,
    statusCounts: [],
    sheets: []
  };
}

function addApprovalSheet(record, sheet) {
  const status = getSheetStatus(sheet);
  const approval = record.approval;
  const existing = approval.statusCounts.find((item) => item.id === status.id);
  if (existing) {
    existing.count += 1;
  } else {
    approval.statusCounts.push({ ...status, count: 1 });
  }

  approval.total += 1;
  approval.currentStep = Math.max(approval.currentStep, status.step);
  if (status.id === 'approved') {
    approval.completed += 1;
    approval.readyForActs += 1;
  }
  const parentsCount = Number(sheet?.parentsCount || 0);
  const signedParentsCount = Number(sheet?.signedParentsCount || 0);
  if (status.id === 'parents' && parentsCount > 0 && signedParentsCount >= parentsCount) {
    approval.readyToSubmit += 1;
    approval.readyToSubmitSheets.push({
      id: sheet?.id,
      period: `${String(sheet?.month || '').padStart(2, '0')}.${sheet?.year || ''}`,
      signedParentsCount,
      parentsCount
    });
  }
  approval.sheets.push({
    id: sheet?.id,
    period: `${String(sheet?.month || '').padStart(2, '0')}.${sheet?.year || ''}`,
    statusId: status.id,
    status: status.label,
    tone: status.tone,
    signedParentsCount,
    parentsCount
  });
}

function finalizeApproval(approval) {
  const order = ['parents', 'operator', 'approved'];
  approval.statusCounts.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
  const parents = approval.statusCounts.find((item) => item.id === 'parents')?.count || 0;
  const operator = approval.statusCounts.find((item) => item.id === 'operator')?.count || 0;
  const approved = approval.statusCounts.find((item) => item.id === 'approved')?.count || 0;
  const ready = approval.total > 0 && approved === approval.total;
  return {
    ...approval,
    progress: Math.round((approved / Math.max(approval.total, 1)) * 100),
    headline: ready
      ? 'Все табели согласованы оператором'
      : operator
        ? 'Часть табелей на рассмотрении оператора'
        : parents
          ? 'Есть табели на согласовании у родителей'
          : 'Статусы табелей обновлены',
    nextAction: approval.readyToSubmit > 0
      ? 'Есть полные табеля для отправки оператору'
      : ready
      ? 'Можно выставлять акты'
      : operator
        ? 'Ждем рассмотрение оператора'
        : parents
          ? 'Дожидаемся подписей родителей'
          : 'Проверьте статусы на платформе',
    ready
  };
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
  const actSummary = await getReliableActSummary(headers, account);
  const actStatusCounts = formatActStatusCounts(actSummary.counts, actSummary.amountByKey);

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
        approval: {
          ...createApprovalBucket('Damubala'),
          actStatusCounts,
          acts: actSummary.acts
        },
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

    const record = cityMap.get(city.id);
    addApprovalSheet(record, sheet);

    if (!shouldCountVoucherSheet(sheet)) return;

    const history = await getSignatureHistory(attendanceId, headers);
    const counts = countSheetParents(sheet, history);
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
    approval: finalizeApproval(city.approval),
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

function findAccountByCity(cityId) {
  return getAccounts().find((account) => account.cities.some((city) => city.id === cityId));
}

function filterReadyToSubmitSheets(sheets, account, cityId) {
  const city = account.cities.find((item) => item.id === cityId);
  if (!city) return [];
  return sheets.filter((sheet) => {
    const status = getSheetStatus(sheet);
    const parentsCount = Number(sheet?.parentsCount || 0);
    const signedParentsCount = Number(sheet?.signedParentsCount || 0);
    return (
      sheet?.id &&
      status.id === 'parents' &&
      parentsCount > 0 &&
      signedParentsCount >= parentsCount &&
      matchesRegion(pickRegionName(sheet), city.region)
    );
  });
}

async function sendSheetToOperator(attendanceId, headers) {
  const response = await apiRequest(`/v1/timeSheet/SendToOperator?attendanceId=${encodeURIComponent(attendanceId)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({})
  }, 30000);
  if (response.ok) return { ok: true, id: attendanceId };
  const data = await readJson(response);
  return {
    ok: false,
    id: attendanceId,
    status: response.status,
    message: data?.message || data?.error || 'Не удалось отправить табель'
  };
}

export async function submitFullDamubalaSheets(cityId) {
  const account = findAccountByCity(cityId);
  if (!account) {
    const error = new Error('Город Damubala не найден');
    error.statusCode = 400;
    throw error;
  }

  const auth = await signInWithFallback(account);
  const headers = jsonHeaders(auth.token);
  const sheets = await getActiveTimeSheets(headers);
  const readySheets = filterReadyToSubmitSheets(sheets, account, cityId);
  const results = await mapWithConcurrency(readySheets, 2, (sheet) => sendSheetToOperator(sheet.id, headers));
  const submitted = results.filter((result) => result.ok).map((result) => result.id);
  const errors = results.filter((result) => !result.ok);

  return {
    ok: errors.length === 0,
    cityId,
    found: readySheets.length,
    submitted,
    errors
  };
}
