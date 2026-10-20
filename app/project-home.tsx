'use client';
import {useEffect, useRef, useState} from 'react';
import {ArrowUpRight, CalendarDays, Check, ClipboardList, Copy, Download, FileText, History, Plus, Settings2, Share2, X} from 'lucide-react';
import {getAdoptedQuotes, type QuoteRecord} from '../lib/quotes';
import {PROGRESS_STAGES, progressStep, publicProgress, publicProgressText, upcomingProjectTasks, taskIsOverdue, type ProgressTask, type PublicProgress} from '../lib/project-progress';
import './project-home.css';

type HomeProject = {id: string; name: string; status?: string; project_type?: string; phone?: string};
type HomeLog = {id?: string; project?: string; detail?: string; created?: string};
export type ProjectHomeProps = {
  project: HomeProject;
  quotes: QuoteRecord[];
  tasks: ProgressTask[];
  logs: HomeLog[];
  busy: boolean;
  onEdit: () => void;
  onAddTask: () => void;
  onOpenTab: (tab: string) => void;
};

function dateTime(value?: string, dateOnly = false) {
  if (!value) return dateOnly ? '未设置时间' : '未记录时间';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return dateOnly ? '未设置时间' : '未记录时间';
  return date.toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', ...(dateOnly ? {} : {hour: '2-digit', minute: '2-digit'})});
}

function ProgressPath({stage, compact = false}: {stage?: string; compact?: boolean}) {
  const current = progressStep(stage);
  return <ol className={'projectProgressPath' + (compact ? ' compact' : '')} aria-label="工作环节">
    {PROGRESS_STAGES.map((item, index) => <li key={item.status} className={index < current ? 'done' : index === current ? 'current' : ''} aria-current={index === current ? 'step' : undefined}>
      <span className="projectProgressNode" aria-hidden="true">{index < current ? <Check size={14}/> : index + 1}</span><span>{item.label}</span>
    </li>)}
  </ol>;
}

function drawLines(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number): number {
  let line = '';
  for (const paragraph of text.split('\n')) {
    for (const char of paragraph) {
      if (line && context.measureText(line + char).width > width) {context.fillText(line, x, y); y += lineHeight; line = '';}
      line += char;
    }
    context.fillText(line, x, y); y += lineHeight; line = '';
  }
  return y;
}

async function saveProgressImage(progress: PublicProgress, ownerNote: string) {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1120;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法生成进展图片，请复制文字分享。');
  const font = '"Microsoft YaHei", "PingFang SC", sans-serif';
  // Measure user-entered text before allocating the image so long notes stay visible.
  context.font = `28px ${font}`;
  const measureLines = (text: string, width: number) => {
    let count = 0;
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const char of paragraph) {if (line && context.measureText(line + char).width > width) {count++; line = '';} line += char;}
      count++;
    }
    return count;
  };
  context.font = `bold 46px ${font}`;
  const nameLines = measureLines(progress.name, 920);
  context.font = `28px ${font}`;
  const noteLines = ownerNote.trim() ? measureLines(ownerNote.trim(), 920) : 0;
  canvas.height = 650 + (nameLines - 1) * 64 + (noteLines ? 74 + noteLines * 44 : 0);
  context.fillStyle = '#eef4fb'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff'; context.beginPath(); context.roundRect(36, 36, canvas.width - 72, canvas.height - 72, 24); context.fill();
  context.fillStyle = '#7a91ac'; context.font = `24px ${font}`; context.fillText('SI · 工作进展', 92, 108);
  context.fillStyle = '#1e334b'; context.font = `bold 46px ${font}`;
  let y = drawLines(context, progress.name, 92, 181, 920, 64);
  context.fillStyle = '#7a91ac'; context.font = `24px ${font}`; context.fillText(`更新日期：${progress.asOf}`, 92, y + 10);
  const current = progressStep(progress.stage), nodeY = y + 100;
  PROGRESS_STAGES.forEach((stage, index) => {
    const step = (canvas.width - 234) / (PROGRESS_STAGES.length - 1);
    const x = 117 + index * step;
    if (index < PROGRESS_STAGES.length - 1) {context.strokeStyle = index < current ? '#92b4dc' : '#e1e9f3'; context.lineWidth = 5; context.beginPath(); context.moveTo(x + 22, nodeY); context.lineTo(x + step - 22, nodeY); context.stroke();}
    context.fillStyle = index <= current ? '#245c9c' : '#edf2f8'; context.beginPath(); context.arc(x, nodeY, 22, 0, Math.PI * 2); context.fill();
    context.fillStyle = index <= current ? '#ffffff' : '#91a1b4'; context.font = `22px ${font}`; context.textAlign = 'center'; context.fillText(String(index + 1), x, nodeY + 8);
    context.fillStyle = index === current ? '#245c9c' : '#71869e'; context.font = `${index === current ? 'bold ' : ''}24px ${font}`; context.fillText(stage.label, x, nodeY + 62);
  });
  context.textAlign = 'left'; context.fillStyle = '#245c9c'; context.font = `bold 30px ${font}`; context.fillText(`当前环节：${progress.stage}`, 92, nodeY + 135);
  context.fillStyle = '#5f7794'; context.font = `28px ${font}`; y = drawLines(context, progress.summary, 92, nodeY + 185, 920, 44);
  if (ownerNote.trim()) {context.fillStyle = '#71869e'; context.font = `24px ${font}`; context.fillText('补充说明', 92, y + 26); context.fillStyle = '#334f70'; context.font = `28px ${font}`; drawLines(context, ownerNote.trim(), 92, y + 78, 920, 44);}
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('图片生成未成功，请复制文字分享。');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `${progress.name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 70)}_工作进展_${progress.asOf}.png`;
  document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function ProgressShare({progress, onClose, projectId, customerPhone}: {progress: PublicProgress; onClose: () => void; projectId: string; customerPhone?: string}) {
  const [ownerNote, setOwnerNote] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState(''), [working, setWorking] = useState(false), [canShare, setCanShare] = useState(false);
  const dialog = useRef<HTMLElement>(null), noteInput = useRef<HTMLTextAreaElement>(null), textPreview = useRef<HTMLTextAreaElement>(null);
  const text = publicProgressText(progress, ownerNote);
  useEffect(() => {
    setCanShare(typeof navigator.share === 'function');
    const previous = document.body.style.overflow, focused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden'; noteInput.current?.focus();
    return () => {document.body.style.overflow = previous; focused?.focus();};
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); if (!working) onClose();}
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [working, onClose]);
  async function copyText() {
    setError(''); setNotice('');
    try {if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(text); setNotice('已复制，可粘贴到微信等应用发送给业主。');}
    catch {textPreview.current?.focus(); textPreview.current?.select(); setError('自动复制未成功，已选中下方文字，请手动复制。');}
  }
  async function downloadImage() {
    setWorking(true); setError(''); setNotice('');
    try {await saveProgressImage(progress, ownerNote); setNotice('进展图片已生成，请在下载中查看并自行发送给业主。');}
    catch (reason) {setError(reason instanceof Error ? reason.message : '生成图片失败，请复制文字分享。');}
    finally {setWorking(false);}
  }
  async function shareText() {
    setWorking(true); setError(''); setNotice('');
    try {await navigator.share({title: `${progress.name} · 工作进展`, text}); setNotice('系统分享已完成。');}
    catch (reason) {if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError('系统分享未成功，请复制文字或保存进展图片后发送。');}
    finally {setWorking(false);}
  }
  async function sendBySms() {
    setWorking(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/project-sms', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({project_id: projectId})});
      const body = await response.json() as {error?: string; phone?: string};
      if (!response.ok) throw new Error(body.error || '短信发送失败');
      setNotice(`短信已发送给客户（${body.phone}）`);
    }
    catch (reason) {setError(reason instanceof Error ? reason.message : '短信发送失败，请复制文字或保存进展图片后发送。');}
    finally {setWorking(false);}
  }
  return <div className="overlay projectProgressShareOverlay"><section ref={dialog} className="modal projectProgressShareModal" role="dialog" aria-modal="true" aria-labelledby="project-progress-share-title">
    <div className="modalHead"><div><span className="eyebrow">{progress.name}</span><h2 id="project-progress-share-title">分享客户进展</h2></div><button type="button" aria-label="关闭进展分享" disabled={working} onClick={onClose}><X size={20}/></button></div>
    <div className="formBody">
      <div className="projectProgressOwnerPreview"><span className="badge blue">{progress.stage}</span><span>更新于 {progress.asOf}</span><ProgressPath stage={progress.stage} compact/><p>{progress.summary}</p></div>
      <label>给业主的补充说明<textarea ref={noteInput} value={ownerNote} maxLength={600} disabled={working} onChange={event => {setOwnerNote(event.target.value); setError(''); setNotice('');}} placeholder="可填写下一步安排或需要业主确认的事项"/></label>
      <label>分享文字预览<textarea ref={textPreview} className="projectProgressTextPreview" value={text} readOnly aria-label="可手动选择复制的进展文字"/></label>
      <p className="projectProgressShareHelp">可一键短信发送给客户；也可复制文字或保存进展图片，通过微信等应用手动发给业主。{customerPhone ? <>客户手机号：<code>{customerPhone}</code></> : '客户未填写手机号，短信发送不可用（可在编辑项目资料中填写）。'}</p>
      {error && <p className="projectHomeError" role="alert">{error}</p>}{notice && <p className="projectHomeNotice" role="status">{notice}</p>}
    </div>
    <div className="modalFoot"><button type="button" disabled={working} onClick={() => void sendBySms()}><Share2 size={16}/>{working ? '发送中…' : '短信发送给客户'}</button><button type="button" disabled={working} onClick={() => void downloadImage()}><Download size={16}/>{working ? '处理中…' : '保存进展图'}</button>{canShare && <button type="button" disabled={working} onClick={() => void shareText()}><Share2 size={16}/>系统分享</button>}<button type="button" className="primary" disabled={working} onClick={() => void copyText()}><Copy size={16}/>复制进展文字</button></div>
  </section></div>;
}

export default function ProjectHome({project, quotes, tasks, logs, busy, onEdit, onAddTask, onOpenTab}: ProjectHomeProps) {
  const [share, setShare] = useState<PublicProgress | null>(null);
  const pending = upcomingProjectTasks(tasks), pendingCount = tasks.filter(task => !task.done && !task.deleted).length;
  const versions = quotes.filter(quote => !quote.deleted).sort((a, b) => String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')));
  const latest = versions[0], adopted = getAdoptedQuotes(versions);
  const recent = logs.filter(log => !log.project || log.project === project.id).sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))).slice(0, 3);
  const progress = publicProgress(project), customerMode = project.project_type === 'customer';
  return <div className="projectHomeWorkspace">
    <section className="panel projectProgressCard" aria-label={customerMode ? '客户进展' : '项目进展'}>
      <div className="panelHead"><div><span className="projectHomeKicker">{customerMode ? '客户进展' : '项目进展'}</span><h2>当前环节 <span>{progress.stage}</span></h2></div><div className="projectHomeHeaderActions"><button type="button" disabled={busy} onClick={onEdit}><Settings2 size={15}/>更新阶段</button><button type="button" className="primary" disabled={busy} onClick={() => setShare(publicProgress(project))}><Share2 size={15}/>分享客户进展</button></div></div>
      <ProgressPath stage={project.status}/>
      <div className="projectProgressFooter"><span>{progress.summary}</span><button type="button" className="link" disabled={busy} onClick={() => onOpenTab('项目跟踪')}>查看{customerMode ? '客户' : '项目'}跟踪<ArrowUpRight size={14}/></button></div>
    </section>
    <div className="projectHomeColumns">
      <section className="panel projectHomeTasks"><div className="panelHead"><h2><ClipboardList size={18}/>下一步安排 <span className="count">{pendingCount}</span></h2><button type="button" disabled={busy} onClick={onAddTask}><Plus size={15}/>添加跟进</button></div>
        {pending.length ? <div className="projectHomeTaskList">{pending.map((task, index) => <button type="button" key={task.id || index} disabled={busy} className="projectHomeTask" onClick={() => onOpenTab('项目跟踪')}><span className="projectHomeTaskNumber">{index + 1}</span><div><strong>{task.title || '未命名任务'}</strong><small><CalendarDays size={12}/>{dateTime(task.due_at || (task.date ? task.date + 'T00:00:00+08:00' : ''), !task.due_at)}<span>负责人：{task.assignee || '未分配'}</span></small></div>{taskIsOverdue(task) && <span className="badge orange">已逾期</span>}<ArrowUpRight size={15}/></button>)}</div> : <div className="projectHomeEmpty"><ClipboardList size={25}/><p>暂无待办安排</p><span>添加下一步跟进，记录时间与负责人。</span></div>}
        {pendingCount > 3 && <div className="projectHomeMore"><button type="button" className="link" disabled={busy} onClick={() => onOpenTab('项目跟踪')}>查看全部 {pendingCount} 项跟进<ArrowUpRight size={14}/></button></div>}
      </section>
      <section className="panel projectHomeQuote"><div className="panelHead"><h2><FileText size={18}/>报价状态</h2><button type="button" className="link" disabled={busy} onClick={() => onOpenTab('报价')}>查看报价<ArrowUpRight size={14}/></button></div>
        {latest ? <div className="projectHomeQuoteBody"><span className={'badge ' + (latest.adopted ? 'green' : 'blue')}>{latest.adopted ? '最新报价已采纳' : '最新报价待采纳'}</span><h3>{latest.title || '未命名报价'}</h3><p>最近更新 {dateTime(latest.updated || latest.created)}</p><div className="projectHomeQuoteMeta"><span>共 {versions.length} 份报价版本</span><b>{adopted.length ? `已采纳 ${adopted.length} 份` : '尚未采纳报价'}</b></div><button type="button" disabled={busy} onClick={() => onOpenTab('报价')}>进入报价工作台<ArrowUpRight size={15}/></button></div> : <div className="projectHomeEmpty"><FileText size={25}/><p>尚未创建报价</p><button type="button" disabled={busy} onClick={() => onOpenTab('报价')}>进入报价工作台<ArrowUpRight size={15}/></button></div>}
      </section>
    </div>
    <section className="panel projectHomeActivity"><div className="panelHead"><h2><History size={18}/>最近动态</h2><button type="button" className="link" disabled={busy} onClick={() => onOpenTab('项目跟踪')}>查看全部<ArrowUpRight size={14}/></button></div>
      {recent.length ? <ol>{recent.map((log, index) => <li key={log.id || index}><span className="projectHomeActivityDot"/><p>{log.detail || '更新了项目记录'}</p><time>{dateTime(log.created)}</time></li>)}</ol> : <p className="projectHomeNoActivity">暂无动态，后续修改和跟进会记录在这里。</p>}
    </section>
    {share && <ProgressShare progress={share} onClose={() => setShare(null)} projectId={project.id} customerPhone={project.phone}/>}
  </div>;
}
