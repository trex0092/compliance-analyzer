/**
 * Authentication & Role-Based Access Control Module
 * Client-side auth with localStorage/IndexedDB for compliance analysis web app.
 */
const AuthRBAC = (function () {
    // --------------- Constants ---------------
    const STORAGE_KEYS = {
        users: 'fgl_users',
        sessions: 'fgl_sessions',
        authLog: 'fgl_auth_log'
    };

    const SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

    const ROLES = {
        ADMIN: 'Admin',
        COMPLIANCE_OFFICER: 'Compliance Officer',
        ANALYST: 'Analyst',
        VIEWER: 'Viewer'
    };

    const PERMISSIONS = {
        [ROLES.ADMIN]: [
            'dashboard', 'analysis', 'reports', 'evidence', 'incidents',
            'settings', 'user_management', 'audit_log', 'export', 'import'
        ],
        [ROLES.COMPLIANCE_OFFICER]: [
            'dashboard', 'analysis', 'reports', 'evidence', 'incidents',
            'settings', 'export', 'import'
        ],
        [ROLES.ANALYST]: [
            'dashboard', 'analysis', 'reports', 'evidence',
            'settings_read', 'export'
        ],
        [ROLES.VIEWER]: [
            'dashboard', 'reports'
        ]
    };

    // --------------- Helpers: Storage ---------------
    function loadData(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function saveData(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    // --------------- Helpers: Crypto ---------------
    const PBKDF2_ITERATIONS = 100000;

    function arrayToHex(arr) {
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    function hexToArray(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
    }

    async function hashPasswordPBKDF2(password, salt) {
        const enc = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
        );
        const derived = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
            baseKey, 256
        );
        return arrayToHex(new Uint8Array(derived));
    }

    async function hashPassword(password, existingSalt) {
        const salt = existingSalt || crypto.getRandomValues(new Uint8Array(16));
        const hash = await hashPasswordPBKDF2(password, salt);
        return { hash, salt: arrayToHex(salt) };
    }

    function isLegacyHash(user) {
        return !user.passwordSalt;
    }

    async function legacyHash(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password + '_fgl_salt_2026');
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function generateToken() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }

    // --------------- Helpers: Audit Log ---------------
    function writeLog(entry) {
        const logs = loadData(STORAGE_KEYS.authLog) || [];
        logs.push({
            ...entry,
            timestamp: new Date().toISOString()
        });
        // Keep last 1000 entries
        if (logs.length > 1000) logs.splice(0, logs.length - 1000);
        saveData(STORAGE_KEYS.authLog, logs);
    }

    // --------------- Init: Default Admin ---------------
    function generateRandomPassword(length = 16) {
        const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
        const values = crypto.getRandomValues(new Uint8Array(length));
        return Array.from(values, v => charset[v % charset.length]).join('');
    }

    async function ensureDefaultAdmin() {
        // If users already exist (created by index.html setup wizard or prior sessions), skip
        let users = loadData(STORAGE_KEYS.users);
        if (users && users.length > 0) return;
        // No users at all — generate a cryptographically random temporary password.
        // The setup wizard should always run first; this is a safety fallback.
        const tempPassword = generateRandomPassword(20);
        const { hash, salt } = await hashPassword(tempPassword);
        users = [{
            id: String(Date.now()),
            username: 'admin',
            displayName: 'Admin',
            passwordHash: hash,
            passwordSalt: salt,
            role: 'admin',
            createdAt: new Date().toISOString(),
            mustChangePassword: true,
            active: true
        }];
        saveData(STORAGE_KEYS.users, users);
        // Surface the temp password so admin can log in once, then must change it
        console.warn('[AuthRBAC] Default admin created with temporary password. Run the setup wizard to set a permanent password.');
        if (typeof toast === 'function') {
            toast('Default admin created — please use the setup wizard to set your password.', 'error', 10000);
        }
    }

    // --------------- Sessions ---------------
    function getActiveSessions() {
        const sessions = loadData(STORAGE_KEYS.sessions) || [];
        const now = Date.now();
        return sessions.filter(s => s.expiresAt > now);
    }

    function saveSession(session) {
        const sessions = getActiveSessions();
        sessions.push(session);
        saveData(STORAGE_KEYS.sessions, sessions);
    }

    function removeSession(token) {
        const sessions = getActiveSessions().filter(s => s.token !== token);
        saveData(STORAGE_KEYS.sessions, sessions);
    }

    function getCurrentSession() {
        const token = sessionStorage.getItem('fgl_current_token');
        if (!token) return null;
        const sessions = getActiveSessions();
        return sessions.find(s => s.token === token) || null;
    }

    // --------------- Brute Force Protection ---------------
    const MAX_FAILED_ATTEMPTS = 5;
    const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
    const failedAttempts = {}; // { username: { count, lockedUntil } }

    function checkLockout(username) {
        const record = failedAttempts[username];
        if (!record) return false;
        if (record.lockedUntil && Date.now() < record.lockedUntil) {
            const minutesLeft = Math.ceil((record.lockedUntil - Date.now()) / 60000);
            throw new Error(`Account locked. Try again in ${minutesLeft} minute(s).`);
        }
        if (record.lockedUntil && Date.now() >= record.lockedUntil) {
            delete failedAttempts[username];
        }
        return false;
    }

    function recordFailedAttempt(username) {
        if (!failedAttempts[username]) failedAttempts[username] = { count: 0 };
        failedAttempts[username].count++;
        if (failedAttempts[username].count >= MAX_FAILED_ATTEMPTS) {
            failedAttempts[username].lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
            writeLog({ event: 'account_locked', username, reason: `${MAX_FAILED_ATTEMPTS} failed attempts` });
        }
    }

    function clearFailedAttempts(username) {
        delete failedAttempts[username];
    }

    // --------------- Core Auth ---------------
    async function login(username, password) {
        await ensureDefaultAdmin();
        checkLockout(username);
        const users = loadData(STORAGE_KEYS.users) || [];
        const user = users.find(u => u.username === username && u.active);

        if (!user) {
            recordFailedAttempt(username);
            writeLog({ event: 'login_failed', username, reason: 'User not found' });
            throw new Error('Invalid username or password.');
        }

        let passwordValid = false;
        if (isLegacyHash(user)) {
            const oldHash = await legacyHash(password);
            if (oldHash === user.passwordHash) {
                passwordValid = true;
                const { hash, salt } = await hashPassword(password);
                user.passwordHash = hash;
                user.passwordSalt = salt;
                saveData(STORAGE_KEYS.users, users);
                writeLog({ event: 'hash_upgraded', username, userId: user.id });
            }
        } else {
            const saltBytes = hexToArray(user.passwordSalt);
            const { hash } = await hashPassword(password, saltBytes);
            passwordValid = (hash === user.passwordHash);
        }

        if (!passwordValid) {
            recordFailedAttempt(username);
            writeLog({ event: 'login_failed', username, reason: 'Wrong password' });
            const record = failedAttempts[username];
            if (record && record.lockedUntil) {
                throw new Error('Too many failed attempts. Account locked for 15 minutes.');
            }
            throw new Error('Invalid username or password.');
        }

        clearFailedAttempts(username);

        const token = generateToken();
        const session = {
            token,
            userId: user.id,
            username: user.username,
            role: user.role,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            expiresAt: Date.now() + SESSION_DURATION_MS
        };
        saveSession(session);
        enforceSessionLimit(user.id);
        sessionStorage.setItem('fgl_current_token', token);

        writeLog({ event: 'login_success', username, userId: user.id });

        return {
            username: user.username,
            role: user.role,
            mustChangePassword: user.mustChangePassword || false
        };
    }

    function logout() {
        const session = getCurrentSession();
        if (session) {
            writeLog({ event: 'logout', username: session.username, userId: session.userId });
            removeSession(session.token);
        }
        sessionStorage.removeItem('fgl_current_token');
    }

    function getCurrentUser() {
        const session = getCurrentSession();
        if (!session) return null;
        const users = loadData(STORAGE_KEYS.users) || [];
        const user = users.find(u => u.id === session.userId);
        if (!user) return null;
        return {
            id: user.id,
            username: user.username,
            role: user.role,
            mustChangePassword: user.mustChangePassword || false
        };
    }

    function hasPermission(feature) {
        const user = getCurrentUser();
        if (!user) return false;
        const perms = PERMISSIONS[user.role] || [];
        return perms.includes(feature);
    }

    function requirePermission(feature) {
        if (!hasPermission(feature)) {
            const user = getCurrentUser();
            writeLog({
                event: 'permission_denied',
                username: user ? user.username : 'anonymous',
                feature
            });
            throw new Error('Permission denied.');
        }
    }

    // --------------- User Management (Admin) ---------------
    async function createUser(userData) {
        requirePermission('user_management');
        const users = loadData(STORAGE_KEYS.users) || [];

        if (users.find(u => u.username === userData.username)) {
            throw new Error('Username already exists.');
        }
        if (!userData.username || !userData.password || !userData.role) {
            throw new Error('Username, password, and role are required.');
        }
        if (!Object.values(ROLES).includes(userData.role)) {
            throw new Error('Invalid role.');
        }
        const policyError = validatePasswordPolicy(userData.password);
        if (policyError) throw new Error(policyError);

        const { hash, salt } = await hashPassword(userData.password);
        const newUser = {
            id: generateToken().slice(0, 16),
            username: userData.username,
            passwordHash: hash,
            passwordSalt: salt,
            role: userData.role,
            createdAt: new Date().toISOString(),
            mustChangePassword: false,
            active: true
        };
        users.push(newUser);
        saveData(STORAGE_KEYS.users, users);

        writeLog({
            event: 'user_created',
            username: getCurrentUser().username,
            targetUser: newUser.username,
            role: newUser.role
        });

        return { id: newUser.id, username: newUser.username, role: newUser.role };
    }

    async function updateUser(userId, updates) {
        requirePermission('user_management');
        const users = loadData(STORAGE_KEYS.users) || [];
        const idx = users.findIndex(u => u.id === userId);
        if (idx === -1) throw new Error('User not found.');

        if (updates.role && !Object.values(ROLES).includes(updates.role)) {
            throw new Error('Invalid role.');
        }
        if (updates.username) {
            const dupe = users.find(u => u.username === updates.username && u.id !== userId);
            if (dupe) throw new Error('Username already taken.');
            users[idx].username = updates.username;
        }
        if (updates.role) users[idx].role = updates.role;
        if (updates.active !== undefined) users[idx].active = updates.active;
        if (updates.password) {
            const policyError = validatePasswordPolicy(updates.password);
            if (policyError) throw new Error(policyError);
            const { hash, salt } = await hashPassword(updates.password);
            users[idx].passwordHash = hash;
            users[idx].passwordSalt = salt;
            users[idx].passwordChangedAt = new Date().toISOString();
            users[idx].mustChangePassword = false;
        }

        saveData(STORAGE_KEYS.users, users);
        writeLog({
            event: 'user_updated',
            username: getCurrentUser().username,
            targetUser: users[idx].username,
            changes: Object.keys(updates).join(', ')
        });
    }

    function deleteUser(userId) {
        requirePermission('user_management');
        const users = loadData(STORAGE_KEYS.users) || [];
        const target = users.find(u => u.id === userId);
        if (!target) throw new Error('User not found.');

        const current = getCurrentUser();
        if (current && current.id === userId) {
            throw new Error('Cannot delete your own account.');
        }

        const filtered = users.filter(u => u.id !== userId);
        saveData(STORAGE_KEYS.users, filtered);

        // Remove their sessions
        const sessions = getActiveSessions().filter(s => s.userId !== userId);
        saveData(STORAGE_KEYS.sessions, sessions);

        writeLog({
            event: 'user_deleted',
            username: current.username,
            targetUser: target.username
        });
    }

    function listUsers() {
        requirePermission('user_management');
        const users = loadData(STORAGE_KEYS.users) || [];
        return users.map(u => ({
            id: u.id,
            username: u.username,
            role: u.role,
            active: u.active,
            createdAt: u.createdAt
        }));
    }

    function getLoginHistory(limit = 50) {
        requirePermission('user_management');
        const logs = loadData(STORAGE_KEYS.authLog) || [];
        return logs
            .filter(l => ['login_success', 'login_failed', 'logout'].includes(l.event))
            .slice(-limit)
            .reverse();
    }

    function getActiveSessionsOverview() {
        requirePermission('user_management');
        return getActiveSessions().map(s => ({
            username: s.username,
            role: s.role,
            createdAt: new Date(s.createdAt).toISOString(),
            expiresAt: new Date(s.expiresAt).toISOString()
        }));
    }

    async function changeOwnPassword(currentPassword, newPassword) {
        const user = getCurrentUser();
        if (!user) throw new Error('Not authenticated.');
        const users = loadData(STORAGE_KEYS.users) || [];
        const record = users.find(u => u.id === user.id);
        if (!record) throw new Error('User record not found.');

        let currentValid = false;
        if (isLegacyHash(record)) {
            const oldHash = await legacyHash(currentPassword);
            currentValid = (oldHash === record.passwordHash);
        } else {
            const saltBytes = hexToArray(record.passwordSalt);
            const { hash } = await hashPassword(currentPassword, saltBytes);
            currentValid = (hash === record.passwordHash);
        }
        if (!currentValid) {
            throw new Error('Current password is incorrect.');
        }

        const policyError = validatePasswordPolicy(newPassword);
        if (policyError) throw new Error(policyError);

        const { hash, salt } = await hashPassword(newPassword);
        record.passwordHash = hash;
        record.passwordSalt = salt;
        record.mustChangePassword = false;
        record.passwordChangedAt = new Date().toISOString();
        saveData(STORAGE_KEYS.users, users);

        writeLog({ event: 'password_changed', username: user.username, userId: user.id });
    }

    // --------------- UI: Login Screen ---------------
    function renderLoginScreen(container) {
        const target = container || document.getElementById('app') || document.body;
        target.innerHTML = `
            <div id="fgl-login-overlay" style="
                position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
                background:var(--bg,#0a0a0f);z-index:10000;font-family:inherit;
            ">
                <div style="
                    background:var(--surface,#1a1a2e);border:1px solid var(--border,#2a2a3e);
                    border-radius:4px;padding:40px;width:380px;max-width:90vw;
                ">
                    <h2 style="color:var(--gold,#d4a843);margin:0 0 8px;font-size:1.5rem;text-align:center;">
                        Hawkeye Sterling V2
                    </h2>
                    <p style="color:var(--muted,#8888aa);text-align:center;margin:0 0 28px;font-size:0.85rem;">
                        Sign in to continue
                    </p>
                    <div id="fgl-login-error" style="
                        display:none;background:#3a1a1a;border:1px solid #6a2a2a;
                        color:#f08080;padding:10px 14px;border-radius:3px;margin-bottom:16px;
                        font-size:0.85rem;
                    "></div>
                    <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:6px;">Username</label>
                    <input id="fgl-login-user" type="text" autocomplete="username" style="
                        width:100%;padding:10px 12px;margin-bottom:16px;border-radius:3px;
                        border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                        color:var(--text,#e0e0e0);font-size:0.95rem;box-sizing:border-box;
                        outline:none;
                    " />
                    <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:6px;">Password</label>
                    <input id="fgl-login-pass" type="password" autocomplete="current-password" style="
                        width:100%;padding:10px 12px;margin-bottom:24px;border-radius:3px;
                        border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                        color:var(--text,#e0e0e0);font-size:0.95rem;box-sizing:border-box;
                        outline:none;
                    " />
                    <button id="fgl-login-btn" style="
                        width:100%;padding:12px;border:none;border-radius:3px;
                        background:var(--gold,#d4a843);color:#000;font-weight:600;
                        font-size:0.95rem;cursor:pointer;transition:opacity 0.2s;
                    ">Sign In</button>
                </div>
            </div>
        `;

        const btn = document.getElementById('fgl-login-btn');
        const userInput = document.getElementById('fgl-login-user');
        const passInput = document.getElementById('fgl-login-pass');
        const errBox = document.getElementById('fgl-login-error');

        async function doLogin() {
            errBox.style.display = 'none';
            btn.disabled = true;
            btn.textContent = 'Signing in...';
            try {
                const result = await login(userInput.value.trim(), passInput.value);
                const overlay = document.getElementById('fgl-login-overlay');
                if (overlay) overlay.remove();
                if (result.mustChangePassword) {
                    renderChangePasswordPrompt(target);
                } else {
                    document.dispatchEvent(new CustomEvent('fgl:auth:login', { detail: result }));
                }
            } catch (err) {
                errBox.textContent = err.message;
                errBox.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Sign In';
            }
        }

        btn.addEventListener('click', doLogin);
        passInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
        userInput.addEventListener('keydown', e => { if (e.key === 'Enter') passInput.focus(); });
        setTimeout(() => userInput.focus(), 50);
    }

    function renderChangePasswordPrompt(container) {
        const target = container || document.getElementById('app') || document.body;
        const overlay = document.createElement('div');
        overlay.id = 'fgl-chpw-overlay';
        overlay.style.cssText = `
            position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
            background:var(--bg,#0a0a0f);z-index:10001;font-family:inherit;
        `;
        overlay.innerHTML = `
            <div style="
                background:var(--surface,#1a1a2e);border:1px solid var(--border,#2a2a3e);
                border-radius:4px;padding:40px;width:380px;max-width:90vw;
            ">
                <h2 style="color:var(--gold,#d4a843);margin:0 0 8px;font-size:1.3rem;text-align:center;">
                    Change Default Password
                </h2>
                <p style="color:var(--muted,#8888aa);text-align:center;margin:0 0 16px;font-size:0.85rem;">
                    You must change the default admin password before continuing.
                </p>
                <div style="background:var(--surface2,#12121f);border:1px solid var(--border,#2a2a3e);border-radius:3px;padding:10px 14px;margin-bottom:20px;font-size:0.78rem;color:var(--muted,#8888aa);line-height:1.5;">
                    <strong style="color:var(--gold,#d4a843);">Password Policy:</strong> Min ${PASSWORD_POLICY.minLength} chars, uppercase, lowercase, digit, and special character required.
                </div>
                <div id="fgl-chpw-error" style="
                    display:none;background:#3a1a1a;border:1px solid #6a2a2a;
                    color:#f08080;padding:10px 14px;border-radius:3px;margin-bottom:16px;
                    font-size:0.85rem;
                "></div>
                <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:6px;">New Password</label>
                <input id="fgl-chpw-new" type="password" style="
                    width:100%;padding:10px 12px;margin-bottom:16px;border-radius:3px;
                    border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                    color:var(--text,#e0e0e0);font-size:0.95rem;box-sizing:border-box;outline:none;
                " />
                <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:6px;">Confirm Password</label>
                <input id="fgl-chpw-confirm" type="password" style="
                    width:100%;padding:10px 12px;margin-bottom:24px;border-radius:3px;
                    border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                    color:var(--text,#e0e0e0);font-size:0.95rem;box-sizing:border-box;outline:none;
                " />
                <button id="fgl-chpw-btn" style="
                    width:100%;padding:12px;border:none;border-radius:3px;
                    background:var(--gold,#d4a843);color:#000;font-weight:600;
                    font-size:0.95rem;cursor:pointer;
                ">Update Password</button>
            </div>
        `;
        target.appendChild(overlay);

        const btn = document.getElementById('fgl-chpw-btn');
        const newInput = document.getElementById('fgl-chpw-new');
        const confirmInput = document.getElementById('fgl-chpw-confirm');
        const errBox = document.getElementById('fgl-chpw-error');

        btn.addEventListener('click', async () => {
            errBox.style.display = 'none';
            const np = newInput.value;
            const cp = confirmInput.value;
            const policyErr = validatePasswordPolicy(np);
            if (policyErr) {
                errBox.textContent = policyErr;
                errBox.style.display = 'block';
                return;
            }
            if (np !== cp) {
                errBox.textContent = 'Passwords do not match.';
                errBox.style.display = 'block';
                return;
            }
            try {
                await changeOwnPassword('admin123', np);
                overlay.remove();
                const user = getCurrentUser();
                document.dispatchEvent(new CustomEvent('fgl:auth:login', { detail: user }));
            } catch (err) {
                errBox.textContent = err.message;
                errBox.style.display = 'block';
            }
        });
        setTimeout(() => newInput.focus(), 50);
    }

    // --------------- UI: User Management Panel ---------------
    function renderUserManagement(container) {
        const target = container || document.getElementById('app') || document.body;

        if (!hasPermission('user_management')) {
            target.innerHTML = `<p style="color:#f08080;padding:20px;">Access denied. Admin privileges required.</p>`;
            return;
        }

        function render() {
            const users = listUsers();
            const sessions = getActiveSessionsOverview();
            const history = getLoginHistory(20);

            target.innerHTML = `
                <div style="padding:24px;color:var(--text,#e0e0e0);font-family:inherit;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
                        <h2 style="color:var(--gold,#d4a843);margin:0;font-size:1.4rem;">User Management</h2>
                        <button id="fgl-um-add-btn" style="
                            padding:8px 18px;border:none;border-radius:3px;
                            background:var(--gold,#d4a843);color:#000;font-weight:600;
                            cursor:pointer;font-size:0.85rem;
                        ">+ Add User</button>
                    </div>

                    <!-- Users Table -->
                    <div style="
                        background:var(--surface,#1a1a2e);border:1px solid var(--border,#2a2a3e);
                        border-radius:3px;overflow:hidden;margin-bottom:24px;
                    ">
                        <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                            <thead>
                                <tr style="background:var(--surface2,#12121f);">
                                    <th style="text-align:left;padding:12px 16px;color:var(--muted,#8888aa);font-weight:500;">Username</th>
                                    <th style="text-align:left;padding:12px 16px;color:var(--muted,#8888aa);font-weight:500;">Role</th>
                                    <th style="text-align:left;padding:12px 16px;color:var(--muted,#8888aa);font-weight:500;">Status</th>
                                    <th style="text-align:left;padding:12px 16px;color:var(--muted,#8888aa);font-weight:500;">Created</th>
                                    <th style="text-align:right;padding:12px 16px;color:var(--muted,#8888aa);font-weight:500;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${users.map(u => `
                                    <tr style="border-top:1px solid var(--border,#2a2a3e);">
                                        <td style="padding:10px 16px;">${escapeHtml(u.username)}</td>
                                        <td style="padding:10px 16px;">
                                            <span style="
                                                padding:3px 10px;border-radius:4px;font-size:0.78rem;
                                                background:${roleBadgeColor(u.role)};color:#000;font-weight:500;
                                            ">${escapeHtml(u.role)}</span>
                                        </td>
                                        <td style="padding:10px 16px;">
                                            <span style="color:${u.active ? '#4ade80' : '#f08080'};">
                                                ${u.active ? 'Active' : 'Disabled'}
                                            </span>
                                        </td>
                                        <td style="padding:10px 16px;color:var(--muted,#8888aa);">
                                            ${new Date(u.createdAt).toLocaleDateString('en-GB')}
                                        </td>
                                        <td style="padding:10px 16px;text-align:right;">
                                            <button class="btn btn-sm btn-gold fgl-um-edit" data-id="${u.id}" style="
                                                padding:4px 12px;font-size:0.78rem;margin-right:4px;
                                            ">Edit</button>
                                            <button class="fgl-um-del" data-id="${u.id}" data-name="${escapeHtml(u.username)}" style="
                                                padding:4px 12px;border:1px solid #6a2a2a;
                                                border-radius:4px;background:transparent;color:#f08080;
                                                cursor:pointer;font-size:0.78rem;
                                            ">Delete</button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>

                    <!-- Active Sessions -->
                    <h3 style="color:var(--gold,#d4a843);margin:0 0 12px;font-size:1.1rem;">Active Sessions</h3>
                    <div style="
                        background:var(--surface,#1a1a2e);border:1px solid var(--border,#2a2a3e);
                        border-radius:3px;overflow:hidden;margin-bottom:24px;
                    ">
                        ${sessions.length === 0
                            ? '<p style="padding:16px;color:var(--muted,#8888aa);margin:0;font-size:0.85rem;">No active sessions.</p>'
                            : `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                                <thead>
                                    <tr style="background:var(--surface2,#12121f);">
                                        <th style="text-align:left;padding:10px 16px;color:var(--muted,#8888aa);font-weight:500;">User</th>
                                        <th style="text-align:left;padding:10px 16px;color:var(--muted,#8888aa);font-weight:500;">Role</th>
                                        <th style="text-align:left;padding:10px 16px;color:var(--muted,#8888aa);font-weight:500;">Expires</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${sessions.map(s => `
                                        <tr style="border-top:1px solid var(--border,#2a2a3e);">
                                            <td style="padding:8px 16px;">${escapeHtml(s.username)}</td>
                                            <td style="padding:8px 16px;">${escapeHtml(s.role)}</td>
                                            <td style="padding:8px 16px;color:var(--muted,#8888aa);">${new Date(s.expiresAt).toLocaleString('en-GB')}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>`
                        }
                    </div>

                    <!-- Login History -->
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <h3 style="color:var(--gold,#d4a843);margin:0;font-size:1.1rem;">Login History</h3>
                        <div style="display:flex;gap:6px;">
                            <button id="fgl-export-csv" class="btn btn-sm btn-gold" style="padding:5px 12px;font-size:0.75rem;">Export CSV</button>
                            <button id="fgl-export-json" class="btn btn-sm btn-gold" style="padding:5px 12px;font-size:0.75rem;">Export JSON</button>
                        </div>
                    </div>
                    <div style="
                        background:var(--surface,#1a1a2e);border:1px solid var(--border,#2a2a3e);
                        border-radius:3px;overflow:hidden;
                    ">
                        ${history.length === 0
                            ? '<p style="padding:16px;color:var(--muted,#8888aa);margin:0;font-size:0.85rem;">No login history.</p>'
                            : `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                                <thead>
                                    <tr style="background:var(--surface2,#12121f);">
                                        <th style="text-align:left;padding:10px 16px;color:var(--muted,#8888aa);font-weight:500;">Event</th>
                                        <th style="text-align:left;padding:10px 16px;color:var(--muted,#8888aa);font-weight:500;">User</th>
                                        <th style="text-align:left;padding:10px 16px;color:var(--muted,#8888aa);font-weight:500;">Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${history.map(h => `
                                        <tr style="border-top:1px solid var(--border,#2a2a3e);">
                                            <td style="padding:8px 16px;">
                                                <span style="color:${eventColor(h.event)};">${formatEvent(h.event)}</span>
                                            </td>
                                            <td style="padding:8px 16px;">${escapeHtml(h.username || 'unknown')}</td>
                                            <td style="padding:8px 16px;color:var(--muted,#8888aa);">${new Date(h.timestamp).toLocaleString('en-GB')}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>`
                        }
                    </div>
                </div>

                <!-- Add/Edit Modal (hidden) -->
                <div id="fgl-um-modal" style="
                    display:none;position:fixed;inset:0;z-index:10002;
                    background:rgba(0,0,0,0.6);align-items:center;justify-content:center;
                ">
                    <div style="
                        background:var(--surface,#1a1a2e);border:1px solid var(--border,#2a2a3e);
                        border-radius:4px;padding:32px;width:360px;max-width:90vw;
                    ">
                        <h3 id="fgl-um-modal-title" style="color:var(--gold,#d4a843);margin:0 0 20px;font-size:1.1rem;"></h3>
                        <div id="fgl-um-modal-error" style="
                            display:none;background:#3a1a1a;border:1px solid #6a2a2a;
                            color:#f08080;padding:8px 12px;border-radius:3px;margin-bottom:12px;font-size:0.83rem;
                        "></div>
                        <input id="fgl-um-modal-id" type="hidden" />
                        <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:4px;">Username</label>
                        <input id="fgl-um-modal-user" type="text" style="
                            width:100%;padding:8px 10px;margin-bottom:12px;border-radius:3px;
                            border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                            color:var(--text,#e0e0e0);font-size:0.9rem;box-sizing:border-box;outline:none;
                        " />
                        <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:4px;">Password <span id="fgl-um-modal-pw-hint" style="color:var(--muted,#8888aa);"></span></label>
                        <input id="fgl-um-modal-pass" type="password" style="
                            width:100%;padding:8px 10px;margin-bottom:12px;border-radius:3px;
                            border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                            color:var(--text,#e0e0e0);font-size:0.9rem;box-sizing:border-box;outline:none;
                        " />
                        <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:4px;">Role</label>
                        <select id="fgl-um-modal-role" style="
                            width:100%;padding:8px 10px;margin-bottom:20px;border-radius:3px;
                            border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                            color:var(--text,#e0e0e0);font-size:0.9rem;box-sizing:border-box;outline:none;
                        ">
                            ${Object.values(ROLES).map(r => `<option value="${r}">${r}</option>`).join('')}
                        </select>
                        <div style="display:flex;gap:8px;">
                            <button id="fgl-um-modal-save" style="
                                flex:1;padding:10px;border:none;border-radius:3px;
                                background:var(--gold,#d4a843);color:#000;font-weight:600;cursor:pointer;font-size:0.9rem;
                            ">Save</button>
                            <button id="fgl-um-modal-cancel" style="
                                flex:1;padding:10px;border:1px solid var(--border,#2a2a3e);border-radius:3px;
                                background:transparent;color:var(--text,#e0e0e0);cursor:pointer;font-size:0.9rem;
                            ">Cancel</button>
                        </div>
                    </div>
                </div>
            `;

            // Bind events
            document.getElementById('fgl-export-csv')?.addEventListener('click', () => {
                if (exportAuditLogCSV()) { if (typeof toast === 'function') toast('Audit log exported (CSV)', 'success'); }
                else { if (typeof toast === 'function') toast('No audit entries to export', 'info'); }
            });
            document.getElementById('fgl-export-json')?.addEventListener('click', () => {
                if (exportAuditLogJSON()) { if (typeof toast === 'function') toast('Audit log exported (JSON)', 'success'); }
                else { if (typeof toast === 'function') toast('No audit entries to export', 'info'); }
            });
            document.getElementById('fgl-um-add-btn').addEventListener('click', () => openModal(null));
            target.querySelectorAll('.fgl-um-edit').forEach(btn => {
                btn.addEventListener('click', () => openModal(btn.dataset.id));
            });
            target.querySelectorAll('.fgl-um-del').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (confirm(`Delete user "${btn.dataset.name}"? This cannot be undone.`)) {
                        try {
                            deleteUser(btn.dataset.id);
                            render();
                        } catch (err) {
                            alert(err.message);
                        }
                    }
                });
            });
        }

        function openModal(editId) {
            const modal = document.getElementById('fgl-um-modal');
            const title = document.getElementById('fgl-um-modal-title');
            const idField = document.getElementById('fgl-um-modal-id');
            const userField = document.getElementById('fgl-um-modal-user');
            const passField = document.getElementById('fgl-um-modal-pass');
            const roleField = document.getElementById('fgl-um-modal-role');
            const pwHint = document.getElementById('fgl-um-modal-pw-hint');
            const errBox = document.getElementById('fgl-um-modal-error');
            errBox.style.display = 'none';

            if (editId) {
                const users = listUsers();
                const u = users.find(x => x.id === editId);
                if (!u) return;
                title.textContent = 'Edit User';
                idField.value = editId;
                userField.value = u.username;
                passField.value = '';
                roleField.value = u.role;
                pwHint.textContent = '(leave blank to keep current)';
            } else {
                title.textContent = 'Add User';
                idField.value = '';
                userField.value = '';
                passField.value = '';
                roleField.value = ROLES.ANALYST;
                pwHint.textContent = '';
            }

            modal.style.display = 'flex';

            document.getElementById('fgl-um-modal-cancel').onclick = () => { modal.style.display = 'none'; };
            document.getElementById('fgl-um-modal-save').onclick = async () => {
                errBox.style.display = 'none';
                try {
                    if (idField.value) {
                        const updates = { username: userField.value.trim(), role: roleField.value };
                        if (passField.value) updates.password = passField.value;
                        await updateUser(idField.value, updates);
                    } else {
                        await createUser({
                            username: userField.value.trim(),
                            password: passField.value,
                            role: roleField.value
                        });
                    }
                    modal.style.display = 'none';
                    render();
                } catch (err) {
                    errBox.textContent = err.message;
                    errBox.style.display = 'block';
                }
            };
        }

        render();
    }

    // --------------- UI Helpers ---------------
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function roleBadgeColor(role) {
        switch (role) {
            case ROLES.ADMIN: return '#d4a843';
            case ROLES.COMPLIANCE_OFFICER: return '#60a5fa';
            case ROLES.ANALYST: return '#4ade80';
            case ROLES.VIEWER: return '#a78bfa';
            default: return '#888';
        }
    }

    function eventColor(event) {
        switch (event) {
            case 'login_success': return '#4ade80';
            case 'login_failed': return '#f08080';
            case 'logout': return 'var(--muted,#8888aa)';
            default: return 'var(--text,#e0e0e0)';
        }
    }

    function formatEvent(event) {
        switch (event) {
            case 'login_success': return 'Login';
            case 'login_failed': return 'Failed Login';
            case 'logout': return 'Logout';
            default: return event;
        }
    }

    // --------------- Password Policy ---------------
    const PASSWORD_POLICY = {
        minLength: 10,
        requireUppercase: true,
        requireLowercase: true,
        requireDigit: true,
        requireSpecial: true,
        maxAgeDays: 90
    };

    function validatePasswordPolicy(password) {
        if (!password || password.length < PASSWORD_POLICY.minLength) {
            return `Password must be at least ${PASSWORD_POLICY.minLength} characters.`;
        }
        if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
            return 'Password must contain at least one uppercase letter.';
        }
        if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
            return 'Password must contain at least one lowercase letter.';
        }
        if (PASSWORD_POLICY.requireDigit && !/[0-9]/.test(password)) {
            return 'Password must contain at least one digit.';
        }
        if (PASSWORD_POLICY.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
            return 'Password must contain at least one special character.';
        }
        return null;
    }

    function isPasswordExpired(user) {
        if (!user) return false;
        const users = loadData(STORAGE_KEYS.users) || [];
        const record = users.find(u => u.id === user.id);
        if (!record || !record.passwordChangedAt) return false;
        const changedAt = new Date(record.passwordChangedAt).getTime();
        const maxAge = PASSWORD_POLICY.maxAgeDays * 24 * 60 * 60 * 1000;
        return Date.now() - changedAt > maxAge;
    }

    // --------------- Session Hardening ---------------
    const MAX_CONCURRENT_SESSIONS = 3;
    const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    let idleTimer = null;

    function enforceSessionLimit(userId) {
        const sessions = getActiveSessions().filter(s => s.userId === userId);
        if (sessions.length > MAX_CONCURRENT_SESSIONS) {
            const toRemove = sessions
                .sort((a, b) => a.createdAt - b.createdAt)
                .slice(0, sessions.length - MAX_CONCURRENT_SESSIONS);
            const allSessions = getActiveSessions().filter(
                s => !toRemove.some(r => r.token === s.token)
            );
            saveData(STORAGE_KEYS.sessions, allSessions);
        }
    }

    function touchSession() {
        const token = sessionStorage.getItem('fgl_current_token');
        if (!token) return;
        const sessions = loadData(STORAGE_KEYS.sessions) || [];
        const session = sessions.find(s => s.token === token);
        if (session) {
            session.lastActivity = Date.now();
            saveData(STORAGE_KEYS.sessions, sessions);
        }
    }

    var _idleListeners = [];

    function startIdleMonitor(onIdle) {
        stopIdleMonitor();
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        function resetTimer() {
            touchSession();
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                const session = getCurrentSession();
                if (session) {
                    writeLog({ event: 'idle_timeout', username: session.username, userId: session.userId });
                    logout();
                    if (typeof onIdle === 'function') onIdle();
                }
            }, IDLE_TIMEOUT_MS);
        }
        events.forEach(evt => {
            document.addEventListener(evt, resetTimer, { passive: true });
            _idleListeners.push({ evt, fn: resetTimer });
        });
        resetTimer();
    }

    function stopIdleMonitor() {
        clearTimeout(idleTimer);
        _idleListeners.forEach(l => document.removeEventListener(l.evt, l.fn));
        _idleListeners = [];
    }

    // --------------- Audit Log Export ---------------
    function getFullAuditLog() {
        return loadData(STORAGE_KEYS.authLog) || [];
    }

    function exportAuditLogCSV() {
        const logs = getFullAuditLog();
        if (!logs.length) return null;
        const headers = ['Timestamp', 'Event', 'Username', 'Details'];
        const rows = logs.map(l => [
            l.timestamp || '',
            l.event || '',
            l.username || '',
            (l.reason || l.targetUser || l.feature || l.changes || '').replace(/"/g, '""')
        ]);
        const csv = [headers.join(',')]
            .concat(rows.map(r => r.map(c => `"${c}"`).join(',')))
            .join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        return true;
    }

    function exportAuditLogJSON() {
        const logs = getFullAuditLog();
        if (!logs.length) return null;
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return true;
    }

    // --------------- Init on load ---------------
    // Note: Do NOT auto-create admin user here — the index.html setup wizard
    // handles first-time user creation with its own schema. Only call
    // ensureDefaultAdmin() if AuthRBAC is used as the primary auth system.

    // --------------- Public API ---------------
    return {
        login,
        logout,
        getCurrentUser,
        hasPermission,
        requirePermission,
        createUser,
        updateUser,
        deleteUser,
        listUsers,
        changeOwnPassword,
        getLoginHistory,
        getActiveSessionsOverview,
        renderLoginScreen,
        renderUserManagement,
        ROLES,
        PERMISSIONS,
        // Phase 2: New features
        validatePasswordPolicy,
        isPasswordExpired,
        PASSWORD_POLICY,
        enforceSessionLimit,
        startIdleMonitor,
        stopIdleMonitor,
        exportAuditLogCSV,
        exportAuditLogJSON,
        getFullAuditLog
    };
})();
