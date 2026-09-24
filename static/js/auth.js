/**
 * Project NIVM — Single-User Authentication & Lock Screen Module
 */

const AUTH_TOKEN_KEY = 'nivm_auth_token';

let currentAuthToken = localStorage.getItem(AUTH_TOKEN_KEY) || '';
let isUserAuthenticated = false;

// Global fetch interceptor to inject Bearer token and handle 401s
const _nativeFetch = window.fetch.bind(window);
window.fetch = async function(input, init = {}) {
    let url = typeof input === 'string' ? input : (input?.url || '');
    const isProtected = url.startsWith('/api/') || url.startsWith('/uploads/') || url.startsWith('/images/') ||
                        url.includes('/api/') || url.includes('/uploads/') || url.includes('/images/');
    
    let newInit = { ...init };
    if (isProtected) {
        const token = currentAuthToken;
        const headers = new Headers(newInit.headers || (input instanceof Request ? input.headers : {}));
        if (token && !headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        newInit.headers = headers;
        if (!newInit.credentials) {
            newInit.credentials = 'include';
        }
    }

    const response = await _nativeFetch(input, newInit);

    if (response.status === 401 && !url.includes('/api/auth/')) {
        isUserAuthenticated = false;
        if (window.__nivm_state) {
            window.__nivm_state.conversations = [];
            window.__nivm_state.activeChatId = null;
            window.__nivm_state.memory = {};
        }
        const chatContainer = document.getElementById('chatContainer');
        if (chatContainer) chatContainer.innerHTML = '';
        const historyList = document.getElementById('historyList');
        if (historyList) historyList.innerHTML = '';
        try {
            localStorage.removeItem('nivm_saved_chats');
        } catch (e) {}

        if (typeof window.showAuthLock === 'function') {
            window.showAuthLock();
        }
    }

    return response;
};

export function getAuthToken() {
    return currentAuthToken;
}

export function setAuthToken(token) {
    currentAuthToken = token || '';
    if (token) {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
        localStorage.removeItem(AUTH_TOKEN_KEY);
    }
}

export function clearAuthToken() {
    currentAuthToken = '';
    localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function isAuthenticated() {
    return isUserAuthenticated;
}

/* -------------------------------------------------------------
 * Futuristic Silk Flow Field Background Animation for Auth
 * -----------------------------------------------------------*/
let authFlowAnimId = null;
let authFlowParticles = [];
let authFlowCanvas = null;
let authFlowCtx = null;
let authFlowZ = 0;
let authMouse = { x: -1000, y: -1000, active: false, lastMove: 0 };
let authFlowInitialized = false;

// Fast Simplex 3D Noise tables
const _F3 = 1.0 / 3.0;
const _G3 = 1.0 / 6.0;
const _pTable = new Uint8Array(256);
for (let i = 0; i < 256; i++) _pTable[i] = i;
let _seed = 1337;
for (let i = 255; i > 0; i--) {
    _seed = (_seed * 16807) % 2147483647;
    const j = _seed % (i + 1);
    const temp = _pTable[i];
    _pTable[i] = _pTable[j];
    _pTable[j] = temp;
}
const _perm = new Uint8Array(512);
const _permMod12 = new Uint8Array(512);
for (let i = 0; i < 512; i++) {
    _perm[i] = _pTable[i & 255];
    _permMod12[i] = _perm[i] % 12;
}
const _grad3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
]);

function _simplex3(x, y, z) {
    const s = (x + y + z) * _F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * _G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + _G3;
    const y1 = y0 - j1 + _G3;
    const z1 = z0 - k1 + _G3;
    const x2 = x0 - i2 + 2.0 * _G3;
    const y2 = y0 - j2 + 2.0 * _G3;
    const z2 = z0 - k2 + 2.0 * _G3;
    const x3 = x0 - 1.0 + 3.0 * _G3;
    const y3 = y0 - 1.0 + 3.0 * _G3;
    const z3 = z0 - 1.0 + 3.0 * _G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
        const gi0 = _permMod12[ii + _perm[jj + _perm[kk]]] * 3;
        t0 *= t0;
        n0 = t0 * t0 * (_grad3[gi0] * x0 + _grad3[gi0 + 1] * y0 + _grad3[gi0 + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
        const gi1 = _permMod12[ii + i1 + _perm[jj + j1 + _perm[kk + k1]]] * 3;
        t1 *= t1;
        n1 = t1 * t1 * (_grad3[gi1] * x1 + _grad3[gi1 + 1] * y1 + _grad3[gi1 + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
        const gi2 = _permMod12[ii + i2 + _perm[jj + j2 + _perm[kk + k2]]] * 3;
        t2 *= t2;
        n2 = t2 * t2 * (_grad3[gi2] * x2 + _grad3[gi2 + 1] * y2 + _grad3[gi2 + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
        const gi3 = _permMod12[ii + 1 + _perm[jj + 1 + _perm[kk + 1]]] * 3;
        t3 *= t3;
        n3 = t3 * t3 * (_grad3[gi3] * x3 + _grad3[gi3 + 1] * y3 + _grad3[gi3 + 2] * z3);
    }

    return 32.0 * (n0 + n1 + n2 + n3);
}

class AuthParticle {
    constructor(w, h) {
        this.reset(w, h);
        this.life = Math.random() * this.maxLife;
    }

    reset(w, h) {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.prevX = this.x;
        this.prevY = this.y;
        this.life = Math.random() * 200 + 80;
        this.maxLife = this.life;
        this.speed = Math.random() * 0.4 + 0.8;
    }

    update(w, h, z, mouse) {
        this.prevX = this.x;
        this.prevY = this.y;

        const noiseScale = 0.0016;
        const n = _simplex3(this.x * noiseScale, this.y * noiseScale, z);
        const angle = n * Math.PI * 2.5;

        let vx = Math.cos(angle) * 1.8 * this.speed;
        let vy = Math.sin(angle) * 1.8 * this.speed;

        if (mouse.active) {
            const dx = this.x - mouse.x;
            const dy = this.y - mouse.y;
            const distSq = dx * dx + dy * dy;
            const maxDist = 220;
            if (distSq < maxDist * maxDist && distSq > 1) {
                const dist = Math.sqrt(distSq);
                const force = (1 - dist / maxDist) * 3.2;
                const swirl = Math.atan2(dy, dx) + Math.PI * 0.52;
                vx += Math.cos(swirl) * force;
                vy += Math.sin(swirl) * force;
            }
        }

        this.x += vx;
        this.y += vy;
        this.life--;

        if (this.life <= 0 || this.x < -20 || this.x > w + 20 || this.y < -20 || this.y > h + 20) {
            this.reset(w, h);
        }
    }
}

function initAuthFlow() {
    authFlowCanvas = document.getElementById('authFlowCanvas');
    if (!authFlowCanvas) return;
    authFlowCtx = authFlowCanvas.getContext('2d', { alpha: false });

    function resize() {
        if (!authFlowCanvas) return;
        authFlowCanvas.width = window.innerWidth;
        authFlowCanvas.height = window.innerHeight;
        if (authFlowCtx) {
            authFlowCtx.fillStyle = '#08080a';
            authFlowCtx.fillRect(0, 0, authFlowCanvas.width, authFlowCanvas.height);
        }
        const count = Math.min(420, Math.floor(window.innerWidth * 0.28));
        authFlowParticles = [];
        for (let i = 0; i < count; i++) {
            authFlowParticles.push(new AuthParticle(authFlowCanvas.width, authFlowCanvas.height));
        }
        // Pre-simulate steps so particles are instantly aligned
        for (let s = 0; s < 30; s++) {
            authFlowZ += 0.0016;
            for (let i = 0; i < authFlowParticles.length; i++) {
                authFlowParticles[i].update(authFlowCanvas.width, authFlowCanvas.height, authFlowZ, { active: false });
            }
        }
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', (e) => {
        authMouse.x = e.clientX;
        authMouse.y = e.clientY;
        authMouse.active = true;
        authMouse.lastMove = performance.now();
    });
    window.addEventListener('mouseleave', () => {
        authMouse.active = false;
    });

    resize();
    authFlowInitialized = true;
}

export function startAuthFlow() {
    if (!authFlowInitialized) {
        initAuthFlow();
    }
    if (!authFlowCanvas || !authFlowCtx) return;

    if (authFlowAnimId) {
        cancelAnimationFrame(authFlowAnimId);
        authFlowAnimId = null;
    }

    const canvas = authFlowCanvas;
    const ctx = authFlowCtx;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.4;

    function render() {
        const w = canvas.width;
        const h = canvas.height;

        if (authMouse.active && performance.now() - authMouse.lastMove > 2500) {
            authMouse.active = false;
        }

        // Soft fading dark wash creates silky trailing ribbons
        ctx.fillStyle = 'rgba(8, 8, 10, 0.085)';
        ctx.fillRect(0, 0, w, h);

        authFlowZ += 0.0018;

        for (let i = 0; i < authFlowParticles.length; i++) {
            const p = authFlowParticles[i];
            p.update(w, h, authFlowZ, authMouse);

            const ratio = p.life / p.maxLife;
            const alpha = Math.sin(ratio * Math.PI) * 0.35;
            if (alpha <= 0.02) continue;

            ctx.beginPath();
            ctx.moveTo(p.prevX, p.prevY);
            ctx.lineTo(p.x, p.y);
            ctx.strokeStyle = `rgba(240, 240, 245, ${alpha.toFixed(3)})`;
            ctx.stroke();
        }

        authFlowAnimId = requestAnimationFrame(render);
    }

    authFlowAnimId = requestAnimationFrame(render);
}

export function stopAuthFlow() {
    if (authFlowAnimId) {
        cancelAnimationFrame(authFlowAnimId);
        authFlowAnimId = null;
    }
}

/* -------------------------------------------------------------
 * Lock / Unlock UI Management
 * -----------------------------------------------------------*/

export function showAuthLock(showRecovery = false) {
    const overlay = document.getElementById('authLockOverlay');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    startAuthFlow();

    const recoverySec = document.getElementById('authRecoverySection');
    const loginForm = document.getElementById('authLoginForm');
    const errBadge = document.getElementById('authErrorBadge');
    const subtitle = document.getElementById('authSubtitle');

    if (errBadge) errBadge.classList.remove('visible');

    if (showRecovery) {
        if (subtitle) subtitle.textContent = 'Reset password';
        if (recoverySec) recoverySec.classList.add('visible');
        if (loginForm) loginForm.style.display = 'none';
        const recInput = document.getElementById('authRecoveryKeyInput');
        if (recInput) recInput.focus();
    } else {
        if (subtitle) subtitle.textContent = 'Enter password to continue';
        if (recoverySec) recoverySec.classList.remove('visible');
        if (loginForm) loginForm.style.display = 'flex';
        const pwdInput = document.getElementById('authPasswordInput');
        if (pwdInput) {
            pwdInput.value = '';
            setTimeout(() => pwdInput.focus(), 100);
        }
    }
}

export function hideAuthLock() {
    const overlay = document.getElementById('authLockOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
    stopAuthFlow();
    const errBadge = document.getElementById('authErrorBadge');
    if (errBadge) errBadge.classList.remove('visible');
}

function showAuthError(msg) {
    const badge = document.getElementById('authErrorBadge');
    const text = document.getElementById('authErrorMsg');
    if (badge && text) {
        text.textContent = msg || 'Authentication failed';
        badge.classList.remove('visible');
        void badge.offsetWidth; // re-trigger css animation
        badge.classList.add('visible');
    }
}

/**
 * Check active session against the backend.
 */
export async function checkAuthSession() {
    try {
        const headers = {};
        if (currentAuthToken) {
            headers['Authorization'] = `Bearer ${currentAuthToken}`;
        }

        const res = await fetch('/api/auth/session', {
            method: 'GET',
            headers,
            credentials: 'include',
            cache: 'no-store'
        });

        if (!res.ok) {
            isUserAuthenticated = false;
            return { authenticated: false, configured: true };
        }

        const data = await res.json();
        isUserAuthenticated = !!data.authenticated;
        return data;
    } catch (e) {
        console.warn('Auth session check failed (backend offline?):', e);
        return { authenticated: false, configured: true };
    }
}

/**
 * Perform login against /api/auth/login with password.
 */
async function _authPost(endpoint, body) {
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'Authentication failed');
    if (data.token) setAuthToken(data.token);
    isUserAuthenticated = true;
    return data;
}

export function loginOwner(password) {
    return _authPost('/api/auth/login', { password });
}

export function resetPasswordWithKey(recoveryKey, newPassword) {
    return _authPost('/api/auth/reset-password', { recovery_key: recoveryKey, new_password: newPassword });
}

export async function logoutOwner() {
    try {
        const headers = currentAuthToken ? { 'Authorization': `Bearer ${currentAuthToken}` } : {};
        await fetch('/api/auth/logout', { method: 'POST', headers, credentials: 'include' });
    } catch (_) {}
    clearAuthToken();
    isUserAuthenticated = false;

    if (window.__nivm_state) {
        Object.assign(window.__nivm_state, { conversations: [], activeChatId: null, memory: {} });
    }
    ['chatContainer', 'historyList'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    try { localStorage.removeItem('nivm_saved_chats'); } catch (_) {}
    showAuthLock();
}

/**
 * Setup lock screen UI listeners.
 */
export function setupAuthUI(onAuthenticatedCallback) {
    window.showAuthLock = showAuthLock;
    window.hideAuthLock = hideAuthLock;
    window.logoutOwner = logoutOwner;

    const overlay = document.getElementById('authLockOverlay');
    const form = document.getElementById('authLoginForm');
    const pwdInput = document.getElementById('authPasswordInput');
    const togglePwdBtn = document.getElementById('authTogglePwdBtn');
    const forgotBtn = document.getElementById('authForgotToggleBtn');
    const backBtn = document.getElementById('authBackToLoginBtn');
    const recoverySec = document.getElementById('authRecoverySection');
    const recSubmitBtn = document.getElementById('authRecoverySubmitBtn');
    const recKeyInput = document.getElementById('authRecoveryKeyInput');
    const newPwdInput = document.getElementById('authNewPasswordInput');
    const navLockBtn = document.getElementById('navLockBtn');
    const drawerLockBtn = document.getElementById('drawerLockBtn');
    const settingsLogoutBtn = document.getElementById('settingsLogoutBtn');

    // Toggle password visibility
    if (togglePwdBtn && pwdInput) {
        togglePwdBtn.addEventListener('click', () => {
            const isPwd = pwdInput.type === 'password';
            pwdInput.type = isPwd ? 'text' : 'password';
            const icon = togglePwdBtn.querySelector('i');
            if (icon) {
                icon.className = isPwd ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
            }
        });
    }

    // Toggle forgot password section
    if (forgotBtn && recoverySec && form) {
        forgotBtn.addEventListener('click', () => {
            form.style.display = 'none';
            recoverySec.classList.add('visible');
            const subtitle = document.getElementById('authSubtitle');
            if (subtitle) subtitle.textContent = 'Reset password';
            const errBadge = document.getElementById('authErrorBadge');
            if (errBadge) errBadge.classList.remove('visible');
            if (recKeyInput) recKeyInput.focus();
        });
    }

    if (backBtn && recoverySec && form) {
        backBtn.addEventListener('click', () => {
            recoverySec.classList.remove('visible');
            form.style.display = 'flex';
            const subtitle = document.getElementById('authSubtitle');
            if (subtitle) subtitle.textContent = 'Enter password to continue';
            const errBadge = document.getElementById('authErrorBadge');
            if (errBadge) errBadge.classList.remove('visible');
            if (pwdInput) pwdInput.focus();
        });
    }

    // Handle Login Submit (Password only)
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById('authSubmitBtn');
            const origHtml = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Unlocking...';
            }

            try {
                const password = pwdInput ? pwdInput.value : '';
                await loginOwner(password);

                hideAuthLock();
                if (typeof onAuthenticatedCallback === 'function') {
                    await onAuthenticatedCallback();
                }
            } catch (err) {
                showAuthError(err.message || 'Incorrect password');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = origHtml;
                }
            }
        });
    }

    // Handle Recovery Reset Submit
    if (recSubmitBtn) {
        recSubmitBtn.addEventListener('click', async () => {
            const key = recKeyInput ? recKeyInput.value.trim() : '';
            const newPwd = newPwdInput ? newPwdInput.value : '';

            if (!key) {
                showAuthError('Please enter your Emergency Recovery Key');
                return;
            }
            if (!newPwd || newPwd.length < 4) {
                showAuthError('New password must be at least 4 characters');
                return;
            }

            const origHtml = recSubmitBtn.innerHTML;
            recSubmitBtn.disabled = true;
            recSubmitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Resetting...';

            try {
                await resetPasswordWithKey(key, newPwd);
                hideAuthLock();
                if (typeof onAuthenticatedCallback === 'function') {
                    onAuthenticatedCallback();
                }
            } catch (err) {
                showAuthError(err.message || 'Recovery key verification failed');
            } finally {
                recSubmitBtn.disabled = false;
                recSubmitBtn.innerHTML = origHtml;
            }
        });
    }

    // Nav lock/logout button (Desktop sidebar)
    if (navLockBtn) {
        navLockBtn.addEventListener('click', async () => {
            await logoutOwner();
        });
    }

    // Drawer logout button (Mobile)
    if (drawerLockBtn) {
        drawerLockBtn.addEventListener('click', async () => {
            const historyDrawer = document.getElementById('historyDrawer');
            if (historyDrawer) historyDrawer.classList.add('hidden');
            const backdrop = document.getElementById('mobileDrawerBackdrop');
            if (backdrop) backdrop.classList.remove('active');
            await logoutOwner();
        });
    }

    // Settings modal logout button
    if (settingsLogoutBtn) {
        settingsLogoutBtn.addEventListener('click', async () => {
            const settingsModal = document.getElementById('settingsModal');
            if (settingsModal) settingsModal.classList.add('hidden');
            await logoutOwner();
        });
    }
}
