export type DocumentImportCategory='柜体'|'人工费用'|'材料费用'|'五金费用';
export type DocumentImportRow={id:string;selected:boolean;category:DocumentImportCategory;name:string;model:string;brand:string;code:string;unit:string;quantity:string;price:string;sourceAmount:string;note:string;batch:string;source:string;attribute:'主材'|'辅材'|'人工';confidence?:number;tableId?:string};
export type DocumentImportField='name'|'model'|'brand'|'code'|'unit'|'quantity'|'price'|'sourceAmount'|'note'|'batch'|'category'|'attribute';
export type DocumentImportTable={id:string;source:string;cells:string[][];headerRow:number|null;mapping:Partial<Record<DocumentImportField,number>>;priceKind:'sales'|'cost'|'unknown'};
export type DocumentImportPreview={rows:DocumentImportRow[];warnings:string[];priceKind:'sales'|'cost'|'unknown';sources:string[];tables?:DocumentImportTable[]};
export type ImportOptions={mode:'quote'|'purchase';defaultCategory:DocumentImportCategory};
export type DocumentImportWord={text:string;bbox:{x0:number;y0:number;x1:number;y1:number};confidence?:number};
type Options=ImportOptions&{source:string};
type Field=DocumentImportField|'sequence';
export type DocumentImportValidationOptions={allowMissingPrice?:boolean};
type Header={columns:Partial<Record<Field,number>>;kind:DocumentImportPreview['priceKind']};
type CellValues=Partial<Record<Field,string>>;
const categories:DocumentImportCategory[]=['柜体','人工费用','材料费用','五金费用'];
const MAX_ROWS=5000,MAX_COLUMNS=60,MAX_DETAILS=500;
const aliases:Record<Field,string[]>={
 name:['名称','品名','项目名称','材料名称','物料名称','物品名称','品项名称','五金名称','产品名称','商品名称','货品名称','明细名称','费用名称','货物名称','name','description','item'],
 model:['规格型号','型号规格','规格','型号','尺寸','规格尺寸','尺寸规格','材料规格','物料规格','产品规格','model','spec','specification'],
 brand:['品牌','品牌名称','brand'],code:['编码','代码','物料编码','材料编码','商品编码','五金编码','货号','编号','code','sku'],
 unit:['单位','计量单位','计价单位','标准单位','unit'],quantity:['数量','工程量','用量','采购数量','订购数量','订货数量','标准数量','qty','quantity'],
 price:['单价','价格','销售单价','销售价','售价','报价单价','综合价','采购单价','采购价','成本单价','成本价','进价','供货单价','unitprice','price','salesprice','saleprice','costprice','purchaseprice'],
 sourceAmount:['金额','合价','合计金额','行金额','销售金额','报价金额','采购金额','成本金额','总价','amount','total','linetotal'],
 note:['备注','说明','明细备注','note','remark','remarks'],batch:['批次','批号','批次号','batch','lot'],
 category:['费用分类','费用类别','材料分类','类别','分类','category'],attribute:['属性','材料属性','attribute'],sequence:['序号','序','行号','no','index'],
};
function label(value:string){return value.normalize('NFKC').replace(/\([^)]*\)/g,'').replace(/\s+/g,'').replace(/[：:]/g,'').replace(/(?:\/|每)元$/,'').toLowerCase();}
const byLabel=new Map(Object.entries(aliases).flatMap(([field,values])=>values.map(value=>[label(value),field as Field] as const)));
function str(value:unknown):string{
 if(value===null||value===undefined)return '';
 if(typeof value==='string')return value.trim();
 if(typeof value==='number'||typeof value==='boolean')return String(value);
 if(typeof value==='object'&&!Array.isArray(value)){const cell=value as {v?:unknown;f?:unknown;t?:unknown};if(cell.t==='e')return 'Excel公式错误';if(typeof cell.f==='string'&&(cell.v===undefined||cell.v===null||cell.v===''))return '='+cell.f;return 'v' in cell?str(cell.v):'';}
 return '';
}
/** Only complete literal numbers are accepted. Source text is never evaluated. */
export function documentImportNumber(value:unknown,money=false):number|null{
 if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
 if(typeof value!=='string')return null;let text=value.trim().normalize('NFKC');if(money)text=text.replace(/^[¥￥]\s*/,'').replace(/\s*元$/,'');
 if(!/^\+?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))return null;
 const number=Number(text.replace(/,/g,''));return Number.isFinite(number)&&number>=0?number:null;
}
function decimal(value:number){const text=String(value);if(!text.includes('e'))return text;const [coefficient,exponent]=text.split('e'),parts=coefficient.split('.'),digits=parts.join(''),point=parts[0].length+Number(exponent);return point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);}
function numeric(value:string,money=false){if(!value.trim())return '';const n=documentImportNumber(value,money);return n===null?value:decimal(money?n:Number(n.toFixed(2)));}
function moneyCents(value:string){const n=documentImportNumber(value,true);if(n===null)return null;const cents=Math.round(n*100);return Number.isSafeInteger(cents)?cents:null;}
function lineCents(row:DocumentImportRow,mode:ImportOptions['mode']):number|null{const qty=documentImportNumber(row.quantity),price=moneyCents(row.price);if(qty===null||price===null)return null;if(mode==='purchase'&&/^\d+(?:\.\d{1,4})?$/.test(decimal(qty))){const [whole,fraction='']=decimal(qty).split('.'),scaled=BigInt(whole)*BigInt(10000)+BigInt(fraction.padEnd(4,'0')),total=(scaled*BigInt(price)+BigInt(5000))/BigInt(10000);return total>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(total);}const total=Math.round(qty*price);return Number.isSafeInteger(total)?total:null;}
function priceKind(value:string):DocumentImportPreview['priceKind']{const key=label(value);return /销售|报价|售价|salesprice|saleprice/.test(key)?'sales':/采购|成本|进价|供货|costprice|purchaseprice/.test(key)?'cost':'unknown';}
function optionsCheck(options:Options){if(!['quote','purchase'].includes(options.mode)||!categories.includes(options.defaultCategory)||typeof options.source!=='string'||!options.source.trim()||options.source.length>300)throw new Error('明细导入来源或模式无效');}
function defaultCategory(options:Options):DocumentImportCategory{return options.mode==='purchase'&&!['材料费用','五金费用'].includes(options.defaultCategory)?'材料费用':options.defaultCategory;}
function categoryOf(value:string,options:Options,warnings:string[],source:string):DocumentImportCategory{
 const clean=label(value),map:Record<string,DocumentImportCategory>={'柜体':'柜体','柜体费用':'柜体','人工':'人工费用','人工费':'人工费用','人工费用':'人工费用','材料':'材料费用','材料费':'材料费用','材料费用':'材料费用','五金':'五金费用','五金费':'五金费用','五金费用':'五金费用'},category=map[clean];
 if(category&&!(options.mode==='purchase'&&['柜体','人工费用'].includes(category)))return category;
 if(value)warnings.push(source+'：'+(category?'采购单不支持“'+category+'”':'未识别费用类别“'+value+'”')+'，暂按“'+defaultCategory(options)+'”列出，请核对。');
 return defaultCategory(options);
}
function summary(value:string){return /^(?:(?:本页|本单|本次|全单)?(?:小计|合计|总计)|总合计|总金额|总费用|金额合计|应收金额|应付金额|实付金额|结算金额|优惠金额|折扣金额|税额|抹零)(?:$|[：:\s￥¥\d(（元])/u.test(value.normalize('NFKC').trim());}
function footer(value:string){return /^(?:备注|说明|联系人|联系电话|制单人|审核人|签字|签章|第\s*\d+\s*页)(?:[：:]|$)/.test(value.trim());}
function unitText(value:string){let result=value,previous:string;do{previous=result;result=result.replace(/^\s*["'“”‘’「」『』]\s*/u,'').replace(/\s*["'“”‘’「」『』]\s*$/u,'');}while(result!==previous);return result;}
function rowOf(values:CellValues,options:Options,index:number,warnings:string[],confidence?:number):DocumentImportRow{
 const source=options.source+' · 第'+index+'行',category=categoryOf(values.category||'',options,warnings,source),rawAttribute=values.attribute||'',attribute=rawAttribute==='人工'||rawAttribute==='辅材'||rawAttribute==='主材'?rawAttribute:category==='人工费用'?'人工':category==='五金费用'?'辅材':'主材';
 if(rawAttribute&&!['主材','辅材','人工'].includes(rawAttribute))warnings.push(source+'：未识别材料属性“'+rawAttribute+'”，请核对。');
 return {id:crypto.randomUUID(),selected:true,category,name:values.name||'',model:values.model||'',brand:values.brand||'',code:values.code||'',unit:unitText(values.unit||''),quantity:numeric(values.quantity||''),price:numeric(values.price||'',true),sourceAmount:numeric(values.sourceAmount||'',true),note:values.note||'',batch:values.batch||'',source,attribute,...(confidence!==undefined?{confidence}:{})};
}
function headerFor(cells:string[],options:Options,warnings:string[]):Header|null{
 const found=new Map<Field,number[]>();cells.forEach((cell,index)=>{const field=byLabel.get(label(cell));if(field)found.set(field,[...(found.get(field)||[]),index]);});
 const weak=!found.has('name')&&found.has('model')&&found.has('unit')&&found.has('quantity');
 if((!found.has('name')&&!weak)||!['unit','quantity','price','sourceAmount'].some(field=>found.has(field as Field)))return null;
 if(weak)warnings.push('名称表头未可靠识别，已保留规格、数量和单位列，请手动对应名称列。');
 const columns:Header['columns']={};for(const [field,indices] of found){if(indices.length===1){columns[field]=indices[0];continue;}
  if(field==='price'||field==='sourceAmount'){const desired=options.mode==='purchase'?'cost':'sales',preferred=indices.filter(index=>priceKind(cells[index])===desired);if(preferred.length===1){columns[field]=preferred[0];warnings.push('表头含多个'+(field==='price'?'单价':'金额')+'列，已读取'+cells[preferred[0]]+'，请核对价格用途。');continue;}}
  warnings.push('表头“'+cells[indices[0]]+'”对应多个列，该字段暂留空，请手动核对。');
 }
 const kind=columns.price!==undefined?priceKind(cells[columns.price]):columns.sourceAmount!==undefined?priceKind(cells[columns.sourceAmount]):'unknown';
 return {columns,kind};
}
function cellsFor(cells:string[],header:Header):CellValues{const values:CellValues={};for(const field of Object.keys(header.columns) as Field[])values[field]=cells[header.columns[field]!]||'';return values;}
function hasNumberFields(values:CellValues){return [values.quantity,values.price,values.sourceAmount,values.sequence].some(value=>!!value?.trim());}
function appendContinuation(rows:DocumentImportRow[],values:CellValues){
 if(!rows.length||values.name||hasNumberFields(values)||values.unit||values.brand||values.attribute||values.category)return false;
 const fields=['model','code','note','batch'] as const;if(!fields.some(field=>values[field]))return false;
 const last=rows[rows.length-1];for(const field of fields)if(values[field])last[field]=[last[field],values[field]].filter(Boolean).join(' ');return true;
}
function add(rows:DocumentImportRow[],row:DocumentImportRow){rows.push(row);if(rows.length>MAX_DETAILS)throw new Error('一次最多识别 500 条明细，请分批导入。');}
function candidate(cells:string[],options:Options,index:number,warnings:string[],confidence?:number){return rowOf({name:cells[0]||'',note:'待核对原文：'+cells.filter(Boolean).join(' | ')},options,index,warnings,confidence);}
function mappingFor(header:Header){return Object.fromEntries(Object.entries(header.columns).filter(([field])=>field!=='sequence')) as DocumentImportTable['mapping'];}
function newTable(source:string):DocumentImportTable{return {id:crypto.randomUUID(),source,cells:[],headerRow:null,mapping:{},priceKind:'unknown'};}
function complete(rows:DocumentImportRow[],warnings:string[],kinds:Set<DocumentImportPreview['priceKind']>,options:Options):DocumentImportPreview{
 const explicit=[...kinds].filter(kind=>kind!=='unknown'),kind=explicit.length===1&&!kinds.has('unknown')?explicit[0]:'unknown';if(explicit.length>1)warnings.push('各段价格列同时包含销售价和采购或成本价，请逐行核对用途。');else if(explicit.length&&kinds.has('unknown'))warnings.push('部分段落未注明单价用途，请逐行核对销售价与采购价。');
 for(const row of rows){const computed=lineCents(row,options.mode),amount=moneyCents(row.sourceAmount);if(computed!==null&&amount!==null&&Math.abs(computed-amount)>1)warnings.push(row.source+'：数量 × 单价为 '+(computed/100).toFixed(2)+' 元，与原金额 '+(amount/100).toFixed(2)+' 元不同，请核对；不会用原金额反算单价。');if(row.confidence!==undefined&&row.confidence<70)warnings.push(row.source+'：识别置信度较低，请重点核对名称、数量和单价。');}
 if(!rows.length)warnings.push('没有识别到可导入明细，请检查文件或图片是否清晰、完整。');
 if(rows.some(row=>!row.price))warnings.push('部分明细缺少单价已留空，可先复制明细，保存前补齐。');
 return {rows,warnings:[...new Set(warnings)],priceKind:kind,sources:[options.source]};
}
export function parseDocumentTable(input:unknown[][],options:Options):DocumentImportPreview{
 optionsCheck(options);if(!Array.isArray(input)||input.length>MAX_ROWS)throw new Error('表格最多支持 5000 行。');if(input.some(row=>!Array.isArray(row)||row.length>MAX_COLUMNS))throw new Error('表格最多支持 60 列。');
 const rows:DocumentImportRow[]=[],warnings:string[]=[],kinds=new Set<DocumentImportPreview['priceKind']>();let header:Header|null=null,hadHeader=false,table=newTable(options.source);const tables=[table],beforeHeader:{cells:string[];index:number}[]=[];
 input.forEach((raw,index)=>{const cells=raw.map(str),next=headerFor(cells,options,warnings);if(next){if(header&&(JSON.stringify(header.columns)!==JSON.stringify(next.columns)||header.kind!==next.kind)){table=newTable(options.source);tables.push(table);}if(table.headerRow===null){table.headerRow=table.cells.length;table.mapping=mappingFor(next);table.priceKind=next.kind;}table.cells.push(cells);header=next;hadHeader=true;kinds.add(next.kind);return;}table.cells.push(cells);if(!cells.some(Boolean))return;
  const first=cells.find(Boolean)||'';if(summary(first))return;if(!header){if(!footer(first))beforeHeader.push({cells,index:index+1});return;}
  const values=cellsFor(cells,header);if(summary(values.name||first)||(!hasNumberFields(values)&&footer(values.name||first)))return;if(appendContinuation(rows,values))return;
  if(values.name||hasNumberFields(values)||values.model)add(rows,{...rowOf(values,options,index+1,warnings),tableId:table.id});
 });
 if(!hadHeader){warnings.push('未找到可靠表头：仅将第一列暂列为名称，完整原文已保留，请手动对应规格、数量、单位和单价列。');for(const item of beforeHeader)add(rows,{...candidate(item.cells,options,item.index,warnings),tableId:table.id});}
 return {...complete(rows,warnings,kinds,options),tables};
}

/** Explicit user-selected columns; never infer an unmapped financial field. */
export function mapDocumentTable(table:DocumentImportTable,mapping:DocumentImportTable['mapping'],startRow:number,options:Options):DocumentImportPreview{
 const local={...options,source:table.source};optionsCheck(local);
 if(!table.id||!Array.isArray(table.cells)||table.cells.length>MAX_ROWS||table.cells.some(cells=>!Array.isArray(cells)||cells.length>MAX_COLUMNS))throw Error('原始表格无效或超过支持范围。');
 if(!Number.isInteger(startRow)||startRow<0||startRow>table.cells.length)throw Error('数据起始行无效。');
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw Error('列对应无效。');
 const width=Math.max(0,...table.cells.map(cells=>cells.length)),used=new Set<number>(),columns:Header['columns']={};
 for(const [field,index]of Object.entries(mapping)){if(!Object.hasOwn(aliases,field)||field==='sequence'||!Number.isInteger(index)||index!<0||index!>=width)throw Error('列对应包含无效字段或超出原表范围。');if(used.has(index!))throw Error('同一原始列不能同时对应多个字段。');used.add(index!);columns[field as DocumentImportField]=index;}
 const cells=table.cells.map(row=>row.map(str));if(table.headerRow!==null&&(!Number.isInteger(table.headerRow)||table.headerRow<0||table.headerRow>=cells.length))throw Error('原始表头行无效。');
 const sourceHeader=table.headerRow===null?[]:cells[table.headerRow],kind=columns.price!==undefined?priceKind(sourceHeader[columns.price]||''):columns.sourceAmount!==undefined?priceKind(sourceHeader[columns.sourceAmount]||''):'unknown';
 const updated={...table,cells,mapping:{...mapping},priceKind:kind},rows:DocumentImportRow[]=[],warnings:string[]=[];
 for(let index=startRow;index<cells.length;index++){const raw=cells[index],first=raw.find(Boolean)||'';if(!first||summary(first))continue;if(index===table.headerRow||headerFor(raw,local,[]))continue;const values=cellsFor(raw,{columns,kind});if(summary(values.name||first)||(!hasNumberFields(values)&&footer(values.name||first)))continue;if(appendContinuation(rows,values))continue;if(values.name||values.model||hasNumberFields(values))add(rows,{...rowOf(values,local,index+1,warnings),tableId:table.id});}
 if(columns.price===undefined)warnings.push('未对应单价列，价格保持空白；不会使用原金额反算单价。');
 return {...complete(rows,warnings,new Set([kind]),local),tables:[updated]};
}

type Line={words:DocumentImportWord[];cy:number;height:number};
type GeoToken={field:Field|null;label:string;x0:number;x1:number};
type GeoColumn=Omit<GeoToken,'field'>&{field:Field|null;left:number;right:number};
function linesFor(words:DocumentImportWord[]):Line[]{
 const result:Line[]=[];for(const word of [...words].sort((a,b)=>(a.bbox.y0+a.bbox.y1-b.bbox.y0-b.bbox.y1)/2||a.bbox.x0-b.bbox.x0)){const cy=(word.bbox.y0+word.bbox.y1)/2,height=word.bbox.y1-word.bbox.y0;let line=result.at(-1);if(!line||Math.abs(line.cy-cy)>Math.max(2,Math.min(line.height,height)*0.45)){line={words:[],cy,height};result.push(line);}line.words.push(word);line.cy=(line.cy*(line.words.length-1)+cy)/line.words.length;line.height=Math.min(line.height,height);}
 for(const line of result)line.words.sort((a,b)=>a.bbox.x0-b.bbox.x0);if(result.length>MAX_ROWS)throw new Error('文字最多支持 5000 行。');return result;
}
function headerTokens(line:Line):GeoToken[]{
 const result:GeoToken[]=[],words=line.words;for(let i=0;i<words.length;i++){let text='',best:{end:number;field:Field;text:string}|undefined;for(let j=i;j<Math.min(words.length,i+14);j++){if(j>i){const prev=words[j-1],curr=words[j],glyph=(prev.bbox.x1-prev.bbox.x0)/Math.max(1,prev.text.length);if(curr.bbox.x0-prev.bbox.x1>Math.max(7,Math.min(24,glyph*1.6)))break;}text+=words[j].text;const field=byLabel.get(label(text));if(field)best={end:j,field,text};if(text.length>40)break;}if(best){result.push({field:best.field,label:best.text,x0:words[i].bbox.x0,x1:words[best.end].bbox.x1});i=best.end;}}
 return result;
}
function geometryHeader(line:Line,next:Line|undefined,options:Options,warnings:string[]):{columns:GeoColumn[];kind:DocumentImportPreview['priceKind'];extra:boolean}|null{
 let tokens=headerTokens(line),extra=false;if(!headerFor(tokens.map(token=>token.label),options,[]))return null;
 if(next&&next.cy-line.cy<Math.max(line.height,next.height)*2.5&&!next.words.some(word=>documentImportNumber(word.text,true)!==null)){const additional=headerTokens(next);if(additional.length&&additional.every(token=>token.field!==null&&['price','sourceAmount','unit'].includes(token.field))){tokens=[...tokens,...additional];extra=true;
   for(const token of additional)if(token.field==='price'&&priceKind(token.label)==='unknown'){const qualifier=line.words.find(word=>/^(销售|采购|成本|供货)$/.test(word.text)&&Math.abs((word.bbox.x0+word.bbox.x1-token.x0-token.x1)/2)<Math.max(30,token.x1-token.x0));if(qualifier)token.label=qualifier.text+token.label;}
  }}
 // Unknown labels still occupy a column, so a missed name/specification header
 // cannot expand the neighboring column and swallow that column's contents.
 for(const word of line.words)if(!tokens.some(token=>word.bbox.x0<token.x1&&word.bbox.x1>token.x0))tokens.push({field:null,label:word.text,x0:word.bbox.x0,x1:word.bbox.x1});
 tokens.sort((a,b)=>a.x0-b.x0);if(tokens.length>MAX_COLUMNS)throw new Error('识别表头最多支持 60 列。');const header=headerFor(tokens.map(token=>token.label),options,warnings);if(!header)return null;
 const selected:GeoColumn[]=tokens.map((token,index)=>({...token,field:token.field&&header.columns[token.field]===index?token.field:null,left:0,right:0}));
 selected.forEach((col,index)=>{col.left=index?(selected[index-1].x1+col.x0)/2:-Infinity;col.right=index<selected.length-1?(col.x1+selected[index+1].x0)/2:Infinity;});return {columns:selected,kind:header.kind,extra};
}
function joined(words:DocumentImportWord[]){let result='';for(let i=0;i<words.length;i++){const word=words[i],prev=words[i-1],gap=prev?word.bbox.x0-prev.bbox.x1:0,close=prev&&gap<=Math.max(3,(prev.bbox.x1-prev.bbox.x0)/Math.max(1,prev.text.length)*0.35),join=close&&((/[\p{Script=Han}]$/u.test(prev.text)&&/^[\p{Script=Han}]/u.test(word.text))||(/^[\d.,￥¥+]+$/.test(prev.text)&&/^[\d.,]+$/.test(word.text)));result+=(i&&!join?' ':'')+word.text;}return result;}
function valuesFor(line:Line,columns:GeoColumn[],warnings:string[],source:string):{values:CellValues;cells:string[]}{
 const financial=['quantity','price','sourceAmount'],textual=['name','model','code','brand','batch','sequence'],assignments=new Map<DocumentImportWord,number>(),numbers:DocumentImportWord[]=[];
 const numericColumns=columns.map((col,index)=>({col,index})).filter(({col})=>col.field&&financial.includes(col.field));
 for(const word of line.words){const center=(word.bbox.x0+word.bbox.x1)/2,anchor=columns.findIndex(col=>word.bbox.x0>=col.left&&word.bbox.x0<col.right),isNumber=documentImportNumber(word.text,true)!==null;
  const textAnchor=anchor>=0&&columns[anchor].field&&textual.includes(columns[anchor].field!);const index=isNumber&&!textAnchor?columns.findIndex(col=>center>=col.left&&center<col.right):anchor;assignments.set(word,index);
  if(isNumber&&!textAnchor&&anchor>=0&&columns[anchor].field&&financial.includes(columns[anchor].field!))numbers.push(word);
  const across=columns.filter(col=>Math.min(word.bbox.x1,col.right)-Math.max(word.bbox.x0,col.left)>2);if(across.length>1&&word.bbox.x1-word.bbox.x0>20)warnings.push(source+'：有文字横跨多个表格列，请核对长规格及相邻数量、单价；未拆分或反算金额。');
 }
 const completeNumeric=numericColumns.length===3&&financial.every(field=>numericColumns.some(({col})=>col.field===field))&&columns.filter(col=>financial.includes(byLabel.get(label(col.label))||'')).length===3;
 let ambiguous=false;if(completeNumeric){numbers.sort((a,b)=>a.bbox.x0-b.bbox.x0);const ordered=numbers.length===3&&numbers.every((word,index)=>!index||numbers[index-1].bbox.x1<=word.bbox.x0);
  if(ordered){let moved=false;numbers.forEach((word,index)=>{moved||=assignments.get(word)!==numericColumns[index].index;assignments.set(word,numericColumns[index].index);});if(moved)warnings.push(source+'：已按独立数字块与数量、单价、金额列的左右顺序对应，请核对右对齐数字。');}
  else if(line.words.some(word=>{const index=assignments.get(word)!;return index>=0&&columns[index].field&&financial.includes(columns[index].field!);})){ambiguous=true;warnings.push(source+'：数量、单价、金额的独立数字块数量不匹配或重叠，相关字段已留空，请用原始列手动对应，不会猜测金额。');}
 }
 const buckets=columns.map(()=>[] as DocumentImportWord[]);for(const [word,index]of assignments)if(index>=0)buckets[index].push(word);const cells=buckets.map(words=>joined(words)),values:CellValues={};columns.forEach((col,index)=>{if(col.field)values[col.field]=ambiguous&&financial.includes(col.field)?'':cells[index];});return {values,cells};
}
function unheadedCells(lines:Line[]):string[][]{
 const groups=lines.map(line=>{const result:DocumentImportWord[][]=[];for(const word of line.words){const last=result.at(-1),previous=last?.at(-1),glyph=previous?(previous.bbox.x1-previous.bbox.x0)/Math.max(1,previous.text.length):0;if(!previous||word.bbox.x0-previous.bbox.x1>Math.max(18,Math.min(60,glyph*2)))result.push([word]);else last!.push(word);}if(result.length>MAX_COLUMNS)throw Error('识别原始列最多支持 60 列。');return result;});
 const reference=groups.reduce((longest,row)=>row.length>longest.length?row:longest,[] as DocumentImportWord[][]),anchors=reference.map(group=>group[0].bbox.x0);
 return groups.map(row=>{const cells=anchors.map(()=>[] as DocumentImportWord[]);for(const group of row){const x=group[0].bbox.x0,index=anchors.findIndex((anchor,i)=>x>=(i?(anchors[i-1]+anchor)/2:-Infinity)&&x<(i<anchors.length-1?(anchor+anchors[i+1])/2:Infinity));if(index>=0)cells[index].push(...group);}return cells.map(words=>joined(words));});
}
export function parseDocumentWords(words:DocumentImportWord[],options:Options):DocumentImportPreview{
 optionsCheck(options);if(!Array.isArray(words)||words.length>30000)throw new Error('一次最多处理 30000 个识别文字块。');const valid=words.filter(word=>str(word?.text));for(const word of valid){const b=word?.bbox;if(typeof word.text!=='string'||word.text.length>2000||!b||![b.x0,b.x1,b.y0,b.y1].every(Number.isFinite)||b.x1<=b.x0||b.y1<=b.y0)throw new Error('识别文字的坐标或内容无效，请重新扫描。');}
 const lines=linesFor(valid),rows:DocumentImportRow[]=[],warnings:string[]=[],kinds=new Set<DocumentImportPreview['priceKind']>(),tables:DocumentImportTable[]=[];let columns:GeoColumn[]|null=null,hadHeader=false,table:DocumentImportTable|undefined;
 for(let i=0;i<lines.length;i++){const line=lines[i],next=geometryHeader(line,lines[i+1],options,warnings);if(next){const mapping=Object.fromEntries(next.columns.flatMap((col,index)=>col.field&&col.field!=='sequence'?[[col.field,index]]:[])) as DocumentImportTable['mapping'];if(!table||JSON.stringify(mapping)!==JSON.stringify(table.mapping)||next.kind!==table.priceKind){table={...newTable(options.source),headerRow:0,mapping,priceKind:next.kind};tables.push(table);}columns=next.columns;table.cells.push(columns.map(col=>col.label));hadHeader=true;kinds.add(next.kind);if(next.extra)i++;continue;}if(!columns||!table)continue;
  const {values,cells}=valuesFor(line,columns,warnings,options.source+' · 第'+(i+1)+'行');table.cells.push(cells);const text=joined(line.words);if(summary(text)||footer(text)||summary(values.name||text)||(!hasNumberFields(values)&&footer(values.name||text)))continue;if(appendContinuation(rows,values))continue;
  const scores=line.words.map(word=>word.confidence).filter((score):score is number=>typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=100),confidence=scores.length?Math.min(...scores):undefined;
  if(values.name||hasNumberFields(values)||values.model)add(rows,{...rowOf(values,options,i+1,warnings,confidence),tableId:table.id});
 }
 if(!hadHeader){warnings.push('未找到可靠的几何表头：原始文字已按明显间距分列，第一列仅暂列名称，请手动对应列；不会猜测数量和单价。');table={...newTable(options.source),cells:unheadedCells(lines)};tables.push(table);table.cells.forEach((cells,index)=>{const text=joined(lines[index].words);if(text&&!summary(text)&&!footer(text))add(rows,{...candidate(cells,options,index+1,warnings),tableId:table!.id});});}
 return {...complete(rows,warnings,kinds,options),tables};
}

function delimited(text:string,separator:string):string[][]{
 const rows:string[][]=[],row:string[]=[];let value='',quoted=false;for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(quoted)quoted=false;else if(!value)quoted=true;else value+=char;}else if(!quoted&&char===separator){row.push(value);value='';if(row.length>MAX_COLUMNS)throw new Error('表格最多支持 60 列。');}else if(!quoted&&(char==='\r'||char==='\n')){if(char==='\r'&&text[i+1]==='\n')i++;row.push(value);rows.push([...row]);row.length=0;value='';if(rows.length>MAX_ROWS)throw new Error('表格最多支持 5000 行。');}else value+=char;}
 if(quoted)throw new Error('文本表格的引号未闭合，请检查 CSV 文件。');if(value||row.length){row.push(value);rows.push(row);}return rows;
}
export function parseDocumentText(text:string,options:Options):DocumentImportPreview{
 optionsCheck(options);if(typeof text!=='string'||text.length>2*1024*1024)throw new Error('识别文本最多支持 2 MB。');const content=text.replace(/^\uFEFF/,'');if(content.includes('\t'))return parseDocumentTable(delimited(content,'\t'),options);
 if(content.split(/\r?\n/).slice(0,10).some(line=>line.includes(',')))return parseDocumentTable(delimited(content,','),options);
 return parseDocumentTable(content.split(/\r\n|\n|\r/).map(line=>[line]),options);
}
export function documentImportRowIssues(row:DocumentImportRow,mode:ImportOptions['mode'],options:DocumentImportValidationOptions={}):string[]{
 const errors:string[]=[],purchase=mode==='purchase',quantity=documentImportNumber(row.quantity),price=documentImportNumber(row.price,true),amount=row.sourceAmount.trim()?documentImportNumber(row.sourceAmount,true):null;
 if(!row.name.trim()||row.name.trim().length>100)errors.push('名称须为 1 至 100 字');if(!categories.includes(row.category)||(purchase&&!['材料费用','五金费用'].includes(row.category)))errors.push(purchase?'采购类别只能为材料费用或五金费用':'请选择有效费用类别');
 if(!row.unit.trim()||row.unit.length>(purchase?30:10))errors.push('单位不能为空且最多 '+(purchase?30:10)+' 字');
 for(const [key,max,caption] of [['model',100,'规格'],['brand',100,'品牌'],['code',100,'编码'],['batch',100,'批次'],['note',purchase?2000:500,'备注']] as const)if(row[key].length>max)errors.push(caption+'最多 '+max+' 字');
 if(quantity===null||quantity<=0||quantity>(purchase?1000000:100000))errors.push('数量须大于 0 且不超过 '+(purchase?1000000:100000));else if(purchase&&!/^\d+(?:\.\d{1,4})?$/.test(String(quantity)))errors.push('采购数量最多 4 位小数');
 if(!(options.allowMissingPrice&&!row.price.trim())){if(price===null||price>(purchase?100000000:10000000))errors.push('单价须填写 0 至 '+(purchase?100000000:10000000)+' 元，缺失价格不能默认 0');else if(purchase&&!/^\d+(?:\.\d{1,2})?$/.test(decimal(price)))errors.push('采购单价最多 2 位小数');}
 if(row.sourceAmount.trim()&&(amount===null||moneyCents(row.sourceAmount)===null))errors.push('原金额不是有效数字');else if(purchase&&amount!==null&&!/^\d+(?:\.\d{1,2})?$/.test(decimal(amount)))errors.push('采购原金额最多 2 位小数');
 if(!['主材','辅材','人工'].includes(row.attribute))errors.push('材料属性无效');
 if(quantity!==null&&price!==null){const total=lineCents(row,mode);if(total===null||total<0||(purchase&&total>1000000000000))errors.push('本行计算金额超出允许范围');}
 return errors;
}
export function validateDocumentImportRows(rows:DocumentImportRow[],mode:ImportOptions['mode'],options:DocumentImportValidationOptions={}):string[]{
 if(!['quote','purchase'].includes(mode))return ['导入模式无效'];if(!Array.isArray(rows))return ['识别明细无效'];const selected=rows.filter(row=>row.selected),errors:string[]=[];if(!selected.length)return ['请至少勾选一条明细'];if(selected.length>(mode==='purchase'?200:500))errors.push('本次最多复制 '+(mode==='purchase'?200:500)+' 条明细');
 const ids=new Set<string>();let total=0;selected.forEach((row,index)=>{if(ids.has(row.id))errors.push('第 '+(index+1)+' 条明细编号重复');ids.add(row.id);for(const issue of documentImportRowIssues(row,mode,options))errors.push((row.source||'第 '+(index+1)+' 条')+'：'+issue);const amount=lineCents(row,mode);if(amount!==null)total+=amount;});if(!Number.isSafeInteger(total)||(mode==='purchase'&&total>1000000000000))errors.push('所选明细合计超出允许范围');return errors;
}
