import {
  AuditRejectionEvent,
  AuthCredential,
  BillMatchResult,
  BillMatchStatus,
  PlatformBillRecord,
  ReconciliationReport,
  ReportQuery,
  UsageLogEntry
} from '../types';
import { IStorage } from '../types';

const TIME_TOLERANCE_MS = 5 * 60 * 1000;

export class ReconciliationEngine {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  async reconcile(
    billRecords: PlatformBillRecord[],
    query: ReportQuery
  ): Promise<ReconciliationReport> {
    const filterByTime = query.filterByTimeRange !== false;

    const filteredBills = billRecords.filter(bill => {
      if (filterByTime) {
        if (bill.timestamp < query.startTime || bill.timestamp > query.endTime) return false;
      }
      if (query.providerId && bill.providerId !== query.providerId) return false;
      if (query.consumerId && bill.consumerId !== query.consumerId) return false;
      if (query.productId && bill.productId !== query.productId) return false;
      return true;
    });

    const allCredentials = await this.storage.list();
    const filteredCredentials = allCredentials.filter(cred => {
      if (query.providerId && cred.order.provider.id !== query.providerId) return false;
      if (query.consumerId && cred.order.consumer.id !== query.consumerId) return false;
      if (query.productId) {
        return cred.order.scope.products.some(p => p.productId === query.productId);
      }
      return true;
    });

    let sdkLogs: UsageLogEntry[] = [];
    for (const cred of filteredCredentials) {
      for (const log of cred.usageLogs) {
        if (filterByTime) {
          if (log.timestamp < query.startTime || log.timestamp > query.endTime) continue;
        }
        if (query.productId && log.productId !== query.productId) continue;
        sdkLogs.push(log);
      }
    }

    const sdkRejections = await this.storage.listRejectionEvents({
      startTime: filterByTime ? query.startTime : undefined,
      endTime: filterByTime ? query.endTime : undefined,
      providerId: query.providerId,
      consumerId: query.consumerId,
      productId: query.productId
    });

    const results = this.performMatching(filteredBills, sdkLogs, sdkRejections);

    const summary = this.calculateSummary(results);
    const totalAmountDiff = results
      .filter(r => r.diff?.amountDiff !== undefined)
      .reduce((sum, r) => sum + (r.diff?.amountDiff || 0), 0);

    return {
      query,
      generatedAt: Date.now(),
      totalBillRecords: filteredBills.length,
      totalSdkLogs: sdkLogs.length,
      totalSdkRejections: sdkRejections.length,
      matchedCount: summary.matched,
      mismatchCount: summary.mismatch,
      missingInSdkCount: summary.missingInSdk,
      missingInBillCount: summary.missingInBill,
      duplicateCount: summary.duplicate,
      totalAmountDiff: totalAmountDiff || undefined,
      results,
      summary
    };
  }

  private performMatching(
    bills: PlatformBillRecord[],
    sdkLogs: UsageLogEntry[],
    sdkRejections: AuditRejectionEvent[]
  ): BillMatchResult[] {
    const results: BillMatchResult[] = [];
    const matchedSdkLogIds = new Set<string>();
    const matchedRejectionEventIds = new Set<string>();
    const processedBillIds = new Set<string>();

    for (const bill of bills) {
      if (processedBillIds.has(bill.billId)) {
        results.push({
          status: 'DUPLICATE',
          billRecord: bill,
          message: `账单 ${bill.billId} 重复出现`
        });
        continue;
      }
      processedBillIds.add(bill.billId);

      if (bill.status === 'FAILED' || bill.status === 'REJECTED') {
        const matchingRejection = sdkRejections.find(ev =>
          !matchedRejectionEventIds.has(ev.eventId) &&
          ev.credentialId === bill.credentialId &&
          ev.productId === bill.productId &&
          Math.abs(ev.timestamp - bill.timestamp) <= TIME_TOLERANCE_MS &&
          (bill.errorCode ? ev.errorCode === bill.errorCode : true)
        );

        if (matchingRejection) {
          matchedRejectionEventIds.add(matchingRejection.eventId);
          results.push({
            status: 'MATCHED',
            billRecord: bill,
            sdkRejectionEvent: matchingRejection,
            message: `拒绝记录匹配成功：${bill.billId} <-> ${matchingRejection.eventId}`
          });
        } else {
          results.push({
            status: 'MISSING_IN_SDK',
            billRecord: bill,
            message: `账单 ${bill.billId} 为 ${bill.status}，但 SDK 中无对应拒绝事件`
          });
        }
        continue;
      }

      const matchingLogs = sdkLogs.filter(log =>
        !matchedSdkLogIds.has(log.logId) &&
        log.callerIdentity === bill.consumerId &&
        log.productId === bill.productId &&
        log.sceneId === bill.sceneId &&
        Math.abs(log.timestamp - bill.timestamp) <= TIME_TOLERANCE_MS
      );

      if (matchingLogs.length === 0) {
        results.push({
          status: 'MISSING_IN_SDK',
          billRecord: bill,
          message: `账单 ${bill.billId} 在 SDK 中无匹配调用日志`
        });
        continue;
      }

      let log: UsageLogEntry;
      if (matchingLogs.length > 1) {
        matchingLogs.sort((a, b) =>
          Math.abs(a.timestamp - bill.timestamp) - Math.abs(b.timestamp - bill.timestamp)
        );
      }
      log = matchingLogs[0];
      const callCountDiff = log.callCount - bill.callCount;
      const dataRowsDiff = (log.dataRows || 0) - (bill.dataRows || 0);
      const dataSizeKBDiff = (log.dataSizeKB || 0) - (bill.dataSizeKB || 0);

      const hasDiff = callCountDiff !== 0 || dataRowsDiff !== 0 || dataSizeKBDiff !== 0;
      const amountDiff = bill.totalAmount !== undefined && bill.unitPrice !== undefined
        ? bill.totalAmount - (log.callCount * bill.unitPrice)
        : undefined;

      if (hasDiff || (amountDiff !== undefined && amountDiff !== 0)) {
        matchedSdkLogIds.add(log.logId);
        results.push({
          status: 'MISMATCH',
          billRecord: bill,
          sdkLogEntry: log,
          diff: {
            callCountDiff: callCountDiff || undefined,
            dataRowsDiff: dataRowsDiff || undefined,
            dataSizeKBDiff: dataSizeKBDiff || undefined,
            amountDiff: amountDiff || undefined
          },
          message: `账单 ${bill.billId} 与 SDK 日志 ${log.logId} 存在差异`
        });
      } else {
        matchedSdkLogIds.add(log.logId);
        results.push({
          status: 'MATCHED',
          billRecord: bill,
          sdkLogEntry: log,
          message: `账单 ${bill.billId} 与 SDK 日志 ${log.logId} 完全匹配`
        });
      }
    }

    for (const log of sdkLogs) {
      if (!matchedSdkLogIds.has(log.logId)) {
        results.push({
          status: 'MISSING_IN_BILL',
          sdkLogEntry: log,
          message: `SDK 日志 ${log.logId} 在账单中无对应记录`
        });
      }
    }

    for (const ev of sdkRejections) {
      if (!matchedRejectionEventIds.has(ev.eventId)) {
        results.push({
          status: 'MISSING_IN_BILL',
          sdkRejectionEvent: ev,
          message: `SDK 拒绝事件 ${ev.eventId} 在账单中无对应记录`
        });
      }
    }

    return results;
  }

  private calculateSummary(results: BillMatchResult[]): {
    matched: number;
    mismatch: number;
    missingInSdk: number;
    missingInBill: number;
    duplicate: number;
  } {
    const summary = {
      matched: 0,
      mismatch: 0,
      missingInSdk: 0,
      missingInBill: 0,
      duplicate: 0
    };

    for (const r of results) {
      switch (r.status) {
        case 'MATCHED':
          summary.matched++;
          break;
        case 'MISMATCH':
          summary.mismatch++;
          break;
        case 'MISSING_IN_SDK':
          summary.missingInSdk++;
          break;
        case 'MISSING_IN_BILL':
          summary.missingInBill++;
          break;
        case 'DUPLICATE':
          summary.duplicate++;
          break;
      }
    }

    return summary;
  }
}
