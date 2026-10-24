import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
test('built home manager does not statically download quote, contract or configuration panels',()=>{
 const root='dist/client/_next/static/chunks',entry=fs.readdirSync(root).find(n=>/^manager-.*\.js$/.test(n)),seen=new Set();
 function visit(file){if(seen.has(file))return;seen.add(file);const ast=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);for(const node of ast.statements)if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier?.text?.startsWith('./'))visit(node.moduleSpecifier.text.slice(2));}
 visit(entry);assert.ok(fs.statSync(path.join(root,entry)).size<150000);for(const file of seen)assert.doesNotMatch(file,/^(?:quote-workspace|contracts|configuration|ai-assistant)-/);console.log('Home static dependency files:',seen.size);
});
