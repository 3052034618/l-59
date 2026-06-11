import { ErrorCode, PeriodType, SDKError } from './types';

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
    [ErrorCode.INVALID_CALL_COUNT]: '调用次数必须为正整数',
    [ErrorCode.INVALID_DATA_ROWS]: '数据行数必须为正整数',
    [ErrorCode.INVALID_DATA_SIZE]: '数据量必须为正数',
    [ErrorCode.PRECHECK_REQUIRED]: '需要先执行预检查',
    [ErrorCode.STORAGE_ERROR]: '存储操作失败',
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

export function compareIdentity(
  identityA: { id: string; type?: string },
  identityB: { id: string; type?: string }
): boolean {
  if (!identityA || !identityB) return false;
  if (identityA.id !== identityB.id) return false;
  if (identityA.type && identityB.type && identityA.type !== identityB.type) return false;
  return true;
}

export function getPeriodKey(periodType: PeriodType, timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const weekDay = date.getDay();

  switch (periodType) {
    case 'ONCE':
      return 'ONCE';
    case 'DAILY':
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    case 'WEEKLY': {
      const weekStart = new Date(timestamp);
      weekStart.setDate(day - (weekDay === 0 ? 6 : weekDay - 1));
      const wsYear = weekStart.getFullYear();
      const wsMonth = weekStart.getMonth() + 1;
      const wsDay = weekStart.getDate();
      return `W${wsYear}-${String(wsMonth).padStart(2, '0')}-${String(wsDay).padStart(2, '0')}`;
    }
    case 'MONTHLY':
      return `${year}-${String(month + 1).padStart(2, '0')}`;
    case 'YEARLY':
      return `${year}`;
  }
}

export function getPeriodRange(periodType: PeriodType, timestamp: number): { start: number; end: number } {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const weekDay = date.getDay();

  switch (periodType) {
    case 'ONCE':
      return { start: 0, end: Infinity };
    case 'DAILY': {
      const start = new Date(year, month, day).getTime();
      const end = new Date(year, month, day + 1).getTime() - 1;
      return { start, end };
    }
    case 'WEEKLY': {
      const mondayOffset = weekDay === 0 ? 6 : weekDay - 1;
      const weekStartDate = new Date(year, month, day - mondayOffset);
      const start = weekStartDate.getTime();
      const end = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() + 7).getTime() - 1;
      return { start, end };
    }
    case 'MONTHLY': {
      const start = new Date(year, month, 1).getTime();
      const end = new Date(year, month + 1, 1).getTime() - 1;
      return { start, end };
    }
    case 'YEARLY': {
      const start = new Date(year, 0, 1).getTime();
      const end = new Date(year + 1, 0, 1).getTime() - 1;
      return { start, end };
    }
  }
}

export function isNewPeriod(currentPeriodKey: string, newPeriodKey: string): boolean {
  return currentPeriodKey !== newPeriodKey;
}
