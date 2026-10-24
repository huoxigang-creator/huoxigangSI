import {readFileSync,writeFileSync,mkdirSync,existsSync,openSync,closeSync,unlinkSync,readdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
const script=fileURLToPath(import.meta.url);
export const repo=resolve(dirname(script),'..');
const state=join(repo,'.git','codex-memo');
function redact(text){return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[私钥已省略]').replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,'[密钥已省略]').replace(/((?:api[_ -]?key|access[_ -]?token|password|密码|密钥)\s*[:=：]\s*)[^\s,，;；]+/gi,'$1[已省略]');}
export function visibleMessages(log){
 const result=[];
 for(const line of log.split(/\r?\n/)){let item;try{item=JSON.parse(line);}catch{continue;}
  const p=item.payload;
  if(item.type!=='response_item'||p?.type!=='message'||!['user','assistant'].includes(p.role))continue;
  if(p.role==='assistant'&&!['commentary','final_answer','final'].includes(p.phase??p.channel))continue;
  let text=(p.content||[]).filter(c=>['input_text','output_text','text'].includes(c.type)).map(c=>c.text||'').join('\n').trim();
  if(/^# AGENTS\.md instructions|^<environment_context>|^<permissions instructions>/.test(text))continue;
  text=text.replace(/<(?:in-app-browser-context|environment_context|external_codex_apps_open_page)\b[^>]*>[\s\S]*?<\/(?:in-app-browser-context|environment_context|external_codex_apps_open_page)>/g,'').trim();
  if(!text)continue;
  result.push({role:p.role,text:redact(text),timestamp:item.timestamp||''});
 }
 return result;
}
export function renderMemo(messages,session){
 return `# 聊天备忘录\n\n会话：${session}\n\n以下为可见聊天文字；附件本体、工具输出、系统消息和内部推理不归档。\n\n`+messages.map(m=>`## ${m.role==='user'?'用户':'助手'}${m.timestamp?' · '+m.timestamp:''}\n\n${m.text}\n`).join('\n');
}
function git(args){const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true,timeout:45000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_SSH_COMMAND:'ssh -o BatchMode=yes -o ConnectTimeout=10'}});if(r.error||r.status!==0)throw Error(r.error?.message||r.stderr?.trim()||`git ${args[0]} failed`);return r.stdout.trim();}
function retrySync(){
 mkdirSync(state,{recursive:true});const lock=join(state,'sync.lock');let fd;
 try{fd=openSync(lock,'wx');}catch{return;}
 try{
  if(git(['branch','--show-current'])!=='main')throw Error('当前不是main分支，备忘录已保留本地，等待在main同步');
  const remote=git(['remote','get-url','origin']);
  if(!/^(?:git@github\.com:|https:\/\/github\.com\/)huoxigang-creator\/huoxigangSI(?:\.git)?$/.test(remote))throw Error('仓库远端不匹配，未推送');
  const jobs=readdirSync(state).filter(f=>/^pending-.*\.json$/.test(f));
  for(const job of jobs){const {file}=JSON.parse(readFileSync(join(state,job),'utf8'));
   if(!/^docs\/备忘录\/[A-Za-z0-9-]+\.md$/.test(file))throw Error('无效备忘录路径');
   if(git(['status','--porcelain','--',file])){git(['add','--',file]);git(['commit','--only','-m','docs: 保存聊天备忘录','--',file]);}
  }
  // A normal push never rewrites remote history. Pending markers remain on failure.
  if(jobs.length){git(['push','origin','HEAD:main']);for(const job of jobs)unlinkSync(join(state,job));}
  writeFileSync(join(state,'status.json'),JSON.stringify({ok:true,at:new Date().toISOString()}));
 }catch(e){writeFileSync(join(state,'status.json'),JSON.stringify({ok:false,at:new Date().toISOString(),error:e.message}));process.exitCode=1;}
 finally{closeSync(fd);unlinkSync(lock);}
}
export function saveMemo(input){
 if(resolve(input.cwd||'')!==repo||!input.transcript_path)return;
 const session=String(input.session_id||'').replace(/[^A-Za-z0-9-]/g,'');if(!session)throw Error('缺少会话编号');
 const messages=visibleMessages(readFileSync(input.transcript_path,'utf8'));if(!messages.length)return;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(messages[0].timestamp||Date.now()));
 const file=`docs/备忘录/${date}-${session}.md`;
 mkdirSync(join(repo,'docs','备忘录'),{recursive:true});writeFileSync(join(repo,file),renderMemo(messages,session),'utf8');
 mkdirSync(state,{recursive:true});writeFileSync(join(state,`pending-${session}.json`),JSON.stringify({file}));
 return file;
}
if(process.argv[1]&&resolve(process.argv[1])===script){
 if(process.argv.includes('--sync'))retrySync();
 else{
  const retry=process.argv.includes('--retry');
  if(!retry){try{saveMemo(JSON.parse(readFileSync(0,'utf8')));}catch(e){console.error('聊天备忘录未保存：'+e.message);process.exit(1);}}
  const child=spawn(process.execPath,[script,'--sync'],{cwd:repo,detached:true,windowsHide:true,stdio:'ignore'});child.on('error',e=>{mkdirSync(state,{recursive:true});writeFileSync(join(state,'status.json'),JSON.stringify({ok:false,error:e.message}));});child.unref();
 }
}
