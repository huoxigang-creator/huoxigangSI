import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import {renderToStaticMarkup} from 'react-dom/server';
const compile=(s,jsx=false)=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:jsx?ts.JsxEmit.ReactJSX:undefined}}).outputText;
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const quotesURL=url(compile(fs.readFileSync('lib/quotes.ts','utf8')));
const {quotePriceCents,quoteLineAmountCents}=await import(quotesURL);
const {projectFinancialSummary}=await import(url(compile(fs.readFileSync('lib/payments.ts','utf8'))));
const {employeeResult}=await import(url(compile(fs.readFileSync('lib/employee-access.ts','utf8'))));
test('unit prices use decimal half-up and line amounts retain fractional yuan',()=>{assert.equal(quotePriceCents(1.005),101);assert.equal(quoteLineAmountCents(2,10.5),2100);assert.equal(quoteLineAmountCents(0.29,0.5),15);assert.equal(quoteLineAmountCents(0,500),0);});
test('parent summary includes children once; child summary stays independent',()=>{const root={id:'r',received:1000,paid:200,contract:1000},child={id:'c',parent_id:'r',received:2000,paid:300,contract:373000};const data=[root,child];assert.equal(projectFinancialSummary(root,data).received,3000);assert.equal(projectFinancialSummary(root,data).contract,374000);assert.equal(projectFinancialSummary(child,data).received,2000);assert.equal(root.received,1000);});
test('all employee quote read/write results strip internal and purchase prices',()=>{const quote={items:[{price:100,internal_price:50,contract_price:80,purchase_price:20}]};for(const action of ['create_quote','update_quote','adopt_quote','unadopt_quote','delete_quote_items'])assert.deepEqual(employeeResult(action,quote).items,[{price:100}]);assert.deepEqual(employeeResult('get_workspace',{projects:[],quotes:[quote]}).quotes[0].items,[{price:100}]);assert.deepEqual(employeeResult('get_project',{project:{budget:100},quotes:[quote]}).quotes[0].items,[{price:100}]);});
test('actual draft A4 markup totals 10.50 times 2 as 21.00',async()=>{
 const source=fs.readFileSync('app/quote-workspace.tsx','utf8'),start=source.indexOf('<main className="qwDraftPrint">'),end=source.indexOf('</main>',start)+7;
 const jsx=source.slice(start,end),module=`import {Fragment} from 'react';import {quoteLineAmountCents} from '${quotesURL}';export function DraftPrint(props){const {draft,project,companyName,projectName,customerMode}=props;const QUOTE_CATEGORIES=['柜体'];const untouchedAuto=()=>false;return (${jsx});}`;
 const code=compile(module,true).replaceAll('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime'))).replaceAll("from 'react'",`from '${import.meta.resolve('react')}'`);
 const {DraftPrint}=await import(url(code));const html=renderToStaticMarkup(DraftPrint({draft:{title:'隔离打印',items:[{category:'柜体',key:'1',name:'柜体',model:'',unit:'个',quantity:2,price:10.5,note:''}],note:''},project:{},companyName:'测试',projectName:'测试',customerMode:false}));
 assert.match(html,/<td class="qwPrAmount">21\.00/);assert.match(html,/qwPrTotal[\s\S]*?<td>21\.00/);assert.doesNotMatch(html,/>22\.00</);
});

test('downloaded Excel preserves the same fractional price and saved line total',async()=>{
 const exported=compile(fs.readFileSync('lib/quote-export.ts','utf8')).replaceAll("from './quotes'",`from '${quotesURL}'`).replaceAll("import('xlsx')",`import('${import.meta.resolve('xlsx')}')`);
 const {createQuoteExcelBytes}=await import(url(exported));
 const input={project:{id:'test',name:'隔离项目',customer:'测试'},companyName:'测试',quote:{title:'测试',total:2100,items:[{name:'金额核对行',category:'柜体',unit:'个',quantity:2,price:10.5}]}};
 const bytes=await createQuoteExcelBytes(input),XLSX=await import('xlsx'),book=XLSX.read(bytes,{type:'buffer'}),rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
 const line=rows.find(r=>r[1]==='金额核对行');assert.equal(line[4],10.5);assert.equal(line[5],21);
});
