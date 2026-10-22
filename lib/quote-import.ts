import type {QuoteCategory, QuoteItem} from './quotes';
import type {MaterialRecord} from './catalog-types';

export type QuoteImportRow = {
  id: string; sourceRow: number; selected: boolean; category: QuoteCategory;
  name: string; model: string; unit: string; quantity: number | null; price: number | null;
  note: string; sourceAmount: number | null; issues: string[]; acceptDifference: boolean; section?: string;
};
export type QuoteImportPreview = {
  fileName: string; sheetName: string; rows: QuoteImportRow[]; sourceTotal: number | null;
  warnings: string[]; priceKind: 'sales' | 'cost' | 'unknown';
};
export type QuoteImportOptions = {fileName?: string; sheetName?: string; defaultCategory?: QuoteCategory; catalogPrices?: boolean; hardwareSectionsOnly?: boolean};

const CATEGORIES: QuoteCategory[] = ['柜体', '人工费用', '材料费用', '五金费用'];
const MAX_ITEMS = 500;
const MAX_SOURCE_ROWS = 5000;
const MAX_SOURCE_COLUMNS = 60;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
type Column = 'name' | 'model' | 'unit' | 'quantity' | 'price' | 'amount' | 'note' | 'category';
type Header = Partial<Record<Column, number>>;
type SheetCell = {v?: unknown; f?: string; t?: string};

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}
function valueOf(cell: unknown, sourceRow: number, column: number): unknown {
  if (cell && typeof cell === 'object' && !Array.isArray(cell) && ('v' in cell || 'f' in cell || 't' in cell)) {
    const item = cell as SheetCell;
    if (item.f && (item.v === undefined || item.v === null || item.v === '')) {
      throw new Error(`第 ${sourceRow} 行、第 ${column + 1} 列的公式没有保存计算结果，请先用 Excel 重新计算并保存文件。`);
    }
    if (item.t === 'e') throw new Error(`第 ${sourceRow} 行、第 ${column + 1} 列包含 Excel 公式错误，请修正后再导入。`);
    return item.v;
  }
  return cell;
}
function normalizedHeader(value: unknown): string {
  return text(value).normalize('NFKC').replace(/\s/g, '').replace(/\([^)]*\)/g, '').replace(/[：:]/g, '');
}
const ALIASES: Record<Column, string[]> = {
  name: ['名称', '材料名称', '费用名称', '定额名称', '产品名称', '商品名称', '品名', '项目名称', '明细名称'],
  model: ['规格型号', '规格', '型号', '材料规格', '产品规格'],
  unit: ['单位', '计量单位', '标准单位'],
  quantity: ['数量', '标准数量', '工程量'],
  price: ['销售单价', '销售价', '售价', '报价单价', '单价', '综合价', '成本单价', '采购单价', '采购价'],
  amount: ['销售金额', '报价金额', '金额', '合价', '成本金额', '采购金额', '总价'],
  note: ['备注', '说明', '明细备注'],
  category: ['费用分类', '类别', '分类', '费用类别'],
};
function findHeader(row: unknown[], catalogPrices=false): Header | null {
  const result: Header = {};
  for (let column = 0; column < row.length; column++) {
    const label = normalizedHeader(row[column]);
    for (const key of Object.keys(ALIASES) as Column[]) {
      if(catalogPrices && !['name','model','quantity','unit'].includes(key))continue;
      if (ALIASES[key].includes(label)) {
        if (result[key] !== undefined) throw new Error(`表头“${text(row[column])}”重复，无法确定导入列，请使用导入模板。`);
        result[key] = column;
      }
    }
  }
  return result.name !== undefined && result.quantity !== undefined && (catalogPrices || result.price !== undefined || result.amount !== undefined) ? result : null;
}

/** Only complete numbers are accepted; missing, percentages and unit-bearing strings are never coerced to zero. */
export function quoteImportNumber(value: unknown, money = false): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  let source = value.trim().normalize('NFKC');
  if (money) source = source.replace(/^[¥￥]\s*/, '').replace(/\s*元$/, '');
  if (!/^[+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(source)) return null;
  const number = Number(source.replace(/,/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function amountCents(value: unknown): number | null {
  const amount = quoteImportNumber(value, true);
  if (amount === null) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}
export function quoteImportRowIssues(row: QuoteImportRow): string[] {
  const issues: string[] = [];
  if (!row.name.trim()) issues.push('名称不能为空');
  else if (row.name.trim().length > 100) issues.push('名称不能超过 100 字');
  if (!CATEGORIES.includes(row.category)) issues.push('请选择柜体、人工费用、材料费用或五金费用');
  if (row.model.length > 100) issues.push('规格型号不能超过 100 字');
  if (row.unit.length > 10) issues.push('单位不能超过 10 字');
  if (row.note.length > 500) issues.push('备注不能超过 500 字');
  if (row.quantity === null || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > 100000) issues.push('数量须大于 0 且不超过 100000');
  if (row.price === null || !Number.isFinite(row.price) || row.price < 0 || row.price > 10000000) issues.push('单价缺失或无效，请填写 0 至 10000000 元');
  if (row.sourceAmount !== null && (!Number.isSafeInteger(row.sourceAmount) || row.sourceAmount < 0)) issues.push('源金额无效');
  if (row.quantity !== null && row.price !== null && Number.isFinite(row.quantity) && Number.isFinite(row.price)) {
    const calculated = Math.round(row.quantity * Math.round(row.price * 100));
    if (!Number.isSafeInteger(calculated)) issues.push('计算金额过大');
    else if (row.sourceAmount !== null && Math.abs(calculated - row.sourceAmount) > 1 && !row.acceptDifference) {
      issues.push(`数量 × 单价为 ${(calculated / 100).toFixed(2)} 元，与源金额 ${(row.sourceAmount / 100).toFixed(2)} 元不同；请核实计价数量、单位，或确认使用重算金额`);
    }
  }
  return issues;
}

function summaryKind(row: unknown[]): 'subtotal' | 'total' | null {
  const first = row.find(value => text(value));
  const label = text(first).replace(/\s/g, '');
  if (/^小计(?:[:：（(]|$)/.test(label)) return 'subtotal';
  if (/^(?:合计|总计|总合计|总金额|总费用|五金已计成本|已计成本|总成本|结算金额|应付金额|应收金额)(?:[:：（(]|$)/.test(label)) return 'total';
  return null;
}

/** Parse values and cached formula cells without evaluating any workbook formula. */
export function parseQuoteImportRows(inputRows: unknown[][], options: QuoteImportOptions = {}): QuoteImportPreview {
  if (!Array.isArray(inputRows) || inputRows.length > MAX_SOURCE_ROWS) throw new Error(`文件最多支持 ${MAX_SOURCE_ROWS} 行，请拆分后导入。`);
  const fileName = options.fileName || '';
  const sheetName = options.sheetName || 'Sheet1';
  const warnings: string[] = [];
  const rows: QuoteImportRow[] = [];
  const subtotals = new Map<number, number>();
  let header: Header | null = null;
  let headerCount = 0;
  let grandTotal: number | null = null;
  let hasCost = /成本|采购价|进价/.test(fileName + sheetName);
  let hasSales = false;
  let inHardwareSection = !options.hardwareSectionsOnly;
  let sectionJustStarted = false;
  // hardwareSectionsOnly: 只导入「成品五金 / 铝材 / 封边」段落内的明细，其余段落（柜体板材等）跳过。
  const sectionTitle = (value: string) => /^(?:\d+[.、]?\s*)?(?:成品五金|铝材|封边(?:条|材料|带)?)$/i.test(value.replace(/\s/g, ''));
  const sectionOf = (value: string): '成品五金' | '铝材' | '封边材料' | null => {
    const clean = value.replace(/\s/g, '');
    if (/^(?:\d+[.、]?\s*)?成品五金$/i.test(clean)) return '成品五金';
    if (/^(?:\d+[.、]?\s*)?铝材$/i.test(clean)) return '铝材';
    if (/^(?:\d+[.、]?\s*)?封边(?:条|材料|带)?$/.test(clean)) return '封边材料';
    return null;
  };
  const sectionOrder: Record<string, number> = { '成品五金': 0, '铝材': 1, '封边材料': 2 };
  let currentSection: string | null = null;
  for (let index = 0; index < inputRows.length; index++) {
    if (!Array.isArray(inputRows[index]) || inputRows[index].length > MAX_SOURCE_COLUMNS) throw new Error(`第 ${index + 1} 行列数无效，最多支持 ${MAX_SOURCE_COLUMNS} 列。`);
    const cells = inputRows[index].map((cell, column) => options.catalogPrices ? (cell && typeof cell==='object' && 'v' in cell ? (cell as SheetCell).v : cell) : valueOf(cell, index + 1, column));
    const joined = cells.map(text).join(' ');
    if (/成本单价|成本金额|已计成本|总成本/.test(joined)) hasCost = true;
    if (/销售单价|销售金额|销售明细|售价|报价单价/.test(joined)) hasSales = true;
    if (!cells.some(value => text(value))) continue;
    const nextHeader = findHeader(cells, options.catalogPrices);
    if (options.hardwareSectionsOnly) {
      const nonEmpty = cells.map(text).filter(Boolean);
      if (nonEmpty.length === 1) { const hit = sectionOf(nonEmpty[0]); if (hit) { inHardwareSection = true; sectionJustStarted = true; currentSection = hit; continue; } }
            // 新表头：紧跟段标题的是段内表头（保留段落），否则视为进入非五金段落
      if (inHardwareSection && nextHeader && !sectionJustStarted) inHardwareSection = false;
      if (nextHeader) sectionJustStarted = false;
    }
    if (nextHeader) {header = nextHeader; headerCount++; continue;}
    if (!header) continue;
    if (options.hardwareSectionsOnly && !inHardwareSection) continue;
    const get = (column: Column) => header?.[column] === undefined || (options.catalogPrices && !['name','model','unit','quantity'].includes(column)) ? undefined : options.catalogPrices ? valueOf(inputRows[index][header[column]!],index+1,header[column]!) : cells[header[column]!];
    const summary = summaryKind(cells);
    if (summary) {
      const amount = amountCents(get('amount'));
      if (amount !== null) {
        if (summary === 'total') grandTotal = amount;
        else subtotals.set(headerCount, amount);
      }
      continue;
    }
    // Section titles and footnotes have no quantity, price or amount, unlike a detail row with a missing price.
    const quantityValue = get('quantity');
    const priceValue = get('price');
    const amountValue = get('amount');
    if (![quantityValue, priceValue, amountValue].some(value => text(value))) continue;
    const categoryText = text(get('category'));
    const row: QuoteImportRow = {
      id: `${sheetName}:${index + 1}`, sourceRow: index + 1, selected: true,
      category: (options.catalogPrices ? '五金费用' : categoryText || options.defaultCategory || '五金费用') as QuoteCategory,
      name: text(get('name')), model: text(get('model')), unit: text(get('unit')),
      quantity: quoteImportNumber(quantityValue), price: quoteImportNumber(priceValue, true),
      note: text(get('note')), sourceAmount: amountCents(amountValue), issues: [], acceptDifference: false,
      ...(options.hardwareSectionsOnly && currentSection ? { section: currentSection } : {}),
    };
    row.issues = quoteImportRowIssues(row);
    if (row.sourceAmount === null && text(amountValue)) row.issues.push(`源金额“${text(amountValue).slice(0, 40)}”未计入合计`);
    if (/元\s*\/\s*米|元\s*每\s*米/.test(row.note) && row.unit !== '米') {
      row.issues.push(`源数量为 ${row.quantity ?? '待确认'} ${row.unit || '未填单位'}，备注单价按米；请将计价数量、单位改为米，并在备注保留原数量`);
    }
    rows.push(row);
    if (rows.length > MAX_ITEMS) throw new Error(`一份报价最多支持 ${MAX_ITEMS} 条明细，请拆分后导入。`);
  }
  if (!header) throw new Error(options.catalogPrices?'未找到明细表头，请使用包含名称、规格型号、数量、单位的导入模板。':'未找到明细表头，请使用包含名称、数量、单价或金额的导入模板。');
  if (!rows.length) throw new Error('表格中没有可导入的明细。');
  const sourceTotal = grandTotal ?? (subtotals.size ? [...subtotals.values()].reduce((sum, amount) => sum + amount, 0) : null);
  const knownAmount = rows.reduce((sum, row) => sum + (row.sourceAmount ?? 0), 0);
  if (hasCost) warnings.push('这份文件含成本价格；导入报价前，请确认是否将选中的成本单价作为本次销售单价。');
  if (hasCost && hasSales) warnings.push('文件同时出现销售与成本标记，请按实际价格用途核对每行。');
  const missingPrices = rows.filter(row => row.price === null).length;
  if (missingPrices) warnings.push(`${missingPrices} 条明细缺少有效单价，须补齐或取消勾选后再导入。`);
  if (rows.some(row => row.sourceAmount === null)) warnings.push('源文件有未计金额的明细，源合计仅反映已计金额。');
  if (sourceTotal !== null && Math.abs(sourceTotal - knownAmount) > 1) throw new Error(`源合计 ${(sourceTotal / 100).toFixed(2)} 元与可读取的明细金额 ${(knownAmount / 100).toFixed(2)} 元不一致，请核对文件后再导入。`);
  if (rows.some(row => row.quantity !== null && row.price !== null && row.sourceAmount !== null && Math.abs(Math.round(row.quantity * Math.round(row.price * 100)) - row.sourceAmount) > 1)) warnings.push('部分行按长度或其他单位计价，数量 × 单价与源金额不同，须逐行核实；导入后金额按确认的数量与单价重新计算。');
  return {fileName, sheetName, rows, sourceTotal, warnings, priceKind: hasCost ? 'cost' : hasSales ? 'sales' : 'unknown'};
}

export function finalizeQuoteImport(rows: QuoteImportRow[], priceBasis: 'sales' | 'cost', costConfirmed: boolean): QuoteItem[] {
  if (priceBasis !== 'sales' && priceBasis !== 'cost') throw new Error('请明确选择导入单价的用途。');
  if (priceBasis === 'cost' && !costConfirmed) throw new Error('请先确认将成本单价作为本次报价的销售单价。');
  const selected = rows.filter(row => row.selected);
  if (!selected.length) throw new Error('请至少勾选一条明细。');
  // 只要有名称、规格、单位、数量的合格行即可导入；不合格行自动跳过，不再拦截整批。
  const skipped: string[] = [];
  const items: QuoteItem[] = [];
  for (const row of selected) {
    const issues = quoteImportRowIssues(row);
    if (!row.unit.trim()) issues.push('填写单位');
    if (issues.length) { skipped.push(`第 ${row.sourceRow} 行（${issues.join('；')}）`); continue; }
    items.push({name: row.name.trim(), category: row.category, model: row.model.trim(), unit: row.unit.trim(), quantity: row.quantity!, price: row.price!, note: row.note.trim()});
  }
  if (!items.length) throw new Error(`所选明细均无法导入：${skipped.join('；')}。`);
  if (items.length > MAX_ITEMS) throw new Error(`一份报价最多支持 ${MAX_ITEMS} 条明细。`);
  return items;
}

export function quoteImportTemplate(catalogPrices=false): string {
  if(catalogPrices)return '\uFEFF名称,规格型号,数量,单位\r\n,,,\r\n';
  return '\uFEFF名称,规格型号,单位,数量,销售单价,金额,备注\r\n,,,,,,\r\n';
}

/** 成品五金段内的名称分组顺序：铰链置顶 → 三节轨/三节抽（按规格数字升序）→ 带「轮」字 → 其余按名称。 */
const HARDWARE_SECTION_RANK: Record<string, number> = { '成品五金': 0, '铝材': 1, '封边材料': 2 };
export const HARDWARE_NAME_BLOCKLIST = /L型柜体免拉手封口ZP/;

/** 取规格中最后一个数字作为长度（毫米）。如 58.0*25.0*1392.0 → 1392；普通灯带 5000 → 5000；无数字返回 null。 */
export function specLastMm(model: string): number | null {
  const matches = model.match(/\d+(?:\.\d+)?/g);
  if (!matches || !matches.length) return null;
  const value = Number(matches[matches.length - 1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * 正确解析规格字符串为总毫米数。
 * 支持片段（用 、,，;；分隔）：
 *   "2598mm*2"       → 2598 × 2 = 5196（mm后缀，*后为根数）
 *   "713mm*3"        → 713 × 3  = 2139
 *   "737*3"          → 737 × 3  = 2211（无mm后缀，业务惯例 A×B = 长度×根数）
 *   "333.5*1"        → 333.5 × 1
 *   "1914"           → 1914（单数字即长度）
 *   "58.0*25.0*1914.0" → 三维板件尺寸，取最长边 1914
 *   "737.0*0.0*0.0"  → 三维尺寸，取最长边 737
 * 无任何数字返回 null。
 */
export function specToMm(model: string): number | null {
  if (!model) return null;
  const parts = model.split(/[、,，;；\s]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  let total = 0;
  let hasNumber = false;
  for (const part of parts) {
    const nums = [...part.matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1])).filter(n => Number.isFinite(n) && n > 0);
    if (!nums.length) continue;
    hasNumber = true;
    if (nums.length === 1) {
      total += nums[0];
    } else if (nums.length === 2) {
      // A*B：长度A × 根数B
      total += nums[0] * nums[1];
    } else {
      // 三维及以上尺寸：取最长边作为长度
      total += Math.max(...nums);
    }
  }
  return hasNumber ? total : null;
}

type MergeGroup = { row: QuoteImportRow; models: Set<string>; units: Set<string>; lengthMm: number; missingSpec: number; specs: string[] };

/** 按名称合并五金明细：相同名称的所有规格汇总为一行（规格列列出全部规格、数量合计）。
 *  免拉手（名称含「免拉手」）按规格最后数字（毫米）折算为米，单位改为「米」；
 *  灯带（名称含「灯带」）按长度毫米汇总，单位改为「米」。返回合并行与核对提示。 */
export function mergeQuoteImportRows(allRows: QuoteImportRow[]): { rows: QuoteImportRow[]; notices: string[] } {
  const groups = new Map<string, MergeGroup>();
  for (const original of allRows) {
    // 过滤不需要统计的五金件
    if (/小角码|小角铁|U型柜体免拉手封口/.test(original.name)) continue;
    const row={...original};
    // 长度型五金：免拉手、灯带、挂衣杆（排除角码/封口/连接/堵头）。
    // 规格里的数字是毫米（支持 "2598mm*2、713mm*3" 这种长度×根数格式），合并时自动折算成米。
    const lengthItem=/免拉手|灯带|挂衣杆|踢脚线|圆弧|防水铝箔/.test(row.name)&&!/角码|封口|连接|堵头/.test(row.name);
    if(!lengthItem&&/^(mm|毫米)$/i.test(row.unit.trim())){row.quantity=row.quantity===null?null:row.quantity/1000;row.unit='米';}
    const key = row.name.trim() || '（未命名）';
    let group = groups.get(key);
    if (!group) {
      group = { row: { ...row }, models: new Set(row.model ? [row.model] : []), units: new Set(row.unit.trim() ? [row.unit.trim()] : []), lengthMm: 0, missingSpec: 0, specs: [] };
      groups.set(key, group);
    } else {
      group.row.quantity = (group.row.quantity ?? 0) + (row.quantity ?? 0);
      if (row.model) group.models.add(row.model);
      if (row.unit.trim()) group.units.add(row.unit.trim());
    }
    if (lengthItem) {
      // 从规格列解析长度（毫米）。规格格式：
      //   "737*3"  → A*B = 长度×根数，B 已含根数
      //   "1687"   → 纯数字 = 长度，数量列是根数
      //   "58.0*25.0*1914.0" → 三维尺寸，取最长边，数量列是根数
      const mm = specToMm(row.model);
      if (mm !== null) {
        const parts = row.model.split(/[、,，;；\s]+/).map(s => s.trim()).filter(Boolean);
        const allInlineCount = parts.length > 0 && parts.every(part => {
          const nums = [...part.matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1])).filter(n => Number.isFinite(n) && n > 0);
          return nums.length === 2;
        });
        if (allInlineCount) {
          group.lengthMm += mm;
          // 规格列已经是 A*B 格式，直接用（把 * 换成 ×）
          for (const part of parts) {
            group.specs.push(part.replace(/\*/g, '×'));
          }
        } else {
          const qty = row.quantity ?? 0;
          group.lengthMm += qty * mm;
          // 提取长度数字用于显示 "长度×根数"
          const nums = parts[0] ? [...parts[0].matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1])).filter(n => Number.isFinite(n)) : [];
          const positiveNums = nums.filter(n => n > 0);
          const isHandleRow = /免拉手/.test(row.name);
          const isRodRow = /挂衣杆/.test(row.name);
          if (qty > 0 && positiveNums.length > 0) {
            // 免拉手：截面数字是小数字(25/57/58/73)，取最大数字为长度；挂衣杆取第一个数字
            let len;
            if (isHandleRow && positiveNums.length >= 2) {
              len = Math.max(...positiveNums);
            } else {
              len = positiveNums[0];
            }
            group.specs.push(len + '×' + qty);
          } else {
            group.specs.push(row.model);
          }
        }
      } else if(/^(mm|毫米)$/i.test(row.unit.trim())) {
        group.lengthMm += (row.quantity ?? 0);
        group.specs.push((row.quantity ?? 0) + 'mm');
      } else if(/^(m|米)$/i.test(row.unit.trim())) {
        group.lengthMm += (row.quantity ?? 0) * 1000;
        group.specs.push((row.quantity ?? 0) + 'm');
      } else {
        group.missingSpec++;
      }
    }
  }
  const rows: QuoteImportRow[] = [];
  const notices: string[] = [];
  for (const group of groups.values()) {
    const row = group.row;
    const models = [...group.models];
    const units = [...group.units];
    const isHandle = /免拉手/.test(row.name)&&!/角码|封口|连接|堵头/.test(row.name);
    const isLed = /灯带/.test(row.name);
    const isRod = /挂衣杆/.test(row.name);
    const isToeKick = /踢脚线/.test(row.name);
    const isArc = /圆弧/.test(row.name);
    const isWaterproof = /防水铝箔/.test(row.name);
    const isLengthItem = isHandle || isLed || isRod || isToeKick || isArc || isWaterproof;
    // 规格型号列汇总：长度型物料显示 "长度×根数" 格式，其他显示原始规格
    const specSource = isLengthItem && group.specs.length ? group.specs : models;
    const specText = specSource.join('、');
    row.model = specText.length > 90 ? specText.slice(0, 90) + '…等' + specSource.length + '种规格' : specText;
    if (isLengthItem&&group.missingSpec===0) {
      const divisor = 1000;
      row.unit = '米';
      row.quantity = Number((group.lengthMm / divisor).toFixed(2));
      // 双重验证：从 specs 反算总mm，和累加值对比，不一致则警告
      let verifyMm = 0;
      for (const s of group.specs) {
        const m = s.match(/(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)/);
        if (m) verifyMm += Number(m[1]) * Number(m[2]);
      }
      if (group.missingSpec === 0) {
        notices.push(`「${row.name}」已按规格长度（毫米）折算为 ${row.quantity} 米（共 ${group.lengthMm} 毫米）。`);
        if (Math.abs(verifyMm - group.lengthMm) > 1) {
          notices.push(`⚠️「${row.name}」验证不一致：累加=${group.lengthMm}mm，规格反算=${verifyMm}mm，请核对！`);
        }
      } else {
        notices.push(`「${row.name}」有 ${group.missingSpec} 行规格缺少长度数字，未计入${isHandle ? '米' : '毫米'}汇总，请核对。`);
      }
    } else {
      if(isLengthItem&&group.lengthMm>0&&group.missingSpec){row.quantity=null;notices.push('「'+row.name+'」部分规格缺少长度，不能混合件数与米数，请补齐长度后核对。');}
      row.unit = units[0] ?? '';
      // 规格是 A×B 格式（如0.8×1），数量列=总面积/总长（第一个数字×第二个数字的累加）
      if (!isLengthItem && row.model) {
        const xParts = row.model.split(/[、,，;；\s]+/).map(s => s.trim()).filter(Boolean);
        if (xParts.length > 0 && xParts.every(p => /^\d+(?:\.\d+)?\s*[×*]\s*\d+(?:\.\d+)?$/.test(p))) {
          let total = 0;
          for (const p of xParts) {
            const m = p.match(/(\d+(?:\.\d+)?)\s*[×*]\s*(\d+(?:\.\d+)?)/);
            if (m) total += Number(m[1]) * Number(m[2]);
          }
          row.quantity = Number(total.toFixed(2));
        }
      }
      // 非长度型物料但规格是纯数字，也显示 "数字×数量"（如防水铝箔1000×1、阳台一体盆1350×1）
      if (!isLengthItem && row.quantity && Number.isInteger(row.quantity) && row.quantity > 0) {
        const parts = row.model.split(/[、,，;；\s]+/).map(s => s.trim()).filter(Boolean);
        if (parts.length > 0 && parts.every(p => /^\d+(?:\.\d+)?$/.test(p))) {
          row.model = parts.map(p => p + '×' + row.quantity).join('、');
        }
      }
      if (units.length > 1) notices.push(`「${row.name}」原单位不一致（${units.join('、')}），已合并数量并保留单位「${row.unit}」，请核对。`);
    }
    if(/^(mm|毫米)$/i.test(row.unit.trim())){row.quantity=(row.quantity??0)/1000;row.unit='米';}
    if(row.quantity!==null)row.quantity=Number(row.quantity.toFixed(2));
    row.issues = []; // 合并后的提示交由价格匹配与行校验重新生成
    rows.push(row);
  }
  return { rows, notices };
}

export function hardwareImportSort(rows: QuoteImportRow[]): QuoteImportRow[] {
  const specNumber = (value: string) => { const m = value.match(/(\d+(?:\.\d+)?)\s*(?:mm|毫米)?/i); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER; };
  const nameRank = (row: QuoteImportRow) => {
    const name = row.name;
    if (name.includes('铰链')) return 0;
    if (/三节(?:轨|抽)/.test(name)) return 1;
    if (name.includes('轮')) return 2;
    return 3;
  };
  return rows.sort((a, b) => {
    const rankDiff = (HARDWARE_SECTION_RANK[a.section ?? '成品五金'] ?? 0) - (HARDWARE_SECTION_RANK[b.section ?? '成品五金'] ?? 0);
    if (rankDiff) return rankDiff;
    if ((HARDWARE_SECTION_RANK[a.section ?? '成品五金'] ?? 0) === 0) {
      const nr = nameRank(a) - nameRank(b);
      if (nr) return nr;
      if (nameRank(a) === 1) { const sd = specNumber(a.name + ' ' + a.model) - specNumber(b.name + ' ' + b.model); if (sd) return sd; }
    }
    return a.name.localeCompare(b.name, 'zh-CN') || a.model.localeCompare(b.model, 'zh-CN');
  });
}

/** File parsing happens locally in the browser. The caller owns preview, confirmation and saving. */
export async function parseQuoteImport(file: File, options: QuoteImportOptions = {}): Promise<QuoteImportPreview> {
  if (!file || file.size > MAX_FILE_BYTES) throw new Error('请选择不超过 10MB 的 Excel 或 CSV 文件。');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(extension || '')) throw new Error('支持 .xlsx、.xls 和 .csv 文件。');
  const XLSX = await import('xlsx');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let workbook;
  if (extension === 'csv') {
    let source: string;
    try {source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);}
    catch {source = new TextDecoder('gb18030', {fatal: true}).decode(bytes);}
    workbook = XLSX.read(source, {type: 'string', raw: true, cellFormula: true});
  } else workbook = XLSX.read(bytes, {type: 'array', cellFormula: true});
  if (!workbook.SheetNames.length) throw new Error('文件没有工作表。');
  const previews: QuoteImportPreview[] = [];
  const errors: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    if (options.hardwareSectionsOnly && !/五金/.test(sheetName)) continue;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    if (range.e.r >= MAX_SOURCE_ROWS || range.e.c >= MAX_SOURCE_COLUMNS) {errors.push(`${sheetName} 超过 ${MAX_SOURCE_ROWS} 行或 ${MAX_SOURCE_COLUMNS} 列`); continue;}
    const rows: unknown[][] = [];
    for (let row = 0; row <= range.e.r; row++) {
      const cells: unknown[] = [];
      for (let column = 0; column <= range.e.c; column++) cells.push(sheet[XLSX.utils.encode_cell({r: row, c: column})]);
      rows.push(cells);
    }
    try {previews.push(parseQuoteImportRows(rows, {...options, fileName: file.name, sheetName}));}
    catch (error) {errors.push(`${sheetName}：${error instanceof Error ? error.message : '无法解析'}`);}
  }
  if (!previews.length) throw new Error(errors[0] || (options.hardwareSectionsOnly ? '文件中没有五金工作表或成品五金/铝材/封边段落的可导入明细。' : '文件中没有可导入的明细。'));
  const preview = previews[0];
  const mergedRows = options.hardwareSectionsOnly ? hardwareImportSort(previews.flatMap(item => item.rows).filter(row => !HARDWARE_NAME_BLOCKLIST.test(row.name.replace(/\s/g, '')))) : preview.rows;
  const hardwareSummary = options.hardwareSectionsOnly && previews.length > 1
    ? previews.map(item => `${item.sheetName} ${item.rows.length} 条`).join('、')
    : '';
  return {...preview, rows: mergedRows, warnings: [
      ...(options.hardwareSectionsOnly ? [`只导入五金工作表中「成品五金 / 铝材 / 封边」段落的明细${hardwareSummary ? '（' + hardwareSummary + '）' : ''}，已按名称排序分组。`] : []),
      ...(previews.length > 1 && !options.hardwareSectionsOnly ? [`文件含 ${previews.length} 个明细工作表，本次预览“${preview.sheetName}”；其余工作表请另存后分别导入。`] : []),
      ...(previews.length > 1 && options.hardwareSectionsOnly ? [`已合并 ${previews.length} 个五金工作表：${previews.map(item => item.sheetName).join('、')}。`] : []),
      ...preview.warnings,
      ...(errors.length ? [`另有 ${errors.length} 个工作表未导入：${errors.join('；')}`] : []),
    ]};
}


function matchText(value:string){return value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();}
export function hardwareCatalogRow(input:QuoteImportRow,materials:MaterialRecord[]):QuoteImportRow {
  const row={...input};
  if(/^(mm|毫米)$/i.test(row.unit.trim())){row.quantity=row.quantity===null?null:row.quantity/1000;row.unit='米';}
  if(row.quantity!==null)row.quantity=Number(row.quantity.toFixed(2));
  const hardware=materials.filter(material=>!material.deleted&&material.expense_category==='五金费用');
  const name=matchText(row.name),description=matchText(row.name+' '+row.model);
  let candidates=hardware.filter(material=>matchText(material.name)===name);
  if(!candidates.length){
    const scored=hardware.map(material=>{
      const configured=matchText(material.name).replace(/\((?:所有名称含[^)]*|全部花色)\)/g,'');
      const numeric=[...configured.matchAll(/\d+(?:\.\d+)?(?:mm|w|毫米|公分)/g)].map(match=>match[0]);
      if(numeric.some(token=>!description.includes(token)))return {material,score:0};
      const score=Math.max(0,...configured.split(/[/／、]/).filter(alias=>alias.length>=2).map(alias=>{const at=name.indexOf(alias);return at>=0&&!( /^\d/.test(alias)&&at>0&&/\d/.test(name[at-1]))?alias.length:0;}));
      return {material,score};
    });
    const best=Math.max(0,...scored.map(item=>item.score));candidates=best?scored.filter(item=>item.score===best).map(item=>item.material):[];
  }
  const named=candidates.length;
  if(candidates.length>1){const model=row.model.trim()?matchText(row.model):'';const modeled=candidates.filter(material=>material.model.trim()&&(model?matchText(material.model)===model:description.includes(matchText(material.model))));if(modeled.length)candidates=modeled;}
  let issue='';let price:number|null=null;
  // 单价取自配置；未匹配/单位不同/配置价无效时不再阻断导入：按 0 元加入，导入后在明细表中补填。
  if(!named)issue='配置的五金费用中未找到此名称，销售单价按 0 元加入，可导入后在明细表中补填。';
  else if(candidates.length!==1)issue='同名五金配置无法唯一匹配，销售单价按 0 元加入，可导入后核对补填。';
  else if(matchText(candidates[0].unit)!==matchText(row.unit))issue='配置与表格的单位不同，销售单价按 0 元加入，可导入后换算补填。';
  else if(Number.isFinite(candidates[0].sale_price)&&candidates[0].sale_price>=0)price=candidates[0].sale_price/100;
  else issue='配置销售价无效，销售单价按 0 元加入，可导入后补填。';
  return {...row,category:'五金费用',price:price??0,note:'',sourceAmount:null,acceptDifference:false,issues:[issue||`销售单价已读取五金配置：${candidates[0].name}${candidates[0].model?' / '+candidates[0].model:''}。`]};
}
export function hardwareCatalogPreview(preview:QuoteImportPreview,materials:MaterialRecord[]):QuoteImportPreview {
  return {...preview,rows:preview.rows.map(row=>hardwareCatalogRow(row,materials)),sourceTotal:null,priceKind:'sales',warnings:['仅读取表格的名称、规格型号、数量、单位；销售单价取自五金费用配置，金额按数量 × 销售单价计算。']};
}
