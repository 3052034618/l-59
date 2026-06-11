import { AuthCredential, AuditRejectionEvent, IStorage, RejectionCategory, ErrorCode } from '../types';

export class MemoryStorage implements IStorage {
  private store: Map<string, AuthCredential> = new Map();
  private rejectionEvents: AuditRejectionEvent[] = [];

  async get(credentialId: string): Promise<AuthCredential | null> {
    const cred = this.store.get(credentialId);
    return cred ? JSON.parse(JSON.stringify(cred)) : null;
  }

  async set(credentialId: string, credential: AuthCredential): Promise<void> {
    this.store.set(credentialId, JSON.parse(JSON.stringify(credential)));
  }

  async delete(credentialId: string): Promise<void> {
    this.store.delete(credentialId);
  }

  async list(): Promise<AuthCredential[]> {
    return Array.from(this.store.values()).map(c => JSON.parse(JSON.stringify(c)));
  }

  async addRejectionEvent(event: AuditRejectionEvent): Promise<void> {
    this.rejectionEvents.push(JSON.parse(JSON.stringify(event)));
  }

  async listRejectionEvents(filter?: {
    startTime?: number;
    endTime?: number;
    credentialId?: string;
    providerId?: string;
    consumerId?: string;
    productId?: string;
    errorCode?: ErrorCode;
    category?: RejectionCategory;
  }): Promise<AuditRejectionEvent[]> {
    let events = this.rejectionEvents.slice();

    if (filter) {
      if (filter.startTime !== undefined) {
        events = events.filter(e => e.timestamp >= filter.startTime!);
      }
      if (filter.endTime !== undefined) {
        events = events.filter(e => e.timestamp <= filter.endTime!);
      }
      if (filter.credentialId) {
        events = events.filter(e => e.credentialId === filter.credentialId);
      }
      if (filter.providerId) {
        events = events.filter(e => e.providerId === filter.providerId);
      }
      if (filter.consumerId) {
        events = events.filter(e => e.consumerId === filter.consumerId);
      }
      if (filter.productId) {
        events = events.filter(e => e.productId === filter.productId);
      }
      if (filter.errorCode) {
        events = events.filter(e => e.errorCode === filter.errorCode);
      }
      if (filter.category) {
        events = events.filter(e => e.category === filter.category);
      }
    }

    return events.map(e => JSON.parse(JSON.stringify(e)));
  }
}
