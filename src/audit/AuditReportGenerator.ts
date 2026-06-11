import {
  AggregatedPeriodUsage,
  AuditRejectionEvent,
  AuthCredential,
  CredentialStatus,
  ReportQuery,
  RejectionReasonSummary,
  UsageReport,
  UsageReportItem
} from '../types';
import { IStorage } from '../types';
import { formatTimestamp, getErrorMessage } from '../utils';

export class AuditReportGenerator {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  async generateReport(query: ReportQuery): Promise<UsageReport> {
    const allCredentials = await this.storage.list();

    const filteredCredentials = allCredentials.filter(cred => {
      if (query.providerId && cred.order.provider.id !== query.providerId) {
        return false;
      }
      if (query.consumerId && cred.order.consumer.id !== query.consumerId) {
        return false;
      }
      if (query.productId) {
        const hasProduct = cred.order.scope.products.some(p => p.productId === query.productId);
        if (!hasProduct) return false;
      }
      return true;
    });

    const items: UsageReportItem[] = [];

    if (query.providerId) {
      const providerCreds = filteredCredentials.filter(
        c => c.order.provider.id === query.providerId
      );
      if (providerCreds.length > 0) {
        items.push(await this.aggregateCredentials(
          'PROVIDER',
          query.providerId,
          providerCreds[0].order.provider.name,
          providerCreds,
          query
        ));
      }
    }

    if (query.consumerId) {
      const consumerCreds = filteredCredentials.filter(
        c => c.order.consumer.id === query.consumerId
      );
      if (consumerCreds.length > 0) {
        items.push(await this.aggregateCredentials(
          'CONSUMER',
          query.consumerId,
          consumerCreds[0].order.consumer.name,
          consumerCreds,
          query
        ));
      }
    }

    if (query.productId) {
      const productCreds = filteredCredentials.filter(
        c => c.order.scope.products.some(p => p.productId === query.productId)
      );
      if (productCreds.length > 0) {
        const productName = productCreds[0].order.scope.products.find(
          p => p.productId === query.productId
        )?.productName || '未知产品';
        items.push(await this.aggregateCredentials(
          'PRODUCT',
          query.productId,
          productName,
          productCreds,
          query
        ));
      }
    }

    if (!query.providerId && !query.consumerId && !query.productId) {
      items.push(await this.aggregateCredentials(
        'GLOBAL',
        'ALL',
        '全部维度汇总',
        filteredCredentials,
        query
      ));
    }

    const allRejectionEvents = query.includeRejectionStats
      ? await this.storage.listRejectionEvents({
          startTime: query.filterByTimeRange !== false ? query.startTime : undefined,
          endTime: query.filterByTimeRange !== false ? query.endTime : undefined,
          providerId: query.providerId,
          consumerId: query.consumerId,
          productId: query.productId
        })
      : [];

    const summaryRejectionSummary = query.includeRejectionStats
      ? this.buildRejectionSummary(allRejectionEvents)
      : undefined;

    const summary = {
      totalCredentials: filteredCredentials.length,
      totalCalls: items.reduce((sum, i) => sum + i.totalCalls, 0),
      totalDataRows: items.reduce((sum, i) => sum + i.totalDataRows, 0),
      totalDataSizeKB: items.reduce((sum, i) => sum + i.totalDataSizeKB, 0),
      totalRevoked: items.reduce((sum, i) => sum + i.revokedCount, 0),
      totalExpired: items.reduce((sum, i) => sum + i.expiredCount, 0),
      totalRejections: allRejectionEvents.length,
      rejectionSummary: summaryRejectionSummary
    };

    return {
      query,
      generatedAt: Date.now(),
      items,
      summary
    };
  }

  async generateByProvider(providerId: string, query?: Partial<ReportQuery>): Promise<UsageReport> {
    const now = Date.now();
    return this.generateReport({
      startTime: 0,
      endTime: now,
      providerId,
      filterByTimeRange: true,
      includePeriodDetails: true,
      includeRejectionStats: true,
      includeRevocationRecords: true,
      ...query
    });
  }

  async generateByConsumer(consumerId: string, query?: Partial<ReportQuery>): Promise<UsageReport> {
    const now = Date.now();
    return this.generateReport({
      startTime: 0,
      endTime: now,
      consumerId,
      filterByTimeRange: true,
      includePeriodDetails: true,
      includeRejectionStats: true,
      includeRevocationRecords: true,
      ...query
    });
  }

  async generateByProduct(productId: string, query?: Partial<ReportQuery>): Promise<UsageReport> {
    const now = Date.now();
    return this.generateReport({
      startTime: 0,
      endTime: now,
      productId,
      filterByTimeRange: true,
      includePeriodDetails: true,
      includeRejectionStats: true,
      includeRevocationRecords: true,
      ...query
    });
  }

  private async aggregateCredentials(
    dimension: string,
    dimensionValue: string,
    dimensionName: string,
    credentials: AuthCredential[],
    query: ReportQuery
  ): Promise<UsageReportItem> {
    const filterByTime = query.filterByTimeRange !== false;

    let totalCalls = 0;
    let totalDataRows = 0;
    let totalDataSizeKB = 0;

    const periodMap = new Map<string, AggregatedPeriodUsage>();

    for (const cred of credentials) {
      for (const log of cred.usageLogs) {
        if (filterByTime) {
          if (log.timestamp < query.startTime || log.timestamp > query.endTime) {
            continue;
          }
        }
        totalCalls += log.callCount;
        totalDataRows += log.dataRows || 0;
        totalDataSizeKB += log.dataSizeKB || 0;
      }

      if (query.includePeriodDetails) {
        this.accumulatePeriodUsage(periodMap, cred.currentPeriod, cred, filterByTime, query);
        for (const hist of cred.periodHistory) {
          this.accumulatePeriodUsage(periodMap, hist, cred, filterByTime, query);
        }
      }
    }

    const activeCount = credentials.filter(c => c.status === CredentialStatus.ACTIVE).length;
    const revokedCount = credentials.filter(c => c.status === CredentialStatus.REVOKED).length;
    const expiredCount = credentials.filter(c => c.status === CredentialStatus.EXPIRED).length;
    const exhaustedCount = credentials.filter(c => c.status === CredentialStatus.EXHAUSTED).length;

    let rejectionEvents: AuditRejectionEvent[] = [];
    if (query.includeRejectionStats) {
      rejectionEvents = await this.storage.listRejectionEvents({
        startTime: filterByTime ? query.startTime : undefined,
        endTime: filterByTime ? query.endTime : undefined,
        providerId: dimension === 'PROVIDER' ? dimensionValue : undefined,
        consumerId: dimension === 'CONSUMER' ? dimensionValue : undefined,
        productId: dimension === 'PRODUCT' ? dimensionValue : undefined
      });
    }

    const item: UsageReportItem = {
      dimension,
      dimensionValue,
      dimensionName,
      totalCalls,
      totalDataRows,
      totalDataSizeKB,
      credentialCount: credentials.length,
      revokedCount,
      expiredCount,
      activeCount,
      exhaustedCount,
      rejectionCount: rejectionEvents.length
    };

    if (query.includePeriodDetails) {
      const sortedPeriods = Array.from(periodMap.values()).sort((a, b) =>
        a.periodKey.localeCompare(b.periodKey)
      );
      item.periodUsages = sortedPeriods;

      if (sortedPeriods.length > 0) {
        const latest = sortedPeriods[sortedPeriods.length - 1];
        item.currentPeriodUsage = latest;
        item.periodHistory = sortedPeriods.slice(0, -1);
      }
    }

    if (query.includeRejectionStats) {
      item.rejectionSummary = this.buildRejectionSummary(rejectionEvents);
    }

    if (query.includeRevocationRecords) {
      const revokedCreds = credentials.filter(c => c.status === CredentialStatus.REVOKED);
      (item as any).revocationRecords = revokedCreds.map(c => ({
        credentialId: c.credentialId,
        credentialNo: c.credentialNo,
        revokedAt: c.revokedAt ? formatTimestamp(c.revokedAt) : null,
        revokedBy: c.revokedBy,
        revokeReason: c.revokeReason
      }));
    }

    return item;
  }

  private accumulatePeriodUsage(
    periodMap: Map<string, AggregatedPeriodUsage>,
    periodUsage: { periodKey: string; usedCalls: number; usedRows: number; usedSizeKB: number; periodStart?: number; periodEnd?: number },
    credential: AuthCredential,
    filterByTime: boolean,
    query: ReportQuery
  ): void {
    const key = periodUsage.periodKey;
    if (!periodMap.has(key)) {
      periodMap.set(key, {
        periodKey: key,
        periodStart: periodUsage.periodStart,
        periodEnd: periodUsage.periodEnd,
        usedCalls: 0,
        usedRows: 0,
        usedSizeKB: 0,
        credentialCount: 0
      });
    }

    const aggregated = periodMap.get(key)!;

    if (filterByTime) {
      const ps = periodUsage.periodStart || 0;
      const pe = periodUsage.periodEnd || Date.now();
      if (pe < query.startTime || ps > query.endTime) {
        return;
      }
    }

    aggregated.usedCalls += periodUsage.usedCalls;
    aggregated.usedRows += periodUsage.usedRows;
    aggregated.usedSizeKB += periodUsage.usedSizeKB;
    aggregated.credentialCount += 1;
  }

  private buildRejectionSummary(events: AuditRejectionEvent[]): RejectionReasonSummary[] {
    const map = new Map<string, {
      errorCode: string;
      category: string;
      message: string;
      count: number;
      samples: AuditRejectionEvent[];
    }>();

    for (const ev of events) {
      const key = `${ev.category}:${ev.errorCode}`;
      if (!map.has(key)) {
        map.set(key, {
          errorCode: ev.errorCode,
          category: ev.category,
          message: getErrorMessage(ev.errorCode),
          count: 0,
          samples: []
        });
      }
      const entry = map.get(key)!;
      entry.count += 1;
      if (entry.samples.length < 3) {
        entry.samples.push(ev);
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .map(e => ({
        errorCode: e.errorCode as any,
        category: e.category as any,
        message: e.message,
        count: e.count,
        sampleEvents: e.samples
      }));
  }
}
