import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleMessages,renderMemo} from '../scripts/save-chat-memo.mjs';
const msg=(role,text,phase)=>JSON.stringify({type:'response_item',timestamp:'2026-10-24T07:00:00Z',payload:{type:'message',role,phase,content:[{type:role==='assistant'?'output_text':'input_text',text}]}});
test('archive contains only visible conversation and excludes injected context',()=>{
 const rows=visibleMessages([msg('system','system secret'),msg('developer','developer secret'),msg('user','# AGENTS.md instructions for project'),msg('assistant','private reasoning','analysis'),msg('assistant','unknown phase'),msg('user','<in-app-browser-context>ambient</in-app-browser-context>\nMy request: 保存聊天'),msg('assistant','已处理','final_answer'),msg('assistant','进度','commentary')].join('\n'));
 assert.deepEqual(rows.map(x=>x.text),['My request: 保存聊天','已处理','进度']);
 assert.equal(renderMemo(rows,'test').includes('private reasoning'),false);
});
test('known token formats are redacted and malformed records do not fail',()=>{
 const rows=visibleMessages('invalid\n'+msg('user','api_key=example-secret sk-abcdefghijklmnopqrstuvwxyz password=my-secret'));
 assert.equal(rows.length,1);assert.ok(!rows[0].text.includes('example-secret'));assert.ok(!rows[0].text.includes('my-secret'));assert.ok(!rows[0].text.includes('abcdefghijklmnopqrstuvwxyz'));
});
