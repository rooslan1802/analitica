const BASE_URL = 'https://artsport.edu.kz';
const LOGIN_URL = `${BASE_URL}/ru/login`;
const SHEETS_URL = `${BASE_URL}/ru/sheets`;
const SHEETS_FETCH_URL = `${BASE_URL}/ru/sheets/fetch`;
const SHOW_SHEET_URL = `${BASE_URL}/ru/sheets/showsheet`;
const TICKETS_URL = `${BASE_URL}/ru/tickets`;
const APPROVALS_URL = `${BASE_URL}/ru/approvals`;
const PERFORME_URL = `${BASE_URL}/ru/performe`;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

function getSources() {
  return [
    {
      id: 'kokshetau-shabyt',
      name: 'Шабыт',
      email: requiredEnv('ARTSPORT_SHABYT_EMAIL'),
      password: requiredEnv('ARTSPORT_SHABYT_PASSWORD'),
      orderId: '62724'
    },
    {
      id: 'kokshetau-dreamus',
      name: 'Дримус',
      email: requiredEnv('ARTSPORT_DREAMUS_EMAIL'),
      password: requiredEnv('ARTSPORT_DREAMUS_PASSWORD'),
      orderId: '65294'
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

async function request(jar, url, options = {}) {
  const response = await fetch(url, {
    redirect: 'manual',
    ...options,
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...(options.headers || {}),
      cookie: serializeCookieJar(jar)
    }
  });
  updateCookieJar(jar, response.headers);
  return response;
}

function decodeHtml(value = '') {
  const named = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
    mdash: '—'
  };
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, key) => named[key] || match);
}

function cleanText(value = '') {
  return decodeHtml(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCsrfToken(html) {
  return html.match(/name=["']_token["'][^>]*value=["']([^"']+)/i)?.[1]
    || html.match(/csrf-token["']\s+content=["']([^"']+)/i)?.[1]
    || '';
}

function parseOptions(html) {
  return Array.from(String(html || '').matchAll(/<option[^>]*value=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/option>/gi))
    .map((match) => ({
      value: decodeHtml(match[1]).trim(),
      label: cleanText(match[2])
    }));
}

function findSelectOptions(html, selectId) {
  const select = html.match(new RegExp(`<select[^>]*id=["']${selectId}["'][\\s\\S]*?<\\/select>`, 'i'))?.[0] || '';
  return parseOptions(select);
}

function getLatestPeriod(html) {
  return findSelectOptions(html, 'period_tab').find((option) => option.value && option.value !== '0') || null;
}

const monthMap = {
  январь: 'январь',
  января: 'январь',
  февраль: 'февраль',
  февраля: 'февраль',
  март: 'март',
  марта: 'март',
  апрель: 'апрель',
  апреля: 'апрель',
  май: 'май',
  мая: 'май',
  июнь: 'июнь',
  июня: 'июнь',
  июль: 'июль',
  июля: 'июль',
  август: 'август',
  августа: 'август',
  сентябрь: 'сентябрь',
  сентября: 'сентябрь',
  октябрь: 'октябрь',
  октября: 'октябрь',
  ноябрь: 'ноябрь',
  ноября: 'ноябрь',
  декабрь: 'декабрь',
  декабря: 'декабрь'
};

function normalizePeriod(value = '') {
  const text = cleanText(value).toLowerCase();
  const year = text.match(/20\d{2}/)?.[0] || '';
  const month = Object.keys(monthMap).find((name) => text.includes(name));
  return [month ? monthMap[month] : '', year].filter(Boolean).join(' ');
}

function formatPeriodLabel(value = '') {
  const text = cleanText(value);
  const year = text.match(/20\d{2}/)?.[0] || '';
  const monthKey = Object.keys(monthMap).find((name) => text.toLowerCase().includes(name));
  if (!year || !monthKey) return text;
  const month = monthMap[monthKey];
  return `${month.charAt(0).toUpperCase()}${month.slice(1)}, ${year}`;
}

function cleanOrderText(text) {
  return cleanText(text)
    .replace(/^\d+\s+—\s+/, '')
    .trim();
}

function latestTen(children) {
  return [...children].slice(-10).reverse();
}

function parseTableRows(html) {
  return Array.from(String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((match) => Array.from(match[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((cell) => cleanText(cell[1])))
    .filter((cells) => cells.length);
}

function splitStatus(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  let [statusRaw, timeRaw = ''] = raw.split('|').map((item) => item.trim());
  if (!timeRaw) {
    const dated = raw.match(/^(.*?)(?:\s+c)?\s+(\d{2}\.\d{2}\.\d{4}\s+в\s+\d{2}:\d{2}:\d{2})$/i);
    if (dated) {
      statusRaw = dated[1].trim();
      timeRaw = dated[2].trim();
    }
  }
  const status = statusRaw || 'Статус не найден';
  const time = timeRaw.replace(/^c\s+/i, '').trim();
  const normalized = status.toLowerCase();
  const id = normalized.includes('одоб') ? 'approved' : normalized.includes('отклон') ? 'rejected' : normalized.includes('не найден') ? 'missing' : 'review';
  return {
    id,
    status,
    time,
    tone: id === 'approved' ? 'mint' : id === 'rejected' ? 'coral' : id === 'missing' ? 'sky' : 'amber'
  };
}

function makeMissingApproval(source, type, period = '') {
  const isAct = type === 'act';
  return {
    id: `${source.id}-${type}-missing`,
    sourceId: source.id,
    sourceName: source.name,
    type,
    statusId: 'missing',
    status: isAct ? 'Табеля не рассмотрены' : 'Табель не готов к согласованию',
    tone: 'sky',
    time: '',
    period,
    circle: 'Заявка ' + source.orderId
  };
}

async function login(source) {
  const jar = new Map();
  const loginPage = await request(jar, LOGIN_URL);
  const loginHtml = await loginPage.text();
  const token = getCsrfToken(loginHtml);
  if (!token) throw new Error(`ArtSport token not found: ${source.name}`);

  const body = new URLSearchParams({
    _token: token,
    email: source.email,
    password: source.password,
    butsubs: ''
  });
  const response = await request(jar, LOGIN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: BASE_URL,
      referer: LOGIN_URL
    },
    body
  });

  const location = response.headers.get('location') || '';
  if (!location.includes('/home')) {
    throw new Error(`ArtSport login failed: ${source.name}`);
  }
  return jar;
}

async function fetchSourceMeta(jar, source) {
  const response = await request(jar, SHEETS_URL);
  const html = await response.text();
  const token = getCsrfToken(html);
  const company = findSelectOptions(html, 'company_id_tab').find((option) => option.value !== '0');
  const period = getLatestPeriod(html);
  if (!token || !company?.value || !period?.value) {
    throw new Error(`ArtSport sheet filters not found: ${source.name}`);
  }

  const orderResponse = await request(jar, SHEETS_FETCH_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      origin: BASE_URL,
      referer: SHEETS_URL
    },
    body: new URLSearchParams({
      company_id: company.value,
      _token: token
    })
  });
  const orderPayload = await orderResponse.json();
  const order = parseOptions(orderPayload.options).find((option) => option.value === source.orderId);
  if (!order) throw new Error(`ArtSport order not found: ${source.name}`);

  return {
    token,
    companyId: company.value,
    orderId: order.value,
    circle: cleanOrderText(order.label),
    period: period.value,
    periodLabel: formatPeriodLabel(period.label),
    periodKey: normalizePeriod(period.label)
  };
}

async function fetchSheetRows(jar, source, meta) {
  const response = await request(jar, SHOW_SHEET_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: BASE_URL,
      referer: SHEETS_URL
    },
    body: new URLSearchParams({
      _token: meta.token,
      company_id_tab: meta.companyId,
      order_id_tab: meta.orderId,
      period_tab: meta.period
    })
  });
  const html = await response.text();
  const rows = Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
  return rows.map((match) => {
    const cells = Array.from(match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((cell) => cell[1]);
    if (cells.length < 4) return null;
    const statusHtml = cells[3];
    const signedBadge = Array.from(statusHtml.matchAll(/<div[^>]*class=["']([^"']*)["'][^>]*>\s*Подписан\s*<\/div>/gi))[0];
    const className = signedBadge?.[1] || '';
    const isSigned = className.includes('bg-success');
    const isUnsigned = className.includes('bg-danger');
    if (!isSigned && !isUnsigned) return null;
    const voucher = cleanText(cells[1]);
    const name = cleanText(cells[2]);
    if (!voucher || !name) return null;
    return {
      id: `${source.name}-${voucher}`,
      sourceId: source.id,
      voucher,
      name,
      circle: meta.circle,
      group: `${source.name}, заявка ${source.orderId}`,
      phone: '',
      isSigned
    };
  }).filter(Boolean);
}

async function fetchTicketPhones(jar) {
  const response = await request(jar, TICKETS_URL);
  const html = await response.text();
  const phones = new Map();
  for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((cell) => cell[1]);
    if (cells.length < 3) continue;
    const voucher = cleanText(cells[0]).replace(/\D/g, '');
    const phone = cleanText(cells[1]).match(/Телефон:\s*([+0-9 ()-]+)/i)?.[1]?.trim() || '';
    if (voucher && phone) phones.set(voucher, phone);
  }
  return phones;
}

async function fetchApprovalRows(jar, source, meta) {
  const response = await request(jar, APPROVALS_URL);
  const html = await response.text();
  return parseTableRows(html)
    .filter((row) => row.length >= 7 && row[1] === source.orderId && normalizePeriod(row[2]) === meta.periodKey)
    .map((row) => {
      const status = splitStatus(row[6]);
      return {
        id: row[0],
        sourceId: source.id,
        sourceName: source.name,
        type: 'sheet',
        orderId: row[1],
        period: row[2],
        sheetType: row[3],
        circle: row[4],
        certificate: row[5],
        statusId: status.id,
        status: status.status,
        tone: status.tone,
        time: status.time
      };
    });
}

async function fetchActRows(jar, source, approvalRows) {
  const sheetIds = new Set(approvalRows.map((row) => row.id));
  if (!sheetIds.size) return [];
  const response = await request(jar, PERFORME_URL);
  const html = await response.text();
  return parseTableRows(html)
    .filter((row) => row.length >= 8 && sheetIds.has(row[2]))
    .map((row) => {
      const status = splitStatus(row[7]);
      return {
        id: row[0],
        sourceId: source.id,
        sourceName: source.name,
        type: 'act',
        organization: row[1],
        sheetId: row[2],
        sheetType: row[3],
        period: row[4],
        circle: row[5],
        amount: row[6],
        statusId: status.id,
        status: status.status,
        tone: status.tone,
        time: status.time
      };
    });
}

function createApproval(sourceResults) {
  const sources = sourceResults.map((source) => {
    const sheetApproval = source.sheetApprovals[0] || makeMissingApproval(source, 'sheet', source.periodLabel);
    const actApproval = source.actApprovals[0] || makeMissingApproval(source, 'act', source.periodLabel);
    const items = [sheetApproval, actApproval];
    const completed = items.filter((item) => item.statusId === 'approved').length;
    return {
      sourceId: source.id,
      sourceName: source.name,
      orderId: source.orderId,
      total: items.length,
      completed,
      progress: Math.round((completed / Math.max(items.length, 1)) * 100),
      sheetApproval,
      actApproval,
      sheets: [sheetApproval],
      acts: actApproval.statusId === 'missing' ? [] : [actApproval]
    };
  });
  const items = sources.flatMap((source) => [source.sheetApproval, source.actApproval]);
  const completed = items.filter((item) => item.statusId === 'approved').length;
  const review = items.filter((item) => item.statusId === 'review').length;
  const rejected = items.filter((item) => item.statusId === 'rejected').length;
  const missing = items.filter((item) => item.statusId === 'missing').length;
  const total = items.length;
  return {
    platform: 'ArtSport',
    total,
    completed,
    readyForActs: sources.filter((source) => source.sheetApproval.statusId === 'approved').length,
    readyToSubmit: 0,
    currentStep: completed,
    progress: Math.round((completed / Math.max(total, 1)) * 100),
    headline: review
      ? 'Есть документы на рассмотрении'
      : rejected
        ? 'Есть отклоненные документы'
        : missing
          ? 'Часть актов пока не создана'
          : 'Табеля и акты рассмотрены',
    nextAction: review ? 'Ждем решение оператора' : rejected ? 'Проверьте отклоненные документы' : missing ? 'Проверьте акты ArtSport' : 'Все согласования закрыты',
    statusCounts: [
      { id: 'approved', label: 'Одобрено', tone: 'mint', count: completed },
      { id: 'review', label: 'На рассмотрении', tone: 'amber', count: review },
      { id: 'rejected', label: 'Отклонено', tone: 'coral', count: rejected },
      { id: 'missing', label: 'Не найдено', tone: 'sky', count: missing }
    ].filter((item) => item.count > 0),
    sources
  };
}

async function countSource(source) {
  const jar = await login(source);
  const meta = await fetchSourceMeta(jar, source);
  const rows = await fetchSheetRows(jar, source, meta);
  const phonesByVoucher = await fetchTicketPhones(jar);
  const sheetApprovals = await fetchApprovalRows(jar, source, meta);
  const actApprovals = await fetchActRows(jar, source, sheetApprovals);
  for (const row of rows) {
    row.phone = phonesByVoucher.get(row.voucher) || '';
  }
  const signedChildren = rows.filter((row) => row.isSigned).map(({ isSigned: _isSigned, ...child }) => child);
  const unsignedChildren = rows.filter((row) => !row.isSigned).map(({ isSigned: _isSigned, ...child }) => child);
  return {
    id: source.id,
    name: source.name,
    signed: signedChildren.length,
    unsigned: unsignedChildren.length,
    signedChildren,
    unsignedChildren,
    orderId: source.orderId,
    periodLabel: meta.periodLabel,
    periodKey: meta.periodKey,
    sheetApprovals,
    actApprovals
  };
}

export async function getArtsportSummary() {
  const settled = await Promise.allSettled(getSources().map((source) => countSource(source)));
  const sourceResults = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  const errors = settled
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || 'Ошибка ArtSport');

  const signedChildren = sourceResults.flatMap((source) => source.signedChildren);
  const unsignedChildren = sourceResults.flatMap((source) => source.unsignedChildren);
  const signed = signedChildren.length;
  const unsigned = unsignedChildren.length;

  return {
    ok: sourceResults.length > 0,
    source: 'artsport',
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
        id: 'kokshetau',
        name: 'Кокшетау',
        region: 'ArtSport',
        platform: 'ArtSport',
        status: 'active',
        signed,
        unsigned,
        totalSheets: signed + unsigned,
        signedChildren,
        unsignedChildren,
        recentSignedChildren: latestTen(signedChildren),
        approval: createApproval(sourceResults),
        sources: sourceResults.map(({ signedChildren: _signedChildren, unsignedChildren: _unsignedChildren, ...item }) => item)
      }
    ],
    errors
  };
}
