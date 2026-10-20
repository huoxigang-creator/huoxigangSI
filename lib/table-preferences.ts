export type TablePreferences = {hidden: string[]; order: string[]; widths?: Record<string, number>; columnOrder?: string[]};
export const emptyTablePreferences = (): TablePreferences => ({hidden: [], order: []});
const unique = (values: unknown) => Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length <= 512))].slice(0, 5000) : [];
export function clampTableColumnWidth(value: number, minimum = 80) {return Math.min(1200, Math.max(minimum, Math.round(Number.isFinite(value) ? value : minimum)));}
function columnWidths(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const entries = Object.entries(value).filter(([id, width]) => id.length > 0 && id.length <= 512 && typeof width === 'number' && Number.isFinite(width) && width >= 36 && width <= 1200).slice(0, 500);
  return entries.length ? Object.fromEntries(entries.map(([id, width]) => [id, Math.round(width as number)])) : undefined;
}

export function readTablePreferences(raw: string | null): TablePreferences {
  try {const value = JSON.parse(raw || '{}'), widths = columnWidths(value?.widths), columnOrder = unique(value?.columnOrder).filter(Boolean).slice(0, 500); return {hidden: unique(value?.hidden), order: unique(value?.order), ...(widths ? {widths} : {}), ...(columnOrder.length ? {columnOrder} : {})};} catch {return emptyTablePreferences();}
}
export function tablePreferenceKey(owner: string, table: string, scope = '') {
  return 'gugemei:table:v1:' + JSON.stringify([owner, table, scope]);
}
export function orderedRows<T>(rows: T[], id: (row: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((value, index) => [value, index]));
  return rows.map((row, index) => ({row, index})).sort((a, b) => (rank.get(id(a.row)) ?? order.length + a.index) - (rank.get(id(b.row)) ?? order.length + b.index)).map(value => value.row);
}
/** Replace visible slots only, retaining rows omitted by a search/filter. */
export function mergeVisibleOrder(previous: string[], nextVisible: string[]): string[] {
  const visible = new Set(nextVisible), next = [...nextVisible];
  const base = [...new Set([...previous, ...nextVisible])];
  return base.map(id => visible.has(id) ? next.shift()! : id);
}
export function moveTableRow(ids: string[], id: string, direction: -1 | 1) {
  const result = [...ids], from = result.indexOf(id), to = from + direction;
  if (from < 0 || to < 0 || to >= result.length) return result;
  [result[from], result[to]] = [result[to], result[from]]; return result;
}
export function dropTableRow(ids: string[], from: string, to: string) {
  if (!ids.includes(from) || !ids.includes(to) || from === to) return [...ids];
  const targetIndex = ids.indexOf(to), result = ids.filter(id => id !== from);
  result.splice(targetIndex, 0, from); return result;
}

export type TableColumnPosition = {id: string; fixed?: boolean; hidden?: boolean};
/** Only movable columns occupy reordered slots; selection and action columns stay anchored. */
export function orderedColumns<T extends TableColumnPosition>(columns: T[], order: string[] = []): T[] {
  const movable = orderedRows(columns.filter(column => !column.fixed), column => column.id, order);
  return columns.map(column => column.fixed ? column : movable.shift()!);
}
/** Hidden columns retain their slots, as do fixed selection/action columns. */
export function dropTableColumn(columns: TableColumnPosition[], from: string, to: string): string[] {
  const movable = columns.filter(column => !column.fixed && !column.hidden).map(column => column.id);
  if (from === to || !movable.includes(from) || !movable.includes(to)) return columns.map(column => column.id);
  const reordered = mergeVisibleOrder(columns.filter(column => !column.fixed).map(column => column.id), dropTableRow(movable, from, to));
  return columns.map(column => column.fixed ? column.id : reordered.shift()!);
}
