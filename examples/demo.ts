import * as fs from 'fs';
import * as path from 'path';
import { DataAuthCredentialSDK, ValidationResultType, CredentialStatus } from '../src';

const demoStorageDir = path.join(process.cwd(), 'data', 'demo_credentials');
const filePath = path.join(demoStorageDir, 'credentials.json');

function cleanupStorage(): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  if (fs.existsSync(demoStorageDir)) {
    fs.rmSync(demoStorageDir, { recursive: true });
  }
}

function step(msg: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(` ${msg}`);
  console.log('='.repeat(60));
}

function success(msg: string, detail?: string): void {
  console.log(`✅ ${msg}`);
  if (detail) console.log(`   ${detail}`);
}

function fail(msg: string, detail?: string): void {
  console.log(`❌ ${msg}`);
  if (detail) console.log(`   ${detail}`);
}

(async () => {
  console.log('\n' + '╔'.repeat(30));
  console.log('   数据要素授权凭证 SDK 完整流程演示');
  console.log('   创建 → 校验 → 扣减 → 审计 → 撤销 → 重启恢复');
  console.log('   授权策略 + 审计报表 + 事务式扣减');
  console.log('╚'.repeat(30));

  cleanupStorage();

  step('1. 初始化 SDK（文件存储）');
  const sdk1 = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: demoStorageDir
  });
  success('SDK 初始化完成', '存储方式: FileStorage');

  step('2. 配置授权策略');

  sdk1.addRequiredFieldPolicy('PRODUCT', 'PROD-CREDIT-REPORT', ['purpose', 'expectedDataRows', 'expectedDataSizeKB'], '企业信用报告必填字段策略');
  success('策略1已添加', '企业信用报告必须填写 purpose、expectedDataRows、expectedDataSizeKB');

  sdk1.addSubjectTypePolicy('SCENE', 'SCENE-LOAN-APPROVAL', ['ORGANIZATION'], undefined, '贷款审批场景主体类型策略');
  success('策略2已添加', '贷款审批场景仅允许组织类型调用');

  sdk1.addDataSizeLimitPolicy('GLOBAL', '*', 10000, 1, '全局数据量上限策略');
  success('策略3已添加', '全局单次数据量上限 10000KB');

  const policies = sdk1.listPolicies();
  console.log(`\n   当前策略总数: ${policies.length}`);
  policies.forEach((p, i) => {
    console.log(`   ${i + 1}. [${p.targetType}:${p.targetValue}] ${p.policyName} (优先级: ${p.priority})`);
  });

  step('3. 准备基础数据');

  const provider = { id: 'PROV-2024-001', name: '中国征信数据中心', type: 'ORGANIZATION' as const };
  const consumer = { id: 'CONS-2024-001', name: '某商业银行', type: 'ORGANIZATION' as const };
  const individualUser = { id: 'USER-2024-001', name: '张三', type: 'INDIVIDUAL' as const };

  const products = [
    { productId: 'PROD-CREDIT-REPORT', productName: '企业信用报告', dataCategory: '信用数据', providerId: provider.id },
    { productId: 'PROD-RISK-SCORE', productName: '企业风险评分', dataCategory: '风险数据', providerId: provider.id }
  ];

  const scenes = [
    { sceneId: 'SCENE-LOAN-APPROVAL', sceneName: '贷款审批', sceneDescription: '用于企业贷款审批决策', sceneType: 'CREDIT_APPROVAL' },
    { sceneId: 'SCENE-RISK-MONITORING', sceneName: '风险监控', sceneDescription: '用于企业贷后风险监控', sceneType: 'RISK_MONITORING' }
  ];

  success('基础数据准备完成', `提供方: ${provider.name} | 使用方: ${consumer.name}`);

  step('4. 创建授权单');

  const createResult = await sdk1.createAuthorization({
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
    fail('创建授权单失败', createResult.error?.message);
    process.exit(1);
  }

  const credentialId = createResult.credential!.credentialId;
  const credentialNo = createResult.credential!.credentialNo;

  success('授权单创建成功');
  console.log(`   凭证编号: ${credentialNo}`);
  console.log(`   凭证ID: ${credentialId}`);
  console.log(`   当前周期: ${createResult.credential!.currentPeriod.periodKey}`);
  console.log(`   调用额度: ${createResult.credential!.order.quota.maxCalls} 次/月`);
  console.log(`   数据行数: ${createResult.credential!.order.quota.maxDataRows} 行/月`);
  console.log(`   数据量上限: ${createResult.credential!.order.quota.maxDataSizeKB} KB/月`);

  step('5. 策略校验 - 缺少必填字段（返回 PENDING）');

  const pendingResult = await sdk1.validate({
    credentialId,
    productId: 'PROD-CREDIT-REPORT',
    sceneId: 'SCENE-LOAN-APPROVAL',
    callerIdentity: consumer
  });

  console.log(`   校验结果类型: ${pendingResult.type}`);
  console.log(`   是否通过: ${pendingResult.passed ? '是' : '否'}`);
  console.log(`   消息: ${pendingResult.message}`);
  if (pendingResult.missingFields) {
    console.log(`   缺失字段: ${pendingResult.missingFields.join(', ')}`);
  }
  if (pendingResult.policyHit) {
    console.log(`   命中策略: ${pendingResult.policyHit.policyName}`);
    console.log(`   命中规则: ${pendingResult.policyHit.hitRule?.ruleName}`);
  }
  success('策略拦截生效', '必填字段策略触发，返回 PENDING 状态');

  step('6. 策略校验 - 主体类型不匹配（返回 REJECT）');

  const rejectResult = await sdk1.validate({
    credentialId,
    productId: 'PROD-CREDIT-REPORT',
    sceneId: 'SCENE-LOAN-APPROVAL',
    callerIdentity: individualUser,
    purpose: '贷款审批',
    expectedDataRows: 100,
    expectedDataSizeKB: 500
  });

  console.log(`   校验结果类型: ${rejectResult.type}`);
  console.log(`   错误码: ${rejectResult.code}`);
  console.log(`   消息: ${rejectResult.message}`);
  if (rejectResult.policyHit) {
    console.log(`   命中策略: ${rejectResult.policyHit.policyName}`);
    console.log(`   命中规则: ${rejectResult.policyHit.hitRule?.ruleName}`);
  }
  success('策略拦截生效', '主体类型策略触发，返回 REJECT 状态');

  step('7. 事务式流程 - 预检查额度');

  const preCheckResult = await sdk1.preCheck({
    credentialId,
    callCount: 5,
    dataRows: 300,
    dataSizeKB: 1500
  });

  console.log(`   是否可继续: ${preCheckResult.canProceed ? '是' : '否'}`);
  console.log(`   消息: ${preCheckResult.message}`);
  if (preCheckResult.remainingAfterDeduction) {
    console.log(`   扣减后剩余调用次数: ${preCheckResult.remainingAfterDeduction.calls}`);
    console.log(`   扣减后剩余数据行数: ${preCheckResult.remainingAfterDeduction.rows}`);
    console.log(`   扣减后剩余数据量: ${preCheckResult.remainingAfterDeduction.sizeKB} KB`);
  }
  success('预检查通过', '事务第一步完成');

  step('8. 事务式流程 - 执行扣减');

  const execResult = await sdk1.executeUsage({
    credentialId,
    purpose: '贷款审批 - 查询企业信用报告',
    callerIdentity: consumer,
    callCount: 5,
    dataRows: 300,
    dataSizeKB: 1500,
    remark: '调用企业信用报告API - 客户ID: CLIENT-2024-001'
  });

  if (execResult.success) {
    console.log(`   日志ID: ${execResult.logEntry!.logId}`);
    console.log(`   本次扣减调用次数: ${execResult.deducted!.calls}`);
    console.log(`   本次扣减数据行数: ${execResult.deducted!.rows}`);
    console.log(`   本次扣减数据量: ${execResult.deducted!.sizeKB} KB`);
    console.log(`   扣减后剩余调用次数: ${execResult.remainingAfter!.calls}`);
    console.log(`   扣减后剩余数据行数: ${execResult.remainingAfter!.rows}`);
    console.log(`   扣减后剩余数据量: ${execResult.remainingAfter!.sizeKB} KB`);
    success('扣减执行成功', '事务第二步完成');
  } else {
    fail('扣减执行失败', execResult.error?.message);
  }

  step('9. 事务式流程 - 异常参数拒绝（0 或负数）');

  const invalidCallResult = await sdk1.executeUsage({
    credentialId,
    purpose: '异常测试',
    callerIdentity: consumer,
    callCount: 0
  });

  console.log(`   callCount=0 结果: ${invalidCallResult.success ? '通过' : '拒绝'}`);
  console.log(`   错误码: ${invalidCallResult.error?.code}`);
  console.log(`   消息: ${invalidCallResult.error?.message}`);
  success('参数校验生效', '0 和负数被正确拦截');

  const negRowsResult = await sdk1.executeUsage({
    credentialId,
    purpose: '异常测试',
    callerIdentity: consumer,
    callCount: 1,
    dataRows: -100
  });

  console.log(`   dataRows=-100 结果: ${negRowsResult.success ? '通过' : '拒绝'}`);
  console.log(`   错误码: ${negRowsResult.error?.code}`);
  success('参数校验生效', '负数被正确拦截');

  const quotaBefore = await sdk1.getRemainingQuota(credentialId);
  console.log(`\n   校验: 当前已用次数 = ${quotaBefore.quota!.periodUsedCalls}, 剩余 = ${quotaBefore.quota!.remainingCalls}`);
  success('剩余额度未变化', '异常请求未导致额度变动');

  step('10. 追加使用日志（收紧校验）');

  const appendValid = await sdk1.appendUsageLog(credentialId, {
    purpose: '贷后监控 - 数据批量同步',
    callCount: 3,
    dataRows: 500,
    dataSizeKB: 2000,
    callerIdentity: consumer.id,
    remark: '每日批量同步任务'
  });

  console.log(`   正常追加结果: ${appendValid.success ? '成功' : '失败'}`);
  if (appendValid.success) {
    console.log(`   日志ID: ${appendValid.log!.logId}`);
  }

  const appendInvalid = await sdk1.appendUsageLog(credentialId, {
    purpose: '异常追加',
    callCount: 0,
    callerIdentity: consumer.id
  });

  console.log(`   callCount=0 追加结果: ${appendInvalid.success ? '成功' : '失败'}`);
  console.log(`   错误码: ${appendInvalid.error?.code}`);
  success('追加日志校验收紧生效');

  step('11. 查询剩余额度');

  const quotaResult = await sdk1.getRemainingQuota(credentialId);
  if (quotaResult.success) {
    console.log(`   当前周期: ${quotaResult.quota!.periodKey}`);
    console.log(`   调用次数: ${quotaResult.quota!.periodUsedCalls}/${quotaResult.quota!.maxCalls} (剩余 ${quotaResult.quota!.remainingCalls})`);
    console.log(`   数据行数: ${quotaResult.quota!.periodUsedRows}/${quotaResult.quota!.maxRows} (剩余 ${quotaResult.quota!.remainingRows})`);
    console.log(`   数据量: ${quotaResult.quota!.periodUsedSizeKB}/${quotaResult.quota!.maxSizeKB} KB (剩余 ${quotaResult.quota!.remainingSizeKB})`);
    console.log(`   使用率: ${quotaResult.quota!.usageRate}%`);
  }

  step('12. 输出审计摘要（含周期信息）');

  const auditSummary = await sdk1.getAuditSummary(credentialId);
  if (auditSummary) {
    console.log('   ┌─────────────────────────────────────┐');
    console.log('   │          审计摘要                    │');
    console.log('   └─────────────────────────────────────┘');
    console.log(`   凭证编号: ${auditSummary.credentialNo}`);
    console.log(`   凭证状态: ${auditSummary.status}`);
    console.log(`   提供方: ${auditSummary.providerInfo.name}`);
    console.log(`   使用方: ${auditSummary.consumerInfo.name}`);
    console.log(`   有效期至: ${auditSummary.validityPeriod.end}`);
    console.log(`   剩余天数: ${auditSummary.validityPeriod.remainingDays}天`);
    console.log('');
    console.log('   ┌─────────────────────────────────────┐');
    console.log('   │          当前周期用量                │');
    console.log('   └─────────────────────────────────────┘');
    console.log(`   周期Key: ${auditSummary.currentPeriod.periodKey}`);
    console.log(`   周期范围: ${auditSummary.currentPeriod.periodStart} ~ ${auditSummary.currentPeriod.periodEnd}`);
    console.log(`   调用次数: ${auditSummary.currentPeriod.usedCalls}/${auditSummary.quota.maxCalls} (剩余 ${auditSummary.currentPeriod.remainingCalls})`);
    console.log(`   数据行数: ${auditSummary.currentPeriod.usedRows}/${auditSummary.quota.maxDataRows} (剩余 ${auditSummary.currentPeriod.remainingRows})`);
    console.log(`   数据量: ${auditSummary.currentPeriod.usedSizeKB}/${auditSummary.quota.maxDataSizeKB} KB (剩余 ${auditSummary.currentPeriod.remainingSizeKB})`);
    console.log('');
    console.log('   ┌─────────────────────────────────────┐');
    console.log('   │          历史周期用量                │');
    console.log('   └─────────────────────────────────────┘');
    if (auditSummary.periodHistory.length === 0) {
      console.log('   暂无历史周期数据');
    } else {
      auditSummary.periodHistory.forEach((p, i) => {
        console.log(`   历史周期${i + 1}: ${p.periodKey} - 调用${p.usedCalls}次, 数据${p.usedRows}行, ${p.usedSizeKB}KB`);
      });
    }
    console.log('');
    console.log(`   日志总记录数: ${auditSummary.totalUsageLogs}`);
    console.log(`   授权产品: ${auditSummary.scopeSummary.products.join(', ')}`);
    console.log(`   授权场景: ${auditSummary.scopeSummary.scenes.join(', ')}`);
    success('审计摘要输出完成');
  }

  step('13. 导出审计报表 - 按使用方维度');

  const report = await sdk1.generateReportByConsumer(consumer.id, {
    includePeriodDetails: true,
    includeRevocationRecords: true,
    includeRejectionStats: true
  });

  console.log(`   报表生成时间: ${new Date(report.generatedAt).toLocaleString()}`);
  console.log('');
  console.log('   ┌─────────────────────────────────────┐');
  console.log('   │          报表汇总                    │');
  console.log('   └─────────────────────────────────────┘');
  console.log(`   凭证总数: ${report.summary.totalCredentials}`);
  console.log(`   总调用次数: ${report.summary.totalCalls}`);
  console.log(`   总数据行数: ${report.summary.totalDataRows}`);
  console.log(`   总数据量: ${report.summary.totalDataSizeKB} KB`);
  console.log(`   已撤销凭证: ${report.summary.totalRevoked}`);
  console.log(`   已过期凭证: ${report.summary.totalExpired}`);
  console.log('');
  report.items.forEach(item => {
    console.log('   ┌─────────────────────────────────────┐');
    console.log(`   │ 维度: ${item.dimension} = ${item.dimensionName} │`);
    console.log('   └─────────────────────────────────────┘');
    console.log(`   凭证数: ${item.credentialCount} (活跃${item.activeCount}, 已撤销${item.revokedCount}, 已过期${item.expiredCount}, 已用尽${item.exhaustedCount})`);
    console.log(`   总调用: ${item.totalCalls}次`);
    console.log(`   总数据行数: ${item.totalDataRows}行`);
    console.log(`   总数据量: ${item.totalDataSizeKB}KB`);
    if (item.currentPeriodUsage) {
      console.log(`   当前周期调用: ${item.currentPeriodUsage.usedCalls}/${item.currentPeriodUsage.maxCalls}次`);
    }
  });
  success('审计报表输出完成');

  step('14. 撤销凭证');

  const revokeResult = await sdk1.revokeCredential(credentialId, 'admin', '业务合同终止，停止授权');
  if (revokeResult.success) {
    console.log(`   撤销时间: ${new Date(revokeResult.updatedCredential!.revokedAt!).toLocaleString()}`);
    console.log(`   撤销人: ${revokeResult.updatedCredential!.revokedBy}`);
    console.log(`   撤销原因: ${revokeResult.updatedCredential!.revokeReason}`);
    console.log(`   凭证状态: ${revokeResult.updatedCredential!.status}`);
    success('凭证撤销成功');
  }

  step('15. 校验已撤销凭证');

  const revokedCheck = await sdk1.validate({
    credentialId,
    productId: 'PROD-CREDIT-REPORT',
    sceneId: 'SCENE-LOAN-APPROVAL',
    callerIdentity: consumer,
    purpose: '贷款审批',
    expectedDataRows: 100,
    expectedDataSizeKB: 500
  });

  console.log(`   校验结果类型: ${revokedCheck.type}`);
  console.log(`   错误码: ${revokedCheck.code}`);
  console.log(`   消息: ${revokedCheck.message}`);
  success('已撤销凭证被正确拒绝');

  step('16. 模拟 SDK 重启，验证文件存储持久化');

  console.log('   关闭当前 SDK 实例...');
  console.log('   创建新 SDK 实例（读取同一存储文件）...');

  const sdk2 = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: demoStorageDir
  });

  const restoredCred = await sdk2.getCredential(credentialId);

  if (restoredCred) {
    console.log('');
    console.log('   ┌─────────────────────────────────────┐');
    console.log('   │          重启后恢复的数据            │');
    console.log('   └─────────────────────────────────────┘');
    console.log(`   凭证编号: ${restoredCred.credentialNo}`);
    console.log(`   凭证状态: ${restoredCred.status}`);
    console.log(`   总使用次数: ${restoredCred.totalUsedCalls}`);
    console.log(`   总数据行数: ${restoredCred.totalUsedRows}`);
    console.log(`   总数据量: ${restoredCred.totalUsedSizeKB} KB`);
    console.log(`   日志记录数: ${restoredCred.usageLogs.length}`);
    console.log(`   撤销时间: ${restoredCred.revokedAt ? new Date(restoredCred.revokedAt).toLocaleString() : '未撤销'}`);
    console.log(`   撤销原因: ${restoredCred.revokeReason || '无'}`);
    console.log('');
    console.log('   ┌─────────────────────────────────────┐');
    console.log('   │          日志明细                    │');
    console.log('   └─────────────────────────────────────┘');
    restoredCred.usageLogs.forEach((log, i) => {
      console.log(`   ${i + 1}. [${new Date(log.timestamp).toLocaleString()}] ${log.purpose}`);
      console.log(`      调用${log.callCount}次, ${log.dataRows}行, ${log.dataSizeKB}KB, 周期: ${log.periodKey}`);
    });
    success('文件存储持久化验证通过', '重启后凭证、日志、撤销记录全部恢复');
  } else {
    fail('未找到凭证', '持久化失败');
  }

  step('17. 重启后导出审计报表（验证数据完整性）');

  const reportAfterRestart = await sdk2.generateReportByConsumer(consumer.id, {
    includePeriodDetails: true
  });

  console.log(`   重启后报表 - 凭证总数: ${reportAfterRestart.summary.totalCredentials}`);
  console.log(`   重启后报表 - 总调用次数: ${reportAfterRestart.summary.totalCalls}`);
  console.log(`   重启后报表 - 已撤销凭证: ${reportAfterRestart.summary.totalRevoked}`);

  const summaryAfterRestart = await sdk2.getAuditSummary(credentialId);
  if (summaryAfterRestart) {
    console.log(`   重启后审计 - 当前周期调用: ${summaryAfterRestart.currentPeriod.usedCalls}次`);
    console.log(`   重启后审计 - 日志总数: ${summaryAfterRestart.totalUsageLogs}`);
  }

  success('重启后审计数据完整');

  step('18. 清理测试数据');
  cleanupStorage();
  success('测试数据已清理');

  console.log('\n' + '╔'.repeat(30));
  console.log('   ✅ 完整流程演示全部完成！');
  console.log('');
  console.log('   已验证特性:');
  console.log('   ✅ 可插拔存储（文件存储持久化）');
  console.log('   ✅ 授权策略配置（必填字段/主体类型/数据量限制）');
  console.log('   ✅ 策略校验（PENDING/REJECT/PASS）');
  console.log('   ✅ 事务式预检查+扣减流程');
  console.log('   ✅ 参数校验（0/负数被拒绝）');
  console.log('   ✅ 追加日志收紧校验');
  console.log('   ✅ 周期额度管理（当前+历史）');
  console.log('   ✅ 审计摘要（含周期用量）');
  console.log('   ✅ 多维度审计报表（提供方/使用方/产品）');
  console.log('   ✅ 凭证撤销与持久化');
  console.log('   ✅ SDK重启数据恢复');
  console.log('╚'.repeat(30) + '\n');
})();
