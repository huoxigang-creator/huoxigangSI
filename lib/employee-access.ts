const employeeActions = new Set([
  'get_workspace', 'list_projects', 'get_project',
  'create_project', 'update_project',
  'create_quote', 'update_quote', 'adopt_quote', 'unadopt_quote', 'delete_quote_items',
  'create_task', 'update_task',
]);

const privateProjectFields = new Set([
  'budget', 'contract', 'discount', 'rounding', 'discount_amount', 'rounding_amount', 'settlement_note',
  'receivable', 'received', 'paid', 'remaining', 'cash', 'estimatedProfit', 'actualGrossProfit',
  'unallocated_received', 'unallocated_paid',
]);

export function employeeActionAllowed(action: string): boolean {
  return employeeActions.has(action);
}

export function employeeProject(project: any): any {
  if (!project || typeof project !== 'object') return project;
  return Object.fromEntries(Object.entries(project).filter(([key]) => !privateProjectFields.has(key)));
}

function employeeQuote(quote:any){if(!quote||typeof quote!=='object')return quote;return {...quote,items:(quote.items||[]).map((item:any)=>{const {internal_price,contract_price,purchase_price,...visible}=item;return visible;})};}
export function employeeResult(action: string, value: any): any {
  if (action === 'get_workspace') {
    return {
      ...value,
      projects: value.projects.map(employeeProject),
      quotes: value.quotes.map(employeeQuote),
      transactions: [], hardware: [], logs: [],
    };
  }
  if (action === 'list_projects') return value.map(employeeProject);
  if (action === 'get_project') return { ...value, project: employeeProject(value.project), quotes:value.quotes.map(employeeQuote), transactions: [], hardware: [] };
  if (action === 'create_project' || action === 'update_project') return employeeProject(value);
  if(['create_quote','update_quote','adopt_quote','unadopt_quote','delete_quote_items'].includes(action))return employeeQuote(value);
  return value;
}

export function employeeCatalog(value: any): any {
  return {
    company: { name: value.company?.name || '固美格' },
    materials: value.materials.map((material: any) => {
      const { purchase_price: _purchase, internal_price: _internal, contract_price: _contract, ...visible } = material;
      return visible;
    }),
    purchase_orders: [],
  };
}
