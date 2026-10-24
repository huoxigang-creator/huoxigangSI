'use client';

import { useRef, useState } from 'react';
import { Images, Mic, Square, X, Upload, Trash2, UserPlus, AudioLines, Sparkles } from 'lucide-react';

const EMPTY_IMAGE_FIELDS = { orderName: '', name: '', phone: '', address: '', orderDate: '', budget: '' };
const EMPTY_SPEECH_FIELDS = { name: '', phone: '', address: '', note: '' };
type Engine = 'qwen' | 'ocr';

function resampleTo16k(audioBuffer: AudioBuffer): Float32Array {
  const targetRate = 16000, ratio = audioBuffer.sampleRate / targetRate;
  const length = Math.round(audioBuffer.length / ratio);
  const result = new Float32Array(length);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const next = Math.min(index + 1, channel.length - 1);
    result[i] = channel[index] * (1 - fraction) + channel[next] * fraction;
  }
  return result;
}

function encodeWav16k(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeString(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); writeString(8, 'WAVE');
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeString(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// 管理端「AI智能建档」：一个弹窗整合两种自动建档方式——上面「图片识别」、下面「语音识别」。
// 图片识别默认千问视觉大模型（识别不准可切换「备用OCR」）；语音识别优先阿里云百炼语音大模型。
// 识别结果均需人工核对后点「确认建档」才写入，绝不自动入库。
export default function RegisterAiDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 图片识别状态
  const [engine, setEngine] = useState<Engine>('qwen');
  const [preview, setPreview] = useState('');
  const [imageFields, setImageFields] = useState<typeof EMPTY_IMAGE_FIELDS | null>(null);
  const [imageLines, setImageLines] = useState<string[]>([]);
  // 语音识别状态
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [text, setText] = useState('');
  const [speechFields, setSpeechFields] = useState<typeof EMPTY_SPEECH_FIELDS | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  async function recognizeImage(file: File, useEngine: Engine) {
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('engine', useEngine);
      const res = await fetch('/api/customer-ocr', { method: 'POST', body: form });
      const json: any = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '识别失败，请重试');
      const result = json.result || {};
      setImageFields({ ...EMPTY_IMAGE_FIELDS, ...(result.fields || {}) });
      setImageLines(result.lines || []);
      setPreview(URL.createObjectURL(file));
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : '识别失败，请重试');
      setImageFields(null);
      setPreview('');
    } finally {
      setBusy(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxBytes = engine === 'qwen' ? 2 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxBytes) { setError(engine === 'qwen' ? '智能识别请用 2MB 以内的图片（超清图可先压缩或切换「备用OCR」）' : '图片不能超过 10MB'); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setError('请选择 PNG、JPEG 或 WebP 图片'); return; }
    void recognizeImage(file, engine);
  }

  async function createFromImage() {
    if (!imageFields) return;
    const name = imageFields.orderName.trim(), customer = imageFields.name.trim();
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
            phone: imageFields.phone.trim(),
            address: imageFields.address.trim(),
            order_date: imageFields.orderDate.trim(),
            budget: Number(imageFields.budget) || 0,
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

  async function startRecording() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        if (timerRef.current) window.clearInterval(timerRef.current);
        setSeconds(0);
        void submitAudio(new Blob(chunksRef.current, { type: 'audio/webm' }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 500);
    } catch {
      setError('无法使用麦克风：请检查浏览器权限后重试');
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function submitAudio(blob: Blob) {
    setBusy(true); setError('');
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const wav = encodeWav16k(resampleTo16k(audioBuffer));
      if (wav.size > 2 * 1024 * 1024) { setError('录音超过 2MB，请缩短录音后重试'); return; }
      const form = new FormData();
      form.append('file', new File([wav], 'speech.wav', { type: 'audio/wav' }));
      const res = await fetch('/api/customer-speech', { method: 'POST', body: form });
      const json: any = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '识别失败，请重试');
      const result = json.result || {};
      setText(result.text || '');
      setSpeechFields({ ...EMPTY_SPEECH_FIELDS, ...(result.fields || {}) });
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : '识别失败，请重试');
      setSpeechFields(null);
      setText('');
    } finally {
      setBusy(false);
    }
  }

  async function createFromSpeech() {
    if (!speechFields) return;
    const name = speechFields.name.trim();
    if (!name) { setError('客户姓名不能为空，请填写后重试'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_project',
          args: {
            name: name + (speechFields.address.trim() ? ' · ' + speechFields.address.trim() : ''),
            customer: name,
            phone: speechFields.phone.trim(),
            address: speechFields.address.trim(),
            order_date: '',
            budget: 0,
            status: '洽谈中',
            price_type: 'sale',
            note: speechFields.note.trim(),
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

  const sectionTitle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 10 };
  const sectionBox: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: '#fff' };
  const fieldRow = (label: string, width: number) => ({ display: 'block', margin: '6px 0', fontSize: 13 }) as React.CSSProperties;
  const fieldSpan: React.CSSProperties = { display: 'inline-block', width: 88, color: '#64748b', fontWeight: 600, fontSize: 13 };
  const fieldInput: React.CSSProperties = { width: 'calc(100% - 96px)', padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 };

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="AI智能建档">
        <div className="modalHead">
          <div>
            <span className="eyebrow">客户自动建档 · AI</span>
            <h2>AI智能建档</h2>
          </div>
          <button aria-label="关闭" disabled={busy} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={{ padding: '4px 20px 20px', maxWidth: 560 }}>
          <p className="sectionNote" style={{ marginTop: 0 }}>上传客户资料图片或直接录音，AI 自动识别出姓名、电话、地址等字段，核对后一键建立客户档案（识别结果只供核对参考，确认建档后才写入）。</p>

          {/* 上段：图片识别 */}
          <div style={sectionBox}>
            <div style={sectionTitle}><Images size={17} color="#2563eb" />图片识别 <span style={{ fontWeight: 400, fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>上传订单/名片/登记表截图或照片</span></div>
            {!imageFields && (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  {([['qwen', '智能识别（推荐）', '千问视觉大模型，看图直接出姓名电话地址，识别更准'], ['ocr', '备用OCR', '文字识别引擎，识别原文行后再提取字段']] as [Engine, string, string][]).map(([value, label, tip]) => (
                    <button
                      key={value}
                      type="button"
                      disabled={busy}
                      onClick={() => setEngine(value)}
                      title={tip}
                      style={{
                        flex: 1, padding: '7px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                        border: engine === value ? '1.5px solid #2563eb' : '1px solid #d1d5db',
                        background: engine === value ? '#eff6ff' : '#fff', color: engine === value ? '#1d4ed8' : '#374151',
                        fontWeight: engine === value ? 600 : 400,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div
                  style={{ border: '1.5px dashed #cbd5e1', borderRadius: 10, padding: '18px 12px', textAlign: 'center', background: '#f8fafc', cursor: 'pointer' }}
                  onClick={() => fileRef.current?.click()}
                  role="button"
                  aria-label="选择图片"
                >
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onFileChange} />
                  <Images size={26} color="#64748b" style={{ margin: '0 auto 6px' }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{busy ? (engine === 'qwen' ? '正在智能识别…' : '正在OCR识别…') : '点击选择图片 / 截图'}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>支持 PNG、JPEG、WebP{engine === 'qwen' ? '，最大 2MB' : '，最大 10MB'}</div>
                  <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); fileRef.current?.click(); }} style={{ marginTop: 8 }}><Upload size={13} /> 选择图片</button>
                </div>
              </div>
            )}
            {imageFields && preview && (
              <div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <img src={preview} alt="识别原图" style={{ width: 104, height: 104, objectFit: 'contain', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>识别字段（可修改）{engine === 'qwen' && <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 500 }}>· 智能识别</span>}</div>
                    {(['orderName', 'name', 'phone', 'address', 'orderDate', 'budget'] as const).map(key => (
                      <label key={key} style={fieldRow(key, 88)}>
                        <span style={fieldSpan}>{({ orderName: '客户订单名称', name: '客户姓名', phone: '联系电话', address: '客户地址', orderDate: '接单日期', budget: '预算成本（元）' } as const)[key]}</span>
                        <input value={imageFields[key]} disabled={busy} onChange={e => setImageFields(current => ({ ...current!, [key]: e.target.value }))} style={fieldInput} />
                      </label>
                    ))}
                    {imageLines.length > 0 && (
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ fontSize: 11, color: '#64748b', cursor: 'pointer' }}>查看识别原文（{imageLines.length} 行）</summary>
                        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6, marginTop: 4, maxHeight: 70, overflow: 'auto', background: '#f8fafc', borderRadius: 6, padding: 6 }}>
                          {imageLines.map((line, i) => <div key={i}>{line}</div>)}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                  <button type="button" disabled={busy} onClick={() => { setImageFields(null); setPreview(''); setEngine(engine === 'qwen' ? 'ocr' : 'qwen'); }}><Trash2 size={13} /> 重新选图</button>
                  <button type="button" className="primary" disabled={busy} onClick={() => void createFromImage()}><UserPlus size={14} /> 确认建档</button>
                </div>
              </div>
            )}
          </div>

          {/* 下段：语音识别 */}
          <div style={{ ...sectionBox, marginTop: 12 }}>
            <div style={sectionTitle}><Mic size={17} color="#7c3aed" />语音识别 <span style={{ fontWeight: 400, fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>说出“客户张三，电话138…，住在…”，自动转文字提取</span></div>
            {!speechFields && (
              <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: 10, padding: '16px 12px', textAlign: 'center', background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                  {recording ? (
                    <button type="button" className="primary" onClick={stopRecording} style={{ borderRadius: '50%', width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="停止录音">
                      <Square size={22} />
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => void startRecording()} style={{ borderRadius: '50%', width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="开始录音">
                      <Mic size={22} />
                    </button>
                  )}
                </div>
                {recording ? (
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#dc2626' }}>正在录音… {seconds} 秒（再点一次停止）</div>
                ) : (
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{busy ? '正在识别语音…' : '点击开始录音'}</div>
                )}
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>建议每段不超过 60 秒，说完点击停止即可识别</div>
              </div>
            )}
            {speechFields && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>识别结果（可修改）</div>
                {text && <div style={{ fontSize: 12, color: '#64748b', background: '#f8fafc', borderRadius: 8, padding: '6px 10px', marginBottom: 6, lineHeight: 1.6 }}><AudioLines size={12} style={{ verticalAlign: -2, marginRight: 4 }} />转写：{text}</div>}
                {(['name', 'phone', 'address', 'note'] as const).map(key => (
                  <label key={key} style={fieldRow(key, 88)}>
                    <span style={fieldSpan}>{({ name: '客户姓名', phone: '联系电话', address: '客户地址', note: '客户备注' } as const)[key]}</span>
                    <input value={speechFields[key]} disabled={busy} onChange={e => setSpeechFields(current => ({ ...current!, [key]: e.target.value }))} style={fieldInput} />
                  </label>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                  <button type="button" disabled={busy} onClick={() => { setSpeechFields(null); setText(''); }}><Mic size={13} /> 重新录音</button>
                  <button type="button" className="primary" disabled={busy} onClick={() => void createFromSpeech()}><UserPlus size={14} /> 确认建档</button>
                </div>
              </div>
            )}
          </div>

          {error && <p role="alert" className="sectionNote" style={{ color: '#dc2626', margin: '10px 0 0' }}>{error}</p>}
          <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280', lineHeight: 1.7, background: '#f8fafc', borderRadius: 10, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={13} color="#7c3aed" />图片识别默认用千问视觉大模型，语音识别默认用阿里云百炼语音大模型；识别不准可切换「备用OCR」/重新录音。结果需人工核对，确认建档后可在「我的客户」查看新档案。
          </div>
        </div>
      </section>
    </div>
  );
}
