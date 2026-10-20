'use client';

import {useCallback, useEffect, useState} from 'react';
import {Download, FileUp, RefreshCw, X, Trash2} from 'lucide-react';
import {PaymentDetailSummary} from './payment-details';
import {trashRequest} from '../lib/trash-client';
import {runBulkActions} from '../lib/bulk-actions';
import {SelectionCheckbox, SelectionToolbar, useListSelection} from './list-selection';
import {type PaymentItem} from '../lib/payment-details';
import {VOUCHER_ACCEPT, voucherSelection, uploadPaymentVoucher, type VoucherDraft} from '../lib/payment-vouchers';

export function VoucherPicker({drafts, onChange, busy = false}: {drafts: VoucherDraft[]; onChange: (drafts: VoucherDraft[]) => void; busy?: boolean}) {
  const [error, setError] = useState('');
  return <div className="voucherPicker">
    <span className="voucherLabel">付款单据</span>
    <label className="fileButton voucherChoose" role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} onKeyDown={event => {
      if (!busy && (event.key === 'Enter' || event.key === ' ')) {event.preventDefault(); event.currentTarget.querySelector('input')?.click();}
    }}><FileUp size={16}/>上传文件<input type="file" multiple accept={VOUCHER_ACCEPT} disabled={busy} aria-label="选择付款单据" style={{display: 'none'}} onChange={event => {
      setError('');
      try {onChange(voucherSelection(Array.from(event.target.files || []), drafts));} catch (reason) {setError(reason instanceof Error ? reason.message : '文件选择失败');}
      event.target.value = '';
    }}/></label>
    <p className="note">图片、PDF、Excel、Word；每个最大10MB，每次最多选择5个。</p>
    {!!drafts.length && <ul className="voucherDrafts">{drafts.map(draft => <li key={draft.id}><span>{draft.file.name}<small>{draft.uploaded ? '已上传' : '待上传'}</small></span>{!draft.uploaded && <button type="button" disabled={busy} aria-label={'移除单据 '+draft.file.name} onClick={() => onChange(drafts.filter(file => file.id !== draft.id))}><X size={14}/></button>}</li>)}</ul>}
    {error && <p role="alert" className="voucherError">{error}</p>}
  </div>;
}

type VoucherFile = {key: string; name: string; size: number; created: string};
type Payment = {type?:string;note?:string;payment_items?:PaymentItem[];id: string; project: string; category: string; date: string; amount: number; void?: boolean};
export default function PaymentVouchers({transaction, onBusyChange}: {transaction: Payment; onBusyChange?: (busy: boolean) => void}) {
  const [files, setFiles] = useState<VoucherFile[]>([]);
  const [drafts, setDrafts] = useState<VoucherDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<{id: string; name: string; error: string}[]>([]);
  const rows = files.map(file => ({...file, id: file.key}));
  const selection = useListSelection(rows, JSON.stringify([transaction.project, transaction.id]));
  const loadFiles = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({project_id: transaction.project, transaction_id: transaction.id});
      const response = await fetch('/api/payment-vouchers?' + query, {signal});
      const result = await response.json() as {error?: string; files?: VoucherFile[]};
      if (!response.ok || !result.files) throw new Error(result.error || '单据加载失败');
      if (!signal?.aborted) {setFiles(result.files); setError('');}
      return true;
    } catch (reason) {if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '单据加载失败'); return false;}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [transaction.id, transaction.project]);
  useEffect(() => {const controller = new AbortController(); setFiles([]); setDrafts([]); setError(''); setMessage(''); setFailures([]); void loadFiles(controller.signal); return () => controller.abort();}, [loadFiles]);

  async function upload() {
    if (busy || transaction.void) return;
    setBusy(true); onBusyChange?.(true); setError(''); setMessage('正在上传单据…');
    try {
      for (const draft of drafts) {
        if (draft.uploaded) continue;
        await uploadPaymentVoucher(transaction, draft);
        setDrafts(current => current.map(file => file.id === draft.id ? {...file, uploaded: true} : file));
      }
      setDrafts([]); const refreshed = await loadFiles(); setMessage(refreshed ? '付款单据已上传' : '付款单据已上传，请刷新重新加载列表。');
    } catch (reason) {setMessage(''); await loadFiles(); setError((reason instanceof Error ? reason.message : '单据上传失败') + '。已上传的单据已保留，可以重试其余文件。');}
    finally {setBusy(false); onBusyChange?.(false);}
  }
  async function removeSelected() {
    if (busy || loading || !selection.selectedRows.length) return;
    const selected = [...selection.selectedRows];
    if (!window.confirm(`删除已勾选的 ${selected.length} 个付款单据并移入回收站？单据可恢复，付款流水和金额保持不变。`)) return;
    setBusy(true); onBusyChange?.(true); setError(''); setMessage(''); setFailures([]);
    try {
      const result = await runBulkActions(selected, file => trashRequest('delete_file', {project_id: transaction.project, transaction_id: transaction.id, key: file.key, file_type: 'payment'}));
      selection.retain(result.failedIds);
      setFailures(result.failures.map(failure => ({id: failure.id, name: failure.row.name, error: failure.error})));
      const refreshed = result.successIds.length ? await loadFiles() : true;
      setMessage(`已将 ${result.successIds.length} 个单据移入回收站，可恢复。${result.failedIds.length ? `${result.failedIds.length} 个失败，已保留勾选供重试。` : ''}${refreshed ? '' : '请刷新重新加载单据列表。'}`);
    } finally {setBusy(false); onBusyChange?.(false);}
  }
  const money = (amount: number) => <span className="moneyValue">{new Intl.NumberFormat('zh-CN', {style: 'currency', currency: 'CNY'}).format(amount / 100)}</span>;
  return <div className="paymentVouchers">
    <p className="voucherPaymentInfo">{transaction.category} · {transaction.date} · {money(transaction.amount)}{transaction.void && ' · 已作废'}</p>
    <PaymentDetailSummary transaction={transaction}/>
    {!transaction.void ? <><VoucherPicker drafts={drafts} onChange={setDrafts} busy={busy}/><button type="button" className="primary" disabled={busy || !drafts.some(file => !file.uploaded)} onClick={() => void upload()}><FileUp size={16}/>{busy ? '上传中…' : '上传单据'}</button></> : <p className="note">已作废付款的单据保留，可查看和下载。</p>}
    <div className="voucherListHead"><h3>已上传单据</h3></div>
    <SelectionToolbar selection={selection.selectedIds.length} count={files.length} busy={busy || loading} onClear={selection.clear}>
      <SelectionCheckbox checked={selection.allSelected} mixed={selection.partiallySelected} label="全选当前付款单据" disabled={busy || loading || !files.length} onChange={selection.toggleAll}/>
      <button type="button" disabled={busy || loading} onClick={() => void loadFiles()}><RefreshCw size={14}/>刷新</button>
      {selection.selectedRows.length === 1 && !busy && !loading ? <a className="selectionLink" href={'/api/payment-vouchers?' + new URLSearchParams({project_id: transaction.project, transaction_id: transaction.id, key: selection.selectedRows[0].key})}><Download size={14}/>下载所选</a> : <button type="button" disabled title="勾选一个单据后可下载"><Download size={14}/>下载所选</button>}
      <button type="button" className="dangerLink" disabled={busy || loading || !selection.selectedIds.length} onClick={() => void removeSelected()}><Trash2 size={14}/>{busy ? '处理中…' : '删除所选'}</button>
    </SelectionToolbar>
    {loading ? <p role="status">正在读取付款单据…</p> : !files.length ? <p className="note">暂无付款单据</p> : <ul className="voucherFiles voucherSelectable">{rows.map(file => <li key={file.key} className={selection.selectedIds.includes(file.id) ? 'selectionRowSelected' : undefined}><SelectionCheckbox checked={selection.selectedIds.includes(file.id)} label={'选择单据 '+file.name} disabled={busy} onChange={() => selection.toggle(file.id)}/><div><b>{file.name}</b><small>{new Date(file.created).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'})} · {(file.size / 1024).toFixed(1)} KB</small></div></li>)}</ul>}
    {!!failures.length && <ul className="selectionFailureList" aria-label="单据删除失败项">{failures.map(failure => <li key={failure.id}>{failure.name}：{failure.error}</li>)}</ul>}
    {message && <p role="status" className="voucherStatus">{message}</p>}
    {error && <p role="alert" className="voucherError">{error}</p>}
  </div>;
}
