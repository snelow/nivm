/* chat history & navigation */

import { state, saveConversations } from '../state.js';
import { dom } from '../dom.js';
import { escapeHtml, showConfirm } from '../modals/dialogs.js';
import { renderActiveChat, updateChatInputState, toggleSendStopButtons, setupDynamicGreeting, getMessageText } from './chat_messages.js';
import { renderMemoryDrawer } from '../memory/memory_drawer.js';

export function createNewChat() {
    if (state.isGenerating) {
        if (typeof window.stopGeneration === 'function') {
            window.stopGeneration();
        } else if (state.abortController) {
            state.abortController.abort();
            state.isGenerating = false;
        }
        toggleSendStopButtons(false);
    }

    const activeChat = state.conversations.find(c => c.id === state.activeChatId);
    
    if (activeChat && activeChat.messages.length === 0) {
        renderActiveChat();
        setupDynamicGreeting();
        return;
    }

    const newChat = {
        id: 'chat_' + Date.now(),
        title: 'New Chat',
        createdAt: Date.now(),
        messages: []
    };
    state.conversations.unshift(newChat);
    state.activeChatId = newChat.id;
    saveConversations();
    renderChatHistory();
    renderActiveChat();
    setupDynamicGreeting();
}

export function switchChat(id) {
    if (id === state.activeChatId) return;
    if (state.isGenerating) {
        if (typeof window.stopGeneration === 'function') {
            window.stopGeneration();
        } else if (state.abortController) {
            state.abortController.abort();
            state.isGenerating = false;
        }
        toggleSendStopButtons(false);
    }
    state.activeChatId = id;
    if (window.innerWidth <= 768) {
        if (dom.historyDrawer) dom.historyDrawer.classList.add('hidden');
        const backdrop = dom.mobileDrawerBackdrop || document.getElementById('mobileDrawerBackdrop');
        if (backdrop) backdrop.classList.remove('active');
    }
    renderChatHistory();
    renderActiveChat();
    if (typeof window.checkAndResumeActiveGeneration === 'function') {
        window.checkAndResumeActiveGeneration(id);
    }
}
window.switchChat = switchChat;

export function extractMediaUrlsFromMessage(msg) {
    const urls = [];
    if (!msg) return urls;

    // 1. Array content parts (uploaded media or generated images)
    if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
            if (part && typeof part === 'object') {
                const u = part.image_url?.url || part.video_url?.url || part.audio_url?.url || part.document_url?.url;
                if (u && typeof u === 'string' && (u.includes('/uploads/') || u.includes('/images/'))) {
                    urls.push(u);
                }
            }
        }
    } else if (typeof msg.content === 'string') {
        const matches = msg.content.match(/(?:\/images\/|\/uploads\/)[a-zA-Z0-9_\-\.]+\.(?:png|jpg|jpeg|webp|gif|bmp|mp4|webm|mov|wav|mp3|m4a|pdf)/gi) || [];
        matches.forEach(m => urls.push(m));
    }

    // 2. Tool executions (generate_image, edit_image, generate_anime_image)
    if (msg.toolExecution) {
        if (msg.toolExecution.imageUrl) {
            urls.push(msg.toolExecution.imageUrl);
        }
        if (msg.toolExecution.imageFilename) {
            urls.push(`/images/${msg.toolExecution.imageFilename}`);
        }
        if (msg.toolExecution.resultStr) {
            const matches = msg.toolExecution.resultStr.match(/(?:\/images\/|\/uploads\/)[a-zA-Z0-9_\-\.]+\.(?:png|jpg|jpeg|webp|gif|bmp|mp4|webm|mov|wav|mp3|m4a|pdf)/gi) || [];
            matches.forEach(m => urls.push(m));
        }
    }

    return Array.from(new Set(urls.filter(Boolean)));
}

export function extractMediaUrlsFromChat(chat) {
    const urls = [];
    if (!chat || !chat.messages) return urls;
    for (const msg of chat.messages) {
        extractMediaUrlsFromMessage(msg).forEach(u => urls.push(u));
    }
    return Array.from(new Set(urls));
}

export function deleteChat(id, e) {
    if (e) {
        e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
    }
    const chatToDelete = state.conversations.find(c => c.id === id);
    if (chatToDelete) {
        const urls = extractMediaUrlsFromChat(chatToDelete);
        const remainingUrls = new Set();
        state.conversations.filter(c => c.id !== id).forEach(c => {
            extractMediaUrlsFromChat(c).forEach(u => remainingUrls.add(u));
        });
        const urlsToDelete = urls.filter(u => !remainingUrls.has(u));
        if (urlsToDelete.length > 0 && window.deleteUploadedFilesAPI) {
            window.deleteUploadedFilesAPI(urlsToDelete);
        }
    }
    state.conversations = state.conversations.filter(c => c.id !== id);
    if (state.activeChatId === id) {
        state.activeChatId = state.conversations.length > 0 ? state.conversations[0].id : null;
    }
    saveConversations();
    renderChatHistory();
    renderActiveChat();
    if (window.showNotification) {
        window.showNotification('Conversation deleted', 'info');
    }
}

export function renderChatHistory() {
    if (!dom.chatHistoryList) return;
    dom.chatHistoryList.innerHTML = '';
    
    // Reset scroll to top so the latest conversation is always visible first
    dom.chatHistoryList.scrollTop = 0;
    const drawerBody = dom.historyDrawer ? dom.historyDrawer.querySelector('.drawer-body') : null;
    if (drawerBody) drawerBody.scrollTop = 0;
    
    const query = dom.chatSearchInput ? dom.chatSearchInput.value.toLowerCase().trim() : '';
    
    let filteredChats = state.conversations;
    if (query) {
        filteredChats = state.conversations.filter(chat => {
            if (chat.title && chat.title.toLowerCase().includes(query)) return true;
            return chat.messages.some(m => getMessageText(m.content).toLowerCase().includes(query));
        });
    }

    filteredChats.forEach((chat, index) => {
        const item = document.createElement('div');
        let classes = `chat-item ${chat.id === state.activeChatId ? 'active' : ''}`;
        if (query && index === 0) {
            classes += ' highlight-match';
        }
        item.className = classes;
        item.style.animationDelay = `${index * 40}ms`;
        item.onclick = (e) => {
            // Do not switch or close drawer if delete button was clicked
            if (e && e.target && (e.target.closest('.chat-action-btn') || e.target.closest('.chat-item-actions'))) {
                return;
            }
            switchChat(chat.id);
            if (window.innerWidth <= 768) {
                if (dom.historyDrawer) dom.historyDrawer.classList.add('hidden');
                const backdrop = dom.mobileDrawerBackdrop || document.getElementById('mobileDrawerBackdrop');
                if (backdrop) backdrop.classList.remove('active');
            }
        };

        const title = document.createElement('span');
        title.className = 'chat-item-title';
        if (chat.isEnded) {
            title.innerHTML = `<i class="fa-solid fa-lock chat-item-lock-icon" title="Ended conversation"></i><span>${escapeHtml(chat.title || 'New Chat')}</span>`;
            item.classList.add('chat-item-locked');
        } else {
            title.textContent = chat.title || 'New Chat';
        }

        const actions = document.createElement('div');
        actions.className = 'chat-item-actions';

        const delBtn = document.createElement('button');
        delBtn.className = 'chat-action-btn';
        delBtn.setAttribute('type', 'button');
        delBtn.setAttribute('title', 'Delete conversation');
        delBtn.setAttribute('aria-label', 'Delete conversation');
        delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';

        const handleDelete = (e) => {
            if (e) {
                e.stopPropagation();
                e.preventDefault();
            }
            deleteChat(chat.id, e);
        };
        delBtn.onclick = handleDelete;
        delBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        delBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        delBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

        actions.appendChild(delBtn);
        item.appendChild(title);
        item.appendChild(actions);
        dom.chatHistoryList.appendChild(item);
    });
}


export function setupHistoryUI() {
    // Search logic: redirect to Global Spotlight Search
    const searchTrigger = dom.drawerSearchBtn || dom.chatSearchInput || document.getElementById('drawerSearchBtn');
    if (searchTrigger) {
        const openSearch = (e) => {
            if (e) e.preventDefault();
            if (searchTrigger.blur) searchTrigger.blur();
            if (typeof window.openGlobalSearch === 'function') {
                window.openGlobalSearch();
            }
        };
        searchTrigger.addEventListener('click', openSearch);
    }

    // Resize logic
    const drawer = dom.historyDrawer;
    const handle = dom.historyResizeHandle;
    
    if (drawer && handle) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        // Restore saved width
        const savedWidth = localStorage.getItem('nivm_historyWidth');
        if (savedWidth) {
            document.documentElement.style.setProperty('--history-width', savedWidth + 'px');
        }

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = drawer.offsetWidth;
            document.body.style.userSelect = 'none';
            handle.classList.add('active');
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            let newWidth = startWidth + dx;
            
            // Constrain width
            newWidth = Math.max(250, Math.min(newWidth, 600));
            
            document.documentElement.style.setProperty('--history-width', newWidth + 'px');
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.userSelect = '';
                handle.classList.remove('active');
                
                // Save preference
                const currentWidth = document.documentElement.style.getPropertyValue('--history-width');
                if (currentWidth) {
                    localStorage.setItem('nivm_historyWidth', currentWidth.replace('px', ''));
                }
            }
        });
    }
}

export function setupMobileNav() {
    const historyDrawer = dom.historyDrawer || document.getElementById('historyDrawer');
    const memoryDrawer = dom.memoryDrawer || document.getElementById('memoryDrawer');
    const backdrop = dom.mobileDrawerBackdrop || document.getElementById('mobileDrawerBackdrop');
    const menuBtn = dom.mobileMenuBtn || document.getElementById('mobileMenuBtn');
    const mobileNewChatBtn = dom.mobileNewChatBtn || document.getElementById('mobileNewChatBtn');
    const mobileStatsBtn = dom.mobileStatsBtn || document.getElementById('mobileStatsBtn');
    const statsBtn = dom.statsBtn || document.getElementById('statsBtn');

    function openDrawer(drawer) {
        if (drawer) {
            drawer.classList.remove('hidden');
            const drawerBody = drawer.querySelector('.drawer-body');
            if (drawerBody) {
                drawerBody.scrollTop = 0;
            }
        }
        if (backdrop) {
            backdrop.classList.add('active');
        }
    }

    function closeAllDrawers() {
        if (historyDrawer) historyDrawer.classList.add('hidden');
        if (memoryDrawer) memoryDrawer.classList.add('hidden');
        if (backdrop) backdrop.classList.remove('active');
    }

    if (menuBtn) {
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            if (historyDrawer && !historyDrawer.classList.contains('hidden')) {
                closeAllDrawers();
            } else {
                if (memoryDrawer) memoryDrawer.classList.add('hidden');
                openDrawer(historyDrawer);
            }
        };
    }

    if (backdrop) {
        backdrop.onclick = () => {
            closeAllDrawers();
        };
    }

    ['closeHistoryBtn', 'closeMemoryBtn'].forEach(id => {
        const el = dom[id] || document.getElementById(id);
        if (el) el.onclick = (e) => { e.stopPropagation(); closeAllDrawers(); };
    });

    if (mobileStatsBtn) mobileStatsBtn.onclick = () => statsBtn?.click();

    const drawerActions = [
        ['mobileNewChatBtn', () => (window.createNewChat || createNewChat)()],
        ['drawerNewChatBtn', () => (window.createNewChat || createNewChat)()],
        ['drawerSettingsBtn', () => document.getElementById('settingsBtn')?.click()],
        ['drawerPersonaBtn', () => document.getElementById('personalityBtn')?.click()],
        ['drawerToolsBtn', () => document.getElementById('toolsBtn')?.click()],
        ['drawerThemeBtn', () => document.getElementById('themeBtn')?.click()],
        ['drawerVoiceBtn', () => document.getElementById('voiceBtn')?.click() || document.getElementById('voiceModal')?.classList.remove('hidden')],
        ['drawerStatsBtn', () => (document.getElementById('statsBtn') || document.getElementById('mobileStatsBtn'))?.click() || document.getElementById('statsWindow')?.classList.remove('hidden')],
        ['drawerUnloadBtn', async (btn) => window.handleUnloadAllModels ? await window.handleUnloadAllModels(btn) : document.getElementById('unloadAllModelsBtn')?.click()],
    ];
    drawerActions.forEach(([id, fn]) => {
        const el = document.getElementById(id) || dom[id];
        if (el) el.onclick = async () => { closeAllDrawers(); await fn(el); };
    });

    const drawerMemoryBtn = document.getElementById('drawerMemoryBtn');
    if (drawerMemoryBtn) {
        drawerMemoryBtn.onclick = () => {
            if (historyDrawer) historyDrawer.classList.add('hidden');
            if (memoryDrawer) {
                memoryDrawer.classList.remove('hidden');
                if (typeof renderMemoryDrawer === 'function') renderMemoryDrawer();
                if (backdrop) backdrop.classList.add('active');
            }
        };
    }

    // Sync status dot between desktop and mobile top bar
    const syncDot = () => {
        const desktopDot = document.getElementById('statusDot');
        const mobileDot = document.getElementById('mobileStatusDot');
        if (desktopDot && mobileDot) {
            mobileDot.className = desktopDot.className;
        }
    };

    const desktopDot = document.getElementById('statusDot');
    if (desktopDot) {
        const observer = new MutationObserver(syncDot);
        observer.observe(desktopDot, { attributes: true, attributeFilter: ['class'] });
        syncDot();
    }
}
window.setupMobileNav = setupMobileNav;

export function forkChatFromMessage(msg) {
    if (!msg) return;
    const activeChat = state.conversations.find(c => c.id === state.activeChatId);
    if (!activeChat || !Array.isArray(activeChat.messages)) return;

    const idx = activeChat.messages.indexOf(msg);
    if (idx === -1) return;

    if (state.isGenerating) {
        if (typeof window.stopGeneration === 'function') {
            window.stopGeneration();
        } else if (state.abortController) {
            state.abortController.abort();
            state.isGenerating = false;
        }
        toggleSendStopButtons(false);
    }

    // Deep clone the messages up to this turn
    const sliced = activeChat.messages.slice(0, idx + 1);
    const clonedMessages = JSON.parse(JSON.stringify(sliced));

    // Strip volatile streaming flags
    clonedMessages.forEach(m => {
        if (m.isStreaming) delete m.isStreaming;
    });

    const baseTitle = (activeChat.title || 'Conversation').replace(/\s*\(Branch\s*\d*\)$/i, '');
    const newChat = {
        id: 'chat_' + Date.now(),
        title: `${baseTitle} (Branch)`,
        createdAt: Date.now(),
        messages: clonedMessages
    };

    // Insert new chat right next to the active chat
    const activeIdx = state.conversations.indexOf(activeChat);
    if (activeIdx !== -1) {
        state.conversations.splice(activeIdx + 1, 0, newChat);
    } else {
        state.conversations.unshift(newChat);
    }

    state.activeChatId = newChat.id;
    saveConversations();
    renderChatHistory();
    renderActiveChat();

    if (typeof window.showNotification === 'function') {
        window.showNotification({
            title: 'Chat Forked',
            message: `Branched into "${newChat.title}" at turn #${idx + 1}`,
            type: 'success'
        });
    }
}
window.forkChatFromMessage = forkChatFromMessage;

