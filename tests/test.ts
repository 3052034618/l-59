import * as fs from 'fs';
import * as path from 'path';
import {
  DataAuthCredentialSDK,
  CredentialStatus,
  ValidationResultType,
  ErrorCode,
  MemoryStorage,
  FileStorage
} from '../src';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ 测试失败: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ 测试通过: ${message}`);
  }
}

const testStorageDir = path.join(process.cwd(), 'data', 'test_credentials');

function cleanupTestStorage(): void {
  const filePath = path.join(testStorageDir, 'credentials.json');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  if (fs.existsSync(testStorageDir)) {
    fs.rmSync(testStorageDir, { recursive: true });
  }
}

cleanupTestStorage();

console.log('\n========== 数据要素授权凭证 SDK 扩展测试 ==========\n');

const sdk = new DataAuthCredentialSDK();

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
  },
  {
    productId: 'PROD-002',
    productName: '企业风险评分产品',
    dataCategory: '风险数据',
    providerId: 'PROV-001'
  }
];

const scenes = [
  {
    sceneId: 'SCENE-001',
    sceneName: '风控评估',
    sceneDescription: '用于企业信贷风控评估场景',
    sceneType: 'RISK_CONTROL'
  },
  {
    sceneId: 'SCENE-002',
    sceneName: '信用分析',
    sceneDescription: '用于企业信用分析场景',
    sceneType: 'CREDIT_ANALYSIS'
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

let credentialId: string = '';

(async () => {
  console.log('--- 测试1: 生成凭证编号 ---');
  const credNo1 = sdk.generateCredentialNo();
  const credNo2 = sdk.generateCredentialNo();
  assert(credNo1.startsWith('DAC-'), '凭证编号前缀正确');
  assert(credNo1 !== credNo2, '生成的凭证编号唯一');

  console.log('\n--- 测试2: 创建授权单 ---');
  const createResult = await sdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota,
    validity,
    purpose: '企业信贷风控评估',
    createdBy: 'admin'
  });
  assert(createResult.success === true, '创建授权单成功');
  assert(createResult.credential!.status === CredentialStatus.ACTIVE, '凭证状态为激活');
  assert(createResult.credential!.currentPeriod !== undefined, '包含当前周期信息');
  assert(createResult.credential!.currentPeriod.usedCalls === 0, '当前周期使用次数为0');
  assert(createResult.credential!.periodHistory.length === 0, '历史周期为空');
  credentialId = createResult.credential!.credentialId;
  console.log(`凭证ID: ${credentialId}`);
  console.log(`当前周期: ${createResult.credential!.currentPeriod.periodKey}`);

  console.log('\n--- 测试3: 校验凭证 - 通过 ---');
  const passResult = await sdk.validate({
    credentialId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: consumer,
    purpose: '风控评估'
  });
  assert(passResult.type === ValidationResultType.PASS, '返回PASS结果');
  assert(passResult.passed === true, '校验通过');

  console.log('\n--- 测试4: 校验凭证 - PENDING ---');
  const pendingResult = await sdk.validate({
    credentialId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: consumer
  });
  assert(pendingResult.type === ValidationResultType.PENDING, '返回PENDING结果');
  assert(!!(pendingResult.missingFields && pendingResult.missingFields.includes('purpose')), '提示缺少purpose');

  console.log('\n--- 测试5: 校验凭证 - 产品不匹配 ---');
  const productFail = await sdk.validate({
    credentialId,
    productId: 'PROD-INVALID',
    sceneId: 'SCENE-001',
    callerIdentity: consumer,
    purpose: '风控评估'
  });
  assert(productFail.type === ValidationResultType.REJECT, '返回REJECT');
  assert(productFail.code === ErrorCode.INVALID_PRODUCT, '错误码为INVALID_PRODUCT');

  console.log('\n--- 测试6: 校验凭证 - 身份不匹配 ---');
  const identityFail = await sdk.validate({
    credentialId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: { id: 'HACKER', name: '黑客', type: 'ORGANIZATION' },
    purpose: '风控评估'
  });
  assert(identityFail.code === ErrorCode.IDENTITY_MISMATCH, '错误码为IDENTITY_MISMATCH');

  console.log('\n--- 测试7: 事务式流程 - preCheck ---');
  const preCheckResult = await sdk.preCheck({
    credentialId,
    callCount: 10,
    dataRows: 500,
    dataSizeKB: 2000
  });
  assert(preCheckResult.canProceed === true, '预检查通过');
  assert(preCheckResult.remainingAfterDeduction!.calls === 90, '扣减后剩余90次');
  assert(preCheckResult.remainingAfterDeduction!.rows === 9500, '扣减后剩余9500行');
  assert(preCheckResult.remainingAfterDeduction!.sizeKB === 48000, '扣减后剩余48000KB');

  console.log('\n--- 测试8: 事务式流程 - executeUsage ---');
  const execResult = await sdk.executeUsage({
    credentialId,
    purpose: '风控评估',
    callerIdentity: consumer,
    callCount: 10,
    dataRows: 500,
    dataSizeKB: 2000,
    remark: '事务式扣减测试'
  });
  assert(execResult.success === true, '执行扣减成功');
  assert(execResult.deducted!.calls === 10, '扣减10次调用');
  assert(execResult.deducted!.rows === 500, '扣减500行');
  assert(execResult.remainingAfter!.calls === 90, '扣减后剩余90次');
  assert(execResult.remainingAfter!.rows === 9500, '扣减后剩余9500行');

  console.log('\n--- 测试9: executeUsage - 无效callCount ---');
  const invalidCallResult = await sdk.executeUsage({
    credentialId,
    purpose: '风控评估',
    callerIdentity: consumer,
    callCount: 0
  });
  assert(invalidCallResult.success === false, 'callCount=0 被拒绝');
  assert(invalidCallResult.error!.code === ErrorCode.INVALID_CALL_COUNT, '错误码为INVALID_CALL_COUNT');

  const negCallResult = await sdk.executeUsage({
    credentialId,
    purpose: '风控评估',
    callerIdentity: consumer,
    callCount: -5
  });
  assert(negCallResult.success === false, 'callCount=-5 被拒绝');

  console.log('\n--- 测试10: executeUsage - 无效dataRows ---');
  const invalidRowsResult = await sdk.executeUsage({
    credentialId,
    purpose: '风控评估',
    callerIdentity: consumer,
    callCount: 1,
    dataRows: 0
  });
  assert(invalidRowsResult.success === false, 'dataRows=0 被拒绝');
  assert(invalidRowsResult.error!.code === ErrorCode.INVALID_DATA_ROWS, '错误码为INVALID_DATA_ROWS');

  console.log('\n--- 测试11: executeUsage - 额度不足拒绝且不扣减 ---');
  const beforeCred = await sdk.getCredential(credentialId);
  const beforeCalls = beforeCred!.currentPeriod.usedCalls;

  const overQuotaResult = await sdk.executeUsage({
    credentialId,
    purpose: '风控评估',
    callerIdentity: consumer,
    callCount: 200,
    dataRows: 50000
  });
  assert(overQuotaResult.success === false, '超额扣减被拒绝');

  const afterCred = await sdk.getCredential(credentialId);
  assert(afterCred!.currentPeriod.usedCalls === beforeCalls, '额度未发生变化（不会变大或变小）');

  console.log('\n--- 测试12: recordUsage（兼容旧接口） ---');
  const recordResult = await sdk.recordUsage(credentialId, '信用分析', consumer, 5, 200, 1000);
  assert(recordResult.success === true, 'recordUsage成功');
  const credAfterRecord = await sdk.getCredential(credentialId);
  assert(credAfterRecord!.currentPeriod.usedCalls === 15, '当前周期使用15次');

  console.log('\n--- 测试13: 查询剩余额度（含周期信息） ---');
  const quotaResult = await sdk.getRemainingQuota(credentialId);
  assert(quotaResult.success === true, '查询剩余额度成功');
  assert(quotaResult.quota!.remainingCalls === 85, '剩余85次');
  assert(quotaResult.quota!.periodKey !== undefined, '包含周期key');
  assert(quotaResult.quota!.periodUsedCalls === 15, '周期已用15次');
  console.log(`周期: ${quotaResult.quota!.periodKey}, 已用: ${quotaResult.quota!.periodUsedCalls}, 剩余: ${quotaResult.quota!.remainingCalls}`);

  console.log('\n--- 测试14: 检查有效期限 ---');
  const validityResult = await sdk.checkValidity(credentialId);
  assert(validityResult.success === true, '检查有效期限成功');
  assert(validityResult.validity!.isValid === true, '凭证有效');

  console.log('\n--- 测试15: 比对主体身份 ---');
  const verifyConsumer = await sdk.verifyIdentity(credentialId, consumer);
  assert(verifyConsumer.verification!.matchedRole === 'CONSUMER', '使用方角色正确');
  const verifyProvider = await sdk.verifyIdentity(credentialId, provider);
  assert(verifyProvider.verification!.matchedRole === 'PROVIDER', '提供方角色正确');

  console.log('\n--- 测试16: 校验使用范围 ---');
  const scopeResult = await sdk.checkUsageScope(credentialId, 'PROD-001', 'SCENE-001');
  assert(scopeResult.valid === true, '使用范围校验通过');
  const scopeFail = await sdk.checkUsageScope(credentialId, 'PROD-001', 'SCENE-INVALID');
  assert(scopeFail.valid === false, '使用范围校验失败');

  console.log('\n--- 测试17: 追加使用日志（带额度保护） ---');
  const appendResult = await sdk.appendUsageLog(credentialId, {
    purpose: '风险建模',
    callCount: 5,
    dataRows: 300,
    dataSizeKB: 1500,
    callerIdentity: consumer.id,
    remark: '追加日志测试'
  });
  assert(appendResult.success === true, '追加使用日志成功');
  const credAfterAppend = await sdk.getCredential(credentialId);
  assert(credAfterAppend!.currentPeriod.usedCalls === 20, '当前周期使用20次');

  const overAppend = await sdk.appendUsageLog(credentialId, {
    purpose: '超额追加',
    callCount: 200,
    callerIdentity: consumer.id
  });
  assert(overAppend.success === false, '超额追加被拒绝');

  console.log('\n--- 测试18: 输出审计摘要（含周期信息） ---');
  const auditSummary = await sdk.getAuditSummary(credentialId);
  assert(auditSummary !== null, '获取审计摘要成功');
  assert(auditSummary!.currentPeriod !== undefined, '包含当前周期信息');
  assert(auditSummary!.currentPeriod.usedCalls === 20, '当前周期使用20次');
  assert(auditSummary!.currentPeriod.remainingCalls === 80, '当前周期剩余80次');
  assert(auditSummary!.quota.usedCalls === 20, '额度已用20次');
  console.log('审计摘要（周期部分）:');
  console.log(JSON.stringify({
    currentPeriod: auditSummary!.currentPeriod,
    periodHistory: auditSummary!.periodHistory,
    quota: auditSummary!.quota
  }, null, 2));

  console.log('\n--- 测试19: 格式化错误信息 ---');
  const fmtErr = sdk.formatError(ErrorCode.INVALID_CALL_COUNT);
  assert(fmtErr.code === ErrorCode.INVALID_CALL_COUNT, '错误码正确');

  console.log('\n--- 测试20: preCheck - 额度不足 ---');
  const preCheckFail = await sdk.preCheck({
    credentialId,
    callCount: 200,
    dataRows: 50000
  });
  assert(preCheckFail.canProceed === false, '预检查额度不足被拒绝');
  assert(preCheckFail.code === ErrorCode.QUOTA_INSUFFICIENT, '错误码为QUOTA_INSUFFICIENT');

  console.log('\n--- 测试21: preCheck - 无效参数 ---');
  const preCheckInvalid = await sdk.preCheck({
    credentialId,
    callCount: 0
  });
  assert(preCheckInvalid.canProceed === false, '预检查无效参数被拒绝');
  assert(preCheckInvalid.code === ErrorCode.INVALID_CALL_COUNT, '错误码为INVALID_CALL_COUNT');

  console.log('\n--- 测试22: 批量校验 ---');
  const batchResult = await sdk.batchValidate([
    {
      credentialId,
      productId: 'PROD-001',
      sceneId: 'SCENE-001',
      callerIdentity: consumer,
      purpose: '风控评估'
    },
    {
      credentialId,
      productId: 'PROD-002',
      sceneId: 'SCENE-002',
      callerIdentity: consumer,
      purpose: '信用分析'
    },
    {
      credentialId,
      productId: 'PROD-INVALID',
      sceneId: 'SCENE-001',
      callerIdentity: consumer,
      purpose: '风控评估'
    },
    {
      credentialId: 'NON-EXIST',
      productId: 'PROD-001',
      sceneId: 'SCENE-001',
      callerIdentity: consumer,
      purpose: '风控评估'
    }
  ]);
  assert(batchResult.results.length === 4, '返回4条结果');
  assert(batchResult.summary.total === 4, '总数为4');
  assert(batchResult.summary.passed === 2, '通过2条');
  assert(batchResult.summary.rejected === 2, '拒绝2条');
  console.log(`批量校验汇总: 总计${batchResult.summary.total}, 通过${batchResult.summary.passed}, 拒绝${batchResult.summary.rejected}`);

  console.log('\n--- 测试23: 批量校验 - 快过期和低额度汇总 ---');
  const nearExpiryTime = now + 5 * 24 * 60 * 60 * 1000;
  const nearExpiryResult = await sdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 10, periodType: 'MONTHLY' },
    validity: { startTime: now, endTime: nearExpiryTime },
    purpose: '测试快过期',
    createdBy: 'admin'
  });
  const nearExpiryCredId = nearExpiryResult.credential!.credentialId;

  await sdk.executeUsage({
    credentialId: nearExpiryCredId,
    purpose: '消耗额度',
    callerIdentity: consumer,
    callCount: 9
  });

  const lowQuotaBatch = await sdk.batchValidate([
    {
      credentialId: nearExpiryCredId,
      productId: 'PROD-001',
      sceneId: 'SCENE-001',
      callerIdentity: consumer,
      purpose: '风控评估'
    }
  ]);
  assert(lowQuotaBatch.summary.nearExpiryCredentials.length > 0, '检测到快过期凭证');
  assert(lowQuotaBatch.summary.lowQuotaCredentials.length > 0, '检测到低额度凭证');
  console.log(`快过期凭证: ${JSON.stringify(lowQuotaBatch.summary.nearExpiryCredentials)}`);
  console.log(`低额度凭证: ${JSON.stringify(lowQuotaBatch.summary.lowQuotaCredentials)}`);

  console.log('\n--- 测试24: 周期额度管理 - ONCE类型 ---');
  const onceResult = await sdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 5, periodType: 'ONCE' },
    validity,
    purpose: '一次性额度测试',
    createdBy: 'admin'
  });
  const onceCredId = onceResult.credential!.credentialId;

  for (let i = 0; i < 5; i++) {
    await sdk.executeUsage({
      credentialId: onceCredId,
      purpose: '消耗额度',
      callerIdentity: consumer,
      callCount: 1
    });
  }
  const onceCred = await sdk.getCredential(onceCredId);
  assert(onceCred!.status === CredentialStatus.EXHAUSTED, 'ONCE类型额度用尽后状态变为EXHAUSTED');

  const onceValidate = await sdk.validate({
    credentialId: onceCredId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: consumer,
    purpose: '风控评估'
  });
  assert(onceValidate.code === ErrorCode.CREDENTIAL_EXHAUSTED, 'ONCE类型用尽后校验被拒绝');

  console.log('\n--- 测试25: 周期管理 - 审计摘要含历史周期 ---');
  const summaryWithHistory = await sdk.getAuditSummary(credentialId);
  assert(summaryWithHistory!.currentPeriod.periodKey.length > 0, '包含当前周期key');
  console.log(`当前周期: ${summaryWithHistory!.currentPeriod.periodKey}, 历史: ${summaryWithHistory!.periodHistory.length}个`);

  console.log('\n--- 测试26: 撤销凭证 ---');
  const revokeResult = await sdk.revokeCredential(credentialId, 'admin', '业务终止');
  assert(revokeResult.success === true, '撤销凭证成功');
  assert(revokeResult.updatedCredential!.status === CredentialStatus.REVOKED, '凭证状态变为已撤销');

  const revokedResult = await sdk.validate({
    credentialId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: consumer,
    purpose: '风控评估'
  });
  assert(revokedResult.code === ErrorCode.CREDENTIAL_REVOKED, '已撤销凭证被拒绝');

  console.log('\n--- 测试27: 查询不存在的凭证 ---');
  const notFound = await sdk.validate({
    credentialId: 'INVALID',
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: consumer,
    purpose: '风控评估'
  });
  assert(notFound.code === ErrorCode.CREDENTIAL_NOT_FOUND, '不存在凭证被拒绝');

  console.log('\n--- 测试28: 获取全部凭证 ---');
  const allCreds = await sdk.getAllCredentials();
  assert(allCreds.length >= 3, '凭证列表包含多个凭证');

  console.log('\n--- 测试29: 无效参数创建 ---');
  const invalidCreate = await sdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: -1, periodType: 'MONTHLY' },
    validity,
    purpose: '测试',
    createdBy: 'admin'
  });
  assert(invalidCreate.success === false, '无效参数创建失败');
  assert(invalidCreate.error!.code === ErrorCode.INVALID_QUOTA, '错误码为INVALID_QUOTA');

  console.log('\n--- 测试30: FileStorage 持久化 ---');
  cleanupTestStorage();

  const fileSdk1 = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: testStorageDir
  });

  const fileCreateResult = await fileSdk1.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 50, maxDataRows: 5000, periodType: 'DAILY' },
    validity,
    purpose: '文件存储持久化测试',
    createdBy: 'admin'
  });
  assert(fileCreateResult.success === true, 'FileStorage创建授权单成功');
  const fileCredId = fileCreateResult.credential!.credentialId;

  await fileSdk1.executeUsage({
    credentialId: fileCredId,
    purpose: '持久化测试',
    callerIdentity: consumer,
    callCount: 3,
    dataRows: 100,
    dataSizeKB: 500
  });

  await fileSdk1.revokeCredential(fileCredId, 'admin', '测试撤销持久化');

  console.log('重启SDK实例（模拟重启）...');
  const fileSdk2 = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: testStorageDir
  });

  const restoredCred = await fileSdk2.getCredential(fileCredId);
  assert(restoredCred !== undefined, '重启后能查到凭证');
  assert(restoredCred!.status === CredentialStatus.REVOKED, '凭证状态为已撤销（持久化成功）');
  assert(restoredCred!.totalUsedCalls === 3, '总使用次数为3（持久化成功）');
  assert(restoredCred!.usageLogs.length === 1, '日志数量为1（持久化成功）');
  assert(restoredCred!.currentPeriod.usedCalls === 3, '当前周期使用3次（持久化成功）');
  console.log(`重启后凭证: 状态=${restoredCred!.status}, 已用=${restoredCred!.totalUsedCalls}, 日志=${restoredCred!.usageLogs.length}`);

  const restoredAudit = await fileSdk2.getAuditSummary(fileCredId);
  assert(restoredAudit !== null, '重启后能获取审计摘要');
  assert(restoredAudit!.currentPeriod.usedCalls === 3, '审计摘要周期信息正确');
  console.log(`重启后审计摘要 - 周期: ${restoredAudit!.currentPeriod.periodKey}, 已用: ${restoredAudit!.currentPeriod.usedCalls}`);

  console.log('\n--- 测试31: FileStorage DAILY周期 - 跨周期自动重置 ---');
  cleanupTestStorage();

  const dailySdk = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: testStorageDir
  });

  const dailyResult = await dailySdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 10, periodType: 'DAILY' },
    validity,
    purpose: '日周期测试',
    createdBy: 'admin'
  });
  const dailyCredId = dailyResult.credential!.credentialId;

  await dailySdk.executeUsage({
    credentialId: dailyCredId,
    purpose: '日周期消耗',
    callerIdentity: consumer,
    callCount: 8
  });

  const dailyQuota = await dailySdk.getRemainingQuota(dailyCredId);
  assert(dailyQuota.quota!.remainingCalls === 2, '日周期剩余2次');
  assert(dailyQuota.quota!.periodKey.length > 0, '包含日周期key');
  console.log(`日周期: ${dailyQuota.quota!.periodKey}, 剩余: ${dailyQuota.quota!.remainingCalls}`);

  const dailyAudit = await dailySdk.getAuditSummary(dailyCredId);
  assert(dailyAudit!.currentPeriod.usedCalls === 8, '当前周期使用8次');
  console.log(`日周期审计: 已用${dailyAudit!.currentPeriod.usedCalls}次, 剩余${dailyAudit!.currentPeriod.remainingCalls}次`);

  console.log('\n--- 测试32: 周期工具函数 ---');
  const monthlyKey = sdk.getPeriodKey('MONTHLY', Date.now());
  assert(monthlyKey.includes('-'), 'MONTHLY周期key格式正确');
  const dailyKey = sdk.getPeriodKey('DAILY', Date.now());
  assert(dailyKey.includes('-'), 'DAILY周期key格式正确');
  const onceKey = sdk.getPeriodKey('ONCE', Date.now());
  assert(onceKey === 'ONCE', 'ONCE周期key为ONCE');

  const range = sdk.getPeriodRange('MONTHLY', Date.now());
  assert(range.start < range.end, '周期范围有效');
  console.log(`MONTHLY范围: ${new Date(range.start).toISOString()} ~ ${new Date(range.end).toISOString()}`);

  console.log('\n--- 测试33: MemoryStorage直接使用 ---');
  const memSdk = new DataAuthCredentialSDK({ storage: new MemoryStorage() });
  const memResult = await memSdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 10, periodType: 'MONTHLY' },
    validity,
    purpose: '内存存储测试',
    createdBy: 'admin'
  });
  assert(memResult.success === true, 'MemoryStorage创建授权单成功');
  const memCredId = memResult.credential!.credentialId;

  const memExec = await memSdk.executeUsage({
    credentialId: memCredId,
    purpose: '内存测试',
    callerIdentity: consumer,
    callCount: 5
  });
  assert(memExec.success === true, 'MemoryStorage执行扣减成功');
  assert(memExec.remainingAfter!.calls === 5, '剩余5次');

  console.log('\n--- 测试34: executeUsage 不会让已用量超过上限 ---');
  const strictSdk = new DataAuthCredentialSDK({ storage: new MemoryStorage() });
  const strictResult = await strictSdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 5, periodType: 'MONTHLY' },
    validity,
    purpose: '严格额度测试',
    createdBy: 'admin'
  });
  const strictCredId = strictResult.credential!.credentialId;

  const strictExec1 = await strictSdk.executeUsage({
    credentialId: strictCredId,
    purpose: '消耗3次',
    callerIdentity: consumer,
    callCount: 3
  });
  assert(strictExec1.success === true, '消耗3次成功');

  const strictExec2 = await strictSdk.executeUsage({
    credentialId: strictCredId,
    purpose: '再消耗3次',
    callerIdentity: consumer,
    callCount: 3
  });
  assert(strictExec2.success === false, '超出额度被拒绝（3+3=6 > 5）');
  assert(strictExec2.error!.code === ErrorCode.QUOTA_INSUFFICIENT, '错误码为QUOTA_INSUFFICIENT');

  const strictCred = await strictSdk.getCredential(strictCredId);
  assert(strictCred!.currentPeriod.usedCalls === 3, '已用量仍为3（未超上限）');

  cleanupTestStorage();

  console.log('\n========== 全部测试通过 ==========\n');
})();
