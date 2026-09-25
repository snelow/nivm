/**
 * Project NIVM — Global Spotlight Search (Ctrl+Shift+F, Ctrl+K, /)
 * Searches full-text across conversations, messages, and memory notes.
 */

import { state } from '../state.js';
import { dom } from '../dom.js';
import { switchChat } from '../chat/chat_history.js';
import { getMessageText } from '../chat/chat_messages.js';
import { renderMemoryDrawer } from '../memory/memory_drawer.js';
import { escapeHtml } from './dialogs.js';

let activeFilter = 'all';
let searchDebounce = null;
let currentResults = [];
let selectedIndex = -1;

export function openGlobalSearch() {
    const modal = dom.globalSearchModal || document.getElementById('globalSearchModal');
    const input = dom.globalSearchInput || document.getElementById('globalSearchInput');
    if (!modal) return;

    modal.classList.remove('hidden');
    selectedIndex = -1;

    if (input) {
        input.value = '';
        input.focus();
    }
    renderInitialState();
}

export function closeGlobalSearch() {
    const modal = dom.globalSearchModal || document.getElementById('globalSearchModal');
    if (modal) {
        modal.classList.add('hidden');
    }
    selectedIndex = -1;
}

function renderInitialState() {
    const container = dom.globalSearchResults || document.getElementById('globalSearchResults');
    const stats = dom.globalSearchStats || document.getElementById('globalSearchStats');
    if (stats) stats.textContent = '';
    if (!container) return;

    const totalChats = (state.conversations || []).length;
    const totalMsgs = (state.conversations || []).reduce((acc, c) => acc + (c.messages?.length || 0), 0);
    const totalMem = Object.keys(state.memory || {}).length;

    container.innerHTML = `
        <div class="global-search-empty">
            <i class="fa-solid fa-magnifying-glass"></i>
            <p>Search across ${totalChats} chats (${totalMsgs} turns) and ${totalMem} memory notes</p>
            <span class="search-hint-sub">Press <kbd style="padding:1px 5px;background:rgba(255,255,255,0.08);border-radius:4px;">Ctrl+Shift+F</kbd>, <kbd style="padding:1px 5px;background:rgba(255,255,255,0.08);border-radius:4px;">Ctrl+K</kbd>, or <kbd style="padding:1px 5px;background:rgba(255,255,255,0.08);border-radius:4px;">/</kbd> anytime</span>
        </div>
    `;
}

function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const qEsc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${qEsc})`, 'gi');
    return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function extractSnippet(fullText, query) {
    if (!fullText) return '';
    const clean = fullText.replace(/[\r\n]+/g, ' ').trim();
    if (!query) return clean.slice(0, 140);

    const idx = clean.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return clean.slice(0, 140);

    const start = Math.max(0, idx - 45);
    const end = Math.min(clean.length, idx + query.length + 75);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < clean.length ? '…' : '';
    return prefix + clean.slice(start, end) + suffix;
}

function formatRelativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - Number(ts);
    const min = 60 * 1000;
    const hour = 60 * min;
    const day = 24 * hour;

    if (diff < min) return 'Just now';
    if (diff < hour) return `${Math.floor(diff / min)}m ago`;
    if (diff < day) return `${Math.floor(diff / hour)}h ago`;
    if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;

    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function performGlobalSearch() {
    const input = dom.globalSearchInput || document.getElementById('globalSearchInput');
    const container = dom.globalSearchResults || document.getElementById('globalSearchResults');
    const stats = dom.globalSearchStats || document.getElementById('globalSearchStats');
    if (!container || !input) return;

    const query = input.value.trim().toLowerCase();
    if (!query) {
        renderInitialState();
        return;
    }

    const results = [];

    // 1. Search Conversations & Messages
    if (activeFilter === 'all' || activeFilter === 'chats') {
        const chats = state.conversations || [];
        chats.forEach(chat => {
            const chatTitle = chat.title || 'Untitled Chat';
            const chatTitleLower = chatTitle.toLowerCase();

            // Match in chat title
            if (chatTitleLower.includes(query)) {
                results.push({
                    type: 'chat_title',
                    chatId: chat.id,
                    title: chatTitle,
                    badge: 'Chat',
                    snippet: `Conversation titled "${chatTitle}" with ${chat.messages?.length || 0} messages`,
                    timestamp: chat.updatedAt || chat.createdAt,
                    score: 100
                });
            }

            // Match in messages
            if (Array.isArray(chat.messages)) {
                chat.messages.forEach((msg, mIdx) => {
                    const text = getMessageText(msg.content);
                    if (text && text.toLowerCase().includes(query)) {
                        const roleName = msg.role === 'user' ? 'You' : 'Assistant';
                        results.push({
                            type: 'message',
                            chatId: chat.id,
                            messageIndex: mIdx,
                            title: chatTitle,
                            badge: `${roleName} • Turn #${mIdx + 1}`,
                            snippet: extractSnippet(text, query),
                            timestamp: msg.timestamp || chat.updatedAt || chat.createdAt,
                            score: 50
                        });
                    }
                });
            }
        });
    }

    // 2. Search Memory
    if (activeFilter === 'all' || activeFilter === 'memory') {
        const mem = state.memory || {};
        for (const [key, val] of Object.entries(mem)) {
            const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
            const keyLower = key.toLowerCase();
            const valLower = valStr.toLowerCase();

            if (keyLower.includes(query) || valLower.includes(query)) {
                results.push({
                    type: 'memory',
                    key,
                    title: `Memory • ${key}`,
                    badge: 'Memory Fact',
                    snippet: extractSnippet(valStr, query),
                    timestamp: null,
                    score: keyLower.includes(query) ? 90 : 40
                });
            }
        }
    }

    // Sort by score and recency
    results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.timestamp || 0) - (a.timestamp || 0);
    });

    currentResults = results.slice(0, 50);
    selectedIndex = currentResults.length > 0 ? 0 : -1;

    if (stats) {
        stats.textContent = `${currentResults.length} match${currentResults.length === 1 ? '' : 'es'}`;
    }

    if (currentResults.length === 0) {
        container.innerHTML = `
            <div class="global-search-empty">
                <i class="fa-solid fa-face-meh"></i>
                <p>No matches found for "${escapeHtml(input.value.trim())}"</p>
                <span class="search-hint-sub">Try searching another term, topic, or key fact</span>
            </div>
        `;
        return;
    }

    container.innerHTML = currentResults.map((item, idx) => {
        const icon = item.type === 'memory'
            ? 'fa-solid fa-brain'
            : (item.type === 'chat_title' ? 'fa-regular fa-comments' : 'fa-regular fa-message');
        const timeStr = item.timestamp ? `<span class="search-result-time">${formatRelativeTime(item.timestamp)}</span>` : '';
        const highlightedTitle = highlightMatch(item.title, query);
        const highlightedSnippet = highlightMatch(item.snippet, query);

        return `
            <div class="search-result-item ${idx === selectedIndex ? 'active' : ''}" data-idx="${idx}">
                <div class="search-result-top">
                    <span class="search-result-title">
                        <i class="${icon}"></i>
                        <span>${highlightedTitle}</span>
                    </span>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span class="search-result-badge">${item.badge}</span>
                        ${timeStr}
                    </div>
                </div>
                <div class="search-result-snippet">${highlightedSnippet}</div>
            </div>
        `;
    }).join('');

    // Attach click listeners to result cards
    container.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.getAttribute('data-idx'), 10);
            selectSearchResult(idx);
        });
    });
}

function updateActiveItemDOM() {
    const items = document.querySelectorAll('.search-result-item');
    items.forEach((item, idx) => {
        const isActive = idx === selectedIndex;
        item.classList.toggle('active', isActive);
        if (isActive) {
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    });
}

function selectSearchResult(idx) {
    if (idx < 0 || idx >= currentResults.length) return;
    const item = currentResults[idx];
    closeGlobalSearch();

    if (item.type === 'memory') {
        // Open memory drawer
        if (dom.memoryToggleBtn) {
            dom.memoryToggleBtn.click();
        } else if (typeof renderMemoryDrawer === 'function') {
            renderMemoryDrawer();
        }
        return;
    }

    if (item.chatId) {
        switchChat(item.chatId);

        if (typeof item.messageIndex === 'number') {
            setTimeout(() => {
                const rows = document.querySelectorAll('#chatContainer .message-row');
                const targetRow = rows[item.messageIndex];
                if (targetRow) {
                    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetRow.classList.add('message-jump-highlight');
                    setTimeout(() => targetRow.classList.remove('message-jump-highlight'), 2600);
                }
            }, 180);
        }
    }
}

export function setupGlobalSearchUI() {
    const modal = dom.globalSearchModal || document.getElementById('globalSearchModal');
    const input = dom.globalSearchInput || document.getElementById('globalSearchInput');
    const closeBtn = dom.closeGlobalSearchBtn || document.getElementById('closeGlobalSearchBtn');
    const triggerBtn = dom.globalSearchBtn || document.getElementById('globalSearchBtn');

    if (triggerBtn) {
        triggerBtn.addEventListener('click', openGlobalSearch);
    }

    const drawerSearchBtn = dom.drawerSearchBtn || document.getElementById('drawerSearchBtn') || document.querySelector('.drawer-search-btn');
    if (drawerSearchBtn) {
        drawerSearchBtn.addEventListener('click', (e) => {
            if (e) e.preventDefault();
            openGlobalSearch();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeGlobalSearch);
    }

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeGlobalSearch();
        });
    }

    // Filter pills
    document.querySelectorAll('.search-filter-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.search-filter-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.getAttribute('data-filter') || 'all';
            performGlobalSearch();
        });
    });

    // Debounced search input
    if (input) {
        input.addEventListener('input', () => {
            if (searchDebounce) clearTimeout(searchDebounce);
            searchDebounce = setTimeout(performGlobalSearch, 120);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (currentResults.length > 0) {
                    selectedIndex = (selectedIndex + 1) % currentResults.length;
                    updateActiveItemDOM();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (currentResults.length > 0) {
                    selectedIndex = (selectedIndex - 1 + currentResults.length) % currentResults.length;
                    updateActiveItemDOM();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < currentResults.length) {
                    selectSearchResult(selectedIndex);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeGlobalSearch();
            }
        });
    }

    // Global keyboard shortcuts (Ctrl+Shift+F, Ctrl+K, and /)
    window.addEventListener('keydown', (e) => {
        // Check if user is typing in an active input/textarea
        const activeTag = document.activeElement?.tagName;
        const isEditing = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable;

        // 1. Universal Search: Ctrl+Shift+F or Cmd+Shift+F
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
            e.preventDefault();
            openGlobalSearch();
            return;
        }

        // 2. Command Palette: Ctrl+K or Cmd+K
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            openGlobalSearch();
            return;
        }

        // 3. Quick Slash: '/' (only when NOT typing in an input)
        if (e.key === '/' && !isEditing && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            openGlobalSearch();
            return;
        }

        // 4. Escape: Close search if open
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeGlobalSearch();
        }
    });
}
