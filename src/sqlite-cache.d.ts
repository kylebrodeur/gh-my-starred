export interface SQLiteCache {
  initialize(): Promise<void>;
  close(): void;
  upsertRepositories(repositories: any[]): Promise<void>;
  getAllRepositories(): Promise<any[]>;
  getRepositoryByFullName(firstName: string): Promise<any | null>;
  setClassification(repoId: number, model: string, category: string): Promise<void>;
  getClassification(repoId: number, model: string): Promise<string | null>;
  getAllClassifications(model: string): Promise<Record<number, string>>;
  setEmbedding(repoId: number, model: string, vector: number[]): Promise<void>;
  getEmbedding(repoId: number, model: string): Promise<number[] | null>;
  getAllEmbeddings(model: string): Promise<Record<number, number[]>>;
  setLastSync(timestamp?: Date): Promise<void>;
  getLastSync(): Promise<Date | null>;
  getRepositoryCount(): Promise<number>;
}

export const sqliteCache: SQLiteCache;