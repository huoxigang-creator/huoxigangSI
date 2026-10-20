'use client';

import {createContext,useContext,type ReactNode} from 'react';

export const WorkspaceActiveContext=createContext(true);
export function useWorkspaceActive(active=true){return useContext(WorkspaceActiveContext)&&active;}
export function WorkspaceActiveProvider({active,children}:{active:boolean;children:ReactNode}){const visible=useWorkspaceActive(active);return <WorkspaceActiveContext.Provider value={visible}>{children}</WorkspaceActiveContext.Provider>;}
export function isWorkspaceElementVisible(element:Element){return !element.closest('[hidden], [aria-hidden="true"]');}
export function visibleWorkspaceDialogs(){return Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).filter(isWorkspaceElementVisible);}
