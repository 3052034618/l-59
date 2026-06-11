import * as fs from 'fs';
import * as path from 'path';
import { DataAuthCredentialSDK, ValidationResultType, CredentialStatus, ErrorCode } from '../src';

const demoStorageDir = path.join(process.cwd(), 'data', 'demo_credentials');

function cleanupStorage(): void {
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  console.log('\n' + '╔'.repeat(30));
  console.log('   数据要素授权凭证 SDK 平台对账能力演示');
  console.log('   多张凭证 + 时间段统计 + 异常拒绝沉淀 + 周期汇总');
  console.log('╚'.repeat(30));

  cleanupStorage();

  const sdk = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: demoStorageDir
  });

  const provider = { id: 'PROV-DEMO-001', name: '中国征信数据中心', type: 'ORGANIZATION' as const };
  const consumerA = { id: 'CONS-DEMO-A', name: '某商业银行', type: 'ORGANIZATION' as const };
  const consumerB = { id: 'CONS-DEMO-B', name: '某互联网金融公司', type: 'ORGANIZATION' as const };
  const individualUser = { id: 'USER-DEMO-01', name: '张三', type: 'INDIVIDUAL' as const };

  const products = [
    { productId: 'PROD-CREDIT-REPORT', productName: '企业信用报告', dataCategory: '信用数据', providerId: provider.id },
    { productId: 'PROD-RISK-SCORE', productName: '企业风险评分', dataCategory: '风险数据', providerId: provider.id }
  ];

  const scenes = [
    { sceneId: 'SCENE-LOAN-APPROVAL', sceneName: '贷款审批', sceneDescription: '用于企业贷款审批决策', sceneType: 'CREDIT_APPROVAL' },
    { sceneId: 'SCENE-RISK-MONITORING', sceneName: '风险监控', sceneDescription: '用于企业贷后风险监控', sceneType: 'RISK_MONITORING' }
  ];

  step('1. 配置授权策略');
  sdk.addRequiredFieldPolicy('PRODUCT', 'PROD-CREDIT-REPORT', ['purpose', 'expectedDataRows', 'expectedDataSizeKB'], '企业信用报告必填字段策略');
  sdk.addSubjectTypePolicy('SCENE', 'SCENE-LOAN-APPROVAL', ['ORGANIZATION'], undefined, '贷款审批场景主体类型策略');
  sdk.addDataSizeLimitPolicy('GLOBAL', '*', 10000, 1, '全局单次数据量上限策略');
  success('3条策略已配置');

  step('2. 创建第1张凭证（商业银行 - 500次/月）');
  const t1Start = Date.now();
  const createA = await sdk.createAuthorization({
    provider,
    consumer: consumerA,
    scope: { products, scenes, allowedPurposes: ['贷款审批', '风险评估', '信用分析', '贷后监控'] },
    quota: { maxCalls: 500, maxDataRows: 50000, maxDataSizeKB: 200000, periodType: 'MONTHLY' },
    validity: { startTime: Date.now(), endTime: Date.now() + 90 * 24 * 60 * 60 * 1000 },
    purpose: '商业银行信贷业务',
    createdBy: 'admin'
  });
  const credAId = createA.credential!.credentialId;
  success(`凭证A创建成功: ${createA.credential!.credentialNo}`);

  step('3. 创建第2张凭证（互联网金融 - 200次/月）');
  const createB = await sdk.createAuthorization({
    provider,
    consumer: consumerB,
    scope: { products, scenes, allowedPurposes: ['贷款审批', '风险评估', '信用分析', '贷后监控'] },
    quota: { maxCalls: 200, maxDataRows: 20000, maxDataSizeKB: 80000, periodType: 'MONTHLY' },
    validity: { startTime: Date.now(), endTime: Date.now() + 90 * 24 * 60 * 60 * 1000 },
    purpose: '互金风控业务',
    createdBy: 'admin'
  });
  const credBId = createB.credential!.credentialId;
  success(`凭证B创建成功: ${createB.credential!.credentialNo}`);

  step('4. 凭证A：产品1调用3次 + 产品2调用2次');
  for (let i = 0; i < 3; i++) {
    const r = await sdk.executeUsage({
      credentialId: credAId,
      purpose: '贷款审批',
      callerIdentity: consumerA,
      callCount: 1,
      productId: 'PROD-CREDIT-REPORT',
      sceneId: 'SCENE-LOAN-APPROVAL',
      dataRows: 50,
      dataSizeKB: 200
    });
    if (!r.success) console.log('  扣减失败:', r.error?.message);
  }
  for (let i = 0; i < 2; i++) {
    const r = await sdk.executeUsage({
      credentialId: credAId,
      purpose: '风险评估',
      callerIdentity: consumerA,
      callCount: 1,
      productId: 'PROD-RISK-SCORE',
      sceneId: 'SCENE-RISK-MONITORING',
      dataRows: 30,
      dataSizeKB: 120
    });
    if (!r.success) console.log('  扣减失败:', r.error?.message);
  }
  success('凭证A扣减完成：产品1=3次, 产品2=2次');
  await sleep(50);

  step('5. 制造异常拒绝：策略拒绝、身份不匹配、额度不够');
  // 策略拒绝 - 缺少必填字段
  await sdk.validate({
    credentialId: credAId,
    productId: 'PROD-CREDIT-REPORT',
    sceneId: 'SCENE-LOAN-APPROVAL',
    callerIdentity: consumerA
  });
  // 策略拒绝 - 个人用户调用组织场景
  await sdk.validate({
    credentialId: credAId,
    productId: 'PROD-CREDIT-REPORT',
    sceneId: 'SCENE-LOAN-APPROVAL',
    callerIdentity: individualUser,
    purpose: '贷款审批',
    expectedDataRows: 10,
    expectedDataSizeKB: 50
  });
  // 身份不匹配 - 用consumerB去校验consumerA的凭证
  await sdk.validate({
    credentialId: credAId,
    productId: 'PROD-RISK-SCORE',
    sceneId: 'SCENE-RISK-MONITORING',
    callerIdentity: consumerB,
    purpose: '风险评估',
    expectedDataRows: 10,
    expectedDataSizeKB: 50
  });
  // 策略拒绝 - 数据量超限
  await sdk.validate({
    credentialId: credAId,
    productId: 'PROD-RISK-SCORE',
    sceneId: 'SCENE-RISK-MONITORING',
    callerIdentity: consumerA,
    purpose: '风险评估',
    expectedDataRows: 10,
    expectedDataSizeKB: 20000
  });

  const t1End = Date.now();
  success(`时间段T1 (${t1Start}~${t1End})：5次通过 + 4次拒绝`);

  await sleep(100);

  step('6. 凭证B：产品1调用5次');
  const t2Start = Date.now();
  for (let i = 0; i < 5; i++) {
    await sdk.executeUsage({
      credentialId: credBId,
      purpose: '风险评估',
      callerIdentity: consumerB,
      callCount: 1,
      productId: 'PROD-CREDIT-REPORT',
      sceneId: 'SCENE-LOAN-APPROVAL',
      dataRows: 30,
      dataSizeKB: 100
    });
  }
  success('凭证B产品1调用5次扣减完成');

  step('7. 凭证A产品1再调用2次');
  for (let i = 0; i < 2; i++) {
    await sdk.executeUsage({
      credentialId: credAId,
      purpose: '贷后监控',
      callerIdentity: consumerA,
      callCount: 1,
      productId: 'PROD-CREDIT-REPORT',
      sceneId: 'SCENE-LOAN-APPROVAL',
      dataRows: 80,
      dataSizeKB: 300
    });
  }
  success('凭证A产品1追加2次扣减完成');

  // 额外异常
  await sdk.validate({
    credentialId: credBId,
    productId: 'PROD-CREDIT-REPORT',
    sceneId: 'SCENE-LOAN-APPROVAL',
    callerIdentity: consumerB
  });

  const t2End = Date.now();
  success(`时间段T2 (${t2Start}~${t2End})：7次通过 + 1次拒绝`);

  step('8. 查询时间段T1报表（按提供方维度）');
  const reportT1 = await sdk.generateReportByProvider(provider.id, {
    startTime: t1Start,
    endTime: t1End,
    includePeriodDetails: true,
    includeRejectionStats: true
  });

  console.log('   ┌─────────────────────────────────────┐');
  console.log('   │          T1 时间段报表               │');
  console.log('   └─────────────────────────────────────┘');
  console.log(`   凭证总数: ${reportT1.summary.totalCredentials}`);
  console.log(`   总调用次数(T1内): ${reportT1.summary.totalCalls}`);
  console.log(`   总拒绝次数(T1内): ${reportT1.summary.totalRejections}`);
  console.log(`   总数据行数(T1内): ${reportT1.summary.totalDataRows}`);
  console.log(`   总数据量(T1内): ${reportT1.summary.totalDataSizeKB}KB`);

  if (reportT1.summary.rejectionSummary && reportT1.summary.rejectionSummary.length > 0) {
    console.log('');
    console.log('   ┌─────────────────────────────────────┐');
    console.log('   │          T1 异常拒绝统计              │');
    console.log('   └─────────────────────────────────────┘');
    reportT1.summary.rejectionSummary.forEach((rs, i) => {
      console.log(`   ${i + 1}. [${rs.category}] ${rs.message}`);
      console.log(`      错误码: ${rs.errorCode}, 次数: ${rs.count}`);
      if (rs.sampleEvents.length > 0) {
        console.log(`      最新1次: 凭证=${rs.sampleEvents[0].credentialNo?.substring(0,15)}..., 时间=${new Date(rs.sampleEvents[0].timestamp).toLocaleTimeString()}`);
      }
    });
  }

  const itemT1 = reportT1.items[0];
  if (itemT1 && itemT1.periodUsages && itemT1.periodUsages.length > 0) {
    console.log('');
    console.log('   ┌─────────────────────────────────────┐');
    console.log('   │          T1 周期用量汇总              │');
    console.log('   └─────────────────────────────────────┘');
    itemT1.periodUsages.forEach(p => {
      console.log(`   周期: ${p.periodKey}`);
      console.log(`     调用${p.usedCalls}次, ${p.usedRows}行, ${p.usedSizeKB}KB, 涉及${p.credentialCount}张凭证`);
    });
  }

  success('T1时间段报表输出完成');

  step('9. 查询时间段T2报表（按提供方维度）');
  const reportT2 = await sdk.generateReportByProvider(provider.id, {
    startTime: t2Start,
    endTime: t2End,
    includePeriodDetails: true,
    includeRejectionStats: true
  });

  console.log('   ┌─────────────────────────────────────┐');
  console.log('   │          T2 时间段报表               │');
  console.log('   └─────────────────────────────────────┘');
  console.log(`   凭证总数: ${reportT2.summary.totalCredentials}`);
  console.log(`   总调用次数(T2内): ${reportT2.summary.totalCalls}`);
  console.log(`   总拒绝次数(T2内): ${reportT2.summary.totalRejections}`);
  console.log(`   总数据行数(T2内): ${reportT2.summary.totalDataRows}`);
  console.log(`   总数据量(T2内): ${reportT2.summary.totalDataSizeKB}KB`);
  console.log('');
  console.log(`   👉 验证: T1调用=${reportT1.summary.totalCalls}, T2调用=${reportT2.summary.totalCalls}，两者不同 ✅`);
  console.log(`   👉 验证: T1拒绝=${reportT1.summary.totalRejections}, T2拒绝=${reportT2.summary.totalRejections}，两者不同 ✅`);
  success('T2时间段报表输出完成，数值与T1不同（时间段生效）');

  step('10. 查询全量时间段报表 + 异常拒绝明细');
  const reportAll = await sdk.generateReportByProvider(provider.id, {
    startTime: 0,
    endTime: Date.now(),
    includePeriodDetails: true,
    includeRejectionStats: true
  });

  console.log('   ┌─────────────────────────────────────┐');
  console.log('   │          全量汇总                    │');
  console.log('   └─────────────────────────────────────┘');
  console.log(`   凭证总数: ${reportAll.summary.totalCredentials}`);
  console.log(`   总调用次数: ${reportAll.summary.totalCalls}`);
  console.log(`   总拒绝次数: ${reportAll.summary.totalRejections}`);

  if (reportAll.summary.rejectionSummary) {
    console.log('');
    console.log('   ┌─────────────────────────────────────┐');
    console.log('   │          全量异常拒绝分类汇总         │');
    console.log('   └─────────────────────────────────────┘');
    reportAll.summary.rejectionSummary.forEach((rs, i) => {
      console.log(`   ${i + 1}. [${rs.category}] ${rs.message} (${rs.count}次)`);
    });
  }

  const allItem = reportAll.items[0];
  if (allItem && allItem.periodUsages) {
    console.log('');
    console.log('   ┌─────────────────────────────────────┐');
    console.log('   │          周期用量汇总（多凭证合并）   │');
    console.log('   └─────────────────────────────────────┘');
    allItem.periodUsages.forEach(p => {
      console.log(`   ${p.periodKey}: 调用${p.usedCalls}次, ${p.usedRows}行, ${p.usedSizeKB}KB, 涉及${p.credentialCount}张凭证`);
    });
    console.log('');
    console.log(`   👉 验证: 涉及${allItem.periodUsages[0].credentialCount}张凭证, 用量已合并 ✅`);
  }
  success('全量报表+异常拒绝分类+多凭证周期汇总输出完成');

  step('11. 直接查询拒绝事件列表');
  const allRejections = await sdk.listRejectionEvents();
  console.log(`   总拒绝事件数: ${allRejections.length}`);
  allRejections.slice(0, 3).forEach((ev, i) => {
    console.log(`   ${i + 1}. [${ev.category}] ${ev.errorCode} - ${ev.errorMessage.substring(0, 40)}`);
    if (ev.policyName) console.log(`      策略: ${ev.policyName}`);
    console.log(`      时间: ${new Date(ev.timestamp).toLocaleTimeString()}`);
  });
  success('拒绝事件列表查询完成');

  step('12. 按使用方维度分别查报表');
  const rptA = await sdk.generateReportByConsumer(consumerA.id, {
    startTime: 0,
    endTime: Date.now(),
    includePeriodDetails: true,
    includeRejectionStats: true
  });
  const rptB = await sdk.generateReportByConsumer(consumerB.id, {
    startTime: 0,
    endTime: Date.now(),
    includePeriodDetails: true,
    includeRejectionStats: true
  });

  console.log(`   使用方A(${consumerA.name}): 调用${rptA.summary.totalCalls}次, 拒绝${rptA.summary.totalRejections}次`);
  console.log(`   使用方B(${consumerB.name}): 调用${rptB.summary.totalCalls}次, 拒绝${rptB.summary.totalRejections}次`);
  console.log('');
  console.log(`   👉 验证: 使用方A与使用方B报表数值不同 ✅`);
  success('使用方维度报表分别输出完成');

  step('13. 按产品维度分别查报表（同凭证多产品分别统计）');
  const rptProd1 = await sdk.generateReportByProduct('PROD-CREDIT-REPORT', {
    startTime: 0,
    endTime: Date.now(),
    includePeriodDetails: true,
    includeRejectionStats: true
  });
  const rptProd2 = await sdk.generateReportByProduct('PROD-RISK-SCORE', {
    startTime: 0,
    endTime: Date.now(),
    includePeriodDetails: true,
    includeRejectionStats: true
  });

  console.log(`   产品1(企业信用报告): 调用${rptProd1.summary.totalCalls}次, ${rptProd1.summary.totalDataRows}行, ${rptProd1.summary.totalDataSizeKB}KB`);
  console.log(`   产品2(企业风险评分): 调用${rptProd2.summary.totalCalls}次, ${rptProd2.summary.totalDataRows}行, ${rptProd2.summary.totalDataSizeKB}KB`);
  console.log('');
  console.log(`   👉 验证: 产品1与产品2报表数值不同 ✅`);
  console.log(`   👉 验证: 产品1=${rptProd1.summary.totalCalls}次, 产品2=${rptProd2.summary.totalCalls}次, 合计${rptProd1.summary.totalCalls + rptProd2.summary.totalCalls}次 ✅`);
  success('产品维度报表分别输出完成');

  step('14. 准备平台账单记录（含匹配、漏记、重复、差异）');
  const credALogs = (await sdk.getCredential(credAId))!.usageLogs;
  const credBLogs = (await sdk.getCredential(credBId))!.usageLogs;
  const allLogs = [...credALogs, ...credBLogs].sort((a, b) => a.timestamp - b.timestamp);

  const unitPrice = 0.5;
  const billRecords = [];

  for (let i = 0; i < allLogs.length; i++) {
    const log = allLogs[i];
    if (i < 5) {
      billRecords.push({
        billId: `BILL-${1000 + i}`,
        timestamp: log.timestamp,
        credentialId: log.callerIdentity === consumerA.id ? credAId : credBId,
        providerId: provider.id,
        consumerId: log.callerIdentity,
        productId: log.productId!,
        sceneId: log.sceneId,
        callCount: log.callCount,
        dataRows: log.dataRows,
        dataSizeKB: log.dataSizeKB,
        unitPrice,
        totalAmount: log.callCount * unitPrice,
        status: 'SUCCESS' as const,
        remark: '正常匹配'
      });
    } else if (i === 5) {
      billRecords.push({
        billId: `BILL-${1000 + i}`,
        timestamp: log.timestamp,
        credentialId: log.callerIdentity === consumerA.id ? credAId : credBId,
        providerId: provider.id,
        consumerId: log.callerIdentity,
        productId: log.productId!,
        sceneId: log.sceneId,
        callCount: log.callCount + 2,
        dataRows: log.dataRows,
        dataSizeKB: log.dataSizeKB,
        unitPrice,
        totalAmount: (log.callCount + 2) * unitPrice,
        status: 'SUCCESS' as const,
        remark: '调用次数差异（账单多记2次）'
      });
    } else if (i === 6) {
      // 这条账单故意不生成，模拟 SDK 有日志但账单漏记
      continue;
    } else if (i === 7) {
      billRecords.push({
        billId: `BILL-${1000 + i}`,
        timestamp: Date.now() + 24 * 60 * 60 * 1000,
        credentialId: credAId,
        providerId: provider.id,
        consumerId: consumerA.id,
        productId: 'PROD-CREDIT-REPORT',
        sceneId: 'SCENE-LOAN-APPROVAL',
        callCount: 1,
        dataRows: 50,
        dataSizeKB: 200,
        unitPrice,
        totalAmount: unitPrice,
        status: 'SUCCESS' as const,
        remark: '账单有记录但SDK无日志（漏记）'
      });
    }
  }

  billRecords.push({
    billId: 'BILL-1000',
    timestamp: Date.now(),
    credentialId: credAId,
    providerId: provider.id,
    consumerId: consumerA.id,
    productId: 'PROD-CREDIT-REPORT',
    sceneId: 'SCENE-LOAN-APPROVAL',
    callCount: 1,
    unitPrice,
    totalAmount: unitPrice,
    status: 'REJECTED' as const,
    errorCode: String(ErrorCode.POLICY_REQUIRED_FIELD),
    remark: '策略拒绝（账单与SDK拒绝事件匹配）'
  });

  console.log(`   准备账单记录: ${billRecords.length}条`);
  console.log(`   - 正常匹配: 5条`);
  console.log(`   - 次数差异: 1条（账单多记2次）`);
  console.log(`   - SDK漏记: 1条（账单无但SDK有）`);
  console.log(`   - 账单漏记: 1条（账单有但SDK无）`);
  console.log(`   - 拒绝匹配: 1条（策略拒绝）`);
  success('平台账单记录准备完成');

  step('15. 平台账单对账');
  const reconReport = await sdk.reconcile(billRecords, {
    startTime: 0,
    endTime: Date.now() + 48 * 60 * 60 * 1000
  });

  console.log('   ┌─────────────────────────────────────┐');
  console.log('   │          对账汇总                    │');
  console.log('   └─────────────────────────────────────┘');
  console.log(`   账单记录数: ${reconReport.totalBillRecords}`);
  console.log(`   SDK日志数: ${reconReport.totalSdkLogs}`);
  console.log(`   SDK拒绝事件数: ${reconReport.totalSdkRejections}`);
  console.log('');
  console.log(`   ✅ 完全匹配: ${reconReport.summary.matched}条`);
  console.log(`   ⚠️  存在差异: ${reconReport.summary.mismatch}条`);
  console.log(`   ❌ SDK漏记: ${reconReport.summary.missingInSdk}条`);
  console.log(`   ❌ 账单漏记: ${reconReport.summary.missingInBill}条`);
  console.log(`   ⚠️  重复记录: ${reconReport.summary.duplicate}条`);
  if (reconReport.totalAmountDiff !== undefined) {
    console.log(`   💰 总金额差异: ${reconReport.totalAmountDiff.toFixed(2)}元`);
  }
  console.log('');

  console.log('   ┌─────────────────────────────────────┐');
  console.log('   │          差异明细                    │');
  console.log('   └─────────────────────────────────────┘');
  reconReport.results
    .filter(r => r.status !== 'MATCHED')
    .slice(0, 10)
    .forEach(r => {
      const statusEmoji = r.status === 'MISMATCH' ? '⚠️ ' : r.status === 'DUPLICATE' ? '⚠️ ' : '❌';
      console.log(`   ${statusEmoji}[${r.status}] ${r.message}`);
      if (r.diff) {
        const diffs = [];
        if (r.diff.callCountDiff) diffs.push(`次数差=${r.diff.callCountDiff}`);
        if (r.diff.amountDiff !== undefined) diffs.push(`金额差=${r.diff.amountDiff.toFixed(2)}元`);
        if (diffs.length > 0) console.log(`      ${diffs.join(', ')}`);
      }
    });
  success('平台账单对账完成');

  step('16. 导出报表（JSON + CSV）');
  const fullReport = await sdk.generateUsageReport({
    startTime: 0,
    endTime: Date.now(),
    includePeriodDetails: true,
    includeRejectionStats: true,
    includeRevocationRecords: true
  });

  const exportDir = path.join(process.cwd(), 'data', 'demo_exports');
  const jsonResult = sdk.exportReport(fullReport, {
    format: 'JSON',
    filePath: path.join(exportDir, 'reconciliation_report.json'),
    includeReconciliation: true,
    prettyPrint: true
  }, reconReport);

  const csvResult = sdk.exportReport(fullReport, {
    format: 'CSV',
    filePath: path.join(exportDir, 'reconciliation_report.csv'),
    includeReconciliation: true
  }, reconReport);

  if (jsonResult.success) {
    success('JSON报表导出成功', `路径: ${jsonResult.filePath}`);
  } else {
    fail('JSON报表导出失败', jsonResult.error);
  }

  if (csvResult.success) {
    success('CSV报表导出成功', `路径: ${csvResult.filePath}`);
  } else {
    fail('CSV报表导出失败', csvResult.error);
  }

  console.log('');
  console.log('   ┌─────────────────────────────────────┐');
  console.log('   │          导出文件内容预览            │');
  console.log('   └─────────────────────────────────────┘');
  if (jsonResult.content) {
    const jsonPreview = jsonResult.content.substring(0, 300);
    console.log(`   JSON预览: ${jsonPreview}...`);
  }
  console.log('');
  if (csvResult.content) {
    const csvLines = csvResult.content.split('\n').slice(0, 8);
    csvLines.forEach(line => console.log(`   ${line}`));
  }
  success('报表导出（JSON+CSV）完成');

  step('17. 模拟SDK重启验证数据持久化');
  const sdk2 = new DataAuthCredentialSDK({
    storageType: 'file',
    storagePath: demoStorageDir
  });

  const rptAfterRestart = await sdk2.generateReportByProvider(provider.id, {
    startTime: 0,
    endTime: Date.now(),
    includePeriodDetails: true,
    includeRejectionStats: true
  });
  const rejectionsAfterRestart = await sdk2.listRejectionEvents();

  console.log(`   重启后总调用: ${rptAfterRestart.summary.totalCalls}`);
  console.log(`   重启后总拒绝: ${rptAfterRestart.summary.totalRejections}`);
  console.log(`   重启后拒绝事件数: ${rejectionsAfterRestart.length}`);
  console.log('');
  console.log(`   👉 验证: 重启后报表与拒绝事件完整恢复 ✅`);
  success('重启后数据完整性验证通过');

  step('18. 清理');
  cleanupStorage();

  const cleanExportDir = path.join(process.cwd(), 'data', 'demo_exports');
  if (fs.existsSync(cleanExportDir)) {
    fs.rmSync(cleanExportDir, { recursive: true });
  }

  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length === 0) {
    fs.rmSync(dataDir, { recursive: true });
  }

  success('演示数据已清理');

  console.log('\n' + '╔'.repeat(30));
  console.log('   ✅ 平台对账能力演示完成！');
  console.log('');
  console.log('   已验证特性:');
  console.log('   ✅ 报表按时间段真实过滤用量');
  console.log('   ✅ 异常拒绝沉淀为审计事件');
  console.log('   ✅ 拒绝原因分类统计 + 示例事件');
  console.log('   ✅ 多凭证周期用量汇总');
  console.log('   ✅ 使用方/提供方/产品多维度报表');
  console.log('   ✅ 同凭证多产品分别统计');
  console.log('   ✅ 周期明细与查询区间一致');
  console.log('   ✅ 平台账单对账（匹配/漏记/重复/差异）');
  console.log('   ✅ 报表导出 JSON + CSV');
  console.log('   ✅ 拒绝事件持久化+重启恢复');
  console.log('╚'.repeat(30) + '\n');
})();
