'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {BellRing,Volume2,VolumeX,X} from 'lucide-react';
import {planTaskReminder,type ReminderTask} from '../lib/task-reminders';
import './task-reminders.css';

type Props={tasks:ReminderTask[];scope:string;controlsVisible?:boolean};
type BrowserWindow=Window & {webkitAudioContext?:typeof AudioContext};
const storageKey=(scope:string)=>'gugemei-task-reminders-v1:'+encodeURIComponent(scope);
function readSeen(scope:string):Set<string> {
 try{const stored=JSON.parse(localStorage.getItem(storageKey(scope))||'[]');return new Set(Array.isArray(stored)?stored.filter((key):key is string=>typeof key==='string').slice(-1000):[]);}catch{return new Set();}
}
function persistSeen(scope:string,seen:Set<string>){try{localStorage.setItem(storageKey(scope),JSON.stringify([...seen].slice(-1000)));}catch{/* Memory deduplication still works if storage is unavailable. */}}
function playChime(context:AudioContext){
 if(context.state!=='running')throw new Error('声音暂停，请点击开启声音提醒。');
 [660,880,1046].forEach((frequency,index)=>{
  const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+index*.24;
  oscillator.type='sine';oscillator.frequency.value=frequency;
  gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.13,start+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+.2);
  oscillator.connect(gain);gain.connect(context.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start(start);oscillator.stop(start+.22);
 });
}

export default function TaskReminders({tasks,scope,controlsVisible=true}:Props){
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const audio=useRef<AudioContext|null>(null),armedAt=useRef<number|null>(null),enabledRef=useRef(false),seen=useRef(new Set<string>()),tasksRef=useRef(tasks),scopeRef=useRef(scope),activeScope=useRef(''),mounted=useRef(true),lock=useRef(false);
 tasksRef.current=tasks;scopeRef.current=scope;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;enabledRef.current=false;armedAt.current=null;const current=audio.current;audio.current=null;if(current)void current.close().catch(()=>{});};},[]);
 useEffect(()=>{enabledRef.current=false;armedAt.current=null;activeScope.current=scope;seen.current=scope?readSeen(scope):new Set();setEnabled(false);setNotice('');setError('');if(audio.current?.state==='running')void audio.current.suspend().catch(()=>{});},[scope]);
 const check=useCallback(()=>{
  if(!enabledRef.current||!scopeRef.current||scopeRef.current!==activeScope.current||armedAt.current===null)return;
  const current=audio.current;
  if(!current||current.state!=='running'){enabledRef.current=false;setEnabled(false);setError('浏览器暂停了声音，请重新点击开启；恢复后会提示这段时间最新到点的任务。');return;}
  for(const key of readSeen(scopeRef.current))seen.current.add(key);
  const plan=planTaskReminder(tasksRef.current,armedAt.current,Date.now(),seen.current);
  if(!plan)return;
  try{playChime(current);for(const key of plan.keys)seen.current.add(key);persistSeen(scopeRef.current,seen.current);setNotice('到点提醒：'+plan.latest.title+(plan.additional?'（另有 '+plan.additional+' 项任务到点）':''));setError('');}
  catch(reason){enabledRef.current=false;setEnabled(false);setError(reason instanceof Error?reason.message:'声音播放失败，请重新开启。');}
 },[]);
 useEffect(()=>{const timer=window.setInterval(check,5000);const wake=()=>{if(!document.hidden)check();};document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);};},[check]);
 useEffect(()=>{check();},[tasks,check]);
 async function unlock(){
  const Constructor=window.AudioContext||(window as BrowserWindow).webkitAudioContext;
  if(!Constructor)throw new Error('当前浏览器不支持声音提醒，请使用 Chrome 或 Edge。');
  if(!audio.current||audio.current.state==='closed')audio.current=new Constructor();
  const current=audio.current;await current.resume();
  if(current.state!=='running')throw new Error('未能开启声音，请再点击一次。');
  return current;
 }
 async function enable(){
  if(!scope||lock.current)return;
  if(enabledRef.current){enabledRef.current=false;armedAt.current=null;setEnabled(false);setError('');if(audio.current?.state==='running')void audio.current.suspend().catch(()=>{});return;}
  lock.current=true;setBusy(true);setError('');const currentScope=scope;
  try{await unlock();if(!mounted.current||scopeRef.current!==currentScope)return;armedAt.current??=Date.now();seen.current=readSeen(currentScope);enabledRef.current=true;setEnabled(true);check();}
  catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'声音开启失败，请重试。');}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 async function testSound(){
  if(!scope||lock.current)return;
  lock.current=true;setBusy(true);setError('');const currentScope=scope;
  try{const current=await unlock();if(mounted.current&&scopeRef.current===currentScope){playChime(current);setNotice('测试声音已播放，请确认电脑音量。');}}
  catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'声音测试失败。');}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 if(!controlsVisible&&!error&&!notice)return null;
 return <section className="taskReminders" aria-label="任务声音提醒">{controlsVisible&&<div className="taskReminderControls"><span className={'taskReminderStatus '+(enabled?'enabled':'')}>{enabled?<Volume2 size={15}/>:<VolumeX size={15}/>}声音提醒{enabled?'已开启':'未开启'}</span><button type="button" disabled={busy||!scope} onClick={()=>void enable()}>{busy?'请稍候…':enabled?'关闭声音提醒':'开启声音提醒'}</button><button type="button" disabled={busy||!scope} onClick={()=>void testSound()}>测试声音</button><small>网站保持打开、电脑未休眠且未静音时提醒；开启前已逾期任务不补响。</small></div>}{error&&<p className="taskReminderError" role="alert">{error}{!controlsVisible&&<button type="button" disabled={busy||!scope} onClick={()=>void enable()}>重新开启</button>}</p>}{notice&&<div className="taskReminderNotice" role="status"><BellRing size={18}/><b>{notice}</b><button type="button" aria-label="关闭到点提醒" onClick={()=>setNotice('')}><X size={16}/></button></div>}</section>;
}
