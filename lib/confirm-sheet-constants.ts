export const PERMANENT_EXPIRES_AT = '9999-12-31T23:59:59.999Z';
export const KIND_LABEL: Record<string, string> = { selection: '客户选材', pending: '待客户确定' };
export const STATUS_LABEL_TEXT: Record<string, string> = { pending: '未确认', confirmed: '已确认', undecided: '待定', disagree: '不同意' };
export const isPermanentExpiresAt = (value: string) => value >= '9999-01-01' || value === PERMANENT_EXPIRES_AT;
