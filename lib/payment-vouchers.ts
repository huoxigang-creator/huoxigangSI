export const VOUCHER_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.doc,.docx';
export const VOUCHER_MAX_SIZE = 10 * 1024 * 1024;
export type VoucherDraft = {id: string; file: File; uploaded?: boolean};
export type SavedPayment = {id: string; project: string};

export function voucherSelection(files: File[], existing: VoucherDraft[]) {
  if (existing.length + files.length > 5) throw new Error('每次最多选择5个单据文件');
  const allowed = new Set(VOUCHER_ACCEPT.split(',').map(extension => extension.slice(1)));
  for (const file of files) {
    if (!file.size || file.size > VOUCHER_MAX_SIZE) throw new Error('单据必须非空，每个文件最大10MB');
    if (!allowed.has(file.name.split('.').pop()?.toLowerCase() || '')) throw new Error('请选择图片、PDF、Excel 或 Word 单据');
  }
  return [...existing, ...files.map(file => ({id: crypto.randomUUID(), file}))];
}

export async function uploadPaymentVoucher(payment: SavedPayment, draft: VoucherDraft) {
  const form = new FormData();
  form.set('project_id', payment.project); form.set('transaction_id', payment.id);
  form.set('attachment_id', draft.id); form.set('file', draft.file);
  const response = await fetch('/api/payment-vouchers', {method: 'POST', body: form});
  const result = await response.json().catch(() => null) as {error?: string; ok?: boolean} | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error || '单据上传失败，请重试');
}

export class PaymentVoucherSaveError extends Error {
  constructor(message: string, public payment: SavedPayment | null) {super(message);}
}

export async function savePaymentVouchers(options: {
  payment: SavedPayment | null;
  drafts: VoucherDraft[];
  createPayment: () => Promise<SavedPayment>;
  upload: (payment: SavedPayment, draft: VoucherDraft) => Promise<void>;
  onPaymentSaved: (payment: SavedPayment) => void;
  onUploaded: (id: string) => void;
}) {
  let payment = options.payment;
  try {
    if (!payment) {
      const created = await options.createPayment();
      if (!created?.id || !created.project) throw new Error('付款保存结果无法确认，请用原表单重试');
      payment = created;
      options.onPaymentSaved(payment);
    }
    for (const draft of options.drafts) {
      if (draft.uploaded) continue;
      await options.upload(payment, draft);
      options.onUploaded(draft.id);
    }
    return payment;
  } catch (error) {
    throw new PaymentVoucherSaveError(error instanceof Error ? error.message : '付款或单据保存失败', payment);
  }
}
