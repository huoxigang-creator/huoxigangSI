'use client';

import { useRef, useState } from 'react';
import { Mic, Square, X, UserPlus, AudioLines } from 'lucide-react';

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

const EMPTY_FIELDS = { name: '', phone: '', address: '', note: '' };

// 管理端「语音识别建档」：录音后自动转成文字并提取姓名、电话、地址等字段，
// 管理端核对修改后直接建立客户档案。
export default function RegisterSpeechDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [text, setText] = useState('');
  const [fields, setFields] = useState<typeof EMPTY_FIELDS | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

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
    setBusy(true); setNotice('');
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
      setFields({ ...EMPTY_FIELDS, ...(result.fields || {}) });
      setNotice('识别完成，请核对下面的字段，有误可直接修改，然后点“确认建档”。');
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : '识别失败，请重试');
      setFields(null);
      setText('');
    } finally {
      setBusy(false);
    }
  }

  async function createCustomer() {
    if (!fields) return;
    const name = fields.name.trim();
    if (!name) { setError('客户姓名不能为空，请填写后重试'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_project',
          args: {
            name: name + (fields.address.trim() ? ' · ' + fields.address.trim() : ''),
            customer: name,
            phone: fields.phone.trim(),
            address: fields.address.trim(),
            order_date: '',
            budget: 0,
            status: '洽谈中',
            price_type: 'sale',
            note: fields.note.trim(),
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
      <section className="modal" role="dialog" aria-modal="true" aria-label="语音识别建档">
        <div className="modalHead">
          <div>
            <span className="eyebrow">客户自动建档</span>
            <h2>语音识别建档</h2>
          </div>
          <button aria-label="关闭" disabled={busy} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={{ padding: '4px 20px 20px', maxWidth: 520 }}>
          <p className="sectionNote" style={{ marginTop: 0 }}>对着麦克风说出客户信息（例如“客户张三，电话 138 0000 0000，住在云顶东苑 10 栋 2 单元 404”），系统自动转成文字并提取姓名、电话、地址，核对后一键建档。</p>
          {!fields && (
            <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: 12, padding: '26px 16px', textAlign: 'center', background: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                {recording ? (
                  <button type="button" className="primary" onClick={stopRecording} style={{ borderRadius: '50%', width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Square size={26} />
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => void startRecording()} style={{ borderRadius: '50%', width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Mic size={26} />
                  </button>
                )}
              </div>
              {recording ? (
                <div style={{ fontSize: 15, fontWeight: 600, color: '#dc2626' }}>正在录音… {seconds} 秒（再点一次停止）</div>
              ) : (
                <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{busy ? '正在识别语音…' : '点击开始录音'}</div>
              )}
              <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>建议每段不超过 60 秒，说完点击停止即可识别</div>
            </div>
          )}
          {fields && (
            <div style={{ margin: '12px 0' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>识别结果（可修改）</div>
              {text && (
                <div style={{ fontSize: 13, color: '#64748b', background: '#f8fafc', borderRadius: 8, padding: '8px 10px', marginBottom: 8, lineHeight: 1.6 }}><AudioLines size={13} style={{ verticalAlign: -2, marginRight: 4 }} />转写：{text}</div>
              )}
              {(['name', 'phone', 'address', 'note'] as const).map(key => (
                <label key={key} style={{ display: 'block', margin: '6px 0', fontSize: 13 }}>
                  <span style={{ display: 'inline-block', width: 76, color: '#64748b', fontWeight: 600 }}>{({ name: '客户姓名', phone: '联系电话', address: '客户地址', note: '客户备注' } as const)[key]}</span>
                  <input
                    value={fields[key]}
                    disabled={busy}
                    onChange={e => setFields(current => ({ ...current!, [key]: e.target.value }))}
                    style={{ width: 'calc(100% - 84px)', padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
                  />
                </label>
              ))}
            </div>
          )}
          {fields && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              <button type="button" disabled={busy} onClick={() => { setFields(null); setText(''); setNotice(''); }}><Mic size={14} /> 重新录音</button>
              <button type="button" className="primary" disabled={busy} onClick={() => void createCustomer()}><UserPlus size={15} /> 确认建档</button>
            </div>
          )}
          {notice && <p role="status" style={{ fontSize: 13, color: '#16a34a', margin: '10px 0 0' }}>{notice}</p>}
          {error && <p role="alert" className="sectionNote" style={{ color: '#dc2626', margin: '10px 0 0' }}>{error}</p>}
          <div style={{ marginTop: 16, fontSize: 13, color: '#6b7280', lineHeight: 1.7, background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
            <b>使用提示</b><br />
            · 识别结果只供核对参考，不会自动保存；确认建档后可在「我的客户」查看新档案。<br />
            · 姓名没识别出来时请补填；电话支持“1 3 8 0 0 0 0 0 0 0 0”连读或报数字。
          </div>
        </div>
      </section>
    </div>
  );
}
