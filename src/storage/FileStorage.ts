import * as fs from 'fs';
import * as path from 'path';
import { AuthCredential, AuditRejectionEvent, IStorage, RejectionCategory, ErrorCode } from '../types';

export class FileStorage implements IStorage {
  private credentialsPath: string;
  private rejectionsPath: string;
  private credCache: Map<string, AuthCredential> = new Map();
  private rejectionCache: AuditRejectionEvent[] = [];
  private credLoaded: boolean = false;
  private rejLoaded: boolean = false;

  constructor(basePath?: string) {
    const dir = basePath || path.join(process.cwd(), 'data', 'credentials');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.credentialsPath = path.join(dir, 'credentials.json');
    this.rejectionsPath = path.join(dir, 'rejections.json');
  }

  private async loadCredentials(): Promise<void> {
    if (this.credLoaded) return;
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const raw = fs.readFileSync(this.credentialsPath, 'utf-8');
        const arr: AuthCredential[] = JSON.parse(raw);
        for (const cred of arr) {
          this.credCache.set(cred.credentialId, cred);
        }
      }
    } catch {
      this.credCache = new Map();
    }
    this.credLoaded = true;
  }

  private async loadRejections(): Promise<void> {
    if (this.rejLoaded) return;
    try {
      if (fs.existsSync(this.rejectionsPath)) {
        const raw = fs.readFileSync(this.rejectionsPath, 'utf-8');
        this.rejectionCache = JSON.parse(raw);
      }
    } catch {
      this.rejectionCache = [];
    }
    this.rejLoaded = true;
  }

  private async persistCredentials(): Promise<void> {
    const arr = Array.from(this.credCache.values());
    const dir = path.dirname(this.credentialsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.credentialsPath, JSON.stringify(arr, null, 2), 'utf-8');
  }

  private async persistRejections(): Promise<void> {
    const dir = path.dirname(this.rejectionsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.rejectionsPath, JSON.stringify(this.rejectionCache, null, 2), 'utf-8');
  }

  async get(credentialId: string): Promise<AuthCredential | null> {
    await this.loadCredentials();
    const cred = this.credCache.get(credentialId);
    return cred ? JSON.parse(JSON.stringify(cred)) : null;
  }

  async set(credentialId: string, credential: AuthCredential): Promise<void> {
    await this.loadCredentials();
    this.credCache.set(credentialId, JSON.parse(JSON.stringify(credential)));
    await this.persistCredentials();
  }

  async delete(credentialId: string): Promise<void> {
    await this.loadCredentials();
    this.credCache.delete(credentialId);
    await this.persistCredentials();
  }

  async list(): Promise<AuthCredential[]> {
    await this.loadCredentials();
    return Array.from(this.credCache.values()).map(c => JSON.parse(JSON.stringify(c)));
  }

  async addRejectionEvent(event: AuditRejectionEvent): Promise<void> {
    await this.loadRejections();
    this.rejectionCache.push(JSON.parse(JSON.stringify(event)));
    await this.persistRejections();
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
    await this.loadRejections();
    let events = this.rejectionCache.slice();

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
