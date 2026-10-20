import { randomBytes, randomUUID, createHash } from 'node:crypto';
import {validatePaymentCodeImage} from './payment-codes';

export class CustomerPaymentError extends Error { constructor(message:string,public status=400){super(message);} }
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function createCustomerPayments(db:any,codes:any,execute:(owner:string,action:string,args:any)=>Promise<any>){
  // Lazy migration: importing this module never opens or writes a database.
  function init(){db.exec('CREATE TABLE IF NOT EXISTS customer_payment_requests (id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL)');}
  function project(owner:string,id:string){const row=db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='project'").get(id,owner);if(!row||JSON.parse(row.data).deleted)throw new CustomerPaymentError('客户或项目不存在',404);return JSON.parse(row.data);}
  function read(row:any){if(!row)throw new CustomerPaymentError('付款单不存在或链接无效',404);project(row.owner,row.project);return {...row,value:JSON.parse(row.data)};}
  function safe(row:any){const d=row.value;return {id:row.id,project_id:row.project,title:d.title,customer:d.customer,amount:d.amount,channel:d.channel,status:d.status,created:row.created,reported_at:d.reported_at,paid_at:d.paid_at,transaction_id:d.transaction_id,expires_at:d.expires_at};}
  function owned(owner:string,id:string){init();return read(db.prepare('SELECT * FROM customer_payment_requests WHERE id=? AND owner=?').get(id,owner));}
  function shared(token:string){init();if(!/^[a-f0-9]{64}$/.test(token))throw new CustomerPaymentError('付款链接无效',404);const row=read(db.prepare('SELECT * FROM customer_payment_requests WHERE token_hash=?').get(hash(token)));if(Date.parse(row.value.expires_at)<Date.now()&&row.value.status!=='paid')throw new CustomerPaymentError('付款链接已到期，请联系商家重新生成',410);return row;}
  return {
    list(owner:string,id:string){init();project(owner,id);return db.prepare('SELECT * FROM customer_payment_requests WHERE owner=? AND project=? ORDER BY created DESC').all(owner,id).map((row:any)=>({...safe(read(row)),token:JSON.parse(row.data).token}));},
    async create(owner:string,args:any){init();const p=project(owner,args.project_id);const title=typeof args.title==='string'?args.title.trim():'';
      if(!title||title.length>100||!Number.isSafeInteger(args.amount)||args.amount<=0||args.amount>10000000000||!['微信','支付宝'].includes(args.channel))throw new CustomerPaymentError('请填写付款标题、有效金额和收款方式');
      const image=await codes.image(owner,args.code_id);const token=randomBytes(32).toString('hex'),id=randomUUID(),created=new Date().toISOString();
      const data={token,title,customer:p.name,amount:args.amount,channel:args.channel,status:'pending',expires_at:new Date(Date.now()+7*86400000).toISOString(),image:Buffer.from(image.bytes).toString('base64'),mime:image.metadata.content_type};
      // Recheck ownership/liveness after the asynchronous image lookup.
      project(owner,args.project_id);
      db.prepare('INSERT INTO customer_payment_requests VALUES(?,?,?,?,?,?)').run(id,owner,args.project_id,hash(token),JSON.stringify(data),created);
      return {...safe({id,project:args.project_id,created,value:data}),token};
    },
    view(token:string){const row=shared(token);return {...safe(row),image:'data:'+row.value.mime+';base64,'+row.value.image};},
    proof(owner:string,id:string){const row=owned(owner,id);return {note:row.value.report_note||'',image:row.value.proof||null};},
    report(token:string,note:unknown,proof?:unknown){const row=shared(token);if(row.value.status!=='pending')return safe(row);if(typeof note!=='string'||note.trim().length>200)throw new CustomerPaymentError('付款说明最多200字');
      if(proof){if(typeof proof!=='string'||proof.length>2800000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(proof))throw new CustomerPaymentError('付款截图须为2MB以内PNG或JPG图片');const [prefix,base64]=proof.split(',');const bytes=new Uint8Array(Buffer.from(base64,'base64'));if(bytes.length>2*1024*1024)throw new CustomerPaymentError('付款截图须小于2MB');validatePaymentCodeImage(bytes,prefix.includes('png')?'image/png':'image/jpeg');}
      const value={...row.value,status:'reported',reported_at:new Date().toISOString(),report_note:note.trim(),proof:proof||null};
      db.prepare('UPDATE customer_payment_requests SET data=? WHERE id=? AND data=?').run(JSON.stringify(value),row.id,row.data);return safe(owned(row.owner,row.id));
    },
    async confirm(owner:string,id:string){const row=owned(owner,id);if(row.value.status==='paid')return safe(row);
      if(!row.value.confirmed_date){const value={...row.value,confirmed_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())};db.prepare('UPDATE customer_payment_requests SET data=? WHERE id=? AND data=?').run(JSON.stringify(value),id,row.data);}
      const locked=owned(owner,id),paid_at=new Date().toISOString();
      const result=await execute(owner,'record_transaction',{project_id:row.project,type:'收款',amount:row.value.amount/100,category:'客户付款',date:locked.value.confirmed_date,note:'人工核实到账：'+row.value.title+'（'+row.value.channel+'）',request_id:'customer-payment-'+row.id});
      const current=owned(owner,id);if(current.value.status==='paid')return safe(current);
      const value={...current.value,status:'paid',paid_at,transaction_id:result?.id};
      db.prepare('UPDATE customer_payment_requests SET data=? WHERE id=? AND data=?').run(JSON.stringify(value),id,current.data);return safe(owned(owner,id));
    },
  };
}
