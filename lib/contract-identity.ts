/** Format normalization only; actual identity and face verification belong to e签宝. */
export function normalizeIdentityNumber(value: string): string {
  return value.trim().toUpperCase();
}

/** Return a fixed message without echoing personal information. Empty drafts are allowed. */
export function identityNumberError(value: string, required = false): string {
  const normalized = normalizeIdentityNumber(value);
  if (!normalized) return required ? '请填写签署人的身份证号码后再生成合同或发起电子签署' : '';
  return /^\d{17}[\dX]$/.test(normalized) && !/[\x00-\x1f\x7f-\x9f]/.test(value)
    ? ''
    : '身份证号码格式不正确，请填写18位号码，末位可为X';
}
