'use client';
import { useEffect, useState } from 'react';

type Account = { id: string; username: string; display_name: string; active: number; phone: string | null };

export default function EmployeeAccounts({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [owner, setOwner] = useState<Account | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [resetId, setResetId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [phoneEditId, setPhoneEditId] = useState('');
  const [phoneEditValue, setPhoneEditValue] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    const response = await fetch('/api/admin/accounts', { cache: 'no-store' });
    const body = await response.json() as { accounts?: Account[]; owner?: Account | null; error?: string };
    if (!response.ok) throw new Error(body.error || '读取账号失败');
    setAccounts(body.accounts || []);
    if (body.owner) { setOwner(body.owner); setOwnerPhone(body.owner.phone || ''); }
  }

  useEffect(() => { void load().catch(reason => setError(reason instanceof Error ? reason.message : '读取账号失败')); }, []);

  async function change(input: Record<string, unknown>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || '保存失败');
      await load();
      setNotice(message);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
      return false;
    } finally { setBusy(false); }
  }

  const field: React.CSSProperties = { display: 'block', width: '100%', padding: '9px 10px', marginTop: 5, border: '1px solid #cbd5e1', borderRadius: 7, boxSizing: 'border-box' };
  const button: React.CSSProperties = { padding: '9px 14px', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', background: '#fff' };
  const phoneRow: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 10, alignItems: 'end' };

  return <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0f172a88', display: 'grid', placeItems: 'center', padding: 16 }}>
    <section role="dialog" aria-modal="true" aria-label="员工账号管理" onClick={event => event.stopPropagation()} style={{ width: 'min(100%, 640px)', maxHeight: '90vh', overflowY: 'auto', padding: 24, borderRadius: 14, background: '#fff', color: '#172033', boxShadow: '0 20px 60px #0003' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><h2 style={{ margin: 0 }}>员工账号管理</h2><button type="button" style={button} onClick={onClose}>关闭</button></div>
      <p>可随时新增员工账号；员工可操作项目与报价，财务仅老板可见。停用账号会立即退出其现有登录。绑定手机号并在个人设置中设置安全问题后，员工可用短信验证码和安全答案登录或重置密码。</p>

      {owner && <div style={{ border: '1px solid #e2e8f0', padding: 12, borderRadius: 9, marginBottom: 14, background: '#f8fafc' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span><b>老板账号</b>　<code>{owner.username}</code>　{owner.phone ? <span>已绑定 <code>{owner.phone}</code></span> : <span style={{ color: '#b45309' }}>未绑定手机号</span>}</span>
        </div>
        <div style={phoneRow}>
          <label style={{ flex: 1 }}>老板手机号<input style={field} value={ownerPhone} onChange={event => setOwnerPhone(event.target.value)} inputMode="numeric" placeholder="用于短信登录与忘记密码" /></label>
          <button type="button" disabled={busy} style={button} onClick={async () => { if (await change({ action: 'set_phone', id: owner.id, phone: ownerPhone.trim() || null }, '老板手机号已保存')) setPhoneEditId(''); }}>保存手机号</button>
        </div>
      </div>}

      <form onSubmit={async event => { event.preventDefault(); if (await change({ action: 'create', username, display_name: displayName, password, phone: phone.trim() || null }, '员工账号已创建')) { setUsername(''); setDisplayName(''); setPassword(''); setPhone(''); } }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
          <label>登录名<input style={field} value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" placeholder="例如 zhangsan" required /></label>
          <label>员工姓名<input style={field} value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="off" required /></label>
          <label>初始密码<input style={field} value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} placeholder="至少12位" required /></label>
          <label>手机号（可选）<input style={field} value={phone} onChange={event => setPhone(event.target.value)} inputMode="numeric" autoComplete="off" placeholder="用于短信登录" /></label>
        </div>
        <button type="submit" disabled={busy} style={{ ...button, marginTop: 14, background: '#1769aa', color: '#fff', borderColor: '#1769aa' }}>新增员工</button>
      </form>
      {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#166534' }}>{notice}</p>}
      <h3>现有员工</h3>
      {accounts.length === 0 && <p>尚无员工账号。</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {accounts.map(account => <div key={account.id} style={{ border: '1px solid #e2e8f0', padding: 12, borderRadius: 9 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span><b>{account.display_name}</b>　<code>{account.username}</code>　{account.active ? '使用中' : '已停用'}　{account.phone ? <span style={{ color: '#475569' }}>手机 <code>{account.phone}</code></span> : <span style={{ color: '#b45309' }}>未绑定手机号</span>}</span>
            <button type="button" disabled={busy} style={button} onClick={() => void change({ action: 'set_active', id: account.id, active: !account.active }, account.active ? '账号已停用' : '账号已启用')}>{account.active ? '停用' : '启用'}</button>
          </div>
          <div style={phoneRow}>
            <label style={{ flex: 1 }}>手机号<input style={field} value={phoneEditId === account.id ? phoneEditValue : account.phone || ''} onFocus={() => { setPhoneEditId(account.id); setPhoneEditValue(account.phone || ''); }} onChange={event => { setPhoneEditId(account.id); setPhoneEditValue(event.target.value); }} inputMode="numeric" autoComplete="off" placeholder="填写后支持短信登录" /></label>
            <button type="button" disabled={busy || phoneEditId !== account.id} style={button} onClick={async () => { if (await change({ action: 'set_phone', id: account.id, phone: phoneEditValue.trim() || null }, '手机号已保存')) setPhoneEditId(''); }}>保存</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'end' }}>
            <label style={{ flex: 1 }}>重设密码<input style={field} value={resetId === account.id ? resetPassword : ''} onFocus={() => { setResetId(account.id); setResetPassword(''); }} onChange={event => { setResetId(account.id); setResetPassword(event.target.value); }} type="password" autoComplete="new-password" placeholder="至少12位" /></label>
            <button type="button" disabled={busy || resetId !== account.id || resetPassword.length < 12} style={button} onClick={async () => { if (await change({ action: 'reset_password', id: account.id, password: resetPassword }, '密码已重设，原登录已失效')) { setResetId(''); setResetPassword(''); } }}>重设</button>
          </div>
        </div>)}
      </div>
    </section>
  </div>;
}
