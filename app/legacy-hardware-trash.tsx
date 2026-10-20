'use client';

import {useCallback, useEffect, useState} from 'react';
import {ArchiveRestore, RefreshCw, Trash2} from 'lucide-react';

type Counts = {activeFiles: number; trashedFiles: number; activeCosts: number; trashedCosts: number};
type TrashFile = {key: string; name: string; type: string; created: string; removedAt: string; size: number};
type Result = {error?: string; ok?: boolean; status?: string; counts?: Counts | null; trashFiles?: TrashFile[]; errors?: string[]; conflicts?: string[]};
type Props = {project: {id: string}; onChanged?: () => void | Promise<void>};
const EMPTY: Counts = {activeFiles: 0, trashedFiles: 0, activeCosts: 0, trashedCosts: 0};

export default function LegacyHardwareTrash({project, onChanged}: Props) {
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [files, setFiles] = useState<TrashFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch('/api/legacy-hardware?' + new URLSearchParams({project_id: project.id}), {signal});
      const result = await response.json() as Result;
      if (!response.ok || !result.counts) throw new Error(result.error || '历史五金资料加载失败');
      if (!signal?.aborted) {setCounts(result.counts); setFiles(result.trashFiles || []); setError('');}
    } catch (reason) {if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '历史五金资料加载失败');}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [project.id]);
  useEffect(() => {
    const controller = new AbortController();
    setCounts(EMPTY); setFiles([]); setError(''); setMessage(''); setIssues([]);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function change(action: 'clear' | 'restore') {
    if (busy) return;
    setBusy(true); setError(''); setMessage(''); setIssues([]);
    try {
      const response = await fetch('/api/legacy-hardware', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({project_id: project.id, action})});
      const result = await response.json() as Result;
      if (!response.ok) throw new Error(result.error || '操作失败，请重试');
      if (result.counts) {setCounts(result.counts); setFiles(result.trashFiles || []);}
      else await load();
      setIssues([...(result.errors || []), ...(result.conflicts || [])]);
      setMessage(result.status === 'partial' ? '部分资料未完成处理，请查看下方说明并刷新核实。' : action === 'clear' ? '历史五金文件与成本数据已移至回收站。' : '历史五金资料已恢复。');
      try {await onChanged?.();} catch {setError('资料处理完成，项目概况刷新失败，请刷新项目。');}
    } catch (reason) {setError(reason instanceof Error ? reason.message : '操作失败，请重试');}
    finally {setBusy(false);}
  }
  const active = counts.activeFiles + counts.activeCosts;
  const trashed = counts.trashedFiles + counts.trashedCosts;
  if (!loading && !active && !trashed && !error && !message) return null;
  return <section className="legacyHardwareTrash" aria-label="历史五金资料回收站">
    <div className="panelHead"><h2>历史五金资料</h2><button type="button" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={15}/>刷新</button></div>
    <p className="note">清除只处理当前项目中原有的五金文件和成本明细；移至回收站后可恢复，不影响电脑本地文件和普通项目附件。</p>
    {loading ? <p role="status">正在读取历史资料…</p> : <>
      {active > 0 && <div><p>当前项目还有 {counts.activeFiles} 个历史五金文件、{counts.activeCosts} 条历史成本记录。</p><button type="button" disabled={busy} onClick={() => void change('clear')}><Trash2 size={15}/>{busy ? '处理中…' : '清除历史五金资料'}</button></div>}
      {trashed > 0 && <details open><summary>回收站：{counts.trashedFiles} 个五金文件、{counts.trashedCosts} 条成本记录</summary><p className="note">恢复会保留已有文件和当前成本；发生冲突时，历史资料继续留在回收站。恢复资料不会重新启用旧的五金功能页面。</p>{files.length > 0 && <ul>{files.map(file => <li key={file.key}>{file.name} · {file.type}</li>)}</ul>}<button type="button" disabled={busy} onClick={() => void change('restore')}><ArchiveRestore size={15}/>{busy ? '处理中…' : '恢复历史五金资料'}</button></details>}
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="projectFileError">{error}</p>}
    {issues.length > 0 && <ul role="alert">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
  </section>;
}
