'use client';
import {Children, Fragment, cloneElement, createContext, isValidElement, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode} from 'react';
import {ArrowDown, ArrowUp, Menu, Settings2, X} from 'lucide-react';
import {clampTableColumnWidth, dropTableColumn, dropTableRow, emptyTablePreferences, mergeVisibleOrder, moveTableRow, orderedColumns, orderedRows, readTablePreferences, tablePreferenceKey, type TablePreferences} from '../lib/table-preferences';
import './managed-table.css';

const PreferenceOwner = createContext('');
export function TablePreferencesProvider({scope, children}: {scope: string; children: ReactNode}) {
  return <PreferenceOwner.Provider value={scope}>{children}</PreferenceOwner.Provider>;
}
type Element = ReactElement<any>;
function elements(value: ReactNode): Element[] {const result: Element[] = []; Children.forEach(value, child => {if (isValidElement(child)) {if (child.type === Fragment) result.push(...elements((child.props as any).children)); else result.push(child as Element);}}); return result;}
function labelText(value: ReactNode): string {if (typeof value === 'string' || typeof value === 'number') return String(value); if (Array.isArray(value)) return value.map(labelText).join(''); if (isValidElement(value)) return labelText((value.props as any).children); return '';}
function rowID(row: Element, index: number) {return String(row.props['data-row-id'] ?? row.key ?? 'row-' + index);}

type Props = HTMLAttributes<HTMLTableElement> & {tableKey: string; preferenceScope?: string; disabled?: boolean; resizable?: boolean; columnReorder?: boolean; allRowOrder?: string[]; onRowsReorder?: (ids: string[]) => void};
/** Reuses the existing cells, selection and business actions; preferences stay local. */
export default function ManagedTable({children, tableKey, preferenceScope = '', disabled = false, resizable = true, columnReorder = true, allRowOrder, onRowsReorder, className = '', ...props}: Props) {
  const owner = useContext(PreferenceOwner), storageKey = tablePreferenceKey(owner, tableKey, preferenceScope);
  const [state, setState] = useState<{key: string; preferences: TablePreferences}>({key: '', preferences: emptyTablePreferences()});
  const [settings, setSettings] = useState(false), [draftHidden, setDraftHidden] = useState<string[]>([]), [draftResetColumns, setDraftResetColumns] = useState(false), [expanded, setExpanded] = useState(''), [feedback, setFeedback] = useState('');
  const drag = useRef('');
  const columnDrag = useRef<{key: string; from: string; to: string; pointerId: number; handle: HTMLElement} | null>(null);
  const focusMemory = useRef<{key: string; element: HTMLElement; start?: number | null; end?: number | null; direction?: 'forward' | 'backward' | 'none' | null} | null>(null);
  const [draggingColumn, setDraggingColumn] = useState(''), [columnTarget, setColumnTarget] = useState('');
  const table = useRef<HTMLTableElement>(null), latest = useRef<{key: string; preferences: TablePreferences}>({key: '', preferences: emptyTablePreferences()});
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; }, [storageKey]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const top = element.getBoundingClientRect().top;
      const bottom = element.closest('[role="dialog"]')?.querySelector('.tableEditorFooter,.qwDialogFoot,.modalFoot');
      const reserve = bottom?.getBoundingClientRect().height || 24;
      element.style.setProperty('--table-available-height', Math.max(100, window.innerHeight - Math.max(0, top) - reserve - 16) + 'px');
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (element.parentElement) observer?.observe(element.parentElement);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  });
  const resize = useRef<{key: string; id: string; startX: number; startWidth: number; minimum: number; widths: Record<string, number>; original: TablePreferences; pointerId: number; handle: HTMLElement} | null>(null);
  const [layout, setLayout] = useState<{key: string; widths: Record<string, number>}>({key: '', widths: {}}), [resizing, setResizing] = useState('');
  const preferences = state.key === storageKey ? state.preferences : emptyTablePreferences();
  latest.current = {key: storageKey, preferences};
  useEffect(() => {let preferences = emptyTablePreferences(); if (owner) {try {preferences = readTablePreferences(localStorage.getItem(storageKey));} catch {}} setState({key: storageKey, preferences}); setSettings(false); setExpanded('');}, [storageKey, owner]);
  function update(preferences: TablePreferences, persist = true) {latest.current = {key: storageKey, preferences}; setState({key: storageKey, preferences}); if (persist && owner) {try {localStorage.setItem(storageKey, JSON.stringify(preferences));} catch {setFeedback('设置已应用，本次浏览器无法保存偏好。');}}}

  const sections = elements(children), header = sections.find(section => section.type === 'thead');
  const headerRow = header && elements(header.props.children).find(row => row.type === 'tr');
  const cells = headerRow ? elements(headerRow.props.children) : [];
  const seen = new Map<string, number>();
  const columns = cells.map((cell, index) => {const label = labelText(cell.props.children).trim(), base = String(cell.props['data-column-key'] || label || 'selection-' + index), explicitlyRequired = cell.props['data-column-required'] === true || cell.props['data-column-required'] === 'true', explicitlyFixed = cell.props['data-column-fixed'] === true || cell.props['data-column-fixed'] === 'true', selection = !label || (explicitlyRequired && base === 'quote-line-selection'), occurrence = seen.get(base) || 0; seen.set(base, occurrence + 1); return {id: base + (occurrence ? ':' + occurrence : ''), label: selection ? '勾选' : label, fixed: explicitlyFixed || selection || label === '操作', required: explicitlyRequired || selection || label === '操作', minimum: selection || label === '序号' || label === '编号' ? 36 : 80, index};});
  const bodies = sections.filter(section => section.type === 'tbody');
  const rows = bodies.flatMap(section => elements(section.props.children)).filter(row => row.type === 'tr');
  const layoutRows = sections.filter(section => ['thead', 'tbody', 'tfoot'].includes(String(section.type))).flatMap(section => elements(section.props.children)).filter(row => row.type === 'tr');
  const hasComplexCells = elements(header?.props.children).length !== 1 || layoutRows.some(row => {const rowCells = elements(row.props.children); return rowCells.length !== columns.length || rowCells.some(cell => Number(cell.props.colSpan || 1) !== 1 || Number(cell.props.rowSpan || 1) !== 1);});
  const canColumnReorder = columnReorder && !hasComplexCells;
  const displayedColumns = orderedColumns(columns, canColumnReorder ? preferences.columnOrder || [] : []);
  const hidden = new Set(preferences.hidden);
  const visibleColumns = displayedColumns.filter(column => column.required || !hidden.has(column.id));
  // Keep at least one data column even if a damaged preference hides everything.
  if (columns.some(column => !column.required) && !visibleColumns.some(column => !column.required)) {visibleColumns.push(displayedColumns.find(column => !column.required)!); visibleColumns.sort((a, b) => displayedColumns.indexOf(a) - displayedColumns.indexOf(b));}
  const visibleIndexes = new Set(visibleColumns.map(column => column.index));
  const columnKey = JSON.stringify(columns.map(column => column.id));
  useEffect(() => {
    if (!resizable) return;
    const headers = table.current?.querySelectorAll<HTMLTableCellElement>('thead tr:first-child > th'), measured: Record<string, number> = {...(layout.key === storageKey ? layout.widths : {})};
    for (const column of columns) {if (measured[column.id] !== undefined) continue; const position = visibleColumns.findIndex(value => value.id === column.id), width = position >= 0 ? headers?.[position]?.getBoundingClientRect().width : undefined, fallback = column.minimum === 36 ? 48 : /名称|项目/.test(column.label) ? 220 : /备注/.test(column.label) ? 240 : 140; measured[column.id] = clampTableColumnWidth(width && width > 0 ? width : fallback, column.minimum);}
    setLayout({key: storageKey, widths: measured});
  }, [storageKey, resizable, columnKey]);
  function releasePointer(handle: HTMLElement, pointerId: number) {try {if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture?.(pointerId);} catch {}}
  useEffect(() => {const active = resize.current; if (active && (active.key !== storageKey || !resizable || disabled)) {resize.current = null; setResizing(''); releasePointer(active.handle, active.pointerId); if (active.key === storageKey) update(active.original, false);}}, [storageKey, resizable, disabled]);
  function widthFor(column: typeof columns[number]) {return clampTableColumnWidth(preferences.widths?.[column.id] ?? (layout.key === storageKey ? layout.widths[column.id] : undefined) ?? (column.minimum === 36 ? 48 : 140), column.minimum);}
  function resizeWidths(id: string, width: number, base: Record<string, number>) {const current = latest.current.preferences; update({...current, widths: {...current.widths, ...base, [id]: width}}, false);}
  function startResize(event: any, column: typeof columns[number]) {
    if (disabled || !resizable || resize.current || columnDrag.current || !Number.isFinite(event.clientX) || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    const widths = Object.fromEntries(columns.map(value => [value.id, widthFor(value)]));
    resize.current = {key: storageKey, id: column.id, startX: event.clientX, startWidth: widthFor(column), minimum: column.minimum, widths, original: latest.current.preferences, pointerId: event.pointerId, handle: event.currentTarget};
    drag.current = ''; setResizing(column.id); try {event.currentTarget.setPointerCapture?.(event.pointerId);} catch {finishResize({pointerId: event.pointerId}, true);}
  }
  function moveResize(event: any) {const active = resize.current; if (!active || active.key !== storageKey || event.pointerId !== active.pointerId || disabled) return; event.preventDefault(); event.stopPropagation(); resizeWidths(active.id, clampTableColumnWidth(active.startWidth + event.clientX - active.startX, active.minimum), active.widths);}
  function finishResize(event: any, cancelled = false) {
    const active = resize.current; if (!active || event.pointerId !== active.pointerId) return;
    if (!cancelled && Number.isFinite(event.clientX)) moveResize(event);
    resize.current = null; setResizing('');
    if (active.key === storageKey) update(cancelled ? active.original : latest.current.preferences, !cancelled);
    releasePointer(active.handle, active.pointerId);
  }
  function resizeByKey(event: any, column: typeof columns[number]) {
    if (disabled || !resizable || resize.current || columnDrag.current) return;
    const current = latest.current.preferences, before = clampTableColumnWidth(current.widths?.[column.id] ?? widthFor(column), column.minimum), step = event.shiftKey ? 50 : 10;
    const next = event.key === 'ArrowLeft' ? before - step : event.key === 'ArrowRight' ? before + step : event.key === 'Home' ? column.minimum : event.key === 'End' ? 1200 : undefined;
    if (next === undefined) return; event.preventDefault(); event.stopPropagation();
    update({...current, widths: {...Object.fromEntries(columns.map(value => [value.id, widthFor(value)])), ...current.widths, [column.id]: clampTableColumnWidth(next, column.minimum)}});
  }
  function resizeHandle(column: typeof columns[number]) {return <span key="column-resize" className={'managedColumnResizeHandle' + (resizing === column.id ? ' isResizing' : '')} role="separator" tabIndex={disabled ? -1 : 0} aria-orientation="vertical" aria-label={'调整' + column.label + '列宽'} aria-disabled={disabled} aria-valuemin={column.minimum} aria-valuemax={1200} aria-valuenow={widthFor(column)} aria-valuetext={widthFor(column) + '像素'} title="拖动调整列宽；左右方向键每次10像素，Shift每次50像素" onPointerDown={event => startResize(event, column)} onPointerMove={moveResize} onPointerUp={event => finishResize(event)} onPointerCancel={event => finishResize(event, true)} onLostPointerCapture={event => finishResize({pointerId: event.pointerId}, true)} onKeyDown={event => resizeByKey(event, column)} onClick={event => {event.preventDefault(); event.stopPropagation();}}/>;}

  function stopColumnDrag() {
    const active = columnDrag.current; columnDrag.current = null; setDraggingColumn(''); setColumnTarget('');
    if (active) releasePointer(active.handle, active.pointerId);
  }
  useEffect(() => {if (columnDrag.current && (columnDrag.current.key !== storageKey || !canColumnReorder || disabled)) stopColumnDrag(); if (disabled) setSettings(false);}, [storageKey, canColumnReorder, disabled]);
  useEffect(() => {
    const memory = focusMemory.current; focusMemory.current = null;
    if (!memory || memory.key !== storageKey || typeof document === 'undefined' || !memory.element.isConnected || document.activeElement === memory.element) return;
    memory.element.focus({preventScroll: true});
    if (memory.start !== undefined && 'setSelectionRange' in memory.element) {try {(memory.element as HTMLInputElement).setSelectionRange(memory.start, memory.end ?? memory.start, memory.direction || undefined);} catch {}}
  }, [storageKey, preferences.columnOrder]);
  function applyColumnOrder(from: string, to: string) {
    if (disabled || !canColumnReorder || resize.current) return;
    const current = latest.current.preferences, orderedColumnsNow = orderedColumns(columns, current.columnOrder || []).map(column => ({...column, hidden: !column.required && hidden.has(column.id)}));
    const next = dropTableColumn(orderedColumnsNow, from, to);
    if (next.every((id, index) => id === orderedColumnsNow[index].id)) return;
    if (typeof document !== 'undefined') {
      const focused = document.activeElement;
      if (focused && table.current?.contains(focused) && focused.matches('input,textarea,select,[contenteditable=true],.managedColumnOrderHandle')) {
        const field = focused as HTMLInputElement;
        focusMemory.current = {key: storageKey, element: field, ...(typeof field.selectionStart === 'number' ? {start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection} : {})};
      }
    }
    update({...current, columnOrder: next});
  }
  function columnAt(event: any) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return '';
    const headers = table.current?.querySelectorAll<HTMLTableCellElement>('thead tr:first-child > th[data-column-id]');
    for (const cell of headers || []) {const rect = cell.getBoundingClientRect(), id = cell.dataset.columnId;
      if (event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom && visibleColumns.some(column => column.id === id && !column.fixed)) return id || '';
    }
    return '';
  }
  function startColumnDrag(event: any, column: typeof columns[number]) {
    if (disabled || !canColumnReorder || column.fixed || resize.current || columnDrag.current || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation(); drag.current = '';
    columnDrag.current = {key: storageKey, from: column.id, to: '', pointerId: event.pointerId, handle: event.currentTarget};
    setDraggingColumn(column.id); setColumnTarget('');
    try {event.currentTarget.setPointerCapture?.(event.pointerId);} catch {stopColumnDrag();}
  }
  function moveColumnDrag(event: any) {
    const active = columnDrag.current; if (!active || active.key !== storageKey || event.pointerId !== active.pointerId || disabled) return;
    event.preventDefault(); event.stopPropagation(); active.to = columnAt(event); setColumnTarget(active.to);
  }
  function finishColumnDrag(event: any, cancelled = false) {
    const active = columnDrag.current; if (!active || event.pointerId !== active.pointerId) return;
    if (!cancelled) moveColumnDrag(event);
    const target = active.to; stopColumnDrag();
    if (!cancelled && active.key === storageKey && target) applyColumnOrder(active.from, target);
  }
  function moveColumnByKey(event: any, column: typeof columns[number]) {
    if (event.key === 'Escape') {if (columnDrag.current) {event.preventDefault(); stopColumnDrag();} return;}
    if (disabled || !canColumnReorder || resize.current || columnDrag.current || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const movable = visibleColumns.filter(value => !value.fixed), from = movable.findIndex(value => value.id === column.id), target = movable[from + (event.key === 'ArrowLeft' ? -1 : 1)];
    if (target) applyColumnOrder(column.id, target.id);
  }
  function columnOrderHandle(column: typeof columns[number]) {return null;}
  const allIDs = rows.map(rowID), byID = new Map(rows.map((row, index) => [rowID(row, index), row]));
  const ordered = orderedRows(allIDs, id => id, preferences.order);
  function applyOrder(next: string[]) {if (disabled || resize.current || columnDrag.current) return; const base = orderedRows([...new Set([...(allRowOrder || []), ...allIDs])], id => id, preferences.order); update({...preferences, order: mergeVisibleOrder(base, next)}); onRowsReorder?.(next);}
  function openSettings() {if (disabled || resize.current || columnDrag.current) return; setDraftHidden([...preferences.hidden]); setDraftResetColumns(false); setSettings(true); setFeedback('');}
  function filteredCells(row: Element, header = false): Element[] {
    let cursor = 0; const result: {cell: Element; index: number}[] = [];
    elements(row.props.children).forEach((cell, index) => {
      const start = cursor, column = columns[start], span = Math.max(1, Number(cell.props.colSpan || 1)), count = Array.from({length: span}, (_v, offset) => start + offset).filter(value => visibleIndexes.has(value)).length;
      cursor += span; if (!count) return;
      const single = span === 1 && !!column, movable = single && header && canColumnReorder && !column.fixed;
      result.push({index: start, cell: cloneElement(cell, {
        key: cell.key ?? (column ? 'column-' + column.id : 'cell-' + index),
        ...(span > 1 ? {colSpan: count} : {}),
        ...(single ? {'data-column-id': column.id} : {}),
        ...(header && single ? {className: (cell.props.className || '') + (resizable ? ' managedResizableHeader' : '') + (movable ? ' managedReorderHeader managedHeaderDrag' : '') + (draggingColumn === column.id ? ' isColumnDragging' : '') + (columnTarget === column.id && draggingColumn !== column.id ? ' isColumnTarget' : ''), title: cell.props.title || (movable ? '拖动表头文字调整列顺序' : columnReorder && hasComplexCells ? '此表含合并单元格，列顺序固定；可调整列宽' : undefined), ...(movable ? {onPointerDown: (event: any) => startColumnDrag(event, column), onPointerMove: (event: any) => moveColumnDrag(event), onPointerUp: (event: any) => finishColumnDrag(event), onPointerCancel: (event: any) => finishColumnDrag(event, true), onLostPointerCapture: (event: any) => finishColumnDrag(event, true), onKeyDown: (event: any) => moveColumnByKey(event, column)} : {})} : {}),
      }, cell.props.children, ...(movable ? [columnOrderHandle(column)] : []), ...(single && header && resizable ? [resizeHandle(column)] : []))});
    });
    return canColumnReorder ? visibleColumns.map(column => result.find(value => value.index === column.index)!.cell) : result.map(value => value.cell);
  }
  const configButton = <th key="managed-control" className="managedTableControls managedTableHeader" scope="col"><button type="button" title="显示字段设置" aria-label="显示字段设置" onClick={openSettings} disabled={disabled || !!resizing || !!draggingColumn}><Settings2 size={17}/></button></th>;
  const rendered = sections.map((section, sectionIndex) => {
    if (section.type === 'thead') return cloneElement(section, {key: 'head-' + sectionIndex}, elements(section.props.children).map((row, index) => cloneElement(row, {key: row.key || index}, [...filteredCells(row, index === 0), configButton])));
    if (section.type === 'tbody') {if (section !== bodies[0]) return null; return cloneElement(section, {key: 'body-' + sectionIndex}, ordered.map((id, index) => {const row = byID.get(id)!; const content = filteredCells(row), originalDrop = row.props.onDrop;
      return cloneElement(row, {key: id, 'data-row-id': id, onDragOver: (event: any) => {if (drag.current && !disabled) event.preventDefault();}, onDrop: (event: any) => {if (drag.current && !disabled && !resize.current && !columnDrag.current) {event.preventDefault(); if (ordered.includes(drag.current) && drag.current !== id) applyOrder(dropTableRow(ordered, drag.current, id)); drag.current = '';} originalDrop?.(event);}}, [...content,
        <td key="managed-control" className="managedTableControls"><div className={'managedRowButtons ' + (expanded === id ? 'isExpanded' : '')}>
          <button type="button" className="managedRowGrip" draggable={!disabled && ordered.length > 1} onDragStart={event => {if (disabled || resize.current || columnDrag.current) {event.preventDefault(); return;} drag.current = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-gugemei-row', id);}} onDragEnd={() => {drag.current = '';}} disabled={disabled} aria-label={'移动第' + (index + 1) + '行'} aria-expanded={expanded === id} title="拖动排序，或点击后上下移动" onClick={() => setExpanded(expanded === id ? '' : id)}><Menu size={17}/></button>
          <button type="button" className="managedRowArrow" title="上移" aria-label={'上移第' + (index + 1) + '行'} disabled={disabled || index === 0} onClick={() => applyOrder(moveTableRow(ordered, id, -1))}><ArrowUp size={14}/></button>
          <button type="button" className="managedRowArrow" title="下移" aria-label={'下移第' + (index + 1) + '行'} disabled={disabled || index === ordered.length - 1} onClick={() => applyOrder(moveTableRow(ordered, id, 1))}><ArrowDown size={14}/></button>
        </div></td>]);}));}
    if (section.type === 'tfoot') return cloneElement(section, {key: 'foot-' + sectionIndex}, elements(section.props.children).map((row, index) => cloneElement(row, {key: row.key || index}, [...filteredCells(row), <td key="managed-control" className="managedTableControls"/>])));
    return section;
  });
  const fixed = resizable && layout.key === storageKey, totalWidth = visibleColumns.reduce((sum, column) => sum + widthFor(column), 102);
  return <>
    <div ref={viewport} className="managedTableViewport" tabIndex={0} role="region" aria-label="表格滚动区域">
    <table {...props} ref={table} style={{...props.style, ...(fixed ? {tableLayout: 'fixed', width: totalWidth, minWidth: totalWidth} : {})}} className={'managedTable ' + (fixed ? 'managedTableResizable ' : '') + className}>
      {fixed && <colgroup>{visibleColumns.map(column => <col key={column.id} data-column-id={column.id} style={{width: widthFor(column)}}/>)}<col className="managedControlColumn" style={{width: 102}}/></colgroup>}{rendered}
    </table>
    </div>
    {columnReorder && hasComplexCells && <p className="managedTableFeedback managedColumnOrderNotice">此表含合并单元格，列顺序固定；仍可拖动边界调整列宽。</p>}
    {feedback && <p className="managedTableFeedback" role="status">{feedback}</p>}
    {settings && !disabled && <div className="overlay managedColumnsOverlay"><section className="modal managedColumnsDialog" role="dialog" aria-modal="true" aria-label="显示字段管理">
      <div className="modalHead"><h2>显示字段管理</h2><button type="button" aria-label="关闭字段设置" onClick={() => setSettings(false)}><X size={20}/></button></div>
      <div className="managedColumnsBody"><p>勾选需要显示的列；拖动表头调整顺序，拖动列边界调整宽度。行移动按钮始终保留。</p>{columns.map(column => <label key={column.id}><span>{column.label}</span><input type="checkbox" checked={column.required || !draftHidden.includes(column.id)} disabled={column.required} onChange={event => setDraftHidden(current => event.target.checked ? current.filter(id => id !== column.id) : [...current, column.id])}/><small>{column.required ? '固定显示' : draftHidden.includes(column.id) ? '隐藏' : '显示'}</small></label>)}</div>
      <div className="modalFoot"><button type="button" onClick={() => {setDraftHidden([]); setDraftResetColumns(true);}}>恢复默认</button><button type="button" onClick={() => setSettings(false)}>取消</button><button type="button" className="primary" onClick={() => {
        if (columns.some(column => !column.required) && !columns.some(column => !column.required && !draftHidden.includes(column.id))) {setFeedback('至少保留一列数据。'); return;}
        update({...latest.current.preferences, hidden: draftHidden, ...(draftResetColumns ? {widths: undefined, columnOrder: undefined} : {})}); setSettings(false);
      }}>确定</button></div>{feedback && <p className="managedTableFeedback" role="status">{feedback}</p>}
    </section></div>}
  </>;
}
