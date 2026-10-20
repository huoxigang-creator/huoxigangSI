import {paymentAmountCents} from './payment-details';
import type {QuoteCategory} from './quotes';

export const DEFAULT_COMPANY_NAME = '连云港固美格家具有限公司';
export const MAX_PURCHASE_TOTAL_CENTS = 1000000000000;
export type MaterialAttribute = '主材' | '辅材' | '人工';
export type CatalogRecordMeta = {id: string; project: string; created: string; updated: string; revision: string; deleted?: boolean};
export type CompanyProfile = {name: string; id?: string; kind?: 'company_profile'; project?: string; created?: string; updated?: string; revision?: string};
export type MaterialFields = {
  name: string; attribute: MaterialAttribute; expense_category?: QuoteCategory; category: string; code: string; brand: string;
  style: string; model: string; unit: string; origin: string; package_name: string; areas: string[];
  purchase_price: number; sale_price: number; market_price: number; internal_price: number; contract_price: number;
  loss_rate: number; conversion_factor: number; special_code: string; other_code: string; note: string;
  warehouse_enabled: boolean; warehouse: string;
};
/** API input prices are yuan. */
export type MaterialInput = Partial<Omit<MaterialFields, 'name'>> & {name: string; id?: string; revision?: string};
/** Persisted prices are integer cents; loss_rate is a percentage. */
export type MaterialRecord = MaterialFields & CatalogRecordMeta & {kind: 'material'};
export type PurchaseItemFields = {expense_category?: '材料费用'|'五金费用';material_id?: string; name: string; brand?: string; model?: string; code?: string; attribute?: MaterialAttribute; unit: string; quantity: number; batch?: string};
/** API item.price is yuan. */
export type PurchaseItemInput = PurchaseItemFields & {price: number};
/** Saved price and amount are cents; all fields are historical snapshots. */
export type PurchaseItem = Required<Omit<PurchaseItemFields,'expense_category'>> & {expense_category?:'材料费用'|'五金费用';price: number; amount: number};
/** source_quote_id is selected explicitly; the service derives the group and name snapshot. */
export type PurchaseOrderInput = {id?: string; revision?: string; project_id: string; source_quote_id?: string; number?: string; supplier?: string; date: string; note?: string; items: PurchaseItemInput[]};
export type PurchaseOrderRecord = CatalogRecordMeta & {kind: 'purchase_order'; project_id: string; source_quote_id?: string; subproject_id?: string; subproject_name?: string; number: string; supplier: string; date: string; note: string; items: PurchaseItem[]; total: number};
/** These are purchased quantities, not labor payments or calculated labor amounts. */
export type PurchaseQuantityRow = {purchase_order_id: string; purchase_order_number: string; date: string; supplier: string; item_index: number; material_id: string; name: string; model: string; attribute: MaterialAttribute; quantity: number; unit: string};
export type PurchaseQuantityBasis = {project_id: string; subproject_id: string; subproject_name: string; source_quote_id: string; order_count: number; rows: PurchaseQuantityRow[]; unlinked_order_count: number};
export type CatalogData = {company: CompanyProfile; materials: MaterialRecord[]; purchase_orders: PurchaseOrderRecord[]};

/** Cabinet and hardware categories are explicit; historical materials keep their original defaults. */
export function materialExpenseCategory(raw: {attribute?: string; expense_category?: string} | null | undefined): QuoteCategory {
  if (raw?.expense_category === '柜体' || raw?.expense_category === '人工费用' || raw?.expense_category === '材料费用' || raw?.expense_category === '五金费用') return raw.expense_category;
  return raw?.attribute === '人工' ? '人工费用' : '材料费用';
}

export function catalogPriceCents(price: number): number {
  if (!Number.isFinite(price) || price < 0 || price > 100000000) throw new Error('单价必须在0到100,000,000元之间');
  return paymentAmountCents(price);
}
export function purchaseQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 || !/^\d+(?:\.\d{1,4})?$/.test(String(quantity))) throw new Error('数量必须大于零、不超过1,000,000，且最多4位小数');
  return quantity;
}
/** Multiply a four-decimal quantity by a stored cent price and round half-up. */
export function purchaseItemAmount(quantity: number, priceCents: number): number {
  purchaseQuantity(quantity);
  if (!Number.isSafeInteger(priceCents) || priceCents < 0 || priceCents > 10000000000) throw new Error('单价金额不合法');
  const [whole, fraction = ''] = String(quantity).split('.');
  const scaled = BigInt(whole) * BigInt(10000) + BigInt(fraction.padEnd(4, '0'));
  const rounded = (scaled * BigInt(priceCents) + BigInt(5000)) / BigInt(10000);
  if (rounded > BigInt(MAX_PURCHASE_TOTAL_CENTS)) throw new Error('采购金额超出允许范围');
  return Number(rounded);
}
export function purchaseTotal(items: Array<Pick<PurchaseItem, 'amount'>>): number {
  let total = BigInt(0);
  for (const item of items) {
    if (!Number.isSafeInteger(item.amount) || item.amount < 0) throw new Error('采购明细金额不合法');
    total += BigInt(item.amount);
  }
  if (total > BigInt(MAX_PURCHASE_TOTAL_CENTS)) throw new Error('采购合计超出允许范围');
  return Number(total);
}
