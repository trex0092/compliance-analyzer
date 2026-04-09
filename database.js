/**
 * ComplianceDB - IndexedDB Backend for Hawkeye Sterling V2
 *
 * Provides persistent storage using IndexedDB, replacing localStorage
 * for large datasets while maintaining backwards compatibility through
 * a one-time migration path.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'ComplianceAnalyserDB';
  const DB_VERSION = 1;
  const MIGRATION_KEY = '__compliancedb_migrated';

  // Store definitions: name -> { keyPath, autoIncrement, indexes }
  const STORE_DEFINITIONS = {
    shipments: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'date', keyPath: 'date', options: {} },
        { name: 'companyId', keyPath: 'companyId', options: {} },
        { name: 'status', keyPath: 'status', options: {} },
        { name: 'severity', keyPath: 'severity', options: {} },
      ],
    },
    evidence: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'date', keyPath: 'date', options: {} },
        { name: 'companyId', keyPath: 'companyId', options: {} },
        { name: 'status', keyPath: 'status', options: {} },
        { name: 'severity', keyPath: 'severity', options: {} },
      ],
    },
    reports: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'date', keyPath: 'date', options: {} },
        { name: 'companyId', keyPath: 'companyId', options: {} },
        { name: 'status', keyPath: 'status', options: {} },
        { name: 'severity', keyPath: 'severity', options: {} },
      ],
    },
    incidents: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'date', keyPath: 'date', options: {} },
        { name: 'companyId', keyPath: 'companyId', options: {} },
        { name: 'status', keyPath: 'status', options: {} },
        { name: 'severity', keyPath: 'severity', options: {} },
      ],
    },
    auditTrail: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'date', keyPath: 'date', options: {} },
        { name: 'companyId', keyPath: 'companyId', options: {} },
        { name: 'status', keyPath: 'status', options: {} },
        { name: 'severity', keyPath: 'severity', options: {} },
      ],
    },
    screeningHistory: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'date', keyPath: 'date', options: {} },
        { name: 'companyId', keyPath: 'companyId', options: {} },
        { name: 'status', keyPath: 'status', options: {} },
        { name: 'severity', keyPath: 'severity', options: {} },
      ],
    },
    onboarding: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'date', keyPath: 'date', options: {} },
        { name: 'companyId', keyPath: 'companyId', options: {} },
        { name: 'status', keyPath: 'status', options: {} },
        { name: 'severity', keyPath: 'severity', options: {} },
      ],
    },
    calendar: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'date', keyPath: 'date', options: {} },
        { name: 'companyId', keyPath: 'companyId', options: {} },
        { name: 'status', keyPath: 'status', options: {} },
        { name: 'severity', keyPath: 'severity', options: {} },
      ],
    },
    training: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'date', keyPath: 'date', options: {} },
        { name: 'companyId', keyPath: 'companyId', options: {} },
        { name: 'status', keyPath: 'status', options: {} },
        { name: 'severity', keyPath: 'severity', options: {} },
      ],
    },
    analysisHistory: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'date', keyPath: 'date', options: {} },
        { name: 'companyId', keyPath: 'companyId', options: {} },
        { name: 'status', keyPath: 'status', options: {} },
        { name: 'severity', keyPath: 'severity', options: {} },
      ],
    },
  };

  const STORE_NAMES = Object.keys(STORE_DEFINITIONS);

  // ── Internal: Database Connection ──────────────────────────────────

  let _dbInstance = null;

  /**
   * Open (or return cached) database connection.
   * Creates object stores and indexes on first run or version upgrade.
   */
  function _openDB() {
    if (_dbInstance) {
      return Promise.resolve(_dbInstance);
    }

    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = function () {
        reject(new Error('Failed to open IndexedDB: ' + request.error));
      };

      request.onupgradeneeded = function (event) {
        var db = event.target.result;

        STORE_NAMES.forEach(function (storeName) {
          if (db.objectStoreNames.contains(storeName)) {
            return;
          }

          var def = STORE_DEFINITIONS[storeName];
          var store = db.createObjectStore(storeName, {
            keyPath: def.keyPath,
            autoIncrement: def.autoIncrement,
          });

          def.indexes.forEach(function (idx) {
            store.createIndex(idx.name, idx.keyPath, idx.options);
          });
        });
      };

      request.onsuccess = function () {
        _dbInstance = request.result;

        _dbInstance.onclose = function () {
          _dbInstance = null;
        };

        resolve(_dbInstance);
      };
    });
  }

  /**
   * Execute a transaction against one or more stores.
   * Returns a promise that resolves when the transaction completes.
   *
   * @param {string|string[]} storeNames
   * @param {string} mode - 'readonly' or 'readwrite'
   * @param {function} callback - receives (transaction) and should return the IDBRequest to track
   */
  function _withTransaction(storeNames, mode, callback) {
    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeNames, mode);
        var result;

        tx.onerror = function () {
          reject(tx.error);
        };

        tx.oncomplete = function () {
          resolve(result);
        };

        var req = callback(tx);
        if (req && typeof req.onsuccess !== 'undefined') {
          req.onsuccess = function () {
            result = req.result;
          };
        }
      });
    });
  }

  // ── Validation ─────────────────────────────────────────────────────

  function _validateStore(storeName) {
    if (STORE_NAMES.indexOf(storeName) === -1) {
      throw new Error(
        'Unknown store: "' + storeName + '". Valid stores: ' + STORE_NAMES.join(', ')
      );
    }
  }

  // ── CRUD Operations ────────────────────────────────────────────────

  /**
   * Add a record to a store. Returns the auto-generated key.
   */
  function add(storeName, record) {
    _validateStore(storeName);
    var entry = Object.assign({}, record);
    // Remove id so auto-increment assigns one
    delete entry.id;

    return _withTransaction(storeName, 'readwrite', function (tx) {
      return tx.objectStore(storeName).add(entry);
    });
  }

  /**
   * Get a single record by its primary key.
   */
  function get(storeName, id) {
    _validateStore(storeName);

    return _withTransaction(storeName, 'readonly', function (tx) {
      return tx.objectStore(storeName).get(id);
    });
  }

  /**
   * Get all records from a store, optionally filtered by a predicate function.
   *
   * @param {string} storeName
   * @param {function} [filter] - Optional predicate: function(record) => boolean
   */
  function getAll(storeName, filter) {
    _validateStore(storeName);

    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var results = [];

        var request = store.openCursor();

        request.onerror = function () {
          reject(request.error);
        };

        request.onsuccess = function (event) {
          var cursor = event.target.result;
          if (cursor) {
            if (!filter || filter(cursor.value)) {
              results.push(cursor.value);
            }
            cursor.continue();
          }
        };

        tx.oncomplete = function () {
          resolve(results);
        };

        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  /**
   * Update an existing record. Merges the provided fields into the record
   * at the given id.
   */
  function update(storeName, id, record) {
    _validateStore(storeName);

    return get(storeName, id).then(function (existing) {
      if (!existing) {
        throw new Error('Record not found in "' + storeName + '" with id: ' + id);
      }

      var updated = Object.assign({}, existing, record, { id: id });

      return _withTransaction(storeName, 'readwrite', function (tx) {
        return tx.objectStore(storeName).put(updated);
      });
    });
  }

  /**
   * Delete a record by its primary key.
   */
  function del(storeName, id) {
    _validateStore(storeName);

    return _withTransaction(storeName, 'readwrite', function (tx) {
      return tx.objectStore(storeName).delete(id);
    });
  }

  /**
   * Query records by a specific index value.
   */
  function query(storeName, indexName, value) {
    _validateStore(storeName);

    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var index = store.index(indexName);
        var request = index.getAll(value);

        request.onerror = function () {
          reject(request.error);
        };

        request.onsuccess = function () {
          resolve(request.result);
        };
      });
    });
  }

  /**
   * Count the number of records in a store.
   */
  function count(storeName) {
    _validateStore(storeName);

    return _withTransaction(storeName, 'readonly', function (tx) {
      return tx.objectStore(storeName).count();
    });
  }

  /**
   * Clear all records from a store.
   */
  function clear(storeName) {
    _validateStore(storeName);

    return _withTransaction(storeName, 'readwrite', function (tx) {
      return tx.objectStore(storeName).clear();
    });
  }

  // ── Migration from localStorage ────────────────────────────────────

  /**
   * Map of localStorage keys to their target store names.
   * Keys that do not match any known store are skipped.
   */
  var LOCAL_STORAGE_KEY_MAP = {};
  STORE_NAMES.forEach(function (name) {
    // Try common key formats: exact name, camelCase, prefixed variants
    LOCAL_STORAGE_KEY_MAP[name] = name;
    LOCAL_STORAGE_KEY_MAP['compliance_' + name] = name;
    LOCAL_STORAGE_KEY_MAP['complianceAnalyser_' + name] = name;
  });

  /**
   * Check whether a migration from localStorage has already occurred.
   */
  function _isMigrated() {
    try {
      return localStorage.getItem(MIGRATION_KEY) === 'true';
    } catch (e) {
      // localStorage unavailable; nothing to migrate
      return true;
    }
  }

  /**
   * One-time migration of existing localStorage data into IndexedDB.
   * Detects stored JSON arrays or objects and writes them into the
   * corresponding object stores. Sets a flag to prevent repeat migration.
   *
   * @returns {Promise<object>} Summary of migrated counts per store.
   */
  function migrateFromLocalStorage() {
    if (_isMigrated()) {
      return Promise.resolve({ alreadyMigrated: true });
    }

    var migrationSummary = {};
    var dataToMigrate = {};

    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        var targetStore = LOCAL_STORAGE_KEY_MAP[key];

        if (!targetStore) {
          continue;
        }

        var raw = localStorage.getItem(key);
        if (!raw) continue;

        try {
          var parsed = JSON.parse(raw);
          var records = Array.isArray(parsed) ? parsed : [parsed];
          dataToMigrate[targetStore] = (dataToMigrate[targetStore] || []).concat(records);
        } catch (parseErr) {
          // Skip non-JSON values
          continue;
        }
      }
    } catch (e) {
      return Promise.resolve({ error: 'localStorage not accessible', migrated: false });
    }

    var storeNames = Object.keys(dataToMigrate);
    if (storeNames.length === 0) {
      try {
        localStorage.setItem(MIGRATION_KEY, 'true');
      } catch (e) {
        // Ignore
      }
      return Promise.resolve({ migrated: true, stores: {} });
    }

    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeNames, 'readwrite');

        tx.onerror = function () {
          reject(tx.error);
        };

        tx.oncomplete = function () {
          try {
            localStorage.setItem(MIGRATION_KEY, 'true');
          } catch (e) {
            // Ignore
          }
          resolve({ migrated: true, stores: migrationSummary });
        };

        storeNames.forEach(function (storeName) {
          var store = tx.objectStore(storeName);
          var records = dataToMigrate[storeName];
          migrationSummary[storeName] = records.length;

          records.forEach(function (record) {
            var entry = Object.assign({}, record);
            delete entry.id; // Let auto-increment assign keys
            store.add(entry);
          });
        });
      });
    });
  }

  // ── Export / Import ────────────────────────────────────────────────

  /**
   * Export the contents of a single object store as an array of records.
   */
  function exportStore(storeName) {
    _validateStore(storeName);

    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var request = store.getAll();

        request.onerror = function () {
          reject(request.error);
        };

        request.onsuccess = function () {
          resolve(request.result);
        };
      });
    });
  }

  /**
   * Export the entire database as a JSON-serialisable object.
   * Structure: { storeName: [ records... ], ... }
   */
  function exportAll() {
    return _openDB().then(function (db) {
      var promises = STORE_NAMES.map(function (storeName) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readonly');
          var store = tx.objectStore(storeName);
          var request = store.getAll();

          request.onerror = function () {
            reject(request.error);
          };

          request.onsuccess = function () {
            resolve({ name: storeName, data: request.result });
          };
        });
      });

      return Promise.all(promises).then(function (results) {
        var output = {};
        results.forEach(function (r) {
          output[r.name] = r.data;
        });
        return output;
      });
    });
  }

  /**
   * Import data from a JSON backup object (as produced by exportAll).
   * Clears existing data in each store before importing.
   *
   * @param {object} data - { storeName: [ records... ], ... }
   */
  function importAll(data) {
    if (!data || typeof data !== 'object') {
      return Promise.reject(new Error('importAll expects an object with store data'));
    }

    var storeNames = Object.keys(data).filter(function (key) {
      return STORE_NAMES.indexOf(key) !== -1;
    });

    if (storeNames.length === 0) {
      return Promise.resolve({ imported: true, stores: {} });
    }

    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeNames, 'readwrite');
        var summary = {};

        tx.onerror = function () {
          reject(tx.error);
        };

        tx.oncomplete = function () {
          resolve({ imported: true, stores: summary });
        };

        storeNames.forEach(function (storeName) {
          var store = tx.objectStore(storeName);
          store.clear();

          var records = Array.isArray(data[storeName]) ? data[storeName] : [];
          // Validate records: must be objects with an `id` field (keyPath)
          var validRecords = records.filter(function(record) {
            return record && typeof record === 'object' && record.id;
          });
          summary[storeName] = validRecords.length;
          if (validRecords.length < records.length) {
            console.warn('[Database] importAll: skipped ' + (records.length - validRecords.length) + ' invalid records in ' + storeName);
          }

          validRecords.forEach(function (record) {
            store.put(record);
          });
        });
      });
    });
  }

  // ── Search ─────────────────────────────────────────────────────────

  /**
   * Full-text search across one or all stores. Searches all string-valued
   * fields of each record for a case-insensitive match.
   *
   * @param {string} text - The search term.
   * @param {string} [storeName] - Optional store to limit the search to.
   * @returns {Promise<object[]>} Matching records with a _store property.
   */
  function search(text, storeName) {
    var targets = storeName ? [storeName] : STORE_NAMES;

    if (storeName) {
      _validateStore(storeName);
    }

    var needle = (text || '').toLowerCase();
    if (!needle) {
      return Promise.resolve([]);
    }

    var promises = targets.map(function (name) {
      return getAll(name, function (record) {
        return _recordMatchesText(record, needle);
      }).then(function (records) {
        return records.map(function (r) {
          return Object.assign({}, r, { _store: name });
        });
      });
    });

    return Promise.all(promises).then(function (arrays) {
      var merged = [];
      arrays.forEach(function (arr) {
        merged = merged.concat(arr);
      });
      return merged;
    });
  }

  /**
   * Check whether any string field in a record contains the needle.
   */
  function _recordMatchesText(record, needle) {
    var keys = Object.keys(record);
    for (var i = 0; i < keys.length; i++) {
      var val = record[keys[i]];
      if (typeof val === 'string' && val.toLowerCase().indexOf(needle) !== -1) {
        return true;
      }
    }
    return false;
  }

  /**
   * Query records within a date range on the "date" index.
   *
   * @param {string} storeName
   * @param {string} startDate - ISO date string (inclusive lower bound)
   * @param {string} endDate   - ISO date string (inclusive upper bound)
   * @returns {Promise<object[]>}
   */
  function dateRangeQuery(storeName, startDate, endDate) {
    _validateStore(storeName);

    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var index = store.index('date');
        var range = IDBKeyRange.bound(startDate, endDate);
        var results = [];

        var request = index.openCursor(range);

        request.onerror = function () {
          reject(request.error);
        };

        request.onsuccess = function (event) {
          var cursor = event.target.result;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          }
        };

        tx.oncomplete = function () {
          resolve(results);
        };

        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  /**
   * Compound filter: query a store applying multiple field conditions.
   *
   * @param {string} storeName
   * @param {object} filters - Key/value pairs. Each key is a field name;
   *   value can be a primitive (exact match), a RegExp, or an object with
   *   { from, to } for range comparisons.
   * @returns {Promise<object[]>}
   */
  function compoundFilter(storeName, filters) {
    _validateStore(storeName);

    if (!filters || Object.keys(filters).length === 0) {
      return getAll(storeName);
    }

    var filterKeys = Object.keys(filters);

    return getAll(storeName, function (record) {
      return filterKeys.every(function (key) {
        var condition = filters[key];
        var value = record[key];

        // Range filter: { from, to }
        if (condition && typeof condition === 'object' && !('test' in condition)) {
          if (condition.from !== undefined && condition.to !== undefined) {
            return value >= condition.from && value <= condition.to;
          }
          if (condition.from !== undefined) {
            return value >= condition.from;
          }
          if (condition.to !== undefined) {
            return value <= condition.to;
          }
          return true;
        }

        // RegExp filter
        if (condition instanceof RegExp) {
          return condition.test(String(value));
        }

        // Exact match
        return value === condition;
      });
    });
  }

  // ── Public API ─────────────────────────────────────────────────────

  global.ComplianceDB = {
    // CRUD
    add: add,
    get: get,
    getAll: getAll,
    update: update,
    delete: del,
    query: query,
    count: count,
    clear: clear,

    // Migration
    migrateFromLocalStorage: migrateFromLocalStorage,

    // Export / Import
    exportAll: exportAll,
    importAll: importAll,
    exportStore: exportStore,

    // Search
    search: search,
    dateRangeQuery: dateRangeQuery,
    compoundFilter: compoundFilter,

    // Meta
    storeNames: STORE_NAMES.slice(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
