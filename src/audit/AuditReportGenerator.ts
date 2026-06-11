import {
  AuthCredential,
  CredentialStatus,
  ReportQuery,
  UsageReport,
  UsageReportItem
} from '../types';
import { IStorage } from '../types';
import { formatTimestamp } from '../utils';

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
      items.push(this.aggregateCredentials(
        'PROVIDER',
        query.providerId,
        filteredCredentials[0]?.order.provider.name || '未知提供方',
        providerCreds,
        query
      ));
    }

    if (query.consumerId) {
      const consumerCreds = filteredCredentials.filter(
        c => c.order.consumer.id === query.consumerId
      );
      items.push(this.aggregateCredentials(
        'CONSUMER',
        query.consumerId,
        filteredCredentials[0]?.order.consumer.name || '未知使用方',
        consumerCreds,
        query
      ));
    }

    if (query.productId) {
      const productCreds = filteredCredentials.filter(
        c => c.order.scope.products.some(p => p.productId === query.productId)
      );
      const productName = productCreds[0]?.order.scope.products.find(
        p => p.productId === query.productId
      )?.productName || '未知产品';
      items.push(this.aggregateCredentials(
        'PRODUCT',
        query.productId,
        productName,
        productCreds,
        query
      ));
    }

    if (!query.providerId && !query.consumerId && !query.productId) {
      items.push(this.aggregateCredentials(
        'GLOBAL',
        'ALL',
        '全部维度汇总',
        filteredCredentials,
        query
      ));
    }

    const summary = {
      totalCredentials: filteredCredentials.length,
      totalCalls: items.reduce((sum, i) => sum + i.totalCalls, 0),
      totalDataRows: items.reduce((sum, i) => sum + i.totalDataRows, 0),
      totalDataSizeKB: items.reduce((sum, i) => sum + i.totalDataSizeKB, 0),
      totalRevoked: items.reduce((sum, i) => sum + i.revokedCount, 0),
      totalExpired: items.reduce((sum, i) => sum + i.expiredCount, 0),
      totalRejections: items.reduce((sum, i) => sum + i.rejectionCount, 0)
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
      ...query
    });
  }

  async generateByConsumer(consumerId: string, query?: Partial<ReportQuery>): Promise<UsageReport> {
    const now = Date.now();
    return this.generateReport({
      startTime: 0,
      endTime: now,
      consumerId,
      ...query
    });
  }

  async generateByProduct(productId: string, query?: Partial<ReportQuery>): Promise<UsageReport> {
    const now = Date.now();
    return this.generateReport({
      startTime: 0,
      endTime: now,
      productId,
      ...query
    });
  }

  private aggregateCredentials(
    dimension: string,
    dimensionValue: string,
    dimensionName: string,
    credentials: AuthCredential[],
    query: ReportQuery
  ): UsageReportItem {
    const totalCalls = credentials.reduce((sum, c) => sum + c.totalUsedCalls, 0);
    const totalDataRows = credentials.reduce((sum, c) => sum + (c.totalUsedRows || 0), 0);
    const totalDataSizeKB = credentials.reduce((sum, c) => sum + (c.totalUsedSizeKB || 0), 0);

    const activeCount = credentials.filter(c => c.status === CredentialStatus.ACTIVE).length;
    const revokedCount = credentials.filter(c => c.status === CredentialStatus.REVOKED).length;
    const expiredCount = credentials.filter(c => c.status === CredentialStatus.EXPIRED).length;
    const exhaustedCount = credentials.filter(c => c.status === CredentialStatus.EXHAUSTED).length;

    const rejectionCount = this.calculateRejectionCount(credentials, query);

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
      rejectionCount
    };

    if (query.includePeriodDetails && credentials.length > 0) {
      const latestCred = credentials.sort((a, b) =>
        new Date(b.order.createdAt).getTime() - new Date(a.order.createdAt).getTime()
      )[0];

      item.currentPeriodUsage = {
        periodKey: latestCred.currentPeriod.periodKey,
        usedCalls: latestCred.currentPeriod.usedCalls,
        usedRows: latestCred.currentPeriod.usedRows,
        usedSizeKB: latestCred.currentPeriod.usedSizeKB,
        maxCalls: latestCred.order.quota.maxCalls,
        maxRows: latestCred.order.quota.maxDataRows,
        maxSizeKB: latestCred.order.quota.maxDataSizeKB
      };

      item.periodHistory = latestCred.periodHistory.map(p => ({
        periodKey: p.periodKey,
        usedCalls: p.usedCalls,
        usedRows: p.usedRows,
        usedSizeKB: p.usedSizeKB
      }));
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

  private calculateRejectionCount(credentials: AuthCredential[], query: ReportQuery): number {
    if (!query.includeRejectionStats) return 0;

    let count = 0;
    for (const cred of credentials) {
      const logs = cred.usageLogs.filter(l =>
        l.timestamp >= query.startTime && l.timestamp <= query.endTime
      );
      count += logs.filter(l => l.remark?.includes('REJECT') || l.remark?.includes('拒绝')).length;
    }
    return count;
  }
}
