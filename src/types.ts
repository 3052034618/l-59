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
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

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
  periodType: 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
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
