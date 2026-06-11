import {
  AuthPolicy,
  ErrorCode,
  PolicyMatchResult,
  PolicyRule,
  PolicyTargetType,
  SubjectIdentity,
  ValidationParams
} from '../types';

export class AuthPolicyManager {
  private policies: Map<string, AuthPolicy> = new Map();

  addPolicy(policy: AuthPolicy): void {
    this.policies.set(policy.policyId, policy);
  }

  removePolicy(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  getPolicy(policyId: string): AuthPolicy | undefined {
    return this.policies.get(policyId);
  }

  listPolicies(): AuthPolicy[] {
    return Array.from(this.policies.values()).sort((a, b) => a.priority - b.priority);
  }

  addRequiredFieldPolicy(
    targetType: PolicyTargetType,
    targetValue: string,
    requiredFields: string[],
    policyName?: string
  ): string {
    const policyId = `POLICY-RF-${targetType}-${targetValue}`;
    const rule: PolicyRule = {
      ruleId: `RULE-RF-${Date.now()}`,
      ruleType: 'REQUIRED_FIELD',
      ruleName: `必填字段策略 - ${targetType}:${targetValue}`,
      config: { fields: requiredFields },
      errorCode: ErrorCode.POLICY_REQUIRED_FIELD
    };

    this.addPolicy({
      policyId,
      policyName: policyName || `必填字段策略 - ${targetType}:${targetValue}`,
      targetType,
      targetValue,
      rules: [rule],
      enabled: true,
      priority: 10,
      createdAt: Date.now()
    });

    return policyId;
  }

  addSubjectTypePolicy(
    targetType: PolicyTargetType,
    targetValue: string,
    allowedTypes: Array<'ORGANIZATION' | 'INDIVIDUAL' | 'SYSTEM'>,
    deniedTypes?: Array<'ORGANIZATION' | 'INDIVIDUAL' | 'SYSTEM'>,
    policyName?: string
  ): string {
    const policyId = `POLICY-ST-${targetType}-${targetValue}`;
    const rule: PolicyRule = {
      ruleId: `RULE-ST-${Date.now()}`,
      ruleType: 'ALLOWED_SUBJECT_TYPE',
      ruleName: `主体类型策略 - ${targetType}:${targetValue}`,
      config: { allowedTypes, deniedTypes: deniedTypes || [] },
      errorCode: ErrorCode.POLICY_SUBJECT_TYPE
    };

    this.addPolicy({
      policyId,
      policyName: policyName || `主体类型策略 - ${targetType}:${targetValue}`,
      targetType,
      targetValue,
      rules: [rule],
      enabled: true,
      priority: 20,
      createdAt: Date.now()
    });

    return policyId;
  }

  addDataSizeLimitPolicy(
    targetType: PolicyTargetType,
    targetValue: string,
    maxSizeKB: number,
    minSizeKB?: number,
    policyName?: string
  ): string {
    const policyId = `POLICY-DS-${targetType}-${targetValue}`;
    const rule: PolicyRule = {
      ruleId: `RULE-DS-${Date.now()}`,
      ruleType: 'MAX_DATA_SIZE',
      ruleName: `数据量限制策略 - ${targetType}:${targetValue}`,
      config: { maxSizeKB, minSizeKB: minSizeKB || 0 },
      errorCode: ErrorCode.POLICY_DATA_SIZE_EXCEEDED
    };

    this.addPolicy({
      policyId,
      policyName: policyName || `数据量限制策略 - ${targetType}:${targetValue}`,
      targetType,
      targetValue,
      rules: [rule],
      enabled: true,
      priority: 30,
      createdAt: Date.now()
    });

    return policyId;
  }

  validate(
    params: ValidationParams,
    credential: { order: { provider: SubjectIdentity; consumer: SubjectIdentity } }
  ): PolicyMatchResult {
    const matchingPolicies = this.getMatchingPolicies(
      params.productId,
      params.sceneId,
      credential.order.provider.id,
      credential.order.consumer.id
    );

    for (const policy of matchingPolicies) {
      for (const rule of policy.rules) {
        const result = this.evaluateRule(rule, params, credential);
        if (!result.matched) {
          return {
            matched: false,
            hitRule: rule,
            policyId: policy.policyId,
            policyName: policy.policyName,
            missingFields: result.missingFields
          };
        }
      }
    }

    return { matched: true };
  }

  private getMatchingPolicies(
    productId: string,
    sceneId: string,
    providerId: string,
    consumerId: string
  ): AuthPolicy[] {
    const matches: AuthPolicy[] = [];

    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;

      let targetMatch = false;
      switch (policy.targetType) {
        case 'GLOBAL':
          targetMatch = true;
          break;
        case 'PRODUCT':
          targetMatch = policy.targetValue === productId || policy.targetValue === '*';
          break;
        case 'SCENE':
          targetMatch = policy.targetValue === sceneId || policy.targetValue === '*';
          break;
        case 'PROVIDER':
          targetMatch = policy.targetValue === providerId || policy.targetValue === '*';
          break;
        case 'CONSUMER':
          targetMatch = policy.targetValue === consumerId || policy.targetValue === '*';
          break;
      }

      if (targetMatch) {
        matches.push(policy);
      }
    }

    return matches.sort((a, b) => a.priority - b.priority);
  }

  private evaluateRule(
    rule: PolicyRule,
    params: ValidationParams,
    credential: { order: { provider: SubjectIdentity; consumer: SubjectIdentity } }
  ): PolicyMatchResult {
    switch (rule.ruleType) {
      case 'REQUIRED_FIELD': {
        const requiredFields = rule.config.fields as string[];
        const missing: string[] = [];

        for (const field of requiredFields) {
          switch (field) {
            case 'purpose':
              if (!params.purpose) missing.push('purpose');
              break;
            case 'expectedDataRows':
              if (params.expectedDataRows === undefined) missing.push('expectedDataRows');
              break;
            case 'expectedDataSizeKB':
              if (params.expectedDataSizeKB === undefined) missing.push('expectedDataSizeKB');
              break;
          }
        }

        return missing.length > 0
          ? { matched: false, missingFields: missing }
          : { matched: true };
      }

      case 'ALLOWED_SUBJECT_TYPE': {
        const allowedTypes = rule.config.allowedTypes as Array<'ORGANIZATION' | 'INDIVIDUAL' | 'SYSTEM'>;
        const deniedTypes = rule.config.deniedTypes as Array<'ORGANIZATION' | 'INDIVIDUAL' | 'SYSTEM'>;
        const subjectType = params.callerIdentity.type;

        if (deniedTypes && deniedTypes.includes(subjectType)) {
          return { matched: false };
        }

        if (allowedTypes && allowedTypes.length > 0 && !allowedTypes.includes(subjectType)) {
          return { matched: false };
        }

        return { matched: true };
      }

      case 'DENIED_SUBJECT_TYPE': {
        const deniedTypes = rule.config.deniedTypes as Array<'ORGANIZATION' | 'INDIVIDUAL' | 'SYSTEM'>;
        const subjectType = params.callerIdentity.type;

        if (deniedTypes.includes(subjectType)) {
          return { matched: false };
        }

        return { matched: true };
      }

      case 'MAX_DATA_SIZE': {
        const maxSizeKB = rule.config.maxSizeKB as number;
        if (params.expectedDataSizeKB !== undefined && params.expectedDataSizeKB > maxSizeKB) {
          return { matched: false };
        }
        return { matched: true };
      }

      case 'MIN_DATA_SIZE': {
        const minSizeKB = rule.config.minSizeKB as number;
        if (params.expectedDataSizeKB !== undefined && params.expectedDataSizeKB < minSizeKB) {
          return { matched: false };
        }
        return { matched: true };
      }

      case 'CUSTOM':
        return { matched: true };

      default:
        return { matched: true };
    }
  }
}
