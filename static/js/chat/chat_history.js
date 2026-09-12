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

export function extractMediaUrlsFromChat(chat) {
    const urls = [];
    if (!chat || !chat.messages) return urls;
    for (const msg of chat.messages) {
        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part && typeof part === 'object') {
                    const u = part.image_url?.url || part.video_url?.url || part.audio_url?.url || part.document_url?.url;
                    if (u && typeof u === 'string' && u.includes('/uploads/')) {
                        urls.push(u);
                    }
                }
            }
        }
    }
    return urls;
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
    // Search logic
    if (dom.chatSearchInput) {
        dom.chatSearchInput.addEventListener('input', () => {
            renderChatHistory();
        });
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

    // Pinned top-right "+" button on mobile bar always creates new chat
    if (mobileNewChatBtn) {
        mobileNewChatBtn.onclick = () => {
            closeAllDrawers();
            if (window.createNewChat) {
                window.createNewChat();
            } else {
                createNewChat();
            }
        };
    }

    // New Chat button inside drawer
    const drawerNewChatBtn = document.getElementById('drawerNewChatBtn');
    if (drawerNewChatBtn) {
        drawerNewChatBtn.onclick = () => {
            closeAllDrawers();
            if (window.createNewChat) {
                window.createNewChat();
            } else {
                createNewChat();
            }
        };
    }

    // Close button inside history drawer
    const closeHistoryBtn = dom.closeHistoryBtn || document.getElementById('closeHistoryBtn');
    if (closeHistoryBtn) {
        closeHistoryBtn.onclick = (e) => {
            e.stopPropagation();
            closeAllDrawers();
        };
    }

    // Close button inside memory drawer
    const closeMemoryBtn = dom.closeMemoryBtn || document.getElementById('closeMemoryBtn');
    if (closeMemoryBtn) {
        closeMemoryBtn.onclick = (e) => {
            e.stopPropagation();
            closeAllDrawers();
        };
    }

    // Brand / Status click opens stats modal
    if (mobileStatsBtn) {
        mobileStatsBtn.onclick = () => {
            if (statsBtn) statsBtn.click();
        };
    }

    // Drawer footer tool buttons
    const drawerSettingsBtn = document.getElementById('drawerSettingsBtn');
    if (drawerSettingsBtn) {
        drawerSettingsBtn.onclick = () => {
            closeAllDrawers();
            const sBtn = document.getElementById('settingsBtn');
            if (sBtn) sBtn.click();
        };
    }

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

    const drawerPersonaBtn = document.getElementById('drawerPersonaBtn');
    if (drawerPersonaBtn) {
        drawerPersonaBtn.onclick = () => {
            closeAllDrawers();
            const pBtn = document.getElementById('personalityBtn');
            if (pBtn) pBtn.click();
        };
    }

    const drawerToolsBtn = document.getElementById('drawerToolsBtn');
    if (drawerToolsBtn) {
        drawerToolsBtn.onclick = () => {
            closeAllDrawers();
            const tBtn = document.getElementById('toolsBtn');
            if (tBtn) tBtn.click();
        };
    }

    const drawerVoiceBtn = document.getElementById('drawerVoiceBtn');
    if (drawerVoiceBtn) {
        drawerVoiceBtn.onclick = () => {
            closeAllDrawers();
            const vBtn = document.getElementById('voiceBtn');
            if (vBtn) {
                vBtn.click();
            } else {
                const voiceModal = document.getElementById('voiceModal');
                if (voiceModal) voiceModal.classList.remove('hidden');
            }
        };
    }

    const drawerThemeBtn = document.getElementById('drawerThemeBtn');
    if (drawerThemeBtn) {
        drawerThemeBtn.onclick = () => {
            closeAllDrawers();
            const thBtn = document.getElementById('themeBtn');
            if (thBtn) thBtn.click();
        };
    }

    const drawerStatsBtn = document.getElementById('drawerStatsBtn');
    if (drawerStatsBtn) {
        drawerStatsBtn.onclick = () => {
            closeAllDrawers();
            const sBtn = document.getElementById('statsBtn') || document.getElementById('mobileStatsBtn');
            if (sBtn) {
                sBtn.click();
            } else {
                const statsWindow = document.getElementById('statsWindow');
                if (statsWindow) statsWindow.classList.remove('hidden');
            }
        };
    }

    const drawerUnloadBtn = document.getElementById('drawerUnloadBtn');
    if (drawerUnloadBtn) {
        drawerUnloadBtn.onclick = async () => {
            closeAllDrawers();
            if (typeof window.handleUnloadAllModels === 'function') {
                await window.handleUnloadAllModels(drawerUnloadBtn);
            } else {
                const uBtn = document.getElementById('unloadAllModelsBtn');
                if (uBtn) uBtn.click();
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

