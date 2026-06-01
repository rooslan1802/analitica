const BASE_URL = 'https://int.qosymsha.kz';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

function getSources() {
  return [
    {
      id: 'astana-shabyt',
      name: 'Шабыт',
      login: requiredEnv('QOSYMSHA_SHABYT_LOGIN'),
      password: requiredEnv('QOSYMSHA_SHABYT_PASSWORD')
    },
    {
      id: 'astana-dreamus',
      name: 'Дримус',
      login: requiredEnv('QOSYMSHA_DREAMUS_LOGIN'),
      password: requiredEnv('QOSYMSHA_DREAMUS_PASSWORD')
    }
  ];
}

function splitSetCookie(value) {
  return String(value || '')
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .filter(Boolean);
}

function updateCookieJar(jar, headers) {
  for (const cookieHeader of splitSetCookie(headers.get('set-cookie'))) {
    const [pair] = cookieHeader.split(';');
    const index = pair.indexOf('=');
    if (index > 0) {
      jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
}

function serializeCookieJar(jar) {
  return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
}

async function request(jar, path, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      redirect: 'manual',
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        accept: '*/*',
        ...(options.headers || {}),
        cookie: serializeCookieJar(jar)
      }
    });
    updateCookieJar(jar, response.headers);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function postForm(jar, path, params, headers = {}) {
  return request(jar, path, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      origin: BASE_URL,
      referer: `${BASE_URL}/ru/WorkPlace/Index`,
      ...headers
    },
    body: new URLSearchParams(params)
  });
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

async function login(source) {
  const jar = new Map();
  await request(jar, '/ru/Auth/Login');

  const initResponse = await postForm(
    jar,
    '/ru/Auth/Init',
    { login: source.login, secureKey: source.password, token: '' },
    { referer: `${BASE_URL}/ru/Auth/Login` }
  );
  const init = await readJson(initResponse);
  if (!init?.success) throw new Error(`Qosymsha Init не прошел: ${source.name}`);

  const response = await request(jar, '/ru/Auth/Login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: BASE_URL,
      referer: `${BASE_URL}/ru/Auth/Login`
    },
    body: new URLSearchParams({
      Login: source.login,
      Password: source.password
    })
  });

  const location = response.headers.get('location') || '';
  if (response.status !== 302 || !location.includes('/ru')) {
    throw new Error(`Qosymsha login failed: ${source.name}`);
  }

  return jar;
}

async function fetchTimesheets(jar) {
  const response = await postForm(jar, '/ru/Timesheet/GetForGrid', {
    page: '1',
    start: '0',
    limit: '100'
  });
  const data = await readJson(response);
  return Array.isArray(data?.result) ? data.result : [];
}

async function fetchGroups(jar, timesheetId) {
  const response = await postForm(jar, '/ru/Timesheet/GetGroupsForTimesheet', {
    timesheetId: String(timesheetId)
  });
  const data = await readJson(response);
  const groups = Array.isArray(data?.result) ? data.result : [];
  return new Map(groups.map((group) => [Number(group.Id), group.Name || `группа ${group.Id}`]));
}

async function fetchRows(jar, timesheetId) {
  const response = await postForm(jar, '/ru/Timesheet/GetRowsForGrid', {
    id: String(timesheetId),
    page: '1',
    start: '0',
    limit: '1000',
    filter: JSON.stringify([{ property: 'GroupId', value: 0 }])
  });
  const data = await readJson(response);
  return Array.isArray(data?.result) ? data.result : [];
}

async function fetchPupilForm(jar, pupilId) {
  if (!pupilId) return {};
  const response = await postForm(jar, '/ru/Pupil/GetForm', { id: String(pupilId) }, {}, 30000);
  if (!response.ok) return {};
  const data = await readJson(response);
  return data?.result || {};
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

function cleanName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGroupName(value, fallback) {
  const name = cleanName(value || fallback);
  return name || 'группа';
}

function pickPhone(form) {
  const representatives = Array.isArray(form?.Representatives) ? form.Representatives : [];
  return representatives.find((person) => person?.PhoneNumber)?.PhoneNumber || '';
}

function latestTen(children) {
  return [...children]
    .sort((left, right) => {
      const leftTime = new Date(left.signedAt || 0).getTime() || 0;
      const rightTime = new Date(right.signedAt || 0).getTime() || 0;
      return rightTime - leftTime;
    })
    .slice(0, 10);
}

function pickActiveTimesheets(timesheets) {
  const parentReviewSheets = timesheets.filter((sheet) => Number(sheet?.State) === 2);
  if (parentReviewSheets.length) return parentReviewSheets;
  const openCurrent = timesheets.filter((sheet) => Number(sheet?.State) === 1 && Number(sheet?.VisitCount || 0) > 0);
  if (openCurrent.length) return openCurrent;
  return timesheets.slice(0, 1);
}

async function countSource(source) {
  const jar = await login(source);
  const timesheets = pickActiveTimesheets(await fetchTimesheets(jar));
  const signedChildren = [];
  const unsignedChildren = [];

  for (const timesheet of timesheets) {
    const [groupsById, rows] = await Promise.all([
      fetchGroups(jar, timesheet.Id),
      fetchRows(jar, timesheet.Id)
    ]);

    const visibleRows = rows.filter((row) => row?.ParentReviewShow && Number(row?.ParentReviewState) >= 0);
    const enriched = await mapWithConcurrency(visibleRows, 4, async (row) => {
      const form = await fetchPupilForm(jar, row.PupilId);
      const groupName = normalizeGroupName(form?.GroupNameRu, groupsById.get(Number(row.GroupId)));
      const child = {
        id: `${source.id}-${timesheet.Id}-${row.PupilId}`,
        sourceId: source.id,
        name: cleanName(row.PupilFio) || 'Без ФИО',
        circle: source.name,
        group: groupName,
        phone: pickPhone(form),
        signedAt: row.ParentReviewDate || ''
      };
      return {
        child,
        isSigned: Number(row.ParentReviewState) === 1
      };
    });

    signedChildren.push(...enriched.filter((row) => row.isSigned).map((row) => row.child));
    unsignedChildren.push(...enriched.filter((row) => !row.isSigned).map((row) => row.child));
  }

  return {
    id: source.id,
    name: source.name,
    signed: signedChildren.length,
    unsigned: unsignedChildren.length,
    signedChildren,
    unsignedChildren
  };
}

export async function getQosymshaSummary() {
  const settled = await Promise.allSettled(getSources().map((source) => countSource(source)));
  const sourceResults = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  const errors = settled
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || 'Ошибка Qosymsha');

  const signedChildren = sourceResults.flatMap((source) => source.signedChildren);
  const unsignedChildren = sourceResults.flatMap((source) => source.unsignedChildren);
  const signed = signedChildren.length;
  const unsigned = unsignedChildren.length;

  return {
    ok: sourceResults.length > 0,
    source: 'qosymsha',
    updatedAt: new Date().toLocaleString('ru-RU', {
      timeZone: 'Asia/Almaty',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }),
    cities: [
      {
        id: 'astana',
        name: 'Астана',
        region: 'Qosymsha',
        platform: 'Qosymsha',
        status: 'active',
        signed,
        unsigned,
        totalSheets: signed + unsigned,
        signedChildren,
        unsignedChildren,
        recentSignedChildren: latestTen(signedChildren),
        sources: sourceResults.map(({ signedChildren: _signedChildren, unsignedChildren: _unsignedChildren, ...item }) => item)
      }
    ],
    errors
  };
}
