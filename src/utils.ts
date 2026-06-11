import { ErrorCode, SDKError } from './types';

export function generateCredentialNo(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
  const prefix = 'DAC';
  return `${prefix}-${timestamp}-${randomPart}`;
}

export function generateOrderId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  const prefix = 'ORD';
  return `${prefix}-${timestamp}-${randomPart}`;
}

export function generateLogId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  const prefix = 'LOG';
  return `${prefix}-${timestamp}-${randomPart}`;
}

export function generateCredentialId(): string {
  return `CRED-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function formatError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): SDKError {
  return {
    code,
    message,
    details,
    timestamp: Date.now()
  };
}

export function getErrorMessage(code: ErrorCode): string {
  const errorMessages: Record<ErrorCode, string> = {
    [ErrorCode.INVALID_PRODUCT]: '产品信息无效或未授权',
    [ErrorCode.INVALID_CONSUMER]: '使用方身份信息无效',
    [ErrorCode.INVALID_SCENE]: '使用场景不在授权范围内',
    [ErrorCode.INVALID_QUOTA]: '额度配置无效',
    [ErrorCode.INVALID_CREDENTIAL]: '授权凭证无效',
    [ErrorCode.CREDENTIAL_NOT_FOUND]: '授权凭证不存在',
    [ErrorCode.CREDENTIAL_REVOKED]: '授权凭证已被撤销',
    [ErrorCode.CREDENTIAL_EXPIRED]: '授权凭证已过期',
    [ErrorCode.CREDENTIAL_EXHAUSTED]: '授权凭证额度已用尽',
    [ErrorCode.SCOPE_MISMATCH]: '使用范围与授权不匹配',
    [ErrorCode.IDENTITY_MISMATCH]: '调用方身份与授权使用方不匹配',
    [ErrorCode.PURPOSE_REQUIRED]: '调用目的不能为空',
    [ErrorCode.QUOTA_INSUFFICIENT]: '剩余额度不足',
    [ErrorCode.INVALID_DATE_RANGE]: '有效日期范围无效',
    [ErrorCode.UNKNOWN_ERROR]: '未知错误'
  };
  return errorMessages[code] || errorMessages[ErrorCode.UNKNOWN_ERROR];
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function calculateRemainingDays(endTime: number): number {
  const now = Date.now();
  const diff = endTime - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function validateDateRange(startTime: number, endTime: number): boolean {
  if (!startTime || !endTime) return false;
  if (startTime >= endTime) return false;
  if (endTime <= Date.now()) return false;
  return true;
}

export function sha256(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

export function compareIdentity(
  identityA: { id: string; type?: string },
  identityB: { id: string; type?: string }
): boolean {
  if (!identityA || !identityB) return false;
  if (identityA.id !== identityB.id) return false;
  if (identityA.type && identityB.type && identityA.type !== identityB.type) return false;
  return true;
}
