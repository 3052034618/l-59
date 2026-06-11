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
  POLICY_VIOLATION = 'POLICY_VIOLATION',
  POLICY_REQUIRED_FIELD = 'POLICY_REQUIRED_FIELD',
  POLICY_SUBJECT_TYPE = 'POLICY_SUBJECT_TYPE',
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

export type RejectionCategory = 'POLICY' | 'IDENTITY' | 'CREDENTIAL_STATUS' | 'QUOTA' | 'SCOPE' | 'PARAM' | 'OTHER';

export interface AuditRejectionEvent {
  eventId: string;
  timestamp: number;
  credentialId: string;
  credentialNo?: string;
  providerId: string;
  providerName?: string;
  consumerId: string;
  consumerName?: string;
  productId?: string;
  sceneId?: string;
  errorCode: ErrorCode;
  errorMessage: string;
  category: RejectionCategory;
  policyId?: string;
  policyName?: string;
  ruleId?: string;
  ruleName?: string;
  callerIdentityId?: string;
  details?: Record<string, unknown>;
}

export interface RejectionReasonSummary {
  errorCode: ErrorCode;
  category: RejectionCategory;
  message: string;
  count: number;
  sampleEvents: AuditRejectionEvent[];
}

export interface IStorage {
  get(credentialId: string): Promise<AuthCredential | null>;
  set(credentialId: string, credential: AuthCredential): Promise<void>;
  delete(credentialId: string): Promise<void>;
  list(): Promise<AuthCredential[]>;

  addRejectionEvent(event: AuditRejectionEvent): Promise<void>;
  listRejectionEvents(filter?: {
    startTime?: number;
    endTime?: number;
    credentialId?: string;
    providerId?: string;
    consumerId?: string;
    productId?: string;
    errorCode?: ErrorCode;
    category?: RejectionCategory;
  }): Promise<AuditRejectionEvent[]>;
}

export type PolicyTargetType = 'PRODUCT' | 'SCENE' | 'PROVIDER' | 'CONSUMER' | 'GLOBAL';
export type PolicyRuleType = 'REQUIRED_FIELD' | 'ALLOWED_SUBJECT_TYPE' | 'DENIED_SUBJECT_TYPE' | 'MAX_DATA_SIZE' | 'MIN_DATA_SIZE' | 'CUSTOM';

export interface PolicyRule {
  ruleId: string;
  ruleType: PolicyRuleType;
  ruleName: string;
  description?: string;
  config: Record<string, unknown>;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export interface AuthPolicy {
  policyId: string;
  policyName: string;
  targetType: PolicyTargetType;
  targetValue: string;
  rules: PolicyRule[];
  enabled: boolean;
  priority: number;
  createdAt: number;
}

export interface PolicyMatchResult {
  matched: boolean;
  hitRule?: PolicyRule;
  policyId?: string;
  policyName?: string;
  missingFields?: string[];
}

export interface ValidationResult {
  type: ValidationResultType;
  passed: boolean;
  message: string;
  code?: ErrorCode;
  missingFields?: string[];
  credentialSnapshot?: Partial<AuthCredential>;
  auditSummary?: AuditSummary;
  policyHit?: PolicyMatchResult;
}

export interface ReportQuery {
  startTime: number;
  endTime: number;
  providerId?: string;
  consumerId?: string;
  productId?: string;
  includePeriodDetails?: boolean;
  includeRevocationRecords?: boolean;
  includeRejectionStats?: boolean;
  filterByTimeRange?: boolean;
}

export interface AggregatedPeriodUsage {
  periodKey: string;
  periodStart?: number;
  periodEnd?: number;
  usedCalls: number;
  usedRows: number;
  usedSizeKB: number;
  credentialCount: number;
}

export interface UsageReportItem {
  dimension: string;
  dimensionValue: string;
  dimensionName: string;
  totalCalls: number;
  totalDataRows: number;
  totalDataSizeKB: number;
  credentialCount: number;
  revokedCount: number;
  expiredCount: number;
  activeCount: number;
  exhaustedCount: number;
  rejectionCount: number;
  periodUsages?: AggregatedPeriodUsage[];
  rejectionSummary?: RejectionReasonSummary[];
  currentPeriodUsage?: AggregatedPeriodUsage;
  periodHistory?: AggregatedPeriodUsage[];
}

export interface UsageReport {
  query: ReportQuery;
  generatedAt: number;
  items: UsageReportItem[];
  summary: {
    totalCredentials: number;
    totalCalls: number;
    totalDataRows: number;
    totalDataSizeKB: number;
    totalRevoked: number;
    totalExpired: number;
    totalRejections: number;
    rejectionSummary?: RejectionReasonSummary[];
  };
}
