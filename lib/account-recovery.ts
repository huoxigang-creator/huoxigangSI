import {randomBytes,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
export class RecoveryError extends Error{constructor(message:string,public status=400){super(message);}}
const normal=(value:string)=>value.normalize('NFKC').trim().toLowerCase();
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export function createAccountRecovery(db:any,now=Date.now){
 db.exec(`CREATE TABLE IF NOT EXISTS account_security (account_id TEXT PRIMARY KEY,question TEXT NOT NULL,answer_hash TEXT NOT NULL,salt TEXT NOT NULL,failures INTEGER NOT NULL DEFAULT 0,blocked_until INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS account_recovery_challenges (token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,purpose TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);`);
 function account(id:string){const row=db.prepare('SELECT id,username,display_name,role,active,updated FROM accounts WHERE id=?').get(id);if(!row||row.active!==1)throw new RecoveryError('账号不可用',403);return row;}
 function view(id:string){const row=db.prepare('SELECT question FROM account_security WHERE account_id=?').get(id);return {configured:!!row,question:row?.question||''};}
 return {
  view,
  set(id:string,question:unknown,answer:unknown){
   account(id);const q=typeof question==='string'?question.trim():'',a=typeof answer==='string'?normal(answer):'';
   if(q.length<4||q.length>100)throw new RecoveryError('安全问题需为4至100个字符');
   if(a.length<2||a.length>200)throw new RecoveryError('安全答案需为2至200个字符，请使用不易猜到的答案');
   const salt=randomBytes(32),hash=scryptSync(a,salt,64).toString('hex');
   db.exec('BEGIN IMMEDIATE');try{
    db.prepare('INSERT INTO account_security(account_id,question,answer_hash,salt) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET question=excluded.question,answer_hash=excluded.answer_hash,salt=excluded.salt,failures=0,blocked_until=0').run(id,q,hash,salt.toString('hex'));
    db.prepare('DELETE FROM account_recovery_challenges WHERE account_id=?').run(id);
    db.prepare('UPDATE accounts SET updated=? WHERE id=?').run(new Date(now()).toISOString(),id);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return {account:account(id),...view(id)};
  },
  challenge(id:string,purpose:'login'|'reset'){
   const a=account(id),security=db.prepare('SELECT * FROM account_security WHERE account_id=?').get(id);
   if(!security)throw new RecoveryError('请先使用原密码登录，在个人设置中设置安全问题；忘记原密码请联系服务器管理员重设',403);
   if(security.blocked_until>now())throw new RecoveryError('安全答案错误次数过多，请15分钟后再试',429);
   const token=randomBytes(32).toString('hex');
   db.prepare('DELETE FROM account_recovery_challenges WHERE expires<=? OR used=1').run(now());
   // Bind to the current account revision: password/phone changes invalidate challenges.
   db.prepare('INSERT INTO account_recovery_challenges(token_hash,account_id,purpose,expires) VALUES(?,?,?,?)').run(digest(token),id,purpose+':'+a.updated,now()+5*60000);
   return {requires_answer:true,challenge:token,question:security.question};
  },
  consume(token:unknown,answer:unknown,purpose:'login'|'reset'){
   if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new RecoveryError('验证已失效，请重新获取短信验证码',401);
   const c=db.prepare('SELECT * FROM account_recovery_challenges WHERE token_hash=?').get(digest(token));
   if(!c||c.used||c.expires<=now())throw new RecoveryError('验证已失效，请重新获取短信验证码',401);
   const a=account(c.account_id);if(c.purpose!==purpose+':'+a.updated)throw new RecoveryError('验证已失效，请重新获取短信验证码',401);
   const security=db.prepare('SELECT * FROM account_security WHERE account_id=?').get(c.account_id);
   if(!security)throw new RecoveryError('安全问题已重置，请联系管理员或使用密码登录',403);
   if(security.blocked_until>now())throw new RecoveryError('安全答案错误次数过多，请15分钟后再试',429);
   const value=typeof answer==='string'?normal(answer):'';
   const actual=value.length>=2&&value.length<=200?scryptSync(value,Buffer.from(security.salt,'hex'),64):Buffer.alloc(64);
   if(!timingSafeEqual(actual,Buffer.from(security.answer_hash,'hex'))){
    const failures=(security.blocked_until&&security.blocked_until<=now()?0:security.failures)+1;
    db.prepare('UPDATE account_security SET failures=?,blocked_until=? WHERE account_id=?').run(failures,failures>=5?now()+15*60000:0,c.account_id);
    throw new RecoveryError(failures>=5?'安全答案错误次数过多，请15分钟后再试':'安全答案不正确',failures>=5?429:401);
   }
   const changed=db.prepare('UPDATE account_recovery_challenges SET used=1 WHERE token_hash=? AND used=0 AND expires>?').run(digest(token),now());
   if(Number(changed.changes)!==1)throw new RecoveryError('验证已使用，请重新获取短信验证码',401);
   db.prepare('UPDATE account_security SET failures=0,blocked_until=0 WHERE account_id=?').run(c.account_id);
   return a;
  }
 };
}
