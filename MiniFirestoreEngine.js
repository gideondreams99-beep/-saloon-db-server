import fs from 'fs';

export class MiniFirestoreEngine {
  constructor(dbPath = './database_store.json', rulesPath = './security_rules.json') {
    this.dbPath = dbPath;
    this.rulesPath = rulesPath;
    this.storage = {};
    this.rules = {};
    this.apiKeys = {};
    
    this.loadSecurityRules();
    this.loadFromDisk();
  }

  loadSecurityRules() {
    if (fs.existsSync(this.rulesPath)) {
      const data = JSON.parse(fs.readFileSync(this.rulesPath, 'utf8'));
      this.rules = data.rules || {};
      this.apiKeys = data.apiKeys || {};
      console.log('🔒 Security rules and API keys loaded.');
    }
  }

  loadFromDisk() {
    if (fs.existsSync(this.dbPath)) {
      try {
        this.storage = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
        console.log('📁 Database state loaded from disk.');
      } catch (e) {
        this.storage = {};
      }
    }
  }

  saveToDisk() {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.storage, null, 2));
  }

  validateApiKey(apiKey) {
    if (!this.apiKeys[apiKey]) {
      return { valid: false, reason: 'Invalid or missing API key.' };
    }
    return { valid: true, clientInfo: this.apiKeys[apiKey] };
  }

  checkPermission(collection, action, clientInfo) {
    const colRules = this.rules[collection] || { read: true, write: true };
    const rule = colRules[action];

    if (rule === true) return true;
    if (rule === false) return false;
    if (rule === "role === 'admin'") return clientInfo.role === 'admin';

    return true;
  }

  setDoc(collection, docId, data, options = {}, clientInfo) {
    if (!this.checkPermission(collection, 'write', clientInfo)) {
      throw new Error(`Permission denied: Cannot write to collection '${collection}'`);
    }

    if (!this.storage[collection]) this.storage[collection] = {};

    if (options.merge && this.storage[collection][docId]) {
      this.storage[collection][docId] = {
        ...this.storage[collection][docId],
        ...data,
        updatedAt: Date.now()
      };
    } else {
      this.storage[collection][docId] = {
        ...data,
        createdAt: this.storage[collection][docId]?.createdAt || Date.now(),
        updatedAt: Date.now()
      };
    }

    this.saveToDisk();
    return { id: docId, ...this.storage[collection][docId] };
  }

  deleteDoc(collection, docId, clientInfo) {
    if (!this.checkPermission(collection, 'write', clientInfo)) {
      throw new Error(`Permission denied: Cannot delete from '${collection}'`);
    }

    if (this.storage[collection]?.[docId]) {
      delete this.storage[collection][docId];
      this.saveToDisk();
      return true;
    }
    return false;
  }

  queryDocs(collection, filters = [], clientInfo) {
    if (!this.checkPermission(collection, 'read', clientInfo)) {
      throw new Error(`Permission denied: Cannot read collection '${collection}'`);
    }

    const docs = this.storage[collection] || {};
    const results = [];

    for (let id in docs) {
      const docData = docs[id];
      let matches = true;

      for (let filter of filters) {
        const { field, operator, value } = filter;
        const val = docData[field];

        if (operator === '==' && val !== value) matches = false;
        if (operator === '!=' && val === value) matches = false;
        if (operator === '>' && val <= value) matches = false;
        if (operator === '<' && val >= value) matches = false;
      }

      if (matches) {
        results.push({ id, ...docData });
      }
    }

    return results;
  }
}
