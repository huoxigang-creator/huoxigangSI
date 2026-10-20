const fs=require('fs'),path=require('path'),ts=require('typescript');
const outDir='outputs/_mod';
fs.mkdirSync(outDir,{recursive:true});
for(const file of ['quote-export.ts','quotes.ts']){
  const src=fs.readFileSync('lib/'+file,'utf8');
  const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  fs.writeFileSync(path.join(outDir,file.replace('.ts','.js')),js);
}
const m=require('./'+outDir+'/quote-export.js');
(async()=>{
  const data={
    name:'报价清单',
    rows:[['测试的清单报价'],['客户姓名：测试'],['编号','类型','项目','规格型号','单位','数量','单价','金额'],[1,'主材','长规格'.repeat(10),'型号A','个',2,10,20],['费用项'],['项目',null,null,null,null,null,null,'金额'],['报价合计',null,null,null,null,null,null,20]],
    widths:[7,10,24,44,6,9,10,14],
    merges:[{s:{r:0,c:0},e:{r:0,c:7}},{s:{r:1,c:0},e:{r:1,c:7}},{s:{r:4,c:0},e:{r:4,c:7}},{s:{r:5,c:0},e:{r:5,c:6}},{s:{r:6,c:0},e:{r:6,c:6}}],
    headerRow:2,totalRow:6,quantityColumn:5,priceColumn:6,amountColumn:7,sectionRows:[4],subtotalRows:[],yellowRows:[]
  };
  const bytes=await m.applyQuoteExcelStyling(data,{title:'测试'});
  fs.writeFileSync('outputs/border-check.xlsx',Buffer.from(bytes));
  const XLSX=require('xlsx');
  const zip=XLSX.CFB.read(bytes,{type:'buffer'});
  const stylesText=new TextDecoder().decode(XLSX.CFB.find(zip,'/xl/styles.xml').content);
  console.log('border FF000000 present:',stylesText.includes('FF000000'));
  console.log('applyBorder present:',stylesText.includes('applyBorder'));
  const sheetText=new TextDecoder().decode(XLSX.CFB.find(zip,'/xl/worksheets/sheet1.xml').content);
  const sAttr=sheetText.match(/<c [^>]*s="\d+"/g)||[];
  console.log('cells with s attr:',sAttr.length,'of', (sheetText.match(/<c /g)||[]).length);
  console.log('sample:',sAttr.slice(0,6));
  // 未加 s 的单元格
  const noS=(sheetText.match(/<c [^>]*r="[A-Z]+\d+"[^>]*>/g)||[]).filter(x=>!x.includes('s='));
  console.log('cells WITHOUT s:',noS.length, noS.slice(0,5));
})().catch(e=>{console.error('ERR',e);process.exit(1)});
