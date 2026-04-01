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

    const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

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
    async function hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
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
    async function ensureDefaultAdmin() {
        let users = loadData(STORAGE_KEYS.users);
        if (!users || users.length === 0) {
            const hash = await hashPassword('admin123');
            users = [{
                id: generateToken().slice(0, 16),
                username: 'admin',
                passwordHash: hash,
                role: ROLES.ADMIN,
                createdAt: new Date().toISOString(),
                mustChangePassword: true,
                active: true
            }];
            saveData(STORAGE_KEYS.users, users);
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

    // --------------- Core Auth ---------------
    async function login(username, password) {
        await ensureDefaultAdmin();
        const users = loadData(STORAGE_KEYS.users) || [];
        const user = users.find(u => u.username === username && u.active);

        if (!user) {
            writeLog({ event: 'login_failed', username, reason: 'User not found' });
            throw new Error('Invalid username or password.');
        }

        const hash = await hashPassword(password);
        if (hash !== user.passwordHash) {
            writeLog({ event: 'login_failed', username, reason: 'Wrong password' });
            throw new Error('Invalid username or password.');
        }

        const token = generateToken();
        const session = {
            token,
            userId: user.id,
            username: user.username,
            role: user.role,
            createdAt: Date.now(),
            expiresAt: Date.now() + SESSION_DURATION_MS
        };
        saveSession(session);
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

        const hash = await hashPassword(userData.password);
        const newUser = {
            id: generateToken().slice(0, 16),
            username: userData.username,
            passwordHash: hash,
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
            users[idx].passwordHash = await hashPassword(updates.password);
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

        const currentHash = await hashPassword(currentPassword);
        if (currentHash !== record.passwordHash) {
            throw new Error('Current password is incorrect.');
        }

        record.passwordHash = await hashPassword(newPassword);
        record.mustChangePassword = false;
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
                    border-radius:12px;padding:40px;width:380px;max-width:90vw;
                ">
                    <h2 style="color:var(--gold,#d4a843);margin:0 0 8px;font-size:1.5rem;text-align:center;">
                        Compliance Analyzer
                    </h2>
                    <p style="color:var(--muted,#8888aa);text-align:center;margin:0 0 28px;font-size:0.85rem;">
                        Sign in to continue
                    </p>
                    <div id="fgl-login-error" style="
                        display:none;background:#3a1a1a;border:1px solid #6a2a2a;
                        color:#f08080;padding:10px 14px;border-radius:6px;margin-bottom:16px;
                        font-size:0.85rem;
                    "></div>
                    <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:6px;">Username</label>
                    <input id="fgl-login-user" type="text" autocomplete="username" style="
                        width:100%;padding:10px 12px;margin-bottom:16px;border-radius:6px;
                        border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                        color:var(--text,#e0e0e0);font-size:0.95rem;box-sizing:border-box;
                        outline:none;
                    " />
                    <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:6px;">Password</label>
                    <input id="fgl-login-pass" type="password" autocomplete="current-password" style="
                        width:100%;padding:10px 12px;margin-bottom:24px;border-radius:6px;
                        border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                        color:var(--text,#e0e0e0);font-size:0.95rem;box-sizing:border-box;
                        outline:none;
                    " />
                    <button id="fgl-login-btn" style="
                        width:100%;padding:12px;border:none;border-radius:6px;
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
                border-radius:12px;padding:40px;width:380px;max-width:90vw;
            ">
                <h2 style="color:var(--gold,#d4a843);margin:0 0 8px;font-size:1.3rem;text-align:center;">
                    Change Default Password
                </h2>
                <p style="color:var(--muted,#8888aa);text-align:center;margin:0 0 24px;font-size:0.85rem;">
                    You must change the default admin password before continuing.
                </p>
                <div id="fgl-chpw-error" style="
                    display:none;background:#3a1a1a;border:1px solid #6a2a2a;
                    color:#f08080;padding:10px 14px;border-radius:6px;margin-bottom:16px;
                    font-size:0.85rem;
                "></div>
                <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:6px;">New Password</label>
                <input id="fgl-chpw-new" type="password" style="
                    width:100%;padding:10px 12px;margin-bottom:16px;border-radius:6px;
                    border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                    color:var(--text,#e0e0e0);font-size:0.95rem;box-sizing:border-box;outline:none;
                " />
                <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:6px;">Confirm Password</label>
                <input id="fgl-chpw-confirm" type="password" style="
                    width:100%;padding:10px 12px;margin-bottom:24px;border-radius:6px;
                    border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                    color:var(--text,#e0e0e0);font-size:0.95rem;box-sizing:border-box;outline:none;
                " />
                <button id="fgl-chpw-btn" style="
                    width:100%;padding:12px;border:none;border-radius:6px;
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
            if (np.length < 6) {
                errBox.textContent = 'Password must be at least 6 characters.';
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
                            padding:8px 18px;border:none;border-radius:6px;
                            background:var(--gold,#d4a843);color:#000;font-weight:600;
                            cursor:pointer;font-size:0.85rem;
                        ">+ Add User</button>
                    </div>

                    <!-- Users Table -->
                    <div style="
                        background:var(--surface,#1a1a2e);border:1px solid var(--border,#2a2a3e);
                        border-radius:8px;overflow:hidden;margin-bottom:24px;
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
                                                padding:3px 10px;border-radius:10px;font-size:0.78rem;
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
                                            <button class="fgl-um-edit" data-id="${u.id}" style="
                                                padding:4px 12px;border:1px solid var(--border,#2a2a3e);
                                                border-radius:4px;background:transparent;color:var(--text,#e0e0e0);
                                                cursor:pointer;font-size:0.78rem;margin-right:4px;
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
                        border-radius:8px;overflow:hidden;margin-bottom:24px;
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
                    <h3 style="color:var(--gold,#d4a843);margin:0 0 12px;font-size:1.1rem;">Login History</h3>
                    <div style="
                        background:var(--surface,#1a1a2e);border:1px solid var(--border,#2a2a3e);
                        border-radius:8px;overflow:hidden;
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
                        border-radius:12px;padding:32px;width:360px;max-width:90vw;
                    ">
                        <h3 id="fgl-um-modal-title" style="color:var(--gold,#d4a843);margin:0 0 20px;font-size:1.1rem;"></h3>
                        <div id="fgl-um-modal-error" style="
                            display:none;background:#3a1a1a;border:1px solid #6a2a2a;
                            color:#f08080;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:0.83rem;
                        "></div>
                        <input id="fgl-um-modal-id" type="hidden" />
                        <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:4px;">Username</label>
                        <input id="fgl-um-modal-user" type="text" style="
                            width:100%;padding:8px 10px;margin-bottom:12px;border-radius:6px;
                            border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                            color:var(--text,#e0e0e0);font-size:0.9rem;box-sizing:border-box;outline:none;
                        " />
                        <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:4px;">Password <span id="fgl-um-modal-pw-hint" style="color:var(--muted,#8888aa);"></span></label>
                        <input id="fgl-um-modal-pass" type="password" style="
                            width:100%;padding:8px 10px;margin-bottom:12px;border-radius:6px;
                            border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                            color:var(--text,#e0e0e0);font-size:0.9rem;box-sizing:border-box;outline:none;
                        " />
                        <label style="display:block;color:var(--text,#e0e0e0);font-size:0.8rem;margin-bottom:4px;">Role</label>
                        <select id="fgl-um-modal-role" style="
                            width:100%;padding:8px 10px;margin-bottom:20px;border-radius:6px;
                            border:1px solid var(--border,#2a2a3e);background:var(--surface2,#12121f);
                            color:var(--text,#e0e0e0);font-size:0.9rem;box-sizing:border-box;outline:none;
                        ">
                            ${Object.values(ROLES).map(r => `<option value="${r}">${r}</option>`).join('')}
                        </select>
                        <div style="display:flex;gap:8px;">
                            <button id="fgl-um-modal-save" style="
                                flex:1;padding:10px;border:none;border-radius:6px;
                                background:var(--gold,#d4a843);color:#000;font-weight:600;cursor:pointer;font-size:0.9rem;
                            ">Save</button>
                            <button id="fgl-um-modal-cancel" style="
                                flex:1;padding:10px;border:1px solid var(--border,#2a2a3e);border-radius:6px;
                                background:transparent;color:var(--text,#e0e0e0);cursor:pointer;font-size:0.9rem;
                            ">Cancel</button>
                        </div>
                    </div>
                </div>
            `;

            // Bind events
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

    // --------------- Init on load ---------------
    ensureDefaultAdmin();

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
        PERMISSIONS
    };
})();
