import type {MaterialInput} from './catalog-types';

export type HardwareImportRow = {id: string; source: string; selected: boolean; saved: boolean; name: string; code: string; model: string; unit: string; brand: string; category: string; quantity: string; note: string; price: string; duplicate: boolean; error: string};
const aliases: Record<string, string[]> = {name:['名称','五金名称','材料名称','品名','商品名称','产品名称'],code:['编码','代码','材料编码','五金编码'],model:['规格','型号','规格型号'],unit:['单位','计量单位'],quantity:['数量','工程量'],brand:['品牌'],category:['类别','分类','材料分类'],note:['备注','说明'],price:['单价','采购单价','成本单价','销售单价','销售价','采购价']};
const str = (v: unknown) => v == null ? '' : String(v).trim();
export function parseHardwareRows(input: unknown[][], source: string): HardwareImportRow[] {
  if (input.length > 5000 || input.some(row => row.length > 60)) throw Error('工作表最多支持5000行、60列');
  let header: Record<string, number> | null = null, section = '';
  const rows: HardwareImportRow[] = [];
  input.forEach((cells, index) => {
    const values = cells.map(str), filled = values.filter(Boolean);
    if (!filled.length) return;
    const next: Record<string, number> = {};
    values.forEach((value, col) => {for (const key of Object.keys(aliases)) if (aliases[key].includes(value.replace(/\s/g,'').replace(/[（(].*?[）)]/g,''))) {if (next[key] !== undefined) throw Error(`第${index+1}行有重复表头，请保留一个${key==='price'?'单价':value}列`); next[key] = col;}});
    if (next.name !== undefined && (next.quantity !== undefined || next.unit !== undefined)) {header = next; return;}
    if (filled.length === 1 && /^\d+[.、．]/.test(filled[0])) {section = filled[0]; header = null; return;}
    if (!header || (section && !/五金|铝材|封边/.test(section))) return;
    const get = (key: string) => header![key] === undefined ? '' : values[header![key]] || '';
    if (/^(小计|合计|总计)/.test(filled[0]) || !get('name')) return;
    rows.push({id:crypto.randomUUID(), source:`${source} · 第${index+1}行`, selected:true, saved:false, name:get('name'), code:get('code'), model:get('model'), unit:get('unit') || '个', brand:get('brand'), category:get('category') || section.replace(/^\d+[.、．]\s*/,''), quantity:get('quantity'), note:get('note'), price:get('price'), duplicate:false, error:''});
  });
  return rows;
}
export function hardwareImportInput(row: HardwareImportRow, priceKind: 'purchase_price' | 'sale_price'): MaterialInput {
  const raw = row.price.normalize('NFKC').replace(/^[¥￥]\s*/,'').replace(/\s*元$/,'');
  if (raw && !/^\d+(?:\.\d{1,2})?$/.test(raw)) throw Error('单价须为非负数字，最多两位小数');
  if (raw && Number(raw) > 100000000) throw Error('单价不能超过100,000,000元');
  const note = [row.note, row.quantity ? `清单数量：${row.quantity} ${row.unit}` : '', `导入来源：${row.source}`, raw === '' ? '价格待补充（当前价格字段为0）' : ''].filter(Boolean).join('；');
  if (!row.name.trim() || row.name.length > 100 || row.code.length > 100 || row.model.length > 100 || row.brand.length > 100 || row.category.length > 100 || !row.unit.trim() || row.unit.length > 30 || note.length > 2000) throw Error('名称、编码、规格、单位或备注长度不符合要求，请缩短后导入');
  return {id:row.id,name:row.name.trim(),code:row.code.trim(),model:row.model.trim(),unit:row.unit.trim(),brand:row.brand.trim(),category:row.category,attribute:'辅材',expense_category:'五金费用',note,[priceKind]:raw === '' ? 0 : Number(raw)};
}
export function markHardwareDuplicates(rows: HardwareImportRow[], existing: {name:string;code:string;model:string;unit:string}[]) {
  const seen = [...existing];
  return rows.map(row => {const duplicate = seen.some(item => (row.code && item.code === row.code) || (item.name === row.name && item.model === row.model && item.unit === row.unit)); seen.push(row); return {...row,duplicate,selected:!duplicate};});
}
export async function parseHardwareFiles(files: File[]): Promise<HardwareImportRow[]> {
  const XLSX = await import('xlsx');
  let result: HardwareImportRow[] = [];
  for (const file of files) {
    if (file.size > 10*1024*1024 || !/\.(xlsx|xls|csv)$/i.test(file.name)) throw Error('请选择不超过10MB的xlsx、xls或csv文件');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let content: string | Uint8Array = bytes;
    if (/\.csv$/i.test(file.name)) {try {content = new TextDecoder('utf-8',{fatal:true}).decode(bytes);} catch {content = new TextDecoder('gb18030',{fatal:true}).decode(bytes);}}
    const book = XLSX.read(content,{type:typeof content === 'string' ? 'string' : 'array',raw:true,cellFormula:true});
    let count = 0;
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name]; if (!sheet['!ref']) continue;
      const range = XLSX.utils.decode_range(sheet['!ref']);
      if (range.e.r >= 5000 || range.e.c >= 60) throw Error(`${name}超过5000行或60列`);
      for (const key of Object.keys(sheet).filter(key => !key.startsWith('!'))) {const cell = sheet[key]; if (cell.t === 'e' || (cell.f && cell.v == null)) throw Error(`${name}的${key}包含公式错误或缺少计算结果，请在Excel中重算保存`);}
      const rows = parseHardwareRows(XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,range:0}) as unknown[][],`${file.name} / ${name}`);
      count += rows.length; result = result.concat(rows);
    }
    if (!count) throw Error(`${file.name}未找到五金明细，请检查名称、单位或数量表头`);
    if (result.length > 500) throw Error('每次最多导入500条五金，请分批选择文件');
  }
  return result;
}
