// Storage: IndexedDB in the browser, a Map in tests. Same interface either way.
//   evals:      fen -> [{depth, multipv, lines, source, complete}]
//   archives:   "user/YYYY-MM" -> raw Chess.com games (past months only)
//   candidates: "user|gameKey" -> {threats, safes} for one analysed game
//   kv:         small settings and progress

export class MemoryStore {
  constructor() {
    this.t = { evals: new Map(), archives: new Map(), candidates: new Map(), kv: new Map() };
  }
  async getEvals(fen) { return this.t.evals.get(fen) || null; }
  async addEval(fen, entry) { this.t.evals.set(fen, [...(this.t.evals.get(fen) || []), entry]); }
  async getArchive(key) { return this.t.archives.get(key) || null; }
  async putArchive(key, games) { this.t.archives.set(key, games); }
  async getCandidates(key) { return this.t.candidates.get(key) || null; }
  async putCandidates(key, value) { this.t.candidates.set(key, value); }
  async allCandidates(prefix) { return [...this.t.candidates].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v); }
  async get(key, fallback = null) { return this.t.kv.has(key) ? this.t.kv.get(key) : fallback; }
  async set(key, value) { this.t.kv.set(key, value); }
}

const STORES = ["evals", "archives", "candidates", "kv"];
const LEGACY_NAME = "threatscan";   // the database name before the app was called Cracktics

export class IdbStore {
  static async open(name = "cracktics", version = 1) {
    let created = false;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = () => {
        created = req.result.objectStoreNames.length === 0;
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const store = new IdbStore(db);
    if (created) await store.migrateFrom(LEGACY_NAME);
    return store;
  }

  /** One-time copy from the database used before the rename, so cached scans and progress survive. */
  async migrateFrom(oldName) {
    const names = (await indexedDB.databases?.()) ?? [];
    if (!names.some((d) => d.name === oldName)) return;
    const old = await new Promise((resolve, reject) => {
      const req = indexedDB.open(oldName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      for (const s of STORES) {
        if (!old.objectStoreNames.contains(s)) continue;
        const rows = await new Promise((resolve, reject) => {
          const out = [];
          const req = old.transaction(s, "readonly").objectStore(s).openCursor();
          req.onsuccess = () => { const c = req.result; if (!c) return resolve(out); out.push([c.key, c.value]); c.continue(); };
          req.onerror = () => reject(req.error);
        });
        await this._req(s, "readwrite", (st) => { for (const [k, v] of rows) st.put(v, k); });
      }
    } finally {
      old.close();
    }
  }

  constructor(db) { this.db = db; }

  _req(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async getEvals(fen) { return (await this._req("evals", "readonly", (s) => s.get(fen))) || null; }
  async addEval(fen, entry) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("evals", "readwrite");
      const s = tx.objectStore("evals");
      const get = s.get(fen);
      get.onsuccess = () => s.put([...(get.result || []), entry], fen);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async getArchive(key) { return (await this._req("archives", "readonly", (s) => s.get(key))) || null; }
  async putArchive(key, games) { await this._req("archives", "readwrite", (s) => s.put(games, key)); }
  async getCandidates(key) { return (await this._req("candidates", "readonly", (s) => s.get(key))) || null; }
  async putCandidates(key, value) { await this._req("candidates", "readwrite", (s) => s.put(value, key)); }
  async allCandidates(prefix) {
    const range = IDBKeyRange.bound(prefix, prefix + "￿");
    return (await this._req("candidates", "readonly", (s) => s.getAll(range))) || [];
  }
  async get(key, fallback = null) { const v = await this._req("kv", "readonly", (s) => s.get(key)); return v === undefined ? fallback : v; }
  async set(key, value) { await this._req("kv", "readwrite", (s) => s.put(value, key)); }
}
