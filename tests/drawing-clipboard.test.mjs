import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('lib/drawing-clipboard.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {createScreenshotWatcher,pastedScreenshotFiles,screenshotFile,screenshotFingerprint}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const png=value=>new Blob([value],{type:'image/png'});
const item=blob=>({types:['text/html',blob.type],getType:async type=>{assert.equal(type,blob.type,'must never read text or HTML');return blob;}});
test('automatic intake ignores opening clipboard, imports changed images once and skips text',async()=>{
 let clipboard=[item(png('old'))],reads=0;const files=[];
 const watcher=createScreenshotWatcher({read:async()=>{reads++;return clipboard;},isFocused:()=>true,onFiles:batch=>files.push(...batch),onError:e=>{throw e;}});
 await watcher.prime();assert.equal(files.length,0);await watcher.poll();assert.equal(files.length,0);
 clipboard=[item(png('new'))];await watcher.poll();await watcher.poll();assert.equal(files.length,1);assert.equal(await files[0].text(),'new');assert.match(files[0].name,/截图-.*\.png$/);
 clipboard=[{types:['text/plain'],getType:async()=>{throw Error('must not read text');}}];await watcher.poll();assert.equal(files.length,1);watcher.stop();const before=reads;await watcher.poll();assert.equal(reads,before);
});
test('background pages do not read; returning focus imports the new screenshot',async()=>{
 let focused=true,clipboard=[item(png('baseline'))],reads=0;const files=[];
 const watcher=createScreenshotWatcher({read:async()=>{reads++;return clipboard;},isFocused:()=>focused,onFiles:batch=>files.push(...batch),onError:e=>{throw e;}});
 await watcher.prime();focused=false;clipboard=[item(png('after snip'))];await watcher.poll();assert.equal(reads,1);assert.equal(files.length,0);
 focused=true;await watcher.poll();assert.equal(files.length,1);
});
test('closing while a read is in flight prevents late import and polls never overlap',async()=>{
 let next,reads=0;const imported=[];
 const watcher=createScreenshotWatcher({read:()=>{reads++;return new Promise(r=>next=r);},isFocused:()=>true,onFiles:files=>imported.push(...files),onError:e=>{throw e;}});
 const prime=watcher.prime();next([]);await prime;
 const polling=watcher.poll();await watcher.poll();assert.equal(reads,2);watcher.stop();next([item(png('late'))]);await polling;assert.equal(imported.length,0);
});
test('denied permission reports fallback; paste validates image-only and 10MB boundary',async()=>{
 const errors=[];const watcher=createScreenshotWatcher({read:async()=>{throw new DOMException('denied','NotAllowedError');},isFocused:()=>true,onFiles:()=>assert.fail('no upload'),onError:e=>errors.push(e)});
 await assert.rejects(watcher.prime(),/denied/);await watcher.poll();assert.equal(errors[0].name,'NotAllowedError');
 const file=screenshotFile(png('paste'));assert.deepEqual(pastedScreenshotFiles({items:[{kind:'file',type:'image/png',getAsFile:()=>file}],files:[file]}),[file]);
 assert.deepEqual(pastedScreenshotFiles({items:[{kind:'string',type:'text/plain'}],files:[]}),[]);
 assert.equal(screenshotFile(new Blob([new Uint8Array(10*1024*1024)],{type:'image/png'})).size,10*1024*1024);
 assert.throws(()=>screenshotFile(new Blob([new Uint8Array(10*1024*1024+1)],{type:'image/png'})),/10MB/);
 assert.equal(await screenshotFingerprint(file),await screenshotFingerprint(png('paste')));
});
