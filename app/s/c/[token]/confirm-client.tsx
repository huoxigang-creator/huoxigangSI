'use client';
import { useEffect, useRef, useState } from 'react';
import { Building2, Check, Download, FileText, Image, Loader2, Maximize2, PenLine, RefreshCw, FileCheck2, X } from 'lucide-react';
import { KIND_LABEL, isPermanentExpiresAt } from '../../../../lib/confirm-sheet-constants';

type PublicItem = { id: string; kind: 'selection' | 'pending'; label: string; detail: string; status: string; note: string };
type PublicAttachment = { key: string; name: string; mime: string; size: number };
type PublicSheet = { title: string; customer_name: string; note: string; expires_at: string; submitted: boolean; items: PublicItem[]; attachments?: PublicAttachment[] };

const formatSize = (size: number) => size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB' : size >= 1024 ? Math.round(size / 1024) + ' KB' : size + ' B';

export default function ConfirmClient({ token }: { token: string }) {
  const [sheet, setSheet] = useState<PublicSheet | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [photoViewer, setPhotoViewer] = useState<{ src: string; name: string } | null>(null);
  const [inactive, setInactive] = useState(false);
  const [signature, setSignature] = useState('');
  const [signError, setSignError] = useState('');
  const [fullscreenSigning, setFullscreenSigning] = useState(false);
  const [working, setWorking] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [successTime, setSuccessTime] = useState('');
  const fullCanvasRef = useRef<HTMLCanvasElement>(null);
  const fullDrawing = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/shared-confirm?token=' + encodeURIComponent(token), { cache: 'no-store', signal: controller.signal });
        if (response.status === 404 || response.status === 410) {
          setInactive(true); setError('此确认单链接已失效，请联系商家获取新的链接。'); return;
        }
        const data = await response.json() as { ok?: boolean; result?: PublicSheet; error?: string };
        if (!response.ok || !data.ok || !data.result) throw Error(data.error || '确认单暂时无法读取。');
        setSheet(data.result);
      } catch {
        if (!controller.signal.aborted) setError('确认单暂时无法读取，请稍后重试或联系商家。');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!fullscreenSigning || !fullCanvasRef.current || !signature) return;
    const canvas = fullCanvasRef.current;
    const img = new window.Image();
    img.onload = () => {
      const context = canvas.getContext('2d');
      if (context) context.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = signature;
  }, [fullscreenSigning, signature]);

  function openFullscreenSign() {
    setSignError('');
    setFullscreenSigning(true);
    try {
      const orientation = (screen as { orientation?: { lock?: (mode: string) => Promise<void> } }).orientation;
      orientation?.lock?.('landscape').catch(() => { /* iOS Safari 不支持时忽略 */ });
    } catch { /* 忽略 */ }
  }

  function fullPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = fullCanvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext('2d'); if (!context) return;
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);
    if (event.type === 'pointerdown') {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      fullDrawing.current = true;
      context.beginPath(); context.moveTo(x, y); context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = '#1e334b';
    } else if (event.type === 'pointermove' && fullDrawing.current) {
      context.lineTo(x, y); context.stroke();
    } else if (event.type === 'pointerup' || event.type === 'pointerleave') {
      if (!fullDrawing.current) return;
      fullDrawing.current = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* 忽略 */ }
    }
  }

  function clearFullSignature() {
    const canvas = fullCanvasRef.current;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function confirmFullSignature() {
    const canvas = fullCanvasRef.current;
    if (!canvas) { setFullscreenSigning(false); return; }
    const context = canvas.getContext('2d');
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels || !pixels.some((value, index) => index % 4 === 3 && value > 0)) { setSignError('请先在画布上完成签名'); return; }
    setSignature(canvas.toDataURL('image/png'));
    setSignError('');
    setFullscreenSigning(false);
  }

  async function submit() {
    if (!sheet || !signature) return;
    setWorking(true); setError('');
    try {
      const response = await fetch('/api/shared-confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signature_data_url: signature,
          items: sheet.items.map(item => ({ id: item.id, status: 'confirmed', note: (notes[item.id] || '').trim() })),
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; submitted_at?: string };
      if (!response.ok || !body.ok) throw Error(body.error || '提交失败，请重试。');
      setSubmitted(true);
      setSuccessTime(body.submitted_at ? new Date(body.submitted_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提交失败，请重试。');
    } finally { setWorking(false); }
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '12px 14px', border: '1px solid #d9e2ec', borderRadius: 10, boxSizing: 'border-box', fontSize: 15, background: '#fff' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, color: '#51637a', marginBottom: 8, fontWeight: 500 };

  return <main style={{ minHeight: '100vh', background: '#f2f5f9', fontFamily: "Inter,'PingFang SC','Microsoft YaHei',sans-serif", color: '#1e334b' }}>
    <header style={{ background: '#1f4e85', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <Building2 size={20}/><strong style={{ fontSize: 15 }}>连云港固美格家具有限公司</strong>
    </header>
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 60px' }}>
      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#8395aa' }}><Loader2 size={26} className="cs-spin"/><p style={{ marginTop: 12 }}>正在读取确认单…</p></div>}
      {error && !sheet && <div style={{ background: '#fff', border: '1px solid #f3c0bc', color: '#b42318', borderRadius: 12, padding: 28, textAlign: 'center' }}><p role="alert">{error}</p><p style={{ marginTop: 12, fontSize: 13, color: '#8395aa' }}>{inactive ? '' : '如果一直无法打开，请把链接发给商家重新生成。'}</p></div>}
      {sheet && !submitted && <div>
        <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 6px 20px #122a4410' }}>
          <span style={{ display: 'inline-block', fontSize: 12, background: '#e8f0fa', color: '#2a63a0', borderRadius: 5, padding: '4px 9px' }}>确认单</span>
          <h1 style={{ fontSize: 21, margin: '12px 0 6px', letterSpacing: -.3 }}>{sheet.title}</h1>
          <p style={{ fontSize: 13, color: '#68788f', margin: 0 }}>{sheet.customer_name ? <>客户：<b>{sheet.customer_name}</b>　</> : null}{isPermanentExpiresAt(sheet.expires_at) ? '永久有效' : '有效期至 ' + new Date(sheet.expires_at).toLocaleDateString('zh-CN')}</p>
          {sheet.note && <p style={{ fontSize: 14, color: '#3d546f', background: '#f7fafd', borderRadius: 9, padding: 12, margin: '14px 0 0', lineHeight: 1.7 }}>{sheet.note}</p>}
        </div>

        <h2 style={{ fontSize: 16, margin: '26px 2px 12px', display: 'flex', alignItems: 'center', gap: 8 }}><FileCheck2 size={18} color="#2a63a0"/>请逐项查看确认内容</h2>
        {sheet.items.map(item => (
          <div key={item.id} style={{ background: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, boxShadow: '0 4px 14px #122a4408', border: '1px solid #e1e8f1' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, background: item.kind === 'selection' ? '#e8f6ef' : '#fff3e0', color: item.kind === 'selection' ? '#1e7d4f' : '#a35c14', borderRadius: 5, padding: '3px 8px' }}>{KIND_LABEL[item.kind]}</span>
              <strong style={{ fontSize: 15 }}>{item.label}</strong>
            </div>
            {item.detail && <p style={{ fontSize: 13, color: '#68788f', margin: '8px 0 0', lineHeight: 1.6 }}>{item.detail}</p>}
            <input value={notes[item.id] || ''} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} placeholder="补充意见（可选）" maxLength={200}
              style={{ ...inputStyle, marginTop: 10, fontSize: 13, padding: '9px 12px' }}/>
          </div>
        ))}
        {sheet.attachments && sheet.attachments.length > 0 && <div style={{ background: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, boxShadow: '0 4px 14px #122a4408', border: '1px solid #e1e8f1' }}>
          <p style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: '#3d546f', display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={15} color="#2a63a0"/>确认事项附件（{sheet.attachments.length}）</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {sheet.attachments.map(item => {
              const downloadUrl = '/api/shared-confirm?token=' + encodeURIComponent(token) + '&attachment=' + encodeURIComponent(item.key);
              return item.mime.startsWith('image/')
                ? <div key={item.key} style={{ display: 'grid', gap: 6, textDecoration: 'none', color: '#1e334b', border: '1px solid #e1e8f1', borderRadius: 10, padding: 8, background: '#fafcff' }}><span style={{ position: 'relative', display: 'block' }}><img src={downloadUrl} alt={item.name} style={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 7, background: '#fff', display: 'block' }}/><button type="button" aria-label={'放大图片 ' + item.name} title="放大查看" onClick={() => setPhotoViewer({ src: downloadUrl, name: item.name })} style={{ position: 'absolute', right: 6, bottom: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', borderRadius: 6, background: 'rgba(15,23,42,.72)', color: '#fff', cursor: 'pointer' }}><Maximize2 size={14}/></button></span><span style={{ fontSize: 12, color: '#51637a', display: 'flex', alignItems: 'center', gap: 5 }}><Image size={13}/>{item.name} <span style={{ marginLeft: 'auto', color: '#8395aa' }}>{formatSize(item.size)}</span></span></div>
                : <a key={item.key} href={downloadUrl} download title={item.name} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: '#1e334b', border: '1px solid #e1e8f1', borderRadius: 10, padding: 11, background: '#fafcff', fontSize: 13 }}><FileText size={16} color="#2a63a0"/><span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span><span style={{ color: '#8395aa', fontSize: 12 }}>{formatSize(item.size)}</span><span style={{ color: '#2a63a0', fontSize: 12 }}>下载</span></a>;
            })}
          </div>
        </div>}

        <div style={{ background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 6px 20px #122a4410', marginTop: 18 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}><PenLine size={18} color="#2a63a0"/>签字确认</h2>
          <p style={labelStyle}>手写签名（点击下方签名框，横屏全屏书写）</p>
          <button type="button" onClick={openFullscreenSign} style={{ width: '100%', border: '1px solid ' + (signature ? '#9fd8b7' : '#d9e2ec'), borderRadius: 12, background: signature ? '#f0faf4' : '#fafcff', padding: 0, overflow: 'hidden', cursor: 'pointer' }}>
            {signature
              ? <img src={signature} alt="客户签名" style={{ width: '100%', maxHeight: 140, objectFit: 'contain', display: 'block', background: '#fff' }}/>
              : <span style={{ display: 'grid', placeItems: 'center', height: 90, color: '#8395aa', fontSize: 14, gap: 6 }}><PenLine size={22}/>点击此处签名</span>}
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 12, color: '#8395aa' }}>{signature ? <><Check size={13} color="#1e7d4f"/> 已签名，提交即生效</> : '请点击上方签名框，横屏手写签名'}</span>
            {signature && <button type="button" onClick={openFullscreenSign} style={{ fontSize: 12, color: '#51637a', background: 'none', border: '1px solid #d9e2ec', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}><RefreshCw size={13}/>清除重签</button>}
          </div>
          {error && <p role="alert" style={{ color: '#b42318', fontSize: 13, marginTop: 12 }}>{error}</p>}
          <button type="button" disabled={working || !signature} onClick={() => void submit()}
            style={{ width: '100%', marginTop: 16, padding: '14px 0', borderRadius: 11, border: '0', background: '#245c9c', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: working || !signature ? .55 : 1 }}>
            {working ? <><Loader2 size={18} className="cs-spin"/>提交中…</> : <><PenLine size={18}/>确认提交</>}
          </button>
        </div>
      </div>}

      {sheet && submitted && <div style={{ background: '#fff', borderRadius: 14, padding: 34, textAlign: 'center', boxShadow: '0 6px 20px #122a4410' }}>
        <div style={{ width: 54, height: 54, borderRadius: '50%', background: '#e8f6ef', color: '#1e7d4f', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}><Check size={28}/></div>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>已提交，感谢您的确认！</h1>
        <p style={{ fontSize: 13, color: '#68788f', lineHeight: 1.8, margin: 0 }}>您对「{sheet.title}」的确认意见和签名已回传固美格。<br/>提交时间：{successTime}。如有调整需求，可直接与您的服务人员联系。</p>
        <a href={'/api/shared-confirm?token=' + encodeURIComponent(token) + '&format=pdf'} download style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 18, padding: '12px 20px', borderRadius: 11, background: '#245c9c', color: '#fff', fontSize: 15, fontWeight: 600, textDecoration: 'none' }}><Download size={17}/>下载报价单（含签名）</a>
        <p style={{ fontSize: 12, color: '#8395aa', margin: '10px 0 0' }}>PDF 含本次确认事项与您的签名，可自行保存。</p>
      </div>}
    </div>

    {fullscreenSigning && <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
        <strong style={{ fontSize: 15 }}>手写签名</strong>
        <button type="button" onClick={() => setFullscreenSigning(false)} style={{ background: 'none', border: '0', fontSize: 13, color: '#51637a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><X size={15}/>取消</button>
      </div>
      <p style={{ textAlign: 'center', fontSize: 13, color: '#8395aa', margin: '10px 0 0' }}>建议横屏书写，请在下方空白处签名</p>
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 16, minHeight: 0 }}>
        <canvas ref={fullCanvasRef} width={980} height={440} style={{ width: '100%', maxWidth: 860, aspectRatio: '49/22', background: '#fff', borderRadius: 14, boxShadow: '0 8px 24px #122a4418', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={fullPointer} onPointerMove={fullPointer} onPointerUp={fullPointer} onPointerLeave={fullPointer}/>
      </div>
      {signError && <p role="alert" style={{ textAlign: 'center', color: '#b42318', fontSize: 13, margin: '0 16px 10px' }}>{signError}</p>}
      <div style={{ padding: '14px 16px 20px', display: 'flex', gap: 10, background: '#fff', borderTop: '1px solid #e2e8f0' }}>
        <button type="button" onClick={clearFullSignature} style={{ padding: '13px 0', borderRadius: 11, border: '1px solid #d9e2ec', background: '#fff', color: '#51637a', fontSize: 14, cursor: 'pointer', width: '32%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><RefreshCw size={15}/>清除重签</button>
        <button type="button" onClick={confirmFullSignature} style={{ flex: 1, padding: '13px 0', borderRadius: 11, border: '0', background: '#245c9c', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Check size={17}/>确定使用此签名</button>
      </div>
    </div>}
    {photoViewer && <div role="dialog" aria-modal="true" aria-label="放大查看图片" onClick={e => { if (e.target === e.currentTarget) setPhotoViewer(null); }} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 }}><img src={photoViewer.src} alt={photoViewer.name} onClick={() => setPhotoViewer(null)} style={{ maxWidth: '94vw', maxHeight: '78vh', objectFit: 'contain', borderRadius: 10, background: '#fff', cursor: 'zoom-out' }}/><span style={{ color: '#e2e8f0', fontSize: 13 }}>{photoViewer.name}</span><button type="button" aria-label="关闭放大图片" onClick={() => setPhotoViewer(null)} style={{ position: 'fixed', top: 16, right: 20, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,.15)', color: '#fff', cursor: 'pointer' }}><X size={20}/></button></div>}
    <style>{`.cs-spin{animation:cs-rotate 1s linear infinite}@keyframes cs-rotate{to{transform:rotate(360deg)}}`}</style>
  </main>;
}
