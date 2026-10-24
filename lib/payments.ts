export const paymentCategories = ['材料付款', '五金付款', '运输付款', '安装付款', '外定项目付款'] as const;

type Transaction = {project: string; type: string; category: string; amount: number; void?: boolean; deleted?: boolean};
const aliases: Record<string, string> = {
  材料: '材料付款', 五金: '五金付款', 运输: '运输付款', 安装: '安装付款', 外定项目: '外定项目付款',
};

// Amounts are integer cents; keep historic labels intact in the saved records.
export function paymentCategoryTotals(transactions: Transaction[], projectId: string) {
  const totals: Record<string, number> = Object.fromEntries(paymentCategories.map(category => [category, 0]));
  let other = 0;
  for (const transaction of transactions) {
    if (transaction.project !== projectId || transaction.type !== '付款' || transaction.void || transaction.deleted) continue;
    const category = transaction.category.trim();
    const normalized = aliases[category] || category;
    if (Object.hasOwn(totals, normalized)) totals[normalized] += transaction.amount;
    else other += transaction.amount;
  }
  return {totals, other};
}

export function receiptProfit(received: number, paid: number) {
  return received - paid;
}

/** Aggregate a root only at presentation boundaries; raw project totals stay separate. */
export function projectFinancialSummary(project:any,projects:any[]){
 if(!project||project.parent_id)return project;
 const children=projects.filter(p=>!p.deleted&&p.parent_id===project.id);
 if(!children.length)return project;
 const fields=['contract','discount','rounding','receivable','received','paid','remaining','cash','estimatedProfit','actualGrossProfit','budget'];
 return {...project,...Object.fromEntries(fields.map(key=>[key,[project,...children].reduce((sum,p)=>sum+(p[key]||0),0)]))};
}
