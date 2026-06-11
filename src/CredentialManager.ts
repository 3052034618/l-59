import {
  AuthCredential,
  AuthorizationOrder,
  AuditSummary,
  CreateOrderParams,
  CredentialStatus,
  ErrorCode,
  QuotaConfig,
  SDKError,
  UsageLogEntry,
  UsageScope,
  ValidationParams,
  ValidationResult,
  ValidationResultType,
  ValidityPeriod,
  SubjectIdentity,
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
  getErrorMessage,
  validateDateRange
} from './utils';

export class CredentialManager {
  private credentials: Map<string, AuthCredential> = new Map();

  createAuthorizationOrder(params: CreateOrderParams): {
    success: boolean;
    order?: AuthorizationOrder;
    credential?: AuthCredential;
    error?: SDKError;
  } {
    try {
      const validation = this.validateCreateParams(params);
      if (!validation.valid) {
        return {
          success: false,
          error: formatError(validation.errorCode!, validation.message!)
        };
      }

      const orderId = generateOrderId();
      const credentialId = generateCredentialId();
      const credentialNo = generateCredentialNo();

      const order: AuthorizationOrder = {
        orderId,
        credentialId,
        provider: params.provider,
        consumer: params.consumer,
        scope: params.scope,
        quota: params.quota,
        validity: params.validity,
        purpose: params.purpose,
        createdAt: Date.now(),
        createdBy: params.createdBy
      };

      const credential: AuthCredential = {
        credentialId,
        credentialNo,
        status: CredentialStatus.ACTIVE,
        order,
        usageLogs: [],
        totalUsedCalls: 0,
        totalUsedRows: params.quota.maxDataRows !== undefined ? 0 : undefined,
        totalUsedSizeKB: params.quota.maxDataSizeKB !== undefined ? 0 : undefined
      };

      this.credentials.set(credentialId, credential);

      return {
        success: true,
        order,
        credential
      };
    } catch (err) {
      return {
        success: false,
        error: formatError(ErrorCode.UNKNOWN_ERROR, '创建授权单失败', { error: String(err) })
      };
    }
  }

  validateCredential(params: ValidationParams): ValidationResult {
    try {
      const credential = this.credentials.get(params.credentialId);

      if (!credential) {
        return this.buildRejectResult(
          ErrorCode.CREDENTIAL_NOT_FOUND,
          getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND)
        );
      }

      if (credential.status === CredentialStatus.REVOKED) {
        return this.buildRejectResult(
          ErrorCode.CREDENTIAL_REVOKED,
          getErrorMessage(ErrorCode.CREDENTIAL_REVOKED),
          credential
        );
      }

      const now = Date.now();
      if (now > credential.order.validity.endTime) {
        credential.status = CredentialStatus.EXPIRED;
        this.credentials.set(params.credentialId, credential);
        return this.buildRejectResult(
          ErrorCode.CREDENTIAL_EXPIRED,
          getErrorMessage(ErrorCode.CREDENTIAL_EXPIRED),
          credential
        );
      }

      if (now < credential.order.validity.startTime) {
        return this.buildRejectResult(
          ErrorCode.INVALID_DATE_RANGE,
          '授权凭证尚未生效',
          credential
        );
      }

      if (credential.status === CredentialStatus.EXHAUSTED) {
        return this.buildRejectResult(
          ErrorCode.CREDENTIAL_EXHAUSTED,
          getErrorMessage(ErrorCode.CREDENTIAL_EXHAUSTED),
          credential
        );
      }

      const missingFields: string[] = [];
      if (!params.purpose) {
        missingFields.push('purpose');
      }
      if (missingFields.length > 0) {
        return {
          type: ValidationResultType.PENDING,
          passed: false,
          message: '需要补充必要信息',
          missingFields,
          credentialSnapshot: this.getCredentialSnapshot(credential)
        };
      }

      const scopeCheck = this.validateUsageScope(credential, params.productId, params.sceneId);
      if (!scopeCheck.valid) {
        return this.buildRejectResult(
          scopeCheck.errorCode!,
          scopeCheck.message!,
          credential
        );
      }

      const identityCheck = this.validateIdentity(credential, params.callerIdentity);
      if (!identityCheck.valid) {
        return this.buildRejectResult(
          ErrorCode.IDENTITY_MISMATCH,
          getErrorMessage(ErrorCode.IDENTITY_MISMATCH),
          credential
        );
      }

      const purposeCheck = this.validatePurpose(credential, params.purpose!);
      if (!purposeCheck.valid) {
        return this.buildRejectResult(
          ErrorCode.SCOPE_MISMATCH,
          '调用目的不在授权范围内',
          credential
        );
      }

      const quotaCheck = this.checkQuotaSufficiency(
        credential,
        params.expectedDataRows,
        params.expectedDataSizeKB
      );
      if (!quotaCheck.sufficient) {
        return this.buildRejectResult(
          ErrorCode.QUOTA_INSUFFICIENT,
          quotaCheck.message!,
          credential
        );
      }

      return {
        type: ValidationResultType.PASS,
        passed: true,
        message: '校验通过',
        credentialSnapshot: this.getCredentialSnapshot(credential),
        auditSummary: this.generateAuditSummary(credential) || undefined
      };
    } catch (err) {
      return this.buildRejectResult(
        ErrorCode.UNKNOWN_ERROR,
        `校验失败: ${String(err)}`
      );
    }
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
    try {
      const credential = this.credentials.get(credentialId);
      if (!credential) {
        return {
          success: false,
          error: formatError(ErrorCode.CREDENTIAL_NOT_FOUND, getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND))
        };
      }

      if (credential.status !== CredentialStatus.ACTIVE) {
        return {
          success: false,
          error: formatError(ErrorCode.INVALID_CREDENTIAL, `凭证状态为 ${credential.status}，无法记录使用`)
        };
      }

      const logEntry: UsageLogEntry = {
        logId: generateLogId(),
        timestamp: Date.now(),
        purpose,
        callCount,
        dataRows,
        dataSizeKB,
        callerIdentity: callerIdentity.id,
        remark
      };

      credential.usageLogs.push(logEntry);
      credential.totalUsedCalls += callCount;
      if (dataRows !== undefined && credential.totalUsedRows !== undefined) {
        credential.totalUsedRows += dataRows;
      }
      if (dataSizeKB !== undefined && credential.totalUsedSizeKB !== undefined) {
        credential.totalUsedSizeKB += dataSizeKB;
      }

      if (credential.totalUsedCalls >= credential.order.quota.maxCalls) {
        credential.status = CredentialStatus.EXHAUSTED;
      }

      this.credentials.set(credentialId, credential);

      return {
        success: true,
        logEntry,
        updatedCredential: credential
      };
    } catch (err) {
      return {
        success: false,
        error: formatError(ErrorCode.UNKNOWN_ERROR, '记录使用日志失败', { error: String(err) })
      };
    }
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
    try {
      const credential = this.credentials.get(credentialId);
      if (!credential) {
        return {
          success: false,
          error: formatError(ErrorCode.CREDENTIAL_NOT_FOUND, getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND))
        };
      }

      if (credential.status === CredentialStatus.REVOKED) {
        return {
          success: false,
          error: formatError(ErrorCode.INVALID_CREDENTIAL, '凭证已被撤销')
        };
      }

      credential.status = CredentialStatus.REVOKED;
      credential.revokedAt = Date.now();
      credential.revokedBy = revokedBy;
      credential.revokeReason = reason;

      this.credentials.set(credentialId, credential);

      return {
        success: true,
        updatedCredential: credential
      };
    } catch (err) {
      return {
        success: false,
        error: formatError(ErrorCode.UNKNOWN_ERROR, '撤销凭证失败', { error: String(err) })
      };
    }
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
    try {
      const credential = this.credentials.get(credentialId);
      if (!credential) {
        return {
          success: false,
          error: formatError(ErrorCode.CREDENTIAL_NOT_FOUND, getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND))
        };
      }

      const remainingCalls = Math.max(0, credential.order.quota.maxCalls - credential.totalUsedCalls);
      const usageRate = credential.order.quota.maxCalls > 0
        ? (credential.totalUsedCalls / credential.order.quota.maxCalls) * 100
        : 0;

      const result: any = {
        remainingCalls,
        usageRate: parseFloat(usageRate.toFixed(2)),
        maxCalls: credential.order.quota.maxCalls
      };

      if (credential.order.quota.maxDataRows !== undefined && credential.totalUsedRows !== undefined) {
        result.maxRows = credential.order.quota.maxDataRows;
        result.remainingRows = Math.max(0, credential.order.quota.maxDataRows - credential.totalUsedRows);
      }

      if (credential.order.quota.maxDataSizeKB !== undefined && credential.totalUsedSizeKB !== undefined) {
        result.maxSizeKB = credential.order.quota.maxDataSizeKB;
        result.remainingSizeKB = Math.max(0, credential.order.quota.maxDataSizeKB - credential.totalUsedSizeKB);
      }

      return {
        success: true,
        quota: result
      };
    } catch (err) {
      return {
        success: false,
        error: formatError(ErrorCode.UNKNOWN_ERROR, '查询剩余额度失败', { error: String(err) })
      };
    }
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
    try {
      const credential = this.credentials.get(credentialId);
      if (!credential) {
        return {
          success: false,
          error: formatError(ErrorCode.CREDENTIAL_NOT_FOUND, getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND))
        };
      }

      const now = Date.now();
      const isExpired = now > credential.order.validity.endTime;
      const isNotYetEffective = now < credential.order.validity.startTime;
      const isValid = credential.status === CredentialStatus.ACTIVE && !isExpired && !isNotYetEffective;

      return {
        success: true,
        validity: {
          isValid,
          status: credential.status,
          startTime: formatTimestamp(credential.order.validity.startTime),
          endTime: formatTimestamp(credential.order.validity.endTime),
          remainingDays: calculateRemainingDays(credential.order.validity.endTime),
          isExpired,
          isNotYetEffective
        }
      };
    } catch (err) {
      return {
        success: false,
        error: formatError(ErrorCode.UNKNOWN_ERROR, '检查有效期限失败', { error: String(err) })
      };
    }
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
    try {
      const credential = this.credentials.get(credentialId);
      if (!credential) {
        return {
          success: false,
          error: formatError(ErrorCode.CREDENTIAL_NOT_FOUND, getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND))
        };
      }

      const isProvider = compareIdentity(subjectIdentity, credential.order.provider);
      const isConsumer = compareIdentity(subjectIdentity, credential.order.consumer);

      let matchedRole: 'PROVIDER' | 'CONSUMER' | 'NONE' = 'NONE';
      if (isProvider) matchedRole = 'PROVIDER';
      else if (isConsumer) matchedRole = 'CONSUMER';

      return {
        success: true,
        verification: {
          isProvider,
          isConsumer,
          matchedRole
        }
      };
    } catch (err) {
      return {
        success: false,
        error: formatError(ErrorCode.UNKNOWN_ERROR, '比对主体身份失败', { error: String(err) })
      };
    }
  }

  appendUsageLog(
    credentialId: string,
    logEntry: Omit<UsageLogEntry, 'logId' | 'timestamp'>
  ): {
    success: boolean;
    log?: UsageLogEntry;
    error?: SDKError;
  } {
    try {
      const credential = this.credentials.get(credentialId);
      if (!credential) {
        return {
          success: false,
          error: formatError(ErrorCode.CREDENTIAL_NOT_FOUND, getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND))
        };
      }

      const fullLog: UsageLogEntry = {
        ...logEntry,
        logId: generateLogId(),
        timestamp: Date.now()
      };

      credential.usageLogs.push(fullLog);
      credential.totalUsedCalls += logEntry.callCount || 1;
      if (logEntry.dataRows !== undefined && credential.totalUsedRows !== undefined) {
        credential.totalUsedRows += logEntry.dataRows;
      }
      if (logEntry.dataSizeKB !== undefined && credential.totalUsedSizeKB !== undefined) {
        credential.totalUsedSizeKB += logEntry.dataSizeKB;
      }

      this.credentials.set(credentialId, credential);

      return {
        success: true,
        log: fullLog
      };
    } catch (err) {
      return {
        success: false,
        error: formatError(ErrorCode.UNKNOWN_ERROR, '追加使用日志失败', { error: String(err) })
      };
    }
  }

  generateAuditSummary(credentialId: string | AuthCredential): AuditSummary | null {
    try {
      let credential: AuthCredential;
      if (typeof credentialId === 'string') {
        const found = this.credentials.get(credentialId);
        if (!found) return null;
        credential = found;
      } else {
        credential = credentialId;
      }

      const remainingCalls = Math.max(0, credential.order.quota.maxCalls - credential.totalUsedCalls);
      const usageRate = credential.order.quota.maxCalls > 0
        ? parseFloat(((credential.totalUsedCalls / credential.order.quota.maxCalls) * 100).toFixed(2))
        : 0;

      const lastLog = credential.usageLogs[credential.usageLogs.length - 1];

      const summary: AuditSummary = {
        credentialId: credential.credentialId,
        credentialNo: credential.credentialNo,
        status: credential.status,
        providerInfo: {
          id: credential.order.provider.id,
          name: credential.order.provider.name
        },
        consumerInfo: {
          id: credential.order.consumer.id,
          name: credential.order.consumer.name
        },
        validityPeriod: {
          start: formatTimestamp(credential.order.validity.startTime),
          end: formatTimestamp(credential.order.validity.endTime),
          remainingDays: calculateRemainingDays(credential.order.validity.endTime)
        },
        quota: {
          maxCalls: credential.order.quota.maxCalls,
          usedCalls: credential.totalUsedCalls,
          remainingCalls,
          usageRate,
          maxDataRows: credential.order.quota.maxDataRows,
          usedRows: credential.totalUsedRows,
          remainingRows: credential.order.quota.maxDataRows !== undefined && credential.totalUsedRows !== undefined
            ? Math.max(0, credential.order.quota.maxDataRows - credential.totalUsedRows)
            : undefined,
          maxDataSizeKB: credential.order.quota.maxDataSizeKB,
          usedSizeKB: credential.totalUsedSizeKB,
          remainingSizeKB: credential.order.quota.maxDataSizeKB !== undefined && credential.totalUsedSizeKB !== undefined
            ? Math.max(0, credential.order.quota.maxDataSizeKB - credential.totalUsedSizeKB)
            : undefined
        },
        totalUsageLogs: credential.usageLogs.length,
        lastUsedAt: lastLog?.timestamp,
        scopeSummary: {
          products: credential.order.scope.products.map(p => p.productName),
          scenes: credential.order.scope.scenes.map(s => s.sceneName),
          purposes: credential.order.scope.allowedPurposes
        }
      };

      return summary;
    } catch {
      return null;
    }
  }

  getCredential(credentialId: string): AuthCredential | undefined {
    return this.credentials.get(credentialId);
  }

  getAllCredentials(): AuthCredential[] {
    return Array.from(this.credentials.values());
  }

  private validateCreateParams(params: CreateOrderParams): {
    valid: boolean;
    errorCode?: ErrorCode;
    message?: string;
  } {
    if (!params.provider || !params.provider.id) {
      return { valid: false, errorCode: ErrorCode.INVALID_PRODUCT, message: '提供方身份信息无效' };
    }
    if (!params.consumer || !params.consumer.id) {
      return { valid: false, errorCode: ErrorCode.INVALID_CONSUMER, message: getErrorMessage(ErrorCode.INVALID_CONSUMER) };
    }
    if (!params.scope || !params.scope.products || params.scope.products.length === 0) {
      return { valid: false, errorCode: ErrorCode.INVALID_PRODUCT, message: '授权产品列表不能为空' };
    }
    if (!params.scope.scenes || params.scope.scenes.length === 0) {
      return { valid: false, errorCode: ErrorCode.INVALID_SCENE, message: '使用场景列表不能为空' };
    }
    if (!params.quota || params.quota.maxCalls <= 0) {
      return { valid: false, errorCode: ErrorCode.INVALID_QUOTA, message: getErrorMessage(ErrorCode.INVALID_QUOTA) };
    }
    if (!params.validity || !validateDateRange(params.validity.startTime, params.validity.endTime)) {
      return { valid: false, errorCode: ErrorCode.INVALID_DATE_RANGE, message: getErrorMessage(ErrorCode.INVALID_DATE_RANGE) };
    }
    if (!params.purpose || params.purpose.trim() === '') {
      return { valid: false, errorCode: ErrorCode.PURPOSE_REQUIRED, message: getErrorMessage(ErrorCode.PURPOSE_REQUIRED) };
    }
    return { valid: true };
  }

  private validateUsageScope(
    credential: AuthCredential,
    productId: string,
    sceneId: string
  ): { valid: boolean; errorCode?: ErrorCode; message?: string } {
    const productMatch = credential.order.scope.products.some(p => p.productId === productId);
    if (!productMatch) {
      return { valid: false, errorCode: ErrorCode.INVALID_PRODUCT, message: getErrorMessage(ErrorCode.INVALID_PRODUCT) };
    }

    const sceneMatch = credential.order.scope.scenes.some(s => s.sceneId === sceneId);
    if (!sceneMatch) {
      return { valid: false, errorCode: ErrorCode.INVALID_SCENE, message: getErrorMessage(ErrorCode.INVALID_SCENE) };
    }

    return { valid: true };
  }

  private validateIdentity(
    credential: AuthCredential,
    callerIdentity: SubjectIdentity
  ): { valid: boolean } {
    const isConsumer = compareIdentity(callerIdentity, credential.order.consumer);
    return { valid: isConsumer };
  }

  private validatePurpose(
    credential: AuthCredential,
    purpose: string
  ): { valid: boolean } {
    if (credential.order.scope.allowedPurposes.length === 0) {
      return { valid: true };
    }
    const matched = credential.order.scope.allowedPurposes.some(
      p => purpose.includes(p) || p.includes(purpose)
    );
    return { valid: matched };
  }

  private checkQuotaSufficiency(
    credential: AuthCredential,
    expectedRows?: number,
    expectedSizeKB?: number
  ): { sufficient: boolean; message?: string } {
    const remainingCalls = credential.order.quota.maxCalls - credential.totalUsedCalls;
    if (remainingCalls <= 0) {
      return { sufficient: false, message: '调用次数已用尽' };
    }

    if (expectedRows !== undefined && credential.order.quota.maxDataRows !== undefined) {
      const remainingRows = credential.order.quota.maxDataRows - (credential.totalUsedRows || 0);
      if (remainingRows < expectedRows) {
        return { sufficient: false, message: `数据行数额度不足，剩余 ${remainingRows} 行，需要 ${expectedRows} 行` };
      }
    }

    if (expectedSizeKB !== undefined && credential.order.quota.maxDataSizeKB !== undefined) {
      const remainingSize = credential.order.quota.maxDataSizeKB - (credential.totalUsedSizeKB || 0);
      if (remainingSize < expectedSizeKB) {
        return { sufficient: false, message: `数据量额度不足，剩余 ${remainingSize} KB，需要 ${expectedSizeKB} KB` };
      }
    }

    return { sufficient: true };
  }

  private buildRejectResult(
    code: ErrorCode,
    message: string,
    credential?: AuthCredential
  ): ValidationResult {
    return {
      type: ValidationResultType.REJECT,
      passed: false,
      message,
      code,
      credentialSnapshot: credential ? this.getCredentialSnapshot(credential) : undefined
    };
  }

  private getCredentialSnapshot(credential: AuthCredential): Partial<AuthCredential> {
    return {
      credentialId: credential.credentialId,
      credentialNo: credential.credentialNo,
      status: credential.status,
      totalUsedCalls: credential.totalUsedCalls,
      totalUsedRows: credential.totalUsedRows,
      totalUsedSizeKB: credential.totalUsedSizeKB,
      order: {
        ...credential.order,
        validity: credential.order.validity
      }
    };
  }
}
