const XLSX=require('xlsx'),fs=require('fs');
const file=process.argv[2];
if(!file){console.log('usage: node inspect-xlsx.cjs <file.xlsx>');process.exit(1)}
const bytes=fs.readFileSync(file);
const zip=XLSX.CFB.read(bytes,{type:'buffer'});
const td=new TextDecoder();
const stylesEntry=XLSX.CFB.find(zip,'/xl/styles.xml');
if(!stylesEntry){console.log('NO styles.xml!');}
else{
  const styles=td.decode(stylesEntry.content);
  console.log('--- styles.xml ---');
  console.log(styles.slice(0,3000));
}
const sheetEntry=XLSX.CFB.find(zip,'/xl/worksheets/sheet1.xml');
const sheet=td.decode(sheetEntry.content);
console.log('--- sheet head ---');
console.log(sheet.slice(0,1200));
const entries=XLSX.CFB.utils.cfb_foreach?null:null;
console.log('--- zip entries ---');
const names=[];XLSX.CFB.utils.cfb_foreach(zip,function(e){names.push(e.name)});
// fallback: list via find on common paths
console.log(names.length?names:'(cfb_foreach unavailable)');
