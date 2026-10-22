'use client';

import {useMemo, useState} from 'react';
import {X} from 'lucide-react';
import {receiptTargets} from '../lib/order-overview';
import './settlement-receipt.css';

const money = (amount: number) => new Intl.NumberFormat('zh-CN', {style: 'currency', currency: 'CNY'}).format(amount / 100);
const today = () => new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Shanghai'});
const RECEIPT_NAMES = ['定金', '材料款', '尾款', '安装款', '结算', '其他'];

type Props = {
  project: any;
  projects: any[];
  quotes: any[];
  transactions: any[];
  busy: boolean;
  mutate: (action: string, args: any) => Promise<any>;
  onClose: () => void;
};

/** 结算收款弹窗：显示应收/已收/待收，可输入收款金额、抹零金额与收款名称，确认后登记尾款收款并同步保存抹零。 */
export default function SettlementReceipt({project, projects, quotes, transactions, busy, mutate, onClose}: Props) {
  const root = useMemo(() => project?.parent_id ? (projects.find(p => p.id === project.parent_id) || project) : project, [project, projects]);
  const basis = useMemo(() => root ? receiptTargets(root, projects, quotes, transactions) : {targets: [], unallocated: 0}, [root, projects, quotes, transactions]);
  const [targetId, setTargetId] = useState('');
  const target = basis.targets.find((row: any) => row.id === targetId) || basis.targets[0];
  const hasSubprojects = Boolean(root && root.project_type !== 'customer' && (basis.targets.length > 1 || basis.targets.some((row: any) => row.projectId !== root.id || row.subprojectId)));
  const [amount, setAmount] = useState('');
  const [rounding, setRounding] = useState('0');
  const [name, setName] = useState('结算');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const balance = target?.remaining;
  const existingDiscount = root ? Number(root.discount_amount || 0) : 0;
  const existingRounding = root ? Number(root.rounding_amount || 0) : 0;

  function cents(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return NaN;
    return Math.round(parsed * 100);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const amountCents = cents(amount);
    const roundCents = cents(rounding);
    if (!(amountCents > 0)) {setError('请填写本次收款金额。'); return;}
    if (!(roundCents >= 0)) {setError('抹零金额无效，请输入不小于 0 的数字。'); return;}
    if (!target) {setError('请选择收款目标。'); return;}
    if (balance !== null && balance !== undefined && amountCents + roundCents > balance) {
      setError('收款金额与抹零金额合计超过当前待收 ' + money(balance) + '，请核对。'); return;
    }
    if (!name.trim()) {setError('请填写收款名称（如：定金、材料款）。'); return;}
    setError(''); setSaving(true);
    try {
      if (roundCents > 0) {
        const savedSettlement = await mutate('set_customer_settlement', {
          project_id: root.id,
          discount_amount: existingDiscount / 100,
          rounding_amount: (existingRounding + roundCents) / 100,
          note: ('结算收款抹零 ' + money(roundCents) + (note.trim() ? '：' + note.trim() : '')).slice(0, 2000),
        });
        if (!savedSettlement) throw new Error('抹零保存未成功，请检查优惠与抹零合计后重试。');
      }
      const saved = await mutate('record_transaction', {
        project_id: target.projectId,
        ...(target.subprojectId ? {subproject_id: target.subprojectId} : {}),
        type: '收款',
        amount: amountCents / 100,
        category: name.trim(),
        date,
        note: (note.trim() ? note.trim() : '结算收款') + (roundCents > 0 ? '（含抹零 ' + money(roundCents) + '）' : ''),
        request_id: crypto.randomUUID(),
      });
      if (saved === false) throw new Error('收款登记未成功，请重试。');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '结算失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return <div className="overlay" onClick={event => {if (event.target === event.currentTarget && !saving) onClose();}}>
    <section className="modal settlementReceiptModal" role="dialog" aria-modal="true" aria-label="结算收款">
      <div className="modalHead">
        <div><span className="eyebrow">{root?.name || '结算收款'}</span><h2>结算收款</h2></div>
        <button type="button" aria-label="关闭结算收款" disabled={saving} onClick={onClose}><X/></button>
      </div>
      <form onSubmit={save}>
        <div className="formBody">
          {hasSubprojects && <label>收款目标 *<select aria-label="收款目标" value={targetId} disabled={saving || busy} required onChange={event => setTargetId(event.target.value)}>
            <option value="" disabled>请选择结算的小项目</option>
            {basis.targets.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></label>}
          {target && <div className="settlementReceiptBalance" aria-live="polite">
            <span>应收：{target.receivable === null ? '报价未采纳，尚未确定' : money(target.receivable)}</span>
            <span>已收：{money(target.received)}</span>
            <strong>待收：{balance === null || balance === undefined ? '尚未确定' : money(balance)}</strong>
          </div>}
          <div className="formGrid">
            <label>收款金额（元） *<input aria-label="结算收款金额" type="number" min="0.01" max="100000000" step="0.01" required value={amount} disabled={saving || busy} onChange={event => {setAmount(event.target.value); setError('');}} placeholder="本次结算收到的金额"/></label>
            <label>抹零金额（元）<input aria-label="结算抹零金额" type="number" min="0" max="100000000" step="0.01" value={rounding} disabled={saving || busy} onChange={event => {setRounding(event.target.value); setError('');}} placeholder="本次结算抹去的零头"/></label>
            <label>收款名称 *<input aria-label="收款名称" required value={name} maxLength={30} list="settlementReceiptNames" disabled={saving || busy} onChange={event => {setName(event.target.value); setError('');}} placeholder="如：定金、材料款、尾款"/><datalist id="settlementReceiptNames">{RECEIPT_NAMES.map(value => <option value={value} key={value}/>)}</datalist></label>
            <label>发生日期 *<input aria-label="收款发生日期" type="date" required value={date} disabled={saving || busy} onChange={event => setDate(event.target.value)}/></label>
            <label className="span2">备注<textarea aria-label="结算备注" maxLength={1000} value={note} disabled={saving || busy} onChange={event => setNote(event.target.value)} placeholder="如：结清尾款，抹零零头"/></label>
          </div>
          <p className="sectionNote">结算时填写收款金额与抹零金额，保存后登记一笔收款，抹零同步记入客户优惠 / 抹零账目；收款与抹零合计超过待收金额时无法保存。</p>
          {error && <p className="settlementReceiptError" role="alert">{error}</p>}
        </div>
        <div className="modalFoot">
          <button type="button" disabled={saving || busy} onClick={onClose}>取消</button>
          <button className="primary" type="submit" disabled={saving || busy}>{saving ? '正在结算…' : '确认结算'}</button>
        </div>
      </form>
    </section>
  </div>;
}
