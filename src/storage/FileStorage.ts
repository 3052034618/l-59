import * as fs from 'fs';
import * as path from 'path';
import { AuthCredential, IStorage } from '../types';

export class FileStorage implements IStorage {
  private filePath: string;
  private cache: Map<string, AuthCredential> = new Map();
  private loaded: boolean = false;

  constructor(basePath?: string) {
    const dir = basePath || path.join(process.cwd(), 'data', 'credentials');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.join(dir, 'credentials.json');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const arr: AuthCredential[] = JSON.parse(raw);
        for (const cred of arr) {
          this.cache.set(cred.credentialId, cred);
        }
      }
    } catch {
      this.cache = new Map();
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const arr = Array.from(this.cache.values());
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(arr, null, 2), 'utf-8');
  }

  async get(credentialId: string): Promise<AuthCredential | null> {
    await this.load();
    const cred = this.cache.get(credentialId);
    return cred ? JSON.parse(JSON.stringify(cred)) : null;
  }

  async set(credentialId: string, credential: AuthCredential): Promise<void> {
    await this.load();
    this.cache.set(credentialId, JSON.parse(JSON.stringify(credential)));
    await this.persist();
  }

  async delete(credentialId: string): Promise<void> {
    await this.load();
    this.cache.delete(credentialId);
    await this.persist();
  }

  async list(): Promise<AuthCredential[]> {
    await this.load();
    return Array.from(this.cache.values()).map(c => JSON.parse(JSON.stringify(c)));
  }
}
