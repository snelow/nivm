/* chat messages & bubble rendering */

import { state, saveConversations } from '../state.js';
import { dom } from '../dom.js';
import { tools, parseToolCall, stripToolCallFromText } from '../tools.js';
import { createSingleImageCard, createBeforeAfterSlider } from '../image_editor.js';
import { escapeHtml, showNotification } from '../modals/dialogs.js';
import { openLightbox, openVideoPreview } from '../media/media_manager.js';
import { switchChat, createNewChat } from './chat_history.js';

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

export function getMessageText(content) {
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
            const { speakText } = await import('../voice.js');
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

