import * as fs from 'fs';
import * as path from 'path';
import {
  AggregatedPeriodUsage,
  ExportOptions,
  ExportResult,
  ReconciliationReport,
  RejectionReasonSummary,
  UsageReport
} from '../types';
import { formatTimestamp } from '../utils';

export class ReportExporter {
  static export(
    report: UsageReport,
    options: ExportOptions,
    reconciliationReport?: ReconciliationReport
  ): ExportResult {
    try {
      const content = options.format === 'JSON'
        ? this.exportToJson(report, options, reconciliationReport)
        : this.exportToCsv(report, options, reconciliationReport);

      let filePath: string | undefined;
      if (options.filePath) {
        const dir = path.dirname(options.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(options.filePath, content, 'utf-8');
        filePath = path.resolve(options.filePath);
      }

      return {
        success: true,
        format: options.format,
        filePath,
        content
      };
    } catch (err) {
      return {
        success: false,
        format: options.format,
        error: `导出失败: ${String(err)}`
      };
    }
  }

  private static exportToJson(
    report: UsageReport,
    options: ExportOptions,
    reconciliationReport?: ReconciliationReport
  ): string {
    const output: Record<string, unknown> = {};

    if (options.includeReport !== false) {
      output.report = this.simplifyReport(report);
    }

    if (options.includeRejections !== false && report.summary.rejectionSummary) {
      output.rejectionSummary = report.summary.rejectionSummary.map(r => ({
        errorCode: r.errorCode,
        category: r.category,
        message: r.message,
        count: r.count,
        sampleEvents: r.sampleEvents.map(e => ({
          eventId: e.eventId,
          timestamp: formatTimestamp(e.timestamp),
          credentialId: e.credentialId,
          productId: e.productId,
          errorCode: e.errorCode,
          category: e.category,
          message: e.errorMessage
        }))
      }));
    }

    if (options.includePeriodUsages !== false) {
      output.periodUsages = report.items.flatMap(item =>
        (item.periodUsages || []).map(p => ({
          dimension: item.dimension,
          dimensionValue: item.dimensionValue,
          ...this.simplifyPeriodUsage(p)
        }))
      );
    }

    if (options.includeReconciliation !== false && reconciliationReport) {
      output.reconciliation = {
        summary: reconciliationReport.summary,
        totalBillRecords: reconciliationReport.totalBillRecords,
        totalSdkLogs: reconciliationReport.totalSdkLogs,
        totalSdkRejections: reconciliationReport.totalSdkRejections,
        totalAmountDiff: reconciliationReport.totalAmountDiff,
        results: reconciliationReport.results.map(r => ({
          status: r.status,
          message: r.message,
          billId: r.billRecord?.billId,
          sdkLogId: r.sdkLogEntry?.logId,
          sdkEventId: r.sdkRejectionEvent?.eventId,
          diff: r.diff
        }))
      };
    }

    output.exportedAt = formatTimestamp(Date.now());
    output.query = report.query;

    return options.prettyPrint !== false
      ? JSON.stringify(output, null, 2)
      : JSON.stringify(output);
  }

  private static exportToCsv(
    report: UsageReport,
    options: ExportOptions,
    reconciliationReport?: ReconciliationReport
  ): string {
    const csvParts: string[] = [];

    if (options.includeReport !== false) {
      csvParts.push('=== 用量汇总报表 ===');
      csvParts.push('维度,维度值,维度名称,凭证数,总调用次数,总数据行数,总数据量(KB),拒绝次数');
      for (const item of report.items) {
        csvParts.push([
          item.dimension,
          item.dimensionValue,
          item.dimensionName,
          item.credentialCount,
          item.totalCalls,
          item.totalDataRows,
          item.totalDataSizeKB,
          item.rejectionCount
        ].map(v => this.escapeCsv(String(v))).join(','));
      }
      csvParts.push('');
    }

    if (options.includeRejections !== false && report.summary.rejectionSummary) {
      csvParts.push('=== 异常拒绝分类汇总 ===');
      csvParts.push('分类,错误码,错误描述,次数,最新示例时间,示例凭证ID');
      for (const r of report.summary.rejectionSummary) {
        const sample = r.sampleEvents[0];
        csvParts.push([
          r.category,
          r.errorCode,
          r.message,
          r.count,
          sample ? formatTimestamp(sample.timestamp) : '',
          sample ? sample.credentialId : ''
        ].map(v => this.escapeCsv(String(v))).join(','));
      }
      csvParts.push('');
    }

    if (options.includePeriodUsages !== false) {
      csvParts.push('=== 周期用量汇总 ===');
      csvParts.push('维度,维度值,周期,调用次数,数据行数,数据量(KB),涉及凭证数');
      for (const item of report.items) {
        for (const p of item.periodUsages || []) {
          csvParts.push([
            item.dimension,
            item.dimensionValue,
            p.periodKey,
            p.usedCalls,
            p.usedRows,
            p.usedSizeKB,
            p.credentialCount
          ].map(v => this.escapeCsv(String(v))).join(','));
        }
      }
      csvParts.push('');
    }

    if (options.includeReconciliation !== false && reconciliationReport) {
      csvParts.push('=== 平台对账差异 ===');
      csvParts.push('匹配状态,账单ID,SDK日志ID,SDK事件ID,调用次数差,数据行数差,数据量差(KB),金额差,消息');
      for (const r of reconciliationReport.results) {
        csvParts.push([
          r.status,
          r.billRecord?.billId || '',
          r.sdkLogEntry?.logId || '',
          r.sdkRejectionEvent?.eventId || '',
          r.diff?.callCountDiff ?? '',
          r.diff?.dataRowsDiff ?? '',
          r.diff?.dataSizeKBDiff ?? '',
          r.diff?.amountDiff ?? '',
          r.message
        ].map(v => this.escapeCsv(String(v))).join(','));
      }
      csvParts.push('');

      csvParts.push('=== 对账汇总 ===');
      csvParts.push('完全匹配,差异,SDK漏记,账单漏记,重复记录,总金额差异');
      csvParts.push([
        reconciliationReport.summary.matched,
        reconciliationReport.summary.mismatch,
        reconciliationReport.summary.missingInSdk,
        reconciliationReport.summary.missingInBill,
        reconciliationReport.summary.duplicate,
        reconciliationReport.totalAmountDiff ?? 0
      ].map(v => this.escapeCsv(String(v))).join(','));
    }

    return csvParts.join('\n');
  }

  private static simplifyReport(report: UsageReport): Record<string, unknown> {
    return {
      generatedAt: formatTimestamp(report.generatedAt),
      query: {
        startTime: formatTimestamp(report.query.startTime),
        endTime: formatTimestamp(report.query.endTime),
        providerId: report.query.providerId,
        consumerId: report.query.consumerId,
        productId: report.query.productId
      },
      summary: {
        totalCredentials: report.summary.totalCredentials,
        totalCalls: report.summary.totalCalls,
        totalDataRows: report.summary.totalDataRows,
        totalDataSizeKB: report.summary.totalDataSizeKB,
        totalRejections: report.summary.totalRejections
      },
      items: report.items.map(item => ({
        dimension: item.dimension,
        dimensionValue: item.dimensionValue,
        dimensionName: item.dimensionName,
        totalCalls: item.totalCalls,
        totalDataRows: item.totalDataRows,
        totalDataSizeKB: item.totalDataSizeKB,
        credentialCount: item.credentialCount,
        rejectionCount: item.rejectionCount
      }))
    };
  }

  private static simplifyPeriodUsage(p: AggregatedPeriodUsage): Record<string, unknown> {
    return {
      periodKey: p.periodKey,
      periodStart: p.periodStart ? formatTimestamp(p.periodStart) : undefined,
      periodEnd: p.periodEnd ? formatTimestamp(p.periodEnd) : undefined,
      usedCalls: p.usedCalls,
      usedRows: p.usedRows,
      usedSizeKB: p.usedSizeKB,
      credentialCount: p.credentialCount
    };
  }

  private static escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
