const fs=require('fs'),path=require('path'),ts=require('typescript');
const outDir='outputs/_mod';
fs.rmSync(outDir,{recursive:true,force:true});
fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'package.json'),JSON.stringify({type:'commonjs'}));
for(const file of ['quote-export.ts','quotes.ts']){
  const src=fs.readFileSync('lib/'+file,'utf8');
  const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  fs.writeFileSync(path.join(outDir,file.replace('.ts','.js')),js);
}
console.log('transpiled ok');
