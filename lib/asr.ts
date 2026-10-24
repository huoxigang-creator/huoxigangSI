import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dataDirectory } from './local-env';

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

// ========== 豆包语音识别大模型（火山引擎 豆包语音·录音文件识别2.0） ==========
// 接口：提交任务 submit（POST /api/v3/auc/bigmodel/submit，音频走公网 URL）+ 查询结果 query
// （POST /api/v3/auc/bigmodel/query，同 X-Api-Request-Id）。资源 ID = volc.seedasr.auc（豆包录音文件识别模型 2.0）。
// 凭证从 /etc/gugemei/asr.env 读取 DOUBAO_ASR_API_KEY（豆包语音控制台 API Key 管理里创建）
// 与 DOUBAO_ASR_RESOURCE（默认 volc.seedasr.auc，无需填写）。
type DoubaoAsrConfig = { apiKey: string; resource: string };

function doubaoAsrEnv(): DoubaoAsrConfig {
  const values: Record<string, string> = {
    API_KEY: process.env.DOUBAO_ASR_API_KEY || '',
    RESOURCE: process.env.DOUBAO_ASR_RESOURCE || 'volc.seedasr.auc',
  };
  const path = process.env.GUGEMEI_ASR_ENV_FILE || (process.platform === 'linux' ? '/etc/gugemei/asr.env' : '');
  if (path) {
    try {
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (match && !match[1].startsWith('#')) values[match[1]] = match[2];
      }
    } catch { /* 配置文件不存在时忽略 */ }
  }
  return { apiKey: values.API_KEY, resource: values.RESOURCE };
}

export function doubaoAsrConfigured(): boolean {
  return Boolean(doubaoAsrEnv().apiKey);
}

export const DOUBAO_ASR_SETUP_HINT = '豆包语音识别未配置：请在豆包语音控制台「API Key 管理」创建密钥，然后在服务器 /etc/gugemei/asr.env 写入 DOUBAO_ASR_API_KEY=你的豆包语音API Key（文件权限 600），重启 gugemei 服务后生效。';

const ASR_TMP_DIR = () => join(dataDirectory, 'asr-tmp');

/**
 * 豆包录音文件识别2.0：先把录音落到本地临时文件，通过公网 URL 交给豆包异步识别，
 * 完成后立即删除临时文件（识别失败或超时同样清理）。
 */
export async function recognizeSpeechDoubao(bytes: Uint8Array, publicBase: string): Promise<string> {
  const config = doubaoAsrEnv();
  if (!config.apiKey) throw new Error(DOUBAO_ASR_SETUP_HINT);
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('语音文件过大或为空（不超过 2MB / 60 秒）');
  let base: URL;
  try { base = new URL(publicBase); } catch { throw new Error('服务地址无效'); }
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
    throw new Error('服务地址无效：豆包语音识别要求录音临时地址必须为 HTTPS 公网地址');
  }
  const fileId = randomUUID();
  const dir = ASR_TMP_DIR();
  const filePath = join(dir, fileId + '.wav');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(filePath, Buffer.from(bytes), { mode: 0o600 });
  const audioUrl = base.origin + '/api/asr-tmp?id=' + fileId;
  const headers: Record<string, string> = {
    'X-Api-Key': config.apiKey,
    'X-Api-Resource-Id': config.resource,
    'X-Api-Request-Id': fileId,
    'X-Api-Sequence': '-1',
    'Content-Type': 'application/json',
  };
  try {
    const submit = await fetch('https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        audio: { url: audioUrl, format: 'wav', rate: 16000, bits: 16, channel: 1 },
        request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const submitCode = submit.headers.get('x-api-status-code');
    if (submitCode !== '20000000') {
      const submitBody = await submit.text().catch(() => '');
      if (/45000030|not granted|资源|授权/i.test(submitCode + ' ' + submitBody)) {
        throw new Error('豆包语音识别资源未开通：请在豆包语音控制台开通「录音文件识别2.0」后重试；也可先手动填写');
      }
      throw new Error('豆包语音识别提交失败（' + (submitCode || 'HTTP ' + submit.status) + '），请重试；也可先手动填写');
    }
    // 轮询查询结果（同 X-Api-Request-Id），最长约 40 秒
    let lastBody = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const query = await fetch('https://openspeech.bytedance.com/api/v3/auc/bigmodel/query', {
        method: 'POST',
        headers,
        body: '{}',
        signal: AbortSignal.timeout(30000),
      });
      const queryCode = query.headers.get('x-api-status-code');
      lastBody = await query.text().catch(() => '');
      if (queryCode === '20000000') {
        const payload = JSON.parse(lastBody) as any;
        const text = nlsText(payload?.result?.text).trim();
        if (text) return text;
        continue;
      }
      if (queryCode && queryCode !== '20000001' && queryCode !== '20000002') {
        break;
      }
    }
    throw new Error('豆包语音识别超时或未识别到内容，请靠近麦克风重试；也可先手动填写');
  } finally {
    try { unlinkSync(filePath); } catch { /* 忽略清理失败 */ }
  }
}

/** 任一语音通道可用（豆包 或 百炼语音大模型 或 ISI 一句话识别）即视为已配置。 */
export function speechConfigured(): boolean {
  return doubaoAsrConfigured() || qwenAsrConfigured() || aliyunAsrConfigured();
}

export const SPEECH_SETUP_HINT = '语音识别未配置：请在服务器 /etc/gugemei/asr.env 写入 DOUBAO_ASR_API_KEY=豆包语音API Key（推荐，豆包录音文件识别2.0）；或配置阿里云百炼语音大模型（GUGEMEI_AI_API_KEY + GUGEMEI_AI_BASE_URL）；或写入 ALIYUN_ASR_ACCESS_KEY_ID、ALIYUN_ASR_ACCESS_KEY_SECRET 与 ALIYUN_ASR_APP_KEY（文件权限 600），重启 gugemei 服务后生效。';

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

/** 语音识别总入口：优先豆包语音识别大模型（录音文件识别2.0），失败或未配置时自动回退百炼语音大模型，再回退 ISI 一句话识别。 */
export async function recognizeSpeechSmart(bytes: Uint8Array, publicBase?: string): Promise<string> {
  let lastError: unknown = null;
  if (doubaoAsrConfigured() && publicBase) {
    try { return await recognizeSpeechDoubao(bytes, publicBase); } catch (error) { lastError = error; }
  }
  if (qwenAsrConfigured()) {
    try { return await recognizeSpeechQwen(bytes); } catch (error) { lastError = error; }
  }
  try { return await recognizeSpeech(bytes); } catch (error) {
    if (lastError) console.error('[asr] doubao/qwen speech failed:', lastError);
    throw error;
  }
}
