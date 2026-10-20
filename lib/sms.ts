import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rawDatabase } from './local-env';
import type { Account } from './local-auth';

export type SmsPurpose = 'login' | 'reset';

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const CODE_TTL_MS = 5 * 60 * 1000; // 验证码 5 分钟有效
const RESEND_INTERVAL_MS = 60 * 1000; // 同一手机号同一用途 60 秒内不能重发
const MAX_ATTEMPTS = 5; // 最多尝试 5 次，超限需重新获取

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const phone = value.trim();
  return PHONE_PATTERN.test(phone) ? phone : null;
}

function smsEnv(): Record<string, string> {
  const values: Record<string, string> = {
    ACCESS_KEY_ID: process.env.SMS_ACCESS_KEY_ID || '',
    ACCESS_KEY_SECRET: process.env.SMS_ACCESS_KEY_SECRET || '',
    SIGN_NAME: process.env.SMS_SIGN_NAME || '',
    TEMPLATE_CODE: process.env.SMS_TEMPLATE_CODE || '',
    NOTICE_TEMPLATE_CODE: process.env.SMS_NOTICE_TEMPLATE_CODE || '',
  };
  const path = process.env.GUGEMEI_SMS_ENV_FILE || (process.platform === 'linux' ? '/etc/gugemei/sms.env' : '');
  if (path) {
    try {
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (match && !match[1].startsWith('#')) values[match[1]] = match[2];
      }
    } catch { /* 配置文件不存在时忽略，保持环境变量取值 */ }
  }
  return values;
}

export function smsConfigured(): boolean {
  const config = smsEnv();
  return Boolean(config.ACCESS_KEY_ID && config.ACCESS_KEY_SECRET && config.SIGN_NAME && config.TEMPLATE_CODE);
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
}

// 阿里云短信服务（dysmsapi，RPC 风格，HMAC-SHA1 签名）
async function sendSms(phone: string, templateCode: string, templateParam: Record<string, string>): Promise<void> {
  const config = smsEnv();
  const params: Record<string, string> = {
    AccessKeyId: config.ACCESS_KEY_ID,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: config.SIGN_NAME,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify(templateParam),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };
  const sorted = Object.keys(params).sort();
  const canonical = sorted.map(key => percentEncode(key) + '=' + percentEncode(params[key])).join('&');
  const stringToSign = 'POST&%2F&' + percentEncode(canonical);
  const signature = createHmac('sha1', config.ACCESS_KEY_SECRET + '&').update(stringToSign).digest('base64');
  const body = new URLSearchParams({ ...params, Signature: signature });
  const response = await fetch('https://dysmsapi.aliyuncs.com/', { method: 'POST', body });
  const payload = await response.json() as { Code?: string; Message?: string };
  if (!response.ok || payload.Code !== 'OK') {
    throw new Error('短信发送失败：' + (payload.Message || payload.Code || String(response.status)));
  }
}

export async function sendSmsCode(phone: string, code: string): Promise<void> {
  const config = smsEnv();
  await sendSms(phone, config.TEMPLATE_CODE, { code });
}

// 通知客户项目进展（需先申请“通知”类短信模板，配置 SMS_NOTICE_TEMPLATE_CODE）
export function progressNoticeConfigured(): boolean {
  return Boolean(smsEnv().NOTICE_TEMPLATE_CODE);
}

export async function sendProgressNotice(phone: string, name: string, stage: string, summary: string): Promise<void> {
  const config = smsEnv();
  if (!config.NOTICE_TEMPLATE_CODE) throw new Error('通知短信模板未配置');
  await sendSms(phone, config.NOTICE_TEMPLATE_CODE, { name, stage, summary });
}

function hashCode(code: string, phone: string): string {
  return createHash('sha256').update(phone + ':' + code).digest('hex');
}

export function canRequestCode(phone: string, purpose: SmsPurpose): { ok: true } | { ok: false; message: string } {
  const row = rawDatabase.prepare('SELECT expires FROM sms_codes WHERE phone = ? AND purpose = ? ORDER BY created DESC LIMIT 1').get(phone, purpose) as { expires: number } | undefined;
  if (row && row.expires > Date.now() && Date.now() < row.expires - CODE_TTL_MS + RESEND_INTERVAL_MS) {
    return { ok: false, message: '验证码已发送，请 60 秒后再试' };
  }
  return { ok: true };
}

export function issueCode(phone: string, purpose: SmsPurpose): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  rawDatabase.prepare('DELETE FROM sms_codes WHERE phone = ? AND purpose = ?').run(phone, purpose);
  rawDatabase.prepare('INSERT INTO sms_codes(id, phone, purpose, code_hash, expires, attempts, created) VALUES(?,?,?,?,?,0,?)')
    .run(randomUUID(), phone, purpose, hashCode(code, phone), Date.now() + CODE_TTL_MS, new Date().toISOString());
  return code;
}

export function consumeCode(phone: string, purpose: SmsPurpose, code: string): boolean {
  const row = rawDatabase.prepare('SELECT id, code_hash, expires, attempts FROM sms_codes WHERE phone = ? AND purpose = ? ORDER BY created DESC LIMIT 1').get(phone, purpose) as { id: string; code_hash: string; expires: number; attempts: number } | undefined;
  if (!row || row.expires < Date.now()) return false;
  if (row.attempts >= MAX_ATTEMPTS) return false;
  if (row.code_hash !== hashCode(code, phone)) {
    rawDatabase.prepare('UPDATE sms_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return false;
  }
  rawDatabase.prepare('DELETE FROM sms_codes WHERE id = ?').run(row.id);
  return true;
}

export function accountByPhone(phone: string): Account | undefined {
  return rawDatabase.prepare('SELECT id, username, display_name, role, active, updated FROM accounts WHERE phone = ?').get(phone) as Account | undefined;
}

export function phoneTaken(phone: string, excludeId?: string): boolean {
  const row = excludeId
    ? rawDatabase.prepare('SELECT id FROM accounts WHERE phone = ? AND id != ?').get(phone, excludeId)
    : rawDatabase.prepare('SELECT id FROM accounts WHERE phone = ?').get(phone);
  return Boolean(row);
}
