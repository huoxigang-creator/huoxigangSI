import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const compile=text=>ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const url=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const details=url(compile(readFileSync('lib/payment-details.ts','utf8')));
const component=compile(readFileSync('app/payment-details.tsx','utf8')).replaceAll("from '../lib/payment-details'",`from '${details}'`).replaceAll('from "react/jsx-runtime"',`from '${import.meta.resolve('react/jsx-runtime')}'`).replaceAll("from 'lucide-react'",`from '${import.meta.resolve('lucide-react')}'`);
const {PaymentDetailsEditor,PaymentDetailSummary}=await import(url(component));
test('编辑明细的每个半填状态都可渲染，不会使登记窗口崩溃',()=>{
 for(const items of [[{name:'',amount:''}],[{name:'板材款',amount:''}],[{name:'',amount:'9939'}],[{name:'板材款',amount:'9939'},{name:'封边条款',amount:''}]]){
  const html=renderToStaticMarkup(React.createElement(PaymentDetailsEditor,{items,onChange:()=>{}}));
  assert.match(html,/付款明细/);assert.match(html,/明细金额1/);assert.match(html,/添加明细/);
 }
});
test('历史板材付款以明细显示，明细区域先于备注且使用原付款金额',()=>{
 const html=renderToStaticMarkup(React.createElement(PaymentDetailSummary,{transaction:{type:'付款',amount:993900,note:'板材款'}}));
 assert.match(html,/板材款/);assert.match(html,/9,939\.00/);assert.ok(html.indexOf('板材款')<html.indexOf('paymentDetailNote'));
});

test('付款金额输入完成自动补一行，重复完成与空值不重复添加',()=>{
 let items=[{name:'板材款',amount:'100'}];
 const nodes=value=>Array.isArray(value)?value.flatMap(nodes):React.isValidElement(value)?[value,...nodes(value.props.children)]:[];
 const amount=()=>nodes(PaymentDetailsEditor({items,onChange:value=>{items=value;}})).find(node=>node.props['aria-label']==='明细金额1');
 amount().props.onBlur();assert.equal(items.length,2);assert.deepEqual(items[1],{name:'',amount:''});amount().props.onBlur();assert.equal(items.length,2);
 items=[{name:'',amount:''}];amount().props.onBlur();assert.equal(items.length,1);
});
