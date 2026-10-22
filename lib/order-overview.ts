import {getAdoptedQuotes, groupQuotes, quoteGroupKey, transactionGroupKey} from './quotes';

/** Monetary values are integer cents. A missing adopted quote has an unknown balance. */
export type OrderRow = {
  id: string;
  projectId: string;
  subprojectId?: string;
  name: string;
  parentName?: string;
  customer: string;
  rootId: string;
  status: string;
  orderDate: string;
  dateSource: 'order_date' | 'created';
  contract: number;
  receivable: number | null;
  received: number;
  remaining: number | null;
  overpaid: number;
  /** Shared project-level warning: never sum this value across quote-group rows. */
  unallocated: number;
  hasAdoptedQuote: boolean;
};

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shanghaiDate(value: string | number | Date = new Date()): string {
  if (typeof value === 'string' && validDate(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function shanghaiMonth(value: string | number | Date = new Date()): string {
  return shanghaiDate(value).slice(0, 7);
}

function amount(value: any) {return Number.isSafeInteger(value) ? value : 0;}
function activeTransaction(value: any) {return !value.deleted && !value.void;}
function projectQuotes(project: any, quotes: any[]) {return quotes.filter(quote => !quote.deleted && quote.project === project.id);}
function groupedProject(project: any, projects: any[], quotes: any[]) {
  return project.project_type !== 'customer' &&
    (quotes.some(quote => !!quote.subproject_id) || projects.some(child => !child.deleted && child.parent_id === project.id));
}

function unallocatedTotals(project: any, projects: any[], quotes: any[], transactions: any[], lookupQuotes = quotes) {
  const grouped = groupedProject(project, projects, quotes);
  const knownGroups = new Set(quotes.map(quoteGroupKey));
  const totals = {received: 0, paid: 0};
  for (const transaction of transactions) {
    if (transaction.project !== project.id || !activeTransaction(transaction)) continue;
    // Historical records without a group stay unallocated once the parent has groups/children.
    const group = transactionGroupKey(transaction, lookupQuotes);
    const unallocated = grouped ? !group || !knownGroups.has(group) : !!group && group !== 'legacy';
    if (!unallocated) continue;
    if (transaction.type === '收款') totals.received += amount(transaction.amount);
    if (transaction.type === '付款') totals.paid += amount(transaction.amount);
  }
  return totals;
}

/** Whole-house customers, real child projects and historical quote groups are disjoint orders. */
export function buildOrderRows(projects: any[], quotes: any[], transactions: any[]): OrderRow[] {
  const activeProjects = projects.filter(project => !project.deleted);
  const projectMap = new Map(activeProjects.map(project => [project.id, project]));
  const rows: OrderRow[] = [];
  for (const project of activeProjects) {
    const ownQuotes = projectQuotes(project, quotes);
    const ownTransactions = transactions.filter(transaction => transaction.project === project.id && activeTransaction(transaction));
    const parent = projectMap.get(project.parent_id);
    const rootId = parent?.id || project.id;
    const isCustomer = project.project_type === 'customer';
    const isGrouped = groupedProject(project, activeProjects, ownQuotes);
    const unallocated = unallocatedTotals(project, activeProjects, ownQuotes, ownTransactions, quotes).received;
    const groups = isGrouped
    ? groupQuotes(ownQuotes)
    : (isCustomer && ownQuotes.length > 1
        ? ownQuotes.map(quote => ({id: quote.id, name: quote.subproject_name || quote.title, adopted: quote.adopted || false, quotes: [quote], total: quote.total || 0}))
        : [null]);
    // A parent without its own quotations is only a container, never an extra order.
    for (const group of groups) {
      const adopted = group ? group.adopted : (isCustomer
        ? getAdoptedQuotes(ownQuotes.map(quote => ({...quote, subproject_id: ''})))[0]
        : getAdoptedQuotes(ownQuotes)[0]);
      const contract = amount(adopted?.total);
      const receivable = adopted ? contract - (isCustomer ? amount(project.discount_amount) + amount(project.rounding_amount) : 0) : null;
      const received = ownTransactions.filter(transaction => {const key = transactionGroupKey(transaction, quotes); return transaction.type === '收款' &&
        (group ? key === group.id : !key || key === 'legacy');})
        .reduce((sum, transaction) => sum + amount(transaction.amount), 0);
      const created = group?.quotes.map(quote => quote.created).filter(Boolean).sort()[0] || project.created;
      const orderDate = validDate(project.order_date) ? project.order_date : shanghaiDate(created || '');
      rows.push({
        id: group ? project.id + ':' + group.id : project.id,
        projectId: project.id,
        ...(group ? {subprojectId: group.id} : {}),
        name: group?.name || project.name || '未命名订单',
        ...(group ? {parentName: project.name} : parent ? {parentName: parent.name} : {}),
        customer: project.customer || parent?.customer || '', rootId,
        status: project.status || '洽谈中', orderDate,
        dateSource: validDate(project.order_date) ? 'order_date' : 'created',
        contract, receivable, received,
        remaining: receivable === null ? null : Math.max(0, receivable - received),
        overpaid: receivable === null ? 0 : Math.max(0, received - receivable),
        unallocated, hasAdoptedQuote: !!adopted,
      });
    }
  }
  return rows.sort((a, b) => b.orderDate.localeCompare(a.orderDate) || a.id.localeCompare(b.id));
}

/** Choosing a real child sends projectId=child.id; old groups also send subprojectId. */
export function receiptTargets(root: any, projects: any[], quotes: any[], transactions: any[]) {
  const activeProjects = projects.filter(project => !project.deleted);
  const scope = activeProjects.filter(project => project.id === root.id || project.parent_id === root.id);
  const scopeIds = new Set(scope.map(project => project.id));
  const targets = buildOrderRows(activeProjects, quotes, transactions).filter(row => scopeIds.has(row.projectId));
  let unallocated = 0, unallocatedPayment = 0;
  for (const project of scope) {
    const totals = unallocatedTotals(project, activeProjects, projectQuotes(project, quotes), transactions, quotes);
    unallocated += totals.received;
    unallocatedPayment += totals.paid;
  }
  return {targets, unallocated, unallocatedPayment};
}
