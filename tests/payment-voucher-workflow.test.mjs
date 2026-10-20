import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('lib/payment-vouchers.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {savePaymentVouchers, voucherSelection, uploadPaymentVoucher, PaymentVoucherSaveError} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const payment = {id: 'tx:owner:stable-id', project: 'actual-project'};
const draft = (name, id = name) => ({id, file: new File(['voucher'], name)});

test('付款保存后部分附件失败，重试只补剩余单据，不重复登记付款', async () => {
  let created = 0, cached = null, drafts = [draft('a.pdf'), draft('b.xlsx')];
  const uploaded = [];
  const callbacks = {
    createPayment: async () => {created++; return payment;},
    onPaymentSaved: value => {cached = value;},
    onUploaded: id => {drafts = drafts.map(file => file.id === id ? {...file, uploaded: true} : file);},
  };
  await assert.rejects(savePaymentVouchers({...callbacks, payment: cached, drafts, upload: async (target, file) => {
    assert.deepEqual(target, payment);
    if (file.id === 'b.xlsx') throw new Error('网络中断');
    uploaded.push(file.id);
  }}), error => error instanceof PaymentVoucherSaveError && error.payment === payment && error.message === '网络中断');
  assert.equal(created, 1);
  assert.equal(drafts[0].uploaded, true);
  assert.equal(drafts[1].uploaded, undefined);
  await savePaymentVouchers({...callbacks, payment: cached, drafts, upload: async (target, file) => {
    assert.deepEqual(target, payment); uploaded.push(file.id);
  }});
  assert.equal(created, 1);
  assert.deepEqual(uploaded, ['a.pdf', 'b.xlsx']);
  assert.ok(drafts.every(file => file.uploaded));
});

test('财务保存失败或返回不完整结果时不上传附件、不进入已登记状态', async () => {
  for (const createPayment of [async () => {throw new Error('请求失败');}, async () => ({id: 'incomplete'})]) {
    let uploaded = false, cached = false;
    await assert.rejects(savePaymentVouchers({payment: null, drafts: [draft('x.pdf')], createPayment,
      upload: async () => {uploaded = true;}, onPaymentSaved: () => {cached = true;}, onUploaded: () => {},
    }), error => error instanceof PaymentVoucherSaveError && error.payment === null);
    assert.equal(uploaded, false); assert.equal(cached, false);
  }
});

test('不选择单据也能保存付款，附件失败可使用相同编号安全重试', async () => {
  let created = 0;
  const base = {createPayment: async () => {created++; return payment;}, onPaymentSaved: () => {}, onUploaded: () => {}};
  assert.deepEqual(await savePaymentVouchers({...base, payment: null, drafts: [], upload: async () => {throw new Error('不应上传');}}), payment);
  assert.equal(created, 1);
  const selected = voucherSelection([new File(['x'], '付款.PDF')], []);
  const stable = selected[0].id, ids = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {await savePaymentVouchers({...base, payment, drafts: selected, upload: async (value, file) => {ids.push(file.id); if (attempt === 0) throw new Error('响应丢失');}});} catch (error) {assert.equal(error.payment, payment);}
  }
  assert.deepEqual(ids, [stable, stable]);
  assert.equal(created, 1);
});

test('文件选择按每批5个和每文件10MB限制，拒绝空文件和不支持类型', () => {
  assert.throws(() => voucherSelection([new File([], '空.pdf')], []), /非空/);
  assert.throws(() => voucherSelection([new File(['x'], 'program.exe')], []), /图片/);
  assert.throws(() => voucherSelection(Array.from({length: 6}, (_, i) => new File(['x'], i+'.png')), []), /5个/);
  assert.throws(() => voucherSelection([new File([new Uint8Array(10 * 1024 * 1024 + 1)], '大.pdf')], []), /10MB/);
  assert.equal(voucherSelection([new File(['x'], '合同.docx')], [draft('表.xls')]).length, 2);
});

test('上传使用服务器返回的项目和付款编号，失败响应不得假成功', async () => {
  const original = globalThis.fetch;
  const selected = draft('付款单.pdf', 'd62f38a3-a21e-4997-ab95-e366ebf9e7b4');
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/payment-vouchers'); assert.equal(options.method, 'POST');
      assert.equal(options.body.get('project_id'), payment.project);
      assert.equal(options.body.get('transaction_id'), payment.id);
      assert.equal(options.body.get('attachment_id'), selected.id);
      assert.equal(options.body.get('file').name, selected.file.name);
      return Response.json({error: '存储失败'}, {status: 503});
    };
    await assert.rejects(uploadPaymentVoucher(payment, selected), /存储失败/);
    globalThis.fetch = async () => Response.json({ok: true});
    await uploadPaymentVoucher(payment, selected);
  } finally {globalThis.fetch = original;}
});
