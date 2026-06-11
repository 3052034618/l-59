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

const testStorageDir = path.join(process.cwd(), 'data', 'test_credentials_v2');

function cleanup(): void {
  const filePath = path.join(testStorageDir, 'credentials.json');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  if (fs.existsSync(testStorageDir)) {
    fs.rmSync(testStorageDir, { recursive: true });
  }
}

cleanup();

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

const individualUser = {
  id: 'USER-001',
  name: '个人用户张三',
  type: 'INDIVIDUAL' as const
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

  console.log('\n--- 测试2: 配置授权策略 ---');
  const policyId1 = sdk.addRequiredFieldPolicy(
    'PRODUCT',
    'PROD-001',
    ['purpose', 'expectedDataRows', 'expectedDataSizeKB'],
    '企业征信产品必填字段策略'
  );
  assert(policyId1.length > 0, '必填字段策略创建成功');

  const policyId2 = sdk.addSubjectTypePolicy(
    'SCENE',
    'SCENE-001',
    ['ORGANIZATION'],
    ['INDIVIDUAL'],
    '风控评估场景主体类型策略'
  );
  assert(policyId2.length > 0, '主体类型策略创建成功');

  const policyId3 = sdk.addDataSizeLimitPolicy(
    'GLOBAL',
    '*',
    20000,
    1,
    '全局单次数据量限制策略'
  );
  assert(policyId3.length > 0, '数据量限制策略创建成功');

  const policies = sdk.listPolicies();
  assert(policies.length === 3, '策略列表包含3条策略');
  assert(policies[0].priority < policies[1].priority, '策略按优先级排序');
  console.log(`已配置策略数: ${policies.length}`);

  console.log('\n--- 测试3: 创建授权单 ---');
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
  credentialId = createResult.credential!.credentialId;

  console.log('\n--- 测试4: 策略校验 - 缺少必填字段（PENDING）---');
  const pendingResult = await sdk.validate({
    credentialId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: consumer
  });
  assert(pendingResult.type === ValidationResultType.PENDING, '返回PENDING');
  assert(pendingResult.missingFields!.includes('purpose'), '提示缺少purpose');
  assert(pendingResult.missingFields!.includes('expectedDataRows'), '提示缺少expectedDataRows');
  assert(pendingResult.policyHit !== undefined, '返回策略命中信息');
  assert(pendingResult.policyHit!.policyId === policyId1, '命中策略ID正确');
  console.log(`缺失字段: ${pendingResult.missingFields}`);
  console.log(`命中策略: ${pendingResult.policyHit!.policyName}`);

  console.log('\n--- 测试5: 策略校验 - 主体类型不匹配（REJECT）---');
  const rejectResult = await sdk.validate({
    credentialId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: individualUser,
    purpose: '风控评估',
    expectedDataRows: 100,
    expectedDataSizeKB: 500
  });
  assert(rejectResult.type === ValidationResultType.REJECT, '返回REJECT');
  assert(rejectResult.code === ErrorCode.POLICY_SUBJECT_TYPE, '错误码为POLICY_SUBJECT_TYPE');
  assert(rejectResult.policyHit !== undefined, '返回策略命中信息');
  assert(rejectResult.policyHit!.policyId === policyId2, '命中主体类型策略');
  console.log(`拒绝原因: ${rejectResult.message}`);
  console.log(`命中策略: ${rejectResult.policyHit!.policyName}`);

  console.log('\n--- 测试6: 策略校验 - 校验通过（PASS）---');
  const passResult = await sdk.validate({
    credentialId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: consumer,
    purpose: '风控评估',
    expectedDataRows: 100,
    expectedDataSizeKB: 500
  });
  assert(passResult.type === ValidationResultType.PASS, '返回PASS');
  assert(passResult.passed === true, '校验通过');
  assert(passResult.policyHit!.matched === true, '策略校验通过');
  console.log(`校验通过，命中策略: ${passResult.policyHit!.policyName}`);

  console.log('\n--- 测试7: 事务式流程 - preCheck + executeUsage ---');
  const preCheckResult = await sdk.preCheck({
    credentialId,
    callCount: 10,
    dataRows: 500,
    dataSizeKB: 2000
  });
  assert(preCheckResult.canProceed === true, '预检查通过');
  assert(preCheckResult.remainingAfterDeduction!.calls === 90, '扣减后剩余90次');

  const execResult = await sdk.executeUsage({
    credentialId,
    purpose: '风控评估',
    callerIdentity: consumer,
    callCount: 10,
    dataRows: 500,
    dataSizeKB: 2000
  });
  assert(execResult.success === true, '执行扣减成功');
  assert(execResult.deducted!.calls === 10, '扣减10次');
  assert(execResult.remainingAfter!.calls === 90, '扣减后剩余90次');

  const quotaAfter = await sdk.getRemainingQuota(credentialId);
  assert(quotaAfter.quota!.periodUsedCalls === 10, '当前周期已用10次');

  console.log('\n--- 测试8: executeUsage - 无效参数校验 ---');
  const call0Result = await sdk.executeUsage({
    credentialId,
    purpose: '测试',
    callerIdentity: consumer,
    callCount: 0
  });
  assert(call0Result.success === false, 'callCount=0被拒绝');
  assert(call0Result.error!.code === ErrorCode.INVALID_CALL_COUNT, '错误码正确');

  const negCallResult = await sdk.executeUsage({
    credentialId,
    purpose: '测试',
    callerIdentity: consumer,
    callCount: -5
  });
  assert(negCallResult.success === false, 'callCount=-5被拒绝');

  const rows0Result = await sdk.executeUsage({
    credentialId,
    purpose: '测试',
    callerIdentity: consumer,
    callCount: 1,
    dataRows: 0
  });
  assert(rows0Result.success === false, 'dataRows=0被拒绝');

  const negRowsResult = await sdk.executeUsage({
    credentialId,
    purpose: '测试',
    callerIdentity: consumer,
    callCount: 1,
    dataRows: -100
  });
  assert(negRowsResult.success === false, 'dataRows=-100被拒绝');

  const size0Result = await sdk.executeUsage({
    credentialId,
    purpose: '测试',
    callerIdentity: consumer,
    callCount: 1,
    dataSizeKB: 0
  });
  assert(size0Result.success === false, 'dataSizeKB=0被拒绝');

  const quotaCheck1 = await sdk.getRemainingQuota(credentialId);
  assert(quotaCheck1.quota!.periodUsedCalls === 10, '无效请求未改变额度');
  console.log('无效参数全部被正确拦截，额度未变动');

  console.log('\n--- 测试9: executeUsage - 超额拒绝，额度不变 ---');
  const beforeQuota = await sdk.getRemainingQuota(credentialId);
  const beforeCalls = beforeQuota.quota!.periodUsedCalls;

  const overResult = await sdk.executeUsage({
    credentialId,
    purpose: '超额测试',
    callerIdentity: consumer,
    callCount: 200,
    dataRows: 50000
  });
  assert(overResult.success === false, '超额扣减被拒绝');
  assert(overResult.error!.code === ErrorCode.QUOTA_INSUFFICIENT, '错误码为QUOTA_INSUFFICIENT');

  const afterQuota = await sdk.getRemainingQuota(credentialId);
  assert(afterQuota.quota!.periodUsedCalls === beforeCalls, '被拒绝后额度不变');
  console.log('超额拒绝，额度保持不变');

  console.log('\n--- 测试10: appendUsageLog - 收紧校验 ---');
  const appendValid = await sdk.appendUsageLog(credentialId, {
    purpose: '风险建模',
    callCount: 5,
    dataRows: 200,
    dataSizeKB: 1000,
    callerIdentity: consumer.id,
    remark: '追加测试'
  });
  assert(appendValid.success === true, '正常追加成功');

  const appendCall0 = await sdk.appendUsageLog(credentialId, {
    purpose: '测试',
    callCount: 0,
    callerIdentity: consumer.id
  });
  assert(appendCall0.success === false, 'callCount=0追加被拒绝');
  assert(appendCall0.error!.code === ErrorCode.INVALID_CALL_COUNT, '错误码正确');

  const appendNegRows = await sdk.appendUsageLog(credentialId, {
    purpose: '测试',
    callCount: 1,
    dataRows: -50,
    callerIdentity: consumer.id
  });
  assert(appendNegRows.success === false, 'dataRows=-50追加被拒绝');

  const appendOverQuota = await sdk.appendUsageLog(credentialId, {
    purpose: '测试',
    callCount: 200,
    callerIdentity: consumer.id
  });
  assert(appendOverQuota.success === false, '超额追加被拒绝');

  const quotaAfterAppend = await sdk.getRemainingQuota(credentialId);
  assert(quotaAfterAppend.quota!.periodUsedCalls === 15, '只有正常追加成功计数');
  console.log('追加日志校验收紧生效');

  console.log('\n--- 测试11: 查询剩余额度（含周期信息）---');
  const quotaResult = await sdk.getRemainingQuota(credentialId);
  assert(quotaResult.success === true, '查询成功');
  assert(quotaResult.quota!.periodKey !== undefined, '包含周期key');
  assert(quotaResult.quota!.periodUsedCalls === 15, '周期已用15次');
  assert(quotaResult.quota!.remainingCalls === 85, '剩余85次');
  console.log(`周期: ${quotaResult.quota!.periodKey}, 已用: ${quotaResult.quota!.periodUsedCalls}, 剩余: ${quotaResult.quota!.remainingCalls}`);

  console.log('\n--- 测试12: 审计摘要（含周期信息）---');
  const auditSummary = await sdk.getAuditSummary(credentialId);
  assert(auditSummary !== null, '获取审计摘要成功');
  assert(auditSummary!.currentPeriod !== undefined, '包含当前周期');
  assert(auditSummary!.currentPeriod.usedCalls === 15, '当前周期使用15次');
  assert(auditSummary!.currentPeriod.remainingCalls === 85, '当前周期剩余85次');
  assert(auditSummary!.quota.usedCalls === 15, '额度已用15次');
  assert(auditSummary!.periodHistory.length >= 0, '包含历史周期');
  console.log('审计摘要周期信息正确');

  console.log('\n--- 测试13: 审计报表 - 按提供方维度 ---');
  const reportProvider = await sdk.generateReportByProvider(provider.id, {
    includePeriodDetails: true,
    includeRevocationRecords: true
  });
  assert(reportProvider.summary.totalCredentials === 1, '凭证数1');
  assert(reportProvider.summary.totalCalls === 15, '总调用15次');
  assert(reportProvider.items.length === 1, '报表项1条');
  assert(reportProvider.items[0].dimension === 'PROVIDER', '维度为PROVIDER');
  assert(reportProvider.items[0].currentPeriodUsage !== undefined, '包含周期使用详情');
  console.log(`按提供方报表 - 总调用: ${reportProvider.summary.totalCalls}, 凭证数: ${reportProvider.summary.totalCredentials}`);

  console.log('\n--- 测试14: 审计报表 - 按使用方维度 ---');
  const reportConsumer = await sdk.generateReportByConsumer(consumer.id);
  assert(reportConsumer.summary.totalCredentials === 1, '凭证数1');
  assert(reportConsumer.summary.totalDataRows === 700, '总数据行数700');
  console.log(`按使用方报表 - 总数据行数: ${reportConsumer.summary.totalDataRows}`);

  console.log('\n--- 测试15: 审计报表 - 按产品维度 ---');
  const reportProduct = await sdk.generateReportByProduct('PROD-001');
  assert(reportProduct.summary.totalCredentials === 1, '凭证数1');
  assert(reportProduct.summary.totalDataSizeKB === 3000, '总数据量3000KB');
  console.log(`按产品报表 - 总数据量: ${reportProduct.summary.totalDataSizeKB}KB`);

  console.log('\n--- 测试16: 审计报表 - 全局汇总 ---');
  const reportAll = await sdk.generateUsageReport({
    startTime: 0,
    endTime: Date.now(),
    includePeriodDetails: true
  });
  assert(reportAll.summary.totalCredentials === 1, '凭证数1');
  assert(reportAll.summary.totalCalls === 15, '总调用15次');
  assert(reportAll.items[0].dimension === 'GLOBAL', '维度为GLOBAL');
  console.log(`全局报表 - 总调用: ${reportAll.summary.totalCalls}`);

  console.log('\n--- 测试17: 策略管理 - 移除策略 ---');
  const removeResult = sdk.removePolicy(policyId3);
  assert(removeResult === true, '移除策略成功');
  const policiesAfter = sdk.listPolicies();
  assert(policiesAfter.length === 2, '剩余2条策略');
  console.log('策略管理功能正常');

  console.log('\n--- 测试18: 策略管理 - 获取策略 ---');
  const policy = sdk.getPolicy(policyId1);
  assert(policy !== undefined, '获取策略成功');
  assert(policy!.policyId === policyId1, '策略ID正确');

  console.log('\n--- 测试19: 批量校验含策略命中 ---');
  const batchResult = await sdk.batchValidate([
    {
      credentialId,
      productId: 'PROD-001',
      sceneId: 'SCENE-001',
      callerIdentity: consumer,
      purpose: '风控评估',
      expectedDataRows: 100,
      expectedDataSizeKB: 500
    },
    {
      credentialId,
      productId: 'PROD-001',
      sceneId: 'SCENE-001',
      callerIdentity: individualUser,
      purpose: '风控评估',
      expectedDataRows: 100,
      expectedDataSizeKB: 500
    },
    {
      credentialId,
      productId: 'PROD-001',
      sceneId: 'SCENE-001',
      callerIdentity: consumer
    }
  ]);

  assert(batchResult.results[0].type === ValidationResultType.PASS, '第一条通过');
  assert(batchResult.results[1].type === ValidationResultType.REJECT, '第二条被策略拒绝');
  assert(batchResult.results[1].policyHit !== undefined, '第二条返回策略命中');
  assert(batchResult.results[2].type === ValidationResultType.PENDING, '第三条PENDING');
  assert(batchResult.results[2].policyHit !== undefined, '第三条返回策略命中');
  console.log(`批量校验: 通过${batchResult.summary.passed}, 拒绝${batchResult.summary.rejected}, 待补${batchResult.summary.pending}`);
  console.log(`拒绝原因: ${batchResult.results[1].message}`);
  console.log(`命中策略: ${batchResult.results[1].policyHit!.policyName}`);

  console.log('\n--- 测试20: FileStorage 持久化含策略相关数据 ---');
  cleanup();

  const fileSdk1 = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: testStorageDir
  });

  const fileCreate = await fileSdk1.createAuthorization({
    provider,
    consumer,
    scope,
    quota,
    validity,
    purpose: '持久化测试',
    createdBy: 'admin'
  });
  const fileCredId = fileCreate.credential!.credentialId;

  await fileSdk1.executeUsage({
    credentialId: fileCredId,
    purpose: '持久化测试调用',
    callerIdentity: consumer,
    callCount: 8,
    dataRows: 400,
    dataSizeKB: 1600
  });

  await fileSdk1.revokeCredential(fileCredId, 'admin', '测试撤销持久化');

  console.log('重启SDK实例...');
  const fileSdk2 = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: testStorageDir
  });

  const restored = await fileSdk2.getCredential(fileCredId);
  assert(restored !== undefined, '重启后能查到凭证');
  assert(restored!.status === CredentialStatus.REVOKED, '凭证状态已撤销');
  assert(restored!.totalUsedCalls === 8, '总使用次数8次');
  assert(restored!.currentPeriod.usedCalls === 8, '当前周期使用8次');
  assert(restored!.usageLogs.length === 1, '日志1条');
  assert(restored!.usageLogs[0].periodKey !== undefined, '日志包含周期key');
  assert(restored!.revokedBy === 'admin', '撤销人正确');
  assert(restored!.revokeReason === '测试撤销持久化', '撤销原因正确');
  console.log('凭证、周期用量、日志、撤销记录全部持久化成功');

  const restoredAudit = await fileSdk2.getAuditSummary(fileCredId);
  assert(restoredAudit !== null, '重启后能获取审计摘要');
  assert(restoredAudit!.currentPeriod.usedCalls === 8, '重启后周期用量正确');
  assert(restoredAudit!.totalUsageLogs === 1, '重启后日志数正确');
  console.log('重启后审计数据完整');

  const restoredReport = await fileSdk2.generateReportByProvider(provider.id);
  assert(restoredReport.summary.totalRevoked === 1, '重启后报表包含撤销记录');
  assert(restoredReport.summary.totalCalls === 8, '重启后报表调用次数正确');
  console.log('重启后报表数据完整');

  console.log('\n--- 测试21: 周期管理 - ONCE类型用尽后状态不变 ---');
  const onceSdk = new DataAuthCredentialSDK();
  const onceResult = await onceSdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 3, periodType: 'ONCE' },
    validity,
    purpose: 'ONCE周期测试',
    createdBy: 'admin'
  });
  const onceCredId = onceResult.credential!.credentialId;

  for (let i = 0; i < 3; i++) {
    await onceSdk.executeUsage({
      credentialId: onceCredId,
      purpose: '消耗',
      callerIdentity: consumer,
      callCount: 1
    });
  }
  const onceCred = await onceSdk.getCredential(onceCredId);
  assert(onceCred!.status === CredentialStatus.EXHAUSTED, 'ONCE类型用尽后状态为EXHAUSTED');

  const onceValidate = await onceSdk.validate({
    credentialId: onceCredId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: consumer,
    purpose: '风控评估',
    expectedDataRows: 100,
    expectedDataSizeKB: 500
  });
  assert(onceValidate.code === ErrorCode.CREDENTIAL_EXHAUSTED, 'ONCE类型用尽后校验被拒绝');

  console.log('\n--- 测试22: 检查有效性 ---');
  const validityResult = await sdk.checkValidity(credentialId);
  assert(validityResult.success === true, '检查成功');
  assert(validityResult.validity!.isValid === true, '凭证有效');

  console.log('\n--- 测试23: 比对主体身份 ---');
  const verifyConsumer = await sdk.verifyIdentity(credentialId, consumer);
  assert(verifyConsumer.verification!.matchedRole === 'CONSUMER', '使用方角色正确');

  console.log('\n--- 测试24: checkUsageScope ---');
  const scopeResult = await sdk.checkUsageScope(credentialId, 'PROD-001', 'SCENE-001');
  assert(scopeResult.valid === true, '范围校验通过');

  console.log('\n--- 测试25: recordPurpose ---');
  const purposeResult = await sdk.recordPurpose(credentialId, '风险建模', consumer, 2);
  assert(purposeResult.success === true, '记录目的成功');

  console.log('\n--- 测试26: getAllCredentials ---');
  const allCreds = await sdk.getAllCredentials();
  assert(allCreds.length >= 1, '获取全部凭证成功');

  console.log('\n--- 测试27: 格式化错误 ---');
  const fmtErr = sdk.formatError(ErrorCode.POLICY_VIOLATION, '自定义策略错误', { policy: 'test' });
  assert(fmtErr.code === ErrorCode.POLICY_VIOLATION, '错误码正确');
  assert(fmtErr.message === '自定义策略错误', '自定义消息生效');
  assert(fmtErr.details!.policy === 'test', '错误详情正确');

  console.log('\n--- 测试28: 工具函数 ---');
  assert(sdk.compareIdentity(consumer, consumer) === true, 'compareIdentity正确');
  assert(sdk.getPeriodKey('MONTHLY', Date.now()).includes('-'), 'getPeriodKey正确');
  const range = sdk.getPeriodRange('DAILY', Date.now());
  assert(range.start < range.end, 'getPeriodRange正确');

  console.log('\n--- 测试29: 数据量超限策略 ---');
  const policySDK = new DataAuthCredentialSDK();
  policySDK.addDataSizeLimitPolicy('GLOBAL', '*', 1000);

  const pc = await policySDK.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 100, periodType: 'MONTHLY' },
    validity,
    purpose: '测试',
    createdBy: 'admin'
  });

  const policyValResult = await policySDK.validate({
    credentialId: pc.credential!.credentialId,
    productId: 'PROD-002',
    sceneId: 'SCENE-001',
    callerIdentity: consumer,
    purpose: '风控评估',
    expectedDataSizeKB: 2000
  });
  assert(policyValResult.type === ValidationResultType.REJECT, '数据量超限被策略拒绝');
  assert(policyValResult.code === ErrorCode.INVALID_DATA_SIZE, '错误码正确');

  console.log('\n--- 测试30: 清理测试数据 ---');
  cleanup();
  assert(!fs.existsSync(testStorageDir), '测试数据已清理');

  console.log('\n========== 全部测试通过 ==========\n');
})();
