'use client';

/**
 * HTTP（非安全上下文）下 crypto.randomUUID 不可用（仅 HTTPS/localhost 提供），
 * 而新建项目、新建报价、添加房间等业务均依赖它生成 UUID。
 * 此组件在浏览器端用 crypto.getRandomValues 提供 v4 UUID 兜底实现，
 * getRandomValues 在非安全上下文同样可用。
 */
export default function ClientPolyfill() {
  if (typeof window !== 'undefined' && typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
    try {
      (crypto as Crypto & { randomUUID?: () => string }).randomUUID = function randomUUIDFallback() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      };
    } catch {
      /* 环境异常时忽略，业务层另有错误提示 */
    }
  }
  return null;
}
