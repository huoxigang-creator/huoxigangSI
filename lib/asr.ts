import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// 阿里云智能语音交互（ISI）一句话识别：RESTful /stream/v1/asr + POP API CreateToken 获取 Token。
// 凭证管理沿用 lib/aliyun-ocr.ts 的规矩：环境变量优先、服务器 env 文件兜底，密钥绝不进代码库。
// 服务器配置：/etc/gugemei/asr.env 写入 ALIYUN_ASR_ACCESS_KEY_ID / ALIYUN_ASR_ACCESS_KEY_SECRET / ALIYUN_ASR_APP_KEY（权限 600）。
type AsrConfig = { accessKeyId: string; accessKeySecret: string; appKey: string };

function asrEnv(): AsrConfig {
  const values: Record<string, string> = {
    ACCESS_KEY_ID: process.env.ALIYUN_ASR_ACCESS_KEY_ID || '',
    ACCESS_KEY_SECRET: process.env.ALIYUN_ASR_ACCESS_KEY_SECRET || '',
    APP_KEY: process.env.ALIYUN_ASR_APP_KEY || '',
  };
  const path = process.env.GUGEMEI_ASR_ENV_FILE || (process.platform === 'linux' ? '/etc/gugemei/asr.env' : '');
  if (path) {
    try {
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (match && !match[1].startsWith('#')) values[match[1]] = match[2];
      }
    } catch { /* 配置文件不存在时忽略，保持环境变量取值 */ }
  }
  return { accessKeyId: values.ACCESS_KEY_ID, accessKeySecret: values.ACCESS_KEY_SECRET, appKey: values.APP_KEY };
}

export function aliyunAsrConfigured(): boolean {
  const config = asrEnv();
  return Boolean(config.accessKeyId && config.accessKeySecret && config.appKey);
}

export const ALIYUN_ASR_SETUP_HINT = '语音识别未配置：请先在阿里云开通「智能语音交互」并创建项目，然后在服务器 /etc/gugemei/asr.env 写入 ALIYUN_ASR_ACCESS_KEY_ID、ALIYUN_ASR_ACCESS_KEY_SECRET 与 ALIYUN_ASR_APP_KEY（文件权限 600），重启 gugemei 服务后生效。';

// 阿里云 RPC 签名：PercentEncode（编码后 +→%20、*→%2A、%7E→~）
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
}

function iso8601Utc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

let tokenCache: { token: string; expiresAt: number } | null = null;

// 通过 POP API CreateToken 获取 NLS Token（HMAC-SHA1 签名）
async function getNlsToken(config: AsrConfig): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60 * 1000) return tokenCache.token;
  const parameters: Record<string, string> = {
    AccessKeyId: config.accessKeyId,
    Action: 'CreateToken',
    Format: 'JSON',
    RegionId: 'cn-shanghai',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: iso8601Utc(),
    Version: '2019-02-28',
  };
  const canonicalizedQuery = Object.keys(parameters).sort()
    .map(key => percentEncode(key) + '=' + percentEncode(parameters[key])).join('&');
  const stringToSign = 'GET&' + percentEncode('/') + '&' + percentEncode(canonicalizedQuery);
  const signature = percentEncode(createHmac('sha1', config.accessKeySecret + '&').update(stringToSign).digest('base64'));
  const response = await fetch('https://nls-meta.cn-shanghai.aliyuncs.com/?' + 'Signature=' + signature + '&' + canonicalizedQuery, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.Token?.Id) {
    throw new Error('获取语音识别凭证失败：' + (payload?.Message || payload?.Code || 'HTTP ' + response.status));
  }
  tokenCache = { token: payload.Token.Id, expiresAt: Number(payload.Token.ExpireTime || 0) * 1000 };
  return tokenCache.token;
}

/**
 * 一句话识别：识别不超过 60 秒的 16kHz、16 位、单声道 PCM WAV 音频，返回识别文本。
 */
export async function recognizeSpeech(bytes: Uint8Array): Promise<string> {
  const config = asrEnv();
  if (!config.accessKeyId || !config.accessKeySecret || !config.appKey) throw new Error(ALIYUN_ASR_SETUP_HINT);
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('语音文件过大或为空（不超过 2MB / 60 秒）');
  const token = await getNlsToken(config);
  const url = 'https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/asr?appkey=' + encodeURIComponent(config.appKey) + '&format=wav&sample_rate=16000';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-NLS-Token': token, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(60000),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload || payload.status !== 20000000) {
    throw new Error('语音识别失败：' + (payload?.message || payload?.status || 'HTTP ' + response.status) + (payload?.status === 40000010 ? '（试用已结束或需开通商用版）' : ''));
  }
  const text = String(payload.result || '').trim();
  if (!text) throw new Error('未识别到语音内容，请靠近麦克风重试');
  return text;
}

// ========== 阿里云百炼语音大模型（Qwen3-ASR-Flash，OpenAI 兼容） ==========
// 升级通道：语音建档优先走百炼语音大模型（识别更准、支持“一三八”→138 的 ITN 规整），
// 未配置百炼密钥时自动回退到上方 ISI 一句话识别。密钥复用 lib/recognition-settings.ts 的
// GUGEMEI_AI_API_KEY / GUGEMEI_AI_BASE_URL（业务空间专属域名，无需新增任何配置）。
export function qwenAsrConfigured(): boolean {
  return Boolean(process.env.GUGEMEI_AI_API_KEY && process.env.GUGEMEI_AI_BASE_URL);
}

export const QWEN_ASR_SETUP_HINT = '语音大模型未配置：请在服务器 /etc/gugemei/ai.env 写入 GUGEMEI_AI_API_KEY 与 GUGEMEI_AI_BASE_URL（阿里云百炼业务空间专属域名），重启 gugemei 服务后生效。';

/** 任一语音通道可用（百炼语音大模型 或 ISI 一句话识别）即视为已配置。 */
export function speechConfigured(): boolean {
  return qwenAsrConfigured() || aliyunAsrConfigured();
}

export const SPEECH_SETUP_HINT = '语音识别未配置：请配置阿里云百炼语音大模型（GUGEMEI_AI_API_KEY + GUGEMEI_AI_BASE_URL）或在服务器 /etc/gugemei/asr.env 写入 ALIYUN_ASR_ACCESS_KEY_ID、ALIYUN_ASR_ACCESS_KEY_SECRET 与 ALIYUN_ASR_APP_KEY（文件权限 600），重启 gugemei 服务后生效。';

function nlsText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.map((item: any) => typeof item?.text === 'string' ? item.text : '').filter(Boolean);
    if (parts.length) return parts.join('');
  }
  return '';
}

/**
 * 百炼语音大模型一句话识别：音频以 data URL（audio/wav + base64）传入 chat/completions，
 * enable_itn=true 将「一三八一二三四五六七八」等口语数字规整为「13812345678」，电话识别更准。
 */
export async function recognizeSpeechQwen(bytes: Uint8Array): Promise<string> {
  const base = process.env.GUGEMEI_AI_BASE_URL;
  const key = process.env.GUGEMEI_AI_API_KEY;
  const model = process.env.GUGEMEI_AI_ASR_MODEL || 'qwen3-asr-flash';
  if (!base || !key) throw new Error(QWEN_ASR_SETUP_HINT);
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('语音文件过大或为空（不超过 2MB / 60 秒）');
  const dataUri = 'data:audio/wav;base64,' + Buffer.from(bytes).toString('base64');
  const response = await fetch(base.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUri } }] }],
      asr_options: { language: 'zh', enable_itn: true },
      temperature: 0,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    let failure = '';
    try { const body = await response.json() as any; failure = String(body.error?.code || '') + ' ' + String(body.error?.message || ''); } catch { /* 忽略 */ }
    if (/quota|balance|arrear|insufficient|额度|欠费|余额|overdue/i.test(failure)) throw new Error('语音大模型额度不足或账号欠费，请充值后重试；也可先手动填写');
    throw new Error('语音大模型暂不可用（HTTP ' + response.status + '），请重试；也可先手动填写');
  }
  const payload = await response.json().catch(() => null) as any;
  const text = nlsText(payload?.choices?.[0]?.message?.content).trim();
  if (!text) throw new Error('未识别到语音内容，请靠近麦克风重试');
  return text;
}

/** 语音识别总入口：优先百炼语音大模型，失败或未配置时自动回退 ISI 一句话识别。 */
export async function recognizeSpeechSmart(bytes: Uint8Array): Promise<string> {
  let lastError: unknown = null;
  if (qwenAsrConfigured()) {
    try { return await recognizeSpeechQwen(bytes); } catch (error) { lastError = error; }
  }
  try { return await recognizeSpeech(bytes); } catch (error) {
    if (lastError) console.error('[asr] qwen speech failed:', lastError);
    throw error;
  }
}
