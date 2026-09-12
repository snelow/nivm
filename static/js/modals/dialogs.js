/* dialogs, notifications & draggable windows */

import { state, saveTerminalSecurityMode } from '../state.js';
import { dom } from '../dom.js';

export function makeDraggable(windowEl, headerEl) {
    if (!windowEl || !headerEl) return;
    if (windowEl._isDraggableInitialized) return;
    windowEl._isDraggableInitialized = true;
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    headerEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = windowEl.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        windowEl.style.left = `${Math.max(10, Math.min(window.innerWidth - windowEl.offsetWidth - 10, initialLeft + dx))}px`;
        windowEl.style.top = `${Math.max(10, Math.min(window.innerHeight - windowEl.offsetHeight - 10, initialTop + dy))}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = '';
        }
    });
}

export function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}


export function showNotification(options = {}, type = 'info', title = null) {
    if (typeof options === 'string') {
        const text = options;
        const resolvedType = (typeof type === 'string' && ['info', 'success', 'warning', 'error'].includes(type)) ? type : 'info';
        const defaultTitle = resolvedType === 'success' ? 'Success' : (resolvedType === 'error' ? 'Error' : (resolvedType === 'warning' ? 'Warning' : 'Notice'));
        options = {
            message: text,
            type: resolvedType,
            title: title || defaultTitle
        };
    }
    
    let finalTitle = (options && options.title) ? options.title : null;
    let finalMessage = (options && options.message) ? options.message : '';
    let rawType = (options && options.type) ? options.type : 'info';
    const icon = options ? options.icon : null;
    const duration = (options && typeof options.duration === 'number') ? options.duration : 5000;
    const actionText = options ? options.actionText : null;
    const onAction = options ? options.onAction : null;
    const dismissible = options && options.dismissible !== undefined ? options.dismissible : true;

    const validTypes = ['info', 'success', 'warning', 'error'];
    const finalType = validTypes.includes(rawType) ? rawType : 'info';

    if (!finalTitle) {
        finalTitle = finalType === 'success' ? 'Success' : (finalType === 'error' ? 'Error' : (finalType === 'warning' ? 'Warning' : 'Notice'));
    }
    // If message was omitted but a custom title was provided, move title to message
    if (!finalMessage && finalTitle && !['Notice', 'Success', 'Error', 'Warning', 'Info'].includes(finalTitle)) {
        finalMessage = finalTitle;
        finalTitle = finalType === 'success' ? 'Success' : (finalType === 'error' ? 'Error' : (finalType === 'warning' ? 'Warning' : 'Notice'));
    }

    return new Promise(resolve => {
        let container = dom.notificationContainer || document.getElementById('notificationContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notificationContainer';
            container.className = 'notification-container';
            document.body.appendChild(container);
            if (dom) dom.notificationContainer = container;
        }

        let iconClass = icon;
        if (!iconClass) {
            switch (finalType) {
                case 'success':
                    iconClass = 'fa-solid fa-circle-check';
                    break;
                case 'warning':
                    iconClass = 'fa-solid fa-triangle-exclamation';
                    break;
                case 'error':
                    iconClass = 'fa-solid fa-circle-exclamation';
                    break;
                default:
                    iconClass = 'fa-solid fa-circle-info';
                    break;
            }
        } else if (!iconClass.startsWith('fa-') && !iconClass.includes(' ')) {
            iconClass = 'fa-solid ' + iconClass;
        }

        const notif = document.createElement('div');
        notif.className = `app-notification notif-${finalType}`;

        const body = document.createElement('div');
        body.className = 'app-notification-body';

        const iconEl = document.createElement('div');
        iconEl.className = 'app-notification-icon';
        iconEl.innerHTML = `<i class="${iconClass}"></i>`;

        const textEl = document.createElement('div');
        textEl.className = 'app-notification-text';

        const titleEl = document.createElement('span');
        titleEl.className = 'app-notification-title';
        titleEl.textContent = finalTitle;

        const subEl = document.createElement('span');
        subEl.className = 'app-notification-sub';
        subEl.textContent = finalMessage;

        textEl.appendChild(titleEl);
        if (finalMessage) textEl.appendChild(subEl);

        body.appendChild(iconEl);
        body.appendChild(textEl);

        let isDismissed = false;
        let dismissTimer = null;
        let remainingTime = duration;
        let startTime = Date.now();

        function dismiss() {
            if (isDismissed) return;
            isDismissed = true;
            if (dismissTimer) clearTimeout(dismissTimer);
            notif.classList.add('dismissing');
            const onEnd = () => {
                if (notif.parentNode) {
                    notif.parentNode.removeChild(notif);
                }
                resolve();
            };
            notif.addEventListener('animationend', onEnd, { once: true });
            setTimeout(onEnd, 350);
        }

        if (actionText && typeof onAction === 'function') {
            const actionBtn = document.createElement('button');
            actionBtn.className = 'app-notif-action-btn';
            actionBtn.type = 'button';
            actionBtn.textContent = actionText;
            actionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    onAction();
                } catch (err) {
                    console.error('Notification action error:', err);
                }
                dismiss();
            });
            body.appendChild(actionBtn);
        }

        if (dismissible) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'app-notif-close-btn';
            closeBtn.type = 'button';
            closeBtn.title = 'Dismiss';
            closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dismiss();
            });
            body.appendChild(closeBtn);
        }

        notif.appendChild(body);

        let progressBar = null;
        if (duration > 0) {
            progressBar = document.createElement('div');
            progressBar.className = 'app-notif-progress';
            progressBar.style.animationDuration = `${duration}ms`;
            notif.appendChild(progressBar);
        }

        // Insert at the beginning of the container so the newest drops down from the top
        if (container.firstChild) {
            container.insertBefore(notif, container.firstChild);
        } else {
            container.appendChild(notif);
        }

        function startTimer(timeMs) {
            if (timeMs <= 0) return;
            startTime = Date.now();
            remainingTime = timeMs;
            dismissTimer = setTimeout(dismiss, timeMs);
            if (progressBar) {
                progressBar.style.animationPlayState = 'running';
            }
        }

        function pauseTimer() {
            if (dismissTimer) {
                clearTimeout(dismissTimer);
                dismissTimer = null;
                const elapsed = Date.now() - startTime;
                remainingTime = Math.max(500, remainingTime - elapsed);
                if (progressBar) {
                    progressBar.style.animationPlayState = 'paused';
                }
            }
        }

        if (duration > 0) {
            startTimer(duration);
            notif.addEventListener('mouseenter', pauseTimer);
            notif.addEventListener('mouseleave', () => startTimer(remainingTime));
        }
    });
}

// Custom Alert System - now routed through the sleek Dropdown Notification
export function showAlert(title, message, type = null) {
    let resolvedType = type;
    if (!resolvedType) {
        const text = `${title || ''} ${message || ''}`.toLowerCase();
        if (text.includes('error') || text.includes('failed') || text.includes('failure') || text.includes('exception') || text.includes('unavailable')) {
            resolvedType = 'error';
        } else if (text.includes('success') || text.includes('finished') || text.includes('completed') || text.includes('saved')) {
            resolvedType = 'success';
        } else if (text.includes('warning') || text.includes('notice') || text.includes('caution') || text.includes('alert')) {
            resolvedType = 'warning';
        } else {
            resolvedType = 'info';
        }
    }
    const duration = resolvedType === 'error' ? 7000 : 5000;
    return showNotification({
        title,
        message,
        type: resolvedType,
        duration
    });
}

window.showNotification = showNotification;
window.showAlert = showAlert;

export function showConfirm(title, message) {
    return new Promise(resolve => {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }

        dom.dialogTitle.textContent = title;
        dom.dialogMessage.textContent = message;
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-secondary';
        cancelBtn.textContent = 'Cancel';
        
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn-primary';
        confirmBtn.textContent = 'Confirm';
        
        dom.dialogActions.innerHTML = '';
        dom.dialogActions.appendChild(cancelBtn);
        dom.dialogActions.appendChild(confirmBtn);
        
        dom.dialogOverlay.classList.remove('hidden');
        cancelBtn.focus();

        const onOverlayMouseDown = (e) => {
            if (e.target === dom.dialogOverlay) {
                e.stopPropagation();
                e.preventDefault();
                dom.dialogBox.classList.remove('dialog-shake');
                void dom.dialogBox.offsetWidth;
                dom.dialogBox.classList.add('dialog-shake');
            }
        };
        dom.dialogOverlay.addEventListener('mousedown', onOverlayMouseDown);

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cleanup();
                resolve(false);
            } else if (e.key === 'Tab') {
                const focusables = [cancelBtn, confirmBtn];
                if (e.shiftKey && document.activeElement === focusables[0]) {
                    e.preventDefault();
                    focusables[1].focus();
                } else if (!e.shiftKey && document.activeElement === focusables[1]) {
                    e.preventDefault();
                    focusables[0].focus();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown, true);

        const cleanup = () => {
            dom.dialogOverlay.classList.add('hidden');
            dom.dialogOverlay.removeEventListener('mousedown', onOverlayMouseDown);
            window.removeEventListener('keydown', onKeyDown, true);
            dom.dialogBox.classList.remove('dialog-shake');
        };
        
        cancelBtn.addEventListener('click', () => {
            cleanup();
            resolve(false);
        });
        
        confirmBtn.addEventListener('click', () => {
            cleanup();
            resolve(true);
        });
    });
}

export function promptTerminalPermission(command, reasons = []) {
    return new Promise(resolve => {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }

        const iconEl = dom.dialogOverlay.querySelector('.dialog-icon');
        const originalIconClass = iconEl ? iconEl.className : '';
        const originalIconStyle = iconEl ? iconEl.getAttribute('style') : null;

        if (iconEl) {
            iconEl.className = 'fa-solid fa-shield-halved dialog-icon';
            iconEl.style.color = '#f59e0b';
        }

        dom.dialogTitle.textContent = 'Terminal Permission Request';

        let reasonsHtml = '';
        if (reasons && reasons.length > 0) {
            reasonsHtml = `
                <div style="margin-bottom: 12px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 10px 12px;">
                    <div style="font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.06em; color: #f87171; font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                        <i class="fa-solid fa-triangle-exclamation"></i> Flagged Potential Risk
                    </div>
                    <ul style="margin: 0; padding-left: 18px; font-size: 0.82rem; color: #fca5a5; line-height: 1.45;">
                        ${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
                    </ul>
                </div>
            `;
        } else {
            reasonsHtml = `
                <div style="margin-bottom: 12px; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4;">
                    The assistant requested permission to execute a shell command on your local system.
                </div>
            `;
        }

        dom.dialogMessage.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 8px;">
                ${reasonsHtml}
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); font-weight: 600;">Command to Execute</span>
                        <button type="button" id="copyTerminalPromptCmdBtn" style="background: none; border: none; color: var(--text-tertiary); font-size: 0.78rem; cursor: pointer; padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px;" title="Copy command">
                            <i class="fa-regular fa-copy"></i> Copy
                        </button>
                    </div>
                    <div style="background: rgba(0, 0, 0, 0.65); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 10px 14px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.88rem; color: #67e8f9; word-break: break-all; max-height: 110px; overflow-y: auto; line-height: 1.45;">
                        <span style="color: #34d399; user-select: none; font-weight: 600; margin-right: 6px;">$</span>${escapeHtml(command)}
                    </div>
                </div>
                <div style="font-size: 0.78rem; color: var(--text-tertiary); display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                    <i class="fa-solid fa-folder-open" style="color: var(--accent-purple);"></i>
                    <span>Target Directory: <code>nivm root</code></span>
                </div>
            </div>
        `;

        const copyBtn = dom.dialogMessage.querySelector('#copyTerminalPromptCmdBtn');
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(command);
                copyBtn.innerHTML = '<i class="fa-solid fa-check" style="color: #34d399;"></i> Copied!';
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
                }, 2000);
            };
        }

        const denyBtn = document.createElement('button');
        denyBtn.className = 'btn-secondary';
        denyBtn.style.padding = '8px 16px';
        denyBtn.style.fontSize = '0.88rem';
        denyBtn.textContent = 'Deny';

        const allowBtn = document.createElement('button');
        allowBtn.className = 'btn-primary';
        allowBtn.style.padding = '8px 18px';
        allowBtn.style.fontSize = '0.88rem';
        allowBtn.style.background = 'linear-gradient(135deg, #059669 0%, #10b981 100%)';
        allowBtn.style.borderColor = '#34d399';
        allowBtn.innerHTML = '<i class="fa-solid fa-terminal" style="margin-right: 6px;"></i> Allow Execution';

        dom.dialogActions.innerHTML = '';
        dom.dialogActions.appendChild(denyBtn);
        dom.dialogActions.appendChild(allowBtn);

        const prevMaxWidth = dom.dialogBox.style.maxWidth;
        dom.dialogBox.style.maxWidth = '480px';

        dom.dialogOverlay.classList.remove('hidden');
        denyBtn.focus();

        const onOverlayMouseDown = (e) => {
            if (e.target === dom.dialogOverlay) {
                e.stopPropagation();
                e.preventDefault();
                dom.dialogBox.classList.remove('dialog-shake');
                void dom.dialogBox.offsetWidth;
                dom.dialogBox.classList.add('dialog-shake');
            }
        };
        dom.dialogOverlay.addEventListener('mousedown', onOverlayMouseDown);

        const cleanup = () => {
            dom.dialogOverlay.classList.add('hidden');
            dom.dialogOverlay.removeEventListener('mousedown', onOverlayMouseDown);
            window.removeEventListener('keydown', onKeyDown, true);
            dom.dialogBox.classList.remove('dialog-shake');
            dom.dialogBox.style.maxWidth = prevMaxWidth || '';
            if (iconEl) {
                if (originalIconClass) iconEl.className = originalIconClass;
                if (originalIconStyle !== null) iconEl.setAttribute('style', originalIconStyle);
                else iconEl.removeAttribute('style');
            }
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cleanup();
                resolve(false);
            } else if (e.key === 'Tab') {
                const focusables = [copyBtn, denyBtn, allowBtn].filter(Boolean);
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown, true);

        denyBtn.addEventListener('click', () => {
            cleanup();
            resolve(false);
        });

        allowBtn.addEventListener('click', () => {
            cleanup();
            resolve(true);
        });
    });
}
window.promptTerminalPermission = promptTerminalPermission;


