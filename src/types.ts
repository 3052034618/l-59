export enum CredentialStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
  EXHAUSTED = 'EXHAUSTED'
}

export enum ValidationResultType {
  PASS = 'PASS',
  REJECT = 'REJECT',
  PENDING = 'PENDING'
}

export enum ErrorCode {
  INVALID_PRODUCT = 'INVALID_PRODUCT',
  INVALID_CONSUMER = 'INVALID_CONSUMER',
  INVALID_SCENE = 'INVALID_SCENE',
  INVALID_QUOTA = 'INVALID_QUOTA',
  INVALID_CREDENTIAL = 'INVALID_CREDENTIAL',
  CREDENTIAL_NOT_FOUND = 'CREDENTIAL_NOT_FOUND',
  CREDENTIAL_REVOKED = 'CREDENTIAL_REVOKED',
  CREDENTIAL_EXPIRED = 'CREDENTIAL_EXPIRED',
  CREDENTIAL_EXHAUSTED = 'CREDENTIAL_EXHAUSTED',
  SCOPE_MISMATCH = 'SCOPE_MISMATCH',
  IDENTITY_MISMATCH = 'IDENTITY_MISMATCH',
  PURPOSE_REQUIRED = 'PURPOSE_REQUIRED',
  QUOTA_INSUFFICIENT = 'QUOTA_INSUFFICIENT',
  INVALID_DATE_RANGE = 'INVALID_DATE_RANGE',
  INVALID_CALL_COUNT = 'INVALID_CALL_COUNT',
  INVALID_DATA_ROWS = 'INVALID_DATA_ROWS',
  INVALID_DATA_SIZE = 'INVALID_DATA_SIZE',
  PRECHECK_REQUIRED = 'PRECHECK_REQUIRED',
  STORAGE_ERROR = 'STORAGE_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export type PeriodType = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface SubjectIdentity {
  id: string;
  name: string;
  type: 'ORGANIZATION' | 'INDIVIDUAL' | 'SYSTEM';
  credentials?: Record<string, string>;
}

export interface ProductInfo {
  productId: string;
  productName: string;
  dataCategory: string;
  providerId: string;
}

export interface UsageScene {
  sceneId: string;
  sceneName: string;
  sceneDescription: string;
  sceneType: string;
}

export interface QuotaConfig {
  maxCalls: number;
  maxDataRows?: number;
  maxDataSizeKB?: number;
  periodType: PeriodType;
}

export interface ValidityPeriod {
  startTime: number;
  endTime: number;
}

export interface UsageScope {
  products: ProductInfo[];
  scenes: UsageScene[];
  allowedPurposes: string[];
}

export interface UsageLogEntry {
  logId: string;
  timestamp: number;
  purpose: string;
  callCount: number;
  dataRows?: number;
  dataSizeKB?: number;
  callerIdentity: string;
  remark?: string;
  periodKey?: string;
}

export interface PeriodUsage {
  periodKey: string;
  periodStart: number;
  periodEnd: number;
  usedCalls: number;
  usedRows: number;
  usedSizeKB: number;
}

export interface AuthorizationOrder {
  orderId: string;
  credentialId: string;
  provider: SubjectIdentity;
  consumer: SubjectIdentity;
  scope: UsageScope;
  quota: QuotaConfig;
  validity: ValidityPeriod;
  purpose: string;
  createdAt: number;
  createdBy: string;
}

export interface AuthCredential {
  credentialId: string;
  credentialNo: string;
  status: CredentialStatus;
  order: AuthorizationOrder;
  usageLogs: UsageLogEntry[];
  currentPeriod: PeriodUsage;
  periodHistory: PeriodUsage[];
  totalUsedCalls: number;
  totalUsedRows?: number;
  totalUsedSizeKB?: number;
  revokedAt?: number;
  revokedBy?: string;
  revokeReason?: string;
}

export interface CreateOrderParams {
  provider: SubjectIdentity;
  consumer: SubjectIdentity;
  scope: UsageScope;
  quota: QuotaConfig;
  validity: ValidityPeriod;
  purpose: string;
  createdBy: string;
}

export interface ValidationParams {
  credentialId: string;
  productId: string;
  sceneId: string;
  callerIdentity: SubjectIdentity;
  purpose?: string;
  expectedDataRows?: number;
  expectedDataSizeKB?: number;
}

export interface PreCheckParams {
  credentialId: string;
  callCount: number;
  dataRows?: number;
  dataSizeKB?: number;
}

export interface PreCheckResult {
  canProceed: boolean;
  message: string;
  code?: ErrorCode;
  reservedQuota?: {
    calls: number;
    rows?: number;
    sizeKB?: number;
  };
  remainingAfterDeduction?: {
    calls: number;
    rows?: number;
    sizeKB?: number;
  };
}

export interface ExecuteUsageParams {
  credentialId: string;
  purpose: string;
  callerIdentity: SubjectIdentity;
  callCount: number;
  dataRows?: number;
  dataSizeKB?: number;
  remark?: string;
}

export interface ExecuteUsageResult {
  success: boolean;
  logEntry?: UsageLogEntry;
  updatedCredential?: AuthCredential;
  deducted?: {
    calls: number;
    rows?: number;
    sizeKB?: number;
  };
  remainingAfter?: {
    calls: number;
    rows?: number;
    sizeKB?: number;
  };
  error?: SDKError;
}

export interface BatchValidationItem {
  credentialId: string;
  productId: string;
  sceneId: string;
  callerIdentity: SubjectIdentity;
  purpose?: string;
  expectedDataRows?: number;
  expectedDataSizeKB?: number;
}

export interface BatchValidationResult {
  results: Array<ValidationResult & { index: number }>;
  summary: {
    total: number;
    passed: number;
    rejected: number;
    pending: number;
    nearExpiryCredentials: Array<{ credentialId: string; remainingDays: number }>;
    lowQuotaCredentials: Array<{ credentialId: string; usageRate: number }>;
  };
}

export interface ValidationResult {
  type: ValidationResultType;
  passed: boolean;
  message: string;
  code?: ErrorCode;
  missingFields?: string[];
  credentialSnapshot?: Partial<AuthCredential>;
  auditSummary?: AuditSummary;
}

export interface AuditSummary {
  credentialId: string;
  credentialNo: string;
  status: CredentialStatus;
  providerInfo: { id: string; name: string };
  consumerInfo: { id: string; name: string };
  validityPeriod: { start: string; end: string; remainingDays: number };
  quota: {
    maxCalls: number;
    usedCalls: number;
    remainingCalls: number;
    usageRate: number;
    maxDataRows?: number;
    usedRows?: number;
    remainingRows?: number;
    maxDataSizeKB?: number;
    usedSizeKB?: number;
    remainingSizeKB?: number;
  };
  currentPeriod: {
    periodKey: string;
    periodStart: string;
    periodEnd: string;
    usedCalls: number;
    usedRows: number;
    usedSizeKB: number;
    remainingCalls: number;
    remainingRows: number;
    remainingSizeKB: number;
  };
  periodHistory: Array<{
    periodKey: string;
    periodStart: string;
    periodEnd: string;
    usedCalls: number;
    usedRows: number;
    usedSizeKB: number;
  }>;
  totalUsageLogs: number;
  lastUsedAt?: number;
  scopeSummary: {
    products: string[];
    scenes: string[];
    purposes: string[];
  };
}

export interface SDKError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

export interface IStorage {
  get(credentialId: string): Promise<AuthCredential | null>;
  set(credentialId: string, credential: AuthCredential): Promise<void>;
  delete(credentialId: string): Promise<void>;
  list(): Promise<AuthCredential[]>;
}
