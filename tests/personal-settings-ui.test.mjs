import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import {createRequire} from 'node:module';import {setImmediate as tick} from 'node:timers/promises';import React from 'react';import ts from 'typescript';
const require=createRequire(import.meta.url);
function harness(saved={configured:false,question:''}){
 const slots=[],effects=[],requests=[];let cursor=0;
 const hooks={...React,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useEffect(fn){cursor++;if(!effects.length)effects.push(fn);else if(effects.length===1)effects.push(fn);}};
 const module={exports:{}};const code=ts.transpileModule(readFileSync('app/personal-settings.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const fetch=async(url,options={})=>{requests.push({url,...options});if(url==='/api/auth/me')return Response.json({id:'test',username:'test',display_name:'测试',role:'owner',phone:null});if(options.method==='POST'){const b=JSON.parse(options.body);saved={configured:true,question:b.question};return Response.json({ok:true,...saved});}return Response.json(saved);};
 runInNewContext(code,{exports:module.exports,module,require:n=>n==='react'?hooks:n==='./security-answer-input'?{default:function Answer(){}}:require(n),fetch,Response});
 const render=()=>{cursor=0;return module.exports.default({onClose(){},onSaved(){}});};render();effects.forEach(f=>f());
 return {render,requests,saved:()=>saved};
}
const nodes=t=>!t||typeof t!=='object'?[]:[t,...React.Children.toArray(t.props?.children).flatMap(nodes)];
const text=t=>typeof t==='string'?t:!t||typeof t!=='object'?'':React.Children.toArray(t.props?.children).map(text).join('');
const field=(tree,label)=>nodes(tree).find(n=>n.type==='label'&&text(n).startsWith(label))?.props.children[1];
const answer=(tree,label)=>nodes(tree).find(n=>n.props?.label===label);
const button=tree=>nodes(tree).find(n=>n.type==='button'&&/保存安全问题|修改安全问题并保存/.test(text(n)));
test('security settings shows local mismatch, accepts two Chinese characters and reopens saved question with blank answers',async()=>{
 const h=harness();await tick();await tick();let tree=h.render();field(tree,'安全问题').props.onChange({target:{value:'合成测试专用问题'}});answer(tree,'安全答案').props.onChange('春天');answer(tree,'再次输入答案').props.onChange('秋天');field(tree,'当前登录密码').props.onChange({target:{value:'Synthetic-Test-Password'}});tree=h.render();button(tree).props.onClick();await tick();tree=h.render();assert.ok(nodes(tree).some(n=>n.props?.role==='alert'&&text(n).includes('不一致')));assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
 answer(tree,'再次输入答案').props.onChange('春天');tree=h.render();button(tree).props.onClick();await tick();await tick();tree=h.render();assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert.ok(text(tree).includes('安全问题已保存'));assert.equal(answer(tree,'安全答案').props.value,'');
 const reopened=harness(h.saved());await tick();await tick();tree=reopened.render();assert.equal(field(tree,'安全问题').props.value,'合成测试专用问题');assert.ok(text(tree).includes('已设置安全问题'));assert.equal(answer(tree,'安全答案').props.value,'');
});
