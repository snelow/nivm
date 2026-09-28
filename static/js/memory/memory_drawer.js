/* Memory Drawer & Neural RAG Memory Management */

import { state } from '../state.js';
import { dom } from '../dom.js';
import { escapeHtml, showNotification, showConfirm } from '../modals/dialogs.js';
import { fetchMemoryAPI, addMemoryAPI, deleteMemoryAPI, clearAllMemoriesAPI, toggleMemoryModeAPI } from '../api.js';

let isEventsBound = false;

function formatMemoryDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        const diffSec = Math.floor((now - d) / 1000);
        if (diffSec < 60) return 'Just now';
        if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
        if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (_) {
        return '';
    }
}

export async function renderMemoryDrawer() {
    setupMemoryDrawerEvents();

    if (!dom.memoryList) return;

    // Refresh memory data from server
    try {
        const data = await fetchMemoryAPI();
        if (data && typeof data === 'object') {
            state.memory = Array.isArray(data.memories) ? data.memories : [];
            if (typeof data.enabled === 'boolean') {
                state.memoryEnabled = data.enabled;
                localStorage.setItem('nivm_memory_enabled', String(data.enabled));
            }
        }
    } catch (e) {
        console.warn('Could not sync latest memories:', e);
    }

    // Update Mode Toggle UI
    updateMemoryModeUI();

    const memories = Array.isArray(state.memory) ? state.memory : [];
    const countEl = document.getElementById('memoryFactCount');
    if (countEl) {
        countEl.textContent = `${memories.length} memor${memories.length === 1 ? 'y' : 'ies'} stored`;
    }

    dom.memoryList.innerHTML = '';

    if (memories.length === 0) {
        dom.memoryList.innerHTML = `
            <div style="padding: 36px 16px; text-align: center; color: var(--text-tertiary); display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(168, 85, 247, 0.08); display: flex; align-items: center; justify-content: center; color: var(--accent-purple, #a855f7); font-size: 1.1rem;">
                    <i class="fa-solid fa-brain"></i>
                </div>
                <div style="font-size: 0.84rem; font-weight: 500; color: var(--text-secondary);">No memories yet</div>
                <div style="font-size: 0.73rem; color: var(--text-tertiary); max-width: 200px;">
                    Key facts are automatically remembered as you chat.
                </div>
            </div>
        `;
        return;
    }

    memories.forEach(item => {
        const text = item.text || item.memory || '';
        const id = item.id;
        const timeFormatted = formatMemoryDate(item.created_at);

        const card = document.createElement('div');
        card.className = 'memory-fact-card';
        card.style.cssText = `
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color, rgba(255, 255, 255, 0.07));
            border-radius: 8px;
            padding: 10px 12px;
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 10px;
            transition: border-color 0.2s, background 0.2s;
        `;
        card.onmouseover = () => {
            card.style.borderColor = 'rgba(168, 85, 247, 0.35)';
            card.style.background = 'rgba(255, 255, 255, 0.05)';
        };
        card.onmouseout = () => {
            card.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.07))';
            card.style.background = 'rgba(255, 255, 255, 0.03)';
        };

        const contentBox = document.createElement('div');
        contentBox.style.cssText = 'flex: 1; min-width: 0;';

        const textEl = document.createElement('div');
        textEl.style.cssText = 'font-size: 0.84rem; color: var(--text-primary); line-height: 1.4; word-break: break-word;';
        textEl.textContent = text;

        contentBox.appendChild(textEl);

        if (timeFormatted) {
            const timeEl = document.createElement('div');
            timeEl.style.cssText = 'font-size: 0.7rem; color: var(--text-tertiary); margin-top: 4px;';
            timeEl.textContent = timeFormatted;
            contentBox.appendChild(timeEl);
        }

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        delBtn.style.cssText = `
            background: transparent;
            border: none;
            color: var(--text-tertiary);
            cursor: pointer;
            padding: 4px 6px;
            font-size: 0.78rem;
            border-radius: 4px;
            transition: color 0.15s, background 0.15s;
        `;
        delBtn.title = 'Delete memory';
        delBtn.onmouseover = () => {
            delBtn.style.color = '#f87171';
            delBtn.style.background = 'rgba(239, 68, 68, 0.1)';
        };
        delBtn.onmouseout = () => {
            delBtn.style.color = 'var(--text-tertiary)';
            delBtn.style.background = 'transparent';
        };

        delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (await showConfirm('Delete Memory', 'Are you sure you want to remove this remembered fact?')) {
                delBtn.disabled = true;
                await deleteMemoryAPI(id);
                state.memory = state.memory.filter(m => m.id !== id);
                renderMemoryDrawer();
                showNotification('Memory removed', 'info');
            }
        });

        card.appendChild(contentBox);
        card.appendChild(delBtn);
        dom.memoryList.appendChild(card);
    });
}

function updateMemoryModeUI() {
    const isEnabled = state.memoryEnabled !== false;
    const dot = document.getElementById('memoryStatusDot');
    const label = document.getElementById('memoryModeLabel');
    const toggleBtn = document.getElementById('toggleMemoryModeBtn');
    const prefToggleBtn = document.getElementById('prefToggleMemoryModeBtn');

    if (dot) dot.style.background = isEnabled ? '#10b981' : '#71717a';
    if (label) label.textContent = isEnabled ? 'Enabled' : 'Disabled';
    if (toggleBtn) {
        toggleBtn.style.color = isEnabled ? '#10b981' : 'var(--text-tertiary)';
    }
    if (prefToggleBtn) {
        prefToggleBtn.textContent = isEnabled ? 'Enabled' : 'Disabled';
        prefToggleBtn.style.color = isEnabled ? '#34d399' : 'var(--text-tertiary)';
    }
}


function setupMemoryDrawerEvents() {
    if (isEventsBound) return;
    isEventsBound = true;

    // Toggle Memory Mode
    const handleToggle = async () => {
        const nextState = !state.memoryEnabled;
        state.memoryEnabled = nextState;
        localStorage.setItem('nivm_memory_enabled', String(nextState));
        updateMemoryModeUI();
        try {
            await toggleMemoryModeAPI(nextState);
            showNotification(nextState ? 'Memory mode enabled' : 'Memory mode disabled', 'info');
        } catch (e) {
            console.error('Error toggling memory mode:', e);
        }
    };

    const toggleBtn = document.getElementById('toggleMemoryModeBtn');
    if (toggleBtn) toggleBtn.addEventListener('click', handleToggle);

    const prefToggleBtn = document.getElementById('prefToggleMemoryModeBtn');
    if (prefToggleBtn) prefToggleBtn.addEventListener('click', handleToggle);

    // Erase All Memories
    const eraseAllBtn = document.getElementById('eraseAllMemoriesBtn');
    if (eraseAllBtn) {
        eraseAllBtn.addEventListener('click', async () => {
            const count = (state.memory || []).length;
            if (count === 0) {
                showNotification('No memories to erase', 'info');
                return;
            }
            const confirmed = await showConfirm(
                'Erase All Memories',
                `Are you sure you want to permanently erase all ${count} memories? This will clear all stored vectors and cannot be undone.`
            );
            if (confirmed) {
                try {
                    await clearAllMemoriesAPI();
                    state.memory = [];
                    renderMemoryDrawer();
                    showNotification('All long-term memories erased', 'success');
                } catch (e) {
                    console.error('Error clearing memories:', e);
                    showNotification('Failed to erase memories', 'error');
                }
            }
        });
    }

    // Manual Add Memory
    const addBtn = document.getElementById('addMemoryBtn');
    const manualInput = document.getElementById('manualMemoryInput');

    const handleAdd = async () => {
        if (!manualInput) return;
        const text = manualInput.value.trim();
        if (!text) return;
        manualInput.disabled = true;
        if (addBtn) addBtn.disabled = true;

        try {
            const res = await addMemoryAPI(text);
            manualInput.value = '';
            showNotification('Memory saved!', 'success');
            await renderMemoryDrawer();
        } catch (e) {
            console.error('Error adding memory:', e);
            showNotification('Failed to save memory', 'error');
        } finally {
            manualInput.disabled = false;
            if (addBtn) addBtn.disabled = false;
            manualInput.focus();
        }
    };

    if (addBtn) addBtn.addEventListener('click', handleAdd);
    if (manualInput) {
        manualInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
            }
        });
    }
}
