import {createWechatPayAdapter, randomWechatToken, wechatPayConfiguration, wechatTokenHash,
  WechatPayError, type WechatPayEnvironment, type WechatTransaction} from './wechat-pay';

export type PaymentShare = { id: string; owner: string; quote_id: string; project_id: string;
  quote_title?: string; snapshot: {title: string; total: number; settlement?: {receivable: number} | null;
    payment_mode?: 'manual_code' | 'wechat'; payment_code?: unknown};
  collection: {name: string; amount: number} | null; expires_at: string };
type Row = {id: string; owner: string; kind: string; project: string; data: string; created: string};
type Order = {share_id: string; quote_id: string; project_id: string; quote_title: string;
  name: string; amount: number; out_trade_no: string; mchid: string; appid: string;
  method: 'native' | 'jsapi'; status: 'pending' | 'preparing' | 'ready' | 'paid' | 'closed';
  description: string; expires_at: string; code_url?: string; jsapi_params?: Record<string, string>;
  code_expires_at?: number; lease?: string; lease_until?: number; last_checked?: number; payer_openid?: string;
  wechat_transaction_id?: string; transaction_record_id?: string; success_time?: string};
type Adapter = ReturnType<typeof createWechatPayAdapter>;
type Dependencies = {database: () => D1Database | undefined; environment: () => WechatPayEnvironment;
  readShare: (token: string) => Promise<PaymentShare>; fetch?: typeof fetch; now?: () => number;
  adapter?: () => Adapter};
const SESSION_SECONDS = 3600, OAUTH_SECONDS = 600;
export const WECHAT_OAUTH_COOKIE = '__Host-gmg-wx-oauth';
export const WECHAT_SESSION_COOKIE = '__Host-gmg-wx-session';

function changes(result: any) {
  if (!Number.isSafeInteger(result?.meta?.changes)) throw new WechatPayError('无法确认支付保存结果，请稍后查询', 503, 'PAYMENT_STORAGE_ERROR');
  return Number(result.meta.changes);
}
function description(value: string) {
  const encoder = new TextEncoder(); let output = '';
  for (const char of value) {if (encoder.encode(output + char).length > 127) break; output += char;}
  return output || '报价收款';
}
function tokenFormat(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new WechatPayError('报价链接不存在或已失效', 404, 'SHARE_UNAVAILABLE');
}

export function createQuotePaymentService(deps: Dependencies) {
  const now = deps.now || Date.now;
  const adapter = () => deps.adapter?.() || createWechatPayAdapter(deps.environment(), {fetch: deps.fetch, now});
  function database() {const value = deps.database(); if (!value) throw new WechatPayError('数据库尚未就绪', 503, 'PAYMENT_STORAGE_ERROR'); return value;}
  async function row(id: string, kind: string) {
    const result = await database().prepare('SELECT * FROM records WHERE id=? AND kind=? LIMIT 1').bind(id, kind).all<Row>();
    return result.results[0];
  }
  function unpack(record: Row) {return JSON.parse(record.data) as Order;}
  async function readShare(token: string) {tokenFormat(token); return deps.readShare(token);}
  function assertAutomaticPayment(share: PaymentShare) {
    if (share.snapshot.payment_mode === 'manual_code' || share.snapshot.payment_code) {
      throw new WechatPayError('该报价使用收款码图片，付款后由商家确认到账', 409, 'MANUAL_PAYMENT_ONLY');
    }
  }
  function validCollection(share: PaymentShare) {
    assertAutomaticPayment(share);
    const collection = share.collection, net = share.snapshot.settlement?.receivable ?? share.snapshot.total;
    if (!collection || !collection.name?.trim() || collection.name.length > 100 || !Number.isSafeInteger(collection.amount) ||
      collection.amount < 1 || !Number.isSafeInteger(net) || collection.amount > net) {
      throw new WechatPayError('该报价尚未设置有效收款项，请联系商家', 409, 'PAYMENT_UNAVAILABLE');
    }
    return {collection, net};
  }
  function assertBinding(record: Row, share: PaymentShare) {
    const order = unpack(record);
    if (record.owner !== share.owner || record.project !== share.project_id || order.share_id !== share.id ||
      order.quote_id !== share.quote_id || order.project_id !== share.project_id ||
      order.name !== share.collection?.name || order.amount !== share.collection?.amount) throw new WechatPayError('付款订单与报价不一致，请联系商家', 409, 'PAYMENT_MISMATCH');
    return order;
  }
  function publicOrder(record: Row) {
    const order = unpack(record), paid = order.status === 'paid';
    return {order_id: order.out_trade_no, amount: order.amount, name: order.name, paid,
      status: paid ? 'paid' : order.status === 'closed' ? 'closed' : Date.parse(order.expires_at) <= now() ? 'expired' : order.status === 'ready' ? 'ready' : 'pending',
      ...(order.status === 'ready' && !paid && (order.code_expires_at || 0) > now() ?
        order.method === 'native' ? {code_url: order.code_url} : {jsapi_params: order.jsapi_params} : {})};
  }
  function validateTransaction(transaction: WechatTransaction, record: Row, success: boolean) {
    const order = unpack(record), environment = deps.environment();
    if (!transaction || transaction.mchid !== environment.WECHAT_PAY_MCHID || transaction.mchid !== order.mchid ||
      transaction.appid !== environment.WECHAT_PAY_APPID || transaction.appid !== order.appid ||
      transaction.out_trade_no !== order.out_trade_no || transaction.amount?.currency !== 'CNY' ||
      transaction.amount?.total !== order.amount || !Number.isSafeInteger(transaction.amount?.total) ||
      (transaction.amount.payer_currency !== undefined && transaction.amount.payer_currency !== 'CNY') ||
      (transaction.amount.payer_total !== undefined && (!Number.isSafeInteger(transaction.amount.payer_total) ||
        transaction.amount.payer_total < 0 || transaction.amount.payer_total > transaction.amount.total)) ||
      (success && (transaction.trade_state !== 'SUCCESS' || !/^[A-Za-z0-9_-]{1,64}$/.test(transaction.transaction_id || '') ||
        !/^\d{4}-\d{2}-\d{2}T/.test(transaction.success_time || '') || !Number.isFinite(Date.parse(transaction.success_time))))) {
      throw new WechatPayError('微信交易与付款订单不一致', 400, 'PAYMENT_MISMATCH');
    }
  }
  async function settle(record: Row, transaction: WechatTransaction) {
    validateTransaction(transaction, record, true);
    const order = unpack(record);
    if (order.status === 'paid') {
      if (order.wechat_transaction_id !== transaction.transaction_id) throw new WechatPayError('该订单已有另一笔收款，请核对', 409, 'PAYMENT_MISMATCH');
      return record;
    }
    const transactionId = 'tx:wechat:' + order.mchid + ':' + transaction.transaction_id;
    const created = new Date(now()).toISOString(), date = new Date(Date.parse(transaction.success_time) + 8 * 3600000).toISOString().slice(0, 10);
    const receipt = {type: '收款', amount: order.amount, category: '客户收款', date, note: '微信支付自动登记 · ' + order.name,
      request_id: transactionId, void: false, source_quote_id: order.quote_id, quote_title: order.quote_title,
      payment_item: order.name, payment_provider: 'wechat', wechat_transaction_id: transaction.transaction_id,
      wechat_order_id: order.out_trade_no, payment_order_id: record.id, share_id: order.share_id,
      wechat_payer_amount: transaction.amount.payer_total ?? order.amount, updated: created};
    const paid: Order = {...order, status: 'paid', wechat_transaction_id: transaction.transaction_id,
      transaction_record_id: transactionId, success_time: transaction.success_time};
    delete paid.lease; delete paid.lease_until; delete paid.code_url; delete paid.jsapi_params;
    // The three statements are one D1 transaction. Repeated/concurrent callbacks
    // never rewrite an existing receipt, resurrect a deleted receipt, or audit twice.
    // Do not re-check the share here: money already paid must survive revocation.
    await database().batch([
      database().prepare("INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM records AS payment WHERE payment.id=? AND payment.owner=? AND payment.kind='payment_order' AND payment.data=?) ON CONFLICT(id) DO NOTHING")
        .bind(transactionId, record.owner, 'transaction', record.project, JSON.stringify(receipt), created, record.id, record.owner, record.data),
      database().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes()>0 ON CONFLICT(id) DO NOTHING')
        .bind('audit:' + transactionId, record.owner, 'audit', record.project, JSON.stringify({action: 'record_wechat_receipt',
          detail: '微信支付自动登记收款：' + order.name, record_id: transactionId, source_quote_id: order.quote_id,
          payment_order_id: record.id, actor: 'wechat_pay'}), created),
      database().prepare("UPDATE records SET data=? WHERE id=? AND owner=? AND kind='payment_order' AND data=? AND EXISTS (SELECT 1 FROM records AS receipt WHERE receipt.id=? AND receipt.owner=? AND receipt.project=? AND receipt.kind='transaction' AND json_extract(receipt.data,'$.payment_order_id')=? AND json_extract(receipt.data,'$.wechat_transaction_id')=?)")
        .bind(JSON.stringify(paid), record.id, record.owner, record.data, transactionId, record.owner, record.project, record.id, transaction.transaction_id),
    ]);
    const saved = await row(record.id, 'payment_order');
    if (!saved || unpack(saved).status !== 'paid' || unpack(saved).wechat_transaction_id !== transaction.transaction_id) throw new WechatPayError('收款状态发生变化，请稍后查询', 409, 'PAYMENT_RETRY');
    return saved;
  }
  async function queryAndSettle(record: Row) {
    const transaction = await adapter().query(unpack(record).out_trade_no);
    validateTransaction(transaction, record, false);
    if (transaction.trade_state === 'SUCCESS') return settle(record, transaction);
    if (transaction.trade_state === 'CLOSED' || transaction.trade_state === 'REVOKED') {
      const closed: Order = {...unpack(record), status: 'closed'};
      await database().batch([database().prepare("UPDATE records SET data=? WHERE id=? AND kind='payment_order' AND data=?")
        .bind(JSON.stringify(closed), record.id, record.data)]);
      return await row(record.id, 'payment_order') || record;
    }
    return record;
  }
  async function status(token: string) {
    const share = await readShare(token); assertAutomaticPayment(share);
    const configuration = wechatPayConfiguration(deps.environment());
    let record = await row('qpay:' + share.id, 'payment_order');
    if (record) {
      const order = assertBinding(record, share);
      if (configuration.configured && order.status !== 'paid' && order.status !== 'closed' && (order.last_checked || 0) + 5000 < now()) {
        const checked = {...order, last_checked: now()};
        const result = await database().batch([database().prepare("UPDATE records SET data=? WHERE id=? AND kind='payment_order' AND data=?")
          .bind(JSON.stringify(checked), record.id, record.data)]);
        const fresh = await row(record.id, 'payment_order');
        if (changes(result[0]) && fresh) {try {record = await queryAndSettle(fresh);} catch {record = await row(record.id, 'payment_order') || fresh;}}
        else record = fresh || record;
      }
    }
    const shown = record ? publicOrder(record) : null;
    return {configured: configuration.configured, missing: configuration.missing,
      jsapi_configured: configuration.jsapi_configured, jsapi_missing: configuration.jsapi_missing,
      payment_name: share.collection?.name || '', amount: share.collection?.amount || 0,
      paid: shown?.paid || false, status: !share.collection ? 'unavailable' : shown?.status || 'not_requested',
      ...(shown ? {order_id: shown.order_id} : {})};
  }
  async function reserve(share: PaymentShare, method: 'native' | 'jsapi', token: string) {
    const {collection, net} = validCollection(share), environment = deps.environment();
    const id = 'qpay:' + share.id, existing = await row(id, 'payment_order');
    if (existing) {assertBinding(existing, share); return existing;}
    const created = new Date(now()).toISOString(), expires = Math.min(Date.parse(share.expires_at), now() + 7 * 86400000);
    if (!Number.isFinite(expires) || expires < now() + 60000) throw new WechatPayError('收款链接即将到期，请联系商家重新分享', 410, 'SHARE_UNAVAILABLE');
    const order: Order = {share_id: share.id, quote_id: share.quote_id, project_id: share.project_id,
      quote_title: share.quote_title || share.snapshot.title, name: collection.name, amount: collection.amount,
      out_trade_no: 'GMG' + randomWechatToken(14), mchid: environment.WECHAT_PAY_MCHID!, appid: environment.WECHAT_PAY_APPID!,
      method, status: 'pending', description: description((share.quote_title || share.snapshot.title) + ' · ' + collection.name), expires_at: new Date(expires).toISOString()};
    // Reserve against all shares for this quote in the INSERT itself. Unknown or
    // timed-out attempts remain reserved until a signed query confirms closure.
    // Automatic receipts are already counted by their payment orders; historical
    // manual receipts with source_quote_id are counted separately.
    const totalReserved = "COALESCE((SELECT SUM(json_extract(pay.data,'$.amount')) FROM records AS pay WHERE pay.owner=? AND pay.kind='payment_order' AND json_extract(pay.data,'$.quote_id')=? AND COALESCE(json_extract(pay.data,'$.status'),'pending') NOT IN ('closed','cancelled')),0) + COALESCE((SELECT SUM(json_extract(manual.data,'$.amount')) FROM records AS manual WHERE manual.owner=? AND manual.kind='transaction' AND json_extract(manual.data,'$.source_quote_id')=? AND json_extract(manual.data,'$.type')='收款' AND COALESCE(json_extract(manual.data,'$.void'),0)=0 AND COALESCE(json_extract(manual.data,'$.deleted'),0)=0 AND NOT EXISTS (SELECT 1 FROM records AS paid WHERE paid.owner=manual.owner AND paid.kind='payment_order' AND json_extract(paid.data,'$.transaction_record_id')=manual.id)),0)";
    const validShare = "EXISTS (SELECT 1 FROM records AS share WHERE share.id=? AND share.owner=? AND share.project=? AND share.kind='quote_share' AND COALESCE(json_extract(share.data,'$.revoked'),0)=0 AND COALESCE(json_extract(share.data,'$.deleted'),0)=0 AND json_extract(share.data,'$.expires_at')>? AND json_extract(share.data,'$.quote_id')=? AND json_extract(share.data,'$.snapshot.collection.amount')=? AND json_extract(share.data,'$.snapshot.collection.name')=? AND COALESCE(json_extract(share.data,'$.snapshot.payment_mode'),'wechat')='wechat' AND json_extract(share.data,'$.snapshot.payment_code') IS NULL)";
    // Project-level guard: manual receipts recorded without source_quote_id (cash,
    // bank transfer) still count, so the whole project can never be over-collected.
    // Expected = adopted quotes after settlement; a not-yet-adopted quote only adds
    // what exceeds the adopted version of its own group (versions are alternatives).
    const projectExpected = "COALESCE((SELECT SUM(json_extract(adopted.data,'$.total')) FROM records AS adopted WHERE adopted.owner=? AND adopted.project=? AND adopted.kind='quote' AND COALESCE(json_extract(adopted.data,'$.deleted'),0)=0 AND json_extract(adopted.data,'$.adopted')=1),0) - CASE WHEN COALESCE(json_extract(parent.data,'$.project_type'),'project')='customer' THEN COALESCE(json_extract(parent.data,'$.discount_amount'),0)+COALESCE(json_extract(parent.data,'$.rounding_amount'),0) ELSE 0 END + CASE WHEN json_extract(quote.data,'$.adopted')=1 THEN 0 ELSE MAX(0, ? - COALESCE((SELECT SUM(json_extract(sibling.data,'$.total')) FROM records AS sibling WHERE sibling.owner=quote.owner AND sibling.project=quote.project AND sibling.kind='quote' AND COALESCE(json_extract(sibling.data,'$.deleted'),0)=0 AND json_extract(sibling.data,'$.adopted')=1 AND COALESCE(NULLIF(json_extract(sibling.data,'$.subproject_id'),''),'legacy')=COALESCE(NULLIF(json_extract(quote.data,'$.subproject_id'),''),'legacy')),0)) END";
    const projectCollected = "COALESCE((SELECT SUM(json_extract(pay.data,'$.amount')) FROM records AS pay WHERE pay.owner=? AND pay.project=? AND pay.kind='payment_order' AND COALESCE(json_extract(pay.data,'$.status'),'pending') NOT IN ('closed','cancelled')),0) + COALESCE((SELECT SUM(json_extract(received.data,'$.amount')) FROM records AS received WHERE received.owner=? AND received.project=? AND received.kind='transaction' AND json_extract(received.data,'$.type')='收款' AND COALESCE(json_extract(received.data,'$.void'),0)=0 AND COALESCE(json_extract(received.data,'$.deleted'),0)=0 AND NOT EXISTS (SELECT 1 FROM records AS paid WHERE paid.owner=received.owner AND paid.kind='payment_order' AND json_extract(paid.data,'$.transaction_record_id')=received.id)),0)";
    const sql = "INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE " + validShare + " AND EXISTS (SELECT 1 FROM records AS quote JOIN records AS parent ON parent.id=quote.project AND parent.owner=quote.owner AND parent.kind='project' WHERE quote.id=? AND quote.owner=? AND quote.kind='quote' AND quote.project=? AND COALESCE(json_extract(quote.data,'$.deleted'),0)=0 AND COALESCE(json_extract(parent.data,'$.deleted'),0)=0 AND ? <= MIN(?,json_extract(quote.data,'$.total') - CASE WHEN COALESCE(json_extract(parent.data,'$.project_type'),'project')='customer' AND json_extract(quote.data,'$.adopted')=1 THEN COALESCE(json_extract(parent.data,'$.discount_amount'),0)+COALESCE(json_extract(parent.data,'$.rounding_amount'),0) ELSE 0 END) - (" + totalReserved + ") AND ? <= (" + projectExpected + ") - (" + projectCollected + ')) ON CONFLICT(id) DO NOTHING';
    const result = await database().batch([database().prepare(sql).bind(id, share.owner, 'payment_order', share.project_id,
      JSON.stringify(order), created, share.id, share.owner, share.project_id, created, share.quote_id, collection.amount, collection.name,
      share.quote_id, share.owner, share.project_id, collection.amount, net,
      share.owner, share.quote_id, share.owner, share.quote_id,
      collection.amount, share.owner, share.project_id, net,
      share.owner, share.project_id, share.owner, share.project_id)]);
    const saved = await row(id, 'payment_order');
    if (!changes(result[0]) && !saved) {
      await readShare(token);
      throw new WechatPayError('本次金额与已收或待付款合计超过报价应收，请联系商家核对', 409, 'PAYMENT_LIMIT_EXCEEDED');
    }
    if (!saved) throw new WechatPayError('付款订单尚未保存，请重试', 503, 'PAYMENT_STORAGE_ERROR');
    assertBinding(saved, share); return saved;
  }
  async function trustedOpenid(share: PaymentShare, sessionToken?: string) {
    if (!sessionToken || !/^[a-f0-9]{64}$/.test(sessionToken)) return null;
    const stored = await row('wx-session:' + await wechatTokenHash(sessionToken), 'wechat_session');
    if (!stored || stored.owner !== share.owner || stored.project !== share.project_id) return null;
    const data = JSON.parse(stored.data);
    if (data.share_id !== share.id || data.appid !== deps.environment().WECHAT_PAY_APPID || data.expires_at <= now() ||
      !/^[A-Za-z0-9_-]{10,128}$/.test(data.openid || '')) return null;
    return data.openid as string;
  }
  async function start(token: string, method: 'native' | 'jsapi', sessionToken?: string) {
    const share = await readShare(token), {collection} = validCollection(share), payment = adapter();
    payment.requireConfiguration(method === 'jsapi');
    let openid: string | null = null;
    if (method === 'jsapi') {
      openid = await trustedOpenid(share, sessionToken);
      if (!openid) return {authorization_url: '/api/wechat-pay/oauth?token=' + encodeURIComponent(token),
        amount: collection.amount, name: collection.name, status: 'authorization_required', paid: false};
    }
    let record = await reserve(share, method, token), order = unpack(record);
    if (order.status === 'paid') return publicOrder(record);
    if (order.status === 'closed' || Date.parse(order.expires_at) <= now()) throw new WechatPayError('此付款订单已到期，请联系商家重新分享', 410, 'PAYMENT_EXPIRED');
    if (order.method !== method) throw new WechatPayError('此订单已使用另一种付款方式，请使用原方式或联系商家', 409, 'PAYMENT_METHOD_LOCKED');
    if (method === 'jsapi' && order.payer_openid && order.payer_openid !== openid) throw new WechatPayError('此付款订单已由另一微信发起，请联系商家核对', 409, 'PAYMENT_PAYER_LOCKED');
    if (order.status === 'ready' && (order.code_expires_at || 0) > now()) return publicOrder(record);
    if (order.status === 'preparing' && (order.lease_until || 0) > now()) throw new WechatPayError('付款订单正在生成，请稍后重试', 409, 'PAYMENT_PREPARING');
    const preparing: Order = {...order, ...(method === 'jsapi' ? {payer_openid: openid!} : {}), status: 'preparing', lease: randomWechatToken(16), lease_until: now() + 30000};
    const result = await database().batch([database().prepare("UPDATE records SET data=? WHERE id=? AND kind='payment_order' AND data=?")
      .bind(JSON.stringify(preparing), record.id, record.data)]);
    if (!changes(result[0])) {const latest = await row(record.id, 'payment_order'); if (latest && unpack(latest).status === 'paid') return publicOrder(latest); throw new WechatPayError('付款状态发生变化，请稍后重试', 409, 'PAYMENT_PREPARING');}
    record = {...record, data: JSON.stringify(preparing)}; order = preparing;
    try {
      const provider = method === 'native' ? await payment.createNative({out_trade_no: order.out_trade_no, amount: order.amount, description: order.description, expires_at: order.expires_at}) :
        await payment.createJsapi({out_trade_no: order.out_trade_no, amount: order.amount, description: order.description, expires_at: order.expires_at}, openid!);
      const ready: Order = {...order, ...provider, status: 'ready', code_expires_at: Math.min(now() + 2 * 3600000, Date.parse(order.expires_at))};
      delete ready.lease; delete ready.lease_until;
      await database().batch([database().prepare("UPDATE records SET data=? WHERE id=? AND kind='payment_order' AND data=?")
        .bind(JSON.stringify(ready), record.id, record.data)]);
      const saved = await row(record.id, 'payment_order');
      if (!saved) throw new WechatPayError('无法确认付款订单，请稍后查询', 503, 'PAYMENT_STORAGE_ERROR');
      return publicOrder(saved);
    } catch (error) {
      // An interrupted prepay request may still have reached WeChat. Keep this
      // merchant order number and reservation; query before allowing a retry.
      try {const confirmed = await queryAndSettle(record); if (unpack(confirmed).status === 'paid') return publicOrder(confirmed);} catch { /* Retry notification/query later. */ }
      const pending: Order = {...order, status: 'pending'}; delete pending.lease; delete pending.lease_until;
      await database().batch([database().prepare("UPDATE records SET data=? WHERE id=? AND kind='payment_order' AND data=?")
        .bind(JSON.stringify(pending), record.id, record.data)]);
      if (error instanceof WechatPayError) throw error;
      throw new WechatPayError('付款订单未完成，请稍后重试', 503, 'PAYMENT_RETRY');
    }
  }
  async function notify(headers: Headers, raw: string) {
    const transaction = await adapter().decodeNotification(headers, raw);
    if (!transaction || !/^[A-Za-z0-9_-]{1,32}$/.test(transaction.out_trade_no || '')) throw new WechatPayError('通知订单无效');
    const found = await database().prepare("SELECT * FROM records WHERE kind='payment_order' AND json_extract(data,'$.out_trade_no')=? LIMIT 1")
      .bind(transaction.out_trade_no).all<Row>();
    if (!found.results[0]) throw new WechatPayError('付款订单尚未找到，请稍后重试', 404, 'PAYMENT_UNKNOWN');
    await settle(found.results[0], transaction);
    return {received: true};
  }
  async function beginOAuth(token: string, browserSecret: string) {
    const share = await readShare(token); validCollection(share);
    const payment = adapter(); payment.requireConfiguration(true);
    if (!/^[a-f0-9]{64}$/.test(browserSecret)) throw new WechatPayError('微信授权浏览器状态无效');
    const state = randomWechatToken(), environment = deps.environment(), expires = Math.min(now() + OAUTH_SECONDS * 1000, Date.parse(share.expires_at));
    const data = {share_id: share.id, quote_id: share.quote_id, expires_at: expires, consumed: false,
      browser_hash: await wechatTokenHash(browserSecret), token: await payment.seal(token)};
    await database().batch([database().prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)')
      .bind('wx-oauth:' + state, share.owner, 'wechat_oauth', share.project_id, JSON.stringify(data), new Date(now()).toISOString())]);
    const configuration = wechatPayConfiguration(environment);
    const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
    url.search = new URLSearchParams({appid: environment.WECHAT_PAY_APPID!, redirect_uri: configuration.origin + '/api/wechat-pay/oauth',
      response_type: 'code', scope: 'snsapi_base', state}).toString(); url.hash = 'wechat_redirect';
    return {url: url.toString()};
  }
  async function finishOAuth(state: string, code: string, browserSecret: string) {
    const payment = adapter(); payment.requireConfiguration(true);
    if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browserSecret) || !/^[A-Za-z0-9_-]{1,256}$/.test(code)) throw new WechatPayError('微信授权状态无效，请重新授权', 401, 'WECHAT_AUTH_INVALID');
    const record = await row('wx-oauth:' + state, 'wechat_oauth');
    if (!record) throw new WechatPayError('微信授权状态已失效，请重新授权', 401, 'WECHAT_AUTH_INVALID');
    const data = JSON.parse(record.data);
    if (data.consumed || data.expires_at <= now() || data.browser_hash !== await wechatTokenHash(browserSecret)) throw new WechatPayError('微信授权状态已失效，请重新授权', 401, 'WECHAT_AUTH_INVALID');
    const token = await payment.open(data.token), share = await readShare(token); validCollection(share);
    if (share.id !== data.share_id || share.owner !== record.owner || share.project_id !== record.project) throw new WechatPayError('微信授权与报价不一致', 401, 'WECHAT_AUTH_INVALID');
    const consumed = {...data, consumed: true}; delete consumed.token;
    const result = await database().batch([database().prepare("UPDATE records SET data=? WHERE id=? AND kind='wechat_oauth' AND data=?")
      .bind(JSON.stringify(consumed), record.id, record.data)]);
    if (!changes(result[0])) throw new WechatPayError('微信授权已使用，请重新授权', 401, 'WECHAT_AUTH_INVALID');
    const environment = deps.environment(), url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    url.search = new URLSearchParams({appid: environment.WECHAT_PAY_APPID!, secret: environment.WECHAT_APP_SECRET!, code, grant_type: 'authorization_code'}).toString();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    let identity: any;
    try {
      const response = await (deps.fetch || fetch)(url.toString(), {redirect: 'error', signal: controller.signal});
      const raw = await response.text(); if (!response.ok || raw.length > 16384) throw new Error('OAuth response invalid');
      identity = JSON.parse(raw);
      if (identity.errcode || !/^[A-Za-z0-9_-]{10,128}$/.test(identity.openid || '')) throw new Error('OAuth failed');
    } catch {throw new WechatPayError('微信授权未完成，请从报价页面重新授权', 401, 'WECHAT_AUTH_INVALID');}
    finally {clearTimeout(timeout);}
    const sessionToken = randomWechatToken(), session = {share_id: share.id, appid: environment.WECHAT_PAY_APPID,
      openid: identity.openid, expires_at: Math.min(now() + SESSION_SECONDS * 1000, Date.parse(share.expires_at))};
    await database().batch([database().prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)')
      .bind('wx-session:' + await wechatTokenHash(sessionToken), share.owner, 'wechat_session', share.project_id, JSON.stringify(session), new Date(now()).toISOString())]);
    return {token, sessionToken};
  }
  return {status, start, notify, beginOAuth, finishOAuth};
}
