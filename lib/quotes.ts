/** Quote line prices are yuan; stored quote totals are integer cents. */
export const QUOTE_CATEGORIES = ['柜体', '人工费用', '材料费用', '五金费用'] as const;
export const CABINET_NAMES = ['衣柜', '鞋柜', '酒柜', '地柜', '吊柜', '电视柜', '书柜', '餐边柜', '浴室柜'] as const;
export type QuoteCategory = typeof QUOTE_CATEGORIES[number];
export type QuoteRoom = {id: string; name: string};
/** Preserved grouping metadata for earlier quotations; new cabinets use category='柜体'. */
export type QuoteCabinet = {id: string; room_id: string; name: string};
export type QuoteItem = {
  room_id?: string;
  cabinet_id?: string;
  name: string;
  category: QuoteCategory;
  model: string;
  unit: string;
  quantity: number;
  price: number;
  note: string;
  photos?: { key: string; name: string; mime: string; size: number }[];
};
export type QuoteRecord = {
  id?: string;
  project?: string;
  subproject_id?: string;
  subproject_name?: string;
  title?: string;
  total?: number;
  adopted?: boolean;
  deleted?: boolean;
  created?: string;
  updated?: string;
  owner?: string;
  rooms?: QuoteRoom[];
  cabinets?: QuoteCabinet[];
};
export type QuoteGroup<T extends QuoteRecord = QuoteRecord> = {
  id: string;
  name: string;
  quotes: T[];
  adopted: T | undefined;
  total: number;
};

/** Only fills legacy display fields; write-time validation is in business.ts. */
export function normalizeQuoteItem(raw: Partial<QuoteItem> | null | undefined): QuoteItem {
  const item = raw || {};
  return {
    ...(typeof item.room_id === 'string' ? {room_id: item.room_id} : {}),
    ...(typeof item.cabinet_id === 'string' ? {cabinet_id: item.cabinet_id} : {}),
    name: typeof item.name === 'string' ? item.name : '',
    category: QUOTE_CATEGORIES.includes(item.category as QuoteCategory) ? item.category! : '材料费用',
    model: typeof item.model === 'string' ? item.model : '',
    unit: typeof item.unit === 'string' ? item.unit : '',
    quantity: typeof item.quantity === 'number' ? item.quantity : 1,
    price: typeof item.price === 'number' ? item.price : 0,
    note: typeof item.note === 'string' ? item.note : '',
    photos: Array.isArray(item.photos) ? item.photos.filter(photo => photo && typeof photo.key === 'string' && typeof photo.name === 'string').map(photo => ({ key: photo.key, name: photo.name, mime: typeof photo.mime === 'string' ? photo.mime : '', size: typeof photo.size === 'number' ? photo.size : 0 })) : [],
  };
}

/** Missing IDs keep every pre-upgrade quotation in its existing version group. */
export function quoteGroupKey(quote: QuoteRecord) {return quote.subproject_id || 'legacy';}

/** Reliable stored quote links preserve payment attribution without rewriting old transactions. */
export function transactionGroupKey(transaction: {project?: string; subproject_id?: string; source_quote_id?: string; owner?: string}, quotes: QuoteRecord[]): string | null {
  if (transaction.subproject_id) return transaction.subproject_id;
  if (!transaction.source_quote_id) return null;
  const source = quotes.find(quote => quote.id === transaction.source_quote_id && quote.project === transaction.project &&
    (!transaction.owner || !quote.owner || transaction.owner === quote.owner));
  return source ? quoteGroupKey(source) : null;
}

function latestFirst<T extends QuoteRecord>(quotes: T[]) {
  return [...quotes].sort((a, b) => String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')));
}

/** Defensive de-duplication avoids counting two versions if historical data is inconsistent. */
export function getAdoptedQuotes<T extends QuoteRecord>(quotes: T[]): T[] {
  const chosen = new Map<string, T>();
  for (const quote of latestFirst(quotes)) {
    if (!quote.adopted || quote.deleted) continue;
    const key = String(quote.project || '') + '\0' + quoteGroupKey(quote);
    if (!chosen.has(key)) chosen.set(key, quote);
  }
  return [...chosen.values()];
}

export function groupQuotes<T extends QuoteRecord>(quotes: T[]): QuoteGroup<T>[] {
  const grouped = new Map<string, T[]>();
  for (const quote of latestFirst(quotes.filter(value => !value.deleted))) {
    const key = String(quote.project || '') + '\0' + quoteGroupKey(quote);
    const versions = grouped.get(key) || [];
    versions.push(quote);
    grouped.set(key, versions);
  }
  return [...grouped.values()].map(versions => {
    const adopted = getAdoptedQuotes(versions)[0];
    const named = versions.find(quote => quote.subproject_name?.trim());
    return {
      id: quoteGroupKey(versions[0]),
      name: named?.subproject_name?.trim() || adopted?.title || versions[0].title || '未命名小项目',
      quotes: versions,
      adopted,
      total: adopted?.total || 0,
    };
  });
}
