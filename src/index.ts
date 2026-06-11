import { CredentialManager } from './CredentialManager';
import { MemoryStorage } from './storage/MemoryStorage';
import { FileStorage } from './storage/FileStorage';
import { AuthPolicyManager } from './policy/AuthPolicyManager';
import { AuditReportGenerator } from './audit/AuditReportGenerator';
import {
  AuthCredential,
  AuditSummary,
  AuthPolicy,
  BatchValidationItem,
  BatchValidationResult,
  CreateOrderParams,
  CredentialStatus,
  ErrorCode,
  ExecuteUsageParams,
  ExecuteUsageResult,
  IStorage,
  PolicyTargetType,
  PreCheckParams,
  PreCheckResult,
  QuotaConfig,
  ReportQuery,
  SDKError,
  SubjectIdentity,
  UsageLogEntry,
  UsageReport,
  ValidationParams,
  ValidationResult,
  ValidationResultType,
  AuthorizationOrder,
  UsageScope,
  ValidityPeriod,
  ProductInfo,
  UsageScene,
  PeriodUsage,
  PeriodType,
  PolicyMatchResult,
  PolicyRule
} from './types';
import {
  calculateRemainingDays,
  compareIdentity,
  formatError,
  formatTimestamp,
  generateCredentialNo,
  getErrorMessage,
  getPeriodKey,
  getPeriodRange
} from './utils';

export interface SDKOptions {
  storage?: IStorage;
  storageType?: 'memory' | 'file';
  storagePath?: string;
  policyManager?: AuthPolicyManager;
}

export class DataAuthCredentialSDK {
  private manager: CredentialManager;
  private storageInstance: IStorage;
  private policyManager: AuthPolicyManager;
  private reportGenerator: AuditReportGenerator;

  constructor(options?: SDKOptions) {
    if (options?.storage) {
      this.storageInstance = options.storage;
    } else if (options?.storageType === 'file') {
      this.storageInstance = new FileStorage(options.storagePath);
    } else {
      this.storageInstance = new MemoryStorage();
    }

    this.policyManager = options?.policyManager || new AuthPolicyManager();
    this.manager = new CredentialManager(this.storageInstance, this.policyManager);
    this.reportGenerator = new AuditReportGenerator(this.storageInstance);
  }

  async createAuthorization(params: CreateOrderParams): Promise<{
    success: boolean;
    order?: AuthorizationOrder;
    credential?: AuthCredential;
    error?: SDKError;
  }> {
    return this.manager.createAuthorizationOrder(params);
  }

  async validate(params: ValidationParams): Promise<ValidationResult> {
    return this.manager.validateCredential(params);
  }

  async preCheck(params: PreCheckParams): Promise<PreCheckResult> {
    return this.manager.preCheck(params);
  }

  async executeUsage(params: ExecuteUsageParams): Promise<ExecuteUsageResult> {
    return this.manager.executeUsage(params);
  }

  async recordUsage(
    credentialId: string,
    purpose: string,
    callerIdentity: SubjectIdentity,
    callCount: number = 1,
    dataRows?: number,
    dataSizeKB?: number,
    remark?: string
  ): Promise<{
    success: boolean;
    logEntry?: UsageLogEntry;
    updatedCredential?: AuthCredential;
    error?: SDKError;
  }> {
    return this.manager.recordUsage(
      credentialId,
      purpose,
      callerIdentity,
      callCount,
      dataRows,
      dataSizeKB,
      remark
    );
  }

  async checkUsageScope(
    credentialId: string,
    productId: string,
    sceneId: string
  ): Promise<{
    valid: boolean;
    message: string;
    code?: ErrorCode;
  }> {
    const credential = await this.manager.getCredential(credentialId);
    if (!credential) {
      return {
        valid: false,
        message: getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND),
        code: ErrorCode.CREDENTIAL_NOT_FOUND
      };
    }

    const productMatch = credential.order.scope.products.some(p => p.productId === productId);
    if (!productMatch) {
      return {
        valid: false,
        message: getErrorMessage(ErrorCode.INVALID_PRODUCT),
        code: ErrorCode.INVALID_PRODUCT
      };
    }

    const sceneMatch = credential.order.scope.scenes.some(s => s.sceneId === sceneId);
    if (!sceneMatch) {
      return {
        valid: false,
        message: getErrorMessage(ErrorCode.INVALID_SCENE),
        code: ErrorCode.INVALID_SCENE
      };
    }

    return { valid: true, message: '使用范围校验通过' };
  }

  async recordPurpose(
    credentialId: string,
    purpose: string,
    callerIdentity: SubjectIdentity,
    callCount: number = 1
  ): Promise<{
    success: boolean;
    logEntry?: UsageLogEntry;
    error?: SDKError;
  }> {
    const result = await this.manager.recordUsage(
      credentialId,
      purpose,
      callerIdentity,
      callCount
    );
    return {
      success: result.success,
      logEntry: result.logEntry,
      error: result.error
    };
  }

  async checkValidity(credentialId: string): Promise<{
    success: boolean;
    validity?: {
      isValid: boolean;
      status: CredentialStatus;
      startTime: string;
      endTime: string;
      remainingDays: number;
      isExpired: boolean;
      isNotYetEffective: boolean;
    };
    error?: SDKError;
  }> {
    return this.manager.checkValidity(credentialId);
  }

  generateCredentialNo(): string {
    return generateCredentialNo();
  }

  async appendUsageLog(
    credentialId: string,
    logEntry: Omit<UsageLogEntry, 'logId' | 'timestamp' | 'periodKey'>
  ): Promise<{
    success: boolean;
    log?: UsageLogEntry;
    error?: SDKError;
  }> {
    return this.manager.appendUsageLog(credentialId, logEntry);
  }

  async revokeCredential(
    credentialId: string,
    revokedBy: string,
    reason: string
  ): Promise<{
    success: boolean;
    updatedCredential?: AuthCredential;
    error?: SDKError;
  }> {
    return this.manager.revokeCredential(credentialId, revokedBy, reason);
  }

  async getRemainingQuota(credentialId: string): Promise<{
    success: boolean;
    quota?: {
      remainingCalls: number;
      remainingRows?: number;
      remainingSizeKB?: number;
      usageRate: number;
      maxCalls: number;
      maxRows?: number;
      maxSizeKB?: number;
      periodKey: string;
      periodUsedCalls: number;
      periodUsedRows?: number;
      periodUsedSizeKB?: number;
    };
    error?: SDKError;
  }> {
    return this.manager.getRemainingQuota(credentialId);
  }

  async verifyIdentity(
    credentialId: string,
    subjectIdentity: SubjectIdentity
  ): Promise<{
    success: boolean;
    verification?: {
      isProvider: boolean;
      isConsumer: boolean;
      matchedRole: 'PROVIDER' | 'CONSUMER' | 'NONE';
    };
    error?: SDKError;
  }> {
    return this.manager.verifyIdentity(credentialId, subjectIdentity);
  }

  async getAuditSummary(credentialId: string): Promise<AuditSummary | null> {
    return this.manager.generateAuditSummaryAsync(credentialId);
  }

  async batchValidate(items: BatchValidationItem[]): Promise<BatchValidationResult> {
    return this.manager.batchValidate(items);
  }

  formatError(
    code: ErrorCode,
    customMessage?: string,
    details?: Record<string, unknown>
  ): SDKError {
    return formatError(code, customMessage || getErrorMessage(code), details);
  }

  async getCredential(credentialId: string): Promise<AuthCredential | undefined> {
    return this.manager.getCredential(credentialId);
  }

  async getAllCredentials(): Promise<AuthCredential[]> {
    return this.manager.getAllCredentials();
  }

  compareIdentity(a: { id: string; type?: string }, b: { id: string; type?: string }): boolean {
    return compareIdentity(a, b);
  }

  getPeriodKey(periodType: PeriodType, timestamp: number): string {
    return getPeriodKey(periodType, timestamp);
  }

  getPeriodRange(periodType: PeriodType, timestamp: number): { start: number; end: number } {
    return getPeriodRange(periodType, timestamp);
  }

  addPolicy(policy: AuthPolicy): void {
    this.policyManager.addPolicy(policy);
  }

  removePolicy(policyId: string): boolean {
    return this.policyManager.removePolicy(policyId);
  }

  getPolicy(policyId: string): AuthPolicy | undefined {
    return this.policyManager.getPolicy(policyId);
  }

  listPolicies(): AuthPolicy[] {
    return this.policyManager.listPolicies();
  }

  addRequiredFieldPolicy(
    targetType: PolicyTargetType,
    targetValue: string,
    requiredFields: string[],
    policyName?: string
  ): string {
    return this.policyManager.addRequiredFieldPolicy(targetType, targetValue, requiredFields, policyName);
  }

  addSubjectTypePolicy(
    targetType: PolicyTargetType,
    targetValue: string,
    allowedTypes: Array<'ORGANIZATION' | 'INDIVIDUAL' | 'SYSTEM'>,
    deniedTypes?: Array<'ORGANIZATION' | 'INDIVIDUAL' | 'SYSTEM'>,
    policyName?: string
  ): string {
    return this.policyManager.addSubjectTypePolicy(targetType, targetValue, allowedTypes, deniedTypes, policyName);
  }

  addDataSizeLimitPolicy(
    targetType: PolicyTargetType,
    targetValue: string,
    maxSizeKB: number,
    minSizeKB?: number,
    policyName?: string
  ): string {
    return this.policyManager.addDataSizeLimitPolicy(targetType, targetValue, maxSizeKB, minSizeKB, policyName);
  }

  async generateUsageReport(query: ReportQuery): Promise<UsageReport> {
    return this.reportGenerator.generateReport(query);
  }

  async generateReportByProvider(providerId: string, query?: Partial<ReportQuery>): Promise<UsageReport> {
    return this.reportGenerator.generateByProvider(providerId, query);
  }

  async generateReportByConsumer(consumerId: string, query?: Partial<ReportQuery>): Promise<UsageReport> {
    return this.reportGenerator.generateByConsumer(consumerId, query);
  }

  async generateReportByProduct(productId: string, query?: Partial<ReportQuery>): Promise<UsageReport> {
    return this.reportGenerator.generateByProduct(productId, query);
  }
}

export {
  AuthCredential,
  AuditSummary,
  AuthPolicy,
  AuthorizationOrder,
  BatchValidationItem,
  BatchValidationResult,
  CreateOrderParams,
  CredentialStatus,
  ErrorCode,
  ExecuteUsageParams,
  ExecuteUsageResult,
  IStorage,
  PeriodUsage,
  PeriodType,
  PreCheckParams,
  PreCheckResult,
  QuotaConfig,
  ReportQuery,
  SDKError,
  SubjectIdentity,
  UsageLogEntry,
  UsageReport,
  UsageScope,
  ValidationParams,
  ValidationResult,
  ValidationResultType,
  ValidityPeriod,
  ProductInfo,
  UsageScene,
  PolicyMatchResult,
  PolicyRule,
  PolicyTargetType,
  MemoryStorage,
  FileStorage,
  AuthPolicyManager,
  AuditReportGenerator,
  calculateRemainingDays,
  formatTimestamp,
  generateCredentialNo,
  getErrorMessage,
  getPeriodKey,
  getPeriodRange
};

export default DataAuthCredentialSDK;
