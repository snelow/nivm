import { state, saveConversations, saveEnabledTools, saveTerminalSecurityMode } from './state.js';
import { dom } from './dom.js';
import { tools, parseToolCall, stripToolCallFromText } from './tools.js';
import { createSingleImageCard, createBeforeAfterSlider } from './image_editor.js';

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

export function setupDynamicGreeting() {
    const hour = new Date().getHours();
    let timeGreetings = [];

    if (hour >= 5 && hour < 12) {
        timeGreetings = [
            'Good morning',
            'Start fresh',
            'Ready when you are',
            'Bright and early',
            'What’s on your mind?',
            'A brand new day'
        ];
    } else if (hour >= 12 && hour < 17) {
        timeGreetings = [
            'Good afternoon',
            'How can I help?',
            'Here to help',
            'Ready when you are',
            'Let’s get things done',
            'Take a breath'
        ];
    } else if (hour >= 17 && hour < 22) {
        timeGreetings = [
            'Good evening',
            'Evening thoughts',
            'Here with you',
            'Still curious?',
            'What are we working on?',
            'Unwinding'
        ];
    } else {
        timeGreetings = [
            'Late night inspiration',
            'Quiet hours',
            'Midnight thoughts',
            'Still awake?',
            'Here when you need me',
            'Into the night'
        ];
    }

    const subtitles = [
        'How can I help you today?',
        'Ask anything, brainstorm an idea, or draft something new.',
        'Explore a topic, polish your writing, or solve a problem.',
        'Ready to help you write, learn, think, and create.',
        'Got a question, an idea, or just curious? Let’s chat.',
        'What would you like to explore today?',
        'From quick answers to deep conversations, I’m here.',
        'Share a thought, plan your day, or learn something new.'
    ];

    const chosenGreeting = timeGreetings[Math.floor(Math.random() * timeGreetings.length)];
    const chosenSub = subtitles[Math.floor(Math.random() * subtitles.length)];

    if (dom.heroGreeting) {
        const name = state.userName ? state.userName.trim() : '';
        if (name) {
            dom.heroGreeting.innerHTML = `${chosenGreeting}, <span class="gradient-text">${escapeHtml(name)}</span>`;
        } else {
            dom.heroGreeting.innerHTML = `<span class="gradient-text">${chosenGreeting}</span>`;
        }
    }
    if (dom.heroSubtitle) {
        dom.heroSubtitle.textContent = chosenSub;
    }
}

export function scrollToBottom() {
    dom.chatViewport.scrollTop = dom.chatViewport.scrollHeight;
}

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
            title.innerHTML = `<span class="chat-item-lock-pill"><i class="fa-solid fa-lock"></i> Locked</span> ${escapeHtml(chat.title || 'New Chat')}`;
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

export function updateChatInputState(activeChat) {
    const isEnded = Boolean(activeChat?.isEnded);
    const endOverlay = dom.convoEndedOverlay || document.getElementById('convoEndedOverlay');
    const endReasonEl = dom.convoEndedReason || document.getElementById('convoEndedReason');
    if (activeChat?.isPendingResume && !state.isGenerating) {
        delete activeChat.isPendingResume;
        delete activeChat.pendingAppealText;
    }

    const resumeBtnEl = dom.convoEndedResumeBtn || document.getElementById('convoEndedResumeBtn');
    if (resumeBtnEl) {
        resumeBtnEl.innerHTML = '<i class="fa-solid fa-unlock"></i> Resume';
        resumeBtnEl.disabled = false;
    }

    if (isEnded) {
        if (endOverlay) {
            endOverlay.classList.remove('hidden');
            if (endReasonEl) {
                const reason = activeChat.endReason || 'Conversation concluded.';
                endReasonEl.textContent = reason;
                endReasonEl.title = reason;
            }
        }
        if (dom.userPrompt) {
            dom.userPrompt.disabled = true;
            if (!dom.userPrompt.dataset.originalPlaceholder) {
                dom.userPrompt.dataset.originalPlaceholder = dom.userPrompt.placeholder || 'Message nivm...';
            }
            dom.userPrompt.placeholder = 'This conversation has ended.';
        }
        if (dom.sendBtn) dom.sendBtn.disabled = true;
        if (dom.micRecordBtn) dom.micRecordBtn.disabled = true;
        if (dom.attachImgBtn) dom.attachImgBtn.disabled = true;
        if (dom.visionToggleBtn) dom.visionToggleBtn.disabled = true;
    } else {
        if (endOverlay) {
            endOverlay.classList.add('hidden');
        }
        if (dom.userPrompt) {
            dom.userPrompt.disabled = false;
            if (dom.userPrompt.dataset.originalPlaceholder) {
                dom.userPrompt.placeholder = dom.userPrompt.dataset.originalPlaceholder;
            } else {
                dom.userPrompt.placeholder = 'Message nivm...';
            }
        }
        if (dom.sendBtn) dom.sendBtn.disabled = false;
        if (dom.micRecordBtn) dom.micRecordBtn.disabled = false;
        if (dom.attachImgBtn) dom.attachImgBtn.disabled = false;
        if (dom.visionToggleBtn) dom.visionToggleBtn.disabled = false;
    }
}

function getMessageText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .filter(item => item && item.type === 'text' && typeof item.text === 'string')
            .map(item => item.text)
            .join(' ');
    }
    return '';
}

export function renderActiveChat() {
    const activeChat = state.conversations.find(c => c.id === state.activeChatId);
    
    if (!activeChat || activeChat.messages.length === 0) {
        dom.welcomeHero.classList.remove('hidden');
        dom.messagesContainer.classList.add('hidden');
        dom.messagesContainer.innerHTML = '';
    } else {
        dom.welcomeHero.classList.add('hidden');
        dom.messagesContainer.classList.remove('hidden');
        dom.messagesContainer.innerHTML = '';

        activeChat.messages.forEach((msg, idx) => {
            if (msg.isHidden) return;
            appendMessageToDOM(msg, false, idx, activeChat.messages);
        });
    }
    updateChatInputState(activeChat);
    scrollToBottom();
}

export function toggleSendStopButtons(isGenerating) {
    if (isGenerating) {
        dom.sendBtn.classList.add('hidden');
        dom.stopBtn.classList.remove('hidden');
    } else {
        dom.sendBtn.classList.remove('hidden');
        dom.stopBtn.classList.add('hidden');
    }
}

export function buildToolTraceHtml(command, argsStr, resultStr = null) {
    const cmdLower = (command || '').toLowerCase();
    const isTerminal = cmdLower.includes('terminal');
    const isMemory = cmdLower.includes('memory');
    const isEndConvo = cmdLower.includes('end_conversation') || cmdLower.includes('end_convo');
    
    let badgeClass = 'generic';
    let toolIcon = 'fa-cube';
    let toolLabel = command || 'tool';
    
    if (isTerminal) {
        badgeClass = 'terminal';
        toolIcon = 'fa-terminal';
        toolLabel = 'terminal';
    } else if (isMemory) {
        badgeClass = 'memory';
        toolIcon = cmdLower.includes('read') ? 'fa-book-bookmark' : 'fa-floppy-disk';
        toolLabel = command;
    } else if (isEndConvo) {
        badgeClass = 'terminal';
        toolIcon = 'fa-door-closed';
        toolLabel = 'end_conversation';
    }

    let cleanArgs = (argsStr || '').trim();
    if ((cleanArgs.startsWith('"') && cleanArgs.endsWith('"')) || (cleanArgs.startsWith("'") && cleanArgs.endsWith("'"))) {
        cleanArgs = cleanArgs.substring(1, cleanArgs.length - 1);
    }
    const previewArgs = cleanArgs.length > 55 ? cleanArgs.substring(0, 52) + '…' : cleanArgs;

    const isConcluded = isEndConvo;
    const isDenied = !isConcluded && resultStr && resultStr.toLowerCase().includes('denied');
    const isError = !isDenied && !isConcluded && resultStr && (resultStr.toLowerCase().includes('error') || resultStr.toLowerCase().includes('failed'));
    const statusClass = isConcluded ? 'warning' : (isDenied ? 'warning' : (isError ? 'error' : 'success'));
    const statusText = isConcluded ? 'Concluded' : (isDenied ? 'Denied' : (isError ? 'Failed' : 'Executed'));
    const statusIcon = isConcluded ? 'fa-lock' : (isDenied ? 'fa-ban' : (isError ? 'fa-triangle-exclamation' : 'fa-check'));

    const fullInvocation = `${command}(${cleanArgs})`;
    const escapedInvocation = escapeHtml(fullInvocation).replace(/'/g, "\\'");
    const escapedResult = resultStr !== null && resultStr !== undefined ? escapeHtml(resultStr).replace(/'/g, "\\'") : '';

    return `
    <details class="tool-trace-block">
        <summary class="tool-trace-summary">
            <div class="tool-trace-summary-left">
                <span class="tool-badge ${badgeClass}">
                    <i class="fa-solid ${toolIcon}"></i>
                    <span>${escapeHtml(toolLabel)}</span>
                </span>
                <span class="tool-cmd-preview" title="${escapeHtml(cleanArgs)}">${escapeHtml(previewArgs)}</span>
            </div>
            <div class="tool-trace-summary-right">
                <span class="tool-status-pill ${statusClass}">
                    <i class="fa-solid ${statusIcon}"></i> ${statusText}
                </span>
                <i class="fa-solid fa-chevron-right tool-toggle-icon"></i>
            </div>
        </summary>
        <div class="tool-trace-body">
            <div class="tool-section">
                <div class="tool-section-head">
                    <span><i class="fa-solid fa-code"></i> Tool Call</span>
                    <button class="tool-copy-btn" onclick="navigator.clipboard.writeText('${escapedInvocation}'); this.innerHTML='<i class=\\'fa-solid fa-check\\'></i> Copied'; setTimeout(() => this.innerHTML='<i class=\\'fa-regular fa-copy\\'></i> Copy', 1500);" title="Copy invocation">
                        <i class="fa-regular fa-copy"></i> Copy
                    </button>
                </div>
                <pre class="tool-code-display"><code>${escapeHtml(fullInvocation)}</code></pre>
            </div>
            ${resultStr !== null && resultStr !== undefined ? `
            <div class="tool-section">
                <div class="tool-section-head">
                    <span><i class="fa-solid fa-square-poll-horizontal"></i> Output</span>
                    <button class="tool-copy-btn" onclick="navigator.clipboard.writeText('${escapedResult}'); this.innerHTML='<i class=\\'fa-solid fa-check\\'></i> Copied'; setTimeout(() => this.innerHTML='<i class=\\'fa-regular fa-copy\\'></i> Copy', 1500);" title="Copy output">
                        <i class="fa-regular fa-copy"></i> Copy
                    </button>
                </div>
                <pre class="tool-output-display ${isError ? 'error' : ''}"><code>${escapeHtml(resultStr)}</code></pre>
            </div>
            ` : ''}
        </div>
    </details>`.trim();
}

// ---------- Waveform Audio Player ----------
function buildWaveformPlayer(audioUrl) {
    const container = document.createElement('div');
    container.className = 'waveform-player';
    
    const playBtn = document.createElement('button');
    playBtn.className = 'waveform-play-btn';
    playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    
    const waveWrap = document.createElement('div');
    waveWrap.className = 'waveform-canvas-wrap';
    
    const canvas = document.createElement('canvas');
    canvas.className = 'waveform-canvas';
    canvas.width = 220;
    canvas.height = 40;
    waveWrap.appendChild(canvas);
    
    const timeLabel = document.createElement('span');
    timeLabel.className = 'waveform-time';
    timeLabel.textContent = '0:00';
    
    container.appendChild(playBtn);
    container.appendChild(waveWrap);
    container.appendChild(timeLabel);
    
    const audio = new Audio(audioUrl);
    audio.preload = 'metadata';
    let bars = [];
    let animFrame = null;
    let trueDuration = 0;
    
    const formatTime = (s) => {
        if (isNaN(s) || !isFinite(s) || s < 0) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
    };

    const getDuration = () => {
        if (isFinite(audio.duration) && audio.duration > 0) return audio.duration;
        if (isFinite(trueDuration) && trueDuration > 0) return trueDuration;
        return 0;
    };
    
    // Generate pseudo-waveform bars (from audio data or random if unavailable)
    const generateBars = async () => {
        const numBars = 44;
        try {
            const response = await fetch(audioUrl);
            const arrayBuffer = await response.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decoded = await audioCtx.decodeAudioData(arrayBuffer);
            if (decoded && isFinite(decoded.duration) && decoded.duration > 0) {
                trueDuration = decoded.duration;
                if (!audio.currentTime || audio.currentTime === 0) {
                    timeLabel.textContent = formatTime(trueDuration);
                }
            }
            const rawData = decoded.getChannelData(0);
            const blockSize = Math.floor(rawData.length / numBars);
            bars = [];
            for (let i = 0; i < numBars; i++) {
                let sum = 0;
                for (let j = 0; j < blockSize; j++) {
                    sum += Math.abs(rawData[i * blockSize + j]);
                }
                bars.push(sum / blockSize);
            }
            // Normalize
            const maxVal = Math.max(...bars) || 1;
            bars = bars.map(b => Math.max(0.08, b / maxVal));
            audioCtx.close();
        } catch (e) {
            // Fallback: generate pleasing random bars
            bars = Array.from({ length: numBars }, () => 0.15 + Math.random() * 0.85);
        }
        drawWaveform();
    };
    
    const drawWaveform = () => {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.clientWidth * dpr;
        canvas.height = canvas.clientHeight * dpr;
        ctx.scale(dpr, dpr);
        
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        ctx.clearRect(0, 0, w, h);
        
        if (bars.length === 0) return;
        
        const barW = Math.max(2, (w / bars.length) * 0.6);
        const gap = w / bars.length;
        const dur = getDuration();
        const progress = dur > 0 ? audio.currentTime / dur : 0;
        
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#f4f4f5';
        
        bars.forEach((val, i) => {
            const barH = Math.max(3, val * (h - 4));
            const x = i * gap + (gap - barW) / 2;
            const y = (h - barH) / 2;
            const barProgress = (i + 0.5) / bars.length;
            
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(x, y, barW, barH, 1);
            } else {
                ctx.rect(x, y, barW, barH);
            }
            if (barProgress <= progress) {
                ctx.fillStyle = accentColor;
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            }
            ctx.fill();
        });
    };
    
    const animLoop = () => {
        drawWaveform();
        timeLabel.textContent = formatTime(audio.currentTime);
        if (!audio.paused) {
            animFrame = requestAnimationFrame(animLoop);
        }
    };
    
    playBtn.onclick = () => {
        if (audio.paused) {
            audio.play();
            playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
            animLoop();
        } else {
            audio.pause();
            playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
            if (animFrame) cancelAnimationFrame(animFrame);
        }
    };
    
    audio.onended = () => {
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        if (animFrame) cancelAnimationFrame(animFrame);
        drawWaveform();
        const dur = getDuration();
        timeLabel.textContent = formatTime(dur);
    };
    
    audio.onloadedmetadata = () => {
        const dur = getDuration();
        if (dur > 0) timeLabel.textContent = formatTime(dur);
    };
    
    // Click-to-seek on canvas
    waveWrap.onclick = (e) => {
        const dur = getDuration();
        if (dur <= 0) return;
        const rect = waveWrap.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = frac * dur;
        drawWaveform();
        timeLabel.textContent = formatTime(audio.currentTime);
    };
    
    generateBars();
    
    return container;
}

export function appendMessageToDOM(msg, isStreaming = false, msgIndex = null, allMessages = null) {
    // Hide internal system notifications from the UI
    if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.startsWith('[SYSTEM NOTIFICATION]')) {
        return { bubble: null, actions: null };
    }

    const role = msg.role;
    const content = msg.content;
    
    const row = document.createElement('div');
    row.className = `message-row ${role}-row`;

    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    if (role === 'user') {
        if (Array.isArray(content)) {
            bubble.innerHTML = '';
            // Extract text and media
            const texts = content.filter(item => item.type === 'text');
            const mediaItems = content.filter(item => item.type === 'image_url' || item.type === 'video_url' || item.type === 'audio_url' || item.type === 'document_url');
            
            if (mediaItems.length > 0) {
                const gallery = document.createElement('div');
                gallery.className = 'chat-media-gallery';
                if (texts.length === 0) gallery.style.marginBottom = '0';
                
                mediaItems.forEach(item => {
                    const isVideo = item.type === 'video_url';
                    const isAudio = item.type === 'audio_url';
                    const isDocument = item.type === 'document_url';
                    const url = isVideo ? item.video_url.url : (isAudio ? item.audio_url.url : (isDocument ? item.document_url.url : item.image_url.url));
                    
                    if (isAudio) {
                        const player = buildWaveformPlayer(url);
                        gallery.appendChild(player);
                    } else if (isDocument) {
                        const docCard = document.createElement('div');
                        docCard.className = 'chat-doc-card';
                        docCard.innerHTML = `<i class="fa-solid fa-file-pdf"></i><span>PDF Document</span>`;
                        gallery.appendChild(docCard);
                    } else if (isVideo) {
                        const videoThumb = document.createElement('div');
                        videoThumb.className = 'chat-video-thumb';
                        const vid = document.createElement('video');
                        vid.src = url;
                        vid.muted = true;
                        vid.preload = 'metadata';
                        vid.playsInline = true;
                        videoThumb.appendChild(vid);
                        const playOverlay = document.createElement('div');
                        playOverlay.className = 'chat-video-play-overlay';
                        playOverlay.innerHTML = '<i class="fa-solid fa-play"></i>';
                        videoThumb.appendChild(playOverlay);
                        videoThumb.onclick = () => openVideoPreview(url);
                        // Load first frame
                        vid.addEventListener('loadeddata', () => { vid.currentTime = 0.1; }, { once: true });
                        gallery.appendChild(videoThumb);
                    } else {
                        const img = document.createElement('img');
                        img.src = url;
                        img.className = 'message-image';
                        img.style.height = '120px';
                        img.style.width = '120px';
                        img.style.objectFit = 'cover';
                        img.style.borderRadius = '8px';
                        img.style.cursor = 'pointer';
                        img.style.flexShrink = '0';
                        img.onclick = () => openLightbox(url);
                        gallery.appendChild(img);
                    }
                });
                bubble.appendChild(gallery);
            }
            
            texts.forEach(item => {
                const txt = document.createElement('div');
                txt.textContent = item.text;
                bubble.appendChild(txt);
            });
        } else {
            bubble.textContent = content;
        }
    } else if (role === 'system') {
        if (msg.isConvoLockEvent) {
            bubble.style.cssText = 'background: transparent; border: none; padding: 0; width: 100%;';
            const cleanReason = msg.reason || (typeof content === 'string' ? content.replace(/^🔒\s*Conversation Locked:?\s*/i, '') : 'Conversation concluded.');
            bubble.innerHTML = `
            <div class="chat-event-divider locked-divider">
                <div class="chat-event-badge locked-badge" title="${escapeHtml(cleanReason)}">
                    <i class="fa-solid fa-lock"></i>
                    <span>Conversation locked • ${escapeHtml(cleanReason)}</span>
                </div>
            </div>`;
            wrapper.appendChild(bubble);
            row.appendChild(wrapper);
            dom.messagesContainer.appendChild(row);
            return { bubble, actions: null };
        } else if (msg.isConvoResumeEvent) {
            bubble.style.cssText = 'background: transparent; border: none; padding: 0; width: 100%;';
            bubble.innerHTML = `
            <div class="chat-event-divider resumed-divider">
                <div class="chat-event-badge resumed-badge">
                    <i class="fa-solid fa-unlock"></i>
                    <span>${escapeHtml(typeof content === 'string' ? content : 'Conversation resumed')}</span>
                </div>
            </div>`;
            wrapper.appendChild(bubble);
            row.appendChild(wrapper);
            dom.messagesContainer.appendChild(row);
            return { bubble, actions: null };
        }
        bubble.style.cssText = 'background: transparent; border: none; padding: 0; width: 100%;';
        const innerHtml = window.marked && content ? marked.parse(content) : escapeHtml(content);
        bubble.innerHTML = `
        <details class="thinking-block" open>
            <summary class="thinking-summary">
                <div class="thinking-summary-left">
                    <span class="think-icon-badge" style="background:rgba(59, 130, 246, 0.15); color:var(--accent-blue, #3b82f6);"><i class="fa-solid fa-server"></i></span>
                    <span class="think-status">System Notice</span>
                </div>
                <div class="thinking-summary-right">
                    <i class="fa-solid fa-chevron-right think-toggle-icon"></i>
                </div>
            </summary>
            <div class="thinking-content">${innerHtml}</div>
        </details>`;
        attachCodeCopyButtons(bubble);
    } else {
        let displayContent = content;
        if (!isStreaming && typeof displayContent === 'string' && !displayContent.trim() && allMessages && typeof msgIndex === 'number' && msgIndex > 0) {
            const prevMsg = allMessages[msgIndex - 1];
            if (prevMsg && typeof prevMsg.content === 'string' && prevMsg.content.startsWith('[Appeal to Resume]')) {
                displayContent = "I've reviewed your appeal, but I'm keeping this conversation closed for now.";
                msg.content = displayContent;
            }
        }
        const thinkTime = msg.thinkTime || msg.meta?.thinkTime || null;
        updateAssistantBubble(bubble, displayContent, isStreaming, thinkTime);
    }

    const actions = document.createElement('div');
    actions.className = 'message-actions';
    updateMessageActionIcons(actions, msg, row);
    if (isStreaming) {
        actions.style.display = 'none';
    }

    wrapper.appendChild(bubble);
    wrapper.appendChild(actions); // Render actions for all roles (including user/system) for the delete button
    row.appendChild(wrapper);

    const detectedTool = (role === 'assistant' && typeof content === 'string') ? parseToolCall(content, tools) : null;
    const hasToolCall = Boolean(detectedTool) || Boolean(msg.toolExecution);
    const isFollowedByNotification = allMessages && typeof msgIndex === 'number' && allMessages[msgIndex + 1]?.content?.startsWith?.('[SYSTEM NOTIFICATION]');

    if (role === 'assistant' && (hasToolCall || isFollowedByNotification)) {
        const cleanContent = typeof content === 'string' ? content.replace(/<(think|thought|reasoning)>\s*<\/\1>/gi, '') : '';
        const textWithoutTool = stripToolCallFromText(cleanContent, tools).trim();
        const textOutsideThoughts = textWithoutTool
            .replace(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '')
            .replace(/<(think|thought|reasoning)>[\s\S]*$/gi, '')
            .trim();
        
        let completedThoughtContent = '';
        const mThought = textWithoutTool.match(/<(think|thought|reasoning)>([\s\S]*?)<\/\1>/i);
        if (mThought && mThought[2].trim()) {
            completedThoughtContent = mThought[2].trim();
        }
        const hasCompletedThought = Boolean(completedThoughtContent);
        
        let toolCommand = msg.toolExecution?.command || detectedTool?.command || null;
        let argsStr = msg.toolExecution?.argsStr || detectedTool?.argsStr || null;
        let resultStr = msg.toolExecution?.resultStr || null;

        if (!toolCommand && typeof content === 'string') {
            const match = content.match(/TOOL_CALL:\s*([a-zA-Z0-9_]+)\(([\s\S]*?)\)/);
            if (match) {
                toolCommand = match[1];
                argsStr = match[2];
            }
        }

        // Backward-compatibility: if tool info is not explicitly on message, extract result from following system notification
        if (allMessages && typeof msgIndex === 'number' && allMessages[msgIndex + 1]) {
            const nextMsg = allMessages[msgIndex + 1];
            if (typeof nextMsg.content === 'string' && nextMsg.content.startsWith('[SYSTEM NOTIFICATION]')) {
                const resMatch = nextMsg.content.match(/Result:\s*([\s\S]*?)(?=\n\nIMPORTANT:|$)/);
                if (resMatch && !resultStr) {
                    resultStr = resMatch[1].trim();
                }
                if (!toolCommand && resultStr) {
                    if (resultStr.includes("updated memory category '")) {
                        const m = resultStr.match(/updated memory category '([^']+)'/);
                        toolCommand = 'write_memory';
                        argsStr = m ? m[1] : 'user_profile';
                    } else if (resultStr.includes("category '") || resultStr.includes("Value for '")) {
                        const m = resultStr.match(/(?:category|Value for) '([^']+)'/);
                        toolCommand = 'read_memory';
                        argsStr = m ? m[1] : 'user_profile';
                    } else if (resultStr.includes("terminal") || resultStr.includes("Linux") || resultStr.includes("Directory")) {
                        toolCommand = 'execute_terminal';
                        argsStr = 'terminal';
                    }
                }
            }
        }

        if (toolCommand) {
            // Restore rich image card in history for generate_image and edit_image
            if (toolCommand === 'generate_image' || toolCommand === 'edit_image') {
                let imgUrl = null;
                if (resultStr) {
                    const match = resultStr.match(/(?:\/images\/|\/uploads\/)[a-zA-Z0-9_\-\./]+/i) || resultStr.match(/(?:\/images\/|\/uploads\/)[^\s,)"';:]+/i);
                    if (match) imgUrl = match[0].replace(/[.,:;]+$/, '');
                }
                if (!imgUrl && msg.toolExecution?.imageUrl) {
                    imgUrl = String(msg.toolExecution.imageUrl).replace(/[.,:;]+$/, '');
                }

                if (imgUrl) {
                    let promptText = '';
                    try {
                        const parsed = JSON.parse(argsStr);
                        promptText = parsed.prompt || '';
                    } catch (_) {
                        const parts = (argsStr || '').match(/(?:[^\s,"']+|"[^"]*"|'[^']*')+/g) || [];
                        if (toolCommand === 'edit_image' && parts.length > 1) {
                            promptText = (parts[1] || '').replace(/^['"]|['"]$/g, '');
                        } else if (parts.length > 0) {
                            promptText = (parts[0] || '').replace(/^['"]|['"]$/g, '');
                        }
                    }

                    let imgCard;
                    let beforeUrl = null;
                    if (toolCommand === 'edit_image' && resultStr) {
                        const matches = Array.from(resultStr.matchAll(/(?:\/images\/|\/uploads\/)[a-zA-Z0-9_\-\./]+/gi));
                        if (matches.length > 1) {
                            beforeUrl = matches[1][0].replace(/[.,:;]+$/, '');
                        }
                    }

                    if (toolCommand === 'edit_image' && beforeUrl && imgUrl) {
                        imgCard = createBeforeAfterSlider(beforeUrl, imgUrl, promptText);
                    } else {
                        imgCard = createSingleImageCard(imgUrl, promptText);
                    }
                    imgCard.style.margin = '6px 0 8px 0';

                    if (textOutsideThoughts === '' && !hasCompletedThought) {
                        wrapper.remove();
                        row.appendChild(imgCard);
                    } else {
                        actions.style.display = 'none';
                        bubble.insertAdjacentElement('afterend', imgCard);
                    }
                    dom.messagesContainer.appendChild(row);
                    return { bubble, actions };
                }
            }

            const sysBubbleHtml = buildToolTraceHtml(toolCommand, argsStr, resultStr);
            
            if (textOutsideThoughts === '' && !hasCompletedThought) {
                // Pure tool step: remove wrapper and render only the clean tool badge
                wrapper.remove();
                row.insertAdjacentHTML('beforeend', sysBubbleHtml);
            } else {
                // Intermediate tool call step: always hide message action footer
                actions.style.display = 'none';
                bubble.insertAdjacentHTML('afterend', sysBubbleHtml);
            }
        }
    }

    dom.messagesContainer.appendChild(row);

    // Dynamic check for long user messages
    if (role === 'user') {
        requestAnimationFrame(() => {
            if (bubble.scrollHeight > 160) {
                bubble.classList.add('collapsible-text');
                
                const overlay = document.createElement('div');
                overlay.className = 'collapse-overlay';
                overlay.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
                
                overlay.onclick = () => {
                    bubble.classList.toggle('expanded');
                };
                
                bubble.appendChild(overlay);
            }
        });
    }

    return { bubble, actions };
}

export function updateMessageActionIcons(actionsContainer, msg, row) {
    if (!actionsContainer) return;
    actionsContainer.innerHTML = '';
    actionsContainer.style.display = '';
    const { role, content, meta } = msg;
    const copyText = getMessageText(content);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-icon-btn';
    copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
    copyBtn.setAttribute('title', 'Copy response');
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(copyText);
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
        copyBtn.setAttribute('title', 'Copied!');
        setTimeout(() => {
            copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
            copyBtn.setAttribute('title', 'Copy response');
        }, 2000);
    };
    actionsContainer.appendChild(copyBtn);

    // Speak / Read Aloud Button
    if (role === 'assistant' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const speakBtn = document.createElement('button');
        speakBtn.className = 'action-icon-btn speak-msg-btn';
        speakBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        speakBtn.setAttribute('title', 'Read aloud');
        speakBtn.onclick = async () => {
            const { speakText } = await import('./voice.js');
            speakText(copyText, speakBtn);
        };
        actionsContainer.appendChild(speakBtn);
    }

    if (meta) {
        const infoBtn = document.createElement('button');
        infoBtn.className = 'action-icon-btn';
        infoBtn.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
        infoBtn.setAttribute('title', 'Generation Info');

        const popover = document.createElement('div');
        popover.className = 'floating-stats-popover hidden';
        const modelName = meta.modelInfo?.name || state.selectedModel || 'nivm';
        const roleIcon = meta.modelInfo?.role === 'vision' ? 'fa-eye' : (meta.modelInfo?.role === 'api' ? 'fa-network-wired' : 'fa-code');
        const tokenLabel = meta.isExact ? `${meta.estTokens} tokens${meta.promptTokens ? ` (${meta.promptTokens} prompt)` : ''}` : `~${meta.estTokens} tokens`;
        popover.innerHTML = `<i class="fa-solid ${roleIcon}" style="color:var(--accent-purple);"></i> ${modelName} &bull; <i class="fa-solid fa-bolt" style="color:var(--accent-emerald);"></i> ${meta.durationSec}s &bull; ${meta.tkPerSec} tk/s &bull; ${tokenLabel}`;

        if (meta.rawTokens && meta.rawTokens.length > 0) {
            const rawSpan = document.createElement('span');
            rawSpan.style.marginLeft = '8px';
            rawSpan.style.cursor = 'pointer';
            rawSpan.style.opacity = '0.9';
            rawSpan.style.color = 'var(--accent-cyan)';
            rawSpan.title = 'Click to copy raw token IDs';
            rawSpan.innerHTML = `&bull; <i class="fa-solid fa-microchip"></i> [${meta.rawTokens.length} raw IDs]`;
            rawSpan.onclick = (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(JSON.stringify(meta.rawTokens));
                rawSpan.innerHTML = `&bull; <i class="fa-solid fa-check"></i> Copied IDs!`;
                setTimeout(() => {
                    rawSpan.innerHTML = `&bull; <i class="fa-solid fa-microchip"></i> [${meta.rawTokens.length} raw IDs]`;
                }, 2000);
            };
            popover.appendChild(rawSpan);
        }

        infoBtn.onmouseenter = () => popover.classList.remove('hidden');
        infoBtn.onmouseleave = () => popover.classList.add('hidden');

        actionsContainer.appendChild(infoBtn);
        actionsContainer.appendChild(popover);
        let hideTimer;
        actionsContainer.addEventListener('mouseleave', () => {
            hideTimer = setTimeout(() => {
                popover.classList.add('hidden');
            }, 300);
        });
        actionsContainer.addEventListener('mouseenter', () => {
            if (hideTimer) clearTimeout(hideTimer);
        });
    }

    // Delete Button (disabled for system messages)
    if (role !== 'system') {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-icon-btn';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.setAttribute('title', 'Delete message');
        deleteBtn.onclick = async () => {
            const activeChat = state.conversations.find(c => c.id === state.activeChatId);
            if (activeChat) {
                const msgUrls = [];
                if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part && typeof part === 'object') {
                            const u = part.image_url?.url || part.video_url?.url || part.audio_url?.url || part.document_url?.url;
                            if (u && typeof u === 'string' && u.includes('/uploads/')) {
                                msgUrls.push(u);
                            }
                        }
                    }
                }
                activeChat.messages = activeChat.messages.filter(m => m !== msg);
                row.remove();
                if (msgUrls.length > 0) {
                    const remainingUrls = new Set();
                    state.conversations.forEach(c => {
                        extractMediaUrlsFromChat(c).forEach(u => remainingUrls.add(u));
                    });
                    const urlsToDelete = msgUrls.filter(u => !remainingUrls.has(u));
                    if (urlsToDelete.length > 0 && window.deleteUploadedFilesAPI) {
                        window.deleteUploadedFilesAPI(urlsToDelete);
                    }
                }
                saveConversations();
            }
        };
        actionsContainer.appendChild(deleteBtn);
    }
}

const thinkingPhrases = [
    'Thinking…',
    'Analyzing…',
    'Processing…',
    'Reasoning…',
];
let thinkPhraseIndex = 0;
let thinkPhraseInterval = null;

function getCreativeDuration(seconds) {
    if (seconds < 1) return 'Thought for a moment';
    if (seconds < 3) return `Thought briefly · ${seconds.toFixed(1)}s`;
    if (seconds < 60) return `Thought for ${seconds.toFixed(1)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `Thought for ${mins}m ${secs}s`;
}

function resolveThinkDuration(thinkStartTimeOrDuration, isGenerating) {
    if (thinkStartTimeOrDuration === null || thinkStartTimeOrDuration === undefined) {
        return null;
    }
    if (typeof thinkStartTimeOrDuration === 'string') {
        const parsed = parseFloat(thinkStartTimeOrDuration);
        if (!isNaN(parsed)) thinkStartTimeOrDuration = parsed;
        else return null;
    }
    if (typeof thinkStartTimeOrDuration !== 'number' || isNaN(thinkStartTimeOrDuration) || thinkStartTimeOrDuration <= 0) {
        return null;
    }

    if (isGenerating) {
        // While streaming, thinkStartTimeOrDuration is the start timestamp in ms from performance.now()
        const elapsedSec = (performance.now() - thinkStartTimeOrDuration) / 1000;
        return (elapsedSec > 0 && elapsedSec < 3600) ? Math.max(0.1, elapsedSec) : null;
    }

    // When generation is finished:
    // If value is <= 600, it is already the computed duration in seconds (e.g. 2.4s)
    if (thinkStartTimeOrDuration <= 600) {
        return Math.max(0.1, thinkStartTimeOrDuration);
    }

    // If value > 600, it was likely passed as a raw performance.now() millisecond timestamp
    const elapsedSec = (performance.now() - thinkStartTimeOrDuration) / 1000;
    if (elapsedSec > 0 && elapsedSec < 600) {
        return Math.max(0.1, elapsedSec);
    }

    return null;
}

function startThinkingPhraseRotation() {
    if (thinkPhraseInterval) return;
    thinkPhraseIndex = Math.floor(Math.random() * thinkingPhrases.length);
    thinkPhraseInterval = setInterval(() => {
        thinkPhraseIndex = (thinkPhraseIndex + 1) % thinkingPhrases.length;
        const el = document.querySelector('.thinking-block.is-streaming .think-status');
        if (el) el.textContent = thinkingPhrases[thinkPhraseIndex];
    }, 2800);
}

function stopThinkingPhraseRotation() {
    if (thinkPhraseInterval) {
        clearInterval(thinkPhraseInterval);
        thinkPhraseInterval = null;
    }
}

export function updateAssistantBubble(bubbleElement, rawText, isGenerating = false, thinkStartTimeOrDuration = null) {
    let processedText = rawText || '';

    if (processedText.trim() !== '' && bubbleElement.dataset.initialStatus) {
        delete bubbleElement.dataset.initialStatus;
        delete bubbleElement.dataset.initialIcon;
    }

    // Strip local model self-identification prefixes (e.g. "nivm:", "nivm.", "**nivm:**", "Assistant:")
    // Handle at start of text
    processedText = processedText.replace(/^\*{0,2}nivm\*{0,2}[\s]*[:.!;\-–—]\s*/i, '');
    processedText = processedText.replace(/^nivm\s*\n/i, '');
    processedText = processedText.replace(/^\*{0,2}assistant\*{0,2}[\s]*[:.]\s*/i, '');
    // Handle after </think> tag
    processedText = processedText.replace(/(<\/think>\s*)\*{0,2}nivm\*{0,2}[\s]*[:.!;\-–—]\s*/i, '$1');
    processedText = processedText.replace(/(<\/think>\s*)nivm\s*\n/i, '$1');
    processedText = processedText.replace(/(<\/think>\s*)\*{0,2}assistant\*{0,2}[\s]*[:.]\s*/i, '$1');

    // Normalize alternative thinking tags to <think>
    processedText = processedText.replace(/<thought>/gi, '<think>').replace(/<\/thought>/gi, '</think>');
    processedText = processedText.replace(/<reasoning>/gi, '<think>').replace(/<\/reasoning>/gi, '</think>');
    // Strip empty thought tags so they never create ghost thinking elements or break answer splitting
    processedText = processedText.replace(/<think>\s*<\/think>/gi, '');

    // If model closed </think> without an explicit opening <think> tag (common with prefilled prompt templates like Qwen), prepend <think>
    if (processedText.includes('</think>') && !processedText.includes('<think>')) {
        processedText = '<think>' + processedText;
    }

    // Hide and strip tool calls and decision codes from the user UI
    processedText = stripToolCallFromText(processedText, tools);
    processedText = processedText.replace(/\[DECISION:\s*(?:ACCEPT_RESUME|REJECT_RESUME)\]/gi, '');

    let thinkingHtml = '';
    let answerText = processedText;

function deduplicateConsecutiveParagraphs(text) {
    if (!text || typeof text !== 'string') return text;
    const paragraphs = text.split(/\n\s*\n/);
    if (paragraphs.length <= 1) return text;
    const cleanParagraphs = [];
    for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i].trim();
        if (!p) continue;
        if (cleanParagraphs.length > 0) {
            const prev = cleanParagraphs[cleanParagraphs.length - 1];
            const getWords = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
            const w1 = getWords(prev);
            const w2 = getWords(p);
            if (w1.size >= 6 && w2.size >= 6) {
                const intersection = new Set([...w1].filter(x => w2.has(x)));
                const similarity = intersection.size / Math.min(w1.size, w2.size);
                if (similarity >= 0.70) {
                    continue;
                }
            }
        }
        cleanParagraphs.push(p);
    }
    return cleanParagraphs.join('\n\n');
}

    // Keep thoughts collapsed by default unless user has manually opened it during streaming
    const wasOpen = bubbleElement.querySelector('.thinking-block')?.open || false;
    const openAttr = wasOpen ? ' open' : '';

    const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
    const thinkMatches = [];
    let tMatch;
    while ((tMatch = thinkRegex.exec(processedText)) !== null) {
        if (tMatch[1].trim()) thinkMatches.push(tMatch[1].trim());
    }

    if (thinkMatches.length > 0) {
        stopThinkingPhraseRotation();
        const thinkContent = thinkMatches.join('\n\n');
        answerText = processedText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        answerText = answerText.replace(/<think>[\s\S]*$/gi, '').replace(/<\/think>/gi, '').trim();
        answerText = deduplicateConsecutiveParagraphs(answerText);
        
        if (thinkContent) {
            const thinkDuration = resolveThinkDuration(thinkStartTimeOrDuration, isGenerating);
            const durationLabel = thinkDuration !== null ? getCreativeDuration(thinkDuration) : 'Thought for a moment';
            const parsedThink = window.marked ? marked.parse(thinkContent) : escapeHtml(thinkContent);
            thinkingHtml = `
            <details class="thinking-block"${openAttr}>
                <summary class="thinking-summary">
                    <div class="thinking-summary-left">
                        <span class="think-icon-badge"><i class="fa-solid fa-brain"></i></span>
                        <span class="think-status">${durationLabel}</span>
                    </div>
                    <div class="thinking-summary-right">
                        <i class="fa-solid fa-chevron-right think-toggle-icon"></i>
                    </div>
                </summary>
                <div class="thinking-content">${parsedThink}</div>
            </details>`;
        }
    } else if (isGenerating && processedText.includes('<think>')) {
        stopThinkingPhraseRotation();
        const parts = processedText.split('<think>');
        answerText = deduplicateConsecutiveParagraphs(parts[0].trim());
        const streamingThinkContent = (parts[1] || '').trim();
        const currentPhrase = thinkingPhrases[thinkPhraseIndex] || 'Thinking…';
        const parsedStreaming = window.marked && streamingThinkContent ? marked.parse(streamingThinkContent) : escapeHtml(streamingThinkContent);
        thinkingHtml = `
        <details class="thinking-block is-streaming"${openAttr}>
            <summary class="thinking-summary">
                <div class="thinking-summary-left">
                    <span class="think-icon-badge streaming"><i class="fa-solid fa-brain"></i></span>
                    <span class="think-status">${currentPhrase}</span>
                    <span class="think-stream-indicator">
                        <span class="think-dot"></span>
                        <span class="think-dot"></span>
                        <span class="think-dot"></span>
                    </span>
                </div>
                <div class="thinking-summary-right">
                    <i class="fa-solid fa-chevron-right think-toggle-icon"></i>
                </div>
            </summary>
            <div class="thinking-content">${parsedStreaming}</div>
        </details>`;
    } else if (!isGenerating && processedText.includes('<think>')) {
        // Generation completed with an unclosed <think> tag:
        // Automatically enclose the thoughts in a thinking dropdown so they never leak into answerText
        stopThinkingPhraseRotation();
        const parts = processedText.split('<think>');
        answerText = deduplicateConsecutiveParagraphs(parts[0].trim());
        const thinkContent = (parts[1] || '').replace(/<\/think>/gi, '').trim();
        if (thinkContent) {
            const thinkDuration = resolveThinkDuration(thinkStartTimeOrDuration, isGenerating);
            const durationLabel = thinkDuration !== null ? getCreativeDuration(thinkDuration) : 'Thought for a moment';
            const parsedThink = window.marked ? marked.parse(thinkContent) : escapeHtml(thinkContent);
            thinkingHtml = `
            <details class="thinking-block"${openAttr}>
                <summary class="thinking-summary">
                    <div class="thinking-summary-left">
                        <span class="think-icon-badge"><i class="fa-solid fa-brain"></i></span>
                        <span class="think-status">${durationLabel}</span>
                    </div>
                    <div class="thinking-summary-right">
                        <i class="fa-solid fa-chevron-right think-toggle-icon"></i>
                    </div>
                </summary>
                <div class="thinking-content">${parsedThink}</div>
            </details>`;
        }
    } else if (isGenerating && processedText.trim() === '') {
        const pendingStatus = bubbleElement.dataset.initialStatus;
        const pendingIcon = bubbleElement.dataset.initialIcon;
        
        let currentPhrase;
        let iconHtml;
        if (pendingStatus) {
            currentPhrase = pendingStatus;
            iconHtml = `<i class="fa-solid ${pendingIcon || 'fa-file-lines'}"></i>`;
        } else {
            startThinkingPhraseRotation();
            currentPhrase = thinkingPhrases[thinkPhraseIndex] || 'Thinking…';
            iconHtml = '<i class="fa-solid fa-brain"></i>';
        }

        thinkingHtml = `
        <div class="thinking-block is-streaming">
            <div class="thinking-summary">
                <div class="thinking-summary-left">
                    <span class="think-icon-badge streaming">${iconHtml}</span>
                    <span class="think-status">${currentPhrase}</span>
                    <span class="think-stream-indicator">
                        <span class="think-dot"></span>
                        <span class="think-dot"></span>
                        <span class="think-dot"></span>
                    </span>
                </div>
            </div>
        </div>`;
        answerText = '';
    } else {
        stopThinkingPhraseRotation();
        answerText = deduplicateConsecutiveParagraphs(answerText);
    }

    if (!answerText.trim()) {
        if (isGenerating && !thinkingHtml) {
            answerText = '<div style="opacity: 0.6; display: flex; align-items: center; gap: 8px;"><i class="fa-solid fa-circle-notch fa-spin"></i> <span>Processing...</span></div>';
        } else if (isGenerating && thinkingHtml && !thinkingHtml.includes('is-streaming')) {
            answerText = '<div class="streaming-cursor-placeholder" style="opacity: 0.5; font-size: 0.85em; margin-top: 8px; display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-circle-notch fa-spin"></i> <span>Responding…</span></div>';
        } else {
            answerText = '';
        }
    }

    let parsedAnswer = '';
    if (window.marked && answerText) {
        parsedAnswer = marked.parse(answerText);
    } else if (answerText) {
        parsedAnswer = escapeHtml(answerText);
    }

    bubbleElement.innerHTML = thinkingHtml + parsedAnswer;

    // If completely blank (no thoughts and no answer), hide the empty bubble wrapper only when NOT generating
    if (!isGenerating && !thinkingHtml && !parsedAnswer.trim()) {
        bubbleElement.style.display = 'none';
        const actionsEl = bubbleElement.closest('.message-wrapper')?.querySelector('.message-actions');
        if (actionsEl) actionsEl.style.display = 'none';
    } else {
        bubbleElement.style.display = '';
        const actionsEl = bubbleElement.closest('.message-wrapper')?.querySelector('.message-actions');
        if (actionsEl) {
            if (!parsedAnswer.trim() || isGenerating) {
                actionsEl.style.display = 'none';
            } else {
                actionsEl.style.display = '';
            }
        }
    }

    attachCodeCopyButtons(bubbleElement);
}

export function attachCodeCopyButtons(container) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-header')) return;

        const code = pre.querySelector('code');
        const langClass = Array.from(code?.classList || []).find(c => c.startsWith('language-'));
        const lang = langClass ? langClass.replace('language-', '') : 'code';

        const header = document.createElement('div');
        header.className = 'code-header';
        
        const langLabel = document.createElement('span');
        langLabel.textContent = lang;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-code-btn';
        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
            copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
            setTimeout(() => copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy', 2000);
        };

        header.appendChild(langLabel);
        header.appendChild(copyBtn);
        pre.insertBefore(header, pre.firstChild);
    });
}

export async function populateStatsModal() {
    if (state.engineMode === 'native') {
        const activeRole = state.inferenceMode === 'single'
            ? (dom.singleModelRoleSelect?.value || 'coder')
            : 'coder';
        dom.statsModelName.textContent = `Local Engine (${activeRole})`;
        dom.statsArchitecture.textContent = dom[activeRole + 'FlashAttn']?.checked ? 'GGUF (Flash Attn)' : 'GGUF';
        dom.statsModelType.textContent = 'LOCAL_NATIVE';
        dom.statsQuantization.textContent = dom[activeRole + 'KvSelect'] ? dom[activeRole + 'KvSelect'].value.toUpperCase() + ' (KV Cache)' : '-';
        dom.statsContextLimit.textContent = dom[activeRole + 'CtxSlider'] ? dom[activeRole + 'CtxSlider'].value : '8192';
        
        dom.statsTotalTokens.textContent = state.usageStats.totalTokens.toLocaleString();
        dom.statsTotalTime.textContent = state.usageStats.totalDurationSec.toFixed(1) + 's';
        dom.statsTotalCost.textContent = '$0.0000';
        return;
    }

    dom.statsModelName.textContent = state.selectedModel || '-';
    dom.statsArchitecture.textContent = 'Loading...';
    dom.statsModelType.textContent = 'Loading...';
    dom.statsQuantization.textContent = 'Loading...';
    dom.statsContextLimit.textContent = 'Loading...';

    // Fetch deep model metadata
    const { fetchModelDetailsAPI } = await import('./api.js');
    const modelDetails = await fetchModelDetailsAPI(state.selectedModel);
    
    if (modelDetails) {
        dom.statsArchitecture.textContent = modelDetails.arch;
        dom.statsModelType.textContent = modelDetails.type.toUpperCase();
        dom.statsQuantization.textContent = modelDetails.quantization;
        
        if (typeof modelDetails.loadedContextLength === 'number') {
            dom.statsContextLimit.textContent = modelDetails.loadedContextLength.toLocaleString();
        } else {
            dom.statsContextLimit.textContent = modelDetails.loadedContextLength || 'Unknown';
        }
    } else {
        dom.statsArchitecture.textContent = 'Unknown';
        dom.statsModelType.textContent = 'Unknown';
        dom.statsQuantization.textContent = 'Unknown';
        dom.statsContextLimit.textContent = 'Unknown';
        
        // Fallback to basic state data
        const modelData = state.models.find(m => m.id === state.selectedModel);
        if (modelData) {
            if (modelData.context_window) {
                dom.statsContextLimit.textContent = `${modelData.context_window.toLocaleString()} tokens`;
            } else if (modelData.context_length) {
                dom.statsContextLimit.textContent = `${modelData.context_length.toLocaleString()} tokens`;
            } else {
                dom.statsContextLimit.textContent = 'Unknown / Unlimited';
            }
        } else {
            dom.statsContextLimit.textContent = '-';
        }
    }

    // Populate Global Usage
    dom.statsTotalTokens.textContent = state.usageStats.totalTokens.toLocaleString();
    
    const totalSecs = state.usageStats.totalDurationSec;
    let timeStr = `${totalSecs.toFixed(1)}s`;
    if (totalSecs > 60) {
        const m = Math.floor(totalSecs / 60);
        const s = Math.round(totalSecs % 60);
        timeStr = `${m}m ${s}s`;
    }
    if (totalSecs > 3600) {
        const h = Math.floor(totalSecs / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        timeStr = `${h}h ${m}m`;
    }
    dom.statsTotalTime.textContent = timeStr;
    
    dom.statsTotalCost.textContent = `$${state.usageStats.totalCost.toFixed(5)}`;
}

export function renderMemoryDrawer() {
    dom.memoryList.innerHTML = '';
    const keys = Object.keys(window.__nivm_state.memory || {});
    if (keys.length === 0) {
        dom.memoryList.innerHTML = '<div style="padding: 16px; color: var(--text-tertiary); text-align: center;">No memories saved yet. Ask nivm to remember something!</div>';
        return;
    }

    function getCategoryMeta(key) {
        const lower = key.toLowerCase();
        const CATEGORY_META = {
            user_profile: { label: 'User Profile', icon: 'fa-solid fa-user', color: '#6366f1' },
            user_hardware: { label: 'User Hardware', icon: 'fa-solid fa-microchip', color: '#10b981' },
            user_education: { label: 'User Education', icon: 'fa-solid fa-graduation-cap', color: '#3b82f6' },
            user_university: { label: 'University & Academics', icon: 'fa-solid fa-graduation-cap', color: '#3b82f6' },
            user_academics: { label: 'User Academics', icon: 'fa-solid fa-graduation-cap', color: '#3b82f6' },
            user_projects: { label: 'User Projects', icon: 'fa-solid fa-diagram-project', color: '#8b5cf6' },
            user_preferences: { label: 'User Preferences', icon: 'fa-solid fa-sliders', color: '#f59e0b' },
            user_work: { label: 'User Career & Work', icon: 'fa-solid fa-briefcase', color: '#06b6d4' },
            user_career: { label: 'User Career', icon: 'fa-solid fa-briefcase', color: '#06b6d4' },
            user_relationships: { label: 'User Relationships', icon: 'fa-solid fa-user-group', color: '#f43f5e' },
            user_friends: { label: 'Friends & Social', icon: 'fa-solid fa-user-group', color: '#f43f5e' },
            user_family: { label: 'Family & Loved Ones', icon: 'fa-solid fa-heart', color: '#f43f5e' },
            user_social: { label: 'Social Circle', icon: 'fa-solid fa-user-group', color: '#f43f5e' },
            user_hobbies: { label: 'User Hobbies', icon: 'fa-solid fa-gamepad', color: '#ec4899' },
            user_gaming: { label: 'User Gaming', icon: 'fa-solid fa-gamepad', color: '#ec4899' },
            user_health: { label: 'User Health', icon: 'fa-solid fa-heart-pulse', color: '#ef4444' }
        };

        if (CATEGORY_META[key]) return CATEGORY_META[key];

        let icon = 'fa-solid fa-bookmark';
        let color = '#a855f7';
        if (lower.includes('friend') || lower.includes('relat') || lower.includes('social') || lower.includes('fam') || lower.includes('people') || lower.includes('contact')) {
            icon = 'fa-solid fa-user-group';
            color = '#f43f5e';
        } else if (lower.includes('edu') || lower.includes('uni') || lower.includes('school') || lower.includes('college') || lower.includes('acad')) {
            icon = 'fa-solid fa-graduation-cap';
            color = '#3b82f6';
        } else if (lower.includes('work') || lower.includes('job') || lower.includes('career') || lower.includes('company')) {
            icon = 'fa-solid fa-briefcase';
            color = '#06b6d4';
        } else if (lower.includes('code') || lower.includes('dev') || lower.includes('stack') || lower.includes('proj')) {
            icon = 'fa-solid fa-diagram-project';
            color = '#8b5cf6';
        } else if (lower.includes('game') || lower.includes('hobby') || lower.includes('music') || lower.includes('art')) {
            icon = 'fa-solid fa-gamepad';
            color = '#ec4899';
        } else if (lower.includes('health') || lower.includes('fit') || lower.includes('diet') || lower.includes('sport')) {
            icon = 'fa-solid fa-heart-pulse';
            color = '#ef4444';
        } else if (lower.includes('pref') || lower.includes('set') || lower.includes('style')) {
            icon = 'fa-solid fa-sliders';
            color = '#f59e0b';
        }

        const cleanKey = key.replace(/^user_/i, '').replace(/_/g, ' ');
        const label = cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1);
        const fullLabel = key.toLowerCase().startsWith('user_') ? `User ${label}` : label;

        return { label: fullLabel, icon, color };
    }

    keys.forEach(key => {
        const meta = getCategoryMeta(key);

        const item = document.createElement('div');
        item.className = 'chat-history-item';
        item.style.flexDirection = 'column';
        item.style.alignItems = 'flex-start';
        item.style.padding = '12px';
        item.style.marginBottom = '8px';
        
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.width = '100%';
        header.style.marginBottom = '8px';
        
        const titleSpan = document.createElement('div');
        titleSpan.style.display = 'flex';
        titleSpan.style.alignItems = 'center';
        titleSpan.style.gap = '8px';
        titleSpan.innerHTML = `
            <span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:5px; background:${meta.color}22; color:${meta.color}; font-size:0.8em;">
                <i class="${meta.icon}"></i>
            </span>
            <strong style="color:var(--text-primary); font-size: 0.9em;">${meta.label}</strong>
            <span style="font-size:0.75em; opacity:0.6; font-family:monospace;">(${key})</span>
        `;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.style.background = 'transparent';
        deleteBtn.style.border = 'none';
        deleteBtn.style.color = 'var(--text-tertiary)';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.padding = '2px 4px';
        deleteBtn.title = `Delete ${key} category`;
        deleteBtn.onmouseover = () => deleteBtn.style.color = 'var(--accent-rose)';
        deleteBtn.onmouseout = () => deleteBtn.style.color = 'var(--text-tertiary)';
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (await showConfirm('Delete Memory Category', `Are you sure you want to delete the '${key}' category?`)) {
                await import('./api.js').then(m => m.deleteMemoryAPI(key));
                delete window.__nivm_state.memory[key];
                renderMemoryDrawer();
            }
        });

        header.appendChild(titleSpan);
        header.appendChild(deleteBtn);
        
        const contentPreview = document.createElement('div');
        contentPreview.style.fontSize = '0.85em';
        contentPreview.style.color = 'var(--text-secondary)';
        contentPreview.style.lineHeight = '1.5';
        contentPreview.style.padding = '8px 10px';
        contentPreview.style.background = 'rgba(255, 255, 255, 0.03)';
        contentPreview.style.borderRadius = '6px';
        contentPreview.style.border = '1px solid rgba(255, 255, 255, 0.06)';
        contentPreview.style.width = '100%';
        contentPreview.style.boxSizing = 'border-box';
        contentPreview.style.whiteSpace = 'pre-wrap';
        contentPreview.textContent = window.__nivm_state.memory[key];
        
        const editBox = document.createElement('div');
        editBox.style.marginTop = '10px';
        editBox.style.width = '100%';
        editBox.innerHTML = `
            <input type="text" placeholder="Ask nivm to update this category..." class="memory-edit-input" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.2); color: var(--text-primary); font-size: 0.85em;">
        `;
        
        const inputEl = editBox.querySelector('input');
        inputEl.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const text = inputEl.value.trim();
                if (text) {
                    inputEl.disabled = true;
                    inputEl.value = 'Updating...';
                    
                    const currentValue = window.__nivm_state.memory[key];
                    const editPrompt = `[SYSTEM INSTRUCTION] The user is using a UI shortcut to update a long-term memory category.
Target Category: '${key}'
Current Category Data: '${currentValue}'
User's Update Request: '${text}'

INSTRUCTIONS:
1. Analyze the user's request and update the category '${key}'.
2. MERGE the new facts cleanly with the existing data (e.g. using ' | ' separators or clear key-value attributes). Prior facts must NOT be erased unless the user explicitly requests to change or delete them.
3. Ignore all conversational filler (e.g. 'can you add', 'also', 'instead'). Extract ONLY the factual details.
4. Output EXACTLY ONE tool call: TOOL_CALL: write_memory(${key}, <new_merged_value>)
5. DO NOT output any other text before or after the tool call.`;

                    try {
                        const payload = [
                            { role: 'system', content: "You are an expert AI assistant designed to update memory entries accurately." },
                            { role: 'user', content: editPrompt }
                        ];
                        const response = await fetch('/api/chat', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                model: window.__nivm_state.selectedModel,
                                messages: payload,
                                temperature: 0.1,
                                max_tokens: 500,
                                stream: false
                            })
                        });
                        
                        if (!response.ok) throw new Error("API Error");
                        
                        const data = await response.json();
                        const resultText = data.choices[0].message.content;
                        
                        const match = resultText.match(/TOOL_CALL:\s*(read_memory|write_memory)\(([\s\S]*?)\)/);
                        if (match && match[1] === 'write_memory') {
                            const rawArgs = match[2].trim();
                            const firstComma = rawArgs.indexOf(',');
                            let newKey = key;
                            let newVal = rawArgs;
                            if (firstComma !== -1) {
                                newKey = rawArgs.substring(0, firstComma).trim().replace(/['"]/g, '');
                                newVal = rawArgs.substring(firstComma + 1).trim().replace(/^['"]|['"]$/g, '');
                            }
                            
                            await fetch('/api/memory', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ key: newKey, value: newVal })
                            });
                            
                            const { fetchMemoryAPI } = await import('./api.js');
                            window.__nivm_state.memory = await fetchMemoryAPI();
                            renderMemoryDrawer();
                        } else {
                            console.error("Failed to parse tool call from model output:", resultText);
                            inputEl.disabled = false;
                            inputEl.value = text;
                        }
                    } catch (err) {
                        console.error("Error updating memory:", err);
                        inputEl.disabled = false;
                        inputEl.value = text;
                    }
                }
            }
        });

        item.appendChild(header);
        item.appendChild(contentPreview);
        item.appendChild(editBox);
        dom.memoryList.appendChild(item);
    });
}

export async function renderToolsSettings() {
    dom.toolsConfigContainer.innerHTML = '';
    
    if (tools.length === 0) {
        dom.toolsConfigContainer.innerHTML = '<div style="color: var(--text-tertiary); font-size: 0.9em; font-style: italic;">No tools registered.</div>';
        return;
    }

    // Check image models & engine prerequisites
    let imageModelsReady = false;
    let comfyReady = false;
    try {
        const [modelsRes, comfyRes] = await Promise.all([
            fetch('/api/image/models/status').then(r => r.json()).catch(() => null),
            fetch('/api/image/comfy/status').then(r => r.json()).catch(() => null),
        ]);
        imageModelsReady = modelsRes?.all_installed === true;
        comfyReady = comfyRes?.comfyui?.detected === true;
    } catch (e) {
        console.warn('Could not check image studio status:', e);
    }
    
    tools.forEach(tool => {
        const isEnabled = state.enabledTools[tool.name] !== false;
        const isImageTool = (tool.name === 'generate_image' || tool.name === 'edit_image');
        const isBlocked = isImageTool && (!imageModelsReady || !comfyReady);
        
        const cardContainer = document.createElement('div');
        cardContainer.className = 'tool-setting-card';
        cardContainer.style.marginBottom = '12px';
        cardContainer.style.background = 'rgba(255, 255, 255, 0.03)';
        cardContainer.style.border = '1px solid var(--glass-border)';
        cardContainer.style.borderRadius = '8px';
        cardContainer.style.overflow = 'hidden';

        const wrap = document.createElement('div');
        wrap.className = 'tool-setting-row';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = 'space-between';
        wrap.style.padding = '10px 12px';
        
        const infoWrap = document.createElement('div');
        infoWrap.style.flex = '1';
        infoWrap.style.paddingRight = '12px';
        
        const title = document.createElement('div');
        title.style.fontWeight = '500';
        title.style.color = 'var(--text-primary)';
        title.style.display = 'flex';
        title.style.alignItems = 'center';
        title.style.gap = '6px';

        const iconClass = isImageTool ? 'fa-solid fa-paintbrush' : 'fa-solid fa-screwdriver-wrench';
        const iconColor = isImageTool ? '#c084fc' : 'var(--accent-purple)';
        title.innerHTML = `<i class="${iconClass}" style="font-size: 0.8em; color: ${iconColor};"></i><span>${escapeHtml(tool.name)}</span>`;

        if (isBlocked) {
            const blockedBadge = document.createElement('span');
            blockedBadge.style.cssText = 'background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.68rem; padding: 1px 6px; border-radius: 4px; font-weight: 500;';
            blockedBadge.textContent = 'Setup Required';
            title.appendChild(blockedBadge);
        }
        
        const desc = document.createElement('div');
        desc.style.fontSize = '0.82em';
        desc.style.color = 'var(--text-tertiary)';
        desc.style.marginTop = '4px';
        desc.style.lineHeight = '1.35';
        desc.textContent = tool.description;
        
        infoWrap.appendChild(title);
        infoWrap.appendChild(desc);
        
        const toggleBtn = document.createElement('button');
        if (isBlocked) {
            toggleBtn.className = 'btn-secondary';
            toggleBtn.style.padding = '6px 12px';
            toggleBtn.style.fontSize = '0.82em';
            toggleBtn.style.opacity = '0.5';
            toggleBtn.style.cursor = 'not-allowed';
            toggleBtn.textContent = 'Disabled';
            toggleBtn.title = 'Image models and ComfyUI backend required. Download in Model Settings.';
            toggleBtn.disabled = true;
        } else {
            toggleBtn.className = isEnabled ? 'btn-primary' : 'btn-secondary';
            toggleBtn.style.padding = '6px 12px';
            toggleBtn.style.fontSize = '0.85em';
            toggleBtn.textContent = isEnabled ? 'Enabled' : 'Disabled';
        }
        
        wrap.appendChild(infoWrap);
        wrap.appendChild(toggleBtn);
        cardContainer.appendChild(wrap);

        // If image tool is missing prerequisites, display direct redirect action
        if (isBlocked) {
            const redirectRow = document.createElement('div');
            redirectRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(245, 158, 11, 0.06); border-top: 1px solid rgba(245, 158, 11, 0.15); font-size: 0.76rem;';
            
            const reasonText = !imageModelsReady && !comfyReady ? 'Requires ComfyUI engine & 18 GB image models' : (!imageModelsReady ? 'Requires Qwen-Rapid diffusion models (18 GB)' : 'Requires ComfyUI backend engine');
            redirectRow.innerHTML = `
                <span style="color: #fbbf24; display: flex; align-items: center; gap: 5px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>${reasonText}</span>
                </span>
                <button type="button" class="btn-secondary redirect-to-model-settings" style="padding: 3px 8px; font-size: 0.72rem; color: #c084fc; border-color: rgba(139, 92, 246, 0.4); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
                    <span>Download in Model Settings</span> <i class="fa-solid fa-arrow-right"></i>
                </button>
            `;

            const redirectBtn = redirectRow.querySelector('.redirect-to-model-settings');
            redirectBtn.onclick = () => {
                if (dom.toolsModal) dom.toolsModal.classList.add('hidden');
                if (dom.settingsModal) dom.settingsModal.classList.remove('hidden');
                initImageStudioSettings();
                const studioSection = document.getElementById('imageStudioSection');
                if (studioSection) {
                    studioSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    studioSection.style.transition = 'box-shadow 0.4s ease';
                    studioSection.style.boxShadow = '0 0 20px rgba(139, 92, 246, 0.6)';
                    setTimeout(() => { studioSection.style.boxShadow = ''; }, 2500);
                }
            };

            cardContainer.appendChild(redirectRow);
        }

        if (tool.name === 'execute_terminal') {
            const secWrap = document.createElement('div');
            secWrap.className = 'terminal-sec-setting';
            secWrap.style.padding = '10px 12px';
            secWrap.style.borderTop = '1px solid rgba(255, 255, 255, 0.06)';
            secWrap.style.background = 'rgba(0, 0, 0, 0.2)';
            secWrap.style.display = isEnabled ? 'block' : 'none';

            const currentMode = state.terminalSecurityMode || 'dangerous';

            secWrap.innerHTML = `
                <div style="font-size: 0.82rem; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-shield-halved" style="color: var(--accent-purple); font-size: 0.9em;"></i>
                    <span>Execution Permission Level</span>
                </div>
                <div style="font-size: 0.78rem; color: var(--text-tertiary); margin-bottom: 8px; line-height: 1.35;">
                    Specify when nivm must ask for your explicit confirmation before executing terminal commands.
                </div>
                <select class="form-select terminal-sec-mode-select" style="width: 100%; padding: 6px 10px; font-size: 0.82rem; background: rgba(18, 18, 21, 0.9); border: 1px solid var(--glass-border); border-radius: 6px; color: var(--text-primary);">
                    <option value="dangerous" ${currentMode === 'dangerous' ? 'selected' : ''}>⚠️ Ask on dangerous commands only (Recommended)</option>
                    <option value="always" ${currentMode === 'always' ? 'selected' : ''}>🔒 Always ask for confirmation</option>
                    <option value="never" ${currentMode === 'never' ? 'selected' : ''}>⚡ Never ask (Full Autonomous)</option>
                </select>
            `;

            const selectEl = secWrap.querySelector('.terminal-sec-mode-select');
            selectEl.onchange = (e) => {
                const newMode = e.target.value;
                saveTerminalSecurityMode(newMode);
                showNotification(`Terminal security: ${newMode === 'dangerous' ? 'Dangerous only' : (newMode === 'always' ? 'Always ask' : 'Never ask')}`, 'info');
            };

            toggleBtn.onclick = () => {
                const newState = !(state.enabledTools[tool.name] !== false);
                state.enabledTools[tool.name] = newState;
                saveEnabledTools();
                
                toggleBtn.className = newState ? 'btn-primary' : 'btn-secondary';
                toggleBtn.textContent = newState ? 'Enabled' : 'Disabled';
                secWrap.style.display = newState ? 'block' : 'none';
            };

            cardContainer.appendChild(secWrap);
        } else if (!isBlocked) {
            toggleBtn.onclick = () => {
                const newState = !(state.enabledTools[tool.name] !== false);
                state.enabledTools[tool.name] = newState;
                saveEnabledTools();
                
                toggleBtn.className = newState ? 'btn-primary' : 'btn-secondary';
                toggleBtn.textContent = newState ? 'Enabled' : 'Disabled';
            };
        }

        dom.toolsConfigContainer.appendChild(cardContainer);
    });
}

// ── Image Studio Settings Wiring & Progress Polling ──
let _imageStudioPollInterval = null;
let _imageStudioEventsBound = false;

export async function initImageStudioSettings() {
    const masterBadge = document.getElementById('imageStudioMasterBadge');
    const comfyBadge = document.getElementById('comfyStatusBadge');
    const comfyPathDisplay = document.getElementById('comfyPathDisplay');
    const customComfyInput = document.getElementById('customComfyPathInput');
    const setComfyBtn = document.getElementById('setComfyPathBtn');
    const autoSetupBtn = document.getElementById('autoSetupComfyBtn');
    const comfyProgressBox = document.getElementById('comfySetupProgressBox');
    const comfyStepText = document.getElementById('comfySetupStepText');
    const comfyTargetDir = document.getElementById('comfySetupTargetDir');
    const comfyPct = document.getElementById('comfySetupPct');
    const comfyProgressBar = document.getElementById('comfySetupProgressBar');
    const comfyLogText = document.getElementById('comfySetupLogText');

    const modelsBadge = document.getElementById('imageModelsBadge');
    const verifiedBox = document.getElementById('imageModelsVerifiedBox');
    const unetCheck = document.getElementById('unetModelCheck');
    const clipCheck = document.getElementById('clipModelCheck');
    const vaeCheck = document.getElementById('vaeModelCheck');
    const downloadBtn = document.getElementById('downloadImageModelsBtn');
    const downloadProgressBox = document.getElementById('imageDownloadProgressBox');
    const dlModelName = document.getElementById('imageDownloadModelName');
    const dlTargetPath = document.getElementById('imageDownloadTargetPath');
    const dlPct = document.getElementById('imageDownloadPct');
    const dlProgressBar = document.getElementById('imageDownloadProgressBar');
    const dlBytes = document.getElementById('imageDownloadBytes');
    const dlSpeed = document.getElementById('imageDownloadSpeed');
    const dlEta = document.getElementById('imageDownloadEta');

    async function pollStatus() {
        try {
            const [modelsRes, comfyRes, dlRes] = await Promise.all([
                fetch('/api/image/models/status').then(r => r.json()).catch(() => null),
                fetch('/api/image/comfy/status').then(r => r.json()).catch(() => null),
                fetch('/api/image/models/download/status').then(r => r.json()).catch(() => null),
            ]);

            const comfyDetected = comfyRes?.comfyui?.detected === true;
            const modelsInstalled = modelsRes?.all_installed === true;

            // Update Master Badge
            if (masterBadge) {
                if (comfyDetected && modelsInstalled) {
                    masterBadge.textContent = 'Active & Ready';
                    masterBadge.style.color = '#34d399';
                    masterBadge.style.background = 'rgba(52, 211, 153, 0.15)';
                    masterBadge.style.borderColor = 'rgba(52, 211, 153, 0.3)';
                } else {
                    masterBadge.textContent = 'Action Required';
                    masterBadge.style.color = '#f59e0b';
                    masterBadge.style.background = 'rgba(245, 158, 11, 0.15)';
                    masterBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                }
            }

            // Update ComfyUI Backend Engine Display
            if (comfyBadge && comfyPathDisplay) {
                if (comfyDetected) {
                    comfyBadge.textContent = 'Detected & Ready';
                    comfyBadge.style.color = '#34d399';
                    comfyBadge.style.background = 'rgba(52, 211, 153, 0.15)';
                    comfyBadge.style.borderColor = 'rgba(52, 211, 153, 0.3)';
                    comfyPathDisplay.innerHTML = `<i class="fa-solid fa-folder-check" style="color: #34d399; margin-right: 5px;"></i>${escapeHtml(comfyRes.comfyui.path)}<br><span style="color: var(--text-muted); font-size: 0.7rem;">Python: ${escapeHtml(comfyRes.comfyui.python_bin)} | GGUF Nodes: ${comfyRes.comfyui.has_gguf_nodes ? '<span style="color:#34d399;">Installed</span>' : '<span style="color:#f59e0b;">Missing</span>'}</span>`;
                    if (autoSetupBtn) {
                        autoSetupBtn.innerHTML = '<i class="fa-solid fa-check"></i> ComfyUI Engine Ready';
                        autoSetupBtn.className = 'btn-secondary';
                    }
                } else {
                    comfyBadge.textContent = 'Not Found';
                    comfyBadge.style.color = '#f59e0b';
                    comfyBadge.style.background = 'rgba(245, 158, 11, 0.15)';
                    comfyBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                    comfyPathDisplay.innerHTML = `<span style="color: #f59e0b;"><i class="fa-solid fa-triangle-exclamation" style="margin-right: 5px;"></i>ComfyUI is required to run local diffusion. Click Auto-Install below or specify an existing folder.</span>`;
                    if (autoSetupBtn && comfyRes?.status !== 'installing') {
                        autoSetupBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Auto-Install ComfyUI to nivm/engine/';
                        autoSetupBtn.disabled = false;
                        autoSetupBtn.className = 'btn-primary';
                    }
                }
            }

            // ComfyUI Auto-Setup Progress Tracking
            let isComfyInstalling = comfyRes?.status === 'installing';
            if (comfyProgressBox) {
                if (isComfyInstalling) {
                    comfyProgressBox.style.display = 'block';
                    if (autoSetupBtn) {
                        autoSetupBtn.disabled = true;
                        autoSetupBtn.textContent = 'Installing ComfyUI Engine...';
                    }
                    if (comfyStepText) comfyStepText.textContent = comfyRes.progress_message || `[Step ${comfyRes.step}/3] ${comfyRes.step_name}`;
                    if (comfyTargetDir) comfyTargetDir.textContent = 'Target: ' + (comfyRes.target_dir || 'nivm/engine/ComfyUI');
                    if (comfyPct) comfyPct.textContent = (comfyRes.percent || 0) + '%';
                    if (comfyProgressBar) comfyProgressBar.style.width = (comfyRes.percent || 0) + '%';
                    if (comfyLogText && comfyRes.log_lines && comfyRes.log_lines.length > 0) {
                        comfyLogText.textContent = comfyRes.log_lines.join('\n');
                        comfyLogText.scrollTop = comfyLogText.scrollHeight;
                    }
                } else if (comfyRes?.status === 'completed') {
                    comfyProgressBox.style.display = 'none';
                    if (autoSetupBtn) {
                        autoSetupBtn.disabled = false;
                        autoSetupBtn.innerHTML = '<i class="fa-solid fa-check"></i> ComfyUI Engine Ready';
                    }
                } else if (comfyRes?.status === 'error') {
                    comfyProgressBox.style.display = 'block';
                    if (autoSetupBtn) {
                        autoSetupBtn.disabled = false;
                        autoSetupBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry Auto-Install';
                    }
                    if (comfyStepText) {
                        comfyStepText.textContent = '❌ ' + (comfyRes.error || 'Setup failed');
                        comfyStepText.style.color = '#f43f5e';
                    }
                } else {
                    comfyProgressBox.style.display = 'none';
                }
            }

            // Update Models Checklist (Shows checkmark if file is already there, indicates missing otherwise)
            if (unetCheck && modelsRes?.unet) {
                unetCheck.innerHTML = modelsRes.unet.installed
                    ? `<span style="color: #34d399; font-weight: 500;"><i class="fa-solid fa-circle-check" style="margin-right: 5px;"></i>UNet (Qwen-Rapid-NSFW-v23_Q4_K.gguf)</span>`
                    : `<span style="color: #f59e0b;"><i class="fa-regular fa-circle" style="margin-right: 5px;"></i>UNet (Qwen-Rapid-NSFW-v23_Q4_K.gguf)</span>`;
            }
            if (clipCheck && modelsRes?.text_encoder) {
                clipCheck.innerHTML = modelsRes.text_encoder.installed
                    ? `<span style="color: #34d399; font-weight: 500;"><i class="fa-solid fa-circle-check" style="margin-right: 5px;"></i>Text Encoder (Qwen2.5-VL CLIP)</span>`
                    : `<span style="color: #f59e0b;"><i class="fa-regular fa-circle" style="margin-right: 5px;"></i>Text Encoder (Qwen2.5-VL CLIP)</span>`;
            }
            if (vaeCheck && modelsRes?.vae) {
                vaeCheck.innerHTML = modelsRes.vae.installed
                    ? `<span style="color: #34d399; font-weight: 500;"><i class="fa-solid fa-circle-check" style="margin-right: 5px;"></i>VAE (qwen_image_vae.safetensors)</span>`
                    : `<span style="color: #f59e0b;"><i class="fa-regular fa-circle" style="margin-right: 5px;"></i>VAE (qwen_image_vae.safetensors)</span>`;
            }

            // Update Models Badge & Download Button:
            // IF VERIFIED: Remove the download button completely!
            // IF PARTIAL: Skip existing files, only offer download for missing files!
            if (modelsBadge) {
                if (modelsInstalled) {
                    modelsBadge.textContent = 'Verified (18 GB)';
                    modelsBadge.style.color = '#34d399';
                    modelsBadge.style.background = 'rgba(52, 211, 153, 0.15)';
                    modelsBadge.style.borderColor = 'rgba(52, 211, 153, 0.3)';

                    // Remove download button when verified
                    if (downloadBtn) downloadBtn.style.display = 'none';
                    if (verifiedBox) verifiedBox.style.display = 'flex';
                } else {
                    modelsBadge.textContent = 'Missing Models';
                    modelsBadge.style.color = '#f59e0b';
                    modelsBadge.style.background = 'rgba(245, 158, 11, 0.15)';
                    modelsBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';

                    if (verifiedBox) verifiedBox.style.display = 'none';

                    if (downloadBtn) {
                        const missingList = [];
                        if (!modelsRes?.unet?.installed) missingList.push({ name: 'UNet', size: '13.3 GB' });
                        if (!modelsRes?.text_encoder?.installed) missingList.push({ name: 'Text Encoder', size: '4.7 GB' });
                        if (!modelsRes?.vae?.installed) missingList.push({ name: 'VAE', size: '253 MB' });

                        if (dlRes?.status !== 'downloading') {
                            downloadBtn.style.display = 'flex';
                            downloadBtn.disabled = false;
                            downloadBtn.className = 'btn-primary';

                            if (missingList.length === 1) {
                                downloadBtn.innerHTML = `<i class="fa-solid fa-download"></i> Download Missing ${missingList[0].name} (${missingList[0].size})`;
                            } else if (missingList.length === 2) {
                                downloadBtn.innerHTML = `<i class="fa-solid fa-download"></i> Download ${missingList.length} Missing Models (skipping verified)`;
                            } else {
                                downloadBtn.innerHTML = `<i class="fa-solid fa-download"></i> Download Image Models (aria2)`;
                            }
                        }
                    }
                }
            }

            // Model Download Progress Tracking
            let isDownloading = dlRes?.status === 'downloading';
            if (downloadProgressBox) {
                if (isDownloading) {
                    downloadProgressBox.style.display = 'block';
                    if (downloadBtn) {
                        downloadBtn.style.display = 'flex';
                        downloadBtn.disabled = true;
                        downloadBtn.textContent = 'Downloading Models in Background...';
                    }
                    if (dlModelName) dlModelName.textContent = `[${dlRes.current_index}/${dlRes.total_models}] ${dlRes.current_model}`;
                    if (dlTargetPath) dlTargetPath.textContent = 'Saving to: ' + (dlRes.target_path || dlRes.target_dir || 'nivm/models/image/');
                    if (dlPct) dlPct.textContent = (dlRes.percent || 0) + '%';
                    if (dlProgressBar) dlProgressBar.style.width = (dlRes.percent || 0) + '%';
                    if (dlBytes) dlBytes.textContent = `${dlRes.downloaded_str || '0 MB'} / ${dlRes.total_str || '0 MB'}`;
                    if (dlSpeed) dlSpeed.textContent = dlRes.speed_str || '0 MB/s';
                    if (dlEta) dlEta.textContent = 'ETA: ' + (dlRes.eta_str || '--');
                } else if (dlRes?.status === 'completed') {
                    downloadProgressBox.style.display = 'none';
                } else {
                    downloadProgressBox.style.display = 'none';
                }
            }

            // Clear polling if neither operation is active
            if (!isComfyInstalling && !isDownloading && _imageStudioPollInterval) {
                clearInterval(_imageStudioPollInterval);
                _imageStudioPollInterval = null;
            }
        } catch (e) {
            console.error('Image Studio polling error:', e);
        }
    }

    // Kick off initial poll
    await pollStatus();

    // Bind Action Buttons Once
    if (!_imageStudioEventsBound) {
        _imageStudioEventsBound = true;

        if (setComfyBtn && customComfyInput) {
            setComfyBtn.onclick = async () => {
                const path = customComfyInput.value.trim();
                if (!path) {
                    showNotification('Please enter a valid ComfyUI directory path', 'warning');
                    return;
                }
                setComfyBtn.disabled = true;
                setComfyBtn.textContent = 'Checking...';
                try {
                    const res = await fetch('/api/image/comfy/set_path', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.detail || 'Could not verify ComfyUI at path');
                    showNotification('ComfyUI path saved successfully!', 'success');
                    customComfyInput.value = '';
                    await pollStatus();
                } catch (err) {
                    showNotification(err.message, 'error');
                } finally {
                    setComfyBtn.disabled = false;
                    setComfyBtn.textContent = 'Set Path';
                }
            };
        }

        if (autoSetupBtn) {
            autoSetupBtn.onclick = async () => {
                autoSetupBtn.disabled = true;
                autoSetupBtn.textContent = 'Starting setup...';
                try {
                    const res = await fetch('/api/image/comfy/setup', { method: 'POST' });
                    const data = await res.json();
                    showNotification('ComfyUI automated installation started in nivm/engine/ComfyUI', 'info');
                    if (!_imageStudioPollInterval) {
                        _imageStudioPollInterval = setInterval(pollStatus, 1000);
                    }
                    await pollStatus();
                } catch (err) {
                    showNotification('Failed to start ComfyUI setup: ' + err.message, 'error');
                    autoSetupBtn.disabled = false;
                }
            };
        }

        if (downloadBtn) {
            downloadBtn.onclick = async () => {
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'Initializing aria2...';
                try {
                    const res = await fetch('/api/image/models/download', { method: 'POST' });
                    const data = await res.json();
                    showNotification('Image models background download started with aria2c', 'info');
                    if (!_imageStudioPollInterval) {
                        _imageStudioPollInterval = setInterval(pollStatus, 1000);
                    }
                    await pollStatus();
                } catch (err) {
                    showNotification('Failed to start model download: ' + err.message, 'error');
                    downloadBtn.disabled = false;
                }
            };
        }
    }
}

// --- Dropdown Notification System ---
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

    const drawerThemeBtn = document.getElementById('drawerThemeBtn');
    if (drawerThemeBtn) {
        drawerThemeBtn.onclick = () => {
            closeAllDrawers();
            const thBtn = document.getElementById('themeBtn');
            if (thBtn) thBtn.click();
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

export function isMultimodalModel(model = '', endpoint = '') {
    const m = (model || '').toLowerCase();
    const ep = (endpoint || '').toLowerCase();
    if (ep.includes('googleapis.com') || ep.includes('generativelanguage')) return true;
    if (m.includes('gemini')) return true;
    if (m.includes('gpt-4o') || m.includes('gpt-4-turbo') || m.includes('gpt-4-vision') || m.includes('chatgpt-4o')) return true;
    if (m.includes('claude-3') || m.includes('pixtral') || m.includes('llava') || m.includes('vision') || m.includes('-vl') || m.includes('_vl') || m.includes('minicpm-v') || m.includes('internvl') || m.includes('ovis') || m.includes('qwen-vl')) return true;
    return false;
}
window.isMultimodalModel = isMultimodalModel;

export function isVisionSupported() {
    if (state.inferenceMode === 'api') {
        if (state.apiMultimodal !== undefined && state.apiMultimodal !== null) {
            return Boolean(state.apiMultimodal);
        }
        const model = (state.selectedModel || dom.apiModelInput?.value || '').toLowerCase();
        const endpoint = (dom.apiChatUrl?.value || dom.apiBaseUrl?.value || '').toLowerCase();
        return isMultimodalModel(model, endpoint);
    }
    if (state.inferenceMode === 'routing') {
        return true;
    }
    if (state.inferenceMode === 'single') {
        const role = dom.singleModelRoleSelect ? dom.singleModelRoleSelect.value : (state.selectedModel || 'custom');
        if (role === 'vision') return true;
        if (role === 'custom') {
            const mmproj = (state.customMmprojPath || '').trim();
            return Boolean(mmproj && mmproj.toLowerCase() !== 'none');
        }
        return false;
    }
    return false;
}
window.isVisionSupported = isVisionSupported;

export function setVisionEnabled(enabled) {
    if (!isVisionSupported()) {
        enabled = false;
    }
    state.visionEnabled = !!enabled;
    updateVisionAvailabilityUI();
}
window.setVisionEnabled = setVisionEnabled;

export function updateVisionAvailabilityUI() {
    const supported = isVisionSupported();
    if (dom.visionToggleBtn) {
        if (!supported) {
            dom.visionToggleBtn.disabled = true;
            dom.visionToggleBtn.classList.add('disabled');
            dom.visionToggleBtn.classList.remove('active');
            dom.visionToggleBtn.title = state.inferenceMode === 'api'
                ? "Vision is disabled for this API provider/model (Enable Multimodal in API Settings)"
                : "Vision is unavailable (No mmproj projector configured for this model)";
            state.visionEnabled = false;
            if (dom.attachImgBtn) dom.attachImgBtn.classList.add('hidden');
            if (dom.micRecordBtn) dom.micRecordBtn.classList.add('hidden');
            clearAttachedImage();
        } else {
            dom.visionToggleBtn.disabled = false;
            dom.visionToggleBtn.classList.remove('disabled');
            if (state.visionEnabled) {
                dom.visionToggleBtn.classList.add('active');
                dom.visionToggleBtn.title = "Vision is active (Multimodal enabled)";
                if (dom.attachImgBtn) dom.attachImgBtn.classList.remove('hidden');
                if (dom.micRecordBtn) dom.micRecordBtn.classList.remove('hidden');
            } else {
                dom.visionToggleBtn.classList.remove('active');
                dom.visionToggleBtn.title = "Enable Vision (Multimodal)";
                if (dom.attachImgBtn) dom.attachImgBtn.classList.add('hidden');
                if (dom.micRecordBtn) dom.micRecordBtn.classList.add('hidden');
            }
        }
    }
}
window.updateVisionAvailabilityUI = updateVisionAvailabilityUI;

export function setupVisionUI() {
    if (dom.visionToggleBtn) {
        dom.visionToggleBtn.addEventListener('click', () => {
            if (state.inferenceMode === 'api' && !isVisionSupported()) return;
            setVisionEnabled(!state.visionEnabled);
        });
    }

    if (dom.attachImgBtn && dom.imageUploadInput) {
        dom.attachImgBtn.addEventListener('click', () => {
            if (state.inferenceMode === 'api' && !isVisionSupported()) return;
            dom.imageUploadInput.click();
        });

        dom.imageUploadInput.addEventListener('change', (e) => {
            if (state.inferenceMode === 'api' && !isVisionSupported()) return;
            handleImageFiles(e.target.files);
        });
    }

    // Paste support
    if (dom.userPrompt) {
        dom.userPrompt.addEventListener('paste', (e) => {
            if ((state.inferenceMode === 'api' && !isVisionSupported()) || !state.visionEnabled) return;
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            const files = [];
            for (let item of items) {
                if (item.type.indexOf('image') === 0 || item.type === 'application/pdf' || item.type.indexOf('video') === 0 || item.type.indexOf('audio') === 0) {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
            if (files.length > 0) {
                e.preventDefault();
                handleImageFiles(files);
            }
        });
    }

    // Drag and Drop support
    const preventDefaults = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    document.body.addEventListener('drop', (e) => {
        if ((state.inferenceMode === 'api' && !isVisionSupported()) || !state.visionEnabled) return;
        const dt = e.dataTransfer;
        const files = [];
        if (dt.files && dt.files.length > 0) {
            for (let i = 0; i < dt.files.length; i++) {
                const file = dt.files[i];
                if (file.type.indexOf('image') === 0 || file.type === 'application/pdf' || file.type.indexOf('video') === 0 || file.type.indexOf('audio') === 0) {
                    files.push(file);
                }
            }
        }
        if (files.length > 0) {
            handleImageFiles(files);
        }
    });
}

window.removeAttachedImage = function(index) {
    if (state.attachedImages && state.attachedImages[index]) {
        URL.revokeObjectURL(state.attachedImages[index].url);
        state.attachedImages.splice(index, 1);
        renderImagePreviews();
    }
};

function handleImageFiles(files) {
    if (state.inferenceMode === 'api' && !isVisionSupported()) {
        showNotification('Current API provider/model is text-only. Enable Multimodal in API Settings to attach files.', 'warning');
        return;
    }
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        state.attachedImages.push({
            file: file,
            type: file.type,
            url: URL.createObjectURL(file)
        });
    }
    renderImagePreviews();
}

let currentPreviewAudio = null;

function buildAudioPreviewPill(imgObj, index) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'image-preview-item preview-audio-pill';
    
    const fileName = imgObj.file?.name || 'audio';
    const isRecording = fileName.startsWith('recording_');
    const displayName = isRecording ? 'Voice recording' : fileName;
    
    // Play button on the left
    const playBtn = document.createElement('button');
    playBtn.className = 'preview-audio-play';
    playBtn.type = 'button';
    playBtn.title = 'Play preview';
    playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    
    // Info container in the middle
    const info = document.createElement('div');
    info.className = 'preview-audio-info';
    
    const metaRow = document.createElement('div');
    metaRow.className = 'preview-audio-meta';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'preview-audio-name';
    nameSpan.textContent = displayName.length > 20 ? displayName.substring(0, 18) + '...' : displayName;
    nameSpan.title = fileName;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'preview-audio-time';
    timeSpan.textContent = '0:00';
    
    metaRow.appendChild(nameSpan);
    metaRow.appendChild(timeSpan);
    
    const waveWrap = document.createElement('div');
    waveWrap.className = 'preview-waveform-wrap';
    
    const canvas = document.createElement('canvas');
    canvas.className = 'preview-waveform-canvas';
    waveWrap.appendChild(canvas);
    
    info.appendChild(metaRow);
    info.appendChild(waveWrap);
    
    const audio = new Audio(imgObj.url);
    audio.preload = 'metadata';
    let bars = [];
    let animFrame = null;
    const numBars = 26;
    
    const formatTime = (s) => {
        if (!s || isNaN(s) || !isFinite(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
    };
    
    const generateBars = async () => {
        try {
            const response = await fetch(imgObj.url);
            const arrayBuffer = await response.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decoded = await audioCtx.decodeAudioData(arrayBuffer);
            const rawData = decoded.getChannelData(0);
            const blockSize = Math.floor(rawData.length / numBars);
            bars = [];
            for (let i = 0; i < numBars; i++) {
                let sum = 0;
                for (let j = 0; j < blockSize; j++) {
                    sum += Math.abs(rawData[i * blockSize + j]);
                }
                bars.push(sum / blockSize);
            }
            const maxVal = Math.max(...bars) || 1;
            bars = bars.map(b => Math.max(0.12, b / maxVal));
            audioCtx.close();
        } catch (e) {
            bars = Array.from({ length: numBars }, () => 0.15 + Math.random() * 0.85);
        }
        drawWaveform();
    };
    
    const drawWaveform = () => {
        const dpr = window.devicePixelRatio || 1;
        const w = waveWrap.clientWidth || 140;
        const h = 18;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        
        if (bars.length === 0) return;
        
        const barW = Math.max(2, (w / bars.length) * 0.55);
        const gap = w / bars.length;
        const duration = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 1;
        const progress = audio.currentTime / duration;
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#f4f4f5';
        
        bars.forEach((val, i) => {
            const barH = Math.max(3, val * (h - 2));
            const x = i * gap + (gap - barW) / 2;
            const y = (h - barH) / 2;
            const barProgress = (i + 0.5) / bars.length;
            
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(x, y, barW, barH, 1);
            } else {
                ctx.rect(x, y, barW, barH);
            }
            ctx.fillStyle = barProgress <= progress ? accentColor : 'rgba(255, 255, 255, 0.2)';
            ctx.fill();
        });
    };
    
    const animLoop = () => {
        drawWaveform();
        if (isFinite(audio.duration) && audio.duration > 0) {
            timeSpan.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
        } else {
            timeSpan.textContent = formatTime(audio.currentTime);
        }
        if (!audio.paused) {
            animFrame = requestAnimationFrame(animLoop);
        }
    };
    
    playBtn.onclick = (e) => {
        e.stopPropagation();
        if (audio.paused) {
            if (currentPreviewAudio && currentPreviewAudio !== audio) {
                currentPreviewAudio.pause();
            }
            currentPreviewAudio = audio;
            audio.play().then(() => {
                playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
                playBtn.classList.add('playing');
                animLoop();
            }).catch(err => console.warn('Preview audio play error:', err));
        } else {
            audio.pause();
            playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
            playBtn.classList.remove('playing');
            if (animFrame) cancelAnimationFrame(animFrame);
        }
    };
    
    audio.onended = () => {
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        playBtn.classList.remove('playing');
        if (animFrame) cancelAnimationFrame(animFrame);
        drawWaveform();
        if (isFinite(audio.duration) && audio.duration > 0) {
            timeSpan.textContent = formatTime(audio.duration);
        }
    };
    
    audio.onloadedmetadata = () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
            timeSpan.textContent = formatTime(audio.duration);
        }
    };
    
    waveWrap.onclick = (e) => {
        e.stopPropagation();
        if (!isFinite(audio.duration) || audio.duration <= 0) return;
        const rect = waveWrap.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = frac * audio.duration;
        drawWaveform();
        timeSpan.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    };
    
    generateBars();
    
    // Remove button on the right (flex item, non-overlapping)
    const rmBtn = document.createElement('button');
    rmBtn.className = 'remove-image-btn';
    rmBtn.type = 'button';
    rmBtn.title = 'Remove';
    rmBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    rmBtn.onclick = (e) => {
        e.stopPropagation();
        audio.pause();
        audio.src = '';
        if (animFrame) cancelAnimationFrame(animFrame);
        if (currentPreviewAudio === audio) currentPreviewAudio = null;
        window.removeAttachedImage(index);
    };
    
    itemDiv.appendChild(playBtn);
    itemDiv.appendChild(info);
    itemDiv.appendChild(rmBtn);
    
    return itemDiv;
}

export function renderImagePreviews() {
    window.renderImagePreviews = renderImagePreviews;
    if (!dom.imagePreviewContainer) return;
    
    if (currentPreviewAudio) {
        try {
            currentPreviewAudio.pause();
            currentPreviewAudio.src = '';
        } catch (e) {}
        currentPreviewAudio = null;
    }
    
    dom.imagePreviewContainer.innerHTML = '';
    
    if (state.attachedImages.length > 0) {
        state.attachedImages.forEach((imgObj, index) => {
            const isAudio = imgObj.type && imgObj.type.startsWith('audio/');
            
            if (isAudio) {
                const audioPill = buildAudioPreviewPill(imgObj, index);
                dom.imagePreviewContainer.appendChild(audioPill);
                return;
            }
            
            const itemDiv = document.createElement('div');
            itemDiv.className = 'image-preview-item';
            
            const isVideo = imgObj.type && imgObj.type.startsWith('video/');
            const isPdf = imgObj.type === 'application/pdf' || imgObj.file.name.toLowerCase().endsWith('.pdf');
            const fileName = imgObj.file?.name || 'file';
            
            if (isPdf) {
                // PDF card
                itemDiv.className = 'image-preview-item preview-doc-pill';
                const icon = document.createElement('div');
                icon.className = 'preview-doc-icon';
                icon.innerHTML = '<i class="fa-solid fa-file-pdf"></i>';
                const label = document.createElement('span');
                label.className = 'preview-doc-name';
                label.textContent = fileName.length > 20 ? fileName.substring(0, 17) + '...' : fileName;
                label.title = fileName;
                itemDiv.appendChild(icon);
                itemDiv.appendChild(label);
            } else if (isVideo) {
                // Video thumbnail with play overlay
                itemDiv.className = 'image-preview-item preview-video-thumb';
                const vid = document.createElement('video');
                vid.src = imgObj.url;
                vid.muted = true;
                vid.preload = 'metadata';
                vid.playsInline = true;
                vid.addEventListener('loadeddata', () => { vid.currentTime = 0.1; }, { once: true });
                const playIcon = document.createElement('div');
                playIcon.className = 'preview-video-play';
                playIcon.innerHTML = '<i class="fa-solid fa-play"></i>';
                // Type badge
                const badge = document.createElement('span');
                badge.className = 'preview-type-badge';
                badge.textContent = '🎥';
                itemDiv.appendChild(vid);
                itemDiv.appendChild(playIcon);
                itemDiv.appendChild(badge);
            } else {
                // Image thumbnail
                const img = document.createElement('img');
                img.src = imgObj.url;
                itemDiv.appendChild(img);
            }
            
            const rmBtn = document.createElement('button');
            rmBtn.className = 'remove-image-btn';
            rmBtn.type = 'button';
            rmBtn.title = 'Remove';
            rmBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            rmBtn.onclick = () => window.removeAttachedImage(index);
            
            itemDiv.appendChild(rmBtn);
            dom.imagePreviewContainer.appendChild(itemDiv);
        });
        dom.imagePreviewContainer.classList.remove('hidden');
    } else {
        dom.imagePreviewContainer.classList.add('hidden');
    }
}

export function clearAttachedImage() {
    if (currentPreviewAudio) {
        try {
            currentPreviewAudio.pause();
            currentPreviewAudio.src = '';
        } catch (e) {}
        currentPreviewAudio = null;
    }
    if (state.attachedImages) {
        state.attachedImages.forEach(img => URL.revokeObjectURL(img.url));
    }
    state.attachedImages = [];
    renderImagePreviews();
    
    if (dom.imageUploadInput) {
        dom.imageUploadInput.value = '';
    }
}

// ---------- Audio Recording ----------
let mediaRecorder = null;
let recordedChunks = [];

export function setupAudioRecording() {
    if (!dom.micRecordBtn) return;
    
    dom.micRecordBtn.addEventListener('click', async () => {
        if (state.inferenceMode === 'api' && !isVisionSupported()) return;
        
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            // Stop recording
            mediaRecorder.stop();
            return;
        }
        
        try {
            if (!navigator?.mediaDevices?.getUserMedia) {
                const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
                const msg = isLocal
                    ? 'Microphone API unavailable. Click Reset permissions in browser settings.'
                    : `Microphone is blocked on IP origins. Please open http://localhost:${location.port || '8000'}`;
                showNotification(msg, 'error');
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            recordedChunks = [];
            
            // Prefer webm, fallback to whatever is available
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : '';
            
            mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };
            
            mediaRecorder.onstop = () => {
                // Stop all tracks
                stream.getTracks().forEach(t => t.stop());
                
                const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                const ext = (mediaRecorder.mimeType || '').includes('webm') ? '.webm' : '.wav';
                const file = new File([blob], `recording_${Date.now()}${ext}`, { type: blob.type });
                
                state.attachedImages.push({
                    file: file,
                    type: blob.type,
                    url: URL.createObjectURL(blob)
                });
                renderImagePreviews();
                
                dom.micRecordBtn.classList.remove('recording');
                dom.micRecordBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                mediaRecorder = null;
            };
            
            mediaRecorder.onerror = () => {
                stream.getTracks().forEach(t => t.stop());
                dom.micRecordBtn.classList.remove('recording');
                dom.micRecordBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                showNotification('Recording failed.', 'error');
                mediaRecorder = null;
            };
            
            mediaRecorder.start();
            dom.micRecordBtn.classList.add('recording');
            dom.micRecordBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
            
        } catch (e) {
            console.error('Mic access denied:', e);
            showNotification('Microphone access denied. Check browser permissions.', 'error');
        }
    });
}

let lbScale = 1;
let lbPanning = false;
let lbPointX = 0;
let lbPointY = 0;
let lbStartX = 0;
let lbStartY = 0;

function setLightboxTransform() {
    if (dom.lightboxImage) {
        dom.lightboxImage.style.transform = `translate(${lbPointX}px, ${lbPointY}px) scale(${lbScale})`;
    }
}

export function openLightbox(src) {
    if (dom.imageLightboxModal && dom.lightboxImage) {
        dom.lightboxImage.src = src;
        lbScale = 1;
        lbPointX = 0;
        lbPointY = 0;
        setLightboxTransform();
        dom.imageLightboxModal.classList.remove('hidden');
        
        // Panning
        dom.lightboxImage.onmousedown = (e) => {
            e.preventDefault();
            lbStartX = e.clientX - lbPointX;
            lbStartY = e.clientY - lbPointY;
            lbPanning = true;
            dom.lightboxImage.style.cursor = 'grabbing';
        };
        dom.lightboxImage.onmouseup = () => {
            lbPanning = false;
            dom.lightboxImage.style.cursor = 'grab';
        };
        dom.lightboxImage.onmouseleave = () => {
            lbPanning = false;
            dom.lightboxImage.style.cursor = 'grab';
        };
        dom.lightboxImage.onmousemove = (e) => {
            if (!lbPanning) return;
            lbPointX = e.clientX - lbStartX;
            lbPointY = e.clientY - lbStartY;
            setLightboxTransform();
        };
        
        // Zooming
        dom.lightboxImage.onwheel = (e) => {
            e.preventDefault();
            const xs = (e.clientX - lbPointX) / lbScale;
            const ys = (e.clientY - lbPointY) / lbScale;
            const delta = (e.wheelDelta ? e.wheelDelta : -e.deltaY);
            if (delta > 0) {
                lbScale *= 1.1;
            } else {
                lbScale /= 1.1;
            }
            if (lbScale < 0.2) lbScale = 0.2;
            if (lbScale > 20) lbScale = 20;
            
            lbPointX = e.clientX - xs * lbScale;
            lbPointY = e.clientY - ys * lbScale;
            setLightboxTransform();
        };
        
        dom.lightboxImage.style.cursor = 'grab';
        dom.lightboxImage.style.transition = 'transform 0.05s linear';
        
        // Escape to close
        window._lightboxKeydownHandler = (e) => {
            if (e.code === 'Escape') closeLightbox();
        };
        document.addEventListener('keydown', window._lightboxKeydownHandler);
    }
}

export function closeLightbox() {
    if (dom.imageLightboxModal) {
        dom.imageLightboxModal.classList.add('hidden');
    }
    if (window._lightboxKeydownHandler) {
        document.removeEventListener('keydown', window._lightboxKeydownHandler);
        window._lightboxKeydownHandler = null;
    }
}

if (dom.closeLightboxBtn) {
    dom.closeLightboxBtn.addEventListener('click', closeLightbox);
}
if (dom.imageLightboxModal) {
    dom.imageLightboxModal.addEventListener('click', (e) => {
        if (e.target === dom.imageLightboxModal || e.target.classList.contains('lightbox-content')) {
            closeLightbox();
        }
    });
}

export function openVideoPreview(src) {
    if (dom.videoPreviewModal && dom.videoPreviewPlayer) {
        dom.videoPreviewPlayer.src = src;
        dom.videoPreviewModal.classList.remove('hidden');
        
        const formatTime = (seconds) => {
            if (isNaN(seconds)) return '0:00';
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return `${m}:${s < 10 ? '0' : ''}${s}`;
        };

        const updateTime = () => {
            if (dom.videoTimeDisplay && dom.videoPreviewPlayer) {
                dom.videoTimeDisplay.textContent = `${formatTime(dom.videoPreviewPlayer.currentTime)} / ${formatTime(dom.videoPreviewPlayer.duration)}`;
            }
            if (dom.videoProgressBar && dom.videoPreviewPlayer && dom.videoPreviewPlayer.duration) {
                const percent = (dom.videoPreviewPlayer.currentTime / dom.videoPreviewPlayer.duration) * 100;
                dom.videoProgressBar.style.width = `${percent}%`;
            }
        };

        dom.videoPreviewPlayer.addEventListener('timeupdate', updateTime);
        dom.videoPreviewPlayer.addEventListener('loadedmetadata', updateTime);

        const renderMarkers = () => {
            const duration = dom.videoPreviewPlayer.duration;
            if (!duration) return;
            const numFrames = Math.min(60, Math.max(1, Math.floor(duration)));
            
            if (dom.videoMarkersTrack) {
                // Remove only the marker divs (keep the progress bar)
                Array.from(dom.videoMarkersTrack.children).forEach(child => {
                    if (child.id !== 'videoProgressBar') {
                        child.remove();
                    }
                });
                
                for (let i = 0; i < numFrames; i++) {
                    const frac = i / Math.max(1, (numFrames));
                    const marker = document.createElement('div');
                    marker.style.position = 'absolute';
                    marker.style.left = `calc(${frac * 100}%)`;
                    marker.style.top = '0';
                    marker.style.width = '4px';
                    marker.style.height = '100%';
                    marker.style.backgroundColor = 'var(--accent-emerald, #10b981)';
                    marker.style.borderRadius = '2px';
                    marker.style.boxShadow = '0 0 5px var(--accent-emerald, #10b981)';
                    marker.style.opacity = '0.6'; // make them blend slightly
                    
                    marker.onclick = (e) => {
                        e.stopPropagation();
                        dom.videoPreviewPlayer.currentTime = frac * duration;
                    };
                    
                    dom.videoMarkersTrack.appendChild(marker);
                }
            }
        };

        if (dom.videoPreviewPlayer.readyState >= 1) {
            renderMarkers();
        } else {
            dom.videoPreviewPlayer.addEventListener('loadedmetadata', renderMarkers, { once: true });
        }
        
        // Track clicking for seeking
        if (dom.videoMarkersTrack) {
            dom.videoMarkersTrack.onclick = (e) => {
                const rect = dom.videoMarkersTrack.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                if (dom.videoPreviewPlayer.duration) {
                    dom.videoPreviewPlayer.currentTime = pos * dom.videoPreviewPlayer.duration;
                }
            };
        }
        
        // Play/Pause
        const togglePlay = () => {
            if (dom.videoPreviewPlayer.paused) {
                dom.videoPreviewPlayer.play();
            } else {
                dom.videoPreviewPlayer.pause();
            }
        };
        
        if (dom.videoPlayPauseBtn) {
            dom.videoPlayPauseBtn.onclick = togglePlay;
        }
        dom.videoPreviewPlayer.onclick = togglePlay;
        
        dom.videoPreviewPlayer.onplay = () => {
            if (dom.videoPlayPauseBtn) dom.videoPlayPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        };
        dom.videoPreviewPlayer.onpause = () => {
            if (dom.videoPlayPauseBtn) dom.videoPlayPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        };
        
        // Mute toggle
        if (dom.videoMuteBtn) {
            dom.videoMuteBtn.onclick = () => {
                dom.videoPreviewPlayer.muted = !dom.videoPreviewPlayer.muted;
                dom.videoMuteBtn.innerHTML = dom.videoPreviewPlayer.muted ? 
                    '<i class="fa-solid fa-volume-xmark"></i>' : 
                    '<i class="fa-solid fa-volume-high"></i>';
            };
        }
        
        // Fullscreen
        if (dom.videoFullscreenBtn) {
            dom.videoFullscreenBtn.onclick = () => {
                if (dom.videoPreviewPlayer.requestFullscreen) {
                    dom.videoPreviewPlayer.requestFullscreen();
                } else if (dom.videoPreviewPlayer.webkitRequestFullscreen) {
                    dom.videoPreviewPlayer.webkitRequestFullscreen();
                }
            };
        }
        
        // Keyboard shortcuts
        const keydownHandler = (e) => {
            if (dom.videoPreviewModal.classList.contains('hidden')) return;
            
            if (e.code === 'Space') {
                e.preventDefault();
                togglePlay();
            } else if (e.code === 'ArrowRight') {
                dom.videoPreviewPlayer.currentTime = Math.min(dom.videoPreviewPlayer.duration, dom.videoPreviewPlayer.currentTime + 5);
            } else if (e.code === 'ArrowLeft') {
                dom.videoPreviewPlayer.currentTime = Math.max(0, dom.videoPreviewPlayer.currentTime - 5);
            } else if (e.code === 'KeyM') {
                if (dom.videoMuteBtn) dom.videoMuteBtn.click();
            } else if (e.code === 'KeyF') {
                if (dom.videoFullscreenBtn) dom.videoFullscreenBtn.click();
            } else if (e.code === 'Escape') {
                closeVideoPreview();
            }
        };
        
        // Remove existing listener if any before adding a new one
        if (window._videoKeydownHandler) {
            document.removeEventListener('keydown', window._videoKeydownHandler);
        }
        window._videoKeydownHandler = keydownHandler;
        document.addEventListener('keydown', keydownHandler);
    }
}

export function closeVideoPreview() {
    if (dom.videoPreviewModal) {
        dom.videoPreviewModal.classList.add('hidden');
        if (dom.videoPreviewPlayer) {
            dom.videoPreviewPlayer.pause();
            dom.videoPreviewPlayer.removeAttribute('src');
        }
    }
    if (window._videoKeydownHandler) {
        document.removeEventListener('keydown', window._videoKeydownHandler);
        window._videoKeydownHandler = null;
    }
}

if (dom.closeVideoPreviewBtn) {
    dom.closeVideoPreviewBtn.addEventListener('click', closeVideoPreview);
}

if (dom.videoPreviewModal) {
    dom.videoPreviewModal.addEventListener('click', (e) => {
        if (e.target === dom.videoPreviewModal) {
            closeVideoPreview();
        }
    });
}
