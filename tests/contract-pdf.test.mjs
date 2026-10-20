import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import {PDFDocument} from 'pdf-lib';

const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const templateUrl=url(compile('lib/contract-template.ts'));
const output='outputs/contracts';mkdirSync(output,{recursive:true});
// A file URL avoids embedding the entire 8MB font module again in a nested data URL.
writeFileSync(output+'/contract-test-font.mjs',readFileSync('assets/fonts/contract-cjk-font.ts','utf8'));
const fontUrl=pathToFileURL(resolve(output+'/contract-test-font.mjs')).href;
const quotesUrl=url(compile('lib/quotes.ts'));
const {DEFAULT_CONTRACT_TEMPLATE,CONTRACT_TEMPLATE_VARIABLES,renderContractTemplate,contractAmountWords,contractMoney}=await import(templateUrl);
const {generateContractPdf}=await import(url(compile('lib/contract-pdf.ts').replaceAll("from 'pdf-lib'",`from '${import.meta.resolve('pdf-lib')}'`).replaceAll("from '@pdf-lib/fontkit'",`from '${import.meta.resolve('@pdf-lib/fontkit')}'`).replaceAll("from '../assets/fonts/contract-cjk-font'",`from '${fontUrl}'`).replaceAll("from './contract-template'",`from '${templateUrl}'`).replaceAll("from './quotes'",`from '${quotesUrl}'`)));
const room='71000000-0000-4000-a000-000000000001',emptyRoom='71000000-0000-4000-a000-000000000002',cabinet='72000000-0000-4000-a000-000000000001';
function fixture(){return {id:'fixture-contract',revision:'fixture-v1',project:'fixture-customer',created:'2026-10-13T00:00:00.000Z',updated:'2026-10-13T00:00:00.000Z',title:'全屋定制购货合同书',contract_type:'全屋定制',employee:'测试负责人',sign_date:'2026-10-13',number:'TEST-20261013-01',paper_number:'',quote_id:'fixture-quote',quote_snapshot:{id:'fixture-quote',title:'四类整户报价',total:119002,note:'本机虚构测试数据',rooms:[{id:room,name:'主卧室'},{id:emptyRoom,name:'空厨房'}],items:[{room_id:room,name:'衣柜',category:'柜体',model:'原型号',quantity:2.35,price:480,unit:'㎡',note:'原柜体价格'},{room_id:room,name:'安装',category:'人工费用',quantity:2,price:10.005,unit:'项'},{room_id:room,name:'补充板材',category:'材料费用',quantity:1.5,price:25,unit:'张'},{room_id:room,name:'铰链',category:'五金费用',quantity:3,price:1.5,unit:'只'}]},gross_amount:119002,discount_amount:10000,rounding_amount:2,net_amount:109000,company_name:'示例家具有限公司',company_address:'虚构公司地址',company_phone:'00000000000',customer_name:'示例客户',customer_phone:'00000000000',customer_address:'虚构交货地点',party_type:'person',customer_company:'',template_id:DEFAULT_CONTRACT_TEMPLATE.id,template_snapshot:{...DEFAULT_CONTRACT_TEMPLATE},special_terms:'',note:'仅用于测试',installments:[{id:'first',name:'定金',ratio:30,amount:32700,due_date:'2026-10-13'},{id:'second',name:'材料款',ratio:40,amount:43600,due_date:''},{id:'last',name:'尾款',ratio:30,amount:32700,due_date:''}],receipt_allocations:[],status:'draft'};}
function freezeDeep(value){if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freezeDeep);}return value;}
const python=process.env.CONTRACT_TEST_PYTHON||'C:/Users/huoxigang/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
function inspectPdf(path,positions){return JSON.parse(execFileSync(python,['-X','utf8','-c',`import json,sys,pdfplumber,hashlib
from pypdf import PdfReader
reader=PdfReader(sys.argv[1]);font=next(iter(reader.pages[0]['/Resources']['/Font'].values())).get_object()
desc=font['/DescendantFonts'][0].get_object()['/FontDescriptor'].get_object()
font_sha256=hashlib.sha256(desc['/FontFile2'].get_object().get_data()).hexdigest()
with pdfplumber.open(sys.argv[1]) as pdf:
 pages=[{'text':page.extract_text(layout=False),'width':page.width,'height':page.height} for page in pdf.pages]
 positions=json.loads(sys.argv[2]);inside={}
 for key,pos in positions.items():
  page=pdf.pages[pos['page']-1];left=pos['x'];right=left+pos['width'];bottom=pos['y'];top=bottom+pos['height']
  inside[key]=[c['text'] for c in page.chars if c['x0']<right and c['x1']>left and (page.height-c['top'])>bottom and (page.height-c['bottom'])<top]
 print(json.dumps({'pages':pages,'inside':inside,'font_sha256':font_sha256},ensure_ascii=False))`,path,JSON.stringify(positions)],{encoding:'utf8',maxBuffer:10*1024*1024}));}

test('builtin template keeps all eleven supplied clauses and legitimate empty identity variables',()=>{
 const body=DEFAULT_CONTRACT_TEMPLATE.body;
 assert.equal(DEFAULT_CONTRACT_TEMPLATE.id,'gugemei-sales-default');
 for(const number of ['一','二','三','四','五','六','七','八','九','十','十一'])assert.match(body,new RegExp('第'+number+'条'));
 for(const text of ['0.5%尺寸水路','产品质保期为3年','灯光类产品质保1年','石英石台面质保期为2年','合同总额5%','合同总价_5_‰','GB18580-2017','超过7日视为验收通过','第3个工作日','提前3日'])assert.ok(body.includes(text),text);
 const text=renderContractTemplate(fixture());assert.ok(text.includes('身份证号码：\n'));assert.ok(!/\{\{/.test(text));assert.ok(text.includes('合同总金额为：1190.02元'));assert.ok(text.includes('优惠金额为：100.02元'));assert.ok(text.includes('合同签订金额为：1090.00元'));assert.ok(text.includes('壹仟零玖拾元整'));
 assert.ok(CONTRACT_TEMPLATE_VARIABLES.some(variable=>variable.key==='payment_schedule'));
 for(const key of ['customer_identity_number','customer_identity_type'])assert.ok(CONTRACT_TEMPLATE_VARIABLES.some(variable=>variable.key===key),key);
 assert.equal(/\d{17}[0-9Xx]/.test(body),false);
});

test('template replacements are one-pass text and money words keep exact integer cents',()=>{
 const record=fixture();record.customer_name='{{company_name}} <script>literal</script>';record.template_snapshot.body='{{customer_name}}|{{ unknown }}|{{net_amount}}|{{payment_schedule}}';const text=renderContractTemplate(record);
 assert.ok(text.startsWith('{{company_name}} <script>literal</script>||1090.00|'));assert.ok(text.includes('定金 | 30% | 327.00元'));
 for(const [amount,words] of [[0,'零元整'],[1,'零元壹分'],[10,'零元壹角'],[101,'壹元零壹分'],[10010,'壹佰元壹角'],[1000100,'壹万零壹元整'],[10000000100,'壹亿零壹元整'],[10000100100,'壹亿零壹仟零壹元整']])assert.equal(contractAmountWords(amount),words);
 assert.equal(contractMoney(10002),'100.02');assert.equal(contractMoney(undefined),'');assert.throws(()=>contractAmountWords(1.5),/整数分/);assert.throws(()=>contractAmountWords(-1),/整数分/);
 record.party_type='organization';record.customer_company='虚构组织';record.template_snapshot.body='{{customer_name}}';assert.equal(renderContractTemplate(record),'虚构组织');
});

let generated;
test('actual Chinese PDF contains room/four-category saved prices, installments and settlement without source mutation',async()=>{
 const record=freezeDeep(fixture()),before=JSON.stringify(record);generated=await generateContractPdf(record);const pdf=await PDFDocument.load(generated.bytes);assert.ok(pdf.getPageCount()>=4);assert.equal(JSON.stringify(record),before);writeFileSync(output+'/contract-fixture.pdf',generated.bytes);writeFileSync(output+'/contract-fixture-positions.json',JSON.stringify(generated.positions,null,2));
 for(const position of Object.values(generated.positions)){assert.ok(position.page>=1&&position.page<=pdf.getPageCount());const page=pdf.getPage(position.page-1);assert.equal(position.page_width,page.getWidth());assert.equal(position.page_height,page.getHeight());assert.ok(position.width>=160&&position.height>=160);assert.ok(position.x>=0&&position.y>=44);assert.ok(position.x+position.width<=page.getWidth());assert.ok(position.y+position.height<=page.getHeight()-44);}
 const {customer,company}=generated.positions;assert.equal(customer.page,company.page);assert.ok(customer.x+customer.width<company.x);assert.equal(customer.y,company.y);
});

test('rendered PDF keeps original legal terms, exact saved item values and completely blank signing rectangles',{skip:!existsSync(python)},()=>{
 assert.ok(generated);const result=inspectPdf(output+'/contract-fixture.pdf',generated.positions),text=result.pages.map(page=>page.text).join('\n'),flat=text.replace(/\s/g,'');
 for(const term of ['第十一条','0.5%尺寸水路','GB18580-2017','合同总价_5_‰','定金','327.00','436.00','主卧室','空厨房','柜体','人工费用','材料费用','五金费用','1128.00','10.01','20.02','1190.02','100.00','0.02','1090.00'])assert.ok(flat.includes(term),term);
 assert.equal(flat.match(/附件一：示例家具有限公司报价清单/g)?.length,2);assert.deepEqual(result.inside,{customer:[],company:[]});
 assert.ok(flat.includes('身份证号码：联系电话：'),'旧合同未填写身份证时留空，不从姓名或电话推算号码');
});

test('personal and organization signer identity numbers reach the actual PDF under the original label',{skip:!existsSync(python)},async()=>{
 // 000000 is deliberately not a real administrative area. This local fixture is never submitted for identity verification.
 const identityNumber='000000200001010012',originalBody=DEFAULT_CONTRACT_TEMPLATE.body;
 for(const partyType of ['person','organization']){
  const record=fixture();record.party_type=partyType;record.customer_identity_type='CRED_PSN_CH_IDCARD';record.customer_identity_number=identityNumber;
  if(partyType==='organization'){record.customer_company='虚构组织';record.customer_name='示例经办人';}
  const before=JSON.stringify(record);freezeDeep(record);const pdf=await generateContractPdf(record),path=output+'/contract-identity-'+partyType+'.pdf';writeFileSync(path,pdf.bytes);
  const text=inspectPdf(path,pdf.positions).pages.map(page=>page.text).join('\n').replace(/\s/g,'');
  assert.ok(text.includes('身份证号码：'+identityNumber),partyType+' 签署人填写的身份证号码须原样出现在生成的 PDF 中');
  assert.equal(text.split(identityNumber).length-1,1,'身份证只回填原模板的证件字段');
  assert.ok(text.includes('委托方（以下简称甲方）：'+(partyType==='organization'?'虚构组织':'示例客户')));
  assert.equal(JSON.stringify(record),before,'生成 PDF 不改写合同保存值');
 }
 assert.equal(DEFAULT_CONTRACT_TEMPLATE.body,originalBody,'回填号码不改变默认合同条款');
});

test('uncollected signer identity and unsupported identity placeholders remain blank',()=>{
 const record=fixture();record.template_snapshot.body='身份证号码：{{customer_identity_number}}\n证件类型：{{customer_identity_type}}\n未知证件：{{customer_idcard_number}}';
 for(const partyType of ['person','organization']){record.party_type=partyType;assert.equal(renderContractTemplate(record),'身份证号码：\n证件类型：\n未知证件：');}
 record.customer_identity_number='000000200001010012';record.customer_identity_type='CRED_PSN_CH_IDCARD';
 assert.equal(renderContractTemplate(record),'身份证号码：000000200001010012\n证件类型：大陆身份证\n未知证件：','未知占位符不能借用或捏造号码');
});

test('legacy room/cabinet metadata keeps its line and source sale price, and empty/no-quote contracts remain valid',async()=>{
 const record=fixture();record.quote_snapshot.cabinets=[{id:cabinet,room_id:room,name:'旧衣柜'}];record.quote_snapshot.items[0].cabinet_id=cabinet;const legacy=await generateContractPdf(record);writeFileSync(output+'/contract-legacy.pdf',legacy.bytes);
 if(existsSync(python)){const text=inspectPdf(output+'/contract-legacy.pdf',legacy.positions).pages.map(page=>page.text).join('\n').replace(/\s/g,'');assert.ok(text.includes('原柜体：旧衣柜'));assert.ok(text.includes('1128.00'));}
 record.quote_snapshot=null;const without=await generateContractPdf(record);assert.ok((await PDFDocument.load(without.bytes)).getPageCount()>=3);
 const empty=fixture();empty.quote_snapshot.items=[];empty.quote_snapshot.total=0;empty.gross_amount=empty.discount_amount=empty.rounding_amount=empty.net_amount=0;empty.installments=[];assert.ok((await generateContractPdf(empty)).bytes.length>1000);
});

test('invalid financial snapshots, installment sums and orphan cabinet relationships block unsigned document generation',async()=>{
 for(const mutate of [record=>record.net_amount++,record=>record.gross_amount=1.5,record=>record.installments[0].amount++,record=>record.quote_snapshot.total++,record=>record.quote_snapshot.items[0].quantity=0,record=>record.quote_snapshot.items[0].cabinet_id=cabinet,record=>{record.quote_snapshot.cabinets=[{id:cabinet,room_id:emptyRoom,name:'错配柜体'}];record.quote_snapshot.items[0].cabinet_id=cabinet;}]){const record=fixture();mutate(record);await assert.rejects(generateContractPdf(record),/金额|合计|关联|整数分/);}
 const record=fixture();record.title=String.fromCodePoint(0x10ffff);await assert.rejects(generateContractPdf(record),/字体不支持/);
});

test('long text paginates with signatures kept together and does not collect sample identification values',async()=>{
 const record=fixture();record.template_snapshot.body='{{contract_title}}\n'+Array.from({length:70},(_,index)=>'第'+(index+1)+'行：这是一段虚构的长文本，用于检查跨页排版与签章预留区域。').join('\n')+'\n{{payment_schedule}}';record.special_terms='虚构补充约定';record.quote_snapshot=null;
 const pdf=await generateContractPdf(record);writeFileSync(output+'/contract-pagination.pdf',pdf.bytes);const document=await PDFDocument.load(pdf.bytes);assert.ok(document.getPageCount()>=3);assert.equal(pdf.positions.customer.page,pdf.positions.company.page);assert.equal(pdf.positions.customer.page,document.getPageCount());
 if(existsSync(python)){const result=inspectPdf(output+'/contract-pagination.pdf',pdf.positions);assert.deepEqual(result.inside,{customer:[],company:[]});assert.ok(result.pages.map(page=>page.text).join('\n').includes('虚构补充约定'));assert.equal(result.font_sha256,'450625c8d46ab3df97b7904ded955ec2746d17ec76740cb1e91d1ba63a0f89af','完整字库避免短模板CJK子集字形丢失');}
});
