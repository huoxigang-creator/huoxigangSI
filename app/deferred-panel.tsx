'use client';
import {Component,lazy,Suspense,type ComponentType,type ReactNode} from 'react';
class PanelLoadBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<div role="alert">功能加载失败，请检查网络后<button type="button" onClick={()=>location.reload()}>刷新页面</button></div>:this.props.children;}
}
/** Keep optional feature code out of the home page's critical download. */
export function deferredPanel<P extends object>(load:()=>Promise<{default:ComponentType<P>}>){
 const Panel=lazy(load) as ComponentType<P>;
 return function DeferredPanel(props:P){return <PanelLoadBoundary><Suspense fallback={<div role="status" className="loading">正在打开功能…</div>}><Panel {...props}/></Suspense></PanelLoadBoundary>;};
}
