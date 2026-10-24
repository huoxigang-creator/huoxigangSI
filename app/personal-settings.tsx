'use client';
import { useEffect, useState } from 'react';
import SecurityAnswerInput from './security-answer-input';

type Me = { id: string; username: string; display_name: string; role: string; phone: string | null; created?: string };

export default function PersonalSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[answerConfirm,setAnswerConfirm]=useState(''),[securityPassword,setSecurityPassword]=useState(''),[securityConfigured,setSecurityConfigured]=useState(false);
  useEffect(()=>{void fetch('/api/auth/security-question',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('读取安全问题失败');return r.json() as Promise<{question:string;configured:boolean}>;}).then(v=>{setQuestion(v.question);setSecurityConfigured(v.configured);}).catch(e=>setError(e.message));},[]);
  async function saveSecurity(){
   if(answer!==answerConfirm){setError('两次安全答案不一致');return;}
   setBusy(true);setError('');setNotice('');
   try{const r=await fetch('/api/auth/security-question',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,answer,current_password:securityPassword})});const v=await r.json() as {error?:string};if(!r.ok)throw Error(v.error||'保存失败');setAnswer('');setAnswerConfirm('');setSecurityPassword('');setSecurityConfigured(true);setNotice('安全问题已保存，其他旧登录已失效');onSaved();}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        const body = await response.json() as { error?: string } & Partial<Me>;
        if (!response.ok) throw new Error(body.error || '读取个人信息失败');
        setMe(body as Me);
        setUsername(body.username || '');
        setDisplayName(body.display_name || '');
        setPhone(body.phone || '');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '读取个人信息失败');
      }
    })();
  }, []);

  async function saveProfile() {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/auth/me/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, display_name: displayName, phone: phone.trim() || null }),
      });
      const body = await response.json() as { error?: string; account?: Me };
      if (!response.ok) throw new Error(body.error || '保存失败');
      setMe(body.account || null);
      setNotice('个人资料已保存');
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    } finally { setBusy(false); }
  }

  async function savePassword() {
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPassword, password: newPassword }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || '修改失败');
      setOldPassword(''); setNewPassword(''); setConfirmPassword('');
      setNotice('密码已修改');
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '修改失败');
    } finally { setBusy(false); }
  }

  const field: React.CSSProperties = { display: 'block', width: '100%', padding: '9px 10px', marginTop: 5, border: '1px solid #cbd5e1', borderRadius: 7, boxSizing: 'border-box' };
  const button: React.CSSProperties = { padding: '9px 14px', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', background: '#fff' };

  return <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0f172a88', display: 'grid', placeItems: 'center', padding: 16 }}>
    <section role="dialog" aria-modal="true" aria-label="个人设置" onClick={event => event.stopPropagation()} style={{ width: 'min(100%, 520px)', maxHeight: '90vh', overflowY: 'auto', padding: 24, borderRadius: 14, background: '#fff', color: '#172033', boxShadow: '0 20px 60px #0003' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><h2 style={{ margin: 0 }}>个人设置</h2><button type="button" style={button} onClick={onClose}>关闭</button></div>
      <p style={{ color: '#475569' }}>修改用户名、姓名与手机号。手机号用于短信验证码登录与忘记密码。用户名修改后，登录时请使用新用户名。</p>

      {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#166534' }}>{notice}</p>}

      <h3 style={{ marginBottom: 8 }}>基本资料</h3>
      <div style={{ display: 'grid', gap: 12 }}>
        <label>用户名<input style={field} value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" required /></label>
        <label>姓名<input style={field} value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="off" required /></label>
        <label>手机号（用于短信登录）<input style={field} value={phone} onChange={event => setPhone(event.target.value)} inputMode="numeric" autoComplete="off" placeholder="填写后支持短信验证码登录" /></label>
      </div>
      <button type="button" disabled={busy} style={{ ...button, marginTop: 14, background: '#1769aa', color: '#fff', borderColor: '#1769aa' }} onClick={() => void saveProfile()}>保存资料</button>

      <h3 style={{marginTop:26}}>找回密码安全问题</h3>
      <p>{securityConfigured?'已设置安全问题，修改时需验证当前密码。':'尚未设置：请设置后再使用短信登录或短信找回密码。'}</p>
      <div style={{display:'grid',gap:12}}>
      <label>安全问题<input style={field} value={question} onChange={e=>setQuestion(e.target.value)} minLength={4} maxLength={100} placeholder="填写只有你知道答案的问题"/></label>
      <SecurityAnswerInput label="安全答案" style={field} value={answer} onChange={setAnswer} minLength={4} placeholder="支持中文，至少4个字符，避免公开信息"/>
      <SecurityAnswerInput label="再次输入答案" style={field} value={answerConfirm} onChange={setAnswerConfirm} placeholder="支持中文，请再次填写相同答案"/>
      <label>当前登录密码<input style={field} type="password" autoComplete="current-password" value={securityPassword} onChange={e=>setSecurityPassword(e.target.value)}/></label>
      </div>
      <button type="button" disabled={busy||!question||!answer||!securityPassword} style={{...button,marginTop:14}} onClick={()=>void saveSecurity()}>保存安全问题</button>
      <p style={{fontSize:12,color:'#64748b'}}>答案仅保存加盐摘要，不显示原答案。手机丢失时，短信验证码不能单独登录或重置密码；遗忘答案可由有服务器权限的管理员重设。</p>
      <h3 style={{ marginTop: 26, marginBottom: 8 }}>修改密码</h3>
      <div style={{ display: 'grid', gap: 12 }}>
        <label>当前密码<input style={field} value={oldPassword} onChange={event => setOldPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
        <label>新密码<input style={field} value={newPassword} onChange={event => setNewPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} placeholder="至少12位" required /></label>
        <label>确认新密码<input style={field} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} placeholder="再次输入新密码" required /></label>
      </div>
      <button type="button" disabled={busy} style={{ ...button, marginTop: 14, background: '#1769aa', color: '#fff', borderColor: '#1769aa' }} onClick={() => void savePassword()}>修改密码</button>
      <p style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>账号：{me ? <code>{me.username}</code> : '…'}　角色：{me ? (me.role === 'owner' ? '老板' : '员工') : ''}　创建于：{me?.created ? new Date(me.created).toLocaleDateString() : ''}</p>
    </section>
  </div>;
}
