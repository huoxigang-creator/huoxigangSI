import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../assets/fonts/contract-cjk-font.ts',import.meta.url),'utf8');
const bytes=Buffer.from(source.split('CONTRACT_CJK_FONT_BASE64')[1].split("'")[1],'base64');
if(createHash('sha256').update(bytes).digest('hex')!=='f1b79198b661c39e55479958f81af0f007159bc3dde5b8d7075fd6d3a1a22795')throw Error('Unexpected PDF font source');
const directory=new URL('../public/assets/pdf-font/',import.meta.url);mkdirSync(directory,{recursive:true});writeFileSync(new URL('cjk-f1b79198.deflate',directory),bytes);
