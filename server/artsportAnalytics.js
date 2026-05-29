const BASE_URL = 'https://artsport.edu.kz';
const LOGIN_URL = `${BASE_URL}/ru/login`;
const SHEETS_URL = `${BASE_URL}/ru/sheets`;
const SHEETS_FETCH_URL = `${BASE_URL}/ru/sheets/fetch`;
const SHOW_SHEET_URL = `${BASE_URL}/ru/sheets/showsheet`;
const TICKETS_URL = `${BASE_URL}/ru/tickets`;

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
  return findSelectOptions(html, 'period_tab').find((option) => option.value && option.value !== '0')?.value || '';
}

function cleanOrderText(text) {
  return cleanText(text)
    .replace(/^\d+\s+—\s+/, '')
    .trim();
}

function latestTen(children) {
  return [...children].slice(-10).reverse();
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
  if (!token || !company?.value || !period) {
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
    period
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

async function countSource(source) {
  const jar = await login(source);
  const meta = await fetchSourceMeta(jar, source);
  const rows = await fetchSheetRows(jar, source, meta);
  const phonesByVoucher = await fetchTicketPhones(jar);
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
    unsignedChildren
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
        sources: sourceResults.map(({ signedChildren: _signedChildren, unsignedChildren: _unsignedChildren, ...item }) => item)
      }
    ],
    errors
  };
}
