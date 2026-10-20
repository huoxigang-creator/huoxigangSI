'use client';

import { useEffect, useState } from 'react';
import QuoteWorkspace from './quote-workspace';
import { SOFTWARE_VERSION } from '../lib/release';

type Project = { id: string; name: string; customer: string; phone?: string; address?: string; status: string; note?: string; order_date?: string; project_type?: string; parent_id?: string };
type Workspace = { projects: Project[]; quotes: any[] };
const stages = ['洽谈中', '设计中', '生产中', '安装中', '收尾中', '已完工', '已归档'];

export default function EmployeeManager() {
  const [data, setData] = useState<Workspace>({ projects: [], quotes: [] });
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<Project | null | 'new'>(null);
  const [kind, setKind] = useState<'project' | 'customer'>('project');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const project = data.projects.find(item => item.id === selected);

  async function call(action: string, args: any = {}) {
    const response = await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, args }) });
    const result = await response.json() as { error?: string; result?: any };
    if (!response.ok) throw new Error(result.error || '操作失败');
    return result.result;
  }
  async function load() {
    try { const value = await call('get_workspace'); setData(value); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '读取失败'); }
  }
  useEffect(() => { void load(); }, []);
  async function mutate(action: string, args: any) {
    setBusy(true); setError('');
    try { await call(action, args); await load(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); return false; }
    finally { setBusy(false); }
  }
  async function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const current = editing === 'new' ? null : editing;
    const input = {
      ...(current ? { id: current.id } : {}),
      name: String(form.get('name') || '').trim(),
      customer: String(form.get('customer') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      address: String(form.get('address') || '').trim(),
      status: String(form.get('status') || '洽谈中'),
      note: String(form.get('note') || '').trim(),
      order_date: String(form.get('order_date') || ''),
      project_type: current?.project_type || kind,
      ...(current?.parent_id ? { parent_id: current.parent_id } : {}),
    };
    const ok = await mutate(current ? 'update_project' : 'create_project', input);
    if (ok) setEditing(null);
  }
  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.assign('/login');
  }

  return <div style={{ minHeight: '100vh', background: '#f6f8fb', color: '#1f2937', fontFamily: 'sans-serif' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px', background: 'white', borderBottom: '1px solid #e5e7eb' }}>
      <div><strong>SI · 项目与报价</strong><small style={{ marginLeft: 12, color: '#6b7280' }}>{SOFTWARE_VERSION}</small></div>
      <button onClick={() => void signOut()}>退出登录</button>
    </header>
    <main style={{ maxWidth: 1200, margin: 'auto', padding: 24 }}>
      {error && <p role="alert" style={{ padding: 12, color: '#b42318', background: '#fff1f0' }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>项目与客户</h1>
        <div style={{ display: 'flex', gap: 8 }}><button onClick={() => void load()}>刷新</button><button onClick={() => { setKind('project'); setEditing('new'); }}>新建项目</button><button onClick={() => { setKind('customer'); setEditing('new'); }}>新建客户</button></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)', gap: 18 }}>
        <aside style={{ background: 'white', borderRadius: 12, padding: 12 }}>
          {data.projects.map(item => <button key={item.id} onClick={() => setSelected(item.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 12, marginBottom: 5, borderRadius: 8, border: item.id === selected ? '1px solid #1769aa' : '1px solid #e5e7eb', background: item.id === selected ? '#eff7ff' : 'white' }}>
            <strong>{item.name}</strong><span style={{ display: 'block', color: '#6b7280', marginTop: 4 }}>{item.customer} · {item.status}</span>
          </button>)}
        </aside>
        <section style={{ minWidth: 0, background: 'white', borderRadius: 12, padding: 18 }}>
          {!project ? <p>选择一个项目查看或编辑报价。</p> : <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><h2>{project.name}</h2><p>{project.customer} · {project.phone || '未填写电话'} · {project.address || '未填写地址'}</p></div><button onClick={() => setEditing(project)}>编辑资料</button></div>
            <QuoteWorkspace employeeMode projectId={project.id} projectName={project.name} project={project} customerMode={project.project_type === 'customer'} items={data.quotes.filter(quote => quote.project === project.id)} busy={busy} mutate={mutate} onDeleted={async () => { await load(); }} />
          </>}
        </section>
      </div>
    </main>
    {editing && <div style={{ position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 100 }}><form onSubmit={event => void saveProject(event)} style={{ width: 'min(92vw, 520px)', maxHeight: '90vh', overflow: 'auto', background: 'white', borderRadius: 12, padding: 24, display: 'grid', gap: 12 }}>
      <h2>{editing === 'new' ? kind === 'customer' ? '新建客户' : '新建项目' : '编辑项目'}</h2>
      <label>项目名称<input name="name" required maxLength={100} defaultValue={editing === 'new' ? '' : editing.name} /></label>
      <label>客户姓名<input name="customer" required maxLength={50} defaultValue={editing === 'new' ? '' : editing.customer} /></label>
      <label>联系电话<input name="phone" maxLength={30} defaultValue={editing === 'new' ? '' : editing.phone} /></label>
      <label>项目地址<input name="address" maxLength={200} defaultValue={editing === 'new' ? '' : editing.address} /></label>
      <label>阶段<select name="status" defaultValue={editing === 'new' ? '洽谈中' : editing.status}>{stages.map(stage => <option key={stage}>{stage}</option>)}</select></label>
      <label>接单日期<input name="order_date" type="date" defaultValue={editing === 'new' ? '' : editing.order_date} /></label>
      <label>备注<textarea name="note" maxLength={2000} defaultValue={editing === 'new' ? '' : editing.note} /></label>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button type="button" onClick={() => setEditing(null)}>取消</button><button type="submit" disabled={busy}>保存</button></div>
    </form></div>}
  </div>;
}
