import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// 阿里云文字识别 OCR（ocr-api 2021-07-07，RecognizeAllText，Type=Advanced 通用高精）。
// 密钥管理沿用 lib/sms.ts 的规矩：环境变量优先、服务器 env 文件兜底，
// 密钥绝不进代码库、不进聊天、不进命令行参数；注入由用户在服务器终端完成。
type OcrConfig = { accessKeyId: string; accessKeySecret: string; endpoint: string };

function ocrEnv(): OcrConfig {
  const values: Record<string, string> = {
    ACCESS_KEY_ID: process.env.ALIYUN_OCR_ACCESS_KEY_ID || '',
    ACCESS_KEY_SECRET: process.env.ALIYUN_OCR_ACCESS_KEY_SECRET || '',
    ENDPOINT: process.env.ALIYUN_OCR_ENDPOINT || 'ocr-api.cn-hangzhou.aliyuncs.com',
  };
  const path = process.env.GUGEMEI_OCR_ENV_FILE || (process.platform === 'linux' ? '/etc/gugemei/ocr.env' : '');
  if (path) {
    try {
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (match && !match[1].startsWith('#')) values[match[1]] = match[2];
      }
    } catch { /* 配置文件不存在时忽略，保持环境变量取值 */ }
  }
  return { accessKeyId: values.ACCESS_KEY_ID, accessKeySecret: values.ACCESS_KEY_SECRET, endpoint: values.ENDPOINT };
}

export function aliyunOcrConfigured(): boolean {
  const config = ocrEnv();
  return Boolean(config.accessKeyId && config.accessKeySecret);
}

export const ALIYUN_OCR_SETUP_HINT = '阿里云OCR未配置：请在服务器 /etc/gugemei/ocr.env 写入 ALIYUN_OCR_ACCESS_KEY_ID 与 ALIYUN_OCR_ACCESS_KEY_SECRET（文件权限 600），确认控制台已开通文字识别 OCR 后重启 gugemei 服务。';

const sha256Hex = (data: string) => createHash('sha256').update(data).digest('hex');

// 阿里云 OpenAPI V3 签名（ACS3-HMAC-SHA256，ROA 风格）：
// canonicalRequest = method\nuri\nquery\ncanonicalHeaders\nsignedHeaders\nhashedPayload
function signedRequest(config: OcrConfig, body: string): { headers: Record<string, string> } {
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'host': config.endpoint,
    'x-acs-action': 'RecognizeAllText',
    'x-acs-content-sha256': payloadHash,
    'x-acs-date': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'x-acs-signature-nonce': randomUUID(),
    'x-acs-version': '2021-07-07',
  };
  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map(name => name + ':' + headers[name].trim() + '\n').join('');
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedNames.join(';'), payloadHash].join('\n');
  const stringToSign = 'ACS3-HMAC-SHA256\n' + sha256Hex(canonicalRequest);
  const signature = createHmac('sha256', config.accessKeySecret).update(stringToSign).digest('hex');
  headers['Authorization'] = 'ACS3-HMAC-SHA256 Credential=' + config.accessKeyId + ',SignedHeaders=' + signedNames.join(';') + ',Signature=' + signature;
  return { headers };
}

// 防御性提取识别文字：优先 Data.Content，否则深度收集 content/text 叶子字符串，
// 兼容阿里云响应结构的细微差异（SubImages/BlockInfo 等嵌套形态）。
function collectText(node: unknown, depth = 0): string[] {
  if (node == null || depth > 8) return [];
  if (typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(item => collectText(item, depth + 1));
  if (typeof node === 'object') {
    const out: string[] = [];
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        if (/^(content|text|textcontent)$/i.test(key) && value.trim()) out.push(value);
      } else out.push(...collectText(value, depth + 1));
    }
    return out;
  }
  return [];
}

/** 调用阿里云 OCR 识别一张图片，返回去空行后的文字行。未配置密钥或识别失败时抛错。 */
export async function recognizeTextLines(bytes: Uint8Array): Promise<string[]> {
  const config = ocrEnv();
  if (!config.accessKeyId || !config.accessKeySecret) throw new Error(ALIYUN_OCR_SETUP_HINT);
  const body = JSON.stringify({ Type: 'Advanced', Body: Buffer.from(bytes).toString('base64') });
  const { headers } = signedRequest(config, body);
  const response = await fetch('https://' + config.endpoint + '/', { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload || payload.Code) {
    throw new Error('阿里云OCR识别失败：' + (payload?.Message || payload?.Code || 'HTTP ' + response.status));
  }
  const data = payload.Data;
  const text = typeof data?.Content === 'string' && data.Content.trim() ? data.Content : collectText(data).join('\n');
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('未识别到文字，请上传更清晰的订单照片或截图。');
  return lines;
}
