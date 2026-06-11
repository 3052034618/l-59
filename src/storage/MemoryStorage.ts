import { AuthCredential, IStorage } from '../types';

export class MemoryStorage implements IStorage {
  private store: Map<string, AuthCredential> = new Map();

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
}
