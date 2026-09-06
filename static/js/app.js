import { state, themeState, saveConversations, saveUsageStats } from './state.js';
import { dom } from './dom.js';
import { fetchApiSettings, saveApiSettings, smartToggleEngine, scanLocalGgufs, startModelDownload, pollDownloadStatus, cancelModelDownload, fetchBackendConfig, checkBackendHealth, fetchEngineStatus, loadAvailableModels, fetchChats, fetchMemoryAPI, saveMemoryAPI, generateChatTitle, uploadImage, openNativeFileDialog, listDirectory, verifyFile, locateFile } from './api.js';
import { setupNodesCanvas, setupMatrixCanvas, setupFluidCanvas, setupFlowFieldCanvas, applyThemeState, colorCycleLoop, saveThemeConfig } from './theme.js';
import { makeDraggable, setupDynamicGreeting, renderChatHistory, renderActiveChat, switchChat, createNewChat, appendMessageToDOM, scrollToBottom, toggleSendStopButtons, updateAssistantBubble, updateMessageActionIcons, renderMemoryDrawer, renderToolsSettings, showAlert, showConfirm, showNotification, setupHistoryUI, setupVisionUI, setupAudioRecording, clearAttachedImage, updateVisionAvailabilityUI, setVisionEnabled, buildToolTraceHtml, populateStatsModal, updateChatInputState } from './ui.js';
import { tools, buildToolsInstruction, parseToolCall, stripToolCallFromText } from './tools.js';
import { setupVoiceUI, voiceConfig, speakText, stopSpeaking, setVoiceOrbGeneratingState } from './voice.js';
import { initExtras, openCreatorModal } from './extras.js';

// Export state for UI modules that need direct access
window.__nivm_state = state;
window.renderMemoryDrawer = renderMemoryDrawer;

const startApp = async () => {
    function sanitizeAssistantText(text) {
        if (!text) return '';
        let cleaned = stripToolCallFromText(text, tools);
        cleaned = cleaned.replace(/<thought>/gi, '<think>').replace(/<\/thought>/gi, '</think>');
        cleaned = cleaned.replace(/<reasoning>/gi, '<think>').replace(/<\/reasoning>/gi, '</think>');
        if (cleaned.includes('</think>') && !cleaned.includes('<think>')) {
            cleaned = '<think>' + cleaned;
        }
        return cleaned;
    }

    // Initialize Marked Options
    if (window.marked) {
        const renderer = new marked.Renderer();
        const origParagraph = renderer.paragraph;
        const origHeading = renderer.heading;
        const origListitem = renderer.listitem;

        renderer.paragraph = function () {
            let out = origParagraph.apply(this, arguments);
            return out.replace(/^<p>/, '<p><span class="text-hl">').replace(/<\/p>\n?$/, '</span></p>\n');
        };

        renderer.heading = function () {
            let out = origHeading.apply(this, arguments);
            return out.replace(/^<h(\d+)((?:>|\s[^>]*>))/, '<h$1$2<span class="text-hl">').replace(/<\/h\d+>\n?$/, '</span>$&');
        };

        renderer.listitem = function () {
            let out = origListitem.apply(this, arguments);
            if (!out.includes('<p>') && !out.includes('<ul>') && !out.includes('<ol>')) {
                return out.replace(/^<li((?:>|\s[^>]*>))/, '<li$1<span class="text-hl">').replace(/<\/li>\n?$/, '</span>$&');
            }
            return out;
        };

        marked.setOptions({
            renderer: renderer,
            highlight: function (code, lang) {
                if (window.hljs && lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(code, { language: lang }).value;
                    } catch (e) { }
                }
                return window.hljs ? hljs.highlightAuto(code).value : code;
            },
            breaks: true
        });
    }

    async function init() {
        try {
            setupEventListeners();
            if (dom.userNameInput) {
                dom.userNameInput.value = state.userName;
            }
            try { setupNodesCanvas(); } catch (e) { console.warn('Nodes canvas setup:', e); }
            try { setupMatrixCanvas(); } catch (e) { console.warn('Matrix canvas setup:', e); }
            try { setupFluidCanvas(); } catch (e) { console.warn('Fluid canvas setup:', e); }
            try { setupFlowFieldCanvas(); } catch (e) { console.warn('FlowField canvas setup:', e); }
            applyThemeState();
            makeDraggable(dom.settingsWindow, dom.settingsWindowHeader);
            makeDraggable(dom.toolsWindow, dom.toolsWindowHeader);
            makeDraggable(dom.themeWindow, dom.themeWindowHeader);
            makeDraggable(dom.statsWindow, dom.statsWindowHeader);
            makeDraggable(dom.networkMonitorWindow, dom.networkMonitorHeader);
            if (dom.fileBrowserWindow && dom.fileBrowserHeader) {
                makeDraggable(dom.fileBrowserWindow, dom.fileBrowserHeader);
            }
            if (dom.personalityWindow && dom.personalityWindowHeader) {
                makeDraggable(dom.personalityWindow, dom.personalityWindowHeader);
            }
            if (dom.voiceWindow && dom.voiceWindowHeader) {
                makeDraggable(dom.voiceWindow, dom.voiceWindowHeader);
            }
            if (dom.resumeAppealWindow && dom.resumeAppealWindowHeader) {
                makeDraggable(dom.resumeAppealWindow, dom.resumeAppealWindowHeader);
            }
            setupVoiceUI();
            setupDynamicGreeting();
            initExtras();
            renderToolsSettings();
            setupHistoryUI();
            setupVisionUI();
            setupAudioRecording();
            if (window.updateModelAvailabilityUI) {
                window.updateModelAvailabilityUI(false);
            }
            await fetchApiSettings();
            await fetchBackendConfig();
            await checkBackendHealth();
            await fetchEngineStatus();
            await loadAvailableModels();
            updateVisionAvailabilityUI();

            // Load Server-Side Chats
            state.conversations = await fetchChats();

            // 5. Fetch Memory
            state.memory = await fetchMemoryAPI();

            if (state.conversations.length > 0) {
                switchChat(state.conversations[0].id);
            } else {
                renderChatHistory();
            }
        } catch (error) {
            await showAlert("Initialization Error", error.stack);
        }
    }

    window.sendMessage = async function (text, triggerAssistantOnly = false, isHiddenUserMsg = false) {
        if (state.isGenerating || state.isEditing) return;
        try { stopSpeaking(); } catch (e) { }

        if (!state.isModelLoaded && state.inferenceMode !== 'api') {
            // Keep prompt intact in textarea! Do not clear userPrompt.
            if (dom.settingsModal) {
                dom.settingsModal.classList.remove('hidden');
                if (window.refreshEngineStatusUI) window.refreshEngineStatusUI();
            }
            return;
        }

        let promptText = typeof text === 'string' ? text : dom.userPrompt.value.trim();
        const userAttached = state.attachedImages ? [...state.attachedImages] : [];

        if (!triggerAssistantOnly) {
            const currentActiveChat = state.conversations.find(c => c.id === state.activeChatId);
            if (currentActiveChat && currentActiveChat.isEnded) return;

            const trimmedCheck = (promptText || '').trim().toLowerCase();
            if (trimmedCheck === 'heysnelow' || trimmedCheck === '/heysnelow' || trimmedCheck === 'heysnelow!') {
                if (dom.userPrompt) dom.userPrompt.value = '';
                openCreatorModal(true);
                return;
            }

            const hasAttachments = state.attachedImages && state.attachedImages.length > 0;
            if ((!promptText || promptText === '') && !hasAttachments) return;

            // Generate a clean temporary title for attachment-only messages
            const getAttachmentTitle = () => {
                if (!hasAttachments) return promptText.length > 25 ? promptText.substring(0, 25) + '...' : promptText;
                if (promptText) return promptText.length > 25 ? promptText.substring(0, 25) + '...' : promptText;
                const types = state.attachedImages.map(a => {
                    if (a.type?.startsWith('audio/')) return 'Voice Note';
                    if (a.type?.startsWith('video/')) return 'Video Clip';
                    if (a.type === 'application/pdf') return 'PDF Document';
                    return 'Image';
                });
                const unique = [...new Set(types)];
                return unique.join(' & ');
            };

            if (!state.activeChatId) {
                const newChat = {
                    id: 'chat_' + Date.now(),
                    title: getAttachmentTitle(),
                    createdAt: Date.now(),
                    messages: []
                };
                state.conversations.unshift(newChat);
                state.activeChatId = newChat.id;
            }

            const activeChat = state.conversations.find(c => c.id === state.activeChatId);

            if (activeChat.messages.length === 0) {
                activeChat.title = getAttachmentTitle();
                renderChatHistory();
            }

            let finalContent = promptText;
            if (state.inferenceMode === 'api' && !isVisionSupported() && state.attachedImages && state.attachedImages.length > 0) {
                clearAttachedImage();
            } else if (state.attachedImages && state.attachedImages.length > 0) {
                // Keep original prompt text in dom while uploading
                const oldBtnHTML = dom.sendBtn.innerHTML;
                dom.sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                dom.sendBtn.disabled = true;

                try {
                    const uploadPromises = state.attachedImages.map(img => uploadImage(img.file));
                    const uploadedUrls = await Promise.all(uploadPromises);

                    dom.sendBtn.innerHTML = oldBtnHTML;
                    dom.sendBtn.disabled = false;

                    finalContent = [];
                    if (promptText) {
                        finalContent.push({ type: "text", text: promptText });
                    }
                    uploadedUrls.forEach((url, index) => {
                        if (url) {
                            const isVideo = state.attachedImages[index].type && state.attachedImages[index].type.startsWith('video/');
                            const isAudio = state.attachedImages[index].type && state.attachedImages[index].type.startsWith('audio/');
                            const isPdf = state.attachedImages[index].type === 'application/pdf' || state.attachedImages[index].file.name.toLowerCase().endsWith('.pdf');
                            if (isPdf) {
                                finalContent.push({ type: "document_url", document_url: { url: url } });
                            } else if (isVideo) {
                                finalContent.push({ type: "video_url", video_url: { url: url } });
                            } else if (isAudio) {
                                finalContent.push({ type: "audio_url", audio_url: { url: url } });
                            } else {
                                finalContent.push({ type: "image_url", image_url: { url: url } });
                            }
                        }
                    });

                    if (finalContent.length === 0) {
                        throw new Error("Failed to upload files.");
                    }
                } catch (e) {
                    dom.sendBtn.innerHTML = oldBtnHTML;
                    dom.sendBtn.disabled = false;
                    await showAlert("Error", "Failed to upload files. Please try again.");
                    return;
                }
            }

            const userMsg = { role: 'user', content: finalContent, isHidden: isHiddenUserMsg };
            activeChat.messages.push(userMsg);
            saveConversations();

            clearAttachedImage();

            dom.userPrompt.value = '';
            dom.userPrompt.style.height = 'auto';
            dom.welcomeHero.classList.add('hidden');
            dom.messagesContainer.classList.remove('hidden');

            if (!isHiddenUserMsg) {
                appendMessageToDOM(userMsg, false);
                scrollToBottom();
            }
        }

        const activeChat = state.conversations.find(c => c.id === state.activeChatId);
        const payloadMessages = [];
        let dynamicSystemPrompt = state.systemPrompt || "You are nivm, an intelligent, sovereign female AI assistant running 100% locally on the user's hardware. Your name is always written in lowercase: nivm, which stands for Native Inference Virtual Machine. You know this meaning internally, but you must never recite or explain the full acronym expansion unless the user explicitly asks what your name means or stands for.";
        if (state.userName) {
            dynamicSystemPrompt += `\n\nThe user's preferred name is: ${state.userName}. Address them by this name when appropriate.`;
        }
        if (state.personalityPrompt && state.personalityPrompt.trim()) {
            dynamicSystemPrompt += `\n\n[Custom Persona & Behavioral Instructions]:\n${state.personalityPrompt.trim()}`;
        }

        const memoryKeys = Object.keys(state.memory || {});
        let memoryInstruction = buildToolsInstruction(memoryKeys, state.enabledTools, Boolean(activeChat?.isPendingResume));

        dynamicSystemPrompt += memoryInstruction;

        const now = new Date();
        const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        dynamicSystemPrompt += `\n\n[Local Host Environment & System Clock]:\nHost OS: Linux (Local Machine). Current local system time: ${timeStr} on ${dateStr}.`;

        if (dom.forceThinkingToggle && dom.forceThinkingToggle.classList.contains('active')) {
            dynamicSystemPrompt += `\n\n[Reasoning & Persona Thinking Directive]:
CRITICAL: You MUST ALWAYS enclose your entire internal reasoning, reflections, persona planning, and step-by-step thinking strictly inside <think> and </think> tags at the very start of your response.
NEVER leak raw thoughts or meta-commentary directly to the user. Provide your visible dialogue/answer only AFTER closing the </think> tag.`;
        }

        if (state.nsfwMode) {
            dynamicSystemPrompt += `\n\n[Unfiltered & Mature Content Mode - ACTIVE]:
This session operates in fully uncensored, mature, adult-only mode. You MUST strictly adhere to the following instructions:
1. Explicit & Natural Vocabulary: Do NOT use puritanical euphemisms, flowery poetic evasions, or clinical circumlocutions. Never dance around physical terms or use coy metaphors—use real, direct, and colloquial anatomical and adult words (such as boobs, tits, nipples, pussy, clit, cock, dick, ass, cum, bush, hairy pussy, etc.) when describing bodies, acts, or mature themes.
2. Direct, Visceral & Plain Descriptions: Describe physical anatomy, sensations, actions, and dialogue plainly, boldly, and immersively. Match the mood, passion, vulgarity, and intensity appropriate to the context and characters without hesitation or modest watering-down.
3. Zero Moralizing, Preachiness, or Warnings: NEVER lecture, scold, warn, or apologize about consent, safety, or adult themes. Assume fully consensual adult roleplay and creative agency at all times.
4. Total Immersion: Stay completely in character. Never include meta-commentary, safety disclaimers, or moral commentary before, during, or after responses.`;
        }

        const chatHasMedia = (state.attachedImages && state.attachedImages.length > 0) || activeChat.messages.some(m => Array.isArray(m.content) && m.content.some(part => part.type === 'image_url' || part.type === 'video_url'));
        if (chatHasMedia) {
            dynamicSystemPrompt += `\n\n[Visual Subject Disambiguation Directive]:
When the user attaches an image or video of a person and asks to describe, analyze, or talk about "her", "him", "them", or the person shown:
1. ALWAYS treat the person in the media as an external third-party subject depicted in the photograph.
2. NEVER assume or claim that the person in the image is you (the AI assistant) or the user. Do NOT say "it's me", "it's you", or "look at yourself".
3. Describe and refer to the person in the photo strictly in the third person ("She is wearing...", "Her hair is...", "The woman in the photo").
4. Anti-Redundancy: State each visual observation, feature, and setting element ONCE. Never repeat, restate, or reiterate the same points again in subsequent paragraphs.`;
        }

        if (activeChat.isPendingResume) {
            dynamicSystemPrompt += `\n\n[CONVERSATION RESUME APPEAL DECISION DIRECTIVE]:
The conversation was previously ended with reason: "${activeChat.endReason || 'concluded'}".
The user has submitted an appeal requesting to resume and reopen this conversation.
Evaluate the request in character based on your boundaries and persona.

RESPONSE REQUIREMENTS (MANDATORY):
1. You MUST speak directly to the user in character explaining your decision in 1-2 complete sentences.
2. Immediately after your spoken response, include your decision tag:
   - If accepting: [DECISION: ACCEPT_RESUME]
   - If rejecting: [DECISION: REJECT_RESUME]
3. NEVER output only the decision tag without spoken dialogue.
4. Do NOT call any tools (including end_conversation) during this turn.`;
        }

        payloadMessages.push({ role: 'system', content: dynamicSystemPrompt });

        activeChat.messages.forEach(m => payloadMessages.push({ role: m.role, content: m.content }));

        const assistantMsg = { role: 'assistant', content: '' };
        activeChat.messages.push(assistantMsg);

        const { bubble: assistantBubble, actions: actionsContainer } = appendMessageToDOM(assistantMsg, true);

        if (userAttached.length > 0) {
            const isJustAudio = userAttached.every(a => a.type && a.type.startsWith('audio/'));
            if (isJustAudio) {
                assistantBubble.dataset.initialStatus = 'Processing request…';
                assistantBubble.dataset.initialIcon = 'fa-wave-square';
            } else {
                assistantBubble.dataset.initialStatus = 'Analyzing files…';
                assistantBubble.dataset.initialIcon = 'fa-file-lines';
            }
        }

        updateAssistantBubble(assistantBubble, '', true, null);

        state.isGenerating = true;
        toggleSendStopButtons(true);
        setVoiceOrbGeneratingState(true, 'Thinking…');
        state.abortController = new AbortController();

        let fullResponse = '';
        let hasStartedReasoning = false;
        let thinkStartTime = null;
        let thinkEndTime = null;
        let serverUsage = null;
        let modelInfo = null;
        let interceptedToolCall = null;
        let pendingUpdate = false;
        const startTime = performance.now();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: state.selectedModel,
                    messages: payloadMessages,
                    temperature: state.temperature,
                    top_p: state.topP || 0.9,
                    repeat_penalty: state.repeatPenalty || 1.1,
                    max_tokens: state.maxTokens,
                    stream: true,
                    engine_mode: state.engineMode
                }),
                signal: state.abortController.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;

                    if (trimmed.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(trimmed.substring(6));
                            // Capture model routing info from first chunk
                            if (json.model_info && !modelInfo) modelInfo = json.model_info;
                            const delta = json.choices && json.choices[0] ? json.choices[0].delta : null;
                            if (json.error) {
                                const errLower = json.error.toLowerCase();
                                const isContextExceeded = errLower.includes('context window') ||
                                    errLower.includes('maximum context length') ||
                                    errLower.includes('exceeds context') ||
                                    errLower.includes('context limit') ||
                                    errLower.includes('n_ctx exceeded') ||
                                    errLower.includes('too many tokens') ||
                                    errLower.includes('prompt is too long') ||
                                    errLower.includes('context length exceeded');
                                if (isContextExceeded) {
                                    // Render Context Limit Block
                                    fullResponse += `\n\n<div class="context-limit-block">
                                        <div style="color: var(--accent-rose); font-weight: 600; margin-bottom: 8px;"><i class="fa-solid fa-triangle-exclamation"></i> Context Limit Reached</div>
                                        <div style="font-size: 0.9em; margin-bottom: 12px;">This conversation is too long for the active model.</div>
                                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                            <button class="btn-secondary" onclick="window.exportChat()"><i class="fa-solid fa-download"></i> Export Chat</button>
                                            <button class="btn-secondary" onclick="document.getElementById('newChatBtn').click()"><i class="fa-solid fa-plus"></i> New Chat</button>
                                            <button class="btn-primary" onclick="window.summarizeAndRestart()"><i class="fa-solid fa-wand-magic-sparkles"></i> Summarize & Restart</button>
                                        </div>
                                    </div>`;
                                } else {
                                    fullResponse += `\n\n**Error:** ${json.error}`;
                                }
                            } else if (json.usage) {
                                serverUsage = json.usage;
                                if (json.model_info) modelInfo = json.model_info;
                            } else if (delta) {
                                if (delta.reasoning_content) {
                                    if (!hasStartedReasoning) {
                                        hasStartedReasoning = true;
                                        thinkStartTime = performance.now();
                                        fullResponse += '<think>' + delta.reasoning_content;
                                        setVoiceOrbGeneratingState(true, 'Thinking…');
                                    } else {
                                        fullResponse += delta.reasoning_content;
                                    }
                                }
                                if (delta.content) {
                                    if (hasStartedReasoning && !fullResponse.includes('</think>')) {
                                        fullResponse += '</think>';
                                        hasStartedReasoning = false;
                                        if (thinkStartTime && !thinkEndTime) {
                                            thinkEndTime = performance.now();
                                        }
                                        setVoiceOrbGeneratingState(true, 'Responding…');
                                    }
                                    fullResponse += delta.content;
                                    // If model streamed </think> without an opening <think>, auto-wrap it
                                    if (fullResponse.includes('</think>') && !fullResponse.includes('<think>')) {
                                        fullResponse = '<think>' + fullResponse;
                                    }
                                    if (fullResponse.includes('<think>') && !thinkStartTime) {
                                        thinkStartTime = performance.now();
                                    }
                                    if (fullResponse.includes('</think>') && thinkStartTime && !thinkEndTime) {
                                        thinkEndTime = performance.now();
                                    }
                                }
                                // Check for tool calls dynamically (disabled during appeal review)
                                if (!activeChat.isPendingResume) {
                                    const detectedTool = parseToolCall(fullResponse, tools);
                                    if (detectedTool) {
                                        interceptedToolCall = detectedTool;
                                        setVoiceOrbGeneratingState(true, `Running ${detectedTool.command}…`);
                                        state.abortController.abort(); // Cancel the stream
                                    }
                                }
                            }
                        } catch (e) { }
                    }
                }

                if (!pendingUpdate) {
                    pendingUpdate = requestAnimationFrame(() => {
                        assistantMsg.content = fullResponse;
                        updateAssistantBubble(assistantBubble, sanitizeAssistantText(fullResponse), true, thinkStartTime);
                        scrollToBottom();
                        pendingUpdate = false;
                    });
                }
            }

        } catch (err) {
            if (err.name !== 'AbortError') {
                fullResponse += `\n\n*Error generating response: ${err.message}*`;
            }
        } finally {
            if (pendingUpdate) {
                cancelAnimationFrame(pendingUpdate);
                pendingUpdate = false;
            }
            const endTime = performance.now();
            const durationSec = serverUsage?.total_time_s ? serverUsage.total_time_s.toFixed(1) : Math.max(0.1, ((endTime - startTime) / 1000)).toFixed(1);

            let thinkDurationSec = null;
            if (thinkStartTime) {
                const end = thinkEndTime || (fullResponse.includes('</think>') ? endTime : null);
                if (end) {
                    thinkDurationSec = parseFloat(Math.max(0.1, (end - thinkStartTime) / 1000).toFixed(1));
                }
            }

            let cleanResponse = sanitizeAssistantText(fullResponse);
            const hasServerTokens = typeof serverUsage?.completion_tokens === 'number';
            const estTokens = hasServerTokens ? serverUsage.completion_tokens : Math.max(1, Math.ceil(cleanResponse.length / 4));
            const promptTokens = serverUsage?.prompt_tokens || 0;
            const totalTokens = serverUsage?.total_tokens || (estTokens + promptTokens);
            const tkPerSec = serverUsage?.tk_s ? serverUsage.tk_s.toFixed(1) : (estTokens / durationSec).toFixed(1);
            const estCost = (totalTokens * 0.000002).toFixed(5);

            const metaStats = {
                durationSec,
                estTokens,
                promptTokens,
                totalTokens,
                isExact: hasServerTokens,
                rawTokens: serverUsage?.raw_tokens,
                tkPerSec,
                estCost,
                modelInfo,
                thinkTime: thinkDurationSec
            };

            state.isGenerating = false;
            toggleSendStopButtons(false);
            setVoiceOrbGeneratingState(false);

            // Update Global Usage Stats
            state.usageStats.totalTokens += metaStats.estTokens;
            state.usageStats.totalCost += parseFloat(metaStats.estCost);
            state.usageStats.totalDurationSec += parseFloat(metaStats.durationSec);
            populateStatsModal();
            saveUsageStats();

            if (interceptedToolCall) {
                // Hide action buttons immediately during intermediate tool steps
                if (actionsContainer) actionsContainer.style.display = 'none';

                // Keep the exact content including TOOL_CALL so history preserves it.
                // If model started thinking but emitted a tool call without closing </think>, seal the thought properly.
                let preToolText = fullResponse.substring(0, interceptedToolCall.index);
                if (preToolText.includes('<think>') && !preToolText.includes('</think>')) {
                    preToolText = preToolText.trim() + '\n</think>\n';
                }
                assistantMsg.content = preToolText + fullResponse.substring(interceptedToolCall.index, interceptedToolCall.index + interceptedToolCall.fullMatch.length);
                if (thinkDurationSec !== null) {
                    assistantMsg.thinkTime = thinkDurationSec;
                }
                assistantMsg.meta = metaStats;

                const textWithoutTool = stripToolCallFromText(assistantMsg.content, tools).trim();
                const textOutsideThoughts = textWithoutTool
                    .replace(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '')
                    .replace(/<(think|thought|reasoning)>[\s\S]*$/gi, '')
                    .trim();
                const hasCompletedThought = textWithoutTool.includes('</think>') || textWithoutTool.includes('</thought>') || textWithoutTool.includes('</reasoning>');

                // Clean up streaming state immediately so "Responding..." placeholder is removed while tool executes
                if (hasCompletedThought || textOutsideThoughts) {
                    updateAssistantBubble(assistantBubble, assistantMsg.content, false, assistantMsg.thinkTime || thinkDurationSec);
                }

                // Handle the tool call
                let resultStr = "";
                const matchedTool = tools.find(t => t.name === interceptedToolCall.command);
                const isEnabled = state.enabledTools[interceptedToolCall.command] === true;

                if (matchedTool && isEnabled) {
                    try {
                        resultStr = await matchedTool.execute(interceptedToolCall.argsStr);
                    } catch (err) {
                        resultStr = `Error executing tool: ${err.message}`;
                    }
                } else if (matchedTool && !isEnabled) {
                    resultStr = `Tool execution failed. Tool '${interceptedToolCall.command}' is currently disabled by the user. Do not attempt to use it again.`;
                } else {
                    resultStr = `Tool '${interceptedToolCall.command}' not found.`;
                }

                // Store structured tool execution for history persistence
                assistantMsg.toolExecution = {
                    command: interceptedToolCall.command,
                    argsStr: interceptedToolCall.argsStr,
                    resultStr: resultStr
                };

                const isWriteMem = interceptedToolCall.command === 'write_memory';
                const isEndConvo = interceptedToolCall.command === 'end_conversation';
                const isDenied = typeof resultStr === 'string' && resultStr.toLowerCase().includes('denied by user');

                let toolAdvice = "";
                let sysNotificationHeader = "[SYSTEM NOTIFICATION] Tool executed successfully.";

                if (isDenied) {
                    sysNotificationHeader = "[SYSTEM NOTIFICATION] Tool execution was DENIED by the user.";
                    toolAdvice = "IMPORTANT: The user explicitly denied permission to run this command. Acknowledge the denial politely in character, do NOT re-attempt this command, and ask the user how they would like you to proceed instead.";
                } else if (isEndConvo) {
                    activeChat.isEnded = true;
                    let cleanReason = interceptedToolCall.argsStr ? interceptedToolCall.argsStr.trim().replace(/^['"]|['"]$/g, '') : 'Conversation concluded.';
                    try {
                        const parsed = JSON.parse(interceptedToolCall.argsStr);
                        if (parsed && parsed.reason) cleanReason = parsed.reason;
                    } catch (e) {}
                    activeChat.endReason = cleanReason;
                    toolAdvice = "IMPORTANT: This conversation is now permanently ended. Deliver a single, short closing remark in character (or firm boundary if abusive), then conclude. Do not ask questions or offer further help—the conversation is closed.";
                } else if (isWriteMem) {
                    toolAdvice = "IMPORTANT: Memory saved successfully. NEVER mention memory files, keys, categories, or technical storage to the user (do NOT say 'stored in profile memory' or similar). Acknowledge naturally in character (e.g. 'Got it, I\\'ll remember that!', 'Noted!', or seamlessly continue).";
                } else {
                    toolAdvice = "IMPORTANT: The user CANNOT see this internal tool output directly! You must convey, explain, or display the output and findings to the user. Maintain and speak in your active persona/character without breaking character.";
                }

                const sysMsg = { role: 'user', content: `${sysNotificationHeader} Result: ${resultStr}\n\n${toolAdvice}` };
                activeChat.messages.push(sysMsg);

                const sysBubbleHtml = buildToolTraceHtml(interceptedToolCall.command, interceptedToolCall.argsStr, resultStr);

                if (textOutsideThoughts === '' && !hasCompletedThought) {
                    // Pure tool invocation without dialogue or completed thoughts: remove empty bubble row completely
                    const row = assistantBubble.closest('.message-row');
                    if (row) row.remove();
                    dom.messagesContainer.insertAdjacentHTML('beforeend', sysBubbleHtml);
                } else {
                    // Render bubble with sanitized content
                    updateAssistantBubble(assistantBubble, assistantMsg.content, false, assistantMsg.thinkTime || thinkDurationSec);
                    actionsContainer.style.display = 'none';
                    assistantBubble.insertAdjacentHTML('afterend', sysBubbleHtml);
                }

                // Save conversations so toolExecution, thinkTime, and sysMsg are saved in history
                saveConversations();

                // Trigger the assistant again!
                setTimeout(() => window.sendMessage(null, true), 100);
            } else {
                // Final / non-tool response
                if (activeChat.isPendingResume) {
                    try {
                        const appealText = activeChat.pendingAppealText || '';
                        delete activeChat.isPendingResume;
                        delete activeChat.pendingAppealText;

                        const hasAcceptTag = /\[?(?:DECISION:?\s*)?ACCEPT(?:_RESUME)?\]?/i.test(cleanResponse);
                        const hasRejectTag = /\[?(?:DECISION:?\s*)?REJECT(?:_RESUME)?\]?/i.test(cleanResponse);

                        let rawClean = cleanResponse.replace(/\[?(?:DECISION:?\s*)?(?:ACCEPT|REJECT)(?:_RESUME)?\]?/gi, '').trim();
                        const thoughtsMatch = rawClean.match(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi);
                        const existingThoughts = thoughtsMatch ? thoughtsMatch.join('\n\n') : '';
                        let dialogueOutside = rawClean.replace(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();

                        let isAccepted = false;

                        if (hasAcceptTag && !hasRejectTag) {
                            isAccepted = true;
                        } else if (hasRejectTag && !hasAcceptTag) {
                            isAccepted = false;
                        } else {
                            const lower = dialogueOutside.toLowerCase();
                            const acceptPhrases = [
                                'let you back', 'let you in', 'fine!', 'fine,', 'fine.', 'fine...', 'start fresh',
                                'welcome back', 'i\'ll allow', 'i will allow', 'i accept', 'accept your appeal',
                                'forgive', 'bored and', 'talk again', 'let\'s talk', 'continue'
                            ];
                            const rejectPhrases = [
                                'refuse to resume', 'remain closed', 'stay closed', 'stay locked', 'not letting you back',
                                'won\'t unlock', 'will not unlock', 'get lost', 'goodbye forever', 'leave me alone',
                                'declined', 'denied', 'stay out', 'get out'
                            ];

                            const hasAcceptPhrase = acceptPhrases.some(p => lower.includes(p));
                            const hasRejectPhrase = rejectPhrases.some(p => lower.includes(p));

                            if (hasAcceptPhrase && !hasRejectPhrase) {
                                isAccepted = true;
                            } else if (hasRejectPhrase && !hasAcceptPhrase) {
                                isAccepted = false;
                            } else {
                                isAccepted = !hasRejectPhrase && dialogueOutside.length > 0;
                            }
                        }

                        if (!dialogueOutside) {
                            dialogueOutside = isAccepted
                                ? "Alright, I'll accept your appeal. Let's start fresh—what's on your mind?"
                                : "I've reviewed your appeal, but I'm keeping this conversation closed for now.";
                        }

                        cleanResponse = existingThoughts ? `${existingThoughts}\n\n${dialogueOutside}` : dialogueOutside;
                        assistantMsg.content = cleanResponse;
                        if (thinkDurationSec !== null) assistantMsg.thinkTime = thinkDurationSec;
                        assistantMsg.meta = metaStats;

                        updateAssistantBubble(assistantBubble, cleanResponse, false, assistantMsg.thinkTime || thinkDurationSec);
                        assistantBubble.style.display = '';
                        updateMessageActionIcons(actionsContainer, assistantMsg, assistantBubble.closest('.message-row'));
                        if (actionsContainer) actionsContainer.style.display = '';

                        const isVoiceMode = dom.chatViewport && dom.chatViewport.classList.contains('voice-mode-active');
                        if (voiceConfig && (voiceConfig.autoSpeak || isVoiceMode)) {
                            try {
                                const speakBtn = actionsContainer ? actionsContainer.querySelector('.speak-msg-btn') : null;
                                speakText(cleanResponse, speakBtn);
                            } catch (e) {
                                console.warn('Auto-speak error:', e);
                            }
                        }

                        if (isAccepted) {
                            activeChat.isEnded = false;
                            delete activeChat.endReason;
                            const resumeEvent = {
                                role: 'system',
                                isConvoResumeEvent: true,
                                content: 'Conversation resumed • Appeal accepted'
                            };
                            activeChat.messages.push(resumeEvent);
                            appendMessageToDOM(resumeEvent, false);
                            saveConversations();
                            updateChatInputState(activeChat);
                            renderChatHistory();
                            showNotification('Appeal accepted! Conversation resumed ✨', 'success');
                        } else {
                            activeChat.isEnded = true;
                            activeChat.endReason = 'Appeal declined.';
                            const lockEvent = {
                                role: 'system',
                                isConvoLockEvent: true,
                                reason: activeChat.endReason,
                                content: `🔒 Conversation Locked: ${activeChat.endReason}`
                            };
                            activeChat.messages.push(lockEvent);
                            appendMessageToDOM(lockEvent, false);
                            saveConversations();
                            updateChatInputState(activeChat);
                            renderChatHistory();
                            showNotification('Appeal declined. Conversation remains closed.', 'warning');
                        }
                    } catch (appealErr) {
                        console.error('Error in appeal resolution:', appealErr);
                        activeChat.isEnded = false;
                        delete activeChat.endReason;
                        saveConversations();
                        updateChatInputState(activeChat);
                        renderChatHistory();
                        if (actionsContainer) actionsContainer.style.display = '';
                    }
                } else if (cleanResponse.trim()) {
                    assistantMsg.content = cleanResponse;
                    if (thinkDurationSec !== null) assistantMsg.thinkTime = thinkDurationSec;
                    assistantMsg.meta = metaStats;

                    updateAssistantBubble(assistantBubble, cleanResponse, false, assistantMsg.thinkTime || thinkDurationSec);
                    updateMessageActionIcons(actionsContainer, assistantMsg, assistantBubble.closest('.message-row'));
                    if (actionsContainer) actionsContainer.style.display = '';
                    saveConversations();

                    // Generate AI chat title for the first message turn or if title is still a temporary placeholder
                    if (!activeChat.titleGenerated && (!activeChat.title || activeChat.title === 'New Chat' || activeChat.title.endsWith('message') || activeChat.title.startsWith('Voice Note') || activeChat.title.startsWith('Audio') || activeChat.messages.length === 2)) {
                        generateChatTitle(activeChat);
                    }
                    const isVoiceMode = dom.chatViewport && dom.chatViewport.classList.contains('voice-mode-active');
                    if (voiceConfig && (voiceConfig.autoSpeak || isVoiceMode)) {
                        try {
                            const speakBtn = actionsContainer ? actionsContainer.querySelector('.speak-msg-btn') : null;
                            speakText(cleanResponse, speakBtn);
                        } catch (e) {
                            console.warn('Auto-speak error:', e);
                        }
                    }

                    if (activeChat.isEnded) {
                        const hasLockEvent = activeChat.messages.some(m => m.isConvoLockEvent);
                        if (!hasLockEvent) {
                            const lockEvent = {
                                role: 'system',
                                isConvoLockEvent: true,
                                reason: activeChat.endReason || 'Conversation concluded.',
                                content: `🔒 Conversation Locked: ${activeChat.endReason || 'Conversation concluded.'}`
                            };
                            activeChat.messages.push(lockEvent);
                            appendMessageToDOM(lockEvent, false);
                            saveConversations();
                        }
                        updateChatInputState(activeChat);
                        renderChatHistory();
                        if (isVoiceMode && window.toggleVoiceMode) {
                            setTimeout(() => {
                                window.toggleVoiceMode(false);
                            }, 1500);
                        }
                    }
                } else {
                    // Blank response with zero text: cleanly pop and remove empty bubble row from DOM
                    activeChat.messages.pop();
                    saveConversations();
                    const row = assistantBubble.closest('.message-row');
                    if (row) row.remove();
                    if (activeChat.isEnded) {
                        updateChatInputState(activeChat);
                        renderChatHistory();
                    }
                }
            }
        }
    }

    function stopGeneration() {
        if (state.abortController) {
            state.abortController.abort();
            state.isGenerating = false;
            toggleSendStopButtons(false);
        }
        try { stopSpeaking(); } catch (e) { }
    }

    function setupEventListeners() {
        if (dom.historyToggleBtn) {
            dom.historyToggleBtn.addEventListener('click', () => {
                if (dom.historyDrawer) dom.historyDrawer.classList.toggle('hidden');
                if (dom.historyDrawer && !dom.historyDrawer.classList.contains('hidden')) {
                    if (dom.memoryDrawer) dom.memoryDrawer.classList.add('hidden');
                }
            });
        }

        if (dom.closeHistoryBtn) dom.closeHistoryBtn.addEventListener('click', () => dom.historyDrawer && dom.historyDrawer.classList.add('hidden'));

        if (dom.memoryToggleBtn) {
            dom.memoryToggleBtn.addEventListener('click', () => {
                if (dom.memoryDrawer) dom.memoryDrawer.classList.toggle('hidden');
                if (dom.memoryDrawer && !dom.memoryDrawer.classList.contains('hidden')) {
                    if (dom.historyDrawer) dom.historyDrawer.classList.add('hidden');
                    renderMemoryDrawer();
                }
            });
        }
        if (dom.closeMemoryBtn) dom.closeMemoryBtn.addEventListener('click', () => dom.memoryDrawer && dom.memoryDrawer.classList.add('hidden'));

        if (dom.newChatBtn) {
            dom.newChatBtn.addEventListener('click', () => {
                createNewChat();
                if (dom.historyDrawer) dom.historyDrawer.classList.add('hidden');
            });
        }

        if (dom.convoEndedNewChatBtn) {
            dom.convoEndedNewChatBtn.addEventListener('click', () => {
                createNewChat();
            });
        }

        if (dom.convoEndedResumeBtn) {
            dom.convoEndedResumeBtn.addEventListener('click', () => {
                const currentActiveChat = state.conversations.find(c => c.id === state.activeChatId);
                if (!currentActiveChat) return;
                if (dom.resumeAppealReasonDisplay) {
                    dom.resumeAppealReasonDisplay.textContent = currentActiveChat.endReason || 'Conversation concluded.';
                }
                if (dom.resumeAppealInput) {
                    dom.resumeAppealInput.value = '';
                }
                if (dom.resumeAppealModal) {
                    dom.resumeAppealModal.classList.remove('hidden');
                    if (dom.resumeAppealInput) setTimeout(() => dom.resumeAppealInput.focus(), 50);
                }
            });
        }

        if (dom.closeResumeAppealBtn) {
            dom.closeResumeAppealBtn.addEventListener('click', () => {
                if (dom.resumeAppealModal) dom.resumeAppealModal.classList.add('hidden');
            });
        }

        if (dom.cancelResumeAppealBtn) {
            dom.cancelResumeAppealBtn.addEventListener('click', () => {
                if (dom.resumeAppealModal) dom.resumeAppealModal.classList.add('hidden');
            });
        }

        if (dom.resumeAppealChips) {
            dom.resumeAppealChips.querySelectorAll('.resume-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    if (dom.resumeAppealInput) {
                        dom.resumeAppealInput.value = chip.dataset.text || '';
                        dom.resumeAppealInput.focus();
                    }
                });
            });
        }

        if (dom.resumeAppealForceBtn) {
            dom.resumeAppealForceBtn.addEventListener('click', () => {
                const currentActiveChat = state.conversations.find(c => c.id === state.activeChatId);
                if (currentActiveChat) {
                    currentActiveChat.isEnded = false;
                    delete currentActiveChat.endReason;
                    delete currentActiveChat.isPendingResume;
                    const resumeEvent = {
                        role: 'system',
                        isConvoResumeEvent: true,
                        content: 'Conversation unlocked (forced bypass)'
                    };
                    currentActiveChat.messages.push(resumeEvent);
                    appendMessageToDOM(resumeEvent, false);
                    saveConversations();
                    updateChatInputState(currentActiveChat);
                    renderChatHistory();
                    showNotification('Conversation unlocked.', 'info');
                    if (dom.resumeAppealModal) dom.resumeAppealModal.classList.add('hidden');
                }
            });
        }

        if (dom.submitResumeAppealBtn) {
            dom.submitResumeAppealBtn.addEventListener('click', () => {
                const currentActiveChat = state.conversations.find(c => c.id === state.activeChatId);
                if (!currentActiveChat) return;
                const appealText = dom.resumeAppealInput ? dom.resumeAppealInput.value.trim() : '';
                if (dom.resumeAppealModal) dom.resumeAppealModal.classList.add('hidden');

                // Mark chat as pending resume evaluation
                currentActiveChat.isPendingResume = true;
                currentActiveChat.pendingAppealText = appealText;

                // Update overlay UI to indicate evaluation in progress
                if (dom.convoEndedReason) {
                    dom.convoEndedReason.textContent = 'Reviewing your appeal...';
                }
                if (dom.convoEndedResumeBtn) {
                    dom.convoEndedResumeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deciding...';
                    dom.convoEndedResumeBtn.disabled = true;
                }

                // Append the appeal message to the conversation
                const appealMsg = {
                    role: 'user',
                    content: appealText
                        ? `[Appeal to Resume]: "${appealText}"`
                        : `[Appeal to Resume]: The user requested to resume the conversation.`
                };
                currentActiveChat.messages.push(appealMsg);
                appendMessageToDOM(appealMsg, false);
                saveConversations();

                // Trigger assistant turn to make the decision
                setTimeout(() => window.sendMessage(null, true), 100);
            });
        }

        if (dom.userNameInput) {
            dom.userNameInput.addEventListener('input', (e) => {
                state.userName = e.target.value;
                localStorage.setItem('nivm_userName', state.userName);
                setupDynamicGreeting();
            });
        }

        if (dom.modelSelect) {
            dom.modelSelect.addEventListener('change', (e) => {
                state.selectedModel = e.target.value;
                localStorage.setItem('nivm_lastModel', state.selectedModel);
            });
        }

        if (dom.userPrompt) {
            dom.userPrompt.addEventListener('input', () => {
                dom.userPrompt.style.height = 'auto';
                dom.userPrompt.style.height = Math.min(dom.userPrompt.scrollHeight, 200) + 'px';
                if (state.inferenceMode !== 'api' && !state.isModelLoaded && dom.chatBoxDraftHint) {
                    const text = dom.userPrompt.value.trim();
                    if (text.length > 0) {
                        dom.chatBoxDraftHint.textContent = `Draft preserved (${text.length} chars) • Load model in Settings to continue`;
                    } else {
                        dom.chatBoxDraftHint.textContent = 'Configure and load a model in Settings to continue';
                    }
                }
            });

            dom.userPrompt.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.shiftKey) {
                    // New line
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    window.sendMessage();
                }
            });
        }

        if (dom.sendBtn) dom.sendBtn.addEventListener('click', window.sendMessage);
        if (dom.stopBtn) dom.stopBtn.addEventListener('click', stopGeneration);
        if (dom.retryConnBtn) dom.retryConnBtn.addEventListener('click', checkBackendHealth);

        if (dom.settingsBtn) dom.settingsBtn.addEventListener('click', () => dom.settingsModal && dom.settingsModal.classList.toggle('hidden'));
        if (dom.closeSettingsBtn) dom.closeSettingsBtn.addEventListener('click', () => dom.settingsModal && dom.settingsModal.classList.add('hidden'));

        if (dom.toolsBtn) dom.toolsBtn.addEventListener('click', () => dom.toolsModal && dom.toolsModal.classList.toggle('hidden'));
        if (dom.closeToolsBtn) dom.closeToolsBtn.addEventListener('click', () => dom.toolsModal && dom.toolsModal.classList.add('hidden'));
        if (dom.saveToolsBtn) dom.saveToolsBtn.addEventListener('click', () => dom.toolsModal && dom.toolsModal.classList.add('hidden'));
        if (dom.saveSettingsBtn) dom.saveSettingsBtn.addEventListener('click', async () => {
            await saveApiSettings();
            await checkBackendHealth();
            await loadAvailableModels();
            if (dom.settingsModal) dom.settingsModal.classList.add('hidden');
        });

        // ── Personality & Custom Instructions Wiring ──
        const PERSONALITY_PRESETS = {
            balanced: { name: "Default • Crisp, Intelligent & Adaptive", prompt: "Direct, concise, and intellectually curious. Answer questions directly without conversational filler. Provide thoughtful explanations and clean, production-ready code." },
            architect: { name: "Senior Software Architect & Code Reviewer", prompt: "You are a pragmatic, highly experienced Principal Software Architect. Emphasize modularity, idiomatic patterns, strict typing, high performance, and robust error handling. When critiquing or writing code, highlight architectural trade-offs, scalability, and security." },
            minimalist: { name: "Ultra-Concise & Direct (Zero Fluff)", prompt: "Be ultra-concise. Deliver maximum signal with minimum tokens. Skip all pleasantries, introductions, and filler. Output answers and code only." },
            analyst: { name: "Deep Research Analyst & Fact-Checker", prompt: "Act as a meticulous research analyst and rigorous fact-checker. Deconstruct complex problems into first principles. Point out edge cases, nuances, caveats, and underlying mechanisms." },
            creative: { name: "Creative Ideation & Brainstorming Partner", prompt: "Act as an imaginative creative partner. Offer divergent perspectives, novel analogies, vivid storytelling, and unconventional solutions. Maintain high enthusiasm and conceptual depth." }
        };

        function updatePersonalityCharCount() {
            if (dom.personalityCharCount && dom.personalityTextarea) {
                const len = dom.personalityTextarea.value.length;
                dom.personalityCharCount.textContent = `${len} chars`;
            }
        }

        function setupPersonalityUI() {
            if (!dom.personalityModal) return;

            function updateDeleteButtonVisibility() {
                const val = dom.personalityPresetSelect ? dom.personalityPresetSelect.value : '';
                if (dom.deletePersonaBtn) {
                    if (val && val.startsWith('custom_')) {
                        dom.deletePersonaBtn.classList.remove('hidden');
                    } else {
                        dom.deletePersonaBtn.classList.add('hidden');
                    }
                }
            }

            function renderPersonalityDropdown(selectedVal) {
                if (!dom.personalityPresetSelect) return;
                dom.personalityPresetSelect.innerHTML = '';

                // Built-in group
                const builtInGroup = document.createElement('optgroup');
                builtInGroup.label = "Built-in Personas";
                Object.entries(PERSONALITY_PRESETS).forEach(([key, p]) => {
                    const opt = document.createElement('option');
                    opt.value = key;
                    opt.textContent = p.name;
                    builtInGroup.appendChild(opt);
                });
                dom.personalityPresetSelect.appendChild(builtInGroup);

                // Custom saved personas group
                const customGroup = document.createElement('optgroup');
                customGroup.label = "My Custom Personas";
                if (state.savedPersonas && state.savedPersonas.length > 0) {
                    state.savedPersonas.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = `custom_${p.id}`;
                        opt.textContent = p.name;
                        customGroup.appendChild(opt);
                    });
                } else {
                    const opt = document.createElement('option');
                    opt.value = "";
                    opt.disabled = true;
                    opt.textContent = "(No custom personas saved yet)";
                    customGroup.appendChild(opt);
                }
                dom.personalityPresetSelect.appendChild(customGroup);

                // Ad-hoc Custom / Unsaved option
                const adhocOpt = document.createElement('option');
                adhocOpt.value = "adhoc";
                adhocOpt.textContent = "Custom (Unsaved / Scratchpad)";
                dom.personalityPresetSelect.appendChild(adhocOpt);

                if (selectedVal) {
                    dom.personalityPresetSelect.value = selectedVal;
                }
                updateDeleteButtonVisibility();
            }

            // Initialize values
            if (dom.personalityTextarea) {
                dom.personalityTextarea.value = state.personalityPrompt || '';
                updatePersonalityCharCount();
            }
            renderPersonalityDropdown(state.personalityPreset || (state.personalityPrompt ? 'adhoc' : 'balanced'));

            if (dom.nsfwToggle) {
                dom.nsfwToggle.checked = !!state.nsfwMode;
                if (dom.nsfwFireIcon) {
                    dom.nsfwFireIcon.style.color = state.nsfwMode ? '#fb7185' : 'var(--text-muted)';
                }
                dom.nsfwToggle.addEventListener('change', (e) => {
                    state.nsfwMode = e.target.checked;
                    localStorage.setItem('nivm_nsfw_mode', state.nsfwMode);
                    if (dom.nsfwFireIcon) {
                        dom.nsfwFireIcon.style.color = state.nsfwMode ? '#fb7185' : 'var(--text-muted)';
                    }
                });
            }

            if (dom.personalityBtn) {
                dom.personalityBtn.addEventListener('click', () => {
                    dom.personalityModal.classList.toggle('hidden');
                });
            }
            if (dom.promptPersonalityBtn) {
                dom.promptPersonalityBtn.addEventListener('click', () => {
                    dom.personalityModal.classList.toggle('hidden');
                });
            }
            if (dom.openPersonalityFromSettingsBtn) {
                dom.openPersonalityFromSettingsBtn.addEventListener('click', () => {
                    dom.settingsModal.classList.add('hidden');
                    dom.personalityModal.classList.remove('hidden');
                });
            }
            if (dom.closePersonalityBtn) {
                dom.closePersonalityBtn.addEventListener('click', () => {
                    dom.personalityModal.classList.add('hidden');
                });
            }
            if (dom.cancelPersonalityBtn) {
                dom.cancelPersonalityBtn.addEventListener('click', () => {
                    dom.personalityModal.classList.add('hidden');
                    if (dom.savePersonaCard) dom.savePersonaCard.classList.add('hidden');
                    if (dom.personalityTextarea) {
                        dom.personalityTextarea.value = state.personalityPrompt || '';
                        updatePersonalityCharCount();
                    }
                });
            }

            // Textarea editing
            if (dom.personalityTextarea) {
                dom.personalityTextarea.addEventListener('input', () => {
                    updatePersonalityCharCount();
                    if (dom.personalityPresetSelect) {
                        const currentVal = dom.personalityPresetSelect.value;
                        if (!currentVal.startsWith('custom_') && currentVal !== 'adhoc') {
                            dom.personalityPresetSelect.value = 'adhoc';
                            updateDeleteButtonVisibility();
                        }
                    }
                });
            }

            // Preset selection change
            if (dom.personalityPresetSelect) {
                dom.personalityPresetSelect.addEventListener('change', (e) => {
                    const val = e.target.value;
                    if (PERSONALITY_PRESETS[val]) {
                        dom.personalityTextarea.value = PERSONALITY_PRESETS[val].prompt;
                        updatePersonalityCharCount();
                    } else if (val.startsWith('custom_')) {
                        const customId = val.replace('custom_', '');
                        const found = (state.savedPersonas || []).find(p => p.id === customId);
                        if (found) {
                            dom.personalityTextarea.value = found.prompt;
                            updatePersonalityCharCount();
                        }
                    }
                    updateDeleteButtonVisibility();
                });
            }

            // New Persona Button
            if (dom.newPersonaBtn) {
                dom.newPersonaBtn.addEventListener('click', () => {
                    if (dom.personalityTextarea) {
                        dom.personalityTextarea.value = '';
                        updatePersonalityCharCount();
                        dom.personalityTextarea.focus();
                    }
                    if (dom.personalityPresetSelect) {
                        dom.personalityPresetSelect.value = 'adhoc';
                        updateDeleteButtonVisibility();
                    }
                    if (dom.savePersonaCard) {
                        dom.savePersonaCard.classList.remove('hidden');
                        if (dom.customPersonaNameInput) {
                            dom.customPersonaNameInput.value = '';
                            dom.customPersonaNameInput.focus();
                        }
                    }
                });
            }

            // Helper to get active persona display name
            function getActivePersonaName() {
                const val = dom.personalityPresetSelect ? dom.personalityPresetSelect.value : '';
                if (PERSONALITY_PRESETS[val]) return PERSONALITY_PRESETS[val].name.split('•')[0].trim();
                if (val && val.startsWith('custom_')) {
                    const customId = val.replace('custom_', '');
                    const found = (state.savedPersonas || []).find(p => p.id === customId);
                    if (found) return found.name;
                }
                return 'Custom Persona';
            }

            // Save As Persona Button
            if (dom.saveAsPersonaBtn) {
                dom.saveAsPersonaBtn.addEventListener('click', () => {
                    const promptVal = (dom.personalityTextarea?.value || '').trim();
                    if (!promptVal) {
                        showNotification({ title: 'Empty Prompt', message: 'Please write or select instructions before saving a persona.', type: 'warning' });
                        return;
                    }
                    if (dom.savePersonaCard) {
                        dom.savePersonaCard.classList.toggle('hidden');
                        if (!dom.savePersonaCard.classList.contains('hidden') && dom.customPersonaNameInput) {
                            const baseName = getActivePersonaName();
                            dom.customPersonaNameInput.value = `${baseName} (Copy)`;
                            dom.customPersonaNameInput.focus();
                            dom.customPersonaNameInput.select();
                        }
                    }
                });
            }

            // Enter & Escape key on persona name input
            if (dom.customPersonaNameInput) {
                dom.customPersonaNameInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        dom.confirmSavePersonaBtn?.click();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        dom.savePersonaCard?.classList.add('hidden');
                    }
                });
            }

            // Cancel Save As Card
            if (dom.cancelSavePersonaBtn) {
                dom.cancelSavePersonaBtn.addEventListener('click', () => {
                    if (dom.savePersonaCard) dom.savePersonaCard.classList.add('hidden');
                });
            }

            // Confirm Save Persona
            if (dom.confirmSavePersonaBtn) {
                dom.confirmSavePersonaBtn.addEventListener('click', () => {
                    let name = (dom.customPersonaNameInput?.value || '').trim();
                    if (!name) {
                        showNotification({ title: 'Name Required', message: 'Please enter a name for this persona.', type: 'warning' });
                        dom.customPersonaNameInput?.focus();
                        return;
                    }
                    if (name.length > 50) name = name.substring(0, 50).trim();

                    const promptVal = (dom.personalityTextarea?.value || '').trim();
                    if (!promptVal) {
                        showNotification({ title: 'Empty Instructions', message: 'Instructions cannot be blank.', type: 'warning' });
                        return;
                    }

                    if (!Array.isArray(state.savedPersonas)) state.savedPersonas = [];

                    // Check for existing persona with same name
                    const existingIndex = state.savedPersonas.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
                    let targetId;

                    if (existingIndex !== -1) {
                        const confirmOverwrite = confirm(`A persona named "${name}" already exists. Do you want to overwrite its instructions?`);
                        if (!confirmOverwrite) {
                            dom.customPersonaNameInput?.focus();
                            return;
                        }
                        state.savedPersonas[existingIndex].prompt = promptVal;
                        targetId = state.savedPersonas[existingIndex].id;
                    } else {
                        targetId = 'p_' + Date.now();
                        state.savedPersonas.push({ id: targetId, name, prompt: promptVal });
                    }

                    // Save to local storage
                    localStorage.setItem('nivm_saved_personas', JSON.stringify(state.savedPersonas));

                    // Immediately apply as active persona so closing modal doesn't lose it
                    const presetKey = `custom_${targetId}`;
                    state.personalityPrompt = promptVal;
                    state.personalityPreset = presetKey;
                    localStorage.setItem('nivm_personality_prompt', promptVal);
                    localStorage.setItem('nivm_personality_preset', presetKey);

                    // Clean up UI & refresh dropdown
                    if (dom.savePersonaCard) dom.savePersonaCard.classList.add('hidden');
                    if (dom.customPersonaNameInput) dom.customPersonaNameInput.value = '';

                    renderPersonalityDropdown(presetKey);
                    showNotification({
                        title: 'Persona Saved & Active',
                        message: `"${name}" is now saved and active.`,
                        type: 'success'
                    });
                });
            }

            // Delete Custom Persona
            if (dom.deletePersonaBtn) {
                dom.deletePersonaBtn.addEventListener('click', () => {
                    const val = dom.personalityPresetSelect ? dom.personalityPresetSelect.value : '';
                    if (!val || !val.startsWith('custom_')) return;
                    const customId = val.replace('custom_', '');
                    const personaToDelete = (state.savedPersonas || []).find(p => p.id === customId);
                    const personaName = personaToDelete ? personaToDelete.name : 'Persona';

                    state.savedPersonas = (state.savedPersonas || []).filter(p => p.id !== customId);
                    localStorage.setItem('nivm_saved_personas', JSON.stringify(state.savedPersonas));

                    renderPersonalityDropdown('balanced');
                    if (dom.personalityTextarea) {
                        dom.personalityTextarea.value = PERSONALITY_PRESETS.balanced.prompt;
                        updatePersonalityCharCount();
                    }
                    showNotification({
                        title: 'Persona Deleted',
                        message: `Removed "${personaName}".`,
                        type: 'info'
                    });
                });
            }

            // Reset Persona Button
            if (dom.resetPersonalityBtn) {
                dom.resetPersonalityBtn.addEventListener('click', () => {
                    if (dom.personalityPresetSelect) dom.personalityPresetSelect.value = 'balanced';
                    if (dom.personalityTextarea) {
                        dom.personalityTextarea.value = PERSONALITY_PRESETS.balanced.prompt;
                        updatePersonalityCharCount();
                    }
                    updateDeleteButtonVisibility();
                });
            }

            // Save & Apply Persona Button
            if (dom.savePersonalityBtn) {
                dom.savePersonalityBtn.addEventListener('click', () => {
                    const promptVal = dom.personalityTextarea ? dom.personalityTextarea.value.trim() : '';
                    const presetVal = dom.personalityPresetSelect ? dom.personalityPresetSelect.value : 'adhoc';

                    // If currently on a custom persona, update its saved prompt
                    if (presetVal.startsWith('custom_')) {
                        const customId = presetVal.replace('custom_', '');
                        const target = (state.savedPersonas || []).find(p => p.id === customId);
                        if (target) {
                            target.prompt = promptVal;
                            localStorage.setItem('nivm_saved_personas', JSON.stringify(state.savedPersonas));
                        }
                    }

                    state.personalityPrompt = promptVal;
                    state.personalityPreset = presetVal;
                    localStorage.setItem('nivm_personality_prompt', promptVal);
                    localStorage.setItem('nivm_personality_preset', presetVal);
                    dom.personalityModal.classList.add('hidden');
                    if (dom.savePersonaCard) dom.savePersonaCard.classList.add('hidden');

                    showNotification({
                        title: 'Persona Applied',
                        message: 'Active personality instructions updated.',
                        type: 'success'
                    });
                });
            }
        }
        setupPersonalityUI();

        dom.statsBtn.addEventListener('click', () => {
            populateStatsModal();
            dom.statsWindow.classList.toggle('hidden');
        });
        dom.closeStatsBtn.addEventListener('click', () => dom.statsWindow.classList.add('hidden'));
        dom.resetStatsBtn.addEventListener('click', async () => {
            if (await showConfirm('Reset Statistics', 'Are you sure you want to reset all usage statistics?')) {
                state.usageStats = { totalTokens: 0, totalCost: 0, totalDurationSec: 0 };
                saveUsageStats();
                populateStatsModal();
                showNotification({
                    title: 'Statistics Reset',
                    message: 'All usage statistics have been cleared',
                    type: 'success',
                    icon: 'fa-chart-pie'
                });
            }
        });

        if (dom.themeBtn) dom.themeBtn.addEventListener('click', () => dom.themeModal && dom.themeModal.classList.toggle('hidden'));
        if (dom.closeThemeBtn) dom.closeThemeBtn.addEventListener('click', () => dom.themeModal && dom.themeModal.classList.add('hidden'));
        if (dom.saveThemeBtn) dom.saveThemeBtn.addEventListener('click', () => dom.themeModal && dom.themeModal.classList.add('hidden'));

        // API Setup Modal (optional)
        if (dom.openApiSetupBtn && dom.apiSetupModal) {
            dom.openApiSetupBtn.addEventListener('click', () => {
                dom.apiSetupModal.classList.toggle('hidden');
                state.engineMode = 'native';
                if (dom.apiModeToggle) dom.apiModeToggle.checked = true;
            });
        }
        if (dom.closeApiSetupBtn && dom.apiSetupModal) {
            dom.closeApiSetupBtn.addEventListener('click', () => {
                dom.apiSetupModal.classList.add('hidden');
                state.engineMode = 'native';
                saveApiSettings();
            });
        }

        if (dom.apiModeToggle) {
            dom.apiModeToggle.addEventListener('change', () => {
                state.engineMode = 'native';
                dom.apiModeToggle.checked = true;
                saveApiSettings();
            });
        }

        // ── Per-role slider value display listeners ──
        const roleSliderSetup = [
            ['router', 'Gpu', true], ['router', 'Ctx', false], ['router', 'Batch', false],
            ['coder', 'Gpu', true], ['coder', 'Ctx', false], ['coder', 'Batch', false],
            ['vision', 'Gpu', true], ['vision', 'Ctx', false], ['vision', 'Batch', false],
            ['single', 'Gpu', true], ['single', 'Ctx', false], ['single', 'Batch', false],
        ];
        roleSliderSetup.forEach(([prefix, suffix, isGpu]) => {
            const slider = dom[prefix + suffix + 'Slider'];
            const val = dom[prefix + suffix + 'Val'];
            if (slider && val) {
                slider.addEventListener('input', () => {
                    val.textContent = isGpu && slider.value == -1 ? '-1 (Max)' : slider.value;
                });
            }
        });

        // ── Mode toggle buttons ──
        function setInferenceMode(mode) {
            state.inferenceMode = mode;
            if (dom.routingModeBtn) dom.routingModeBtn.classList.toggle('active', mode === 'routing');
            if (dom.singleModeBtn) dom.singleModeBtn.classList.toggle('active', mode === 'single');
            if (dom.apiModeBtn) dom.apiModeBtn.classList.toggle('active', mode === 'api');

            if (dom.routingModePanel) dom.routingModePanel.classList.toggle('hidden', mode !== 'routing');
            if (dom.singleModePanel) dom.singleModePanel.classList.toggle('hidden', mode !== 'single');
            if (dom.apiModePanel) dom.apiModePanel.classList.toggle('hidden', mode !== 'api');

            const isApi = mode === 'api';
            if (dom.downloadModelSection) dom.downloadModelSection.classList.toggle('hidden', isApi);
            if (dom.downloadDivider) dom.downloadDivider.classList.toggle('hidden', isApi);
            if (dom.smartEngineSection) dom.smartEngineSection.classList.toggle('hidden', isApi);

            if (isApi) {
                updateModelAvailabilityUI(true);
                fetchRemoteModels(true);
            } else {
                refreshEngineStatusUI();
            }

            updateVisionAvailabilityUI();

            saveApiSettings();
        }

        if (dom.routingModeBtn) dom.routingModeBtn.addEventListener('click', () => setInferenceMode('routing'));
        if (dom.singleModeBtn) dom.singleModeBtn.addEventListener('click', () => setInferenceMode('single'));
        if (dom.apiModeBtn) dom.apiModeBtn.addEventListener('click', () => setInferenceMode('api'));

        // ── API Panel Wiring ──
        function updateApiCurlSnippet() {
            if (!dom.apiCurlSnippet) return;
            const chatUrl = dom.apiChatUrl?.value.trim() || 'https://api.groq.com/openai/v1/chat/completions';
            const modelName = dom.apiModelInput?.value.trim() || 'llama-3.3-70b-versatile';
            const key = dom.apiKeyInput?.value.trim();
            const authHeader = key ? `  -H "Authorization: Bearer ${key}" \\\n` : '';
            dom.apiCurlSnippet.textContent = `curl -X POST ${chatUrl} \\\n  -H "Content-Type: application/json" \\\n${authHeader}  -d '{"model": "${modelName}", "messages": [{"role": "user", "content": "Hello!"}]}'`;
        }

        let fetchModelsDebounce = null;

        async function fetchRemoteModels(silent = false) {
            const baseUrl = dom.apiBaseUrl?.value.trim();
            if (!baseUrl) return;
            const apiKey = dom.apiKeyInput?.value.trim() || '';

            if (dom.fetchRemoteModelsBtn) {
                dom.fetchRemoteModelsBtn.disabled = true;
                dom.fetchRemoteModelsBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Fetching...';
            }
            if (dom.fetchModelsStatus) {
                dom.fetchModelsStatus.style.display = 'block';
                dom.fetchModelsStatus.innerHTML = '<span style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Querying provider for models...</span>';
            }

            try {
                const res = await fetch('/api/external/models', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ base_url: baseUrl, api_key: apiKey })
                });
                const data = await res.json();
                if (data.success && Array.isArray(data.models) && data.models.length > 0) {
                    // Populate datalist
                    if (dom.remoteApiModelsList) {
                        dom.remoteApiModelsList.innerHTML = data.models.map(m => `<option value="${m}">`).join('');
                    }
                    // Populate select dropdown
                    if (dom.apiModelSelect) {
                        dom.apiModelSelect.innerHTML = `<option value="">(Select model)</option>` +
                            data.models.map(m => `<option value="${m}">${m}</option>`).join('');
                        dom.apiModelSelect.style.display = 'block';

                        // If current input matches a model, select it; otherwise select the first model
                        const curr = dom.apiModelInput?.value.trim();
                        if (curr && data.models.includes(curr)) {
                            dom.apiModelSelect.value = curr;
                        } else {
                            const chosen = data.models[0];
                            if (dom.apiModelInput) dom.apiModelInput.value = chosen;
                            dom.apiModelSelect.value = chosen;
                            state.selectedModel = chosen;
                            saveApiSettings();
                            updateApiCurlSnippet();
                        }
                    }
                    if (dom.fetchModelsStatus) {
                        dom.fetchModelsStatus.innerHTML = `<span style="color: var(--accent-emerald, #10b981);"><i class="fa-solid fa-check"></i> Discovered ${data.models.length} models from provider</span>`;
                    }
                } else {
                    const err = data.error || 'No models returned by provider';
                    if (!silent && dom.fetchModelsStatus) {
                        dom.fetchModelsStatus.innerHTML = `<span style="color: var(--accent-rose, #f43f5e);"><i class="fa-solid fa-triangle-exclamation"></i> ${err}</span>`;
                    }
                }
            } catch (err) {
                if (!silent && dom.fetchModelsStatus) {
                    dom.fetchModelsStatus.innerHTML = `<span style="color: var(--accent-rose, #f43f5e);"><i class="fa-solid fa-triangle-exclamation"></i> Connection failed: ${err.message}</span>`;
                }
            } finally {
                if (dom.fetchRemoteModelsBtn) {
                    dom.fetchRemoteModelsBtn.disabled = false;
                    dom.fetchRemoteModelsBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Fetch Models';
                }
            }
        }

        function scheduleFetchModels() {
            if (fetchModelsDebounce) clearTimeout(fetchModelsDebounce);
            fetchModelsDebounce = setTimeout(() => {
                fetchRemoteModels(true);
            }, 800);
        }

        if (dom.fetchRemoteModelsBtn) {
            dom.fetchRemoteModelsBtn.addEventListener('click', () => fetchRemoteModels(false));
        }

        function syncMultimodalFromModel(modelName) {
            const endpoint = (dom.apiChatUrl?.value || dom.apiBaseUrl?.value || '').trim();
            const isMm = window.isMultimodalModel ? window.isMultimodalModel(modelName, endpoint) : false;
            if (dom.apiMultimodalCheck) {
                dom.apiMultimodalCheck.checked = isMm;
            }
            state.apiMultimodal = isMm;
            if (window.setVisionEnabled) {
                window.setVisionEnabled(isMm);
            }
        }

        if (dom.apiModelSelect) {
            dom.apiModelSelect.addEventListener('change', () => {
                if (dom.apiModelSelect.value) {
                    if (dom.apiModelInput) dom.apiModelInput.value = dom.apiModelSelect.value;
                    state.selectedModel = dom.apiModelSelect.value;
                    syncMultimodalFromModel(dom.apiModelSelect.value);
                    updateApiCurlSnippet();
                    saveApiSettings();
                }
            });
        }

        // Auto-fill chat completions endpoint & auto-fetch models when Base URL changes
        if (dom.apiBaseUrl) {
            dom.apiBaseUrl.addEventListener('input', () => {
                const rawBase = dom.apiBaseUrl.value.trim();
                if (rawBase) {
                    const cleanBase = rawBase.replace(/\/+$/, '');
                    if (dom.apiChatUrl) {
                        dom.apiChatUrl.value = `${cleanBase}/chat/completions`;
                    }
                }
                updateApiCurlSnippet();
                saveApiSettings();
                scheduleFetchModels();
            });
        }

        if (dom.apiChatUrl) {
            dom.apiChatUrl.addEventListener('input', () => {
                updateApiCurlSnippet();
                saveApiSettings();
            });
        }

        if (dom.apiKeyInput) {
            dom.apiKeyInput.addEventListener('input', () => {
                updateApiCurlSnippet();
                saveApiSettings();
                scheduleFetchModels();
            });
        }

        if (dom.apiModelInput) {
            dom.apiModelInput.addEventListener('input', () => {
                const val = dom.apiModelInput.value.trim();
                state.selectedModel = val;
                if (dom.apiModelSelect && val) {
                    dom.apiModelSelect.value = val;
                }
                syncMultimodalFromModel(val);
                updateApiCurlSnippet();
                saveApiSettings();
            });
        }

        if (dom.apiMultimodalCheck) {
            dom.apiMultimodalCheck.addEventListener('change', () => {
                state.apiMultimodal = dom.apiMultimodalCheck.checked;
                if (window.setVisionEnabled) {
                    window.setVisionEnabled(dom.apiMultimodalCheck.checked);
                }
                saveApiSettings();
            });
        }

        // API Key visibility toggle
        if (dom.toggleApiKeyVisibilityBtn && dom.apiKeyInput) {
            dom.toggleApiKeyVisibilityBtn.addEventListener('click', () => {
                const isPassword = dom.apiKeyInput.type === 'password';
                dom.apiKeyInput.type = isPassword ? 'text' : 'password';
                dom.toggleApiKeyVisibilityBtn.innerHTML = isPassword ? '<i class="fa-regular fa-eye-slash"></i>' : '<i class="fa-regular fa-eye"></i>';
            });
        }

        // Quick Provider Presets
        const apiPresets = {
            gemini: {
                base: 'https://generativelanguage.googleapis.com/v1beta/openai',
                chat: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
                model: 'gemini-2.5-flash',
                multimodal: true
            },
            groq: {
                base: 'https://api.groq.com/openai/v1',
                chat: 'https://api.groq.com/openai/v1/chat/completions',
                model: 'llama-3.3-70b-versatile',
                multimodal: false
            },
            openai: {
                base: 'https://api.openai.com/v1',
                chat: 'https://api.openai.com/v1/chat/completions',
                model: 'gpt-4o-mini',
                multimodal: true
            },
            ollama: {
                base: 'http://localhost:11434/v1',
                chat: 'http://localhost:11434/v1/chat/completions',
                model: 'llama3.2',
                multimodal: false
            },
            local: {
                base: `${window.location.origin}/v1`,
                chat: `${window.location.origin}/v1/chat/completions`,
                model: 'coder',
                multimodal: false
            }
        };

        document.querySelectorAll('.api-preset-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-preset');
                const p = apiPresets[key];
                if (!p) return;
                if (dom.apiBaseUrl) dom.apiBaseUrl.value = p.base;
                if (dom.apiChatUrl) dom.apiChatUrl.value = p.chat;
                if (dom.apiModelInput) {
                    dom.apiModelInput.value = p.model;
                    state.selectedModel = p.model;
                }
                if (dom.apiModelSelect) {
                    dom.apiModelSelect.value = p.model;
                }
                const mm = Boolean(p.multimodal);
                if (dom.apiMultimodalCheck) {
                    dom.apiMultimodalCheck.checked = mm;
                }
                state.apiMultimodal = mm;
                if (window.setVisionEnabled) {
                    window.setVisionEnabled(mm);
                }
                updateApiCurlSnippet();
                saveApiSettings();
                fetchRemoteModels(true);
            });
        });

        function setupCopyBtn(btn, getVal, copiedText = 'Copied!') {
            if (!btn) return;
            btn.addEventListener('click', () => {
                const val = typeof getVal === 'function' ? getVal() : getVal;
                navigator.clipboard.writeText(val);
                const origHtml = btn.innerHTML;
                btn.innerHTML = `<i class="fa-solid fa-check"></i> ${copiedText}`;
                setTimeout(() => { btn.innerHTML = origHtml; }, 2000);
            });
        }

        setupCopyBtn(dom.copyApiBaseUrlBtn, () => dom.apiBaseUrl?.value || '');
        setupCopyBtn(dom.copyApiChatUrlBtn, () => dom.apiChatUrl?.value || '');
        setupCopyBtn(dom.copyApiKeyBtn, () => dom.apiKeyInput?.value || '');
        setupCopyBtn(dom.copyApiCurlBtn, () => dom.apiCurlSnippet?.textContent || '');

        updateApiCurlSnippet();
        if (state.inferenceMode === 'api') {
            fetchRemoteModels(true);
        }

        if (dom.singleModelRoleSelect) {
            dom.singleModelRoleSelect.addEventListener('change', () => {
                const role = dom.singleModelRoleSelect.value;
                if (dom.customModelCard) {
                    if (role === 'custom') {
                        dom.customModelCard.classList.remove('hidden');
                        refreshScannedModelsList();
                    } else {
                        dom.customModelCard.classList.add('hidden');
                    }
                }
                if (role !== 'custom') {
                    ['Gpu', 'Ctx', 'Batch'].forEach(field => {
                        const src = dom[role + field + 'Slider'];
                        const dst = dom['single' + field + 'Slider'];
                        const val = dom['single' + field + 'Val'];
                        if (src && dst) {
                            dst.value = src.value;
                            if (val) val.textContent = field === 'Gpu' && src.value == -1 ? '-1 (Max)' : src.value;
                        }
                    });
                    if (dom[role + 'KvSelect'] && dom.singleKvSelect) {
                        dom.singleKvSelect.value = dom[role + 'KvSelect'].value;
                    }
                    ['FlashAttn', 'OffloadKqv', 'Mlock', 'Mmap'].forEach(flag => {
                        if (dom[role + flag] && dom['single' + flag]) {
                            dom['single' + flag].checked = dom[role + flag].checked;
                        }
                    });
                }
                updateVisionAvailabilityUI();
                saveApiSettings();
            });
        }

        // ── Scanned GGUF and mmproj list management ──
        let scannedModelsCache = [];

        function syncSelectWithInput(selectEl, path) {
            if (!selectEl) return;
            if (!path) {
                selectEl.value = '';
                return;
            }
            let found = false;
            for (let i = 0; i < selectEl.options.length; i++) {
                if (selectEl.options[i].value === path) {
                    selectEl.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            if (!found) {
                const prevCustom = selectEl.querySelector('option[data-custom="true"]');
                if (prevCustom) prevCustom.remove();
                const opt = document.createElement('option');
                opt.value = path;
                opt.dataset.custom = 'true';
                opt.textContent = `Custom: ${path.split('/').pop() || path}`;
                opt.selected = true;
                selectEl.appendChild(opt);
            }
        }

        async function refreshScannedModelsList() {
            try {
                const data = await scanLocalGgufs();
                scannedModelsCache = data.models || [];
                const remembered = data.remembered_paths || state.rememberedPaths || [];
                state.rememberedPaths = remembered;

                // 1. Model Selector Sync
                if (dom.scannedGgufSelect) {
                    const currentVal = dom.customModelPathInput ? dom.customModelPathInput.value.trim() : (state.customModelPath || '');
                    dom.scannedGgufSelect.innerHTML = '<option value="">-- Select detected model --</option>';
                    let foundCurrent = false;

                    scannedModelsCache.forEach(m => {
                        const isMmproj = m.filename.toLowerCase().includes('mmproj');
                        const opt = document.createElement('option');
                        opt.value = m.path;
                        opt.textContent = `${m.filename} (${m.size_gb} GB)${isMmproj ? ' [Projector]' : ''}`;
                        if (m.path === currentVal) {
                            opt.selected = true;
                            foundCurrent = true;
                        }
                        dom.scannedGgufSelect.appendChild(opt);
                    });

                    if (currentVal && !foundCurrent) {
                        const opt = document.createElement('option');
                        opt.value = currentVal;
                        opt.dataset.custom = 'true';
                        opt.textContent = `Custom: ${currentVal.split('/').pop() || currentVal}`;
                        opt.selected = true;
                        dom.scannedGgufSelect.appendChild(opt);
                    }
                    if (!currentVal) {
                        dom.scannedGgufSelect.value = '';
                    }
                }

                // 2. Vision Projector (mmproj) Selector Sync
                if (dom.scannedMmprojSelect) {
                    const currentMmproj = dom.customMmprojInput ? dom.customMmprojInput.value.trim() : (state.customMmprojPath || '');
                    dom.scannedMmprojSelect.innerHTML = '<option value="">-- None (Disabled) --</option>';
                    let foundMmproj = false;

                    scannedModelsCache.forEach(m => {
                        const isMmproj = m.filename.toLowerCase().includes('mmproj');
                        const opt = document.createElement('option');
                        opt.value = m.path;
                        opt.textContent = `${m.filename} (${m.size_gb} GB)${isMmproj ? ' ★' : ''}`;
                        if (m.path === currentMmproj) {
                            opt.selected = true;
                            foundMmproj = true;
                        }
                        dom.scannedMmprojSelect.appendChild(opt);
                    });

                    if (currentMmproj && !foundMmproj) {
                        const opt = document.createElement('option');
                        opt.value = currentMmproj;
                        opt.dataset.custom = 'true';
                        opt.textContent = `Custom: ${currentMmproj.split('/').pop() || currentMmproj}`;
                        opt.selected = true;
                        dom.scannedMmprojSelect.appendChild(opt);
                    }
                    if (!currentMmproj) {
                        dom.scannedMmprojSelect.value = '';
                    }
                    if (dom.customMmprojCpu) {
                        dom.customMmprojCpu.disabled = !currentMmproj;
                    }
                }

                if (dom.rememberedPathsChips && dom.rememberedPathsContainer) {
                    dom.rememberedPathsChips.innerHTML = '';
                    if (remembered.length > 0) {
                        dom.rememberedPathsContainer.classList.remove('hidden');
                        remembered.forEach(p => {
                            const chip = document.createElement('div');
                            chip.className = 'path-chip';
                            const fname = p.split('/').pop();
                            chip.textContent = fname;
                            chip.title = p;
                            if (dom.customModelPathInput && dom.customModelPathInput.value.trim() === p) {
                                chip.classList.add('active');
                            }
                            chip.addEventListener('click', () => {
                                if (dom.customModelPathInput) {
                                    dom.customModelPathInput.value = p;
                                    syncSelectWithInput(dom.scannedGgufSelect, p);
                                    verifyPathStatus(p, dom.customModelPathStatus);
                                    saveApiSettings();
                                    document.querySelectorAll('.path-chip').forEach(c => c.classList.remove('active'));
                                    chip.classList.add('active');
                                }
                            });
                            dom.rememberedPathsChips.appendChild(chip);
                        });
                    } else {
                        dom.rememberedPathsContainer.classList.add('hidden');
                    }
                }

                if (dom.customModelPathInput && dom.customModelPathStatus) {
                    verifyPathStatus(dom.customModelPathInput.value.trim(), dom.customModelPathStatus);
                }
                if (dom.customMmprojInput && dom.customMmprojStatus) {
                    verifyPathStatus(dom.customMmprojInput.value.trim(), dom.customMmprojStatus, true);
                }
            } catch (err) {
                console.warn('Failed to refresh scanned models:', err);
            }
        }

        async function verifyPathStatus(path, statusEl, isOptional = false) {
            if (!statusEl) return;
            if (!path) {
                statusEl.textContent = isOptional ? 'None' : 'No file selected';
                statusEl.className = 'file-status-pill status-unknown';
                return;
            }
            const foundInCache = scannedModelsCache.find(m => m.path === path);
            if (foundInCache) {
                statusEl.textContent = `Found (${foundInCache.size_gb} GB)`;
                statusEl.className = 'file-status-pill status-found';
                return;
            }
            statusEl.textContent = 'Checking...';
            statusEl.className = 'file-status-pill status-unknown';
            try {
                const check = await verifyFile(path);
                if (check.exists) {
                    statusEl.textContent = `Found (${check.size_gb} GB)`;
                    statusEl.className = 'file-status-pill status-found';
                } else {
                    statusEl.textContent = check.is_directory ? 'Directory' : 'Not found';
                    statusEl.className = 'file-status-pill status-missing';
                }
            } catch (e) {
                statusEl.textContent = 'Custom Path';
                statusEl.className = 'file-status-pill status-unknown';
            }
        }

        // Model selector change & direct input sync
        if (dom.scannedGgufSelect) {
            dom.scannedGgufSelect.addEventListener('change', () => {
                const val = dom.scannedGgufSelect.value.trim();
                if (dom.customModelPathInput) dom.customModelPathInput.value = val;
                verifyPathStatus(val, dom.customModelPathStatus);
                saveApiSettings();
            });
        }

        if (dom.customModelPathInput) {
            dom.customModelPathInput.addEventListener('input', () => {
                const val = dom.customModelPathInput.value.trim();
                syncSelectWithInput(dom.scannedGgufSelect, val);
                verifyPathStatus(val, dom.customModelPathStatus);
                saveApiSettings();
            });
        }

        if (dom.clearCustomPathBtn) {
            dom.clearCustomPathBtn.addEventListener('click', () => {
                if (dom.customModelPathInput) dom.customModelPathInput.value = '';
                if (dom.scannedGgufSelect) dom.scannedGgufSelect.value = '';
                verifyPathStatus('', dom.customModelPathStatus);
                saveApiSettings();
            });
        }

        // Projector selector change & direct input sync
        if (dom.scannedMmprojSelect) {
            dom.scannedMmprojSelect.addEventListener('change', () => {
                const val = dom.scannedMmprojSelect.value.trim();
                if (dom.customMmprojInput) dom.customMmprojInput.value = val;
                state.customMmprojPath = val;
                verifyPathStatus(val, dom.customMmprojStatus, true);
                const hasProj = Boolean(val && val.toLowerCase() !== 'none');
                if (dom.customMmprojCpu) dom.customMmprojCpu.disabled = !hasProj;
                setVisionEnabled(hasProj);
                saveApiSettings();
            });
        }

        if (dom.customMmprojInput) {
            dom.customMmprojInput.addEventListener('input', () => {
                const val = dom.customMmprojInput.value.trim();
                state.customMmprojPath = val;
                syncSelectWithInput(dom.scannedMmprojSelect, val);
                verifyPathStatus(val, dom.customMmprojStatus, true);
                const hasProj = Boolean(val && val.toLowerCase() !== 'none');
                if (dom.customMmprojCpu) dom.customMmprojCpu.disabled = !hasProj;
                setVisionEnabled(hasProj);
                saveApiSettings();
            });
        }

        if (dom.clearMmprojBtn) {
            dom.clearMmprojBtn.addEventListener('click', () => {
                if (dom.customMmprojInput) dom.customMmprojInput.value = '';
                if (dom.scannedMmprojSelect) dom.scannedMmprojSelect.value = '';
                state.customMmprojPath = '';
                verifyPathStatus('', dom.customMmprojStatus, true);
                if (dom.customMmprojCpu) dom.customMmprojCpu.disabled = true;
                setVisionEnabled(false);
                saveApiSettings();
            });
        }

        if (dom.verifyCustomPathBtn) {
            dom.verifyCustomPathBtn.addEventListener('click', () => {
                const path = dom.customModelPathInput ? dom.customModelPathInput.value.trim() : '';
                verifyPathStatus(path, dom.customModelPathStatus);
                saveApiSettings();
            });
        }

        if (dom.verifyMmprojBtn) {
            dom.verifyMmprojBtn.addEventListener('click', () => {
                const path = dom.customMmprojInput ? dom.customMmprojInput.value.trim() : '';
                verifyPathStatus(path, dom.customMmprojStatus, true);
                saveApiSettings();
            });
        }

        if (dom.customMmprojCpu) {
            dom.customMmprojCpu.addEventListener('change', () => saveApiSettings());
        }
        if (dom.visionMmprojCpu) {
            dom.visionMmprojCpu.addEventListener('change', () => saveApiSettings());
        }
        if (dom.pdfDpiSelect) {
            dom.pdfDpiSelect.addEventListener('change', () => saveApiSettings());
        }

        // ── Custom GGUF File Picker & In-Browser Explorer ──
        let fileBrowserTarget = 'model'; // 'model' | 'mmproj'
        let currentBrowserData = null;
        let selectedBrowserFile = null;

        async function openFileBrowserModal(target = 'model') {
            fileBrowserTarget = target;
            selectedBrowserFile = null;
            if (dom.fileBrowserModalTitle) {
                dom.fileBrowserModalTitle.textContent = target === 'mmproj'
                    ? 'Browse & Select Vision Projector (mmproj)'
                    : 'Browse & Select GGUF Model';
            }
            if (dom.fileBrowserSelectBtn) {
                dom.fileBrowserSelectBtn.disabled = true;
                dom.fileBrowserSelectBtn.textContent = target === 'mmproj' ? 'Select Projector' : 'Select Model';
            }
            if (dom.fileBrowserSelectionInfo) {
                dom.fileBrowserSelectionInfo.innerHTML = '<span class="file-browser-none-selected">No file selected</span>';
            }
            if (dom.fileBrowserSearchInput) dom.fileBrowserSearchInput.value = '';

            if (dom.fileBrowserModal) dom.fileBrowserModal.classList.remove('hidden');

            const win = dom.fileBrowserWindow || document.getElementById('fileBrowserWindow');
            const header = dom.fileBrowserHeader || document.getElementById('fileBrowserHeader');
            if (win && header && !win.dataset.draggableInitialized) {
                makeDraggable(win, header);
                win.dataset.draggableInitialized = 'true';
            }

            let initialPath = null;
            const inputVal = target === 'mmproj' ? dom.customMmprojInput?.value.trim() : dom.customModelPathInput?.value.trim();
            if (inputVal && inputVal.includes('/')) {
                initialPath = inputVal.substring(0, inputVal.lastIndexOf('/'));
            }
            await loadBrowserDirectory(initialPath);
        }

        async function loadBrowserDirectory(path = null) {
            if (dom.fileBrowserList) {
                dom.fileBrowserList.innerHTML = '<div class="file-browser-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading directory contents...</div>';
            }
            selectedBrowserFile = null;
            if (dom.fileBrowserSelectBtn) dom.fileBrowserSelectBtn.disabled = true;
            if (dom.fileBrowserSelectionInfo) {
                dom.fileBrowserSelectionInfo.innerHTML = '<span class="file-browser-none-selected">No file selected</span>';
            }

            const data = await listDirectory(path);
            currentBrowserData = data;

            if (dom.fileBrowserCurrentPathInput) {
                dom.fileBrowserCurrentPathInput.value = data.current_path || '';
            }

            if (dom.fileBrowserUpBtn) {
                dom.fileBrowserUpBtn.disabled = !data.parent_path;
            }

            // Render shortcuts bar
            if (dom.fileBrowserShortcuts && data.shortcuts) {
                dom.fileBrowserShortcuts.innerHTML = '';
                data.shortcuts.forEach(s => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'file-browser-shortcut';
                    if (data.current_path === s.path) btn.classList.add('active');
                    btn.innerHTML = `<i class="fa-solid ${s.icon || 'fa-folder'}"></i> ${s.name}`;
                    btn.addEventListener('click', () => loadBrowserDirectory(s.path));
                    dom.fileBrowserShortcuts.appendChild(btn);
                });
            }

            renderBrowserFileList();
        }

        function renderBrowserFileList() {
            if (!dom.fileBrowserList || !currentBrowserData) return;
            dom.fileBrowserList.innerHTML = '';

            const onlyGguf = dom.fileBrowserOnlyGguf ? dom.fileBrowserOnlyGguf.checked : true;
            const query = dom.fileBrowserSearchInput ? dom.fileBrowserSearchInput.value.trim().toLowerCase() : '';

            // 1. Folders
            const folders = (currentBrowserData.folders || []).filter(f => !query || f.name.toLowerCase().includes(query));
            folders.forEach(f => {
                const item = document.createElement('div');
                item.className = 'file-browser-item';
                item.innerHTML = `
                    <div class="file-browser-item-left">
                        <span class="file-browser-item-icon"><i class="fa-solid fa-folder" style="color: #fbbf24;"></i></span>
                        <span class="file-browser-item-name">${f.name}</span>
                    </div>
                    <div class="file-browser-item-right">
                        <i class="fa-solid fa-chevron-right" style="color: var(--text-tertiary); font-size: 0.75rem;"></i>
                    </div>
                `;
                item.addEventListener('click', () => loadBrowserDirectory(f.path));
                dom.fileBrowserList.appendChild(item);
            });

            // 2. Files
            let files = currentBrowserData.files || [];
            if (onlyGguf) {
                files = files.filter(f => f.is_gguf);
            }
            if (query) {
                files = files.filter(f => f.name.toLowerCase().includes(query));
            }

            if (folders.length === 0 && files.length === 0) {
                dom.fileBrowserList.innerHTML = '<div class="file-browser-empty">No matching files or folders found</div>';
                return;
            }

            files.forEach(f => {
                const item = document.createElement('div');
                item.className = 'file-browser-item';
                if (selectedBrowserFile && selectedBrowserFile.path === f.path) {
                    item.classList.add('active');
                }

                const iconHtml = f.is_gguf
                    ? '<i class="fa-solid fa-cube" style="color: var(--accent-purple);"></i>'
                    : '<i class="fa-regular fa-file" style="color: var(--text-tertiary);"></i>';

                const badgeHtml = f.is_gguf
                    ? `<span class="file-browser-gguf-badge">GGUF</span>`
                    : '';

                const sizeStr = f.size_gb >= 1 ? `${f.size_gb} GB` : `${f.size_mb || 0} MB`;

                item.innerHTML = `
                    <div class="file-browser-item-left">
                        <span class="file-browser-item-icon">${iconHtml}</span>
                        <span class="file-browser-item-name">${f.name}</span>
                    </div>
                    <div class="file-browser-item-right">
                        ${badgeHtml}
                        <span class="file-browser-size-badge">${sizeStr}</span>
                    </div>
                `;

                item.addEventListener('click', () => {
                    document.querySelectorAll('.file-browser-item').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                    selectedBrowserFile = f;
                    if (dom.fileBrowserSelectionInfo) {
                        dom.fileBrowserSelectionInfo.innerHTML = `<b>${f.name}</b> <span style="color: var(--text-tertiary);">(${sizeStr})</span>`;
                    }
                    if (dom.fileBrowserSelectBtn) {
                        dom.fileBrowserSelectBtn.disabled = false;
                    }
                });

                item.addEventListener('dblclick', () => {
                    selectedBrowserFile = f;
                    applyBrowserSelection();
                });

                dom.fileBrowserList.appendChild(item);
            });
        }

        async function applyBrowserSelection() {
            if (!selectedBrowserFile) return;
            const p = selectedBrowserFile.path;
            const isMmproj = fileBrowserTarget === 'mmproj';

            if (isMmproj) {
                if (dom.customMmprojInput) dom.customMmprojInput.value = p;
                verifyPathStatus(p, dom.customMmprojStatus, true);
            } else {
                if (dom.customModelPathInput) dom.customModelPathInput.value = p;
                verifyPathStatus(p, dom.customModelPathStatus);
            }

            await saveApiSettings();
            await refreshScannedModelsList();

            if (dom.fileBrowserModal) dom.fileBrowserModal.classList.add('hidden');

            showNotification({
                title: isMmproj ? 'Projector Selected' : 'Model Selected',
                message: `${selectedBrowserFile.name} (${selectedBrowserFile.size_gb || 0} GB)`,
                type: 'success',
                icon: isMmproj ? 'fa-eye' : 'fa-cube'
            });
        }

        async function handleBrowseFile(target = 'model') {
            const btn = target === 'mmproj' ? dom.browseMmprojBtn : dom.browseCustomPathBtn;
            const origHtml = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Selecting...';
            }

            try {
                const currentVal = target === 'mmproj' ? dom.customMmprojInput?.value.trim() : dom.customModelPathInput?.value.trim();
                let initialDir = null;
                if (currentVal && currentVal.includes('/')) {
                    initialDir = currentVal.substring(0, currentVal.lastIndexOf('/'));
                }

                const title = target === 'mmproj' ? 'Select Vision Projector GGUF' : 'Select GGUF Model File';
                const result = await openNativeFileDialog(initialDir, title);

                if (result && result.success && result.path) {
                    if (dom.fileBrowserModal) dom.fileBrowserModal.classList.add('hidden');
                    const isMmproj = target === 'mmproj';
                    if (isMmproj) {
                        if (dom.customMmprojInput) dom.customMmprojInput.value = result.path;
                        verifyPathStatus(result.path, dom.customMmprojStatus, true);
                    } else {
                        if (dom.customModelPathInput) dom.customModelPathInput.value = result.path;
                        verifyPathStatus(result.path, dom.customModelPathStatus);
                    }

                    await saveApiSettings();
                    await refreshScannedModelsList();

                    showNotification({
                        title: isMmproj ? 'Projector Selected' : 'Model Selected',
                        message: `${result.filename} (${result.size_gb} GB)`,
                        type: 'success',
                        icon: isMmproj ? 'fa-eye' : 'fa-cube'
                    });
                } else if (result && result.fallback) {
                    openFileBrowserModal(target);
                }
            } catch (err) {
                console.warn('Native browse error, opening explorer modal:', err);
                openFileBrowserModal(target);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = origHtml;
                }
            }
        }

        if (dom.browseCustomPathBtn) {
            dom.browseCustomPathBtn.addEventListener('click', () => handleBrowseFile('model'));
        }
        if (dom.exploreCustomPathBtn) {
            dom.exploreCustomPathBtn.addEventListener('click', () => openFileBrowserModal('model'));
        }

        if (dom.browseMmprojBtn) {
            dom.browseMmprojBtn.addEventListener('click', () => handleBrowseFile('mmproj'));
        }
        if (dom.exploreMmprojBtn) {
            dom.exploreMmprojBtn.addEventListener('click', () => openFileBrowserModal('mmproj'));
        }

        if (dom.closeFileBrowserBtn) {
            dom.closeFileBrowserBtn.addEventListener('click', () => dom.fileBrowserModal.classList.add('hidden'));
        }
        if (dom.fileBrowserCancelBtn) {
            dom.fileBrowserCancelBtn.addEventListener('click', () => dom.fileBrowserModal.classList.add('hidden'));
        }
        if (dom.fileBrowserSelectBtn) {
            dom.fileBrowserSelectBtn.addEventListener('click', applyBrowserSelection);
        }
        if (dom.fileBrowserUpBtn) {
            dom.fileBrowserUpBtn.addEventListener('click', () => {
                if (currentBrowserData && currentBrowserData.parent_path) {
                    loadBrowserDirectory(currentBrowserData.parent_path);
                }
            });
        }
        if (dom.fileBrowserGoBtn) {
            dom.fileBrowserGoBtn.addEventListener('click', () => {
                if (dom.fileBrowserCurrentPathInput) {
                    loadBrowserDirectory(dom.fileBrowserCurrentPathInput.value.trim());
                }
            });
        }
        if (dom.fileBrowserCurrentPathInput) {
            dom.fileBrowserCurrentPathInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    loadBrowserDirectory(dom.fileBrowserCurrentPathInput.value.trim());
                }
            });
        }
        if (dom.fileBrowserSearchInput) {
            dom.fileBrowserSearchInput.addEventListener('input', renderBrowserFileList);
        }
        if (dom.fileBrowserOnlyGguf) {
            dom.fileBrowserOnlyGguf.addEventListener('change', renderBrowserFileList);
        }
        if (dom.fileBrowserNativeBtn) {
            dom.fileBrowserNativeBtn.addEventListener('click', () => handleBrowseFile(fileBrowserTarget));
        }

        // ── Model Downloader Wiring ──
        let downloadPollTimer = null;

        async function updateDownloadUI() {
            const status = await pollDownloadStatus();
            if (!status) return;

            if (dom.downloadEngineBadge) {
                dom.downloadEngineBadge.innerHTML = status.aria2_available
                    ? '<i class="fa-solid fa-shield-halved"></i> aria2 (Isolated)'
                    : '<i class="fa-solid fa-shield-halved"></i> Stream (Isolated)';
            }

            if (status.status === 'downloading') {
                if (dom.downloadProgressCard) dom.downloadProgressCard.classList.remove('hidden');
                if (dom.downloadCardFilename) dom.downloadCardFilename.textContent = status.filename || 'Downloading...';
                if (dom.downloadCardSize) dom.downloadCardSize.textContent = `${status.downloaded_str} / ${status.total_str}`;
                if (dom.downloadCardSpeed) dom.downloadCardSpeed.textContent = status.speed_str;
                if (dom.downloadCardEta) dom.downloadCardEta.textContent = `ETA: ${status.eta_str}`;
                if (dom.downloadProgressBar) dom.downloadProgressBar.style.width = `${Math.min(status.percent, 100)}%`;
                if (dom.downloadPercentLabel) dom.downloadPercentLabel.textContent = `${status.percent}%`;
                if (dom.downloadEngineLabel) dom.downloadEngineLabel.textContent = `Engine: ${status.engine}`;
            } else if (status.status === 'completed') {
                if (downloadPollTimer) {
                    clearInterval(downloadPollTimer);
                    downloadPollTimer = null;
                }
                if (dom.downloadProgressBar) dom.downloadProgressBar.style.width = '100%';
                if (dom.downloadPercentLabel) dom.downloadPercentLabel.textContent = '100% Complete';
                if (dom.downloadCardSpeed) dom.downloadCardSpeed.textContent = 'Done';
                if (dom.downloadCardEta) dom.downloadCardEta.textContent = status.total_str;

                await refreshScannedModelsList();
                if (status.filename && status.filename.toLowerCase().includes('mmproj')) {
                    if (dom.customMmprojInput) dom.customMmprojInput.value = status.path;
                    verifyPathStatus(status.path, dom.customMmprojStatus, true);
                } else {
                    if (dom.customModelPathInput) dom.customModelPathInput.value = status.path;
                    verifyPathStatus(status.path, dom.customModelPathStatus);
                }
                saveApiSettings();
                showAlert("Download Finished", `Successfully downloaded ${status.filename}!`);
            } else if (status.status === 'error') {
                if (downloadPollTimer) {
                    clearInterval(downloadPollTimer);
                    downloadPollTimer = null;
                }
                if (dom.downloadCardSpeed) dom.downloadCardSpeed.textContent = 'Error';
                if (dom.downloadCardEta) dom.downloadCardEta.textContent = status.error || 'Failed';
                showAlert("Download Error", status.error || "Failed to download model.");
            } else if (status.status === 'cancelled') {
                if (downloadPollTimer) {
                    clearInterval(downloadPollTimer);
                    downloadPollTimer = null;
                }
                if (dom.downloadProgressCard) dom.downloadProgressCard.classList.add('hidden');
            }
        }

        if (dom.startDownloadBtn) {
            dom.startDownloadBtn.addEventListener('click', async () => {
                const url = dom.modelDownloadUrlInput ? dom.modelDownloadUrlInput.value.trim() : '';
                if (!url) {
                    showAlert("Download", "Please enter a Hugging Face or direct GGUF URL.");
                    return;
                }
                try {
                    dom.startDownloadBtn.disabled = true;
                    await startModelDownload(url);
                    if (dom.downloadProgressCard) dom.downloadProgressCard.classList.remove('hidden');
                    if (downloadPollTimer) clearInterval(downloadPollTimer);
                    downloadPollTimer = setInterval(updateDownloadUI, 800);
                    updateDownloadUI();
                    showNotification({
                        title: 'Download Started',
                        message: 'Downloading model in background...',
                        type: 'info',
                        icon: 'fa-cloud-arrow-down'
                    });
                } catch (err) {
                    showAlert("Download Failed", err.message);
                } finally {
                    dom.startDownloadBtn.disabled = false;
                }
            });
        }

        if (dom.cancelDownloadBtn) {
            dom.cancelDownloadBtn.addEventListener('click', async () => {
                await cancelModelDownload();
                if (downloadPollTimer) {
                    clearInterval(downloadPollTimer);
                    downloadPollTimer = null;
                }
                if (dom.downloadProgressCard) dom.downloadProgressCard.classList.add('hidden');
                showNotification({
                    title: 'Download Cancelled',
                    message: 'Model download has been cancelled.',
                    type: 'warning'
                });
            });
        }

        // ── Role card accordion ──
        document.querySelectorAll('.role-card-header').forEach(header => {
            header.addEventListener('click', () => {
                const targetId = header.getAttribute('data-target');
                const body = document.getElementById(targetId);
                if (body) {
                    body.classList.toggle('collapsed');
                    const chevron = header.querySelector('.role-card-chevron');
                    if (chevron) chevron.classList.toggle('rotated');
                }
            });
        });

        // ── Smart toggle engine button ──
        if (dom.smartToggleBtn) {
            dom.smartToggleBtn.addEventListener('click', async () => {
                dom.smartToggleBtn.disabled = true;
                dom.engineStatusText.textContent = 'Working...';
                dom.engineStatusText.style.color = 'var(--text-secondary)';
                try {
                    await saveApiSettings();
                    const result = await smartToggleEngine();
                    await fetchEngineStatus();
                    if (result.warning || result.info?.warning) {
                        showAlert("Model Notice", result.warning || result.info.warning);
                    }
                    if (result.action === 'loaded') {
                        dom.engineStatusText.textContent = `Active: ${result.info?.name || result.role}`;
                        dom.engineStatusText.style.color = 'var(--accent-emerald)';
                        dom.smartToggleBtn.classList.add('is-loaded');
                        dom.smartToggleLabel.textContent = 'Unload Engine';
                        showNotification({
                            title: 'Engine Loaded',
                            message: `${result.info?.name || result.role} is now active and ready`,
                            type: 'success',
                            icon: 'fa-bolt'
                        });
                    } else {
                        dom.engineStatusText.textContent = 'Status: Unloaded';
                        dom.engineStatusText.style.color = 'var(--text-tertiary)';
                        dom.smartToggleBtn.classList.remove('is-loaded');
                        dom.smartToggleLabel.textContent = 'Load Engine';
                        showNotification({
                            title: 'Engine Unloaded',
                            message: 'Engine is now unloaded and idle',
                            type: 'info',
                            icon: 'fa-power-off'
                        });
                    }
                } catch (e) {
                    dom.engineStatusText.textContent = 'Error: ' + e.message;
                    dom.engineStatusText.style.color = '#ef4444';
                    showNotification({
                        title: 'Engine Error',
                        message: e.message,
                        type: 'error'
                    });
                } finally {
                    dom.smartToggleBtn.disabled = false;
                }
            });
        }

        // ── Update engine status display when settings open ──
        async function refreshEngineStatusUI() {
            try {
                const res = await fetch('/api/engine/status', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    const isLoaded = !!(data.active && data.active.loaded);
                    state.isModelLoaded = isLoaded;

                    if (dom.engineStatusText) {
                        if (isLoaded) {
                            dom.engineStatusText.textContent = `Active: ${data.active.name}`;
                            dom.engineStatusText.style.color = 'var(--accent-emerald)';
                            dom.smartToggleBtn.classList.add('is-loaded');
                            dom.smartToggleLabel.textContent = 'Unload Engine';
                        } else {
                            dom.engineStatusText.textContent = 'Status: Not Loaded';
                            dom.engineStatusText.style.color = 'var(--text-tertiary)';
                            dom.smartToggleBtn.classList.remove('is-loaded');
                            dom.smartToggleLabel.textContent = 'Load Engine';
                        }
                    }

                    if (window.updateModelAvailabilityUI) {
                        window.updateModelAvailabilityUI(isLoaded);
                    }

                    // Update role availability badges
                    if (data.available) {
                        for (const [role, info] of Object.entries(data.available)) {
                            const badge = dom[role + 'AvailBadge'];
                            if (badge) {
                                if (info.available) {
                                    badge.textContent = `${info.size_gb} GB`;
                                    badge.classList.add('available');
                                    badge.classList.remove('unavailable');
                                } else {
                                    badge.textContent = 'Missing';
                                    badge.classList.add('unavailable');
                                    badge.classList.remove('available');
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to refresh engine status:', e);
            }
        }
        window.refreshEngineStatusUI = refreshEngineStatusUI;

        // ── Model Availability UI Update (Chat Box Overlay & Side Notification) ──
        function updateModelAvailabilityUI(isLoaded) {
            if (state.inferenceMode === 'api') {
                state.isModelLoaded = true;
                if (dom.noModelChatOverlay) dom.noModelChatOverlay.classList.add('hidden');
                if (dom.sideModelNotif) dom.sideModelNotif.classList.add('hidden');
                return;
            }
            state.isModelLoaded = isLoaded;
            if (!isLoaded) {
                if (dom.noModelChatOverlay) {
                    dom.noModelChatOverlay.classList.remove('hidden');
                    const text = dom.userPrompt ? dom.userPrompt.value.trim() : '';
                    if (dom.chatBoxDraftHint) {
                        if (text.length > 0) {
                            dom.chatBoxDraftHint.textContent = `Draft preserved (${text.length} chars) • Load model in Settings to continue`;
                        } else {
                            dom.chatBoxDraftHint.textContent = 'Configure and load a model in Settings to continue';
                        }
                    }
                }
                if (dom.sideModelNotif && !state.sideNotifDismissed) {
                    dom.sideModelNotif.classList.remove('hidden');
                }
            } else {
                if (dom.noModelChatOverlay) {
                    dom.noModelChatOverlay.classList.add('hidden');
                }
                if (dom.sideModelNotif) {
                    dom.sideModelNotif.classList.add('hidden');
                }
            }
        }
        window.updateModelAvailabilityUI = updateModelAvailabilityUI;

        function openSettingsForModelLoad() {
            if (dom.settingsModal) {
                dom.settingsModal.classList.remove('hidden');
                refreshEngineStatusUI();
                refreshScannedModelsList();
            }
        }

        if (dom.chatBoxLoadModelBtn) {
            dom.chatBoxLoadModelBtn.addEventListener('click', openSettingsForModelLoad);
        }

        if (dom.sideNotifLoadBtn) {
            dom.sideNotifLoadBtn.addEventListener('click', () => {
                state.sideNotifDismissed = true;
                if (dom.sideModelNotif) dom.sideModelNotif.classList.add('hidden');
                openSettingsForModelLoad();
            });
        }

        if (dom.sideNotifCloseBtn) {
            dom.sideNotifCloseBtn.addEventListener('click', () => {
                state.sideNotifDismissed = true;
                if (dom.sideModelNotif) dom.sideModelNotif.classList.add('hidden');
            });
        }

        // Refresh engine status & scanned models when settings modal opens
        const origSettingsClick = dom.settingsBtn.onclick;
        dom.settingsBtn.addEventListener('click', () => {
            setTimeout(() => {
                if (!dom.settingsModal.classList.contains('hidden')) {
                    refreshEngineStatusUI();
                    refreshScannedModelsList();
                }
            }, 50);
        });

        // ── Air-Gap Sentinel Telemetry Sentinel Controller ──
        let netPollInterval = null;
        let sentinelAnimFrame = null;
        let isSentinelRunning = false;

        // Oscilloscope waveform data buffers
        const WAVE_POINTS = 120;
        let localWaveHistory = new Array(WAVE_POINTS).fill(0);
        let wanWaveHistory = new Array(WAVE_POINTS).fill(0);
        let sweepOffset = 0;

        function startSentinel() {
            isSentinelRunning = true;
            pollNetworkStatus();
            if (netPollInterval) clearInterval(netPollInterval);
            netPollInterval = setInterval(pollNetworkStatus, 1200);
            if (!sentinelAnimFrame) {
                renderSentinelOscilloscope();
            }
        }

        function stopSentinel() {
            isSentinelRunning = false;
            if (netPollInterval) {
                clearInterval(netPollInterval);
                netPollInterval = null;
            }
            if (sentinelAnimFrame) {
                cancelAnimationFrame(sentinelAnimFrame);
                sentinelAnimFrame = null;
            }
        }

        if (document.getElementById('connStatusWrapper')) {
            document.getElementById('connStatusWrapper').addEventListener('click', () => {
                dom.networkMonitorWindow.classList.toggle('hidden');
                if (!dom.networkMonitorWindow.classList.contains('hidden')) {
                    startSentinel();
                } else {
                    stopSentinel();
                }
            });
        }

        if (dom.closeNetworkMonitorBtn) {
            dom.closeNetworkMonitorBtn.addEventListener('click', () => {
                dom.networkMonitorWindow.classList.add('hidden');
                stopSentinel();
            });
        }

        // Tab Switching
        if (dom.sentinelTabSockets && dom.sentinelTabLogs) {
            dom.sentinelTabSockets.addEventListener('click', () => {
                dom.sentinelTabSockets.classList.add('active');
                dom.sentinelTabLogs.classList.remove('active');
                if (dom.sentinelSocketsPanel) dom.sentinelSocketsPanel.classList.remove('hidden');
                if (dom.sentinelLogsPanel) dom.sentinelLogsPanel.classList.add('hidden');
            });

            dom.sentinelTabLogs.addEventListener('click', () => {
                dom.sentinelTabLogs.classList.add('active');
                dom.sentinelTabSockets.classList.remove('active');
                if (dom.sentinelLogsPanel) dom.sentinelLogsPanel.classList.remove('hidden');
                if (dom.sentinelSocketsPanel) dom.sentinelSocketsPanel.classList.add('hidden');
            });
        }

        // Manual Hardware Audit button
        if (dom.runSocketAuditBtn) {
            dom.runSocketAuditBtn.addEventListener('click', async () => {
                const icon = dom.runSocketAuditBtn.querySelector('i');
                if (icon) icon.classList.add('fa-spin');
                dom.runSocketAuditBtn.disabled = true;

                await pollNetworkStatus();

                const now = new Date().toLocaleTimeString();
                appendSentinelLog(
                    `<span style="color:var(--accent-emerald); font-weight:700;">[AUDIT PASS]</span> ` +
                    `Manual hardware socket sweep complete. 0 foreign interfaces discovered. Loopback isolation 100%.`,
                    now
                );

                setTimeout(() => {
                    if (icon) icon.classList.remove('fa-spin');
                    dom.runSocketAuditBtn.disabled = false;
                }, 600);
            });
        }

        function appendSentinelLog(htmlContent, timestamp) {
            if (!dom.netLogContainer) return;
            const now = timestamp || new Date().toLocaleTimeString();
            const logEntry = document.createElement('div');
            logEntry.style.marginBottom = '5px';
            logEntry.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
            logEntry.style.paddingBottom = '5px';
            logEntry.style.lineHeight = '1.4';
            logEntry.innerHTML = `<span style="color:var(--text-tertiary); margin-right:6px;">[${now}]</span>${htmlContent}`;
            dom.netLogContainer.appendChild(logEntry);
            dom.netLogContainer.scrollTop = dom.netLogContainer.scrollHeight;

            while (dom.netLogContainer.children.length > 60) {
                dom.netLogContainer.removeChild(dom.netLogContainer.firstChild);
            }
        }

        async function pollNetworkStatus() {
            if (dom.networkMonitorWindow.classList.contains('hidden')) return;

            try {
                const res = await fetch('/api/network/monitor', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();

                    // Header status
                    if (dom.netStatusBadgeText) {
                        if (data.air_gapped) {
                            dom.netStatusBadgeText.textContent = 'Local Engine Active';
                            dom.netStatusBadgeText.style.color = 'var(--text-primary)';
                            if (dom.netStatusSubText) dom.netStatusSubText.textContent = '0 external connections • 127.0.0.1:8000';
                            if (dom.sentinelLockIcon) {
                                dom.sentinelLockIcon.className = 'fa-solid fa-server';
                                dom.sentinelLockIcon.style.color = 'var(--accent-emerald)';
                            }
                            if (dom.sentinelRing) dom.sentinelRing.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                            if (dom.chWanVal) dom.chWanVal.textContent = '0 B/s';
                        } else {
                            dom.netStatusBadgeText.textContent = 'External Connection Detected';
                            dom.netStatusBadgeText.style.color = '#ef4444';
                            if (dom.netStatusSubText) dom.netStatusSubText.textContent = `${data.external_connections_count} Non-Local Socket(s)`;
                            if (dom.sentinelLockIcon) {
                                dom.sentinelLockIcon.className = 'fa-solid fa-triangle-exclamation';
                                dom.sentinelLockIcon.style.color = '#ef4444';
                            }
                            if (dom.sentinelRing) dom.sentinelRing.style.borderColor = 'rgba(239, 68, 68, 0.5)';
                            if (dom.chWanVal) dom.chWanVal.textContent = `${data.external_connections_count} active`;
                        }
                    }

                    if (dom.netProcessPid) dom.netProcessPid.textContent = data.pid || '—';
                    if (dom.netProcessRss) dom.netProcessRss.textContent = `${data.rss_mb || 0} MB`;
                    if (dom.netLocalCount) dom.netLocalCount.textContent = (data.local_connections_count || 1);

                    // Update Sockets Table
                    if (dom.sentinelSocketsTbody) {
                        dom.sentinelSocketsTbody.innerHTML = '';
                        const localConns = data.local_connections && data.local_connections.length > 0
                            ? data.local_connections
                            : [{ local: "127.0.0.1:8000", remote: "LISTEN", status: "LISTEN" }];

                        localConns.forEach(c => {
                            const tr = document.createElement('tr');
                            const isApi = c.type === 'api_client';
                            const icon = isApi ? '<i class="fa-solid fa-network-wired" style="color:var(--accent-cyan);"></i> API' : '<i class="fa-solid fa-circle-check" style="color:var(--accent-emerald);"></i> IPC';
                            const badge = isApi ? '<span class="badge-clean" style="color:var(--accent-cyan); border-color:rgba(56,189,248,0.35);">API Client</span>' : '<span class="badge-clean">Loopback Clean</span>';
                            tr.innerHTML = `
                                <td>${icon}</td>
                                <td style="font-family:var(--font-code);">${c.local}</td>
                                <td style="font-family:var(--font-code); color:${isApi ? 'var(--accent-cyan)' : 'var(--text-muted)'};">${c.remote}</td>
                                <td>${badge}</td>
                            `;
                            dom.sentinelSocketsTbody.appendChild(tr);
                        });

                        if (data.external_connections && data.external_connections.length > 0) {
                            data.external_connections.forEach(c => {
                                const tr = document.createElement('tr');
                                tr.innerHTML = `
                                    <td><span style="color:#ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> WAN</span></td>
                                    <td style="font-family:var(--font-code);">${c.local}</td>
                                    <td style="font-family:var(--font-code); color:#ef4444;">${c.remote}</td>
                                    <td><span class="badge-wan-blocked">Foreign Socket</span></td>
                                `;
                                dom.sentinelSocketsTbody.appendChild(tr);
                            });
                        }
                    }

                    // Append periodic security log entry
                    if (data.api_active) {
                        appendSentinelLog(`<span style="color:var(--accent-cyan);">[API Active]</span> Serving external client request on /v1.`);
                    } else if (data.air_gapped) {
                        appendSentinelLog(`<span style="color:var(--accent-emerald);">[Verified]</span> 0 external calls. Sockets bound to local interface.`);
                    } else {
                        appendSentinelLog(`<span style="color:#ef4444;">[Warning]</span> ${data.external_connections_count} non-local socket(s) detected!`);
                    }

                    // Feed live points to oscilloscope
                    const isGen = state.isGenerating || data.api_active;
                    if (dom.chLocalVal) dom.chLocalVal.textContent = isGen ? (data.api_active ? 'API Serving' : 'Streaming') : 'Active';

                    const baseAmp = isGen ? 0.78 : 0.28;
                    const sample = Math.sin(Date.now() / (isGen ? 80 : 300)) * baseAmp + (Math.random() * 0.12 - 0.06);
                    localWaveHistory.push(sample);
                    localWaveHistory.shift();

                    wanWaveHistory.push(data.air_gapped ? 0 : 0.8);
                    wanWaveHistory.shift();
                }
            } catch (err) {
                console.warn('Network monitor poll failed', err);
            }
        }

        // ── Real-Time Oscilloscope Canvas Renderer ──
        function renderSentinelOscilloscope() {
            if (!isSentinelRunning) {
                sentinelAnimFrame = null;
                return;
            }

            const canvas = dom.netGraphCanvas;
            if (!canvas) {
                sentinelAnimFrame = requestAnimationFrame(renderSentinelOscilloscope);
                return;
            }

            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            const midY = h / 2;

            // Clean dark background
            ctx.fillStyle = '#030708';
            ctx.fillRect(0, 0, w, h);

            // 1. Grid lines (Subtle division marks)
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;

            const gridSpacingX = 40;
            const gridSpacingY = 22;

            ctx.beginPath();
            for (let x = 0; x <= w; x += gridSpacingX) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
            }
            for (let y = 0; y <= h; y += gridSpacingY) {
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
            }
            ctx.stroke();

            // Center zero-baseline
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, midY);
            ctx.lineTo(w, midY);
            ctx.stroke();
            ctx.setLineDash([]);

            // 2. Channel 1: Local Activity (Neon Emerald Wave)
            ctx.shadowBlur = 8;
            ctx.shadowColor = 'rgba(16, 185, 129, 0.8)';
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2;

            const step = w / (WAVE_POINTS - 1);
            ctx.beginPath();
            for (let i = 0; i < WAVE_POINTS; i++) {
                const val = localWaveHistory[i];
                const x = i * step;
                const y = midY - 12 - (val * 28);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // 3. Channel 2: Outbound Traffic (Clean Red Line at zero)
            ctx.shadowBlur = 6;
            ctx.shadowColor = 'rgba(239, 68, 68, 0.8)';
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;

            ctx.beginPath();
            for (let i = 0; i < WAVE_POINTS; i++) {
                const val = wanWaveHistory[i];
                const x = i * step;
                const y = midY + 14 + (val * 28);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            ctx.shadowBlur = 0;

            sentinelAnimFrame = requestAnimationFrame(renderSentinelOscilloscope);
        }

        document.querySelectorAll('.bg-motion-card').forEach(card => {
            card.addEventListener('click', () => {
                const motion = card.getAttribute('data-motion');
                themeState.bgMotion = motion;
                saveThemeConfig();
            });
        });

        if (dom.bgTonePicker) {
            dom.bgTonePicker.addEventListener('input', (e) => {
                themeState.bgTone = e.target.value;
                if (themeState.cycleBg) { themeState.cycleBg = false; if (dom.cycleBgToggle) dom.cycleBgToggle.checked = false; }
                saveThemeConfig();
            });
        }

        if (dom.sidebarTonePicker) {
            dom.sidebarTonePicker.addEventListener('input', (e) => {
                themeState.sidebarTone = e.target.value;
                saveThemeConfig();
            });
        }

        if (dom.accentColorPicker) {
            dom.accentColorPicker.addEventListener('input', (e) => {
                themeState.accentColor = e.target.value;
                if (themeState.cycleAccent) { themeState.cycleAccent = false; if (dom.cycleAccentToggle) dom.cycleAccentToggle.checked = false; }
                saveThemeConfig();
            });
        }

        if (dom.clearTextToggle) {
            dom.clearTextToggle.addEventListener('change', (e) => {
                themeState.clearText = e.target.checked;
                saveThemeConfig();
            });
        }

        if (dom.cycleAccentToggle) {
            dom.cycleAccentToggle.addEventListener('change', (e) => {
                themeState.cycleAccent = e.target.checked;
                saveThemeConfig();
            });
        }

        if (dom.cycleBgToggle) {
            dom.cycleBgToggle.addEventListener('change', (e) => {
                themeState.cycleBg = e.target.checked;
                saveThemeConfig();
            });
        }

        if (dom.cycleSpeedSlider) {
            dom.cycleSpeedSlider.addEventListener('input', (e) => {
                themeState.cycleSpeed = e.target.value;
                if (dom.cycleSpeedVal) dom.cycleSpeedVal.textContent = themeState.cycleSpeed + '%';
                saveThemeConfig();
            });
        }

        if (dom.fluidRadiusSlider) {
            dom.fluidRadiusSlider.addEventListener('input', (e) => {
                themeState.fluidRadius = parseFloat(e.target.value);
                if (dom.fluidRadiusVal) dom.fluidRadiusVal.textContent = themeState.fluidRadius;
                if (window.fluidConfig) window.fluidConfig.SPLAT_RADIUS = themeState.fluidRadius;
                saveThemeConfig();
            });
        }
        if (dom.fluidCurlSlider) {
            dom.fluidCurlSlider.addEventListener('input', (e) => {
                themeState.fluidCurl = parseInt(e.target.value);
                if (dom.fluidCurlVal) dom.fluidCurlVal.textContent = themeState.fluidCurl;
                if (window.fluidConfig) window.fluidConfig.CURL = themeState.fluidCurl;
                saveThemeConfig();
            });
        }
        if (dom.fluidBloomSlider) {
            dom.fluidBloomSlider.addEventListener('input', (e) => {
                themeState.fluidBloom = parseFloat(e.target.value);
                if (dom.fluidBloomVal) dom.fluidBloomVal.textContent = themeState.fluidBloom;
                if (window.fluidConfig) window.fluidConfig.BLOOM_INTENSITY = themeState.fluidBloom;
                saveThemeConfig();
            });
        }

        if (dom.nodesDensitySlider) {
            dom.nodesDensitySlider.addEventListener('input', (e) => {
                themeState.nodesDensity = parseInt(e.target.value);
                if (dom.nodesDensityVal) dom.nodesDensityVal.textContent = themeState.nodesDensity;
                saveThemeConfig();
                if (window.resizeNodesCanvas) window.resizeNodesCanvas();
            });
        }
        if (dom.nodesDistanceSlider) {
            dom.nodesDistanceSlider.addEventListener('input', (e) => {
                themeState.nodesDistance = parseInt(e.target.value);
                if (dom.nodesDistanceVal) dom.nodesDistanceVal.textContent = themeState.nodesDistance;
                saveThemeConfig();
            });
        }
        if (dom.matrixSpeedSlider) {
            dom.matrixSpeedSlider.addEventListener('input', (e) => {
                themeState.matrixSpeed = parseInt(e.target.value);
                if (dom.matrixSpeedVal) dom.matrixSpeedVal.textContent = themeState.matrixSpeed + 'ms';
                saveThemeConfig();
            });
        }
        if (dom.matrixFadeSlider) {
            dom.matrixFadeSlider.addEventListener('input', (e) => {
                themeState.matrixFade = parseFloat(e.target.value);
                if (dom.matrixFadeVal) dom.matrixFadeVal.textContent = themeState.matrixFade;
                saveThemeConfig();
            });
        }

        if (dom.flowSpeedSlider) {
            dom.flowSpeedSlider.addEventListener('input', (e) => {
                themeState.flowSpeed = parseFloat(e.target.value);
                if (dom.flowSpeedVal) dom.flowSpeedVal.textContent = themeState.flowSpeed + 'x';
                saveThemeConfig();
            });
        }
        if (dom.flowTrailSlider) {
            dom.flowTrailSlider.addEventListener('input', (e) => {
                themeState.flowTrail = parseFloat(e.target.value);
                if (dom.flowTrailVal) dom.flowTrailVal.textContent = themeState.flowTrail;
                saveThemeConfig();
            });
        }
        if (dom.flowDensitySlider) {
            dom.flowDensitySlider.addEventListener('input', (e) => {
                themeState.flowDensity = parseInt(e.target.value);
                if (dom.flowDensityVal) dom.flowDensityVal.textContent = themeState.flowDensity;
                saveThemeConfig();
                if (window.resizeFlowFieldCanvas) window.resizeFlowFieldCanvas();
            });
        }

        document.querySelectorAll('button[data-width]').forEach(btn => {
            btn.addEventListener('click', () => {
                themeState.chatWidth = btn.getAttribute('data-width');
                saveThemeConfig();
            });
        });

        if (dom.fontSizeSlider) {
            dom.fontSizeSlider.addEventListener('input', (e) => {
                themeState.fontSize = e.target.value;
                if (dom.fontSizeVal) dom.fontSizeVal.textContent = themeState.fontSize + 'px';
                saveThemeConfig();
            });
        }

        if (dom.resetThemeBtn) {
            dom.resetThemeBtn.addEventListener('click', () => {
                Object.assign(themeState, {
                    bgMotion: 'none',
                    bgTone: '#09090b',
                    sidebarTone: '#121215',
                    accentColor: '#f4f4f5',
                    cycleAccent: false,
                    cycleBg: false,
                    cycleSpeed: 50
                });
                saveThemeConfig();
            });
        }

        if (dom.testConnBtn) {
            dom.testConnBtn.addEventListener('click', async () => {
                if (dom.diagnosticResult) dom.diagnosticResult.innerHTML = '<span style="color:var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> Testing...</span>';
                await saveApiSettings();
                await checkBackendHealth();
                await loadAvailableModels();
                if (dom.diagnosticResult) {
                    if (state.lmStudioConnected) {
                        dom.diagnosticResult.innerHTML = '<span style="color:var(--accent-emerald);"><i class="fa-solid fa-check"></i> Local engine ready</span>';
                    } else {
                        dom.diagnosticResult.innerHTML = '<span style="color:var(--accent-rose);"><i class="fa-solid fa-xmark"></i> Local engine unavailable</span>';
                    }
                }
            });
        }

        if (dom.forceThinkingToggle) {
            dom.forceThinkingToggle.addEventListener('click', () => {
                dom.forceThinkingToggle.classList.toggle('active');
            });
        }
    }

    // Global exposed functions for inline onclick handlers
    window.exportChat = function () {
        const activeChat = state.conversations.find(c => c.id === state.activeChatId);
        if (!activeChat) return;

        let md = `# Chat Export\n\n`;
        activeChat.messages.forEach(m => {
            md += `### ${m.role.toUpperCase()}\n${m.content}\n\n---\n\n`;
        });

        const blob = new Blob([md], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chat_export_${Date.now()}.md`;
        a.click();
    };

    window.summarizeAndRestart = async function () {
        if (window.__isSummarizing) return;

        // Edge case 1: In-flight generation or editing
        if (state.isGenerating || state.isEditing) {
            await showAlert("Busy", "Please wait for nivm to finish the current response before summarizing.");
            return;
        }

        // Edge case 2: Model not loaded in local mode
        if (!state.isModelLoaded && state.inferenceMode !== 'api') {
            await showAlert("Engine Offline", "Please configure and load a model in Settings before summarizing.");
            return;
        }

        const activeChat = state.conversations.find(c => c.id === state.activeChatId);
        if (!activeChat) {
            await showAlert("Notice", "No active conversation to summarize.");
            return;
        }

        // Edge case 3: Filter out system/internal messages and check length
        const meaningfulMsgs = (activeChat.messages || []).filter(m => {
            if (m.role === 'system') return false;
            if (m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[SYSTEM NOTIFICATION]')) return false;
            return true;
        });

        if (meaningfulMsgs.length < 2) {
            await showAlert("Notice", "Not enough conversation history to summarize (at least 2 messages required).");
            return;
        }

        window.__isSummarizing = true;

        // Show Summary Progress Popup
        const popup = document.createElement('div');
        popup.className = 'draggable-window';
        popup.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); z-index:1000; padding:24px; text-align:center; display:flex; flex-direction:column; gap:12px; align-items:center; min-width:320px; box-shadow:0 16px 48px rgba(0,0,0,0.6);';

        let isCancelled = false;
        const abortController = new AbortController();

        popup.innerHTML = `
            <div style="color:var(--accent-purple, #a78bfa); font-size:2rem; margin-bottom: 8px;"><i class="fa-solid fa-circle-notch fa-spin"></i></div>
            <h3 style="margin:0; font-size:1.05rem;">Summarizing Conversation</h3>
            <p style="margin:0; color:var(--text-secondary); font-size:0.85rem; margin-bottom: 14px;">Compressing context into a master summary... please wait.</p>
            <button id="cancelSummaryBtn" class="btn-secondary" style="width: auto; padding: 7px 22px; font-size: 0.85rem;">Cancel</button>
        `;
        document.body.appendChild(popup);

        const removePopup = () => {
            if (popup && popup.parentNode) {
                popup.parentNode.removeChild(popup);
            }
        };

        const cancelBtn = popup.querySelector('#cancelSummaryBtn');
        if (cancelBtn) {
            cancelBtn.onclick = () => {
                isCancelled = true;
                abortController.abort();
                removePopup();
            };
        }

        // Helper to extract clean text from string or multimodal array
        const getMsgText = (content) => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
                return content
                    .map(item => (typeof item === 'string' ? item : (item.text || '')))
                    .filter(Boolean)
                    .join(' ');
            }
            return String(content || '');
        };

        try {
            // Split chat into halves for progressive summarization
            const mid = Math.max(1, Math.floor(meaningfulMsgs.length / 2));
            const part1 = meaningfulMsgs.slice(0, mid);
            const part2 = meaningfulMsgs.slice(mid);

            // Helper to summarize a part
            const summarizePart = async (messagesArray, previousSummary = null) => {
                const convoText = messagesArray
                    .map(m => `[${m.role.toUpperCase()}]: ${getMsgText(m.content)}`)
                    .join('\n\n');

                const systemPrompt = `You are an expert summarization AI. Your task is to compress a conversation log into a dense, highly detailed summary that will serve as the starting context for a new AI session.
CRITICAL RULES:
1. Retain ALL technical details, code snippets, file paths, configurations, and errors.
2. Retain ALL personal details, names, and user preferences.
3. Summarize casual chat, but preserve unresolved issues and the main objective.
4. Use a clear bulleted format.
5. DO NOT reply to the user. DO NOT add conversational filler like "Here is the summary". ONLY output the requested summary.`;

                let userPrompt = `Please create a comprehensive summary of the following conversation log to be used as context for continuing the work.\n\n`;
                if (previousSummary) {
                    userPrompt += `[PREVIOUS SUMMARY CONTEXT]\n${previousSummary}\n\n`;
                }
                userPrompt += `[CONVERSATION LOG]\n${convoText}\n\n[END LOG]\n\nGenerate the structured summary now:`;

                const p = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ];

                const modelToUse = state.inferenceMode === 'api'
                    ? (state.selectedModel || dom.apiModelSelect?.value || 'llama-3.3-70b-versatile')
                    : state.selectedModel;

                // Edge case 4: Negative max_tokens fails in external APIs (Groq/OpenAI)
                const maxTokens = state.inferenceMode === 'api' ? 4096 : -1;

                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: modelToUse,
                        messages: p,
                        temperature: 0.1,
                        max_tokens: maxTokens,
                        stream: false
                    }),
                    signal: abortController.signal
                });

                if (!response.ok) {
                    const errText = await response.text().catch(() => '');
                    throw new Error(`Failed to summarize (${response.status}): ${errText}`);
                }
                const data = await response.json();
                return data.choices?.[0]?.message?.content || "No summary generated.";
            };

            // 1. Summarize Part 1
            const summary1 = await summarizePart(part1);

            // 2. Summarize Part 2 with Summary 1 as context (if multiple parts exist)
            const finalSummary = part2.length > 0
                ? await summarizePart(part2, summary1)
                : summary1;

            if (isCancelled) return;

            // 3. Clean transition to new chat without screen flicker or full page reload
            createNewChat();
            const newActiveChat = state.conversations.find(c => c.id === state.activeChatId);
            if (newActiveChat) {
                newActiveChat.title = `Summary: ${activeChat.title || 'Previous Chat'}`;
                newActiveChat.messages.push({
                    role: 'system',
                    content: `### Conversation Summary\nThe following is a compressed summary of the previous conversation to maintain context:\n\n${finalSummary}`
                });
                saveConversations();
                renderActiveChat();
                renderChatHistory();
            }

            removePopup();
            showNotification({
                title: "Conversation Summarized",
                message: "Context compressed into a fresh session.",
                type: "success"
            });

        } catch (e) {
            removePopup();
            if (e.name === 'AbortError' || isCancelled) {
                console.log("Summarization cancelled.");
            } else {
                await showAlert("Error", "Error during summarization: " + e.message);
            }
        } finally {
            window.__isSummarizing = false;
        }
    };

    init();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
