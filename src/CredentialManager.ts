import {
  AuthCredential,
  AuthorizationOrder,
  AuditSummary,
  BatchValidationItem,
  BatchValidationResult,
  CreateOrderParams,
  CredentialStatus,
  ErrorCode,
  ExecuteUsageParams,
  ExecuteUsageResult,
  IStorage,
  PeriodUsage,
  PreCheckParams,
  PreCheckResult,
  SDKError,
  SubjectIdentity,
  UsageLogEntry,
  ValidationParams,
  ValidationResult,
  ValidationResultType
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
  getPeriodKey,
  getPeriodRange,
  isNewPeriod,
  validateDateRange
} from './utils';

export class CredentialManager {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  async createAuthorizationOrder(params: CreateOrderParams): Promise<{
    success: boolean;
    order?: AuthorizationOrder;
    credential?: AuthCredential;
    error?: SDKError;
  }> {
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
      const now = Date.now();

      const periodRange = getPeriodRange(params.quota.periodType, now);
      const periodKey = getPeriodKey(params.quota.periodType, now);

      const currentPeriod: PeriodUsage = {
        periodKey,
        periodStart: periodRange.start,
        periodEnd: periodRange.end,
        usedCalls: 0,
        usedRows: 0,
        usedSizeKB: 0
      };

      const order: AuthorizationOrder = {
        orderId,
        credentialId,
        provider: params.provider,
        consumer: params.consumer,
        scope: params.scope,
        quota: params.quota,
        validity: params.validity,
        purpose: params.purpose,
        createdAt: now,
        createdBy: params.createdBy
      };

      const credential: AuthCredential = {
        credentialId,
        credentialNo,
        status: CredentialStatus.ACTIVE,
        order,
        usageLogs: [],
        currentPeriod,
        periodHistory: [],
        totalUsedCalls: 0,
        totalUsedRows: params.quota.maxDataRows !== undefined ? 0 : undefined,
        totalUsedSizeKB: params.quota.maxDataSizeKB !== undefined ? 0 : undefined
      };

      await this.storage.set(credentialId, credential);

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

  async validateCredential(params: ValidationParams): Promise<ValidationResult> {
    try {
      const credential = await this.storage.get(params.credentialId);

      if (!credential) {
        return this.buildRejectResult(
          ErrorCode.CREDENTIAL_NOT_FOUND,
          getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND)
        );
      }

      const statusCheck = this.checkCredentialStatus(credential);
      if (!statusCheck.valid) {
        return this.buildRejectResult(statusCheck.errorCode!, statusCheck.message!, credential);
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
        return this.buildRejectResult(scopeCheck.errorCode!, scopeCheck.message!, credential);
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

      const refreshedCred = await this.refreshPeriodIfNeeded(credential);
      const quotaCheck = this.checkPeriodQuotaSufficiency(
        refreshedCred,
        params.expectedDataRows,
        params.expectedDataSizeKB
      );
      if (!quotaCheck.sufficient) {
        return this.buildRejectResult(
          ErrorCode.QUOTA_INSUFFICIENT,
          quotaCheck.message!,
          refreshedCred
        );
      }

      return {
        type: ValidationResultType.PASS,
        passed: true,
        message: '校验通过',
        credentialSnapshot: this.getCredentialSnapshot(refreshedCred),
        auditSummary: await this.generateAuditSummaryAsync(refreshedCred) || undefined
      };
    } catch (err) {
      return this.buildRejectResult(
        ErrorCode.UNKNOWN_ERROR,
        `校验失败: ${String(err)}`
      );
    }
  }

  async preCheck(params: PreCheckParams): Promise<PreCheckResult> {
    try {
      if (!params.callCount || params.callCount <= 0) {
        return {
          canProceed: false,
          message: getErrorMessage(ErrorCode.INVALID_CALL_COUNT),
          code: ErrorCode.INVALID_CALL_COUNT
        };
      }
      if (params.dataRows !== undefined && params.dataRows <= 0) {
        return {
          canProceed: false,
          message: getErrorMessage(ErrorCode.INVALID_DATA_ROWS),
          code: ErrorCode.INVALID_DATA_ROWS
        };
      }
      if (params.dataSizeKB !== undefined && params.dataSizeKB <= 0) {
        return {
          canProceed: false,
          message: getErrorMessage(ErrorCode.INVALID_DATA_SIZE),
          code: ErrorCode.INVALID_DATA_SIZE
        };
      }

      const credential = await this.storage.get(params.credentialId);
      if (!credential) {
        return {
          canProceed: false,
          message: getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND),
          code: ErrorCode.CREDENTIAL_NOT_FOUND
        };
      }

      const statusCheck = this.checkCredentialStatus(credential);
      if (!statusCheck.valid) {
        return {
          canProceed: false,
          message: statusCheck.message!,
          code: statusCheck.errorCode!
        };
      }

      const refreshedCred = await this.refreshPeriodIfNeeded(credential);

      const maxCalls = refreshedCred.order.quota.maxCalls;
      const remainingCalls = maxCalls - refreshedCred.currentPeriod.usedCalls;
      if (remainingCalls < params.callCount) {
        return {
          canProceed: false,
          message: `当前周期调用次数额度不足，剩余 ${remainingCalls} 次，请求 ${params.callCount} 次`,
          code: ErrorCode.QUOTA_INSUFFICIENT
        };
      }

      const result: PreCheckResult = {
        canProceed: true,
        message: '预检查通过，可以执行扣减',
        reservedQuota: {
          calls: params.callCount,
          rows: params.dataRows,
          sizeKB: params.dataSizeKB
        },
        remainingAfterDeduction: {
          calls: remainingCalls - params.callCount
        }
      };

      if (params.dataRows !== undefined && refreshedCred.order.quota.maxDataRows !== undefined) {
        const remainingRows = refreshedCred.order.quota.maxDataRows - refreshedCred.currentPeriod.usedRows;
        if (remainingRows < params.dataRows) {
          return {
            canProceed: false,
            message: `当前周期数据行数额度不足，剩余 ${remainingRows} 行，请求 ${params.dataRows} 行`,
            code: ErrorCode.QUOTA_INSUFFICIENT
          };
        }
        result.remainingAfterDeduction!.rows = remainingRows - params.dataRows;
      }

      if (params.dataSizeKB !== undefined && refreshedCred.order.quota.maxDataSizeKB !== undefined) {
        const remainingSize = refreshedCred.order.quota.maxDataSizeKB - refreshedCred.currentPeriod.usedSizeKB;
        if (remainingSize < params.dataSizeKB) {
          return {
            canProceed: false,
            message: `当前周期数据量额度不足，剩余 ${remainingSize} KB，请求 ${params.dataSizeKB} KB`,
            code: ErrorCode.QUOTA_INSUFFICIENT
          };
        }
        result.remainingAfterDeduction!.sizeKB = remainingSize - params.dataSizeKB;
      }

      return result;
    } catch (err) {
      return {
        canProceed: false,
        message: `预检查失败: ${String(err)}`,
        code: ErrorCode.UNKNOWN_ERROR
      };
    }
  }

  async executeUsage(params: ExecuteUsageParams): Promise<ExecuteUsageResult> {
    try {
      if (!params.callCount || params.callCount <= 0) {
        return {
          success: false,
          error: formatError(ErrorCode.INVALID_CALL_COUNT, getErrorMessage(ErrorCode.INVALID_CALL_COUNT))
        };
      }
      if (params.dataRows !== undefined && params.dataRows <= 0) {
        return {
          success: false,
          error: formatError(ErrorCode.INVALID_DATA_ROWS, getErrorMessage(ErrorCode.INVALID_DATA_ROWS))
        };
      }
      if (params.dataSizeKB !== undefined && params.dataSizeKB <= 0) {
        return {
          success: false,
          error: formatError(ErrorCode.INVALID_DATA_SIZE, getErrorMessage(ErrorCode.INVALID_DATA_SIZE))
        };
      }

      const credential = await this.storage.get(params.credentialId);
      if (!credential) {
        return {
          success: false,
          error: formatError(ErrorCode.CREDENTIAL_NOT_FOUND, getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND))
        };
      }

      if (credential.status !== CredentialStatus.ACTIVE) {
        return {
          success: false,
          error: formatError(ErrorCode.INVALID_CREDENTIAL, `凭证状态为 ${credential.status}，无法执行扣减`)
        };
      }

      const refreshedCred = await this.refreshPeriodIfNeeded(credential);

      const maxCalls = refreshedCred.order.quota.maxCalls;
      const newUsedCalls = refreshedCred.currentPeriod.usedCalls + params.callCount;

      if (newUsedCalls > maxCalls) {
        return {
          success: false,
          error: formatError(
            ErrorCode.QUOTA_INSUFFICIENT,
            `调用次数额度不足，当前周期已用 ${refreshedCred.currentPeriod.usedCalls} 次，请求 ${params.callCount} 次，上限 ${maxCalls} 次`
          )
        };
      }

      if (params.dataRows !== undefined && refreshedCred.order.quota.maxDataRows !== undefined) {
        const newUsedRows = refreshedCred.currentPeriod.usedRows + params.dataRows;
        if (newUsedRows > refreshedCred.order.quota.maxDataRows) {
          return {
            success: false,
            error: formatError(
              ErrorCode.QUOTA_INSUFFICIENT,
              `数据行数额度不足，当前周期已用 ${refreshedCred.currentPeriod.usedRows} 行，请求 ${params.dataRows} 行，上限 ${refreshedCred.order.quota.maxDataRows} 行`
            )
          };
        }
      }

      if (params.dataSizeKB !== undefined && refreshedCred.order.quota.maxDataSizeKB !== undefined) {
        const newUsedSize = refreshedCred.currentPeriod.usedSizeKB + params.dataSizeKB;
        if (newUsedSize > refreshedCred.order.quota.maxDataSizeKB) {
          return {
            success: false,
            error: formatError(
              ErrorCode.QUOTA_INSUFFICIENT,
              `数据量额度不足，当前周期已用 ${refreshedCred.currentPeriod.usedSizeKB} KB，请求 ${params.dataSizeKB} KB，上限 ${refreshedCred.order.quota.maxDataSizeKB} KB`
            )
          };
        }
      }

      const now = Date.now();
      const periodKey = getPeriodKey(refreshedCred.order.quota.periodType, now);

      const logEntry: UsageLogEntry = {
        logId: generateLogId(),
        timestamp: now,
        purpose: params.purpose,
        callCount: params.callCount,
        dataRows: params.dataRows,
        dataSizeKB: params.dataSizeKB,
        callerIdentity: params.callerIdentity.id,
        remark: params.remark,
        periodKey
      };

      refreshedCred.usageLogs.push(logEntry);

      refreshedCred.currentPeriod.usedCalls += params.callCount;
      if (params.dataRows !== undefined) {
        refreshedCred.currentPeriod.usedRows += params.dataRows;
      }
      if (params.dataSizeKB !== undefined) {
        refreshedCred.currentPeriod.usedSizeKB += params.dataSizeKB;
      }

      refreshedCred.totalUsedCalls += params.callCount;
      if (params.dataRows !== undefined && refreshedCred.totalUsedRows !== undefined) {
        refreshedCred.totalUsedRows += params.dataRows;
      }
      if (params.dataSizeKB !== undefined && refreshedCred.totalUsedSizeKB !== undefined) {
        refreshedCred.totalUsedSizeKB += params.dataSizeKB;
      }

      if (refreshedCred.order.quota.periodType === 'ONCE' && refreshedCred.currentPeriod.usedCalls >= maxCalls) {
        refreshedCred.status = CredentialStatus.EXHAUSTED;
      }

      await this.storage.set(params.credentialId, refreshedCred);

      const remainingCalls = maxCalls - refreshedCred.currentPeriod.usedCalls;

      const result: ExecuteUsageResult = {
        success: true,
        logEntry,
        updatedCredential: refreshedCred,
        deducted: {
          calls: params.callCount,
          rows: params.dataRows,
          sizeKB: params.dataSizeKB
        },
        remainingAfter: {
          calls: remainingCalls
        }
      };

      if (refreshedCred.order.quota.maxDataRows !== undefined) {
        result.remainingAfter!.rows = refreshedCred.order.quota.maxDataRows - refreshedCred.currentPeriod.usedRows;
      }
      if (refreshedCred.order.quota.maxDataSizeKB !== undefined) {
        result.remainingAfter!.sizeKB = refreshedCred.order.quota.maxDataSizeKB - refreshedCred.currentPeriod.usedSizeKB;
      }

      return result;
    } catch (err) {
      return {
        success: false,
        error: formatError(ErrorCode.UNKNOWN_ERROR, '执行使用扣减失败', { error: String(err) })
      };
    }
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
    const result = await this.executeUsage({
      credentialId,
      purpose,
      callerIdentity,
      callCount,
      dataRows,
      dataSizeKB,
      remark
    });

    return {
      success: result.success,
      logEntry: result.logEntry,
      updatedCredential: result.updatedCredential,
      error: result.error
    };
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
    try {
      const credential = await this.storage.get(credentialId);
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

      await this.storage.set(credentialId, credential);

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
    try {
      const credential = await this.storage.get(credentialId);
      if (!credential) {
        return {
          success: false,
          error: formatError(ErrorCode.CREDENTIAL_NOT_FOUND, getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND))
        };
      }

      const refreshedCred = await this.refreshPeriodIfNeeded(credential);
      const maxCalls = refreshedCred.order.quota.maxCalls;
      const periodUsedCalls = refreshedCred.currentPeriod.usedCalls;
      const remainingCalls = Math.max(0, maxCalls - periodUsedCalls);
      const usageRate = maxCalls > 0
        ? parseFloat(((periodUsedCalls / maxCalls) * 100).toFixed(2))
        : 0;

      const result: any = {
        remainingCalls,
        usageRate,
        maxCalls,
        periodKey: refreshedCred.currentPeriod.periodKey,
        periodUsedCalls
      };

      if (refreshedCred.order.quota.maxDataRows !== undefined) {
        result.maxRows = refreshedCred.order.quota.maxDataRows;
        result.remainingRows = Math.max(0, refreshedCred.order.quota.maxDataRows - refreshedCred.currentPeriod.usedRows);
        result.periodUsedRows = refreshedCred.currentPeriod.usedRows;
      }

      if (refreshedCred.order.quota.maxDataSizeKB !== undefined) {
        result.maxSizeKB = refreshedCred.order.quota.maxDataSizeKB;
        result.remainingSizeKB = Math.max(0, refreshedCred.order.quota.maxDataSizeKB - refreshedCred.currentPeriod.usedSizeKB);
        result.periodUsedSizeKB = refreshedCred.currentPeriod.usedSizeKB;
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
    try {
      const credential = await this.storage.get(credentialId);
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
    try {
      const credential = await this.storage.get(credentialId);
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

  async appendUsageLog(
    credentialId: string,
    logEntry: Omit<UsageLogEntry, 'logId' | 'timestamp' | 'periodKey'>
  ): Promise<{
    success: boolean;
    log?: UsageLogEntry;
    error?: SDKError;
  }> {
    try {
      const credential = await this.storage.get(credentialId);
      if (!credential) {
        return {
          success: false,
          error: formatError(ErrorCode.CREDENTIAL_NOT_FOUND, getErrorMessage(ErrorCode.CREDENTIAL_NOT_FOUND))
        };
      }

      const refreshedCred = await this.refreshPeriodIfNeeded(credential);

      const callCount = logEntry.callCount || 1;
      const dataRows = logEntry.dataRows;
      const dataSizeKB = logEntry.dataSizeKB;

      const maxCalls = refreshedCred.order.quota.maxCalls;
      if (refreshedCred.currentPeriod.usedCalls + callCount > maxCalls) {
        return {
          success: false,
          error: formatError(ErrorCode.QUOTA_INSUFFICIENT, '追加日志会导致当前周期用量超过上限')
        };
      }

      if (dataRows !== undefined && refreshedCred.order.quota.maxDataRows !== undefined) {
        if (refreshedCred.currentPeriod.usedRows + dataRows > refreshedCred.order.quota.maxDataRows) {
          return {
            success: false,
            error: formatError(ErrorCode.QUOTA_INSUFFICIENT, '追加日志会导致当前周期数据行数超过上限')
          };
        }
      }

      if (dataSizeKB !== undefined && refreshedCred.order.quota.maxDataSizeKB !== undefined) {
        if (refreshedCred.currentPeriod.usedSizeKB + dataSizeKB > refreshedCred.order.quota.maxDataSizeKB) {
          return {
            success: false,
            error: formatError(ErrorCode.QUOTA_INSUFFICIENT, '追加日志会导致当前周期数据量超过上限')
          };
        }
      }

      const now = Date.now();
      const periodKey = getPeriodKey(refreshedCred.order.quota.periodType, now);

      const fullLog: UsageLogEntry = {
        ...logEntry,
        logId: generateLogId(),
        timestamp: now,
        periodKey
      };

      refreshedCred.usageLogs.push(fullLog);
      refreshedCred.currentPeriod.usedCalls += callCount;
      if (dataRows !== undefined) {
        refreshedCred.currentPeriod.usedRows += dataRows;
      }
      if (dataSizeKB !== undefined) {
        refreshedCred.currentPeriod.usedSizeKB += dataSizeKB;
      }

      refreshedCred.totalUsedCalls += callCount;
      if (dataRows !== undefined && refreshedCred.totalUsedRows !== undefined) {
        refreshedCred.totalUsedRows += dataRows;
      }
      if (dataSizeKB !== undefined && refreshedCred.totalUsedSizeKB !== undefined) {
        refreshedCred.totalUsedSizeKB += dataSizeKB;
      }

      if (refreshedCred.order.quota.periodType === 'ONCE' && refreshedCred.currentPeriod.usedCalls >= maxCalls) {
        refreshedCred.status = CredentialStatus.EXHAUSTED;
      }

      await this.storage.set(credentialId, refreshedCred);

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

  async batchValidate(items: BatchValidationItem[]): Promise<BatchValidationResult> {
    const results: Array<ValidationResult & { index: number }> = [];
    const nearExpirySet = new Map<string, number>();
    const lowQuotaSet = new Map<string, number>();

    let passed = 0;
    let rejected = 0;
    let pending = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const result = await this.validateCredential({
        credentialId: item.credentialId,
        productId: item.productId,
        sceneId: item.sceneId,
        callerIdentity: item.callerIdentity,
        purpose: item.purpose,
        expectedDataRows: item.expectedDataRows,
        expectedDataSizeKB: item.expectedDataSizeKB
      });

      results.push({ ...result, index: i });

      if (result.type === ValidationResultType.PASS) passed++;
      else if (result.type === ValidationResultType.REJECT) rejected++;
      else pending++;

      if (result.credentialSnapshot) {
        const credId = result.credentialSnapshot.credentialId;
        if (credId) {
          const cred = await this.storage.get(credId);
          if (cred) {
            const remainingDays = calculateRemainingDays(cred.order.validity.endTime);
            if (remainingDays <= 7 && remainingDays > 0) {
              nearExpirySet.set(credId, remainingDays);
            }

            const maxCalls = cred.order.quota.maxCalls;
            const periodUsed = cred.currentPeriod.usedCalls;
            const usageRate = maxCalls > 0 ? (periodUsed / maxCalls) * 100 : 0;
            if (usageRate >= 80) {
              lowQuotaSet.set(credId, parseFloat(usageRate.toFixed(2)));
            }
          }
        }
      }
    }

    return {
      results,
      summary: {
        total: items.length,
        passed,
        rejected,
        pending,
        nearExpiryCredentials: Array.from(nearExpirySet.entries()).map(([credentialId, remainingDays]) => ({ credentialId, remainingDays })),
        lowQuotaCredentials: Array.from(lowQuotaSet.entries()).map(([credentialId, usageRate]) => ({ credentialId, usageRate }))
      }
    };
  }

  generateAuditSummary(credentialId: string | AuthCredential): AuditSummary | null {
    try {
      throw new Error('Use async generateAuditSummaryAsync instead');
    } catch {
      return null;
    }
  }

  async generateAuditSummaryAsync(credentialId: string | AuthCredential): Promise<AuditSummary | null> {
    try {
      let credential: AuthCredential;
      if (typeof credentialId === 'string') {
        const found = await this.storage.get(credentialId);
        if (!found) return null;
        credential = found;
      } else {
        credential = credentialId;
      }

      const refreshedCred = await this.refreshPeriodIfNeeded(credential);

      const maxCalls = refreshedCred.order.quota.maxCalls;
      const remainingCalls = Math.max(0, maxCalls - refreshedCred.currentPeriod.usedCalls);
      const usageRate = maxCalls > 0
        ? parseFloat(((refreshedCred.currentPeriod.usedCalls / maxCalls) * 100).toFixed(2))
        : 0;

      const lastLog = refreshedCred.usageLogs[refreshedCred.usageLogs.length - 1];

      const maxDataRows = refreshedCred.order.quota.maxDataRows;
      const maxDataSizeKB = refreshedCred.order.quota.maxDataSizeKB;

      const summary: AuditSummary = {
        credentialId: refreshedCred.credentialId,
        credentialNo: refreshedCred.credentialNo,
        status: refreshedCred.status,
        providerInfo: {
          id: refreshedCred.order.provider.id,
          name: refreshedCred.order.provider.name
        },
        consumerInfo: {
          id: refreshedCred.order.consumer.id,
          name: refreshedCred.order.consumer.name
        },
        validityPeriod: {
          start: formatTimestamp(refreshedCred.order.validity.startTime),
          end: formatTimestamp(refreshedCred.order.validity.endTime),
          remainingDays: calculateRemainingDays(refreshedCred.order.validity.endTime)
        },
        quota: {
          maxCalls,
          usedCalls: refreshedCred.currentPeriod.usedCalls,
          remainingCalls,
          usageRate,
          maxDataRows,
          usedRows: maxDataRows !== undefined ? refreshedCred.currentPeriod.usedRows : undefined,
          remainingRows: maxDataRows !== undefined ? Math.max(0, maxDataRows - refreshedCred.currentPeriod.usedRows) : undefined,
          maxDataSizeKB,
          usedSizeKB: maxDataSizeKB !== undefined ? refreshedCred.currentPeriod.usedSizeKB : undefined,
          remainingSizeKB: maxDataSizeKB !== undefined ? Math.max(0, maxDataSizeKB - refreshedCred.currentPeriod.usedSizeKB) : undefined
        },
        currentPeriod: {
          periodKey: refreshedCred.currentPeriod.periodKey,
          periodStart: formatTimestamp(refreshedCred.currentPeriod.periodStart),
          periodEnd: formatTimestamp(refreshedCred.currentPeriod.periodEnd),
          usedCalls: refreshedCred.currentPeriod.usedCalls,
          usedRows: refreshedCred.currentPeriod.usedRows,
          usedSizeKB: refreshedCred.currentPeriod.usedSizeKB,
          remainingCalls: remainingCalls,
          remainingRows: maxDataRows !== undefined ? Math.max(0, maxDataRows - refreshedCred.currentPeriod.usedRows) : 0,
          remainingSizeKB: maxDataSizeKB !== undefined ? Math.max(0, maxDataSizeKB - refreshedCred.currentPeriod.usedSizeKB) : 0
        },
        periodHistory: refreshedCred.periodHistory.map(p => ({
          periodKey: p.periodKey,
          periodStart: formatTimestamp(p.periodStart),
          periodEnd: formatTimestamp(p.periodEnd),
          usedCalls: p.usedCalls,
          usedRows: p.usedRows,
          usedSizeKB: p.usedSizeKB
        })),
        totalUsageLogs: refreshedCred.usageLogs.length,
        lastUsedAt: lastLog?.timestamp,
        scopeSummary: {
          products: refreshedCred.order.scope.products.map(p => p.productName),
          scenes: refreshedCred.order.scope.scenes.map(s => s.sceneName),
          purposes: refreshedCred.order.scope.allowedPurposes
        }
      };

      return summary;
    } catch {
      return null;
    }
  }

  async getCredential(credentialId: string): Promise<AuthCredential | undefined> {
    const cred = await this.storage.get(credentialId);
    return cred || undefined;
  }

  async getAllCredentials(): Promise<AuthCredential[]> {
    return this.storage.list();
  }

  private async refreshPeriodIfNeeded(credential: AuthCredential): Promise<AuthCredential> {
    if (credential.order.quota.periodType === 'ONCE') {
      return credential;
    }

    const now = Date.now();
    const newPeriodKey = getPeriodKey(credential.order.quota.periodType, now);

    if (isNewPeriod(credential.currentPeriod.periodKey, newPeriodKey)) {
      credential.periodHistory.push({ ...credential.currentPeriod });

      const periodRange = getPeriodRange(credential.order.quota.periodType, now);
      credential.currentPeriod = {
        periodKey: newPeriodKey,
        periodStart: periodRange.start,
        periodEnd: periodRange.end,
        usedCalls: 0,
        usedRows: 0,
        usedSizeKB: 0
      };

      if (credential.status === CredentialStatus.EXHAUSTED) {
        credential.status = CredentialStatus.ACTIVE;
      }

      await this.storage.set(credential.credentialId, credential);
    }

    return credential;
  }

  private checkCredentialStatus(credential: AuthCredential): {
    valid: boolean;
    errorCode?: ErrorCode;
    message?: string;
  } {
    if (credential.status === CredentialStatus.REVOKED) {
      return { valid: false, errorCode: ErrorCode.CREDENTIAL_REVOKED, message: getErrorMessage(ErrorCode.CREDENTIAL_REVOKED) };
    }

    const now = Date.now();
    if (now > credential.order.validity.endTime) {
      credential.status = CredentialStatus.EXPIRED;
      return { valid: false, errorCode: ErrorCode.CREDENTIAL_EXPIRED, message: getErrorMessage(ErrorCode.CREDENTIAL_EXPIRED) };
    }

    if (now < credential.order.validity.startTime) {
      return { valid: false, errorCode: ErrorCode.INVALID_DATE_RANGE, message: '授权凭证尚未生效' };
    }

    if (credential.status === CredentialStatus.EXHAUSTED && credential.order.quota.periodType === 'ONCE') {
      return { valid: false, errorCode: ErrorCode.CREDENTIAL_EXHAUSTED, message: getErrorMessage(ErrorCode.CREDENTIAL_EXHAUSTED) };
    }

    return { valid: true };
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

  private checkPeriodQuotaSufficiency(
    credential: AuthCredential,
    expectedRows?: number,
    expectedSizeKB?: number
  ): { sufficient: boolean; message?: string } {
    const maxCalls = credential.order.quota.maxCalls;
    const remainingCalls = maxCalls - credential.currentPeriod.usedCalls;
    if (remainingCalls <= 0) {
      return { sufficient: false, message: `当前周期调用次数已用尽 (已用 ${credential.currentPeriod.usedCalls}/${maxCalls})` };
    }

    if (expectedRows !== undefined && credential.order.quota.maxDataRows !== undefined) {
      const remainingRows = credential.order.quota.maxDataRows - credential.currentPeriod.usedRows;
      if (remainingRows < expectedRows) {
        return { sufficient: false, message: `当前周期数据行数额度不足，剩余 ${remainingRows} 行，需要 ${expectedRows} 行` };
      }
    }

    if (expectedSizeKB !== undefined && credential.order.quota.maxDataSizeKB !== undefined) {
      const remainingSize = credential.order.quota.maxDataSizeKB - credential.currentPeriod.usedSizeKB;
      if (remainingSize < expectedSizeKB) {
        return { sufficient: false, message: `当前周期数据量额度不足，剩余 ${remainingSize} KB，需要 ${expectedSizeKB} KB` };
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
      currentPeriod: credential.currentPeriod,
      order: {
        ...credential.order,
        validity: credential.order.validity
      }
    };
  }
}
