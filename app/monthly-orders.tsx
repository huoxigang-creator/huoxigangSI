'use client';

import {useMemo, useState} from 'react';
import {CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, FolderOpen, Search, Target, Timer, Trash2, TriangleAlert, UsersRound} from 'lucide-react';
import ManagedTable from './managed-table';
import {buildOrderRows, receiptTargets, shanghaiMonth, type OrderRow} from '../lib/order-overview';
import {trashRequest} from '../lib/trash-client';
import './monthly-orders.css';

export type MonthlyOrdersProps = {
  data: {projects: any[]; quotes: any[]; transactions: any[]};
  busy: boolean;
  onSelect: (project: any, subprojectId?: string) => void;
  onDeleted?: () => void;
};

type OrderFilter = '全部' | '意向' | '进行中' | '收尾中' | '已完工' | '已归档';
const filters: OrderFilter[] = ['全部', '意向', '进行中', '收尾中', '已完工', '已归档'];
const stageOptions = ['全部环节', '意向', '洽谈中', '设计中', '生产中', '安装中'] as const;
type StageFilter = typeof stageOptions[number];
const formatMoney = (cents: number) => new Intl.NumberFormat('zh-CN', {style: 'currency', currency: 'CNY'}).format(cents / 100);
const inProgress = (status: string) => !['收尾中', '已完工', '已归档'].includes(status);

function adjacentMonth(month: string, offset: number) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function monthLabel(month: string) {
  const [year, number] = month.split('-');
  return year + '年' + Number(number) + '月';
}

function stageClass(status: string) {
  if (status === '意向') return 'monthlyStageIntent';
  if (status === '已完工') return 'monthlyStageComplete';
  if (status === '收尾中') return 'monthlyStageFinishing';
  if (status === '已归档') return 'monthlyStageArchived';
  return 'monthlyStageActive';
}

function Balance({row}: {row: OrderRow}) {
  if (row.remaining === null) return <><strong className="monthlyUnconfirmed">应收未确定</strong><small>尚未采纳报价</small></>;
  return <><strong className={row.remaining > 0 ? 'monthlyOutstanding' : 'monthlySettled'}>{formatMoney(row.remaining)}</strong>{row.overpaid > 0 ? <small className="monthlyOverpaid">多收 {formatMoney(row.overpaid)}</small> : row.remaining === 0 ? <small>已结清</small> : null}{row.unallocated > 0 && <small className="monthlyAllocationHint">有款项尚未分配</small>}</>;
}

export default function MonthlyOrders({data, busy, onSelect, onDeleted}: MonthlyOrdersProps) {
  const [month, setMonth] = useState(shanghaiMonth), [filter, setFilter] = useState<OrderFilter>('全部'), [search, setSearch] = useState(''), [searchInput, setSearchInput] = useState(''), [submittedSearch, setSubmittedSearch] = useState(''), [stageFilter, setStageFilter] = useState<StageFilter>('全部环节');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const allRows = useMemo(() => buildOrderRows(data.projects, data.quotes, data.transactions), [data.projects, data.quotes, data.transactions]);
  const projectsById = useMemo(() => new Map(data.projects.map(project => [project.id, project])), [data.projects]);
  const monthRows = useMemo(() => allRows.filter(row => row.orderDate.slice(0, 7) === month).sort((a, b) => b.orderDate.localeCompare(a.orderDate) || a.name.localeCompare(b.name, 'zh-CN')), [allRows, month]);
  const customerCount = new Set(monthRows.map(row => row.rootId)).size;
  const intentCount = monthRows.filter(row => row.status === '意向').length;
  const ongoingCount = monthRows.filter(row => inProgress(row.status)).length;
  const finishingCount = monthRows.filter(row => row.status === '收尾中').length;
  const completedCount = monthRows.filter(row => row.status === '已完工').length;
  const stageCount = Object.fromEntries(['洽谈中', '设计中', '生产中', '安装中'].map(stage => [stage, monthRows.filter(row => row.status === stage).length])) as Record<string, number>;
  const query = submittedSearch.trim().toLocaleLowerCase('zh-CN');
  const visibleRows = monthRows.filter(row => (filter === '全部' || (filter === '进行中' ? inProgress(row.status) : row.status === filter)) && (stageFilter === '全部环节' || row.status === stageFilter) && [row.name, row.parentName, row.customer].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(query));
  const unallocatedByCustomer = useMemo(() => {
    const amounts = new Map<string, number>();
    for (const rootId of new Set(monthRows.map(row => row.rootId))) {
      const root = projectsById.get(rootId);
      if (!root) continue;
      const amount = receiptTargets(root, data.projects, data.quotes, data.transactions).unallocated;
      if (amount > 0) amounts.set(rootId, amount);
    }
    return amounts;
  }, [monthRows, projectsById, data.projects, data.quotes, data.transactions]);
  const unallocatedAmount = [...unallocatedByCustomer.values()].reduce((sum, amount) => sum + amount, 0);

  function changeMonth(value: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return;
    setMonth(value); setFilter('全部');
  }

  const summaries = [
    {label: month === shanghaiMonth() ? '本月接单' : '当月接单', count: customerCount, unit: '家', detail: monthRows.length + ' 项订单', icon: UsersRound, tone: 'monthlyBlue', filter: '全部' as OrderFilter},
    {label: '意向客户', count: intentCount, unit: '项', detail: '未下单 · 需跟踪跟进', icon: Target, tone: 'monthlyIntent', filter: '意向' as OrderFilter},
    {label: '进行中', count: ongoingCount, unit: '项', detail: '洽谈 ' + stageCount['洽谈中'] + ' · 设计 ' + stageCount['设计中'] + ' · 生产 ' + stageCount['生产中'] + ' · 安装 ' + stageCount['安装中'], icon: CircleDashed, tone: 'monthlyBlue', filter: '进行中' as OrderFilter},
    {label: '收尾中', count: finishingCount, unit: '项', detail: '处理最后的完善事项', icon: Timer, tone: 'monthlyOrange', filter: '收尾中' as OrderFilter},
    {label: '已完工', count: completedCount, unit: '项', detail: '已完成的订单', icon: CheckCircle2, tone: 'monthlyGreen', filter: '已完工' as OrderFilter},
  ];

  return <div className="monthlyOrders" aria-busy={busy}>
    <div className="monthlyOrdersHead">
      <div></div>
      <div className="monthlyMonthPicker">
        <button type="button" aria-label="上个月" title="上个月" disabled={busy} onClick={() => changeMonth(adjacentMonth(month, -1))}><ChevronLeft size={17}/></button>
        <label><CalendarDays size={16}/><input type="month" aria-label="接单月份" value={month} disabled={busy} onChange={event => changeMonth(event.target.value)}/></label>
        <button type="button" aria-label="下个月" title="下个月" disabled={busy} onClick={() => changeMonth(adjacentMonth(month, 1))}><ChevronRight size={17}/></button>
        <button type="button" className="monthlyCurrentMonth" disabled={busy} onClick={() => changeMonth(shanghaiMonth())}>本月</button>
      </div>
    </div>

    <div className="monthlyOrderMetrics">
      {summaries.map(summary => <button key={summary.label} type="button" className={'monthlyOrderMetric ' + summary.tone + (filter === summary.filter ? ' isSelected' : '')} aria-pressed={filter === summary.filter} disabled={busy} onClick={() => setFilter(summary.filter)}>
        <span className="monthlyMetricHeading">{summary.label}<span className="monthlyMetricIcon"><summary.icon size={17}/></span></span>
        <strong>{summary.count}<small>{summary.unit}</small></strong>
        <span className="monthlyMetricDetail">{summary.detail}</span>
      </button>)}
    </div>

    {unallocatedAmount > 0 && <div className="monthlyAllocationNotice" role="note"><TriangleAlert size={17}/><p>这些客户有 <b>{formatMoney(unallocatedAmount)}</b> 历史收款尚未分配到小项目。小项目已收款只计算已关联款项，待收金额也未扣除这部分收款。</p></div>}

    {intentCount > 0 && <div className="monthlyIntentNotice" role="note"><TriangleAlert size={17}/><p>本月有 <b>{intentCount}</b> 项<b>意向客户</b>订单待跟踪，点击订单名称进入客户详情，在“客户跟踪”中更新阶段与跟进任务。</p></div>}

    <section className="panel monthlyOrderPanel" aria-label={monthLabel(month) + '订单列表'}>
      <div className="panelHead"><div><h2>{monthLabel(month)}接单</h2><p className="monthlyPanelDescription">{customerCount} 家客户 · {monthRows.length} 项订单<span>金额为累计已收和当前待收</span></p></div>{busy && <span className="monthlyLoading" role="status">正在更新…</span>}</div>
      <div className="monthlyOrderFilters">
        <div className="monthlyStatusFilters" role="group" aria-label="订单状态筛选">{filters.map(value => <button key={value} type="button" className={filter === value ? 'selected' : ''} aria-pressed={filter === value} disabled={busy} onClick={() => setFilter(value)}>{value}</button>)}</div>
        <div className="monthlyOrderRight"><label className="monthlyStageSelect">环节<select aria-label="按环节筛选" value={stageFilter} disabled={busy} onChange={event=>setStageFilter(event.target.value as StageFilter)}>{stageOptions.map(stage=><option key={stage} value={stage}>{stage}</option>)}</select></label>
          <button type="button" className="monthlyBatchDelete" disabled={busy || !selectedIds.size} onClick={async () => {if(!selectedIds.size||!window.confirm('将选中的 '+selectedIds.size+' 个订单移入回收站？相关报价和收付款将隐藏，可恢复。'))return;for(const id of selectedIds){try{await trashRequest('delete_record',{id})}catch{}}setSelectedIds(new Set());onDeleted?.();}}><Trash2 size={14}/>批量删除({selectedIds.size})</button>
          <div className="monthlySearchBox"><input type="search" aria-label="搜索订单或客户" placeholder="搜索订单或客户" value={searchInput} disabled={busy} onChange={event=>setSearchInput(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();setSubmittedSearch(searchInput);}}}/><button type="button" disabled={busy} onClick={()=>setSubmittedSearch(searchInput)}><Search size={15}/>搜索</button></div>
        </div>
      </div>

      {visibleRows.length > 0 ? <div className="tableWrap"><ManagedTable tableKey="monthly-orders" disabled={busy} className="monthlyOrderTable" allRowOrder={monthRows.map(row => row.id)}>
        <thead><tr><th style={{width:32}}><input type="checkbox" aria-label="全选" checked={visibleRows.length>0 && visibleRows.every(row=>selectedIds.has(row.id))} disabled={busy||!visibleRows.length} onChange={()=>{const ids=new Set(selectedIds);visibleRows.forEach(row=>{if(ids.has(row.id))ids.delete(row.id);else ids.add(row.id);});setSelectedIds(ids);}}/></th><th>客户编号</th><th scope="col" data-column-key="order-name" data-column-required>订单名称</th><th scope="col" data-column-key="customer">客户</th><th scope="col" data-column-key="stage">当前阶段</th><th scope="col" data-column-key="received">累计已收</th><th scope="col" data-column-key="remaining">当前待收</th><th scope="col" data-column-key="order-date">接单日期</th></tr></thead>
        <tbody>{visibleRows.map(row => <tr key={row.id} data-row-id={row.id}>
          <td><input type="checkbox" aria-label={'选择 '+row.name} checked={selectedIds.has(row.id)} disabled={busy} onChange={()=>{const ids=new Set(selectedIds);if(ids.has(row.id))ids.delete(row.id);else ids.add(row.id);setSelectedIds(ids);}}/></td>
          <td style={{fontFamily:'monospace',fontSize:11,color:'#667',whiteSpace:'nowrap'}}>{projectsById.get(row.rootId)?.customer_no||'—'}</td>
          <td className="monthlyOrderName"><button type="button" className="projectLink" aria-label={'进入项目 ' + row.name} disabled={busy || !projectsById.has(row.projectId)} onClick={() => onSelect(projectsById.get(row.projectId), row.subprojectId)}>{row.name}<ChevronRight size={14}/></button>{row.parentName && <small>{row.parentName}</small>}</td>
          <td className="monthlyOrderCustomer">{row.customer || '未填写客户'}</td>
          <td><span className={'monthlyStage ' + stageClass(row.status)} title={row.status === '意向' ? '意向客户，待跟踪' : undefined}><i aria-hidden="true"/>{row.status || '未设置'}{row.status === '意向' && <b className="monthlyStageTrack">待跟踪</b>}</span></td>
          <td className="monthlyOrderAmount"><strong>{formatMoney(row.received)}</strong>{row.unallocated > 0 && <small className="monthlyAllocationHint">另有款项未分配</small>}</td>
          <td className="monthlyOrderAmount"><Balance row={row}/></td>
          <td className="monthlyOrderDate"><time dateTime={row.orderDate}>{row.orderDate || '未填写日期'}</time>{row.dateSource === 'created' && <small>按建档日期归月</small>}</td>
        </tr>)}</tbody>
      </ManagedTable></div> : <div className="monthlyOrderEmpty"><FolderOpen size={31}/><h3>{busy ? '订单加载中' : monthRows.length ? '没有符合条件的订单' : '这个月还没有订单'}</h3><p>{monthRows.length ? '可切换状态筛选，或搜索其他名称。' : '更换月份可以查看其他月份的接单情况。'}</p>{monthRows.length > 0 && <button type="button" disabled={busy} onClick={() => {setFilter('全部'); setSearch('');}}>查看本月全部订单</button>}</div>}
      <div className="monthlyOrderFooter"><span>按接单日期归月；未填写接单日期时按建档日期归月。</span><span>显示 {visibleRows.length} / {monthRows.length} 项</span></div>
    </section>
  </div>;
}
