import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync('lib/codex-responses.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { codexInput, codexMessage } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
test('工具查询保留推理与 call_id，下一轮使用 function_call_output', () => {
  const output = [{ type: 'reasoning', id: 'r1', encrypted_content: 'encrypted-test' }, { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'get_workspace', arguments: '{}' }];
  const message = codexMessage({ status: 'completed', output });
  assert.equal(message.tool_calls[0].id, 'call1');
  const input = codexInput([{ role: 'system', content: 'test' }, { role: 'user', content: 'test question' }, message, { role: 'tool', tool_call_id: 'call1', content: '{"total":123}' }]);
  assert.deepEqual(input.slice(2, 4), output);
  assert.deepEqual(input[4], { type: 'function_call_output', call_id: 'call1', output: '{"total":123}' });
});
test('文本回复及拒绝均可显示，不完整回复不能误作成功', () => {
  assert.equal(codexMessage({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '查询结果' }] }] }).content, '查询结果');
  assert.equal(codexMessage({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: '无法执行' }] }] }).content, '无法执行');
  assert.throws(() => codexMessage({ status: 'incomplete', output: [] }), /未完成/);
  assert.throws(() => codexMessage({ status: 'failed' }), /完整内容/);
});

test('Codex 实际请求使用 Responses 协议及非严格工具参数，保持服务端鉴权', async () => {
  const source = readFileSync('app/api/ai/chat/route.ts', 'utf8');
  const functionSource = source.slice(source.indexOf('async function callModel('), source.indexOf('\nfunction parseArguments('));
  const js = ts.transpileModule(functionSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const fakeTools = [{ name: 'get_workspace', description: 'test', inputSchema: { type: 'object', properties: {} } }];
  let request;
  const fakeFetch = async (endpoint, init) => {
    request = { endpoint: String(endpoint), init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }) };
  };
  const call = new Function('process', 'tools', 'codexInput', 'codexMessage', 'fetch', js + '\nreturn callModel;')(
    { env: { GUGEMEI_CODEX_API_KEY: 'test-placeholder' } }, fakeTools, codexInput, codexMessage, fakeFetch);
  assert.equal((await call('codex', [{ role: 'user', content: 'test' }])).content, 'ok');
  assert.equal(request.endpoint, 'https://api.openai.com/v1/responses');
  assert.equal(request.init.headers.Authorization, 'Bearer test-placeholder');
  assert.equal(request.body.store, false);
  assert.equal(request.body.tools[0].strict, false);
  assert.equal(request.body.tools[0].name, 'get_workspace');
  assert.equal(request.body.messages, undefined);
  assert.deepEqual(request.body.include, ['reasoning.encrypted_content']);
});
