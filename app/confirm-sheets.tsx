'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Clock, Copy, Download, FileCheck, FileText, Image, Link2, Loader2, Paperclip, Plus, QrCode, RefreshCw, ThumbsDown, ThumbsUp, Trash2, Upload, X } from 'lucide-react';
import QRCode from 'qrcode';
import { KIND_LABEL, isPermanentExpiresAt } from '../lib/confirm-sheet-constants';

type SheetRow = { id: string; project_id: string; title: string; customer_name: string; customer_phone: string; address: string; url: string; expires_at: string; created: string; revoked: boolean; expired: boolean; item_count: number; confirmed_count: number; signed: boolean; signer: { name: string; phone: string; signed_at: string } | null };
type SheetDetail = { id: string; title: string; customer_name: string; customer_phone: string; note: string; expires_at: string; created: string; revoked: boolean; items: { id: string; kind: 'selection' | 'pending'; label: string; detail: string; status: 'pending' | 'confirmed' | 'undecided' | 'disagree'; note?: string }[]; signature: { name: string; phone: string; data_url: string; signed_at: string } | null; attachments: { key: string; name: string; mime: string; size: number }[] };

const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  pending: { text: '未确认', color: '#64748b', bg: '#eef2f7' },
  confirmed: { text: '已确认', color: '#1e7d4f', bg: '#e8f6ef' },
  undecided: { text: '待定', color: '#a35c14', bg: '#fff3e0' },
  disagree: { text: '不同意', color: '#b42318', bg: '#fdecea' },
};
const permanentLabel = (value: string, fallback: string) => isPermanentExpiresAt(value) ? '永久有效' : fallback;
const formatSize = (size: number) => size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB' : size >= 1024 ? Math.round(size / 1024) + ' KB' : size + ' B';

export default function ConfirmSheets({ project, busy, adoptedQuotes = [] }: { project: { id: string; name: string; customer?: string; phone?: string; address?: string }; busy?: boolean; adoptedQuotes?: { id: string; title: string; total: number; items?: { name: string; model?: string; category?: string; quantity: number; unit: string; price: number }[] }[] }) {
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<SheetDetail | null>(null);
  const [viewUrl, setViewUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [title, setTitle] = useState('');
  const [customerName, setCustomerName] = useState(project.customer || '');
  const [customerPhone, setCustomerPhone] = useState(project.phone || '');
  const [customerAddress, setCustomerAddress] = useState(project.address || '');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<{ kind: 'selection' | 'pending'; label: string; detail: string }[]>([{ kind: 'selection', label: '', detail: '' }]);
  const [attachments, setAttachments] = useState<{ key: string; name: string; mime: string; size: number }[]>([]);
  const [selectedQuote, setSelectedQuote] = useState('');
  const [importedMessage, setImportedMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [qrTarget, setQrTarget] = useState<SheetRow | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  function startDrag(event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startY: event.clientY, origX: dragOffset.x, origY: dragOffset.y };
    const move = (moveEvent: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setDragOffset({ x: drag.origX + moveEvent.clientX - drag.startX, y: drag.origY + moveEvent.clientY - drag.startY });
    };
    const up = () => { dragRef.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
  const dragStyle: React.CSSProperties = { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` };
  const dragHandle: React.CSSProperties = { cursor: 'move', userSelect: 'none', touchAction: 'none' };

  useEffect(() => {
    if (!qrTarget) { setQrDataUrl(''); return; }
    let alive = true;
    QRCode.toDataURL(qrTarget.url, { width: 480, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#111827', light: '#ffffff' } })
      .then(url => { if (alive) setQrDataUrl(url); })
      .catch(() => { if (alive) setQrDataUrl(''); });
    return () => { alive = false; };
  }, [qrTarget]);

  function downloadQrCard() {
    if (!qrTarget || !qrDataUrl) return;
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 800, 1080);
    ctx.fillStyle = '#1769aa'; ctx.fillRect(0, 0, 800, 14);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#172033'; ctx.font = 'bold 46px "Microsoft YaHei", sans-serif';
    ctx.fillText('固美格全屋定制', 400, 100);
    ctx.fillStyle = '#64748b'; ctx.font = '26px "Microsoft YaHei", sans-serif';
    ctx.fillText('客户确定单', 400, 148);
    let cursor = 212;
    if (qrTarget.customer_name) {
      ctx.fillStyle = '#334155'; ctx.font = '28px "Microsoft YaHei", sans-serif';
      ctx.fillText('客户：' + qrTarget.customer_name, 400, cursor);
      cursor += 46;
    }
    const address = (qrTarget.address || '客户地址未填写').trim();
    const charsPerLine = 15;
    const lines = [];
    for (let offset = 0; offset < address.length; offset += charsPerLine) lines.push(address.slice(offset, offset + charsPerLine));
    ctx.fillStyle = '#1769aa'; ctx.font = 'bold 40px "Microsoft YaHei", sans-serif';
    for (let i = 0; i < lines.length; i += 1) ctx.fillText(lines[i], 400, cursor + i * 54);
    const qrTop = cursor + lines.length * 54 + 46;
    const img = new globalThis.Image();
    img.onload = () => {
      ctx.drawImage(img, 160, qrTop, 480, 480);
      ctx.fillStyle = '#475569'; ctx.font = '26px "Microsoft YaHei", sans-serif';
      ctx.fillText('固美格SI超级智能平台', 400, qrTop + 540);
      const a = document.createElement('a');
      a.download = `客户确认单-${(qrTarget.title || '确认单').replace(/[\\/:*?"<>|]/g, '_')}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = qrDataUrl;
  }

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', args: { project_id: project.id } }), cache: 'no-store' });
      const body = await response.json() as { ok?: boolean; result?: SheetRow[]; error?: string };
      if (!response.ok || !body.ok) throw Error(body.error || '读取确认单失败');
      setRows(body.result || []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取确认单失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [project.id]);

  async function save() {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', args: { project_id: project.id, title: title.trim(), customer_name: customerName.trim(), customer_phone: customerPhone.trim(), address: customerAddress.trim(), note: note.trim(), items: items.filter(item => item.label.trim()).map(item => ({ kind: item.kind, label: item.label.trim(), detail: item.detail.trim() })), attachments } }) });
      const body = await response.json() as { ok?: boolean; result?: SheetRow; error?: string };
      if (!response.ok || !body.ok) throw Error(body.error || '创建失败');
      setNotice('确认单已创建，可复制链接发给客户');
      setCreating(false);
      setAttachments([]);
      setSelectedQuote('');
      setImportedMessage('');
      setItems([{ kind: 'selection', label: '', detail: '' }]);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创建失败'); }
    finally { setSaving(false); }
  }

  async function uploadAttachment(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true); setUploadError('');
    try {
      for (const file of Array.from(files)) {
        if (file.size === 0 || file.size > 10 * 1024 * 1024) { setUploadError('每个文件不能为空且不超过 10MB，请重新选择。'); continue; }
        if (file.name.length > 240 || /[\x00-\x1f\x7f/\\]/.test(file.name)) { setUploadError('文件名不符合要求。'); continue; }
        const form = new FormData();
        form.append('project_id', project.id);
        form.append('file', file);
        const response = await fetch('/api/confirm-files', { method: 'POST', body: form });
        const body = await response.json() as { ok?: boolean; file?: { key: string; name: string; mime: string; size: number }; error?: string };
        if (!response.ok || !body.ok || !body.file) throw Error(body.error || '上传失败');
        setAttachments(current => current.some(item => item.key === body.file!.key) ? current : [...current, body.file!]);
      }
      setUploadError('');
    } catch (reason) { setUploadError(reason instanceof Error ? reason.message : '上传失败，请重试。'); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  function addFromQuote(quote: { id: string; title: string; total: number }) {
    if (items.length >= 500) { setError('每份确认单最多 500 项，请精简。'); return; }
    setItems(current => [...current, { kind: 'selection', label: quote.title, detail: '已采纳报价 · 金额 ¥' + (quote.total / 100).toFixed(2) }]);
  }

  function importQuoteItems(quoteId: string) {
    setSelectedQuote(quoteId); setImportedMessage(''); setError('');
    const quote = adoptedQuotes.find(candidate => candidate.id === quoteId);
    if (!quote) return;
    const lines = (quote.items || []).filter(item => item.name && item.name.trim());
    if (!lines.length) { setImportedMessage('该报价没有可导入的明细。'); return; }
    if (lines.length > 500) { setImportedMessage('该报价明细超过 500 条，请精简后添加。'); return; }
    const label = (value: string) => value.length > 100 ? value.slice(0, 100) : value;
    setItems(lines.map(item => ({
      kind: 'selection' as const,
      label: label(item.name.trim() + (item.model && item.model.trim() ? ' / ' + item.model.trim() : '')),
      detail: [item.category || '', `${Number(Number(item.quantity).toFixed(2))}${item.unit || ''} × ¥${Number(item.price).toFixed(2)}`].filter(Boolean).join(' · '),
    })));
    setImportedMessage(`已导入「${quote.title}」的 ${lines.length} 条报价明细，可继续增删修改后生成。`);
  }

  async function openDetail(id: string) {
    setError('');
    const row = rows.find(candidate => candidate.id === id);
    setViewUrl(row?.url || '');
    setDragOffset({ x: 0, y: 0 });
    try {
      const response = await fetch('/api/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'detail', args: { id } }) });
      const body = await response.json() as { ok?: boolean; result?: SheetDetail; error?: string };
      if (!response.ok || !body.ok) throw Error(body.error || '读取详情失败');
      setViewing(body.result || null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取详情失败'); }
  }

  async function copyUrl(url: string) {
    try {
      if (!navigator.clipboard?.writeText) throw Error();
      await navigator.clipboard.writeText(url);
      setNotice('链接已复制，可粘贴到微信发送给客户');
    } catch { setError('复制未成功，请长按链接手动复制'); }
  }

  async function revoke(id: string) {
    setError('');
    if (!window.confirm('停用后客户将无法再打开此确认单，已提交的结果仍会保留。确定停用？')) return;
    try {
      const response = await fetch('/api/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke', args: { id } }) });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw Error(body.error || '停用失败');
      setNotice('确认单已停用');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '停用失败'); }
  }

  const field: React.CSSProperties = { display: 'block', width: '100%', padding: '9px 10px', marginTop: 5, border: '1px solid #cbd5e1', borderRadius: 7, boxSizing: 'border-box' };
  const button: React.CSSProperties = { padding: '9px 14px', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', background: '#fff' };
  const primary: React.CSSProperties = { ...button, background: '#1769aa', color: '#fff', borderColor: '#1769aa' };

  return <>
    <div className="panelHead"><div><h2>客户确认单</h2><p className="sectionNote">把客户选材和待客户确定的信息打包成确认单，发微信链接给客户，客户逐项确认并手写签字，结果自动回传存档。</p></div><button type="button" className="primary" disabled={busy || loading} onClick={() => { setDragOffset({ x: 0, y: 0 }); setSelectedQuote(''); setImportedMessage(''); setCreating(true); }}><Plus size={15}/>新建确认单</button></div>

    {error && <p role="alert" className="contractError">{error}</p>}
    {notice && <p role="status" className="contractMessage">{notice}</p>}

    {loading ? <p role="status" className="loading">正在读取确认单…</p> : <div style={{ display: 'grid', gap: 10, padding: '0 23px 24px' }}>
      {rows.length === 0 && <div className="empty"><FileCheck size={26}/><h3>还没有客户确认单</h3><p>点击右上角"新建确认单"，登记客户选材和待确定事项，生成微信链接发给客户。</p></div>}
      {rows.map(row => <div key={row.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#fff', display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span><b>{row.title}</b>{row.customer_name && <span style={{ color: '#475569' }}>　客户 {row.customer_name}</span>}{row.signed && row.signer ? <span style={{ color: '#1e7d4f', marginLeft: 8 }}>✓ {row.signer.name} 已签字</span> : row.expired ? <span style={{ color: '#b45309', marginLeft: 8 }}>已过期</span> : <span style={{ color: '#b45309', marginLeft: 8 }}>待客户确认</span>}</span>
          <span style={{ fontSize: 12, color: '#64748b' }}>已确认 {row.confirmed_count}/{row.item_count} 项</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={button} onClick={() => void copyUrl(row.url)}><Copy size={14}/>复制链接</button>
          <button type="button" style={button} onClick={() => { setDragOffset({ x: 0, y: 0 }); setQrTarget(row); }}><QrCode size={14}/>二维码</button>
          <button type="button" style={button} onClick={() => void openDetail(row.id)}><RefreshCw size={14}/>查看结果</button>
          <button type="button" style={{ ...button, color: '#b42318' }} disabled={row.revoked} onClick={() => void revoke(row.id)}><Trash2 size={14}/>停用</button>
          <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>{permanentLabel(row.expires_at, '有效期至 ' + new Date(row.expires_at).toLocaleDateString('zh-CN'))}</span>
        </div>
      </div>)}
    </div>}

    {creating && <div role="presentation" onClick={() => setCreating(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0f172a88', display: 'grid', placeItems: 'center', padding: 16 }}>
      <section role="dialog" aria-modal="true" aria-label="新建客户确认单" onClick={event => event.stopPropagation()} style={{ width: 'min(100%, 680px)', maxHeight: '90vh', overflowY: 'auto', padding: 24, borderRadius: 14, background: '#fff', color: '#172033', boxShadow: '0 20px 60px #0003', ...dragStyle }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, ...dragHandle }} onMouseDown={startDrag}><h2 style={{ margin: 0 }}>新建客户确认单</h2><button type="button" style={button} onClick={() => setCreating(false)}>关闭</button></div>
        <p style={{ color: '#475569', fontSize: 13 }}>确认单发给客户后，客户在微信中逐项查看确认内容，手写签字提交，结果自动回传。</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginTop: 14 }}>
          <label style={{ gridColumn: '1 / -1' }}>确认单标题<input style={field} value={title} onChange={event => setTitle(event.target.value)} maxLength={100} placeholder="例如：选材与待确认事项（10月18日）" required/></label>
          <label>客户姓名<input style={field} value={customerName} onChange={event => setCustomerName(event.target.value)} maxLength={50} placeholder="选填，默认取自项目"/></label>
          <label>客户手机号<input style={field} value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} inputMode="numeric" maxLength={30} placeholder="选填"/></label>
          <label style={{ gridColumn: '1 / -1' }}>客户地址（会显示在二维码卡片上）<input style={field} value={customerAddress} onChange={event => setCustomerAddress(event.target.value)} maxLength={200} placeholder="例如：赣榆区青口镇金海路XX号"/></label>
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>给客户的说明<input style={field} value={note} onChange={event => setNote(event.target.value)} maxLength={2000} placeholder="例如：请在核对选材和待确认事项后逐项确认并签字，谢谢！"/></label>
        <h3 style={{ marginTop: 18 }}>确认事项</h3>
        {adoptedQuotes.length > 0 && <div style={{ border: '1px dashed #9fd8b7', borderRadius: 10, padding: 12, background: '#f8fdf9', marginTop: 10 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#1e7d4f', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><FileCheck size={14}/>已采纳报价（下拉选择导入明细）</p>
          <select aria-label="选择要发送给客户的采纳报价" value={selectedQuote} disabled={saving || busy} onChange={event => importQuoteItems(event.target.value)} style={field}>
            <option value="" disabled>请选择要发送给客户的一份采纳报价</option>
            {adoptedQuotes.map(quote => <option key={quote.id} value={quote.id}>{quote.title}（¥{(quote.total / 100).toFixed(2)}）</option>)}
          </select>
          {importedMessage && <p style={{ margin: '8px 0 0', fontSize: 12, color: importedMessage.startsWith('已导入') ? '#1e7d4f' : '#b42318' }} role="status">{importedMessage}</p>}
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#8395aa' }}>选择后自动把该报价的全部明细加入下方确认事项，可继续增删修改；有多份采纳报价时可切换选择任意一份。</p>
        </div>}
        {items.map((item, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 34px', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <input style={{ ...field, marginTop: 0 }} value={item.label} onChange={event => setItems(current => current.map((value, i) => i === index ? { ...value, label: event.target.value } : value))} maxLength={100} placeholder="确认内容，例如：柜体板材-暖白PET"/>
          <input style={{ ...field, marginTop: 0 }} value={item.detail} onChange={event => setItems(current => current.map((value, i) => i === index ? { ...value, detail: event.target.value } : value))} maxLength={200} placeholder="说明（选填），例如：主卧衣柜柜体"/>
          <button type="button" style={{ ...button, padding: '8px' }} disabled={items.length <= 1} onClick={() => setItems(current => current.filter((_, i) => i !== index))}><X size={14}/></button>
        </div>)}
        <button type="button" style={button} onClick={() => setItems(current => [...current, { kind: 'selection', label: '', detail: '' }])}><Plus size={14}/>添加事项</button>
        <div style={{ marginTop: 14, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#51637a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Paperclip size={14}/>确认事项附件（文件和图片）</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={button} disabled={uploading || busy || saving} onClick={() => fileInput.current?.click()}><Upload size={14}/>{uploading ? '正在上传…' : '上传文件和图片'}</button>
            <input ref={fileInput} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" style={{ display: 'none' }} onChange={event => void uploadAttachment(event.target.files)}/>
            <span style={{ fontSize: 12, color: '#8395aa' }}>支持图片（PNG/JPG/WebP）和 PDF、Word、Excel、TXT、ZIP，单个不超过 10MB</span>
          </div>
          {uploadError && <p role="alert" style={{ color: '#b42318', fontSize: 13, marginTop: 8 }}>{uploadError}</p>}
          {attachments.length > 0 && <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {attachments.map(item => <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              {item.mime.startsWith('image/') ? <Image size={14} color="#1769aa"/> : <FileText size={14} color="#1769aa"/>}
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name} <span style={{ color: '#94a3b8' }}>{formatSize(item.size)}</span></span>
              <button type="button" style={{ ...button, padding: '3px 8px', fontSize: 12 }} onClick={() => setAttachments(current => current.filter(row => row.key !== item.key))}><X size={13}/>移除</button>
            </div>)}
          </div>}
        </div>
        {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button type="button" style={button} onClick={() => setCreating(false)}>取消</button>
          <button type="button" style={primary} disabled={saving || !title.trim() || !items.some(item => item.label.trim())} onClick={() => void save()}>{saving ? <><Loader2 size={14} className="cs-spin"/>创建中…</> : '生成确认单链接'}</button>
        </div>
      </section>
    </div>}

    {viewing && <div role="presentation" onClick={() => setViewing(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0f172a88', display: 'grid', placeItems: 'center', padding: 16 }}>
      <section role="dialog" aria-modal="true" aria-label="确认单结果" onClick={event => event.stopPropagation()} style={{ width: 'min(100%, 640px)', maxHeight: '90vh', overflowY: 'auto', padding: 24, borderRadius: 14, background: '#fff', color: '#172033', boxShadow: '0 20px 60px #0003', ...dragStyle }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, ...dragHandle }} onMouseDown={startDrag}><h2 style={{ margin: 0 }}>{viewing.title}</h2><button type="button" style={button} onClick={() => setViewing(null)}>关闭</button></div>
        <p style={{ color: '#475569', fontSize: 13 }}>{viewing.customer_name && <>客户 {viewing.customer_name}　</>}{viewing.customer_phone && <>电话 <code>{viewing.customer_phone}</code>　</>}{permanentLabel(viewing.expires_at, '有效期至 ' + new Date(viewing.expires_at).toLocaleDateString('zh-CN'))}</p>
        {viewing.signature ? <div style={{ border: '1px solid #e2e8f0', borderRadius: 9, padding: 12, background: '#f8fafc', margin: '10px 0' }}>
          <p style={{ margin: 0 }}><b>{viewing.signature.name}</b> 于 {new Date(viewing.signature.signed_at).toLocaleString('zh-CN')} 签字确认　手机 <code>{viewing.signature.phone}</code></p>
          <img src={viewing.signature.data_url} alt="客户签名" style={{ maxWidth: 260, border: '1px dashed #cbd5e1', borderRadius: 6, marginTop: 10, background: '#fff' }}/>
        </div> : <p style={{ color: '#b45309' }}>尚未收到客户签字。</p>}
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {viewing.items.map(item => { const status = STATUS_LABEL[item.status]; return <div key={item.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, background: item.kind === 'selection' ? '#e8f6ef' : '#fff3e0', color: item.kind === 'selection' ? '#1e7d4f' : '#a35c14', borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>{KIND_LABEL[item.kind]}</span>
            <div style={{ flex: 1, minWidth: 0 }}><b>{item.label}</b>{item.detail && <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>{item.detail}</p>}{item.note && <p style={{ margin: '5px 0 0', fontSize: 12, color: '#334155' }}>客户备注：{item.note}</p>}</div>
            <span style={{ fontSize: 12, color: status.color, background: status.bg, borderRadius: 5, padding: '3px 8px', whiteSpace: 'nowrap' }}>{status.text}</span>
          </div>; })}
        </div>
        {viewing.attachments && viewing.attachments.length > 0 && <div style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#51637a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Paperclip size={14}/>附件（{viewing.attachments.length}）</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8 }}>
            {viewing.attachments.map(item => item.mime.startsWith('image/')
              ? <a key={item.key} href={'/api/confirm-files?key=' + encodeURIComponent(item.key)} target="_blank" rel="noreferrer" title={item.name} style={{ border: '1px solid #e2e8f0', borderRadius: 9, padding: 8, textAlign: 'center', textDecoration: 'none', color: '#334155', display: 'grid', gap: 6, background: '#fff' }}><img src={'/api/confirm-files?key=' + encodeURIComponent(item.key)} alt={item.name} style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 6, background: '#f1f5f9' }}/><span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span></a>
              : <a key={item.key} href={'/api/confirm-files?key=' + encodeURIComponent(item.key)} download title={item.name} style={{ border: '1px solid #e2e8f0', borderRadius: 9, padding: 10, textDecoration: 'none', color: '#334155', display: 'grid', gap: 5, background: '#fff', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><FileText size={18} color="#1769aa"/>{item.name}<span style={{ color: '#94a3b8' }}>{formatSize(item.size)}</span></a>)}
          </div>
        </div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button type="button" style={button} onClick={() => { if (viewUrl) void copyUrl(viewUrl); }}><Copy size={14}/>复制链接</button></div>
      </section>
    </div>}
    {qrTarget && <div role="presentation" onClick={() => setQrTarget(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0f172a88', display: 'grid', placeItems: 'center', padding: 16 }}>
      <section role="dialog" aria-modal="true" aria-label="确认单二维码" onClick={event => event.stopPropagation()} style={{ width: 'min(100%, 520px)', maxHeight: '94vh', overflowY: 'auto', padding: 24, borderRadius: 14, background: '#fff', color: '#172033', boxShadow: '0 20px 60px #0003', ...dragStyle }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, ...dragHandle }} onMouseDown={startDrag}><h2 style={{ margin: 0 }}>发给客户的二维码</h2><button type="button" style={button} onClick={() => setQrTarget(null)}>关闭</button></div>
        <p style={{ color: '#475569', fontSize: 13 }}>把这张卡片发给客户微信，客户长按识别二维码进入确认单。上面是客户地址，下面是二维码。</p>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, background: '#f8fafc', textAlign: 'center' }}>
          <div style={{ height: 8, borderRadius: 4, background: '#1769aa', marginBottom: 14 }}></div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>固美格全屋定制</div>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>客户确定单</div>
          <div style={{ color: '#1769aa', fontWeight: 700, fontSize: 17, marginTop: 12, lineHeight: 1.5 }}>{qrTarget.address || '客户地址未填写'}</div>
          {qrDataUrl ? <img src={qrDataUrl} alt="确认单二维码" style={{ width: 240, height: 240, margin: '14px auto 0', display: 'block', background: '#fff', padding: 8, border: '1px solid #e2e8f0', borderRadius: 8 }}/> : <div style={{ width: 240, height: 240, margin: '14px auto 0', display: 'grid', placeItems: 'center', border: '1px dashed #cbd5e1', borderRadius: 8, color: '#94a3b8', fontSize: 13 }}>二维码生成中…</div>}
          <div style={{ color: '#475569', fontSize: 12, marginTop: 10 }}>固美格SI超级智能平台</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" style={button} onClick={() => void copyUrl(qrTarget.url)}><Copy size={14}/>复制链接</button>
          <button type="button" style={{ ...primary, display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled={!qrDataUrl} onClick={downloadQrCard}><Download size={14}/>下载图片</button>
        </div>
      </section>
    </div>}
    <style>{`.cs-spin{animation:cs-rotate 1s linear infinite}@keyframes cs-rotate{to{transform:rotate(360deg)}}`}</style>
  </>;
}
