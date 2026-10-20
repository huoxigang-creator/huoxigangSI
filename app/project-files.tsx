'use client';
import ManagedTable from './managed-table';

import {useCallback, useEffect, useState} from 'react';
import {Download, FileUp, RefreshCw, Trash2} from 'lucide-react';

import {trashRequest} from '../lib/trash-client';
import {runBulkActions} from '../lib/bulk-actions';
import {SelectionCheckbox, SelectionToolbar, useListSelection} from './list-selection';

type Category = '合同' | '设计图' | '项目资料';
type ProjectFile = {key: string; name: string; category: Category; size: number; created: string};
type Props = {project: {id: string; name?: string}; category?: '合同'};
const MAX_SIZE = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg,.webp,.dwg,.dxf,.zip';
const supported = new Set(ACCEPT.split(',').map(value => value.slice(1)));
const bytes = (value: number) => value < 1024 * 1024 ? (value / 1024).toFixed(1) + ' KB' : (value / 1024 / 1024).toFixed(2) + ' MB';
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai'}).format(date);
}
async function readJSON(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as {error?: string; files?: ProjectFile[]} | null;
  if (!response.ok || !body) throw new Error(body?.error || fallback);
  return body;
}

export default function ProjectFiles({project, category}: Props) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [fileCategory, setFileCategory] = useState<Category>(category || '项目资料');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<{id: string; name: string; error: string}[]>([]);
  const rows = files.map(item => ({...item, id: item.key}));
  const selection = useListSelection(rows, JSON.stringify([project.id, category || '全部']));
  const loadFiles = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({project_id: project.id});
      if (category) params.set('category', category);
      const response = await fetch('/api/project-files?' + params, {signal});
      const body = await readJSON(response, '项目文件加载失败，请稍后重试');
      if (!signal?.aborted) {setFiles(body.files || []); setError('');}
      return true;
    } catch (error) {
      if (signal?.aborted) return false;
      setError(error instanceof Error ? error.message : '项目文件加载失败，请稍后重试');
      return false;
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [project.id, category]);

  useEffect(() => {
    const controller = new AbortController();
    setFiles([]); setFile(null); setFileCategory(category || '项目资料'); setError(''); setMessage(''); setFailures([]);
    void loadFiles(controller.signal);
    return () => controller.abort();
  }, [loadFiles, category]);

  async function upload() {
    if (!file || busy) return;
    setBusy(true); setError(''); setMessage('正在上传，请稍候…');
    try {
      const form = new FormData();
      form.set('project_id', project.id); form.set('category', category || fileCategory); form.set('file', file);
      const response = await fetch('/api/project-files', {method: 'POST', body: form});
      await readJSON(response, '文件上传失败，请稍后重试');
      setFile(null);
      const refreshed = await loadFiles();
      setMessage(refreshed ? '文件已上传并归档，历史文件已保留。' : '文件已上传并归档，请点击刷新重新加载列表。');
    } catch (error) {
      setMessage(''); setError(error instanceof Error ? error.message : '文件上传失败，请稍后重试');
    } finally {setBusy(false);}
  }

  async function removeSelected() {
    if (busy || loading || !selection.selectedRows.length) return;
    const selected = [...selection.selectedRows];
    if (!window.confirm(`删除已勾选的 ${selected.length} 个项目文件并移入回收站？文件可从回收站恢复。`)) return;
    setBusy(true); setError(''); setMessage(''); setFailures([]);
    try {
      const result = await runBulkActions(selected, item => trashRequest('delete_file', {project_id: project.id, key: item.key, file_type: 'project'}));
      selection.retain(result.failedIds);
      setFailures(result.failures.map(failure => ({id: failure.id, name: failure.row.name, error: failure.error})));
      const refreshed = result.successIds.length ? await loadFiles() : true;
      setMessage(`已将 ${result.successIds.length} 个文件移入回收站，可恢复。${result.failedIds.length ? `${result.failedIds.length} 个失败，已保留勾选供重试。` : ''}${refreshed ? '' : '请刷新重新加载文件列表。'}`);
    } finally {setBusy(false);}
  }

  function chooseFile(next: File | undefined) {
    setError(''); setMessage('');
    if (!next) return;
    if (!next.size || next.size > MAX_SIZE) {setFile(null); setError('请选择非空文件，每个文件不得超过10MB'); return;}
    if (!supported.has(next.name.split('.').pop()?.toLowerCase() || '')) {setFile(null); setError('此文件类型不支持，请选择下方说明中的文件类型'); return;}
    setFile(next);
  }

  return <div className="projectFiles">
    <div className="panelHead"><h2>{category === '合同' ? '合同附件' : '项目文件上传'}</h2></div>
    <p className="note">{category === '合同' ? '上传合同文件用于项目归档；附件归档不代表合同已签订。' : '按分类归档项目文件，每次上传保留独立文件和历史版本。'}</p>
    <div className="projectFileUpload">
      {!category && <label>文件分类 <select aria-label="文件分类" disabled={busy} value={fileCategory} onChange={event => setFileCategory(event.target.value as Category)}><option>项目资料</option><option>合同</option><option>设计图</option></select></label>}
      <label className="fileButton" role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} onKeyDown={event => {if (!busy && (event.key === 'Enter' || event.key === ' ')) {event.preventDefault(); event.currentTarget.querySelector('input')?.click();}}}><FileUp size={16}/>{file ? '重新选择文件' : '选择文件'}<input type="file" accept={ACCEPT} disabled={busy} aria-label={category === '合同' ? '选择合同文件' : '选择项目文件'} style={{display: 'none'}} onChange={event => {chooseFile(event.target.files?.[0]); event.target.value = '';}}/></label>
      <span>{file ? file.name + '（' + bytes(file.size) + '）' : '尚未选择文件'}</span>
      <button type="button" className="primary" disabled={!file || busy} onClick={() => void upload()}><FileUp size={16}/>{busy ? '上传中…' : '上传并归档'}</button>
    </div>
    <p className="note">每个文件最大10MB，支持 PDF、Excel、Word、PNG/JPG/WebP、DWG、DXF 和 ZIP。</p>
    <SelectionToolbar selection={selection.selectedIds.length} count={files.length} busy={busy || loading} onClear={selection.clear}>
      <button type="button" disabled={loading || busy} onClick={() => void loadFiles()}><RefreshCw size={15}/>刷新</button>
      {selection.selectedRows.length === 1 && !busy && !loading ? <a className="selectionLink" href={'/api/project-files?' + new URLSearchParams({project_id: project.id, key: selection.selectedRows[0].key})}><Download size={14}/>下载所选</a> : <button type="button" disabled title="勾选一个文件后可下载"><Download size={14}/>下载所选</button>}
      <button type="button" className="dangerLink" disabled={busy || loading || !selection.selectedIds.length} onClick={() => void removeSelected()}><Trash2 size={14}/>{busy ? '处理中…' : '删除所选'}</button>
    </SelectionToolbar>
    {error && <p className="projectFileError" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!!failures.length && <ul className="selectionFailureList" aria-label="文件删除失败项">{failures.map(failure => <li key={failure.id}>{failure.name}：{failure.error}</li>)}</ul>}
    {loading ? <p role="status">正在加载项目文件…</p> : !files.length ? <div className="empty"><FileUp size={32}/><h3>{error ? '文件列表暂不可用' : category === '合同' ? '暂无合同附件' : '暂无项目附件'}</h3><p>{error ? '点击刷新重试。' : '选择文件后点击“上传并归档”。'}</p></div> : <div className="tableWrap projectFileList"><ManagedTable tableKey="files/list" preferenceScope={project.id + "/" + (category || "all")} disabled={busy || loading}><thead><tr><th className="selectionCell"><SelectionCheckbox checked={selection.allSelected} mixed={selection.partiallySelected} label="全选当前项目文件" disabled={busy} onChange={selection.toggleAll}/></th><th>文件名</th><th>分类</th><th>大小</th><th>上传时间</th></tr></thead><tbody>{rows.map(item => <tr key={item.key} data-row-id={item.key} className={selection.selectedIds.includes(item.id) ? 'selectionRowSelected' : undefined}><td className="selectionCell"><SelectionCheckbox checked={selection.selectedIds.includes(item.id)} label={'选择文件 '+item.name} disabled={busy} onChange={() => selection.toggle(item.id)}/></td><td>{item.name}</td><td>{item.category}</td><td>{bytes(item.size)}</td><td>{dateLabel(item.created)}</td></tr>)}</tbody></ManagedTable></div>}
  </div>;
}
