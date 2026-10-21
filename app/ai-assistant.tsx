'use client';

import { useState, type FormEvent } from 'react';
import './ai-assistant.css';
import TextRecognition from './text-recognition';

type Entry = { question: string; answer: string };
type Proposal = { token: string; name: string; description: string; args: Record<string, unknown> };

export default function AiAssistant({ onChanged }: { onChanged?: () => Promise<void> }) {
  const [question, setQuestion] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [provider, setProvider] = useState<'qwen' | 'doubao'>('doubao');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = question.trim();
    if (!value || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: value, provider }),
      });
      const result = await response.json() as { answer?: string; proposal?: Proposal; error?: string };
      if (!response.ok || (!result.answer && !result.proposal)) throw new Error(result.error || '提问失败');
      if (result.proposal) setProposal(result.proposal);
      else setEntries(current => [{ question: value, answer: result.answer! }, ...current].slice(0, 10));
      setQuestion('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '提问失败'); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!proposal || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: proposal.token }) });
      const result = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !result.answer) throw new Error(result.error || '操作失败');
      setEntries(current => [{ question: proposal.name, answer: result.answer! }, ...current].slice(0, 10));
      setProposal(null);
      await onChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请核对业务记录'); setProposal(null); }
    finally { setBusy(false); }
  }

  return <section className="aiAssistant" aria-label="AI 助手">
    <p className="aiAssistantIntro">选择豆包或千问，查询项目、报价、收付款和经营数据，也可提出业务操作。仅老板账号可使用；修改记录前会显示操作内容供你确认。</p>
    <form onSubmit={event => void ask(event)}>
      <label htmlFor="ai-provider">使用模型</label>
      <select id="ai-provider" value={provider} onChange={event => setProvider(event.target.value as 'qwen' | 'doubao')}><option value="doubao">豆包</option><option value="qwen">阿里云百炼 · 千问</option></select>
      <label htmlFor="ai-question">你想了解什么？</label>
      <textarea onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229){event.preventDefault();event.currentTarget.form?.requestSubmit();}}} id="ai-question" value={question} maxLength={500} rows={3} placeholder="例如：哪些项目还有待收款？" onChange={event => setQuestion(event.target.value)} />
      <div className="aiAssistantActions"><span>{provider === 'doubao' ? '每次提问会把相关业务数据发送到火山方舟豆包处理。可在本页下方文字识别的豆包设置中配置。' : provider === 'qwen' ? '每次提问会把相关业务数据发送到阿里云百炼处理。' : ''}</span><button type="submit" disabled={busy || !question.trim()}>{busy ? '正在查询…' : '确定'}</button></div>
    </form>
    {proposal && <div className="aiAssistantProposal"><h3>请核对后确认操作</h3><p>{proposal.description}</p><pre>{JSON.stringify(proposal.args, null, 2)}</pre><div><button type="button" onClick={() => setProposal(null)} disabled={busy}>取消</button><button type="button" onClick={() => void confirm()} disabled={busy}>{busy ? '正在执行…' : '确认执行'}</button></div></div>}
    {error && <p className="aiAssistantError" role="alert">{error}</p>}
    <div className="aiAssistantAnswers" aria-live="polite">{entries.map((entry, index) => <article key={index}><h3>{entry.question}</h3><p>{entry.answer}</p></article>)}</div>
    <section style={{marginTop:32}}><TextRecognition/></section>
  </section>;
}
