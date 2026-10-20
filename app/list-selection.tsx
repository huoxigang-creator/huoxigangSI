'use client';

import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import './list-selection.css';

export function useListSelection<T extends {id: string}>(rows: T[], scope: string) {
  const visibleRows = useMemo(() => [...new Map(rows.map(row => [row.id, row])).values()], [rows]);
  const visibleIds = useMemo(() => new Set(visibleRows.map(row => row.id)), [visibleRows]);
  const idsKey = JSON.stringify([...visibleIds]);
  const [state, setState] = useState<{scope: string; ids: string[]}>({scope, ids: []});
  const selectedIds = state.scope === scope ? state.ids.filter(id => visibleIds.has(id)) : [];
  const selectedSet = new Set(selectedIds);
  const selectedRows = visibleRows.filter(row => selectedSet.has(row.id));

  useEffect(() => {
    const available = new Set<string>(JSON.parse(idsKey));
    setState(previous => {
      if (previous.scope !== scope) return {scope, ids: []};
      const ids = previous.ids.filter(id => available.has(id));
      return ids.length === previous.ids.length ? previous : {scope, ids};
    });
  }, [scope, idsKey]);

  const clear = useCallback(() => setState({scope, ids: []}), [scope]);
  const toggle = useCallback((id: string) => {
    if (!visibleIds.has(id)) return;
    setState(previous => {
      const ids = previous.scope === scope ? previous.ids.filter(value => visibleIds.has(value)) : [];
      return {scope, ids: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]};
    });
  }, [scope, visibleIds]);
  const toggleAll = useCallback(() => {
    setState(previous => {
      const ids = previous.scope === scope ? previous.ids.filter(id => visibleIds.has(id)) : [];
      return {scope, ids: visibleIds.size > 0 && ids.length === visibleIds.size ? [] : [...visibleIds]};
    });
  }, [scope, visibleIds]);
  const retain = useCallback((ids: string[]) => {
    const requested = new Set(ids);
    setState(previous => ({scope, ids: previous.scope === scope ? previous.ids.filter(id => visibleIds.has(id) && requested.has(id)) : []}));
  }, [scope, visibleIds]);

  return {
    selectedIds,
    selectedRows,
    allSelected: visibleRows.length > 0 && selectedRows.length === visibleRows.length,
    partiallySelected: selectedRows.length > 0 && selectedRows.length < visibleRows.length,
    toggle,
    toggleAll,
    clear,
    retain,
  };
}

export function SelectionCheckbox({checked, mixed = false, label, onChange, disabled = false}: {
  checked: boolean; mixed?: boolean; label: string; onChange: () => void; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {if (input.current) input.current.indeterminate = mixed;}, [mixed]);
  return <label className="selectionCheckbox" title={label}>
    <input ref={input} type="checkbox" checked={checked} aria-checked={mixed ? 'mixed' : checked} aria-label={label} disabled={disabled} onChange={onChange}/>
    <span className="selectionOnlyLabel">{label}</span>
  </label>;
}

export function SelectionToolbar({selection, count, busy = false, children, onClear}: {
  selection: number; count?: number; busy?: boolean; children?: ReactNode; onClear?: () => void;
}) {
  return <div className="selectionToolbar" role="toolbar" aria-label="列表操作" aria-busy={busy}>
    <div className="selectionSummary" aria-live="polite"><span>已选 <strong>{selection}</strong> 项</span>{count !== undefined && <span className="selectionCount">共 {count} 项</span>}</div>
    <div className="selectionActions">{children}{onClear && selection > 0 && <button type="button" className="selectionClear" disabled={busy} onClick={onClear}>取消选择</button>}</div>
  </div>;
}
