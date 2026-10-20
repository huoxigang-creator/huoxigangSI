import {createHash} from 'node:crypto';
import {identityNumberError, normalizeIdentityNumber} from './contract-identity';

// Server adapter only. Never import this module into a client component.
// Official V3 endpoints: https://open.esign.cn/doc/opendoc/apiv3-guide/tfb6gn
export type EsignEnvironment = 'sandbox' | 'production';
export type EsignEnv = {ESIGN_APP_ID?: unknown; ESIGN_APP_SECRET?: unknown; ESIGN_ENVIRONMENT?: unknown};
export type EsignConfig = {configured: boolean; missing: string[]; environment: EsignEnvironment};
/** PDF native points: region's bottom-left corner, one-based page, unrotated page size. */
export type EsignPosition = {page: number; x: number; y: number; width: number; height: number; page_width: number; page_height: number};
export type EsignCreateInput = {
  pdfBytes: Uint8Array; pdfName: string; title: string;
  customer: {name: string; phone: string; type?: 'person' | 'organization'; companyName?: string; identityNumber?: string; identityType?: 'CRED_PSN_CH_IDCARD'};
  organization: {name?: string; orgId?: string; sealId?: string; transactorName?: string; transactorPhone?: string; transactorId?: string};
  positions: {customer: EsignPosition; organization: EsignPosition};
  requireFace?: boolean;
};
export type EsignFlowStatus = 0 | 1 | 2 | 3 | 5 | 7;
export type EsignFlowDetail = {flowId: string; status: EsignFlowStatus; finishedAt: number | null; signers: {type: number; status: number}[]};
type Dependencies = {env?: EsignEnv; fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number; uploadPolls?: number};
const HOSTS = {sandbox: 'https://smlopenapi.esign.cn', production: 'https://openapi.esign.cn'} as const;
const JSON_TYPE = 'application/json; charset=UTF-8';
const encoder = new TextEncoder();
const sourceEnv = (): EsignEnv => typeof process !== 'undefined' ? {ESIGN_APP_ID: process.env.ESIGN_APP_ID, ESIGN_APP_SECRET: process.env.ESIGN_APP_SECRET, ESIGN_ENVIRONMENT: process.env.ESIGN_ENVIRONMENT} : {};
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const serverOnly = () => {if (typeof window !== 'undefined') throw new EsignError('SERVER_ONLY', '电子签服务只能在服务端调用');};

export class EsignError extends Error {
  constructor(public code: string, message: string, public status = 502) {super(message); this.name = 'EsignError';}
}

/** Safe public configuration summary. It intentionally never returns credentials. */
export function configFromEnv(env: EsignEnv = sourceEnv()): EsignConfig {
  serverOnly();
  const missing: string[] = [];
  if (!string(env.ESIGN_APP_ID)) missing.push('ESIGN_APP_ID');
  if (!string(env.ESIGN_APP_SECRET)) missing.push('ESIGN_APP_SECRET');
  const value = string(env.ESIGN_ENVIRONMENT);
  if (!['sandbox', 'production'].includes(value)) missing.push('ESIGN_ENVIRONMENT');
  return {configured: missing.length === 0, missing, environment: value === 'production' ? 'production' : 'sandbox'};
}

const id = (value: unknown): string => {
  const result = string(value);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(result)) throw new EsignError('INVALID_ID', '电子签流程或文件编号无效', 400);
  return result;
};
const safeName = (value: unknown, field: string): string => {
  const result = string(value);
  if (!result || result.length > 100 || /[/\\:*"<>|?？\p{Extended_Pictographic}\p{Cs}\x00-\x1f]/u.test(result)) throw new EsignError('INVALID_INPUT', `${field}需为1至100字，且不能含特殊文件字符或表情`, 400);
  return result;
};
const phone = (value: unknown): string => {
  const result = string(value).replace(/^\+?86/, '');
  if (!/^1\d{10}$/.test(result)) throw new EsignError('INVALID_INPUT', '签署人手机号需为中国大陆11位手机号码', 400);
  return result;
};
const personName = (value: unknown): string => {
  const result = string(value);
  if (!result || result.length > 100 || /[\x00-\x1f]/.test(result)) throw new EsignError('INVALID_INPUT', '请填写签署人的真实姓名', 400);
  return result;
};
const position = (value: EsignPosition) => {
  if (!value || !Number.isInteger(value.page) || value.page < 1 || value.page > 1000 || ![value.x, value.y, value.width, value.height, value.page_width, value.page_height].every(Number.isFinite) || value.x < 0 || value.y < 0 || value.width < 160 || value.height < 160 || value.page_width <= 0 || value.page_height <= 0 || value.page_width > 10000 || value.page_height > 10000 || value.x + value.width > value.page_width || value.y + value.height > value.page_height) throw new EsignError('INVALID_INPUT', '合同签章区域需至少160点宽高，且不能超出PDF页面', 400);
  // Official PDF coordinate guide uses 72 dpi, bottom-left origin; the stamp's
  // anchor is its centre. Real sandbox placement must be checked before go-live.
  // https://open.esign.cn/doc/opendoc/saasapi-std/slg8r2
  // https://open.esign.cn/doc/opendoc/saas_api/wwww1b_worixg
  return {anchor: {positionPage: String(value.page), positionX: value.x + value.width / 2, positionY: value.y + value.height / 2}, size: Math.floor(Math.min(value.width, value.height))};
};
const base64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64');
const md5 = (bytes: Uint8Array | string) => createHash('md5').update(bytes).digest('base64');
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const providerError = (code: unknown) => new EsignError('PROVIDER_ERROR', typeof code === 'number' && Number.isSafeInteger(code) ? `e签宝请求未成功（错误码 ${code}），请检查账号授权或联系服务商` : 'e签宝请求未成功，请检查账号授权或联系服务商');
const externalUrl = (value: unknown, kind: 'upload' | 'sign'): string => {
  let url: URL;
  try {url = new URL(string(value));} catch {throw new EsignError('INVALID_RESPONSE', 'e签宝返回的链接无效');}
  const permitted = kind === 'upload' ? url.hostname === 'esignoss.esign.cn' : url.hostname === 'esign.cn' || url.hostname.endsWith('.esign.cn');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !permitted) throw new EsignError('UNSAFE_URL', 'e签宝返回的链接未通过HTTPS及官方域名校验，请联系服务商确认');
  return url.toString();
};

/** Dependency injection is for server bindings and isolated tests, never user-provided hosts. */
export function createEsignAdapter(dependencies: Dependencies = {}) {
  serverOnly();
  const env = dependencies.env ?? sourceEnv(), config = configFromEnv(env);
  const appId = string(env.ESIGN_APP_ID), secret = string(env.ESIGN_APP_SECRET);
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const timeoutMs = Math.min(30000, Math.max(1, dependencies.timeoutMs ?? 15000));
  const uploadPolls = Math.min(40, Math.max(1, dependencies.uploadPolls ?? 20));
  const configured = () => {if (!config.configured) throw new EsignError('NOT_CONFIGURED', '尚未配置e签宝应用ID、密钥和环境', 503);};

  async function timed<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>): Promise<T> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {const response = await fetcher(url, {...init, signal: abort.signal, redirect: 'error'}); if (!response.ok) throw new EsignError('HTTP_ERROR', `e签宝服务暂不可用（HTTP ${response.status}）`); return read(response);})(),
        new Promise<never>((_, reject) => {timer = setTimeout(() => {abort.abort(); reject(new EsignError('TIMEOUT', 'e签宝请求超时，请查询当前状态后再操作'));}, timeoutMs);}),
      ]);
    } catch (error) {
      if (error instanceof EsignError) throw error;
      throw new EsignError('REQUEST_FAILED', 'e签宝连接失败，请查询当前状态后再操作');
    } finally {if (timer) clearTimeout(timer);}
  }
  async function json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    return timed(url, init, async response => {
      let value: unknown;
      try {value = await response.json();} catch {throw new EsignError('INVALID_RESPONSE', 'e签宝返回了无法识别的响应');}
      const result = object(value);
      if (!Object.keys(result).length) throw new EsignError('INVALID_RESPONSE', 'e签宝返回了无法识别的响应');
      return result;
    });
  }
  async function request(method: 'GET' | 'POST', path: string, data?: unknown) {
    configured();
    const body = data === undefined ? undefined : JSON.stringify(data);
    const contentMd5 = body === undefined ? '' : md5(body);
    // Unified gateway signing: newline placeholders are required even for an empty body.
    // https://open.esign.cn/doc/opendoc/saasapi-std/fsf57g
    const canonical = `${method}\n*/*\n${contentMd5}\n${JSON_TYPE}\n\n${path}`;
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    const signature = base64(await crypto.subtle.sign('HMAC', key, encoder.encode(canonical)));
    const result = await json(HOSTS[config.environment] + path, {method, headers: {
      Accept: '*/*', 'Content-Type': JSON_TYPE, 'Content-MD5': contentMd5,
      'X-Tsign-Open-Auth-Mode': 'Signature', 'X-Tsign-Open-App-Id': appId,
      'X-Tsign-Open-Ca-Timestamp': String(now()), 'X-Tsign-Open-Ca-Signature': signature,
    }, ...(body === undefined ? {} : {body})});
    if (result.code !== 0) throw providerError(result.code);
    return object(result.data);
  }

  async function fileStatus(fileId: string): Promise<number> {
    const data = await request('GET', `/v3/files/${id(fileId)}`);
    // V3 calls this fileStatus, unlike the old V1 `status` response.
    // https://open.esign.cn/doc/opendoc/case3/hxzn88wydyft769i
    if (!Number.isInteger(data.fileStatus) || Number(data.fileStatus) < 0 || Number(data.fileStatus) > 9) throw new EsignError('INVALID_RESPONSE', 'e签宝返回的文件状态无效');
    return Number(data.fileStatus);
  }
  async function uploadPdf(pdfBytes: Uint8Array, pdfName: string): Promise<{fileId: string}> {
    configured();
    if (!(pdfBytes instanceof Uint8Array) || !pdfBytes.byteLength || pdfBytes.byteLength > 50 * 1024 * 1024 || new TextDecoder().decode(pdfBytes.subarray(0, 5)) !== '%PDF-') throw new EsignError('INVALID_INPUT', '请提供不超过50MB的有效PDF合同文件', 400);
    const name = safeName(pdfName, 'PDF文件名称');
    if (!/\.pdf$/i.test(name)) throw new EsignError('INVALID_INPUT', 'PDF文件名称必须包含.pdf后缀', 400);
    const bytes = new Uint8Array(pdfBytes), contentMd5 = md5(bytes);
    const upload = await request('POST', '/v3/files/file-upload-url', {contentMd5, contentType: 'application/pdf', convertToPDF: false, fileName: name, fileSize: bytes.byteLength});
    const fileId = id(upload.fileId), url = externalUrl(upload.fileUploadUrl, 'upload');
    // OSS upload receives only its own MD5/MIME headers; never forward app credentials.
    const result = await json(url, {method: 'PUT', headers: {'Content-MD5': contentMd5, 'Content-Type': 'application/pdf'}, body: bytes.buffer});
    if (result.errCode !== 0) throw providerError(result.errCode);
    for (let attempt = 0; attempt < uploadPolls; attempt++) {
      const status = await fileStatus(fileId);
      if (status === 2 || status === 5) return {fileId};
      if (status === 3 || status === 9) throw new EsignError('UPLOAD_FAILED', 'e签宝PDF上传或转换失败');
      if (attempt + 1 < uploadPolls) await sleep(500);
    }
    throw new EsignError('UPLOAD_PENDING', 'PDF仍在上传处理，请稍后重试');
  }
  async function createFlow(input: EsignCreateInput): Promise<{flowId: string; fileId: string}> {
    const title = safeName(input.title, '合同标题');
    const customerName = personName(input.customer?.name), customerPhone = phone(input.customer?.phone);
    const rawIdentityNumber = typeof input.customer?.identityNumber === 'string' ? input.customer.identityNumber : '';
    const identityError = identityNumberError(rawIdentityNumber, true);
    if (identityError) throw new EsignError('INVALID_INPUT', identityError, 400);
    if (input.customer?.identityType !== undefined && input.customer.identityType !== 'CRED_PSN_CH_IDCARD') throw new EsignError('INVALID_INPUT', '当前签署仅支持大陆身份证', 400);
    const customerIdentityNumber = normalizeIdentityNumber(rawIdentityNumber);
    if (input.customer?.type !== undefined && !['person', 'organization'].includes(input.customer.type)) throw new EsignError('INVALID_INPUT', '客户签署类型无效', 400);
    const customerCompany = input.customer?.type === 'organization' ? safeName(input.customer.companyName, '客户企业名称') : '';
    const customerPosition = position(input.positions?.customer), organizationPosition = position(input.positions?.organization);
    const org = input.organization;
    if (!org) throw new EsignError('INVALID_INPUT', '请配置企业签署主体及经办人', 400);
    let orgSignerInfo: Record<string, unknown>;
    // V3 requires account/name with orgName, but psnId with orgId.
    if (string(org.name)) {
      orgSignerInfo = {orgName: safeName(org.name, '企业名称'), transactorInfo: {psnAccount: phone(org.transactorPhone), psnInfo: {psnName: personName(org.transactorName)}}};
    } else if (string(org.orgId) && string(org.transactorId)) {
      orgSignerInfo = {orgId: id(org.orgId), transactorInfo: {psnId: id(org.transactorId)}};
    } else throw new EsignError('INVALID_INPUT', '请配置企业名称、经办人姓名与手机号，或企业账号ID与经办人账号ID', 400);
    const sealId = string(org.sealId) ? id(org.sealId) : undefined;
    if (input.requireFace !== undefined && typeof input.requireFace !== 'boolean') throw new EsignError('INVALID_INPUT', '刷脸认证配置无效', 400);
    const {fileId} = await uploadPdf(input.pdfBytes, input.pdfName);
    const field = (pos: ReturnType<typeof position>, seal?: string) => ({fileId, signFieldType: 0, normalSignFieldConfig: {autoSign: false, freeMode: false, movableSignField: false, signFieldStyle: 1, signFieldSize: pos.size, signFieldPosition: pos.anchor, ...(seal ? {assignedSealId: seal} : {})}});
    // V3 psnInfo applies to a personal signer or an organization's transactor.
    // https://open.esign.cn/doc/opendoc/pdf-sign3/tv8gsiqwk2z00wwi
    const customerInfo = {psnName: customerName, psnIDCardType: 'CRED_PSN_CH_IDCARD', psnIDCardNum: customerIdentityNumber};
    const customer = {signerType: customerCompany ? 1 : 0, ...(customerCompany ? {orgSignerInfo: {orgName: customerCompany, transactorInfo: {psnAccount: customerPhone, psnInfo: customerInfo}}} : {psnSignerInfo: {psnAccount: customerPhone, psnInfo: customerInfo}}), signConfig: {signOrder: 1}, ...(input.requireFace !== false ? {authConfig: {psnAvailableAuthModes: ['PSN_FACE'], willingnessAuthModes: ['PSN_FACE_ESIGN']}} : {}), signFields: [field(customerPosition)]};
    // API creation returns the flow id synchronously: no public callback dependency.
    const data = await request('POST', '/v3/sign-flow/create-by-file', {docs: [{fileId, fileName: input.pdfName.trim()}], signFlowConfig: {signFlowTitle: title, autoStart: true, autoFinish: true, identityVerify: true, noticeConfig: {noticeTypes: ''}}, signers: [customer, {signerType: 1, orgSignerInfo, signConfig: {signOrder: 2}, signFields: [field(organizationPosition, sealId)]}]});
    return {flowId: id(data.signFlowId), fileId};
  }
  async function signUrl(flowId: string, operator: {account?: string; psnId?: string; organization?: {orgId?: string; orgName?: string}}): Promise<{url: string; expiresAt: number | null}> {
    const signingOperator = string(operator?.psnId) ? {psnId: id(operator.psnId)} : {psnAccount: phone(operator?.account)};
    const organization = operator.organization;
    const data = await request('POST', `/v3/sign-flow/${id(flowId)}/sign-url`, {operator: signingOperator, needLogin: true, clientType: 'ALL', urlType: 2, ...(organization ? {organization: string(organization.orgId) ? {orgId: id(organization.orgId)} : {orgName: safeName(organization.orgName, '企业名称')}} : {})});
    const short = string(data.shortUrl);
    return {url: externalUrl(short || data.url, 'sign'), expiresAt: short ? now() + 90 * 24 * 60 * 60 * 1000 : null};
  }
  async function flowDetail(flowId: string): Promise<EsignFlowDetail> {
    const flow = id(flowId), data = await request('GET', `/v3/sign-flow/${flow}/detail`);
    if (![0, 1, 2, 3, 5, 7].includes(Number(data.signFlowStatus)) || typeof data.signFlowStatus !== 'number') throw new EsignError('INVALID_RESPONSE', 'e签宝返回的签署状态无效');
    const signers = Array.isArray(data.signers) ? data.signers.map(value => {const signer = object(value); if (![0, 1].includes(Number(signer.signerType)) || ![0, 1, 2, 3, 4].includes(Number(signer.signStatus)) || typeof signer.signStatus !== 'number' || typeof signer.signerType !== 'number') throw new EsignError('INVALID_RESPONSE', 'e签宝返回的签署方状态无效'); return {type: Number(signer.signerType), status: Number(signer.signStatus)};}) : [];
    if (data.signFlowStatus === 2 && (signers.length < 2 || signers.some(signer => signer.status !== 2))) throw new EsignError('INVALID_RESPONSE', 'e签宝流程完成状态与双方签署状态不一致，请再次查询或联系服务商');
    const finishedAt = typeof data.signFlowFinishTime === 'number' && Number.isSafeInteger(data.signFlowFinishTime) && data.signFlowFinishTime > 0 ? data.signFlowFinishTime : null;
    return {flowId: flow, status: data.signFlowStatus as EsignFlowStatus, finishedAt, signers};
  }
  async function downloadSignedFile(_flowId: string): Promise<never> {
    configured();
    throw new EsignError('DOWNLOAD_UNAVAILABLE', '签后原件下载接口尚待e签宝当前V3文档确认，请从e签宝企业空间下载已签合同', 501);
  }
  return {config, uploadPdf, fileStatus, createFlow, signUrl, flowDetail, downloadSignedFile};
}
