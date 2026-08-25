import { state, saveConversations, saveEnabledTools } from './state.js';
import { dom } from './dom.js';
import { tools } from './tools.js';

export function makeDraggable(windowEl, headerEl) {
    if (!windowEl || !headerEl) return;
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
        timeGreetings = ['Good morning', 'Bright early start', 'Hello', 'Rise and shine', 'Let\'s start the day', 'Morning brainstorm?', 'Fresh coffee, fresh code', 'Early bird gets the bug'];
    } else if (hour >= 12 && hour < 17) {
        timeGreetings = ['Good afternoon', 'Hello there', 'Good day', 'Welcome back', 'Hope your day is going well', 'Ready to build?', 'Afternoon grind', 'Keep the momentum going'];
    } else if (hour >= 17 && hour < 22) {
        timeGreetings = ['Good evening', 'Unwinding tonight?', 'Welcome back', 'Hello', 'Evening coding session?', 'Time to reflect and build', 'Sunset coding', 'Let\'s wrap up the day'];
    } else {
        timeGreetings = ['Working late?', 'Quiet night ahead', 'Late night session', 'Hello night owl', 'Burning the midnight oil?', 'The best ideas happen at night', 'Midnight inspiration', 'Dark mode activated'];
    }

    const subtitles = [
        'What would you like to explore right now?',
        'How can I help you today?',
        'Ready when you are.',
        'What\'s on your mind?',
        'Let\'s turn your ideas into reality.',
        'Ask a question, brainstorm, or draft something new.',
        'Where shall we begin?',
        'Ready to tackle some code?',
        'Let\'s dive deep into your ideas.',
        'I\'m here to help you build.',
        'What are we creating today?',
        'Got a tricky bug? Let\'s squash it.',
        'Your AI co-pilot is standing by.',
        'Throw a problem my way.',
        'Let\'s engineer something amazing.',
        'Time to write some beautiful code.',
        'Need a rubber duck? I\'m here.',
        'Let\'s optimize your workflow.',
        'Type a prompt to kick things off.',
        'What puzzle are we solving next?',
        'Ready to break things and fix them?',
        'Let\'s push the boundaries.'
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
    state.activeChatId = id;
    renderChatHistory();
    renderActiveChat();
}

export function deleteChat(id, e) {
    e.stopPropagation();
    state.conversations = state.conversations.filter(c => c.id !== id);
    if (state.activeChatId === id) {
        state.activeChatId = state.conversations.length > 0 ? state.conversations[0].id : null;
    }
    saveConversations();
    renderChatHistory();
    renderActiveChat();
}

export function renderChatHistory() {
    dom.chatHistoryList.innerHTML = '';
    
    const query = dom.chatSearchInput ? dom.chatSearchInput.value.toLowerCase().trim() : '';
    
    let filteredChats = state.conversations;
    if (query) {
        filteredChats = state.conversations.filter(chat => {
            if (chat.title && chat.title.toLowerCase().includes(query)) return true;
            return chat.messages.some(m => m.content && m.content.toLowerCase().includes(query));
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
        item.onclick = () => {
            switchChat(chat.id);
            dom.historyDrawer.classList.add('hidden');
        };

        const title = document.createElement('span');
        title.className = 'chat-item-title';
        title.textContent = chat.title || 'New Chat';

        const actions = document.createElement('div');
        actions.className = 'chat-item-actions';

        const delBtn = document.createElement('button');
        delBtn.className = 'chat-action-btn';
        delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        delBtn.onclick = (e) => deleteChat(chat.id, e);

        actions.appendChild(delBtn);
        item.appendChild(title);
        item.appendChild(actions);
        dom.chatHistoryList.appendChild(item);
    });
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

        activeChat.messages.forEach(msg => {
            if (msg.isHidden) return;
            appendMessageToDOM(msg, false);
        });
    }
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

export function appendMessageToDOM(msg, isStreaming = false) {
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
            const images = content.filter(item => item.type === 'image_url' || item.type === 'video_url' || item.type === 'audio_url');
            
            if (images.length > 0) {
                const gallery = document.createElement('div');
                gallery.style.display = 'flex';
                gallery.style.flexWrap = 'nowrap';
                gallery.style.gap = '8px';
                gallery.style.marginBottom = texts.length > 0 ? '8px' : '0';
                gallery.style.overflowX = 'auto';
                gallery.style.paddingBottom = '4px'; // Space for scrollbar
                
                images.forEach(item => {
                    const isVideo = item.type === 'video_url';
                    const isAudio = item.type === 'audio_url';
                    const url = isVideo ? item.video_url.url : (isAudio ? item.audio_url.url : item.image_url.url);
                    
                    let media;
                    if (isAudio) {
                        media = document.createElement('audio');
                        media.controls = true;
                        media.src = url;
                        media.style.width = '250px';
                        media.style.height = '40px';
                        media.style.flexShrink = '0';
                        media.style.outline = 'none';
                    } else {
                        media = document.createElement(isVideo ? 'video' : 'img');
                        media.src = url;
                        media.className = 'message-image';
                        media.style.height = '120px';
                        media.style.width = '120px';
                        media.style.objectFit = 'cover';
                        media.style.borderRadius = '8px';
                        media.style.cursor = 'pointer';
                        media.style.flexShrink = '0'; // Prevent squishing
                        
                        if (isVideo) {
                            media.muted = true;
                            media.loop = true;
                            media.autoplay = true;
                            media.playsInline = true;
                            media.onmouseenter = () => media.style.opacity = '0.8';
                            media.onmouseleave = () => media.style.opacity = '1';
                            media.onclick = () => openVideoPreview(url);
                        } else {
                            media.onclick = () => openLightbox(url);
                        }
                    }
                    gallery.appendChild(media);
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
        bubble.style.cssText = 'background: transparent; border: none; padding: 0; width: 100%;';
        const innerHtml = window.marked && content ? marked.parse(content) : escapeHtml(content);
        bubble.innerHTML = `<details class="thinking-block" open><summary><i class="fa-solid fa-server"></i> <span class="think-status">System Notice</span></summary><div class="thinking-content">${innerHtml}</div></details>`;
        attachCodeCopyButtons(bubble);
    } else {
        updateAssistantBubble(bubble, content, false);
    }

    const actions = document.createElement('div');
    actions.className = 'message-actions';
    
    updateMessageActionIcons(actions, msg, row);

    wrapper.appendChild(bubble);
    wrapper.appendChild(actions); // Render actions for all roles (including user/system) for the delete button
    row.appendChild(wrapper);

    if (role === 'assistant' && content.includes('TOOL_CALL:')) {
        const textWithoutTool = content.replace(/TOOL_CALL:.*$/gm, '').trim();
        const textWithoutThinkAndTool = textWithoutTool.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        
        const match = content.match(/TOOL_CALL:\s*([a-zA-Z0-9_]+)\((.*?)\)/);
        if (match) {
            const toolCommand = match[1];
            const firstArg = match[2].split(',')[0].trim();
            const sysBubbleHtml = `<details class="tool-trace-block"><summary><i class="fa-solid fa-microchip"></i> Tool executed: <b>${toolCommand}(${firstArg})</b></summary><div class="tool-trace-content">${match[0]}</div></details>`;
            
            if (textWithoutTool === '') {
                // No thinking block, just a tool call. Remove wrapper and add trace to row.
                wrapper.remove();
                row.insertAdjacentHTML('beforeend', sysBubbleHtml);
            } else if (textWithoutThinkAndTool === '') {
                // Has thinking block but no other text. Keep wrapper, hide actions, append trace.
                actions.style.display = 'none';
                bubble.insertAdjacentHTML('afterend', sysBubbleHtml);
            } else {
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
    actionsContainer.innerHTML = '';
    const { role, content, meta } = msg;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-icon-btn';
    copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
    copyBtn.setAttribute('title', 'Copy response');
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(content);
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
        copyBtn.setAttribute('title', 'Copied!');
        setTimeout(() => {
            copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
            copyBtn.setAttribute('title', 'Copy response');
        }, 2000);
    };
    actionsContainer.appendChild(copyBtn);

    if (meta) {
        const infoBtn = document.createElement('button');
        infoBtn.className = 'action-icon-btn';
        infoBtn.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
        infoBtn.setAttribute('title', 'Generation Info');

        const popover = document.createElement('div');
        popover.className = 'floating-stats-popover hidden';
        popover.innerHTML = `<i class="fa-solid fa-microchip" style="color:var(--accent-purple);"></i> ${state.selectedModel} &bull; <i class="fa-solid fa-bolt" style="color:var(--accent-emerald);"></i> ${meta.durationSec}s &bull; ${meta.tkPerSec} tk/s &bull; ~${meta.estTokens} tokens &bull; Est. $${meta.estCost}`;

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
                activeChat.messages = activeChat.messages.filter(m => m !== msg);
                row.remove();
                const { saveConversations } = await import('./state.js');
                saveConversations();
            }
        };
        actionsContainer.appendChild(deleteBtn);
    }
}

const thinkingPhrases = [
    'Honing a thought…',
    'Musing…',
    'Brewing something…',
    'Connecting dots…',
    'Untangling neurons…',
    'Simmering ideas…',
    'Churning the gears…',
    'Deep in thought…',
    'Contemplating…',
    'Weaving logic…',
    'Channeling insight…',
    'Parsing the cosmos…',
];
let thinkPhraseIndex = 0;
let thinkPhraseInterval = null;

function getCreativeDuration(seconds) {
    if (seconds < 1) return 'Blinked and done';
    if (seconds < 3) return `Quick thought · ${seconds.toFixed(1)}s`;
    if (seconds < 10) return `Pondered for ${seconds.toFixed(1)}s`;
    if (seconds < 30) return `Brewed for ${seconds.toFixed(0)}s`;
    if (seconds < 60) return `Deep-dived for ${seconds.toFixed(0)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 5) return `Meditated for ${mins}m ${secs}s`;
    return `Was in the zone for ${mins}m ${secs}s`;
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

export function updateAssistantBubble(bubbleElement, rawText, isGenerating = false, thinkStartTime = null) {
    let html = '';
    let processedText = rawText;

    // Strip local model self-identification prefixes (e.g. "nivm:")
    processedText = processedText.replace(/^nivm:\s*/i, '');
    processedText = processedText.replace(/^nivm\n/i, '');
    processedText = processedText.replace(/(<\/think>\s*)nivm:\s*/i, '$1');
    processedText = processedText.replace(/(<\/think>\s*)nivm\n/i, '$1');

    const isThinkingModel = state.selectedModel.toLowerCase().includes('think') || state.selectedModel.toLowerCase().includes('r1');
    
    let hasThinkStart = processedText.includes('<think>');
    let hasThinkEnd = processedText.includes('</think>');

    if (!hasThinkStart) {
        if (hasThinkEnd) {
            processedText = '<think>\n' + processedText;
            hasThinkStart = true;
        } else if (isThinkingModel && isGenerating) {
            processedText = '<think>\n' + processedText;
            hasThinkStart = true;
        }
    }

    if (hasThinkStart) {
        if (hasThinkEnd) {
            stopThinkingPhraseRotation();
            const thinkDuration = thinkStartTime ? (performance.now() - thinkStartTime) / 1000 : 0;
            const durationLabel = getCreativeDuration(thinkDuration);
            processedText = processedText.replace(/<think>/g, '<details class="thinking-block"><summary><i class="fa-solid fa-brain"></i> <span class="think-status">' + durationLabel + '</span></summary><div class="thinking-content">\n\n');
            processedText = processedText.replace(/<\/think>/g, '\n\n</div></details>\n\n');
        } else {
            if (isGenerating) {
                startThinkingPhraseRotation();
                const currentPhrase = thinkingPhrases[thinkPhraseIndex];
                processedText = processedText.replace(/<think>/g, '<details class="thinking-block is-streaming" open><summary><i class="fa-solid fa-brain"></i> <span class="think-status">' + currentPhrase + '</span> <i class="fa-solid fa-spinner fa-spin" style="font-size:0.8em; opacity:0.6;"></i></summary><div class="thinking-content">\n\n');
            } else {
                stopThinkingPhraseRotation();
                processedText = processedText.replace(/<think>/g, '<details class="thinking-block" open><summary><i class="fa-solid fa-brain"></i> <span class="think-status">Thought interrupted</span></summary><div class="thinking-content">\n\n');
            }
            processedText += '\n\n</div></details>';
        }
    }

    // Hide TOOL_CALL instructions from the user UI
    processedText = processedText.replace(/TOOL_CALL:.*$/gm, '').trim();

    if (window.marked && processedText) {
        html = marked.parse(processedText);
    } else {
        html = processedText;
    }

    bubbleElement.innerHTML = html;
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
        const path = dom.nativeModelPath ? dom.nativeModelPath.value.split('/').pop() : 'Native Local Engine';
        dom.statsModelName.textContent = path;
        dom.statsArchitecture.textContent = dom.nativeFlashAttnToggle?.checked ? 'GGUF (Flash Attn)' : 'GGUF';
        dom.statsModelType.textContent = 'LOCAL_NATIVE';
        dom.statsQuantization.textContent = dom.nativeKvTypeSelect ? dom.nativeKvTypeSelect.value.toUpperCase() + ' (KV Cache)' : '-';
        dom.statsContextLimit.textContent = dom.nativeCtxSlider ? dom.nativeCtxSlider.value : '4096';
        
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

    keys.forEach(key => {
        const item = document.createElement('div');
        item.className = 'chat-history-item';
        item.style.flexDirection = 'column';
        item.style.alignItems = 'flex-start';
        item.style.padding = '12px';
        
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.marginBottom = '6px';
        
        const titleSpan = document.createElement('div');
        titleSpan.innerHTML = `<i class="fa-solid fa-tag" style="margin-right:6px; color:var(--text-tertiary);"></i><strong style="color:var(--text-primary); font-size: 0.9em;">${key}</strong>`;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.style.background = 'transparent';
        deleteBtn.style.border = 'none';
        deleteBtn.style.color = 'var(--text-tertiary)';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.padding = '2px 4px';
        deleteBtn.title = 'Delete memory key';
        deleteBtn.onmouseover = () => deleteBtn.style.color = 'var(--accent-rose)';
        deleteBtn.onmouseout = () => deleteBtn.style.color = 'var(--text-tertiary)';
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (await showConfirm('Delete Memory', `Are you sure you want to delete the memory key '${key}'?`)) {
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
        contentPreview.style.whiteSpace = 'pre-wrap';
        contentPreview.textContent = window.__nivm_state.memory[key];
        
        const editBox = document.createElement('div');
        editBox.style.marginTop = '12px';
        editBox.style.width = '100%';
        editBox.innerHTML = `
            <input type="text" placeholder="Ask nivm to edit..." class="memory-edit-input" style="width: 100%; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.2); color: var(--text-primary); font-size: 0.85em;">
        `;
        
        const inputEl = editBox.querySelector('input');
        inputEl.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const text = inputEl.value.trim();
                if (text) {
                    inputEl.disabled = true;
                    inputEl.value = 'Updating...';
                    
                    const currentValue = window.__nivm_state.memory[key];
                    const editPrompt = `[SYSTEM INSTRUCTION] The user is using a UI shortcut to edit their memory.
Target Memory Key: '${key}'
Current Value: '${currentValue}'
User's Edit Request: '${text}'

INSTRUCTIONS:
1. Analyze the user's request and determine how it modifies the current value.
2. MERGE the new information with the current value if appropriate (e.g., if the user adds a nickname, keep the original name and append the nickname). Only replace the value entirely if the user explicitly asks to change or overwrite it.
3. The user might use conversational filler or slang (e.g., 'you can call me', 'asw', 'also', 'instead'). IGNORE ALL FILLER. Extract ONLY the pure factual information.
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
                            const args = match[2].split(',');
                            const newKey = args[0].trim();
                            const newVal = args.slice(1).join(',').trim();
                            
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

export function renderToolsSettings() {
    dom.toolsConfigContainer.innerHTML = '';
    
    if (tools.length === 0) {
        dom.toolsConfigContainer.innerHTML = '<div style="color: var(--text-tertiary); font-size: 0.9em; font-style: italic;">No tools registered.</div>';
        return;
    }
    
    tools.forEach(tool => {
        const isEnabled = state.enabledTools[tool.name] !== false; // Default true if not explicitly disabled
        
        const wrap = document.createElement('div');
        wrap.className = 'tool-setting-row';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = 'space-between';
        wrap.style.marginBottom = '12px';
        wrap.style.padding = '8px';
        wrap.style.background = 'rgba(255, 255, 255, 0.03)';
        wrap.style.borderRadius = '8px';
        
        const infoWrap = document.createElement('div');
        
        const title = document.createElement('div');
        title.style.fontWeight = '500';
        title.style.color = 'var(--text-primary)';
        title.innerHTML = `<i class="fa-solid fa-screwdriver-wrench" style="font-size: 0.8em; margin-right: 6px; color: var(--accent-purple);"></i>${tool.name}`;
        
        const desc = document.createElement('div');
        desc.style.fontSize = '0.85em';
        desc.style.color = 'var(--text-tertiary)';
        desc.style.marginTop = '4px';
        desc.textContent = tool.description;
        
        infoWrap.appendChild(title);
        infoWrap.appendChild(desc);
        
        const toggleBtn = document.createElement('button');
        toggleBtn.className = isEnabled ? 'btn-primary' : 'btn-secondary';
        toggleBtn.style.padding = '6px 12px';
        toggleBtn.style.fontSize = '0.85em';
        toggleBtn.textContent = isEnabled ? 'Enabled' : 'Disabled';
        
        toggleBtn.onclick = () => {
            const newState = !state.enabledTools[tool.name];
            state.enabledTools[tool.name] = newState;
            saveEnabledTools();
            
            toggleBtn.className = newState ? 'btn-primary' : 'btn-secondary';
            toggleBtn.textContent = newState ? 'Enabled' : 'Disabled';
        };
        
        wrap.appendChild(infoWrap);
        wrap.appendChild(toggleBtn);
        dom.toolsConfigContainer.appendChild(wrap);
    });
}

// --- Custom Dialog System ---
export function showAlert(title, message) {
    return new Promise(resolve => {
        dom.dialogTitle.textContent = title;
        dom.dialogMessage.textContent = message;
        
        const okBtn = document.createElement('button');
        okBtn.className = 'btn-primary';
        okBtn.textContent = 'OK';
        
        dom.dialogActions.innerHTML = '';
        dom.dialogActions.appendChild(okBtn);
        
        dom.dialogOverlay.classList.remove('hidden');
        
        okBtn.addEventListener('click', () => {
            dom.dialogOverlay.classList.add('hidden');
            resolve();
        });
    });
}

export function showConfirm(title, message) {
    return new Promise(resolve => {
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
        
        cancelBtn.addEventListener('click', () => {
            dom.dialogOverlay.classList.add('hidden');
            resolve(false);
        });
        
        confirmBtn.addEventListener('click', () => {
            dom.dialogOverlay.classList.add('hidden');
            resolve(true);
        });
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

export function setupVisionUI() {
    if (dom.visionToggleBtn) {
        dom.visionToggleBtn.addEventListener('click', () => {
            state.visionEnabled = !state.visionEnabled;
            if (state.visionEnabled) {
                dom.visionToggleBtn.classList.add('active');
                if (dom.attachImgBtn) dom.attachImgBtn.classList.remove('hidden');
            } else {
                dom.visionToggleBtn.classList.remove('active');
                if (dom.attachImgBtn) dom.attachImgBtn.classList.add('hidden');
                clearAttachedImage();
            }
        });
    }

    if (dom.attachImgBtn && dom.imageUploadInput) {
        dom.attachImgBtn.addEventListener('click', () => {
            dom.imageUploadInput.click();
        });

        dom.imageUploadInput.addEventListener('change', (e) => {
            handleImageFiles(e.target.files);
        });
    }

    // Paste support
    if (dom.userPrompt) {
        dom.userPrompt.addEventListener('paste', (e) => {
            if (!state.visionEnabled) return;
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            const files = [];
            for (let item of items) {
                if (item.type.indexOf('image') === 0 || item.type.indexOf('video') === 0 || item.type.indexOf('audio') === 0) {
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
        if (!state.visionEnabled) return;
        const dt = e.dataTransfer;
        const files = [];
        if (dt.files && dt.files.length > 0) {
            for (let i = 0; i < dt.files.length; i++) {
                const file = dt.files[i];
                if (file.type.indexOf('image') === 0 || file.type.indexOf('video') === 0 || file.type.indexOf('audio') === 0) {
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

function renderImagePreviews() {
    if (!dom.imagePreviewContainer) return;
    
    dom.imagePreviewContainer.innerHTML = '';
    
    if (state.attachedImages.length > 0) {
        state.attachedImages.forEach((imgObj, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'image-preview-item';
            
            const isVideo = imgObj.type && imgObj.type.startsWith('video/');
            const isAudio = imgObj.type && imgObj.type.startsWith('audio/');
            
            let media;
            if (isAudio) {
                media = document.createElement('audio');
                media.controls = true;
                media.style.width = '200px';
                media.style.height = '40px';
                media.style.borderRadius = '8px';
                media.style.outline = 'none';
            } else {
                media = document.createElement(isVideo ? 'video' : 'img');
                if (isVideo) {
                    media.autoplay = true;
                    media.muted = true;
                    media.loop = true;
                    media.playsInline = true;
                }
            }
            media.src = imgObj.url;
            
            const rmBtn = document.createElement('button');
            rmBtn.className = 'remove-image-btn';
            rmBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            rmBtn.onclick = () => window.removeAttachedImage(index);
            
            itemDiv.appendChild(media);
            itemDiv.appendChild(rmBtn);
            dom.imagePreviewContainer.appendChild(itemDiv);
        });
        dom.imagePreviewContainer.classList.remove('hidden');
    } else {
        dom.imagePreviewContainer.classList.add('hidden');
    }
}

export function clearAttachedImage() {
    if (state.attachedImages) {
        state.attachedImages.forEach(img => URL.revokeObjectURL(img.url));
    }
    state.attachedImages = [];
    renderImagePreviews();
    
    if (dom.imageUploadInput) {
        dom.imageUploadInput.value = '';
    }
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
