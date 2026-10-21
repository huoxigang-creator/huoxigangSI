'use client';
import { useEffect, useRef, useState } from 'react';
import './login.css';

type Mode = 'password' | 'sms' | 'forgot';

const field: React.CSSProperties = { display: 'block', width: '100%', padding: '10px 12px', marginTop: 6, border: '1px solid #cbd5e1', borderRadius: 8, background: '#192b42', color:'#fff', fontSize: 15, boxSizing: 'border-box' };
const primary: React.CSSProperties = { width: '100%', padding: 12, background: '#1769aa', color: 'white', border: 0, borderRadius: 8, fontSize: 15, cursor: 'pointer' };
const link: React.CSSProperties = { border: 0, background: 'none', color: '#b9dcff', cursor: 'pointer', fontSize: 14, padding: 0 };

export default function Login() {
  const [mode, setMode] = useState<Mode>('password');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [countdown, setCountdown] = useState(0);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (countdownTimer.current) clearInterval(countdownTimer.current); }, []);

  function startCountdown() {
    setCountdown(60);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = setInterval(() => {
      setCountdown(value => {
        if (value <= 1 && countdownTimer.current) { clearInterval(countdownTimer.current); countdownTimer.current = null; }
        return value <= 1 ? 0 : value - 1;
      });
    }, 1000);
  }

  function post(path: string, body: unknown) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  async function readError(response: Response): Promise<string> {
    try { const result = await response.json() as { error?: string }; return result.error || '操作失败'; }
    catch { return '操作失败'; }
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await post('/api/auth/login', { username: form.get('username'), password: form.get('password') });
      if (!response.ok) { setError(await readError(response)); setBusy(false); return; }
      const returnTo = new URLSearchParams(location.search).get('return_to');
      location.assign(returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/');
    } catch { setError('网络错误，请重试'); setBusy(false); }
  }

  async function sendCode(purpose: 'login' | 'reset') {
    if (busy) return;
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) { setError('请输入正确的手机号'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await post('/api/auth/sms/send', { phone: phone.trim(), purpose });
      if (!response.ok) { setError(await readError(response)); return; }
      setNotice('验证码已发送，5 分钟内有效');
      startCountdown();
    } catch { setError('网络错误，请重试'); }
    finally { setBusy(false); }
  }

  async function submitSms(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await post('/api/auth/sms/login', { phone: phone.trim(), code: smsCode.trim() });
      if (!response.ok) { setError(await readError(response)); setBusy(false); return; }
      location.assign('/');
    } catch { setError('网络错误，请重试'); setBusy(false); }
  }

  async function submitForgot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await post('/api/auth/forgot', { phone: phone.trim(), code: smsCode.trim(), password: newPassword });
      if (!response.ok) { setError(await readError(response)); setBusy(false); return; }
      setNotice('密码已重置，请用新密码登录');
      setMode('password'); setPhone(''); setSmsCode(''); setNewPassword('');
    } catch { setError('网络错误，请重试'); setBusy(false); }
  }

  const switchTo = (next: Mode) => { setMode(next); setError(''); setNotice(''); };

  return <main className="loginPage"><img className="loginScene" src="/login-bg.jpg" alt=""/><section className="loginPosition"><header className="loginBrand"><h1>SI超级智能平台</h1></header><form className="loginCard" onSubmit={mode === 'password' ? submitPassword : mode === 'sms' ? submitSms : submitForgot}><h2>{mode === 'forgot' ? '重置登录密码' : mode === 'sms' ? '短信验证码登录' : '账号密码登录'}</h2>
      {mode !== 'forgot' && <label style={{ display: 'block', marginBottom: 16 }}>账号{/* 密码模式保留账号输入；短信模式为手机号 */}
        {mode === 'password'
          ? <input name="username" autoComplete="username" required style={field} placeholder="输入账号" />
          : <input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" inputMode="numeric" required style={field} placeholder="输入已绑定手机号" />}
      </label>}

      {mode === 'forgot' && <label style={{ display: 'block', marginBottom: 16 }}>已绑定手机号<input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" inputMode="numeric" required style={field} placeholder="输入账号绑定的手机号" /></label>}

      {mode === 'password' && <label style={{ display: 'block', marginBottom: 20 }}>密码<input name="password" type="password" autoComplete="current-password" required style={field} placeholder="输入密码" /></label>}

      {(mode === 'sms' || mode === 'forgot') && <label style={{ display: 'block', marginBottom: 16 }}>验证码
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input value={smsCode} onChange={event => setSmsCode(event.target.value)} inputMode="numeric" maxLength={6} required style={{ ...field, flex: 1 }} placeholder="6 位验证码" />
          <button type="button" disabled={busy || countdown > 0} onClick={() => void sendCode(mode === 'sms' ? 'login' : 'reset')} style={{ ...primary, width: 'auto', minWidth: 118, padding: '10px 12px', background: countdown > 0 ? '#94a3b8' : '#1769aa' }}>{countdown > 0 ? `${countdown} 秒后重发` : '获取验证码'}</button>
        </div>
      </label>}

      {mode === 'forgot' && <label style={{ display: 'block', marginBottom: 20 }}>新密码<input value={newPassword} onChange={event => setNewPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} required style={field} placeholder="至少 12 位" /></label>}

      {error && <p role="alert" style={{ color: '#b42318', margin: '0 0 12px', fontSize: 14 }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#166534', margin: '0 0 12px', fontSize: 14 }}>{notice}</p>}

      <button disabled={busy} type="submit" style={{ ...primary, opacity: busy ? 0.7 : 1 }}>{busy ? '请稍候…' : mode === 'forgot' ? '重置密码' : mode === 'sms' ? '登录' : '登录'}</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, gap: 8 }}>
        {mode === 'password'
          ? <>
            <button type="button" style={link} onClick={() => switchTo('sms')}>短信验证码登录</button>
            <button type="button" style={link} onClick={() => switchTo('forgot')}>忘记密码</button>
          </>
          : <button type="button" style={link} onClick={() => switchTo('password')}>← 返回账号密码登录</button>}
      </div>
    </form></section>
    <footer className="loginFooter"><p>©2020连云港固美格家具有限公司 版权所有 | <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">苏ICP备2026079938号-1</a></p><p className="loginOperations">数字化运营中心</p></footer>
  </main>;
}
