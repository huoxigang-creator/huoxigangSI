/** Amounts are integer cents, as produced by summarize() in lib/business.ts. */
type ProjectSummary = {name?: string; received?: number; paid?: number; [key: string]: any};
const yuan = (cents: number) => (cents / 100).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});

/**
 * Deleting a project hides its receipts and payments from every total (经营统计、收付款汇总).
 * Returns the extra warning lines to show before deletion, or '' when no money is attached.
 */
export function projectDeletionWarning(projects: ProjectSummary[]): string {
  const withMoney = projects.filter(project => (project.received || 0) > 0 || (project.paid || 0) > 0);
  if (!withMoney.length) return '';
  const shown = withMoney.slice(0, 5).map(project => '· ' + (project.name || '未命名项目') + '：已收 ¥' + yuan(project.received || 0) + '，已付 ¥' + yuan(project.paid || 0));
  if (withMoney.length > shown.length) shown.push('· 另有 ' + (withMoney.length - shown.length) + ' 个项目');
  return '⚠ 以下项目有收付款流水，删除后这些金额将不再计入经营统计和收付款汇总（恢复项目后重新计入）：\n' + shown.join('\n');
}
