import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  Clock3,
  Database,
  Minus,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  Wifi,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { platformCities } from './data/cities';

function mergeCities(baseCities, apiCities = []) {
  const byId = new Map(apiCities.map((city) => [city.id, city]));
  return baseCities.map((city) => {
    const live = byId.get(city.id);
    if (!live) return city;
    const signedChildren = (live.signedChildren || []).map((child) => ({ ...child, status: 'signed' }));
    const unsignedChildren = (live.unsignedChildren || []).map((child) => ({ ...child, status: 'unsigned' }));
    return {
      ...city,
      ...live,
      signedChildren,
      unsignedChildren,
      allChildren: [...signedChildren, ...unsignedChildren],
      totalSheets: Number(live.signed || 0) + Number(live.unsigned || 0)
    };
  });
}

function CityButton({ city, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative min-w-fit rounded-2xl border px-4 py-3 text-left transition active:scale-[0.98] ${
        selected ? 'border-mint/35 bg-mint/12 text-white shadow-halo' : 'border-line bg-white/[0.045] text-white/58'
      }`}
    >
      <span className="block text-sm font-semibold">{city.name}</span>
      <span className="mt-1 flex items-center gap-1 text-[11px]">
        {city.status === 'active' ? <Wifi size={12} /> : <Minus size={12} />}
        {city.status === 'active' ? city.platform : 'скоро'}
      </span>
      {city.status === 'active' ? (
        <span className="mt-2 flex items-center gap-2 text-[11px] font-semibold">
          <span className="text-mint">{city.signed || 0}</span>
          <span className="text-white/22">/</span>
          <span className="text-coral">{city.unsigned || 0}</span>
        </span>
      ) : null}
    </button>
  );
}

function formatPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }
  if (digits.length === 11) {
    return `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
  }
  return phone || 'телефон не указан';
}

function ProgressRing({ percent }) {
  const dash = 2 * Math.PI * 42;
  return (
    <div className="relative grid h-32 w-32 place-items-center">
      <svg className="-rotate-90" width="128" height="128" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="10" />
        <motion.circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="url(#ring)"
          strokeLinecap="round"
          strokeWidth="10"
          strokeDasharray={dash}
          initial={{ strokeDashoffset: dash }}
          animate={{ strokeDashoffset: dash - (dash * percent) / 100 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="100" y2="100">
            <stop stopColor="#49f2ba" />
            <stop offset="1" stopColor="#58c8ff" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-bold">{percent}%</div>
        <div className="text-[11px] text-white/42">подписано</div>
      </div>
    </div>
  );
}

function ActiveCityPanel({ city, onOpenList }) {
  const percent = Math.round((city.signed / Math.max(city.totalSheets, 1)) * 100);

  return (
    <motion.section
      key={city.id}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22 }}
      className="rounded-[28px] border border-line bg-panel/72 p-5 shadow-panel backdrop-blur-2xl"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-mint/20 bg-mint/10 px-3 py-1 text-xs text-mint">
            <Database size={13} />
            {city.platform}
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight">{city.name}</h2>
          <p className="mt-1 text-sm text-white/45">{city.region}</p>
        </div>
        <ProgressRing percent={percent} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onOpenList(city, 'signed')}
          className="rounded-2xl border border-mint/25 bg-mint/12 p-4 text-left shadow-[0_0_34px_rgba(73,242,186,.18)] transition active:scale-[0.98]"
        >
          <p className="text-xs text-white/52">Подписано</p>
          <strong className="mt-2 block text-4xl font-black text-mint drop-shadow-[0_0_16px_rgba(73,242,186,.55)]">{city.signed}</strong>
        </button>
        <button
          type="button"
          onClick={() => onOpenList(city, 'unsigned')}
          className="rounded-2xl border border-coral/25 bg-coral/12 p-4 text-left shadow-[0_0_34px_rgba(255,112,102,.18)] transition active:scale-[0.98]"
        >
          <p className="text-xs text-white/52">Не подписано</p>
          <strong className="mt-2 block text-4xl font-black text-coral drop-shadow-[0_0_16px_rgba(255,112,102,.55)]">{city.unsigned}</strong>
        </button>
      </div>

      {city.sources?.length ? (
        <div className="mt-3 grid gap-2">
          {city.sources.map((source) => (
            <button
              type="button"
              key={source.id}
              onClick={() => onOpenList(city, 'source', source)}
              className="flex items-center justify-between rounded-2xl border border-line bg-white/[0.04] px-4 py-3 text-left transition active:scale-[0.99]"
            >
              <span className="text-sm font-semibold">{source.name}</span>
              <span className="flex items-center gap-2 text-sm font-bold">
                <span className="text-mint">{source.signed || 0}</span>
                <span className="text-white/24">/</span>
                <span className="text-coral">{source.unsigned || 0}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => onOpenList(city, 'all')}
        className="mt-5 w-full rounded-2xl border border-line bg-white/[0.04] p-4 text-left transition active:scale-[0.99]"
      >
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-white/58">Ход подписания</span>
          <span className="font-semibold">{city.signed} / {city.totalSheets}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-mint to-sky"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        </div>
        <div className="mt-3 text-xs text-white/38">Обновлено {city.updatedAt || 'только что'}</div>
      </button>
    </motion.section>
  );
}

function ChildrenModal({ payload, onClose }) {
  const [query, setQuery] = useState('');
  if (!payload?.city) return null;
  const { city, type, source } = payload;
  const isSigned = type === 'signed';
  const title = type === 'signed'
    ? 'Подписали'
    : type === 'unsigned'
      ? 'Не подписали'
      : source?.name || 'Все дети';
  const children = type === 'signed'
    ? city.signedChildren || []
    : type === 'unsigned'
      ? city.unsignedChildren || []
      : type === 'source'
        ? (city.allChildren || []).filter((child) => child.sourceId === source?.id)
        : city.allChildren || [];
  const normalizedQuery = query.trim().toLowerCase().replace(/ё/g, 'е');
  const filteredChildren = normalizedQuery
    ? children.filter((child) => {
        const haystack = `${child.name} ${child.circle} ${child.group} ${child.phone}`.toLowerCase().replace(/ё/g, 'е');
        return haystack.includes(normalizedQuery);
      })
    : children;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end bg-black/62 px-3 pb-3 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.section
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        className="mx-auto max-h-[82vh] w-full max-w-md overflow-hidden rounded-[28px] border border-line bg-panel shadow-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div>
            <p className={`text-xs uppercase tracking-[0.18em] ${type === 'unsigned' ? 'text-coral' : 'text-mint'}`}>
              {title}
            </p>
            <h2 className="mt-1 text-xl font-bold">{city.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-2xl bg-white/[0.06] text-white/62">
            <X size={20} />
          </button>
        </div>

        <div className="border-b border-line p-3">
          <label className="flex items-center gap-2 rounded-2xl border border-line bg-white/[0.055] px-4 py-3 text-white/64">
            <Search size={18} className="text-sky" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по ребенку, кружку или телефону"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/32"
              autoFocus
            />
          </label>
        </div>

        <div className="max-h-[58vh] overflow-y-auto px-3 pb-10 pt-3">
          {filteredChildren.length ? (
            <div className="grid gap-2">
              {filteredChildren.map((child) => (
                <article key={child.id} className="rounded-2xl border border-line bg-white/[0.045] p-4">
                  <div className="flex gap-3">
                    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border ${child.status === 'signed' ? 'border-mint/25 bg-mint/12 text-mint' : 'border-coral/25 bg-coral/12 text-coral'}`}>
                      <UserRound size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold leading-5">{child.name}</h3>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${child.status === 'signed' ? 'bg-mint/12 text-mint' : 'bg-coral/12 text-coral'}`}>
                          {child.status === 'signed' ? 'подписан' : 'не подписан'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-white/42">{child.circle} - {child.group}</p>
                      <p className="mt-2 flex items-center gap-2 text-xs text-white/64">
                        <Phone size={13} className="text-mint" />
                        {formatPhone(child.phone)}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-white/45">Ничего не найдено</div>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}

function StubPanel({ city }) {
  return (
    <motion.section
      key={city.id}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22 }}
      className="rounded-[28px] border border-line bg-panel/68 p-5 shadow-panel backdrop-blur-2xl"
    >
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-amber/20 bg-amber/10 text-amber">
        <Clock3 size={22} />
      </div>
      <h2 className="mt-4 text-2xl font-bold">{city.name}</h2>
      <p className="mt-2 text-sm leading-6 text-white/48">Раздел подготовлен. Когда появятся данные, здесь будут те же показатели по подписанным и неподписанным табелям.</p>
      {city.children?.length ? (
        <div className="mt-5 grid gap-2">
          {city.children.map((child) => (
            <div key={child.id} className="flex items-center justify-between rounded-2xl border border-line bg-white/[0.04] px-4 py-3">
              <span className="font-medium">{child.name}</span>
              <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-white/40">заглушка</span>
            </div>
          ))}
        </div>
      ) : null}
    </motion.section>
  );
}

function App() {
  const [selectedId, setSelectedId] = useState('petropavlovsk');
  const [cities, setCities] = useState(platformCities);
  const [isLoading, setIsLoading] = useState(false);
  const [dataLabel, setDataLabel] = useState('демо-данные');
  const [waitLeft, setWaitLeft] = useState(0);
  const [childrenList, setChildrenList] = useState(null);

  const loadSummary = async (force = false) => {
    setIsLoading(true);
    setWaitLeft(force ? 12 : 9);
    try {
      const response = await fetch(force ? '/api/summary?refresh=1' : '/api/summary');
      if (!response.ok) throw new Error('api');
      const payload = await response.json();
      if (payload?.cities?.length) {
        setCities(mergeCities(platformCities, payload.cities.map((city) => ({ ...city, updatedAt: payload.updatedAt }))));
        setDataLabel(payload.errors?.length ? 'часть данных' : 'live данные');
      }
    } catch {
      setDataLabel('демо-данные');
    } finally {
      setIsLoading(false);
      setWaitLeft(0);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  useEffect(() => {
    if (!isLoading) return undefined;
    const timer = window.setInterval(() => {
      setWaitLeft((value) => Math.max(1, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLoading]);

  const activeCities = cities.filter((city) => city.status === 'active');
  const allSigned = activeCities.reduce((sum, city) => sum + Number(city.signed || 0), 0);
  const allUnsigned = activeCities.reduce((sum, city) => sum + Number(city.unsigned || 0), 0);
  const allSheets = allSigned + allUnsigned;

  const selectedCity = useMemo(
    () => cities.find((city) => city.id === selectedId) || cities[0],
    [cities, selectedId]
  );

  return (
    <div className="min-h-screen overflow-hidden bg-ink text-white">
      <div className="scanline pointer-events-none fixed inset-0 opacity-40" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(73,242,186,.16),transparent_28rem),radial-gradient(circle_at_100%_26%,rgba(255,112,102,.13),transparent_24rem),radial-gradient(circle_at_48%_100%,rgba(88,200,255,.12),transparent_24rem)]" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-white/38">
              <Sparkles size={14} className="text-mint" />
              Damubala
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Табели</h1>
          </div>
          <div className="flex items-center gap-2">
            {isLoading ? (
              <span className="max-w-[8rem] text-right text-xs leading-4 text-white/45">
                обновляю<br />осталось ~{waitLeft || 1} сек
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => loadSummary(true)}
              className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-white/[0.06] text-white/70 active:scale-95"
            >
              <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        <section className="mt-5 overflow-hidden rounded-[30px] border border-line bg-gradient-to-br from-panel2/92 to-night/92 p-5 shadow-panel">
          <div className="relative">
            <div className="absolute right-0 top-0 h-20 w-20 rounded-full bg-mint/10 blur-2xl" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-white/48">Сводка по активным городам</p>
                <div className="mt-2 flex items-end gap-2">
                  <strong className="text-5xl font-black tracking-tight">{allSheets}</strong>
                  <span className="pb-2 text-sm text-sky">ваучеров всего</span>
                </div>
              </div>
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-mint/12 text-mint">
                <BarChart3 size={26} />
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-mint/25 bg-mint/12 p-3 shadow-[0_0_32px_rgba(73,242,186,.18)]">
                <p className="text-xs text-mint/90">Подписало</p>
                <strong className="mt-1 block text-3xl font-black text-mint drop-shadow-[0_0_16px_rgba(73,242,186,.58)]">{allSigned}</strong>
              </div>
              <div className="rounded-2xl border border-coral/25 bg-coral/12 p-3 shadow-[0_0_32px_rgba(255,112,102,.18)]">
                <p className="text-xs text-coral/90">Не подписало</p>
                <strong className="mt-1 block text-3xl font-black text-coral drop-shadow-[0_0_16px_rgba(255,112,102,.58)]">{allUnsigned}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/74">Города</h2>
            <span className="text-xs text-white/35">{isLoading ? 'обновляю...' : dataLabel}</span>
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {cities.map((city) => (
              <CityButton key={city.id} city={city} selected={selectedId === city.id} onClick={() => setSelectedId(city.id)} />
            ))}
          </div>
        </section>

        <div className="mt-4">
          <AnimatePresence mode="wait">
            {selectedCity.status === 'active' ? (
              <ActiveCityPanel city={selectedCity} onOpenList={(city, type, source) => setChildrenList({ city, type, source })} />
            ) : (
              <StubPanel city={selectedCity} />
            )}
          </AnimatePresence>
        </div>
      </main>
      <AnimatePresence>
        {childrenList ? <ChildrenModal payload={childrenList} onClose={() => setChildrenList(null)} /> : null}
      </AnimatePresence>
    </div>
  );
}

export default App;
