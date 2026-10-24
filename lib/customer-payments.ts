import { randomBytes, randomUUID, createHash } from 'node:crypto';
import {validatePaymentCodeImage} from './payment-codes';

export class CustomerPaymentError extends Error { constructor(message:string,public status=400){super(message);} }
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function createCustomerPayments(db:any,codes:any,execute:(owner:string,action:string,args:any)=>Promise<any>){
  // Lazy migration: importing this module never opens or writes a database.
  function init(){db.exec('CREATE TABLE IF NOT EXISTS customer_payment_requests (id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL)');}
  function project(owner:string,id:string){const row=db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='project'").get(id,owner);if(!row||JSON.parse(row.data).deleted)throw new CustomerPaymentError('客户或项目不存在',404);return JSON.parse(row.data);}
  function read(row:any){if(!row)throw new CustomerPaymentError('付款单不存在或链接无效',404);project(row.owner,row.project);const value=JSON.parse(row.data);if(value.scope_project_id)project(row.owner,value.scope_project_id);return {...row,value};}
  function validReceipt(row:any){const r=db.prepare("SELECT project,data FROM records WHERE id=? AND owner=? AND kind='transaction'").get(row.value.transaction_id||'',row.owner);if(!r)return false;const d=JSON.parse(r.data);return r.project===row.project&&d.type==='收款'&&d.amount===row.value.amount&&!d.void&&!d.deleted;}
  function safe(row:any){const d=row.value;return {id:row.id,project_id:row.project,project_name:d.project_name||d.customer,address:d.address??project(row.owner,row.project).address??'',title:d.title,customer:d.customer,amount:d.amount,channel:d.channel,status:d.status==='paid'&&!validReceipt(row)?'needs_review':d.status,created:row.created,reported_at:d.reported_at,paid_at:d.paid_at,transaction_id:d.transaction_id,expires_at:d.expires_at};}
  function owned(owner:string,id:string){init();return read(db.prepare('SELECT * FROM customer_payment_requests WHERE id=? AND owner=?').get(id,owner));}
  function shared(token:string){init();if(!/^[a-f0-9]{64}$/.test(token))throw new CustomerPaymentError('付款链接无效',404);const row=read(db.prepare('SELECT * FROM customer_payment_requests WHERE token_hash=?').get(hash(token)));if(Date.parse(row.value.expires_at)<Date.now()&&row.value.status!=='paid')throw new CustomerPaymentError('付款链接已到期，请联系商家重新生成',410);return row;}
  return {
    list(owner:string,id:string){init();project(owner,id);return db.prepare('SELECT * FROM customer_payment_requests WHERE owner=? ORDER BY created DESC').all(owner).filter((row:any)=>row.project===id||JSON.parse(row.data).scope_project_id===id).filter((row:any)=>{try{read(row);return true;}catch{return false;}}).map((row:any)=>({...safe(read(row)),token:JSON.parse(row.data).token}));},
    async create(owner:string,args:any){init();const p=project(owner,args.project_id),scopeId=args.scope_project_id||args.project_id,scope=project(owner,scopeId);if(args.project_id!==scopeId&&p.parent_id!==scopeId)throw new CustomerPaymentError('收款项目不属于当前客户或合作项目');const title=typeof args.title==='string'?args.title.trim():'';
      if(!title||title.length>100||!Number.isSafeInteger(args.amount)||args.amount<=0||args.amount>10000000000||!['微信','支付宝'].includes(args.channel))throw new CustomerPaymentError('请填写付款标题、有效金额和收款方式');
      const image=await codes.image(owner,args.code_id);const token=randomBytes(32).toString('hex'),id=randomUUID(),created=new Date().toISOString();
      const data={token,title,scope_project_id:scopeId,customer:scope.name,project_name:p.name,address:p.address||scope.address||'',amount:args.amount,channel:args.channel,status:'pending',expires_at:new Date(Date.now()+7*86400000).toISOString(),image:Buffer.from(image.bytes).toString('base64'),mime:image.metadata.content_type};
      // Recheck ownership/liveness after the asynchronous image lookup.
      project(owner,args.project_id);project(owner,scopeId);
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
    cancel(owner:string,id:string,reason:unknown){
      const row=owned(owner,id);if(row.value.status!=='paid')throw new CustomerPaymentError('此付款单尚未确认到账',409);
      if(typeof reason!=='string'||!reason.trim()||reason.length>500)throw new CustomerPaymentError('请填写500字以内的撤销原因');
      const tx=db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='transaction'").get(row.value.transaction_id,owner);
      if(!tx)throw new CustomerPaymentError('找不到原到账流水，请联系管理员核对',409);
      const d=JSON.parse(tx.data);if(tx.project!==row.project||d.type!=='收款'||d.amount!==row.value.amount)throw new CustomerPaymentError('付款单与流水不一致，请联系管理员核对',409);
      const linked=db.prepare("SELECT c.id FROM records AS c,json_each(c.data,'$.receipt_allocations') AS part WHERE c.owner=? AND c.kind='contract' AND json_extract(part.value,'$.transaction_id')=? LIMIT 1").get(owner,tx.id);
      if(linked)throw new CustomerPaymentError('此收款已关联合同，请先解除分期收款关联',409);
      const next={...row.value,status:row.value.reported_at?'reported':'pending',confirmation_revision:(row.value.confirmation_revision||0)+1,cancel_reason:reason.trim()};
      delete next.transaction_id;delete next.paid_at;delete next.confirmed_date;
      const timestamp=new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');try{
        const changed=db.prepare('UPDATE customer_payment_requests SET data=? WHERE id=? AND owner=? AND data=?').run(JSON.stringify(next),id,owner,row.data);if(Number(changed.changes)!==1)throw new CustomerPaymentError('付款单已变化，请刷新后重试',409);
        const changedTx=db.prepare('UPDATE records SET data=? WHERE id=? AND owner=? AND data=?').run(JSON.stringify({...d,void:true,void_reason:'撤销付款单到账确认：'+reason.trim(),updated:timestamp}),tx.id,owner,tx.data);if(Number(changedTx.changes)!==1)throw new CustomerPaymentError('收款流水已变化，请刷新后重试',409);
        db.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').run(randomUUID(),owner,'audit',row.project,JSON.stringify({action:'cancel_customer_payment',record_id:tx.id,payment_request_id:id,reason:reason.trim()}),timestamp);
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      return safe(owned(owner,id));
    },
    async confirm(owner:string,id:string){const row=owned(owner,id);if(row.value.status==='paid'){if(!validReceipt(row))throw new CustomerPaymentError('到账记录已作废或移入回收站，请先核对并撤销原到账确认，不能重复登记',409);return safe(row);}
      if(!row.value.confirmed_date){const value={...row.value,confirmed_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())};db.prepare('UPDATE customer_payment_requests SET data=? WHERE id=? AND data=?').run(JSON.stringify(value),id,row.data);}
      const locked=owned(owner,id),paid_at=new Date().toISOString();
      const result=await execute(owner,'record_transaction',{project_id:row.project,type:'收款',amount:row.value.amount/100,category:'客户付款',date:locked.value.confirmed_date,note:'人工核实到账：'+row.value.title+'（'+row.value.channel+'）',request_id:'customer-payment-'+row.id+(row.value.confirmation_revision?'-r'+row.value.confirmation_revision:'')});
      const current=owned(owner,id);if((current.value.confirmation_revision||0)!==(locked.value.confirmation_revision||0))throw new CustomerPaymentError('付款单确认已撤销或发生变化，请刷新后重试',409);if(current.value.status==='paid')return safe(current);
      const value={...current.value,status:'paid',paid_at,transaction_id:result?.id};
      db.prepare('UPDATE customer_payment_requests SET data=? WHERE id=? AND data=?').run(JSON.stringify(value),id,current.data);return safe(owned(owner,id));
    },
  };
}
