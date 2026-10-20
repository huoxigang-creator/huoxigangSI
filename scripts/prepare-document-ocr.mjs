import {copyFileSync,existsSync,mkdirSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(project,'package.json'));
const root=path.join(project,'public/assets/document-ocr');
const tesseract=path.dirname(require.resolve('tesseract.js/package.json'));
const core=path.dirname(createRequire(path.join(tesseract,'package.json')).resolve('tesseract.js-core/package.json'));
const pdf=path.dirname(require.resolve('pdfjs-dist/package.json'));
const version=JSON.parse(readFileSync(path.join(tesseract,'package.json'),'utf8')).version;
if(version!=='7.0.0')throw Error('OCR assets must match the pinned Tesseract version');
const runtime=path.join(root,'7.0.0');
const languageTarget=path.join(root,'languages/full');
mkdirSync(runtime,{recursive:true});mkdirSync(languageTarget,{recursive:true});
copyFileSync(path.join(tesseract,'dist/worker.min.js'),path.join(runtime,'worker.min.js'));
copyFileSync(path.join(tesseract,'LICENSE.md'),path.join(runtime,'LICENSE-TESSERACT.md'));
// LSTM-only recognition selects one of these three self-contained runtimes in v7.
for(const file of readdirSync(core))if(/^tesseract-core(?:-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(file)||/^LICENSE/i.test(file))copyFileSync(path.join(core,file),path.join(runtime,file));
for(const file of readdirSync(runtime))if(/^tesseract-core.*\.(js|wasm)$/.test(file)&&!/^tesseract-core(?:-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(file))rmSync(path.join(runtime,file));
for(const language of ['chi_sim']){
 const languageRoot=path.dirname(require.resolve('@tesseract.js-data/'+language+'/package.json'));
 // The full Chinese LSTM model preserves more character detail than best_int.
 copyFileSync(path.join(languageRoot,'4.0.0',language+'.traineddata.gz'),path.join(languageTarget,language+'.traineddata.gz'));
 if(existsSync(path.join(languageRoot,'README.md')))copyFileSync(path.join(languageRoot,'README.md'),path.join(root,'languages','README-'+language+'.md'));
}
// Remove the unused English model created by earlier local preparation.
for(const file of ['chi_sim.traineddata.gz','eng.traineddata.gz','README-eng.md'])if(existsSync(path.join(root,'languages',file)))rmSync(path.join(root,'languages',file));
const pdfRoot=path.join(root,'pdf');mkdirSync(pdfRoot,{recursive:true});
copyFileSync(path.join(pdf,'build/pdf.worker.min.mjs'),path.join(pdfRoot,'pdf.worker.min.mjs'));
copyFileSync(path.join(pdf,'LICENSE'),path.join(pdfRoot,'LICENSE-PDFJS'));
// Directory copy without fs.cpSync: equivalent behavior, avoids runtime crashes
// on some Windows Node builds when copying many small files.
function copyDirRecursive(src,dst){
  mkdirSync(dst,{recursive:true});
  for(const entry of readdirSync(src,{withFileTypes:true})){
    const s=path.join(src,entry.name), d=path.join(dst,entry.name);
    if(entry.isDirectory())copyDirRecursive(s,d);
    else copyFileSync(s,d);
  }
}
for(const directory of ['cmaps','standard_fonts','wasm','iccs'])copyDirRecursive(path.join(pdf,directory),path.join(pdfRoot,directory));
