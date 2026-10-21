'use client';
import ManagedTable from './managed-table';
import {useCallback, useEffect, useState} from 'react';
import {RefreshCw, RotateCcw, Trash2} from 'lucide-react';
import {trashRequest} from '../lib/trash-client';
import {runBulkActions} from '../lib/bulk-actions';
import {SelectionCheckbox, SelectionToolbar, useListSelection} from './list-selection';
const labels: Record<string, string> = {project: '项目', quote: '报价', transaction: '收付款记录', task: '任务', material: '材料', purchase_order: '采购单',contract:'合同',contract_template:'合同模板',swatch:'选材花色'};
const money = (amount: number) => <span className="moneyValue">{new Intl.NumberFormat('zh-CN', {style: 'currency', currency: 'CNY'}).format(amount / 100)}</span>;
const date = (value: string) => new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'});
type TrashRow = {id: string; recordId: string; isFile: boolean; name?: string; kind?: string; parentDeleted?: boolean; paymentDeleted?: boolean; [key: string]: any};

export default function Trash({onChanged}: {onChanged: () => Promise<void>}) {
  const [data, setData] = useState<{records: any[]; files: any[]}>({records: [], files: []});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [failures, setFailures] = useState<{id: string; name: string; error: string}[]>([]);
  const load = useCallback(async () => {
    setLoading(true);
    try {const result = await trashRequest('list'); setData({records: result.records || [], files: result.files || []}); setError(''); return true;}
    catch (reason) {setError(reason instanceof Error ? reason.message : '回收站读取失败'); return false;}
    finally {setLoading(false);}
  }, []);
  useEffect(() => {void load();}, [load]);
  const rows: TrashRow[] = [...data.records.map(record => ({...record, recordId: record.id, id: 'record:' + record.id, isFile: false})), ...data.files.map(file => ({...file, recordId: file.id, id: 'file:' + file.id, isFile: true}))];
  const selectable = rows.filter(row => !row.parentDeleted && !row.paymentDeleted);
  const selection = useListSelection(selectable, 'trash');

  async function restoreSelected() {
    if (busy || loading || !selection.selectedRows.length) return;
    const selected = [...selection.selectedRows];
    if (!window.confirm(`恢复已勾选的 ${selected.length} 项？恢复会放回原位置，不会新增收付款流水。已采纳报价可能恢复为草稿，并保留当前采纳报价。`)) return;
    setBusy(true); setError(''); setMessage(''); setFailures([]);
    try {
      const result = await runBulkActions(selected, row => trashRequest(row.isFile ? 'restore_file' : 'restore_record', {id: row.recordId}));
      selection.retain(result.failedIds);
      setFailures(result.failures.map(failure => ({id: failure.id, name: failure.row.name || failure.row.recordId, error: failure.error})));
      const drafts = result.successes.filter(success => (success.result as any).restoredAsDraft).length;
      setMessage(`已恢复 ${result.successIds.length} 项${result.failedIds.length ? `，${result.failedIds.length} 项失败，已保留勾选供重试` : '。'}${drafts ? `；其中 ${drafts} 项报价恢复为草稿，当前采纳报价已保留。` : ''}`);
      if (result.successIds.length) {
        await load();
        try {await onChanged();}
        catch {setError('恢复结果已保存，页面同步失败，请刷新查看。');}
      }
    } finally {setBusy(false);}
  }

  async function purgeSelected() {
    if (busy || loading || !selection.selectedRows.length) return;
    const selected = [...selection.selectedRows];
    if (!window.confirm(`永久删除已勾选的 ${selected.length} 项？删除后不可恢复，请谨慎操作。`)) return;
    setBusy(true); setError(''); setMessage(''); setFailures([]);
    try {
      const result = await runBulkActions(selected, row => trashRequest(row.isFile ? 'purge_file' : 'purge_record', {id: row.recordId}));
      selection.retain(result.failedIds);
      setFailures(result.failures.map(failure => ({id: failure.id, name: failure.row.name || failure.row.recordId, error: failure.error})));
      setMessage(`已永久删除 ${result.successIds.length} 项${result.failedIds.length ? `，${result.failedIds.length} 项失败，已保留勾选供重试` : '。'}`);
      if (result.successIds.length) {
        await load();
        try {await onChanged();}
        catch {setError('删除结果已保存，页面同步失败，请刷新查看。');}
      }
    } finally {setBusy(false);}
  }

  return <section className="panel trashPanel">
    <div className="panelHead"><h2>回收站</h2></div>
    <SelectionToolbar selection={selection.selectedIds.length} count={rows.length} busy={busy || loading} onClear={selection.clear}>
      <button type="button" disabled={busy || loading} onClick={() => void load()}><RefreshCw size={15}/>刷新</button>
      <button type="button" className="danger" disabled={busy || loading || !selection.selectedIds.length} onClick={() => void purgeSelected()}><Trash2 size={15}/>{busy ? '正在删除…' : '删除'}</button>
      <button type="button" disabled={busy || loading || !selection.selectedIds.length} onClick={() => void restoreSelected()}><RotateCcw size={15}/>{busy ? '正在恢复…' : '恢复所选'}</button>
    </SelectionToolbar>
    <p className="sectionNote">勾选后可在「删除」永久删除（不可恢复），或在「恢复所选」放回原位置。所属项目或付款记录仍在回收站的项，请先恢复或删除其所属记录。</p>
    {error && <p role="alert" className="projectFileError">{error}</p>}
    {message && <p role="status" className="trashMessage">{message}</p>}
    {!!failures.length && <ul className="selectionFailureList" aria-label="操作失败项">{failures.map(failure => <li key={failure.id}>{failure.name}：{failure.error}</li>)}</ul>}
    {loading ? <p className="trashMessage" role="status">正在读取回收站…</p> : !rows.length ? <div className="empty"><Trash2 size={32}/><h3>回收站为空</h3></div> : <div className="tableWrap"><ManagedTable tableKey="trash/list" disabled={busy || loading}><thead><tr>
      <th className="selectionCell"><SelectionCheckbox checked={selection.allSelected} mixed={selection.partiallySelected} label="全选当前可恢复项" disabled={busy || !selectable.length} onChange={selection.toggleAll}/></th>
      <th>名称</th><th>类型</th><th>所属项目</th><th>删除时间</th>
    </tr></thead><tbody>{rows.map(item => <tr key={item.id} data-row-id={item.id} className={selection.selectedIds.includes(item.id) ? 'selectionRowSelected' : undefined}>
      <td className="selectionCell"><SelectionCheckbox checked={selection.selectedIds.includes(item.id)} label={`选择${item.name || item.recordId}`} disabled={busy || item.parentDeleted || item.paymentDeleted} onChange={() => selection.toggle(item.id)}/></td>
      <td>{item.name || item.recordId}{item.kind === 'transaction' && <small className="block muted">{money(item.amount)} · {item.note || item.category} · {item.date}</small>}{item.kind === 'purchase_order' && <small className="block muted">{money(item.total)} · {item.supplier || '未填写供应商'} · {item.date}</small>}{item.kind === 'material' && <small className="block muted">{item.code || '未填写材料编码'} · {item.model || item.unit}</small>}</td>
      <td>{item.isFile ? (item.file_type === 'payment' ? '付款单据' : '项目文件') : labels[item.kind || ''] || '记录'}</td>
      <td>{item.parentName || '—'}{item.parentDeleted ? <small className="block muted">请先恢复所属项目</small> : item.paymentDeleted && <small className="block muted">请先恢复付款记录</small>}</td><td>{date(item.deleted_at)}</td>
    </tr>)}</tbody></ManagedTable></div>}
  </section>;
}
