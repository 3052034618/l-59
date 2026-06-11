import { DataAuthCredentialSDK, ValidationResultType, CredentialStatus } from '../src';

console.log('\n========== 数据要素授权凭证 SDK 使用示例 ==========\n');

const sdk = new DataAuthCredentialSDK();

console.log('第一步：准备基础数据\n');

const provider = {
  id: 'PROV-2024-001',
  name: '中国征信数据中心',
  type: 'ORGANIZATION' as const
};

const consumer = {
  id: 'CONS-2024-001',
  name: '某商业银行',
  type: 'ORGANIZATION' as const
};

const products = [
  {
    productId: 'PROD-CREDIT-REPORT',
    productName: '企业信用报告',
    dataCategory: '信用数据',
    providerId: provider.id
  },
  {
    productId: 'PROD-RISK-SCORE',
    productName: '企业风险评分',
    dataCategory: '风险数据',
    providerId: provider.id
  }
];

const scenes = [
  {
    sceneId: 'SCENE-LOAN-APPROVAL',
    sceneName: '贷款审批',
    sceneDescription: '用于企业贷款审批决策',
    sceneType: 'CREDIT_APPROVAL'
  },
  {
    sceneId: 'SCENE-RISK-MONITORING',
    sceneName: '风险监控',
    sceneDescription: '用于企业贷后风险监控',
    sceneType: 'RISK_MONITORING'
  }
];

console.log('第二步：创建授权单\n');

const createResult = sdk.createAuthorization({
  provider,
  consumer,
  scope: {
    products,
    scenes,
    allowedPurposes: ['贷款审批', '风险评估', '信用分析', '贷后监控']
  },
  quota: {
    maxCalls: 500,
    maxDataRows: 50000,
    maxDataSizeKB: 200000,
    periodType: 'MONTHLY'
  },
  validity: {
    startTime: Date.now(),
    endTime: Date.now() + 90 * 24 * 60 * 60 * 1000
  },
  purpose: '企业信贷业务审批及贷后风险管理',
  createdBy: 'system-admin'
});

if (!createResult.success) {
  console.error('创建授权单失败:', createResult.error);
  process.exit(1);
}

const credentialId = createResult.credential!.credentialId;

console.log('✅ 授权单创建成功！');
console.log(`   凭证编号: ${createResult.credential!.credentialNo}`);
console.log(`   凭证ID: ${credentialId}`);
console.log(`   授权产品: ${products.map(p => p.productName).join(', ')}`);
console.log(`   使用场景: ${scenes.map(s => s.sceneName).join(', ')}`);
console.log(`   调用额度: 500次`);
console.log(`   有效期: 90天\n`);

console.log('第三步：产品调用前校验凭证\n');

const validationResult = sdk.validate({
  credentialId,
  productId: 'PROD-CREDIT-REPORT',
  sceneId: 'SCENE-LOAN-APPROVAL',
  callerIdentity: consumer,
  purpose: '贷款审批',
  expectedDataRows: 100,
  expectedDataSizeKB: 500
});

console.log(`校验结果类型: ${validationResult.type}`);
console.log(`是否通过: ${validationResult.passed ? '是' : '否'}`);
console.log(`消息: ${validationResult.message}`);

if (validationResult.type === ValidationResultType.PASS) {
  console.log('\n第四步：凭证校验通过，执行产品调用并记录使用\n');

  const usageResult = sdk.recordUsage(
    credentialId,
    '贷款审批 - 查询企业信用报告',
    consumer,
    1,
    100,
    500,
    '调用企业信用报告API - 客户ID: CLIENT-2024-001'
  );

  if (usageResult.success) {
    console.log('✅ 使用记录已记录');
    console.log(`   日志ID: ${usageResult.logEntry!.logId}`);
  }

  console.log('\n第五步：查询剩余额度\n');

  const remainingQuota = sdk.getRemainingQuota(credentialId);
  if (remainingQuota.success) {
    console.log(`剩余调用次数: ${remainingQuota.quota!.remainingCalls}/${remainingQuota.quota!.maxCalls}`);
    console.log(`剩余数据行数: ${remainingQuota.quota!.remainingRows}/${remainingQuota.quota!.maxRows}`);
    console.log(`剩余数据量: ${remainingQuota.quota!.remainingSizeKB}KB/${remainingQuota.quota!.maxSizeKB}KB`);
    console.log(`使用率: ${remainingQuota.quota!.usageRate}%`);
  }

  console.log('\n第六步：输出审计摘要\n');

  const auditSummary = sdk.getAuditSummary(credentialId);
  if (auditSummary) {
    console.log('=== 审计摘要 ===');
    console.log(`凭证编号: ${auditSummary.credentialNo}`);
    console.log(`凭证状态: ${auditSummary.status}`);
    console.log(`提供方: ${auditSummary.providerInfo.name}`);
    console.log(`使用方: ${auditSummary.consumerInfo.name}`);
    console.log(`有效期至: ${auditSummary.validityPeriod.end}`);
    console.log(`剩余天数: ${auditSummary.validityPeriod.remainingDays}天`);
    console.log(`调用次数: ${auditSummary.quota.usedCalls}/${auditSummary.quota.maxCalls}`);
    console.log(`使用率: ${auditSummary.quota.usageRate}%`);
    console.log(`日志记录数: ${auditSummary.totalUsageLogs}`);
    console.log(`授权产品: ${auditSummary.scopeSummary.products.join(', ')}`);
    console.log(`授权场景: ${auditSummary.scopeSummary.scenes.join(', ')}`);
    console.log(`允许用途: ${auditSummary.scopeSummary.purposes.join(', ')}`);
  }
}

console.log('\n第七步：模拟异常场景校验\n');

const invalidSceneResult = sdk.validate({
  credentialId,
  productId: 'PROD-CREDIT-REPORT',
  sceneId: 'SCENE-INVALID',
  callerIdentity: consumer,
  purpose: '贷款审批'
});

console.log(`❌ 无效场景校验结果: ${invalidSceneResult.message}`);

const invalidIdentityResult = sdk.validate({
  credentialId,
  productId: 'PROD-CREDIT-REPORT',
  sceneId: 'SCENE-LOAN-APPROVAL',
  callerIdentity: { id: 'HACKER-001', name: '非法用户', type: 'ORGANIZATION' },
  purpose: '贷款审批'
});

console.log(`❌ 非法身份校验结果: ${invalidIdentityResult.message}`);

console.log('\n第八步：比对主体身份\n');

const identityCheck = sdk.verifyIdentity(credentialId, consumer);
console.log(`用户 ${consumer.name} 的角色: ${identityCheck.verification!.matchedRole}`);

const providerCheck = sdk.verifyIdentity(credentialId, provider);
console.log(`用户 ${provider.name} 的角色: ${providerCheck.verification!.matchedRole}`);

console.log('\n第九步：检查有效期限\n');

const validityCheck = sdk.checkValidity(credentialId);
if (validityCheck.success) {
  console.log(`凭证是否有效: ${validityCheck.validity!.isValid ? '是' : '否'}`);
  console.log(`生效时间: ${validityCheck.validity!.startTime}`);
  console.log(`到期时间: ${validityCheck.validity!.endTime}`);
  console.log(`剩余天数: ${validityCheck.validity!.remainingDays}天`);
  console.log(`是否过期: ${validityCheck.validity!.isExpired ? '是' : '否'}`);
}

console.log('\n第十步：撤销凭证（可选操作）\n');

const revokeConfirm = false;
if (revokeConfirm) {
  const revokeResult = sdk.revokeCredential(credentialId, 'admin', '业务合同终止');
  if (revokeResult.success) {
    console.log(`✅ 凭证已撤销，原因: ${revokeResult.updatedCredential!.revokeReason}`);
  }
} else {
  console.log('⏭️ 跳过撤销操作（示例演示）');
}

console.log('\n========== 示例执行完毕 ==========\n');
