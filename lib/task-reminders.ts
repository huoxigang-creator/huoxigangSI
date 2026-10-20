export type ReminderTask = {id:string;title:string;due_at?:string;date?:string;done?:boolean;deleted?:boolean};
export type ReminderPlan = {latest:ReminderTask;keys:string[];additional:number};
export function taskReminderKey(task:ReminderTask){return JSON.stringify([task.id,task.due_at]);}
export function taskDueMilliseconds(task:ReminderTask):number|null {
 if(typeof task.due_at!=='string')return null;
 const parts=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(task.due_at);
 if(!parts||Number(parts[2])>23||Number(parts[3])>59||Number(parts[4])>59)return null;
 const date=new Date(parts[1]+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==parts[1])return null;
 const offset=parts[5];if(offset!=='Z'&&(Number(offset.slice(1,3))>23||Number(offset.slice(4,6))>59))return null;
 const value=Date.parse(task.due_at);return Number.isFinite(value)?value:null;
}
// An explicit arming time excludes old overdue tasks. A wake-up after timer
// throttling groups all new deadlines into one sound for the latest task.
export function planTaskReminder(tasks:ReminderTask[],armedAt:number,now:number,seen:ReadonlySet<string>):ReminderPlan|null {
 if(!Number.isFinite(armedAt)||!Number.isFinite(now)||now<armedAt)return null;
 const candidates=new Map<string,{task:ReminderTask;at:number}>();
 for(const task of tasks){
  if(task.done||task.deleted)continue;
  const at=taskDueMilliseconds(task),key=taskReminderKey(task);
  if(at!==null&&at>=armedAt&&at<=now&&!seen.has(key))candidates.set(key,{task,at});
 }
 const sorted=[...candidates.entries()].sort((a,b)=>b[1].at-a[1].at||a[1].task.id.localeCompare(b[1].task.id));
 return sorted.length?{latest:sorted[0][1].task,keys:sorted.map(([key])=>key),additional:sorted.length-1}:null;
}
