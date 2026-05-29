export const platformCities = [
  {
    id: 'petropavlovsk',
    name: 'Петропавловск',
    platform: 'Damubala',
    region: 'СКО',
    status: 'active',
    signed: 286,
    unsigned: 37,
    lastMonthUnsigned: 14,
    totalSheets: 323,
    trend: -8,
    updatedAt: '29.05.2026 12:30'
  },
  {
    id: 'rudny',
    name: 'Рудный',
    platform: 'Damubala',
    region: 'Костанайская область',
    status: 'active',
    signed: 174,
    unsigned: 19,
    lastMonthUnsigned: 7,
    totalSheets: 193,
    trend: -4,
    updatedAt: '29.05.2026 12:30'
  },
  {
    id: 'kokshetau',
    name: 'Кокшетау',
    platform: 'ArtSport',
    region: 'Кокшетау',
    status: 'active',
    signed: 0,
    unsigned: 0,
    totalSheets: 0,
    signedChildren: [],
    unsignedChildren: [],
    sources: [
      { id: 'kokshetau-dreamus', name: 'Дримус', signed: 0, unsigned: 0 },
      { id: 'kokshetau-shabyt', name: 'Шабыт', signed: 0, unsigned: 0 }
    ]
  },
  {
    id: 'turkestan',
    name: 'Туркестан',
    platform: 'Damubala',
    region: 'Туркестан',
    status: 'active',
    signed: 0,
    unsigned: 0,
    totalSheets: 0
  },
  {
    id: 'astana',
    name: 'Астана',
    status: 'stub',
    children: [
      { id: 'astana-dreamus', name: 'Дримус' },
      { id: 'astana-shabyt', name: 'Шабыт' }
    ]
  }
];
