import { CredentialManager } from './CredentialManager';
import {
  AuthCredential,
  AuthorizationOrder,
  AuditSummary,
  CreateOrderParams,
  CredentialStatus,
  ErrorCode,
  QuotaConfig,
  SDKError,
  SubjectIdentity,
  UsageLogEntry,
  UsageScope,
  ValidationParams,
  ValidationResult,
  ValidationResultType,
  ValidityPeriod,
  ProductInfo,
  UsageScene
} from './types';
import {
  calculateRemainingDays,
  compareIdentity,
  formatError,
  formatTimestamp,
  generateCredentialId,
  generateCredentialNo,
  generateLogId,
  generateOrderId,
  getErrorMessage
} from './utils';

export class DataAuthCredentialSDK {
  private manager: CredentialManager;

  constructor() {
    this.manager = new CredentialManager();
  }

  createAuthorization(params: CreateOrderParams): {
    success: boolean;
    order?: AuthorizationOrder;
    credential?: AuthCredential;
    error?: SDKError;
  } {
    return this.manager.createAuthorizationOrder(params);
  }

  validate(params: ValidationParams): ValidationResult {
    return this.manager.validateCredential(params);
  }

  recordUsage(
    credentialId: string,
    purpose: string,
    callerIdentity: SubjectIdentity,
    callCount: number = 1,
    dataRows?: number,
    dataSizeKB?: number,
    remark?: string
  ): {
    success: boolean;
    logEntry?: UsageLogEntry;
    updatedCredential?: AuthCredential;
    error?: SDKError;
  } {
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

  checkUsageScope(
    credentialId: string,
    productId: string,
    sceneId: string
  ): {
    valid: boolean;
    message: string;
    code?: ErrorCode;
  } {
    const credential = this.manager.getCredential(credentialId);
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

  recordPurpose(
    credentialId: string,
    purpose: string,
    callerIdentity: SubjectIdentity,
    callCount: number = 1
  ): {
    success: boolean;
    logEntry?: UsageLogEntry;
    error?: SDKError;
  } {
    const result = this.manager.recordUsage(
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

  checkValidity(credentialId: string): {
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
  } {
    return this.manager.checkValidity(credentialId);
  }

  generateCredentialNo(): string {
    return generateCredentialNo();
  }

  appendUsageLog(
    credentialId: string,
    logEntry: Omit<UsageLogEntry, 'logId' | 'timestamp'>
  ): {
    success: boolean;
    log?: UsageLogEntry;
    error?: SDKError;
  } {
    return this.manager.appendUsageLog(credentialId, logEntry);
  }

  revokeCredential(
    credentialId: string,
    revokedBy: string,
    reason: string
  ): {
    success: boolean;
    updatedCredential?: AuthCredential;
    error?: SDKError;
  } {
    return this.manager.revokeCredential(credentialId, revokedBy, reason);
  }

  getRemainingQuota(credentialId: string): {
    success: boolean;
    quota?: {
      remainingCalls: number;
      remainingRows?: number;
      remainingSizeKB?: number;
      usageRate: number;
      maxCalls: number;
      maxRows?: number;
      maxSizeKB?: number;
    };
    error?: SDKError;
  } {
    return this.manager.getRemainingQuota(credentialId);
  }

  verifyIdentity(
    credentialId: string,
    subjectIdentity: SubjectIdentity
  ): {
    success: boolean;
    verification?: {
      isProvider: boolean;
      isConsumer: boolean;
      matchedRole: 'PROVIDER' | 'CONSUMER' | 'NONE';
    };
    error?: SDKError;
  } {
    return this.manager.verifyIdentity(credentialId, subjectIdentity);
  }

  getAuditSummary(credentialId: string): AuditSummary | null {
    return this.manager.generateAuditSummary(credentialId);
  }

  formatError(
    code: ErrorCode,
    customMessage?: string,
    details?: Record<string, unknown>
  ): SDKError {
    return formatError(code, customMessage || getErrorMessage(code), details);
  }

  getCredential(credentialId: string): AuthCredential | undefined {
    return this.manager.getCredential(credentialId);
  }

  getAllCredentials(): AuthCredential[] {
    return this.manager.getAllCredentials();
  }

  compareIdentity(a: { id: string; type?: string }, b: { id: string; type?: string }): boolean {
    return compareIdentity(a, b);
  }
}

export {
  AuthCredential,
  AuthorizationOrder,
  AuditSummary,
  CreateOrderParams,
  CredentialStatus,
  ErrorCode,
  QuotaConfig,
  SDKError,
  SubjectIdentity,
  UsageLogEntry,
  UsageScope,
  ValidationParams,
  ValidationResult,
  ValidationResultType,
  ValidityPeriod,
  ProductInfo,
  UsageScene,
  calculateRemainingDays,
  formatTimestamp,
  generateCredentialId,
  generateCredentialNo,
  generateLogId,
  generateOrderId,
  getErrorMessage
};

export default DataAuthCredentialSDK;
