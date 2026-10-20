/** Stored and displayed payment amounts use integer cents. */
export type PaymentItem = {name: string; amount: number};
/** Editable payment amounts are strings in yuan. */
export type PaymentItemDraft = {name: string; amount: string};
const MAX_AMOUNT = 100000000;

/** Decimal half-up rounding avoids binary-float surprises such as 1.005. */
export function paymentAmountCents(value: number | string): number {
  const text = typeof value === 'string' ? value.trim() : String(value);
  const number = Number(text);
  if (!text || !Number.isFinite(number) || number < 0 || number > MAX_AMOUNT) throw new Error('金额必须是0到100,000,000元之间的数字');
  if (number > 0 && number < 0.005) return 0;
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (!match[1] && !match[2])) throw new Error('金额格式不正确，请填写数字');
  const fraction = (match[2] || '').padEnd(3, '0');
  const cents = BigInt(match[1] || '0') * BigInt(100) + BigInt(fraction.slice(0, 2));
  return Number(cents + (fraction[2] >= '5' ? BigInt(1) : BigInt(0)));
}

export function paymentDetailsInput(drafts: PaymentItemDraft[]): Array<{name: string; amount: number}> {
  const rows = drafts.filter(row => row.name.trim() || row.amount.trim());
  if (rows.length > 100) throw new Error('付款明细最多100项');
  return rows.map((row, index) => {
    const name = row.name.trim(), amount = row.amount.trim();
    if (!name || !amount) throw new Error('第' + (index + 1) + '项付款明细的名称和金额都要填写');
    if (name.length > 100) throw new Error('付款明细名称不能超过100个字符');
    const cents = paymentAmountCents(amount);
    if (cents < 1) throw new Error('付款明细金额必须大于零，且四舍五入后不少于0.01元');
    return {name, amount: cents / 100};
  });
}

export function paymentDetailsTotal(drafts: PaymentItemDraft[]): number {
  // Preview remains usable while a row is being edited. Submission stays strict.
  return drafts.reduce((sum, row) => {
    try {
      const item = paymentDetailsInput([row])[0];
      return sum + (item ? paymentAmountCents(item.amount) : 0);
    } catch {return sum;}
  }, 0);
}

/** WeChat merchant receipts mirror money that really arrived; the server refuses to void or delete them. */
export function isMerchantReceipt(transaction: {[key: string]: unknown} | null | undefined): boolean {
  return Boolean(transaction?.payment_provider || transaction?.wechat_transaction_id || transaction?.payment_order_id);
}

export function getPaymentDetails(transaction: unknown): {items: PaymentItem[]; note: string} {
  const tx = transaction as {type?: string; amount?: number; note?: unknown; payment_items?: unknown} | null;
  const note = typeof tx?.note === 'string' ? tx.note : '';
  if (tx?.type !== '付款') return {items: [], note};
  if (Array.isArray(tx.payment_items) && tx.payment_items.length) {
    const valid = tx.payment_items.every(item => item && typeof item.name === 'string' && item.name.trim() && Number.isSafeInteger(item.amount) && item.amount >= 1);
    return {items: valid ? tx.payment_items.map(item => ({name: item.name, amount: item.amount})) : [], note};
  }
  const legacyName = note.trim();
  if (['板材款', '封边条款'].includes(legacyName) && Number.isSafeInteger(tx.amount) && (tx.amount || 0) > 0) return {items: [{name: legacyName, amount: tx.amount!}], note: ''};
  return {items: [], note};
}
