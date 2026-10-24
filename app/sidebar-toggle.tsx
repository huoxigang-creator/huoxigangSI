'use client';
import {useEffect,useState} from 'react';
import {PanelLeftClose,PanelLeftOpen} from 'lucide-react';
const STORAGE_KEY='gugemeiSidebarCollapsed';
export function useSidebarPreference():[boolean,()=>void]{
 const [collapsed,setCollapsed]=useState(false);
 useEffect(()=>{try{setCollapsed(localStorage.getItem(STORAGE_KEY)==='1');}catch{}},[]);
 return [collapsed,()=>{const next=!collapsed;setCollapsed(next);try{localStorage.setItem(STORAGE_KEY,next?'1':'0');}catch{}}];
}
export function SidebarToggle({collapsed,onToggle}:{collapsed:boolean;onToggle:()=>void}){
 const label=collapsed?'展开侧边栏':'收起侧边栏';
 const Icon=collapsed?PanelLeftOpen:PanelLeftClose;
 return <button type="button" className="sidebarToggle" aria-label={label} title={label} aria-expanded={!collapsed} aria-controls="workspace-sidebar" onClick={onToggle}><Icon size={20}/></button>;
}
