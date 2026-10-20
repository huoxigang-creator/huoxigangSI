type Workspace = {
  projects: any[];
  quotes: any[];
  transactions: any[];
};

const text = (value: unknown, limit = 160) => typeof value === 'string' ? value.slice(0, limit) : '';
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? (value / 100).toFixed(2) : undefined;

export function aiContext(workspace: Workspace, question: string) {
  const matched = workspace.projects.filter(project => [project.name, project.customer].some(value => {
    const name = text(value).trim();
    return name.length >= 2 && question.includes(name);
  }));
  const projects = (matched.length ? matched : workspace.projects).slice(0, 80);
  const ids = new Set(projects.map(project => project.id));
  const quotes = workspace.quotes.filter(quote => ids.has(quote.project)).slice(0, 120);
  const transactions = workspace.transactions.filter(transaction => ids.has(transaction.project) && !transaction.void).slice(0, 160);

  const content = {
    amount_unit: '元；报价明细 price 也是元',
    scope: matched.length ? '问题匹配的项目' : '当前工作空间',
    counts: {
      projects: workspace.projects.length,
      quotes: workspace.quotes.length,
      transactions: workspace.transactions.length,
    },
    truncated: projects.length < (matched.length ? matched.length : workspace.projects.length)
      || quotes.length < workspace.quotes.filter(quote => ids.has(quote.project)).length
      || transactions.length < workspace.transactions.filter(transaction => ids.has(transaction.project) && !transaction.void).length,
    projects: projects.map(project => ({
      id: project.id,
      name: text(project.name), customer: text(project.customer, 80),
      status: text(project.status, 40), project_type: text(project.project_type, 30),
      parent_id: project.parent_id || undefined,
      budget: money(project.budget), receivable: money(project.receivable),
      received: money(project.received), paid: money(project.paid),
      remaining: money(project.remaining), cash: money(project.cash),
      estimatedProfit: money(project.estimatedProfit), actualGrossProfit: money(project.actualGrossProfit),
    })),
    quotes: quotes.map(quote => ({
      project_id: quote.project,
      title: text(quote.title), adopted: Boolean(quote.adopted),
      total: money(quote.total), created: text(quote.created, 30),
      items: Array.isArray(quote.items) ? quote.items.slice(0, 30).map((item: any) => ({
        name: text(item.name, 80), unit: text(item.unit, 20),
        quantity: item.quantity, price: item.price,
      })) : [],
    })),
    transactions: transactions.map(transaction => ({
      project_id: transaction.project, type: text(transaction.type, 20),
      category: text(transaction.category, 40), date: text(transaction.date, 20),
      amount: money(transaction.amount),
    })),
  };
  return JSON.stringify(content);
}
