'use client';

import { useRef, useState } from 'react';
import { Images, X, Upload, Trash2, UserPlus } from 'lucide-react';

const EMPTY_FIELDS = { orderName: '', name: '', phone: '', address: '', orderDate: '', budget: '' };

// 管理端「图片识别建档」：上传客户资料截图/照片 → OCR 识别出订单名称、姓名、电话、地址等字段 →
// 管理端核对修改后直接建立客户档案。
export default function RegisterScanDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [fields, setFields] = useState<typeof EMPTY_FIELDS | null>(null);
  const [originalLines, setOriginalLines] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function recognizeFile(file: File) {
    setBusy(true); setError(''); setNotice('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/customer-ocr', { method: 'POST', body: form });
      const json: any = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '识别失败，请重试');
      const result = json.result || {};
      const recognized = { ...EMPTY_FIELDS, ...(result.fields || {}) };
      setFields(recognized);
      setOriginalLines(result.lines || []);
      setNotice('识别完成，请核对下面的字段，有误可直接修改，然后点“确认建档”。');
      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : '识别失败，请重试');
      setFields(null);
      setPreview('');
    } finally {
      setBusy(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('图片不能超过 10MB'); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setError('请选择 PNG、JPEG 或 WebP 图片'); return; }
    void recognizeFile(file);
  }

  async function createCustomer() {
    if (!fields) return;
    const name = fields.orderName.trim(), customer = fields.name.trim();
    if (!name || !customer) { setError('客户订单名称和客户姓名不能为空，请填写后重试'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_project',
          args: {
            name,
            customer,
            phone: fields.phone.trim(),
            address: fields.address.trim(),
            order_date: fields.orderDate.trim(),
            budget: Number(fields.budget) || 0,
            status: '洽谈中',
            price_type: 'sale',
            note: '',
            project_type: 'customer',
          },
        }),
      });
      const json: any = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '建档失败，请重试');
      onCreated();
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : '建档失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="图片识别建档">
        <div className="modalHead">
          <div>
            <span className="eyebrow">客户自动建档</span>
            <h2>图片识别建档</h2>
          </div>
          <button aria-label="关闭" disabled={busy} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={{ padding: '4px 20px 20px', maxWidth: 520 }}>
          <p className="sectionNote" style={{ marginTop: 0 }}>上传客户资料截图或照片（订单、名片、登记表等），系统自动识别出订单名称、姓名、电话、地址等，核对后一键建立客户档案。</p>
          {!fields && (
            <div
              style={{ border: '1.5px dashed #cbd5e1', borderRadius: 12, padding: '30px 16px', textAlign: 'center', background: '#f8fafc', cursor: 'pointer' }}
              onClick={() => fileRef.current?.click()}
              role="button"
              aria-label="选择图片"
            >
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onFileChange} />
              <Images size={34} color="#64748b" style={{ margin: '0 auto 10px' }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>点击选择图片 / 截图</div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>支持 PNG、JPEG、WebP，最大 10MB</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}><Upload size={14} /> 选择图片</button>
              </div>
              {busy && <div style={{ fontSize: 13, color: '#2563eb', marginTop: 10 }}>正在识别文字…</div>}
            </div>
          )}
          {fields && preview && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', margin: '12px 0' }}>
              <img src={preview} alt="识别原图" style={{ width: 130, height: 130, objectFit: 'contain', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>识别字段（可修改）</div>
                {(['orderName', 'name', 'phone', 'address', 'orderDate', 'budget'] as const).map(key => (
                  <label key={key} style={{ display: 'block', margin: '6px 0', fontSize: 13 }}>
                    <span style={{ display: 'inline-block', width: 88, color: '#64748b', fontWeight: 600 }}>{({ orderName: '客户订单名称', name: '客户姓名', phone: '联系电话', address: '客户地址', orderDate: '接单日期', budget: '预算成本（元）' } as const)[key]}</span>
                    <input
                      value={fields[key]}
                      disabled={busy}
                      onChange={e => setFields(current => ({ ...current!, [key]: e.target.value }))}
                      style={{ width: 'calc(100% - 96px)', padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
                    />
                  </label>
                ))}
                {originalLines.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }}>查看识别原文（{originalLines.length} 行）</summary>
                    <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginTop: 4, maxHeight: 90, overflow: 'auto', background: '#f8fafc', borderRadius: 6, padding: 6 }}>
                      {originalLines.map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )}
          {fields && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              <button type="button" disabled={busy} onClick={() => { setFields(null); setPreview(''); setNotice(''); }}><Trash2 size={14} /> 重新选图</button>
              <button type="button" className="primary" disabled={busy} onClick={() => void createCustomer()}><UserPlus size={15} /> 确认建档</button>
            </div>
          )}
          {notice && <p role="status" style={{ fontSize: 13, color: '#16a34a', margin: '10px 0 0' }}>{notice}</p>}
          {error && <p role="alert" className="sectionNote" style={{ color: '#dc2626', margin: '10px 0 0' }}>{error}</p>}
          <div style={{ marginTop: 16, fontSize: 13, color: '#6b7280', lineHeight: 1.7, background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
            <b>使用提示</b><br />
            · 识别结果只供核对参考，不会自动保存；确认建档后可在「我的客户」查看新档案。<br />
            · 识别不清时请换更清晰的截图重试，或手动补全缺失字段。
          </div>
        </div>
      </section>
    </div>
  );
}
