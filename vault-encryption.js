/**
 * VaultEncryption Module
 * Data encryption at rest for the Vault tab using the Web Crypto API.
 * AES-GCM 256-bit encryption with PBKDF2 key derivation.
 * Each encrypted item has its own random IV (12 bytes) and salt (16 bytes).
 */
var VaultEncryption = (function() {
    'use strict';

    var STORAGE_KEY = 'fgl_vault_encrypted';
    var PBKDF2_ITERATIONS = 100000;
    var cachedKey = null;
    var cachedPassphrase = null;
    var locked = true;
    var cacheTimeout = null;
    var CACHE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — auto-lock

    function resetCacheTimeout() {
        if (cacheTimeout) clearTimeout(cacheTimeout);
        cacheTimeout = setTimeout(function() {
            cachedKey = null;
            cachedPassphrase = null;
            locked = true;
            console.warn('[Vault] Auto-locked after inactivity');
        }, CACHE_TIMEOUT_MS);
    }

    // ---- Utility helpers ----

    function getVaultStore() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function saveVaultStore(store) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    function arrayBufferToBase64(buffer) {
        var bytes = new Uint8Array(buffer);
        var binary = '';
        for (var i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    function base64ToArrayBuffer(base64) {
        var binary = atob(base64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // ---- Core crypto methods ----

    /**
     * Derive an AES-GCM 256-bit key from a passphrase and salt using PBKDF2.
     * @param {string} passphrase
     * @param {ArrayBuffer|Uint8Array} salt - 16-byte salt
     * @returns {Promise<CryptoKey>}
     */
    function deriveKey(passphrase, salt) {
        var enc = new TextEncoder();
        return crypto.subtle.importKey(
            'raw',
            enc.encode(passphrase),
            'PBKDF2',
            false,
            ['deriveKey']
        ).then(function(baseKey) {
            return crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: salt instanceof Uint8Array ? salt : new Uint8Array(salt),
                    iterations: PBKDF2_ITERATIONS,
                    hash: 'SHA-256'
                },
                baseKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
        });
    }

    /**
     * Encrypt JSON-serialisable data with a passphrase.
     * @param {*} data - Any JSON-serialisable value
     * @param {string} passphrase
     * @returns {Promise<{iv: string, salt: string, ciphertext: string}>} Base64-encoded strings
     */
    function encrypt(data, passphrase) {
        var iv = crypto.getRandomValues(new Uint8Array(12));
        var salt = crypto.getRandomValues(new Uint8Array(16));
        var enc = new TextEncoder();
        var plaintext = enc.encode(JSON.stringify(data));

        return deriveKey(passphrase, salt).then(function(key) {
            return crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                plaintext
            );
        }).then(function(cipherBuffer) {
            return {
                iv: arrayBufferToBase64(iv.buffer),
                salt: arrayBufferToBase64(salt.buffer),
                ciphertext: arrayBufferToBase64(cipherBuffer)
            };
        });
    }

    /**
     * Decrypt an encrypted object back to parsed JSON.
     * @param {{iv: string, salt: string, ciphertext: string}} encryptedObj
     * @param {string} passphrase
     * @returns {Promise<*>} Parsed JSON data
     */
    function decrypt(encryptedObj, passphrase) {
        var iv = new Uint8Array(base64ToArrayBuffer(encryptedObj.iv));
        var salt = new Uint8Array(base64ToArrayBuffer(encryptedObj.salt));
        var ciphertext = base64ToArrayBuffer(encryptedObj.ciphertext);

        return deriveKey(passphrase, salt).then(function(key) {
            return crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                ciphertext
            );
        }).then(function(plainBuffer) {
            var dec = new TextDecoder();
            try { return JSON.parse(dec.decode(plainBuffer)); } catch(e) { return null; }
        });
    }

    /**
     * Encrypt and store data under a named key in the vault.
     * @param {string} key
     * @param {*} data
     * @param {string} passphrase
     * @returns {Promise<void>}
     */
    function storeSecure(key, data, passphrase) {
        return encrypt(data, passphrase).then(function(encObj) {
            var store = getVaultStore();
            store[key] = encObj;
            saveVaultStore(store);
        });
    }

    /**
     * Retrieve and decrypt data for a named key from the vault.
     * @param {string} key
     * @param {string} passphrase
     * @returns {Promise<*>}
     */
    function retrieveSecure(key, passphrase) {
        var store = getVaultStore();
        if (!store[key]) {
            return Promise.reject(new Error('Key not found: ' + key));
        }
        return decrypt(store[key], passphrase);
    }

    /**
     * List all encrypted item keys without decrypting.
     * @returns {string[]}
     */
    function listKeys() {
        return Object.keys(getVaultStore());
    }

    /**
     * Remove an encrypted item by key.
     * @param {string} key
     */
    function deleteKey(key) {
        var store = getVaultStore();
        delete store[key];
        saveVaultStore(store);
    }

    /**
     * Re-encrypt all vault items with a new passphrase.
     * @param {string} oldPass
     * @param {string} newPass
     * @returns {Promise<void>}
     */
    function changePassphrase(oldPass, newPass) {
        var store = getVaultStore();
        var keys = Object.keys(store);
        if (keys.length === 0) {
            cachedPassphrase = newPass;
            cachedKey = null;
            return Promise.resolve();
        }

        // Backup current store for rollback on failure
        var backup = JSON.stringify(store);

        var decryptPromises = keys.map(function(k) {
            return decrypt(store[k], oldPass).then(function(data) {
                return { key: k, data: data };
            });
        });

        return Promise.all(decryptPromises).then(function(items) {
            var reEncryptPromises = items.map(function(item) {
                return encrypt(item.data, newPass).then(function(encObj) {
                    return { key: item.key, encObj: encObj };
                });
            });
            return Promise.all(reEncryptPromises);
        }).then(function(reEncrypted) {
            var newStore = {};
            reEncrypted.forEach(function(item) {
                newStore[item.key] = item.encObj;
            });
            saveVaultStore(newStore);
            cachedPassphrase = newPass;
            cachedKey = null;
        }).catch(function(err) {
            // Rollback to original encrypted store on any failure
            try { localStorage.setItem(STORAGE_KEY, backup); } catch(e) { console.warn('[Vault] Rollback failed:', e); }
            throw err;
        });
    }

    /**
     * Check whether the vault is locked.
     * @returns {boolean}
     */
    function isLocked() {
        return locked;
    }

    /**
     * Clear the derived key from memory, locking the vault.
     */
    function lock() {
        cachedKey = null;
        cachedPassphrase = null;
        locked = true;
    }

    /**
     * Derive and cache a key for the session, unlocking the vault.
     * Validates the passphrase against the first stored item if one exists.
     * @param {string} passphrase
     * @returns {Promise<boolean>} Resolves true on success
     */
    function unlock(passphrase) {
        var keys = listKeys();
        if (keys.length > 0) {
            // Validate passphrase against stored items — try first available
            // If first key is corrupted, try remaining keys before failing
            var tryKey = function(idx) {
                if (idx >= keys.length) return Promise.reject(new Error('Invalid passphrase or all vault items corrupted'));
                return retrieveSecure(keys[idx], passphrase).then(function() {
                    cachedPassphrase = passphrase;
                    locked = false;
                    resetCacheTimeout();
                    return true;
                }).catch(function() {
                    return tryKey(idx + 1);
                });
            };
            return tryKey(0);
        }
        // No items yet -- accept any passphrase
        cachedPassphrase = passphrase;
        locked = false;
        return Promise.resolve(true);
    }

    // ---- UI rendering ----

    function esc(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /**
     * Render the full vault management UI as an HTML string.
     * @returns {string}
     */
    function renderVaultUI() {
        var keys = listKeys();
        var lockIcon = locked ? '&#x1F512;' : '&#x1F513;';
        var lockLabel = locked ? 'Locked' : 'Unlocked';
        var lockColour = locked ? '#e74c3c' : '#27ae60';

        var html = '';

        // Header
        html += '<div style="max-width:800px;margin:0 auto;padding:20px;">';
        html += '<h2 style="margin-bottom:4px;">&#x1F512; Encrypted Vault</h2>';
        html += '<p style="color:#666;margin-top:0;">AES-GCM 256-bit encryption at rest with PBKDF2 key derivation.</p>';

        // Lock status indicator
        html += '<div id="vault-lock-status" style="display:inline-block;padding:6px 14px;border-radius:4px;font-weight:bold;margin-bottom:18px;';
        html += 'background:' + lockColour + ';color:#fff;">' + lockIcon + ' ' + lockLabel + '</div>';

        // Unlock / Lock panel
        html += '<div style="background:#f8f9fa;border:1px solid #ddd;border-radius:3px;padding:16px;margin-bottom:18px;">';
        if (locked) {
            html += '<h3 style="margin-top:0;">Unlock Vault</h3>';
            html += '<div style="display:flex;gap:8px;align-items:center;">';
            html += '<input type="password" id="vault-passphrase" placeholder="Enter passphrase" ';
            html += 'style="flex:1;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;" ';
            html += 'onkeydown="if(event.key===\'Enter\')document.getElementById(\'vault-unlock-btn\').click()">';
            html += '<button id="vault-unlock-btn" onclick="VaultEncryption._uiUnlock()" ';
            html += 'style="padding:8px 18px;background:#3498db;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;">Unlock</button>';
            html += '</div>';
            html += '<div id="vault-unlock-error" style="color:#e74c3c;margin-top:8px;display:none;"></div>';
        } else {
            html += '<h3 style="margin-top:0;">Vault Unlocked</h3>';
            html += '<button onclick="VaultEncryption._uiLock()" ';
            html += 'style="padding:8px 18px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;">Lock Vault</button>';
        }
        html += '</div>';

        // Only show management UI when unlocked
        if (!locked) {
            // Add new item form
            html += '<div style="background:#f8f9fa;border:1px solid #ddd;border-radius:3px;padding:16px;margin-bottom:18px;">';
            html += '<h3 style="margin-top:0;">Add New Item</h3>';
            html += '<div style="margin-bottom:8px;">';
            html += '<input type="text" id="vault-new-key" placeholder="Item key (e.g. api-token)" ';
            html += 'style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;">';
            html += '</div>';
            html += '<div style="margin-bottom:8px;">';
            html += '<textarea id="vault-new-value" placeholder="Secret value or data (JSON or plain text)" ';
            html += 'rows="3" style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;resize:vertical;"></textarea>';
            html += '</div>';
            html += '<button onclick="VaultEncryption._uiAddItem()" ';
            html += 'style="padding:8px 18px;background:#27ae60;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;">Encrypt &amp; Store</button>';
            html += '<div id="vault-add-error" style="color:#e74c3c;margin-top:8px;display:none;"></div>';
            html += '<div id="vault-add-success" style="color:#27ae60;margin-top:8px;display:none;"></div>';
            html += '</div>';

            // Stored items list
            html += '<div style="background:#f8f9fa;border:1px solid #ddd;border-radius:3px;padding:16px;margin-bottom:18px;">';
            html += '<h3 style="margin-top:0;">Stored Items (' + keys.length + ')</h3>';
            if (keys.length === 0) {
                html += '<p style="color:#999;font-style:italic;">No encrypted items stored yet.</p>';
            } else {
                html += '<table style="width:100%;border-collapse:collapse;">';
                html += '<thead><tr style="border-bottom:2px solid #ddd;">';
                html += '<th style="text-align:left;padding:8px;">Key</th>';
                html += '<th style="text-align:right;padding:8px;width:200px;">Actions</th>';
                html += '</tr></thead><tbody>';
                keys.forEach(function(k) {
                    html += '<tr style="border-bottom:1px solid #eee;">';
                    html += '<td style="padding:8px;font-family:monospace;">' + esc(k) + '</td>';
                    html += '<td style="padding:8px;text-align:right;">';
                    html += '<button onclick="VaultEncryption._uiViewItem(' + JSON.stringify(k) + ')" ';
                    html += 'style="padding:4px 12px;margin-left:4px;background:#3498db;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">View</button>';
                    html += '<button onclick="VaultEncryption._uiDeleteItem(' + JSON.stringify(k) + ')" ';
                    html += 'style="padding:4px 12px;margin-left:4px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Delete</button>';
                    html += '</td>';
                    html += '</tr>';
                });
                html += '</tbody></table>';
            }
            html += '<div id="vault-item-display" style="margin-top:12px;display:none;background:#fff;border:1px solid #ccc;border-radius:4px;padding:12px;"></div>';
            html += '</div>';

            // Change passphrase form
            html += '<div style="background:#f8f9fa;border:1px solid #ddd;border-radius:3px;padding:16px;margin-bottom:18px;">';
            html += '<h3 style="margin-top:0;">Change Passphrase</h3>';
            html += '<div style="margin-bottom:8px;">';
            html += '<input type="password" id="vault-old-pass" placeholder="Current passphrase" ';
            html += 'style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;">';
            html += '</div>';
            html += '<div style="margin-bottom:8px;">';
            html += '<input type="password" id="vault-new-pass" placeholder="New passphrase" ';
            html += 'style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;">';
            html += '</div>';
            html += '<div style="margin-bottom:8px;">';
            html += '<input type="password" id="vault-confirm-pass" placeholder="Confirm new passphrase" ';
            html += 'style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;">';
            html += '</div>';
            html += '<button onclick="VaultEncryption._uiChangePass()" ';
            html += 'style="padding:8px 18px;background:#f39c12;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;">Change Passphrase</button>';
            html += '<div id="vault-pass-error" style="color:#e74c3c;margin-top:8px;display:none;"></div>';
            html += '<div id="vault-pass-success" style="color:#27ae60;margin-top:8px;display:none;"></div>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ---- Internal UI action handlers ----

    function _refreshVaultTab() {
        var el = document.getElementById('tab-vault');
        if (el) el.innerHTML = renderVaultUI();
    }

    function _uiUnlock() {
        var input = document.getElementById('vault-passphrase');
        var errEl = document.getElementById('vault-unlock-error');
        if (!input || !input.value) {
            if (errEl) { errEl.textContent = 'Please enter a passphrase.'; errEl.style.display = 'block'; }
            return;
        }
        unlock(input.value).then(function() {
            _refreshVaultTab();
        }).catch(function() {
            if (errEl) { errEl.textContent = 'Incorrect passphrase. Could not decrypt vault.'; errEl.style.display = 'block'; }
        });
    }

    function _uiLock() {
        lock();
        _refreshVaultTab();
    }

    function _uiAddItem() {
        var keyInput = document.getElementById('vault-new-key');
        var valInput = document.getElementById('vault-new-value');
        var errEl = document.getElementById('vault-add-error');
        var successEl = document.getElementById('vault-add-success');

        if (errEl) errEl.style.display = 'none';
        if (successEl) successEl.style.display = 'none';

        if (!keyInput || !keyInput.value.trim()) {
            if (errEl) { errEl.textContent = 'Please enter an item key.'; errEl.style.display = 'block'; }
            return;
        }
        if (!valInput || !valInput.value.trim()) {
            if (errEl) { errEl.textContent = 'Please enter a value.'; errEl.style.display = 'block'; }
            return;
        }

        var itemKey = keyInput.value.trim();
        var rawValue = valInput.value.trim();
        var data;
        try {
            data = JSON.parse(rawValue);
        } catch (e) {
            data = rawValue;
        }

        storeSecure(itemKey, data, cachedPassphrase).then(function() {
            _refreshVaultTab();
        }).catch(function(err) {
            if (errEl) { errEl.textContent = 'Encryption error: ' + err.message; errEl.style.display = 'block'; }
        });
    }

    function _uiViewItem(key) {
        var display = document.getElementById('vault-item-display');
        if (!display) return;

        display.style.display = 'block';
        display.innerHTML = '<em>Decrypting...</em>';

        retrieveSecure(key, cachedPassphrase).then(function(data) {
            var formatted = typeof data === 'string' ? esc(data) : '<pre style="margin:0;white-space:pre-wrap;word-break:break-all;">' + esc(JSON.stringify(data, null, 2)) + '</pre>';
            display.innerHTML = '<strong>' + esc(key) + '</strong><hr style="border:none;border-top:1px solid #ddd;margin:8px 0;">' + formatted;
        }).catch(function(err) {
            display.innerHTML = '<span style="color:#e74c3c;">Decryption failed: ' + esc(err.message) + '</span>';
        });
    }

    function _uiDeleteItem(key) {
        if (!confirm('Delete encrypted item "' + key + '"? This cannot be undone.')) return;
        deleteKey(key);
        _refreshVaultTab();
    }

    function _uiChangePass() {
        var oldInput = document.getElementById('vault-old-pass');
        var newInput = document.getElementById('vault-new-pass');
        var confirmInput = document.getElementById('vault-confirm-pass');
        var errEl = document.getElementById('vault-pass-error');
        var successEl = document.getElementById('vault-pass-success');

        if (errEl) errEl.style.display = 'none';
        if (successEl) successEl.style.display = 'none';

        if (!oldInput || !oldInput.value) {
            if (errEl) { errEl.textContent = 'Please enter current passphrase.'; errEl.style.display = 'block'; }
            return;
        }
        if (!newInput || !newInput.value) {
            if (errEl) { errEl.textContent = 'Please enter a new passphrase.'; errEl.style.display = 'block'; }
            return;
        }
        if (newInput.value !== confirmInput.value) {
            if (errEl) { errEl.textContent = 'New passphrases do not match.'; errEl.style.display = 'block'; }
            return;
        }
        if (newInput.value.length < 8) {
            if (errEl) { errEl.textContent = 'New passphrase must be at least 8 characters.'; errEl.style.display = 'block'; }
            return;
        }

        changePassphrase(oldInput.value, newInput.value).then(function() {
            if (successEl) { successEl.textContent = 'Passphrase changed successfully. All items re-encrypted.'; successEl.style.display = 'block'; }
            if (oldInput) oldInput.value = '';
            if (newInput) newInput.value = '';
            if (confirmInput) confirmInput.value = '';
        }).catch(function(err) {
            if (errEl) { errEl.textContent = 'Failed to change passphrase: ' + err.message; errEl.style.display = 'block'; }
        });
    }

    // ---- Public API ----

    return {
        deriveKey: deriveKey,
        encrypt: encrypt,
        decrypt: decrypt,
        storeSecure: storeSecure,
        retrieveSecure: retrieveSecure,
        listKeys: listKeys,
        deleteKey: deleteKey,
        changePassphrase: changePassphrase,
        isLocked: isLocked,
        lock: lock,
        unlock: unlock,
        renderVaultUI: renderVaultUI,
        // Internal UI handlers (exposed for onclick bindings)
        _uiUnlock: _uiUnlock,
        _uiLock: _uiLock,
        _uiAddItem: _uiAddItem,
        _uiViewItem: _uiViewItem,
        _uiDeleteItem: _uiDeleteItem,
        _uiChangePass: _uiChangePass
    };

})();
