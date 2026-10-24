'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, QrCode, RefreshCw, X } from 'lucide-react';

const SOURCE_OPTIONS = [
  { value: '', label: '通用（不区分来源）' },
  { value: '抖音', label: '抖音' },
  { value: '朋友圈', label: '朋友圈' },
  { value: '门店', label: '门店' },
  { value: '老客户转介绍', label: '老客户转介绍' },
] as const;

export default function RegisterQrDialog({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState('');
  const [url, setUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async (sourceValue: string) => {
    setBusy(true); setError(''); setCopied(false); setQrDataUrl(''); setUrl('');
    try {
      const res = await fetch('/api/register-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: sourceValue }),
      });
      const json: any = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '生成失败，请稍后重试');
      const link = new URL(json.result.path, window.location.origin).toString();
      setUrl(link);
      const dataUrl = await QRCode.toDataURL(link, { width: 260, margin: 1, errorCorrectionLevel: 'M' });
      setQrDataUrl(dataUrl);
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : '生成失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void generate(''); }, [generate]);

  async function copyLink() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError('复制失败，请手动长按选择复制'); }
  }

  // 下载二维码卡片：样式与「客户签字确定」的二维码卡片统一（800x1080 白色卡片 + 顶部品牌色条 + 公司名 + 副标题 + 二维码 + 底部平台名）。
  async function downloadQrCard() {
    if (!url) return;
    setError('');
    try {
      const qr = await QRCode.toDataURL(url, { width: 480, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#111827', light: '#ffffff' } });
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法生成图片');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 800, 1080);
      ctx.fillStyle = '#1769aa'; ctx.fillRect(0, 0, 800, 14);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#172033'; ctx.font = 'bold 46px "Microsoft YaHei", sans-serif';
      ctx.fillText('固美格全屋定制', 400, 100);
      ctx.fillStyle = '#64748b'; ctx.font = '26px "Microsoft YaHei", sans-serif';
      ctx.fillText('客户扫码建档', 400, 148);
      const img = new globalThis.Image();
      img.onload = () => {
        ctx.drawImage(img, 160, 230, 480, 480);
        ctx.fillStyle = '#475569'; ctx.font = '26px "Microsoft YaHei", sans-serif';
        ctx.fillText('固美格SI超级智能平台', 400, 770);
        const a = document.createElement('a');
        a.download = `客户扫码建档${source ? '-' + source.replace(/[\\/:*?"<>|]/g, '_') : ''}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
      };
      img.src = qr;
    } catch {
      setError('下载失败，请重试');
    }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="客户扫码建档">
        <div className="modalHead">
          <div>
            <span className="eyebrow">客户自助建档</span>
            <h2>客户扫码建档二维码</h2>
          </div>
          <button aria-label="关闭" disabled={busy} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={{ padding: '4px 20px 20px', maxWidth: 460 }}>
          <p className="sectionNote" style={{ marginTop: 0 }}>把二维码发给客户，客户扫码填写姓名、电话、地址并提交，系统自动建立客户档案（同手机号自动合并，不重复建档）。</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '14px 0' }}>
            <label style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>来源渠道</label>
            <select
              value={source}
              disabled={busy}
              onChange={e => { const v = e.target.value; setSource(v); void generate(v); }}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, background: '#fff' }}
            >
              {SOURCE_OPTIONS.map(option => <option key={option.value || 'general'} value={option.value}>{option.label}</option>)}
            </select>
            <button type="button" disabled={busy} onClick={() => void generate(source)} title="重新生成二维码"><RefreshCw size={15} /> 刷新</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 0 8px' }}>
            {qrDataUrl
              ? <img src={qrDataUrl} alt="客户扫码建档二维码" style={{ width: 260, height: 260, border: '1px solid #e5e7eb', borderRadius: 12 }} />
              : <div style={{ width: 260, height: 260, borderRadius: 12, border: '1px dashed #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14 }}>{busy ? '正在生成…' : '生成失败'}</div>}
          </div>
          {url && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
              <button type="button" className="primary" disabled={busy} onClick={() => void downloadQrCard()}><Download size={15} /> 下载二维码</button>
            </div>
          )}
          {url && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input readOnly value={url} onFocus={e => e.currentTarget.select()} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, color: '#6b7280', background: '#f9fafb' }} />
              <button type="button" onClick={copyLink} style={{ whiteSpace: 'nowrap' }}>{copied ? '✓ 已复制' : <><Copy size={14} /> 复制链接</>}</button>
            </div>
          )}
          {error && <p role="status" className="sectionNote" style={{ color: '#dc2626', margin: '10px 0 0' }}>{error}</p>}
          <div style={{ marginTop: 16, fontSize: 13, color: '#6b7280', lineHeight: 1.7, background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
            <b>使用提示</b><br />
            · 不同渠道各生成一个二维码，客户扫码后自动打上来源标签，便于统计引流效果。<br />
            · 二维码长期有效；客户提交后，在「我的客户」里就能看到新档案。
          </div>
        </div>
      </section>
    </div>
  );
}
