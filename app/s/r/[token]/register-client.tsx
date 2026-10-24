'use client';

import { useEffect, useRef, useState } from 'react';

type Status = 'checking' | 'ready' | 'error' | 'submitting' | 'done';
type RecognizeState = 'idle' | 'ocr' | 'recording' | 'asr';
type OcrEngine = 'qwen' | 'ocr';

function resampleTo16k(audioBuffer: AudioBuffer): Float32Array {
  const targetRate = 16000, ratio = audioBuffer.sampleRate / targetRate;
  const outLen = Math.round(audioBuffer.length / ratio);
  const input = audioBuffer.getChannelData(0), output = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio, i0 = Math.floor(idx), i1 = Math.min(i0 + 1, input.length - 1), frac = idx - i0;
    output[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return output;
}

function encodeWav16k(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const writeString = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeString(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); writeString(8, 'WAVE');
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeString(36, 'data'); view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export default function RegisterClient({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState('');
  const [company, setCompany] = useState('');
  const [source, setSource] = useState('');
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [customerNo, setCustomerNo] = useState('');
  const [merged, setMerged] = useState(false);
  const [recognizing, setRecognizing] = useState<RecognizeState>('idle');
  const [recognizeHint, setRecognizeHint] = useState('');
  const [ocrEngine, setOcrEngine] = useState<OcrEngine>('qwen');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/register-client?token=' + encodeURIComponent(token));
        const json: any = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || '链接暂时无法使用');
        if (cancelled) return;
        setCompany(json.result.company || '');
        setSource(json.result.source || '');
        setStatus('ready');
      } catch (reason: any) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '链接暂时无法使用');
        setStatus('error');
      }
    })();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(track => track.stop()); };
  }, [token]);

  function applyFields(fields: { name?: string; phone?: string; address?: string; note?: string }) {
    if (fields.name) setCustomer(current => current || String(fields.name));
    if (fields.phone) setPhone(current => current || String(fields.phone));
    if (fields.address) setAddress(current => current || String(fields.address));
    if (fields.note) setNote(current => current || String(fields.note));
  }

  async function recognizeImage(file: File, useEngine: OcrEngine) {
    if (recognizing !== 'idle') return;
    setRecognizing('ocr'); setRecognizeHint(useEngine === 'qwen' ? '正在智能识别图片中的资料…' : '正在OCR识别图片中的资料…'); setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('engine', useEngine);
      const res = await fetch('/api/register-ocr?token=' + encodeURIComponent(token), { method: 'POST', body: form });
      const json: any = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '识别失败，请重试');
      applyFields({ name: json.result?.fields?.name, phone: json.result?.fields?.phone, address: json.result?.fields?.address });
      setRecognizeHint(useEngine === 'qwen' ? '已智能识别并自动填入，请核对修改后提交；识别不准可切换「备用OCR」重试。' : '已识别并自动填入，请核对修改后提交。');
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : '识别失败，请重试');
    } finally { setRecognizing('idle'); }
  }

  async function startRecord() {
    if (recognizing !== 'idle') return;
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = event => { if (event.data && event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); };
      recorder.start();
      setRecognizing('recording');
      setRecognizeHint('正在录音，请说出：姓名、电话、地址。说完点击「停止并识别」。');
      setTimeout(() => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); }, 58000);
    } catch {
      setError('无法使用麦克风，请允许录音权限，或改用截图识别/手动填写。');
    }
  }

  async function stopRecord() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setRecognizing('asr');
    setRecognizeHint('正在识别语音…');
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.stop();
    await stopped;
    await recognizeAudio();
  }

  async function recognizeAudio() {
    try {
      const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || 'audio/webm' });
      if (!blob.size) throw new Error('没有录到声音，请重试');
      const arrayBuffer = await blob.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) throw new Error('当前浏览器不支持录音识别，请改用截图或手动填写');
      const ctx = new AudioCtx();
      let wav: Blob;
      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        wav = encodeWav16k(resampleTo16k(audioBuffer));
      } finally { void ctx.close(); }
      const res = await fetch('/api/register-speech?token=' + encodeURIComponent(token), {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: wav,
      });
      const json: any = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '识别失败，请重试');
      applyFields({ name: json.result?.fields?.name, phone: json.result?.fields?.phone, address: json.result?.fields?.address, note: json.result?.fields?.note });
      setRecognizeHint('已识别并自动填入，请核对修改后提交。');
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : '识别失败，请重试');
    } finally { setRecognizing('idle'); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status !== 'ready') return;
    setError('');
    setStatus('submitting');
    try {
      const res = await fetch('/api/register-client?token=' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer, phone, address, note }),
      });
      const json: any = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '提交失败，请稍后重试');
      setCustomerNo(json.result.customer_no || '');
      setMerged(Boolean(json.result.merged));
      setStatus('done');
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : '提交失败，请稍后重试');
      setStatus('ready');
    }
  }

  const pageStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #1e3a8a 0%, #0f172a 60%)',
    padding: '0 0 48px',
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
    color: '#1f2937',
  };
  const cardStyle: React.CSSProperties = {
    background: '#ffffff', borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,.18)',
    maxWidth: 420, margin: '0 auto', overflow: 'hidden',
  };
  const headStyle: React.CSSProperties = {
    background: '#1e3a8a', color: '#fff', padding: '28px 24px 22px', textAlign: 'center',
  };
  const bodyStyle: React.CSSProperties = { padding: '24px 24px 28px' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#374151' };
  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 16, borderRadius: 10,
    border: '1px solid #d1d5db', background: '#f9fafb', outline: 'none', marginBottom: 16,
  };
  const quickButtonStyle: React.CSSProperties = {
    flex: 1, minWidth: 140, padding: '10px 12px', fontSize: 14, fontWeight: 600, textAlign: 'center',
    background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 10, cursor: 'pointer',
  };
  const buttonStyle: React.CSSProperties = {
    width: '100%', padding: '14px', fontSize: 17, fontWeight: 700, color: '#fff',
    background: '#2563eb', border: 'none', borderRadius: 10, cursor: 'pointer',
  };

  if (status === 'checking') {
    return (
      <div style={pageStyle}>
        <div style={{ paddingTop: '28vh', textAlign: 'center', color: '#c7d2fe', fontSize: 15 }}>正在打开资料登记页…</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ padding: '56px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>链接无法使用</div>
            <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={headStyle}>
            <div style={{ fontSize: 15, opacity: 0.9, marginBottom: 4 }}>{company || '固美格全屋定制'}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>资料提交成功</div>
          </div>
          <div style={{ padding: '40px 32px', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#d1fae5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 16px' }}>✓</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{merged ? '您的资料已补充到原有档案' : '客户档案已自动建立'}</div>
            <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7, marginBottom: 12 }}>
              {merged ? '我们已识别到您之前登记过资料，本次信息已合并。' : '我们已收到您的姓名、电话和地址。'}
            </div>
            {customerNo && <div style={{ fontSize: 14, color: '#374151', background: '#f3f4f6', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>客户编号：<b style={{ fontFamily: 'monospace' }}>{customerNo}</b></div>}
            <div style={{ fontSize: 13, color: '#9ca3af' }}>商家会尽快与您联系，请保持电话畅通。</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={{ padding: '28px 16px 20px', textAlign: 'center' }}>
        <div style={{ color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{company || '固美格全屋定制'}</div>
        <div style={{ color: '#93c5fd', fontSize: 13, marginTop: 4 }}>客户资料登记 · 提交后自动建档</div>
      </div>
      <div style={cardStyle}>
        <div style={headStyle}>
          <div style={{ fontSize: 19, fontWeight: 700 }}>填写您的资料</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>可以拍照、语音自动填写，或手动输入</div>
        </div>
        <form onSubmit={submit} style={bodyStyle}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#374151' }}>快速录入（选填，识别后请核对）</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ ...quickButtonStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                📷 拍照 / 选图识别（{ocrEngine === 'qwen' ? '智能' : 'OCR'}）
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={recognizing !== 'idle'} onChange={event => { const file = event.target.files?.[0]; if (file) { if (file.size > (ocrEngine === 'qwen' ? 2 * 1024 * 1024 : 10 * 1024 * 1024)) { setError(ocrEngine === 'qwen' ? '智能识别请用 2MB 以内的图片，超清图可切换「备用OCR」（10MB）' : '图片不能超过 10MB'); return; } void recognizeImage(file, ocrEngine); } event.currentTarget.value = ''; }} />
              </label>
              <button type="button" style={quickButtonStyle} disabled={recognizing !== 'idle'} onClick={recognizing === 'recording' ? stopRecord : startRecord}>
                {recognizing === 'recording' ? '⏹ 停止并识别' : '🎤 语音识别'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {([['qwen', '智能识别（推荐）'], ['ocr', '备用OCR']] as [OcrEngine, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={recognizing !== 'idle'}
                  onClick={() => setOcrEngine(value)}
                  style={{
                    padding: '4px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer', border: 'none',
                    background: ocrEngine === value ? '#1e40af' : '#e5e7eb',
                    color: ocrEngine === value ? '#fff' : '#4b5563',
                    fontWeight: ocrEngine === value ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {recognizing === 'recording' && <div style={{ fontSize: 13, color: '#dc2626', marginTop: 8 }}>● 录音中…</div>}
            {recognizeHint && <div style={{ fontSize: 13, color: '#1d4ed8', marginTop: 8, lineHeight: 1.5 }}>{recognizeHint}</div>}
          </div>
          <label style={labelStyle}>您的姓名 *</label>
          <input style={inputStyle} value={customer} onChange={e => setCustomer(e.target.value)} placeholder="例如：李女士" maxLength={50} required />
          <label style={labelStyle}>联系电话 *</label>
          <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="11位手机号" inputMode="tel" maxLength={11} required />
          <label style={labelStyle}>小区 / 地址 *</label>
          <input style={inputStyle} value={address} onChange={e => setAddress(e.target.value)} placeholder="例如：云顶东苑6-2-802" maxLength={200} required />
          <label style={labelStyle}>装修需求（选填）</label>
          <textarea style={{ ...inputStyle, minHeight: 84, resize: 'vertical', fontFamily: 'inherit' }} value={note} onChange={e => setNote(e.target.value)} placeholder="例如：全屋定制，想先看看厨房和衣柜报价" maxLength={2000} />
          {source && <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>来源：{source}</div>}
          {error && <div style={{ fontSize: 13, color: '#dc2626', background: '#fef2f2', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>{error}</div>}
          <button type="submit" disabled={recognizing !== 'idle'} style={{ ...buttonStyle, opacity: recognizing !== 'idle' ? 0.6 : 1 }}>{status === 'submitting' ? '正在提交…' : '提交，自动建立档案'}</button>
          <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>提交即表示您同意我们使用该信息与您联系，您的信息仅用于本店业务。</div>
        </form>
      </div>
    </div>
  );
}
