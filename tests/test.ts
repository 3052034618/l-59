import { DataAuthCredentialSDK, CredentialStatus, ValidationResultType, ErrorCode } from '../src';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ 测试失败: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ 测试通过: ${message}`);
  }
}

console.log('\n========== 数据要素授权凭证 SDK 本地测试 ==========\n');

const sdk = new DataAuthCredentialSDK();

console.log('--- 测试1: 生成凭证编号 ---');
const credNo1 = sdk.generateCredentialNo();
const credNo2 = sdk.generateCredentialNo();
assert(credNo1.startsWith('DAC-'), '凭证编号前缀正确');
assert(credNo1 !== credNo2, '生成的凭证编号唯一');
console.log(`生成的凭证编号: ${credNo1}`);

console.log('\n--- 测试2: 创建授权单 ---');
const provider = {
  id: 'PROV-001',
  name: '数据提供方有限公司',
  type: 'ORGANIZATION' as const
};

const consumer = {
  id: 'CONS-001',
  name: '数据使用方科技公司',
  type: 'ORGANIZATION' as const
};

const products = [
  {
    productId: 'PROD-001',
    productName: '企业征信数据产品',
    dataCategory: '信用数据',
    providerId: 'PROV-001'
  }
];

const scenes = [
  {
    sceneId: 'SCENE-001',
    sceneName: '风控评估',
    sceneDescription: '用于企业信贷风控评估场景',
    sceneType: 'RISK_CONTROL'
  }
];

const scope = {
  products,
  scenes,
  allowedPurposes: ['风控评估', '信用分析', '风险建模']
};

const quota = {
  maxCalls: 100,
  maxDataRows: 10000,
  maxDataSizeKB: 50000,
  periodType: 'MONTHLY' as const
};

const now = Date.now();
const validity = {
  startTime: now,
  endTime: now + 30 * 24 * 60 * 60 * 1000
};

const createResult = sdk.createAuthorization({
  provider,
  consumer,
  scope,
  quota,
  validity,
  purpose: '企业信贷风控评估',
  createdBy: 'admin'
});

assert(createResult.success === true, '创建授权单成功');
assert(createResult.order !== undefined, '返回授权单');
assert(createResult.credential !== undefined, '返回凭证');
assert(createResult.credential!.status === CredentialStatus.ACTIVE, '凭证状态为激活');
assert(createResult.credential!.totalUsedCalls === 0, '初始使用次数为0');
console.log(`凭证ID: ${createResult.credential!.credentialId}`);
console.log(`凭证编号: ${createResult.credential!.credentialNo}`);
console.log(`授权单ID: ${createResult.order!.orderId}`);

const credentialId = createResult.credential!.credentialId;

console.log('\n--- 测试3: 校验凭证 - 缺少purpose (返回PENDING) ---');
const pendingResult = sdk.validate({
  credentialId,
  productId: 'PROD-001',
  sceneId: 'SCENE-001',
  callerIdentity: consumer
});
assert(pendingResult.type === ValidationResultType.PENDING, '返回PENDING结果');
assert(pendingResult.passed === false, '校验未通过');
assert(!!(pendingResult.missingFields && pendingResult.missingFields.includes('purpose')), '提示缺少purpose字段');
console.log(`缺失字段: ${pendingResult.missingFields}`);

console.log('\n--- 测试4: 校验凭证 - 校验通过 ---');
const passResult = sdk.validate({
  credentialId,
  productId: 'PROD-001',
  sceneId: 'SCENE-001',
  callerIdentity: consumer,
  purpose: '风控评估'
});
assert(passResult.type === ValidationResultType.PASS, '返回PASS结果');
assert(passResult.passed === true, '校验通过');
assert(passResult.auditSummary !== undefined, '返回审计摘要');
console.log(`校验结果: ${passResult.message}`);

console.log('\n--- 测试5: 校验凭证 - 产品不匹配 ---');
const productFailResult = sdk.validate({
  credentialId,
  productId: 'PROD-INVALID',
  sceneId: 'SCENE-001',
  callerIdentity: consumer,
  purpose: '风控评估'
});
assert(productFailResult.type === ValidationResultType.REJECT, '返回REJECT结果');
assert(productFailResult.code === ErrorCode.INVALID_PRODUCT, '错误码为INVALID_PRODUCT');
console.log(`拒绝原因: ${productFailResult.message}`);

console.log('\n--- 测试6: 校验凭证 - 场景不匹配 ---');
const sceneFailResult = sdk.validate({
  credentialId,
  productId: 'PROD-001',
  sceneId: 'SCENE-INVALID',
  callerIdentity: consumer,
  purpose: '风控评估'
});
assert(sceneFailResult.type === ValidationResultType.REJECT, '返回REJECT结果');
assert(sceneFailResult.code === ErrorCode.INVALID_SCENE, '错误码为INVALID_SCENE');
console.log(`拒绝原因: ${sceneFailResult.message}`);

console.log('\n--- 测试7: 校验凭证 - 身份不匹配 ---');
const wrongUser = {
  id: 'CONS-INVALID',
  name: '非法用户',
  type: 'ORGANIZATION' as const
};
const identityFailResult = sdk.validate({
  credentialId,
  productId: 'PROD-001',
  sceneId: 'SCENE-001',
  callerIdentity: wrongUser,
  purpose: '风控评估'
});
assert(identityFailResult.type === ValidationResultType.REJECT, '返回REJECT结果');
assert(identityFailResult.code === ErrorCode.IDENTITY_MISMATCH, '错误码为IDENTITY_MISMATCH');
console.log(`拒绝原因: ${identityFailResult.message}`);

console.log('\n--- 测试8: 记录使用日志 ---');
const usageResult = sdk.recordUsage(
  credentialId,
  '风控评估',
  consumer,
  1,
  100,
  500,
  '首次调用测试'
);
assert(usageResult.success === true, '记录使用日志成功');
assert(usageResult.logEntry !== undefined, '返回日志条目');
assert(usageResult.updatedCredential!.totalUsedCalls === 1, '使用次数更新为1');
console.log(`日志ID: ${usageResult.logEntry!.logId}`);
console.log(`已使用次数: ${usageResult.updatedCredential!.totalUsedCalls}`);

console.log('\n--- 测试9: 追加使用日志 ---');
const appendResult = sdk.appendUsageLog(credentialId, {
  purpose: '信用分析',
  callCount: 2,
  dataRows: 200,
  dataSizeKB: 1000,
  callerIdentity: consumer.id,
  remark: '批量追加日志'
});
assert(appendResult.success === true, '追加使用日志成功');
const credential = sdk.getCredential(credentialId);
assert(credential!.totalUsedCalls === 3, '使用次数更新为3');
assert(credential!.usageLogs.length === 2, '日志数量为2');
console.log(`日志总数: ${credential!.usageLogs.length}`);
console.log(`已使用次数: ${credential!.totalUsedCalls}`);

console.log('\n--- 测试10: 记录调用目的 ---');
const purposeResult = sdk.recordPurpose(
  credentialId,
  '风险建模',
  consumer,
  5
);
assert(purposeResult.success === true, '记录调用目的成功');
const updatedCred = sdk.getCredential(credentialId);
assert(updatedCred!.totalUsedCalls === 8, '使用次数更新为8');
console.log(`已使用次数: ${updatedCred!.totalUsedCalls}`);

console.log('\n--- 测试11: 查询剩余额度 ---');
const quotaResult = sdk.getRemainingQuota(credentialId);
assert(quotaResult.success === true, '查询剩余额度成功');
assert(quotaResult.quota!.remainingCalls === 92, '剩余调用次数为92');
assert(quotaResult.quota!.remainingRows === 9700, '剩余数据行数为9700');
assert(quotaResult.quota!.remainingSizeKB === 48500, '剩余数据量为48500KB');
console.log(`剩余调用次数: ${quotaResult.quota!.remainingCalls}/${quotaResult.quota!.maxCalls}`);
console.log(`使用率: ${quotaResult.quota!.usageRate}%`);

console.log('\n--- 测试12: 检查有效期限 ---');
const validityResult = sdk.checkValidity(credentialId);
assert(validityResult.success === true, '检查有效期限成功');
assert(validityResult.validity!.isValid === true, '凭证有效');
assert(validityResult.validity!.isExpired === false, '凭证未过期');
assert(validityResult.validity!.isNotYetEffective === false, '凭证已生效');
assert(validityResult.validity!.remainingDays === 30, '剩余30天');
console.log(`有效期: ${validityResult.validity!.startTime} 至 ${validityResult.validity!.endTime}`);
console.log(`剩余天数: ${validityResult.validity!.remainingDays}`);

console.log('\n--- 测试13: 比对主体身份 ---');
const verifyConsumer = sdk.verifyIdentity(credentialId, consumer);
assert(verifyConsumer.success === true, '比对使用方身份成功');
assert(verifyConsumer.verification!.isConsumer === true, '确认为使用方');
assert(verifyConsumer.verification!.isProvider === false, '不是提供方');
assert(verifyConsumer.verification!.matchedRole === 'CONSUMER', '匹配角色为使用方');
console.log(`使用方身份验证结果: ${verifyConsumer.verification!.matchedRole}`);

const verifyProvider = sdk.verifyIdentity(credentialId, provider);
assert(verifyProvider.success === true, '比对提供方身份成功');
assert(verifyProvider.verification!.isProvider === true, '确认为提供方');
assert(verifyProvider.verification!.matchedRole === 'PROVIDER', '匹配角色为提供方');
console.log(`提供方身份验证结果: ${verifyProvider.verification!.matchedRole}`);

const wrongIdentity = { id: 'INVALID', name: '测试', type: 'ORGANIZATION' as const };
const verifyWrong = sdk.verifyIdentity(credentialId, wrongIdentity);
assert(verifyWrong.verification!.matchedRole === 'NONE', '不匹配任何角色');
console.log(`非法身份验证结果: ${verifyWrong.verification!.matchedRole}`);

console.log('\n--- 测试14: 直接比对身份 ---');
assert(sdk.compareIdentity(consumer, consumer) === true, '同一身份比对成功');
assert(sdk.compareIdentity(consumer, provider) === false, '不同身份比对失败');
console.log('身份比对工具函数正常');

console.log('\n--- 测试15: 校验使用范围 ---');
const scopeResult = sdk.checkUsageScope(credentialId, 'PROD-001', 'SCENE-001');
assert(scopeResult.valid === true, '使用范围校验通过');
const scopeResultFail = sdk.checkUsageScope(credentialId, 'PROD-001', 'SCENE-INVALID');
assert(scopeResultFail.valid === false, '使用范围校验失败');
console.log(`有效范围校验: ${scopeResult.message}`);
console.log(`无效范围校验: ${scopeResultFail.message}`);

console.log('\n--- 测试16: 输出审计摘要 ---');
const auditSummary = sdk.getAuditSummary(credentialId);
assert(auditSummary !== null, '获取审计摘要成功');
assert(auditSummary!.credentialId === credentialId, '审计摘要凭证ID正确');
assert(auditSummary!.status === CredentialStatus.ACTIVE, '状态正确');
assert(auditSummary!.quota.usedCalls === 8, '已使用次数正确');
assert(auditSummary!.totalUsageLogs === 3, '日志数量正确');
assert(auditSummary!.scopeSummary.products.length > 0, '包含产品信息');
assert(auditSummary!.scopeSummary.scenes.length > 0, '包含场景信息');
console.log('审计摘要内容:');
console.log(JSON.stringify(auditSummary, null, 2));

console.log('\n--- 测试17: 格式化错误信息 ---');
const formattedError = sdk.formatError(ErrorCode.INVALID_PRODUCT);
assert(formattedError.code === ErrorCode.INVALID_PRODUCT, '错误码正确');
assert(formattedError.message.length > 0, '错误消息非空');
console.log('格式化错误:');
console.log(JSON.stringify(formattedError, null, 2));

const customError = sdk.formatError(ErrorCode.CREDENTIAL_EXPIRED, '自定义过期消息', { expireDate: '2024-01-01' });
assert(customError.message === '自定义过期消息', '自定义错误消息生效');
assert(customError.details!.expireDate === '2024-01-01', '错误详情包含额外信息');

console.log('\n--- 测试18: 校验额度不足 ---');
for (let i = 0; i < 91; i++) {
  sdk.recordUsage(credentialId, '批量测试', consumer, 1);
}
const quotaCheck = sdk.getRemainingQuota(credentialId);
console.log(`当前已使用: ${100 - quotaCheck.quota!.remainingCalls}/${quotaCheck.quota!.maxCalls}`);

const quotaFailResult = sdk.validate({
  credentialId,
  productId: 'PROD-001',
  sceneId: 'SCENE-001',
  callerIdentity: consumer,
  purpose: '风控评估',
  expectedDataRows: 20000,
  expectedDataSizeKB: 100000
});
assert(quotaFailResult.type === ValidationResultType.REJECT, '额度不足被拒绝');
assert(
  quotaFailResult.code === ErrorCode.QUOTA_INSUFFICIENT,
  `错误码为QUOTA_INSUFFICIENT (实际: ${quotaFailResult.code})`
);
console.log(`额度不足拒绝原因: ${quotaFailResult.message}`);

console.log('\n--- 测试19: 撤销凭证 ---');
const revokeResult = sdk.revokeCredential(credentialId, 'admin', '业务终止');
assert(revokeResult.success === true, '撤销凭证成功');
assert(revokeResult.updatedCredential!.status === CredentialStatus.REVOKED, '凭证状态变为已撤销');
assert(revokeResult.updatedCredential!.revokedBy === 'admin', '撤销人正确');
assert(revokeResult.updatedCredential!.revokeReason === '业务终止', '撤销原因正确');
console.log(`撤销时间戳: ${revokeResult.updatedCredential!.revokedAt}`);
console.log(`撤销原因: ${revokeResult.updatedCredential!.revokeReason}`);

console.log('\n--- 测试20: 校验已撤销凭证 ---');
const revokedResult = sdk.validate({
  credentialId,
  productId: 'PROD-001',
  sceneId: 'SCENE-001',
  callerIdentity: consumer,
  purpose: '风控评估'
});
assert(revokedResult.type === ValidationResultType.REJECT, '已撤销凭证被拒绝');
assert(revokedResult.code === ErrorCode.CREDENTIAL_REVOKED, '错误码为CREDENTIAL_REVOKED');
console.log(`已撤销凭证校验结果: ${revokedResult.message}`);

console.log('\n--- 测试21: 查询不存在的凭证 ---');
const notFoundResult = sdk.validate({
  credentialId: 'INVALID-CRED-ID',
  productId: 'PROD-001',
  sceneId: 'SCENE-001',
  callerIdentity: consumer,
  purpose: '风控评估'
});
assert(notFoundResult.type === ValidationResultType.REJECT, '不存在凭证被拒绝');
assert(notFoundResult.code === ErrorCode.CREDENTIAL_NOT_FOUND, '错误码为CREDENTIAL_NOT_FOUND');
console.log(`不存在凭证校验结果: ${notFoundResult.message}`);

console.log('\n--- 测试22: 获取全部凭证 ---');
const allCreds = sdk.getAllCredentials();
assert(allCreds.length === 1, '凭证列表包含1个凭证');
console.log(`凭证总数: ${allCreds.length}`);

console.log('\n--- 测试23: 创建授权单 - 无效参数 ---');
const invalidCreateResult = sdk.createAuthorization({
  provider,
  consumer,
  scope,
  quota: { maxCalls: -1, periodType: 'MONTHLY' },
  validity,
  purpose: '测试',
  createdBy: 'admin'
});
assert(invalidCreateResult.success === false, '无效参数创建失败');
assert(invalidCreateResult.error!.code === ErrorCode.INVALID_QUOTA, '错误码为INVALID_QUOTA');
console.log(`无效参数拒绝原因: ${invalidCreateResult.error!.message}`);

console.log('\n--- 测试24: 创建授权单 - 无效日期 ---');
const invalidDateResult = sdk.createAuthorization({
  provider,
  consumer,
  scope,
  quota,
  validity: { startTime: now + 100000, endTime: now },
  purpose: '测试',
  createdBy: 'admin'
});
assert(invalidDateResult.success === false, '无效日期创建失败');
assert(invalidDateResult.error!.code === ErrorCode.INVALID_DATE_RANGE, '错误码为INVALID_DATE_RANGE');
console.log(`无效日期拒绝原因: ${invalidDateResult.error!.message}`);

console.log('\n========== 全部测试通过 ==========\n');
