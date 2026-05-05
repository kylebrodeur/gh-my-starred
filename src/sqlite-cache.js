/**
 * SQLite-based cache for gh-my-starred
 * Provides structured storage for repository data, classifications, and embeddings
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { homedir } = require('os');

// Constants
const CACHE_DIR = process.env.XDG_CACHE_HOME
  ? path.join(process.env.XDG_CACHE_HOME, 'gh-my-starred')
  : path.join(homedir(), '.cache', 'gh-my-starred');

const DB_PATH = path.join(CACHE_DIR, 'starred-cache.sqlite');

class SQLiteCache {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize the database and create tables if they don't exist
   */
  async initialize() {
    if (this.initialized) return;
    
    // Ensure cache directory exists
    const fs = require('fs');
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    
    // Open database connection
    await new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          console.error('Error opening SQLite database:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    // Create tables
    await this._createTables();
    this.initialized = true;
  }

  /**
   * Create the necessary tables
   */
  _createTables() {
    return new Promise((resolve, reject) => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS repositories (
          repo_id INTEGER PRIMARY KEY,
          owner TEXT NOT NULL,
          name TEXT NOT NULL,
          full_name TEXT NOT NULL UNIQUE,
          description TEXT,
          topics_json TEXT NOT NULL,
          primary_language TEXT,
          stargazer_count INTEGER NOT NULL,
          url TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          is_fork INTEGER NOT NULL DEFAULT 0,
          last_seen_at TEXT NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS classifications (
          repo_id INTEGER NOT NULL,
          model TEXT NOT NULL,
          category TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (repo_id, model),
          FOREIGN KEY (repo_id) REFERENCES repositories(repo_id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS embeddings (
          repo_id INTEGER NOT NULL,
          model TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          vector BLOB NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (repo_id, model),
          FOREIGN KEY (repo_id) REFERENCES repositories(repo_id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        
        -- Indexes for better performance
        CREATE INDEX IF NOT EXISTS idx_repositories_updated ON repositories(updated_at);
        CREATE INDEX IF NOT EXISTS idx_repositories_language ON repositories(primary_language);
        CREATE INDEX IF NOT EXISTS idx_classifications_model ON classifications(model);
        CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  /**
   * Insert or update multiple repositories
   */
  async upsertRepositories(repositories) {
    if (!this.initialized) await this.initialize();
    
    const now = new Date().toISOString();
    
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        const stmt = this.db.prepare(`
          INSERT INTO repositories (
            repo_id, owner, name, full_name, description, topics_json,
            primary_language, stargazer_count, url, updated_at, archived, is_fork, last_seen_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
          ON CONFLICT(full_name) DO UPDATE SET
            owner = excluded.owner,
            name = excluded.name,
            description = excluded.description,
            topics_json = excluded.topics_json,
            primary_language = excluded.primary_language,
            stargazer_count = excluded.stargazer_count,
            url = excluded.url,
            updated_at = excluded.updated_at,
            archived = excluded.archived,
            is_fork = excluded.is_fork,
            last_seen_at = excluded.last_seen_at
        `);
        
        let hasError = false;
        try {
          repositories.forEach(repo => {
            stmt.run([
              repo.id,
              repo.owner,
              repo.name,
              repo.full_name,
              repo.description || '',
              JSON.stringify(repo.topics),
              repo.language || null,
              repo.stargazers_count,
              repo.html_url,
              repo.updated_at,
              repo.archived ? 1 : 0,
              repo.fork ? 1 : 0,
              now
            ], (err) => {
              if (err && !hasError) {
                hasError = true;
                console.error("Error upserting repo:", repo.full_name, err);
                reject(err);
              }
            });
          });
          
          stmt.finalize((err) => {
            if (hasError) return;
            if (err) reject(err);
            else resolve();
          });
        } catch (err) {
          stmt.finalize();
          if (!hasError) reject(err);
        }
      });
    });
  }

  /**
   * Get all repositories
   */
  async getAllRepositories() {
    if (!this.initialized) await this.initialize();
    
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM repositories ORDER BY full_name ASC
      `, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const repositories = rows.map(row => ({
            id: row.repo_id,
            owner: row.owner,
            name: row.name,
            full_name: row.full_name,
            description: row.description,
            topics: JSON.parse(row.topics_json),
            language: row.primary_language,
            stargazers_count: row.stargazer_count,
            html_url: row.url,
            updated_at: row.updated_at,
            archived: Boolean(row.archived),
            fork: Boolean(row.is_fork)
          }));
          resolve(repositories);
        }
      });
    });
  }

  /**
   * Get a repository by full_name
   */
  async getRepositoryByFullName(fullName) {
    if (!this.initialized) await this.initialize();
    
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT * FROM repositories WHERE full_name = ?
      `, [fullName], (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (!row) {
            resolve(null);
          } else {
            const repo = {
              id: row.repo_id,
              owner: row.owner,
              name: row.name,
              full_name: row.full_name,
              description: row.description,
              topics: JSON.parse(row.topics_json),
              language: row.primary_language,
              stargazers_count: row.stargazer_count,
              html_url: row.url,
              updated_at: row.updated_at,
              archived: Boolean(row.archived),
              fork: Boolean(row.is_fork)
            };
            resolve(repo);
          }
        }
      });
    });
  }

  /**
   * Set classification for a repository
   */
  async setClassification(repoId, model, category) {
    if (!this.initialized) await this.initialize();
    
    const now = new Date().toISOString();
    
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT INTO classifications (repo_id, model, category, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(repo_id, model) DO UPDATE SET
          category = excluded.category,
          created_at = excluded.created_at
      `, [repoId, model, category, now], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get classification for a repository
   */
  async getClassification(repoId, model) {
    if (!this.initialized) await this.initialize();
    
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT category FROM classifications 
        WHERE repo_id = ? AND model = ?
      `, [repoId, model], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.category : null);
        }
      });
    });
  }

  /**
   * Get all classifications for a model
   */
  async getAllClassifications(model) {
    if (!this.initialized) await this.initialize();
    
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT repo_id, category FROM classifications WHERE model = ?
      `, [model], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const classifications = {};
          rows.forEach(row => {
            classifications[row.repo_id] = row.category;
          });
          resolve(classifications);
        }
      });
    });
  }

  /**
   * Set embedding for a repository
   */
  async setEmbedding(repoId, model, vector) {
    if (!this.initialized) await this.initialize();
    
    const now = new Date().toISOString();
    
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT INTO embeddings (repo_id, model, dimensions, vector, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(repo_id, model) DO UPDATE SET
          dimensions = excluded.dimensions,
          vector = excluded.vector,
          updated_at = excluded.updated_at
      `, [repoId, model, vector.length, Buffer.from(new Float32Array(vector).buffer), now], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get embedding for a repository
   */
  async getEmbedding(repoId, model) {
    if (!this.initialized) await this.initialize();
    
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT vector FROM embeddings 
        WHERE repo_id = ? AND model = ?
      `, [repoId, model], (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (!row) {
            resolve(null);
          } else {
            // Convert Buffer back to array of numbers
            const floatArray = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength);
            const vector = Array.from(floatArray);
            resolve(vector);
          }
        }
      });
    });
  }

  /**
   * Get all embeddings for a model
   */
  async getAllEmbeddings(model) {
    if (!this.initialized) await this.initialize();
    
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT repo_id, vector FROM embeddings WHERE model = ?
      `, [model], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const embeddings = {};
          rows.forEach(row => {
            const floatArray = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength);
            embeddings[row.repo_id] = Array.from(floatArray);
          });
          resolve(embeddings);
        }
      });
    });
  }

  /**
   * Set last sync timestamp
   */
  async setLastSync(timestamp) {
    if (!this.initialized) await this.initialize();
    
    const ts = (timestamp || new Date()).toISOString();
    
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT INTO metadata (key, value)
        VALUES ('last_sync', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `, [ts], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get last sync timestamp
   */
  async getLastSync() {
    if (!this.initialized) await this.initialize();
    
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT value FROM metadata WHERE key = 'last_sync'
      `, [], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? new Date(row.value) : null);
        }
      });
    });
  }

  /**
   * Get repository count
   */
  async getRepositoryCount() {
    if (!this.initialized) await this.initialize();
    
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT COUNT(*) as count FROM repositories
      `, [], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }
}

// Export a singleton instance
const sqliteCache = new SQLiteCache();
module.exports = { SQLiteCache, sqliteCache };