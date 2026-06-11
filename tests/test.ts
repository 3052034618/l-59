import * as fs from 'fs';
import * as path from 'path';
import {
  DataAuthCredentialSDK,
  CredentialStatus,
  ValidationResultType,
  ErrorCode,
  MemoryStorage,
  FileStorage,
  RejectionCategory
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
  assert(policyValResult.code === ErrorCode.POLICY_DATA_SIZE_EXCEEDED, '错误码正确');

  console.log('\n--- 测试30: 时间段报表 - 不同时间段数值不同 ---');
  const timeSdk = new DataAuthCredentialSDK();
  timeSdk.addRequiredFieldPolicy('PRODUCT', 'PROD-001', ['purpose'], '测试必填策略');

  const tCreate1 = await timeSdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 100, periodType: 'MONTHLY' },
    validity,
    purpose: '时间段测试',
    createdBy: 'admin'
  });
  const tCredId1 = tCreate1.credential!.credentialId;

  const t1Start = Date.now();
  await timeSdk.executeUsage({
    credentialId: tCredId1,
    purpose: 'T1调用',
    callerIdentity: consumer,
    callCount: 3,
    dataRows: 150,
    dataSizeKB: 600
  });
  const t1End = Date.now();

  await new Promise(r => setTimeout(r, 5));

  const t2Start = Date.now();
  await timeSdk.executeUsage({
    credentialId: tCredId1,
    purpose: 'T2调用',
    callerIdentity: consumer,
    callCount: 7,
    dataRows: 350,
    dataSizeKB: 1400
  });
  const t2End = Date.now();

  const reportT1 = await timeSdk.generateUsageReport({
    startTime: t1Start,
    endTime: t1End,
    filterByTimeRange: true
  });
  const reportT2 = await timeSdk.generateUsageReport({
    startTime: t2Start,
    endTime: t2End,
    filterByTimeRange: true
  });
  const timeReportAll = await timeSdk.generateUsageReport({
    startTime: 0,
    endTime: Date.now(),
    filterByTimeRange: true
  });

  assert(reportT1.summary.totalCalls === 3, `T1时间段调用=3（实际${reportT1.summary.totalCalls}）`);
  assert(reportT1.summary.totalDataRows === 150, 'T1数据行数=150');
  assert(reportT2.summary.totalCalls === 7, `T2时间段调用=7（实际${reportT2.summary.totalCalls}）`);
  assert(reportT2.summary.totalDataSizeKB === 1400, 'T2数据量=1400KB');
  assert(timeReportAll.summary.totalCalls === 10, '全量调用=10');
  console.log(`T1调用=${reportT1.summary.totalCalls}, T2调用=${reportT2.summary.totalCalls}, 全量=${timeReportAll.summary.totalCalls}`);
  console.log('时间段过滤统计生效');

  console.log('\n--- 测试31: 异常拒绝事件沉淀 + 分类统计 ---');
  const rejectSdk = new DataAuthCredentialSDK();
  rejectSdk.addRequiredFieldPolicy('PRODUCT', 'PROD-001', ['purpose', 'expectedDataRows'], '拒绝事件测试策略');
  rejectSdk.addSubjectTypePolicy('SCENE', 'SCENE-001', ['INDIVIDUAL'], undefined, '主体类型限制策略');
  rejectSdk.addDataSizeLimitPolicy('PRODUCT', 'PROD-001', 100, undefined, '数据量限制策略');

  const rCreate = await rejectSdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 100, periodType: 'MONTHLY' },
    validity,
    purpose: '拒绝事件测试',
    createdBy: 'admin'
  });
  const rCredId = rCreate.credential!.credentialId;

  const wrongConsumer = { id: 'WRONG', name: '别人', type: 'INDIVIDUAL' as const };
  await rejectSdk.validate({
    credentialId: rCredId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: wrongConsumer,
    purpose: '测试',
    expectedDataRows: 100
  });

  const orgConsumer = { id: consumer.id, name: consumer.name, type: 'ORGANIZATION' as const };
  await rejectSdk.validate({
    credentialId: rCredId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: orgConsumer,
    purpose: '测试',
    expectedDataRows: 100,
    expectedDataSizeKB: 200
  });

  await rejectSdk.executeUsage({
    credentialId: rCredId,
    purpose: '测试',
    callerIdentity: consumer,
    callCount: -1
  });

  await rejectSdk.executeUsage({
    credentialId: rCredId,
    purpose: '测试',
    callerIdentity: consumer,
    callCount: 1,
    dataRows: 0
  });

  await rejectSdk.executeUsage({
    credentialId: rCredId,
    purpose: '测试',
    callerIdentity: consumer,
    callCount: 200
  });

  const allPolicies = rejectSdk.listPolicies();
  const subjectPolicy = allPolicies.find(p => p.policyName === '主体类型限制策略');
  if (subjectPolicy) {
    rejectSdk.removePolicy(subjectPolicy.policyId);
  }

  await rejectSdk.validate({
    credentialId: rCredId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: orgConsumer,
    purpose: '测试',
    expectedDataRows: 100,
    expectedDataSizeKB: 200
  });

  const rejectionEvents = await rejectSdk.listRejectionEvents();
  assert(rejectionEvents.length >= 4, `至少4次拒绝事件（实际${rejectionEvents.length}）`);

  const hasPolicy = rejectionEvents.some(e => e.category === 'POLICY');
  const hasIdentity = rejectionEvents.some(e => e.category === 'IDENTITY');
  const hasParam = rejectionEvents.some(e => e.category === 'PARAM');
  assert(hasPolicy, '包含POLICY分类拒绝');
  assert(hasIdentity, '包含IDENTITY分类拒绝');
  assert(hasParam, '包含PARAM分类拒绝');

  const rReport = await rejectSdk.generateUsageReport({
    startTime: 0,
    endTime: Date.now(),
    includeRejectionStats: true
  });
  assert(rReport.summary.rejectionSummary !== undefined, '报表包含拒绝分类汇总');
  const totalRejections = rReport.summary.rejectionSummary!.reduce((s, r) => s + r.count, 0);
  assert(totalRejections >= 4, `拒绝分类汇总次数正确（${totalRejections}）`);

  const policySummary = rReport.summary.rejectionSummary!.find(r => r.category === 'POLICY');
  assert(policySummary !== undefined, 'POLICY分类汇总存在');
  assert(policySummary!.sampleEvents.length > 0, '包含示例事件');
  console.log(`拒绝事件: ${rejectionEvents.length}次, POLICY=${hasPolicy}, IDENTITY=${hasIdentity}, PARAM=${hasParam}`);
  console.log(`拒绝分类汇总: ${rReport.summary.rejectionSummary!.length}类, 共${totalRejections}次`);

  console.log('\n--- 测试32: 多凭证周期用量汇总 ---');
  const multiSdk = new DataAuthCredentialSDK();

  const c1 = await multiSdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 500, periodType: 'MONTHLY' },
    validity,
    purpose: '多凭证A',
    createdBy: 'admin'
  });

  const consumer2 = { id: 'CONS-002', name: '第二个使用方', type: 'ORGANIZATION' as const };
  const c2 = await multiSdk.createAuthorization({
    provider,
    consumer: consumer2,
    scope,
    quota: { maxCalls: 200, periodType: 'MONTHLY' },
    validity,
    purpose: '多凭证B',
    createdBy: 'admin'
  });

  await multiSdk.executeUsage({
    credentialId: c1.credential!.credentialId,
    purpose: 'A调用',
    callerIdentity: consumer,
    callCount: 5,
    dataRows: 250,
    dataSizeKB: 1000
  });
  await multiSdk.executeUsage({
    credentialId: c2.credential!.credentialId,
    purpose: 'B调用',
    callerIdentity: consumer2,
    callCount: 3,
    dataRows: 150,
    dataSizeKB: 600
  });

  const providerReport = await multiSdk.generateReportByProvider(provider.id, {
    startTime: 0,
    endTime: Date.now(),
    includePeriodDetails: true
  });
  assert(providerReport.summary.totalCredentials === 2, '涉及2张凭证');
  assert(providerReport.summary.totalCalls === 8, '汇总调用=8');
  assert(providerReport.summary.totalDataRows === 400, '汇总行数=400');

  const item = providerReport.items[0];
  assert(item.periodUsages !== undefined && item.periodUsages.length > 0, '包含periodUsages周期汇总');
  const agg = item.periodUsages![0];
  assert(agg.credentialCount === 2, `周期汇总涉及2张凭证（实际${agg.credentialCount}）`);
  assert(agg.usedCalls === 8, `周期汇总调用=8（实际${agg.usedCalls}）`);
  assert(agg.usedRows === 400, '周期汇总行数=400');

  assert(item.currentPeriodUsage !== undefined, '包含currentPeriodUsage');
  assert(item.currentPeriodUsage!.credentialCount === 2, '当前周期涉及2张凭证');
  console.log(`2张凭证周期汇总: ${agg.usedCalls}次, ${agg.usedRows}行, ${agg.usedSizeKB}KB, 涉及${agg.credentialCount}张凭证`);

  console.log('\n--- 测试33: 拒绝事件按维度+时间段过滤查询 ---');
  const filtered = await rejectSdk.listRejectionEvents({
    category: 'POLICY' as RejectionCategory
  });
  assert(filtered.length >= 2, '按分类过滤POLICY至少2条');
  filtered.forEach(e => assert(e.category === 'POLICY', '过滤结果都是POLICY分类'));

  const filteredByCode = await rejectSdk.listRejectionEvents({
    errorCode: ErrorCode.IDENTITY_MISMATCH
  });
  assert(filteredByCode.length >= 1, '按错误码过滤返回结果');

  const filteredByCred = await rejectSdk.listRejectionEvents({
    credentialId: rCredId
  });
  assert(filteredByCred.length >= 4, '按凭证ID过滤返回结果');

  console.log('拒绝事件多维过滤查询正常');

  console.log('\n--- 测试34: FileStorage 拒绝事件持久化 ---');
  cleanup();
  const persistSdk1 = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: testStorageDir
  });
  persistSdk1.addRequiredFieldPolicy('PRODUCT', 'PROD-001', ['purpose'], '持久化拒绝策略');

  const pCreate = await persistSdk1.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 100, periodType: 'MONTHLY' },
    validity,
    purpose: '持久化测试',
    createdBy: 'admin'
  });
  const pCredId = pCreate.credential!.credentialId;

  await persistSdk1.executeUsage({
    credentialId: pCredId,
    purpose: '正常调用',
    callerIdentity: consumer,
    callCount: 3
  });
  await persistSdk1.validate({
    credentialId: pCredId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: consumer
  });
  await persistSdk1.validate({
    credentialId: pCredId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: { id: 'X', name: 'X', type: 'ORGANIZATION' }
  });

  const rejectionsBefore = await persistSdk1.listRejectionEvents();
  assert(rejectionsBefore.length === 2, '重启前2次拒绝事件');

  console.log('重启SDK（含拒绝事件持久化）...');
  const persistSdk2 = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: testStorageDir
  });

  const pRestoredCred = await persistSdk2.getCredential(pCredId);
  assert(pRestoredCred !== undefined, '重启后凭证恢复');
  assert(pRestoredCred!.totalUsedCalls === 3, '重启后调用次数恢复');

  const rejectionsAfter = await persistSdk2.listRejectionEvents();
  assert(rejectionsAfter.length === 2, `重启后拒绝事件=2（实际${rejectionsAfter.length}）`);
  assert(rejectionsAfter[0].eventId === rejectionsBefore[0].eventId, '重启后拒绝事件ID一致');
  assert(rejectionsAfter[0].category === rejectionsBefore[0].category, '重启后分类一致');

  const pReport = await persistSdk2.generateUsageReport({
    startTime: 0,
    endTime: Date.now(),
    includeRejectionStats: true
  });
  assert(pReport.summary.totalCalls === 3, '重启后报表调用次数=3');
  const rejSum = pReport.summary.rejectionSummary!.reduce((s, r) => s + r.count, 0);
  assert(rejSum === 2, '重启后报表拒绝汇总=2');
  console.log(`重启后拒绝事件: ${rejectionsAfter.length}次, 报表拒绝汇总: ${rejSum}次`);
  console.log('拒绝事件持久化+重启恢复正常');

  console.log('\n--- 测试35: 撤销凭证后校验产生拒绝事件 ---');
  const revokeSdk = new DataAuthCredentialSDK();
  const rvCreate = await revokeSdk.createAuthorization({
    provider,
    consumer,
    scope,
    quota: { maxCalls: 100, periodType: 'MONTHLY' },
    validity,
    purpose: '撤销测试',
    createdBy: 'admin'
  });
  const rvCredId = rvCreate.credential!.credentialId;

  await revokeSdk.revokeCredential(rvCredId, 'admin', '测试撤销');
  await revokeSdk.validate({
    credentialId: rvCredId,
    productId: 'PROD-001',
    sceneId: 'SCENE-001',
    callerIdentity: consumer,
    purpose: '测试',
    expectedDataRows: 100,
    expectedDataSizeKB: 500
  });

  const rvRejections = await revokeSdk.listRejectionEvents();
  const revokedRej = rvRejections.find(r => r.errorCode === ErrorCode.CREDENTIAL_REVOKED);
  assert(revokedRej !== undefined, '存在CREDENTIAL_REVOKED拒绝事件');
  assert(revokedRej!.category === 'CREDENTIAL_STATUS', '撤销拒绝分类为CREDENTIAL_STATUS');
  console.log(`撤销拒绝事件: errorCode=${revokedRej!.errorCode}, category=${revokedRej!.category}`);

  console.log('\n--- 测试36: executeUsage 携带 productId/sceneId ---');
  const prodSdk = new DataAuthCredentialSDK();

  const pc1 = await prodSdk.createAuthorization({
    provider,
    consumer,
    scope: {
      products: [
        { productId: 'PROD-P1', productName: '产品1', dataCategory: 'A', providerId: provider.id },
        { productId: 'PROD-P2', productName: '产品2', dataCategory: 'B', providerId: provider.id }
      ],
      scenes: [{ sceneId: 'SCENE-S1', sceneName: '场景1', sceneDescription: '', sceneType: 'A' }],
      allowedPurposes: ['测试']
    },
    quota: { maxCalls: 100, periodType: 'MONTHLY' },
    validity,
    purpose: '多产品测试',
    createdBy: 'admin'
  });
  const pcId = pc1.credential!.credentialId;

  await prodSdk.executeUsage({
    credentialId: pcId,
    purpose: '测试',
    callerIdentity: consumer,
    callCount: 5,
    productId: 'PROD-P1',
    sceneId: 'SCENE-S1',
    dataRows: 100,
    dataSizeKB: 500
  });
  await prodSdk.executeUsage({
    credentialId: pcId,
    purpose: '测试',
    callerIdentity: consumer,
    callCount: 3,
    productId: 'PROD-P2',
    sceneId: 'SCENE-S1',
    dataRows: 60,
    dataSizeKB: 300
  });

  const pcCred = await prodSdk.getCredential(pcId);
  const logs = pcCred!.usageLogs;
  assert(logs.length === 2, '2条调用日志');
  assert(logs[0].productId === 'PROD-P1', '日志1 productId正确');
  assert(logs[1].productId === 'PROD-P2', '日志2 productId正确');
  assert(logs[0].sceneId === 'SCENE-S1', '日志1 sceneId正确');
  console.log('日志携带 productId/sceneId 正常');

  console.log('\n--- 测试37: 按产品维度查报表，分别统计 ---');
  const rptP1 = await prodSdk.generateReportByProduct('PROD-P1');
  const rptP2 = await prodSdk.generateReportByProduct('PROD-P2');

  assert(rptP1.summary.totalCalls === 5, `产品1调用=5（实际${rptP1.summary.totalCalls}）`);
  assert(rptP1.summary.totalDataRows === 100, '产品1行数=100');
  assert(rptP2.summary.totalCalls === 3, `产品2调用=3（实际${rptP2.summary.totalCalls}）`);
  assert(rptP2.summary.totalDataSizeKB === 300, '产品2数据量=300KB');
  assert(rptP1.items[0].dimension === 'PRODUCT', '维度为PRODUCT');
  console.log(`产品1: ${rptP1.summary.totalCalls}次, 产品2: ${rptP2.summary.totalCalls}次，分别统计正常`);

  console.log('\n--- 测试38: 周期明细与查询区间一致 ---');
  const now = Date.now();
  await prodSdk.executeUsage({
    credentialId: pcId,
    purpose: 'T1调用',
    callerIdentity: consumer,
    callCount: 2,
    productId: 'PROD-P1',
    sceneId: 'SCENE-S1',
    dataRows: 40,
    dataSizeKB: 200
  });
  const t38t1End = Date.now();
  await new Promise(r => setTimeout(r, 10));
  await prodSdk.executeUsage({
    credentialId: pcId,
    purpose: 'T2调用',
    callerIdentity: consumer,
    callCount: 4,
    productId: 'PROD-P1',
    sceneId: 'SCENE-S1',
    dataRows: 80,
    dataSizeKB: 400
  });

  const rptT1 = await prodSdk.generateReportByProduct('PROD-P1', {
    startTime: 0,
    endTime: t38t1End,
    includePeriodDetails: true
  });
  const rptT2 = await prodSdk.generateReportByProduct('PROD-P1', {
    startTime: t38t1End + 1,
    endTime: Date.now(),
    includePeriodDetails: true
  });

  assert(rptT1.summary.totalCalls === 7, `T1产品1调用=7（实际${rptT1.summary.totalCalls}）`);
  assert(rptT2.summary.totalCalls === 4, `T2产品1调用=4（实际${rptT2.summary.totalCalls}）`);
  assert(rptT1.items[0].periodUsages![0].usedCalls === 7, 'T1周期用量=7（不包含T2的4次）');
  assert(rptT2.items[0].periodUsages![0].usedCalls === 4, 'T2周期用量=4（不包含T1的7次）');
  console.log(`T1周期用量=${rptT1.items[0].periodUsages![0].usedCalls}, T2周期用量=${rptT2.items[0].periodUsages![0].usedCalls}，与查询区间一致`);

  console.log('\n--- 测试39: 对账引擎 - 完全匹配 + 差异 + 漏记 ---');
  const reconSdk = new DataAuthCredentialSDK();
  const rc = await reconSdk.createAuthorization({
    provider,
    consumer,
    scope: {
      products: [{ productId: 'PROD-R1', productName: '对账产品', dataCategory: 'A', providerId: provider.id }],
      scenes: [{ sceneId: 'SCENE-R1', sceneName: '对账场景', sceneDescription: '', sceneType: 'A' }],
      allowedPurposes: ['对账']
    },
    quota: { maxCalls: 100, periodType: 'MONTHLY' },
    validity,
    purpose: '对账测试',
    createdBy: 'admin'
  });
  const rcId = rc.credential!.credentialId;

  const exec1 = await reconSdk.executeUsage({
    credentialId: rcId,
    purpose: '对账',
    callerIdentity: consumer,
    callCount: 2,
    productId: 'PROD-R1',
    sceneId: 'SCENE-R1',
    dataRows: 50,
    dataSizeKB: 200
  });
  const exec2 = await reconSdk.executeUsage({
    credentialId: rcId,
    purpose: '对账',
    callerIdentity: consumer,
    callCount: 3,
    productId: 'PROD-R1',
    sceneId: 'SCENE-R1',
    dataRows: 75,
    dataSizeKB: 300
  });

  const unitPrice = 1.5;
  const bills = [
    {
      billId: 'BILL-R001',
      timestamp: exec1.logEntry!.timestamp,
      credentialId: rcId,
      providerId: provider.id,
      consumerId: consumer.id,
      productId: 'PROD-R1',
      sceneId: 'SCENE-R1',
      callCount: 2,
      dataRows: 50,
      dataSizeKB: 200,
      unitPrice,
      totalAmount: 3,
      status: 'SUCCESS' as const
    },
    {
      billId: 'BILL-R002',
      timestamp: exec2.logEntry!.timestamp,
      credentialId: rcId,
      providerId: provider.id,
      consumerId: consumer.id,
      productId: 'PROD-R1',
      sceneId: 'SCENE-R1',
      callCount: 5,
      dataRows: 75,
      dataSizeKB: 300,
      unitPrice,
      totalAmount: 7.5,
      status: 'SUCCESS' as const
    },
    {
      billId: 'BILL-R003',
      timestamp: Date.now() + 10 * 60 * 1000,
      credentialId: rcId,
      providerId: provider.id,
      consumerId: consumer.id,
      productId: 'PROD-R1',
      sceneId: 'SCENE-R1',
      callCount: 1,
      unitPrice,
      totalAmount: 1.5,
      status: 'SUCCESS' as const
    }
  ];

  const recon = await reconSdk.reconcile(bills, {
    endTime: Date.now() + 24 * 60 * 60 * 1000
  });

  console.log('对账结果详情:', recon.results.map(r => ({ status: r.status, billId: r.billRecord?.billId, logId: r.sdkLogEntry?.logId, message: r.message.substring(0, 50) })));
  console.log('对账汇总:', recon.summary);

  assert(recon.totalBillRecords === 3, '账单记录=3');
  assert(recon.totalSdkLogs === 2, 'SDK日志=2');
  assert(recon.summary.matched === 1, `完全匹配=1（实际${recon.summary.matched}）`);
  assert(recon.summary.mismatch === 1, `存在差异=1（实际${recon.summary.mismatch}）`);
  assert(recon.summary.missingInSdk === 1, `SDK漏记=1（实际${recon.summary.missingInSdk}）`);
  assert(recon.summary.missingInBill === 0, `账单漏记=0（实际${recon.summary.missingInBill}）`);

  const mismatch = recon.results.find(r => r.status === 'MISMATCH');
  assert(mismatch !== undefined, '存在差异记录');
  assert(mismatch!.diff?.callCountDiff === -2, `次数差=-2（实际${mismatch!.diff?.callCountDiff}）`);
  assert(mismatch!.diff?.amountDiff === 3, `金额差=3（实际${mismatch!.diff?.amountDiff}）`);
  console.log(`对账结果: 匹配${recon.summary.matched}, 差异${recon.summary.mismatch}, SDK漏记${recon.summary.missingInSdk}`);
  console.log(`金额差异=${mismatch!.diff?.amountDiff}元，次数差异=${mismatch!.diff?.callCountDiff}次`);

  console.log('\n--- 测试40: 报表导出 JSON + CSV ---');
  const testReport = await prodSdk.generateUsageReport({
    startTime: 0,
    endTime: Date.now(),
    includePeriodDetails: true,
    includeRejectionStats: true
  });

  const jsonResult = prodSdk.exportReport(testReport, {
    format: 'JSON',
    prettyPrint: false
  });
  assert(jsonResult.success === true, 'JSON导出成功');
  assert(jsonResult.content !== undefined, 'JSON内容存在');
  const parsed = JSON.parse(jsonResult.content!);
  assert(parsed.report !== undefined, '包含report');
  assert(parsed.report.summary.totalCalls >= 5, 'report摘要正确');

  const csvResult = prodSdk.exportReport(testReport, {
    format: 'CSV'
  });
  assert(csvResult.success === true, 'CSV导出成功');
  assert(csvResult.content !== undefined, 'CSV内容存在');
  assert(csvResult.content!.includes('用量汇总报表'), '包含用量汇总报表标题');
  assert(csvResult.content!.includes('维度,维度值'), '包含CSV表头');

  console.log('JSON和CSV导出正常');

  console.log('\n--- 测试41: 对账引擎 - 拒绝事件匹配 + 账单重复 ---');
  await reconSdk.validate({
    credentialId: rcId,
    productId: 'PROD-R1',
    sceneId: 'SCENE-R1',
    callerIdentity: consumer
  });
  const rejections = await reconSdk.listRejectionEvents();
  const lastRej = rejections[rejections.length - 1];

  const billsWithReject = [
    {
      billId: 'BILL-R004',
      timestamp: lastRej.timestamp,
      credentialId: rcId,
      providerId: provider.id,
      consumerId: consumer.id,
      productId: 'PROD-R1',
      sceneId: 'SCENE-R1',
      callCount: 1,
      unitPrice,
      totalAmount: 0,
      status: 'REJECTED' as const,
      errorCode: String(lastRej.errorCode)
    },
    {
      billId: 'BILL-R004',
      timestamp: lastRej.timestamp,
      credentialId: rcId,
      providerId: provider.id,
      consumerId: consumer.id,
      productId: 'PROD-R1',
      sceneId: 'SCENE-R1',
      callCount: 1,
      status: 'REJECTED' as const
    }
  ];

  const recon2 = await reconSdk.reconcile(billsWithReject, {
    endTime: Date.now() + 60000
  });
  assert(recon2.summary.matched === 1, '拒绝事件匹配=1');
  assert(recon2.summary.duplicate === 1, '账单重复=1');
  console.log(`拒绝事件匹配+账单重复测试通过: 匹配${recon2.summary.matched}, 重复${recon2.summary.duplicate}`);

  console.log('\n--- 测试42: 清理测试数据 ---');
  cleanup();
  assert(!fs.existsSync(testStorageDir), '测试数据已清理');

  console.log('\n========== 全部测试通过 ==========\n');
})();
