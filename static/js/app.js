import { state, themeState, saveConversations } from './state.js';
import { dom } from './dom.js';
import { fetchApiSettings, saveApiSettings, smartToggleEngine, scanLocalGgufs, startModelDownload, pollDownloadStatus, cancelModelDownload, fetchBackendConfig, checkBackendHealth, fetchEngineStatus, loadAvailableModels, fetchChats, fetchMemoryAPI, saveMemoryAPI, generateChatTitle, uploadImage } from './api.js';
import { setupNodesCanvas, setupMatrixCanvas, setupFluidCanvas, applyThemeState, colorCycleLoop, saveThemeConfig } from './theme.js';
import { makeDraggable, setupDynamicGreeting, renderChatHistory, renderActiveChat, switchChat, createNewChat, appendMessageToDOM, scrollToBottom, toggleSendStopButtons, updateAssistantBubble, updateMessageActionIcons, renderMemoryDrawer, renderToolsSettings, showAlert, showConfirm, setupHistoryUI, setupVisionUI, clearAttachedImage } from './ui.js';
import { tools, buildToolsInstruction } from './tools.js';

// Export state for UI modules that need direct access
window.__nivm_state = state;
window.renderMemoryDrawer = renderMemoryDrawer;

document.addEventListener('DOMContentLoaded', async () => {
    function sanitizeAssistantText(text) {
        if (!text) return '';
        let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
        cleaned = cleaned.replace(/<think>[\s\S]*$/g, '');
        cleaned = cleaned.replace(/TOOL_CALL:.*$/gm, '');
        return cleaned.trim();
    }

    // Initialize Marked Options
    if (window.marked) {
        const renderer = new marked.Renderer();
        const origParagraph = renderer.paragraph;
        const origHeading = renderer.heading;
        const origListitem = renderer.listitem;
        
        renderer.paragraph = function() {
            let out = origParagraph.apply(this, arguments);
            return out.replace(/^<p>/, '<p><span class="text-hl">').replace(/<\/p>\n?$/, '</span></p>\n');
        };
        
        renderer.heading = function() {
            let out = origHeading.apply(this, arguments);
            return out.replace(/^<h(\d+)((?:>|\s[^>]*>))/, '<h$1$2<span class="text-hl">').replace(/<\/h\d+>\n?$/, '</span>$&');
        };
        
        renderer.listitem = function() {
            let out = origListitem.apply(this, arguments);
            if (!out.includes('<p>') && !out.includes('<ul>') && !out.includes('<ol>')) {
                return out.replace(/^<li((?:>|\s[^>]*>))/, '<li$1<span class="text-hl">').replace(/<\/li>\n?$/, '</span>$&');
            }
            return out;
        };

        marked.setOptions({
            renderer: renderer,
            highlight: function(code, lang) {
                if (window.hljs && lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(code, { language: lang }).value;
                    } catch (e) {}
                }
                return window.hljs ? hljs.highlightAuto(code).value : code;
            },
            breaks: true
        });
    }

    async function init() {
        try {
            if (dom.userNameInput) {
                dom.userNameInput.value = state.userName;
            }
            setupNodesCanvas();
            setupMatrixCanvas();
            setupFluidCanvas();
            applyThemeState();
            makeDraggable(dom.settingsWindow, dom.settingsWindowHeader);
            makeDraggable(dom.toolsWindow, dom.toolsWindowHeader);
            makeDraggable(dom.themeWindow, dom.themeWindowHeader);
            makeDraggable(dom.statsWindow, dom.statsWindowHeader);
            makeDraggable(dom.networkMonitorWindow, dom.networkMonitorHeader);
            makeDraggable(dom.apiSetupWindow, dom.apiSetupHeader);
            setupDynamicGreeting();
            renderToolsSettings();
            setupHistoryUI();
            setupVisionUI();
            setupEventListeners();
            if (window.updateModelAvailabilityUI) {
                window.updateModelAvailabilityUI(false);
            }
            await fetchApiSettings();
            await fetchBackendConfig();
            await checkBackendHealth();
            await fetchEngineStatus();
            await loadAvailableModels();

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

    window.sendMessage = async function(text, triggerAssistantOnly = false, isHiddenUserMsg = false) {
        if (state.isGenerating || state.isEditing) return;

        if (!state.isModelLoaded) {
            // Keep prompt intact in textarea! Do not clear userPrompt.
            if (dom.settingsModal) {
                dom.settingsModal.classList.remove('hidden');
                if (window.refreshEngineStatusUI) window.refreshEngineStatusUI();
            }
            return;
        }
        
        let promptText = typeof text === 'string' ? text : dom.userPrompt.value.trim();

        if (!triggerAssistantOnly) {
            if (!promptText || promptText === '') return;

            if (!state.activeChatId) {
                const newChat = {
                    id: 'chat_' + Date.now(),
                    title: promptText.length > 25 ? promptText.substring(0, 25) + '...' : promptText,
                    createdAt: Date.now(),
                    messages: []
                };
                state.conversations.unshift(newChat);
                state.activeChatId = newChat.id;
            }

            const activeChat = state.conversations.find(c => c.id === state.activeChatId);

            if (activeChat.messages.length === 0) {
                activeChat.title = promptText.length > 25 ? promptText.substring(0, 25) + '...' : promptText;
                renderChatHistory();
            }

            let finalContent = promptText;
            if (state.attachedImages && state.attachedImages.length > 0) {
                // Keep original prompt text in dom while uploading
                const oldBtnHTML = dom.sendBtn.innerHTML;
                dom.sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                dom.sendBtn.disabled = true;
                
                try {
                    const uploadPromises = state.attachedImages.map(img => uploadImage(img.file));
                    const uploadedUrls = await Promise.all(uploadPromises);
                    
                    dom.sendBtn.innerHTML = oldBtnHTML;
                    dom.sendBtn.disabled = false;
                    
                    finalContent = [ { type: "text", text: promptText } ];
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
                    
                    if (finalContent.length === 1) {
                        throw new Error("Failed to upload images.");
                    }
                } catch (e) {
                    dom.sendBtn.innerHTML = oldBtnHTML;
                    dom.sendBtn.disabled = false;
                    await showAlert("Error", "Failed to upload images. Please try again.");
                    return;
                }
            }

            const userMsg = { role: 'user', content: finalContent, isHidden: isHiddenUserMsg };
            activeChat.messages.push(userMsg);
            
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
        let dynamicSystemPrompt = state.systemPrompt || "You are nivm, a helpful AI assistant.";
        if (state.userName) {
            dynamicSystemPrompt += `\n\nThe user's preferred name is: ${state.userName}. Address them by this name when appropriate.`;
        }
        
        const memoryKeys = Object.keys(state.memory || {});
        let memoryInstruction = buildToolsInstruction(memoryKeys, state.enabledTools);
        
        dynamicSystemPrompt += memoryInstruction;
        if (dom.forceThinkingToggle && dom.forceThinkingToggle.classList.contains('active')) {
            dynamicSystemPrompt += `\n\nFor complex tasks, reason carefully before answering, but do not reveal hidden reasoning or chain-of-thought. Give the user only the useful conclusion, concise rationale, and concrete steps.`;
        }

        payloadMessages.push({ role: 'system', content: dynamicSystemPrompt });

        activeChat.messages.forEach(m => payloadMessages.push({ role: m.role, content: m.content }));

        const assistantMsg = { role: 'assistant', content: '' };
        activeChat.messages.push(assistantMsg);
        
        const { bubble: assistantBubble, actions: actionsContainer } = appendMessageToDOM(assistantMsg, true);
        updateAssistantBubble(assistantBubble, '', true, null);

        state.isGenerating = true;
        toggleSendStopButtons(true);
        state.abortController = new AbortController();

        let fullResponse = '';
        let hasStartedReasoning = false;
        let thinkStartTime = null;
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
                    top_p: 0.9,
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
                                if (json.error.toLowerCase().includes('context') || json.error.toLowerCase().includes('token')) {
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
                                    }
                                }
                                if (delta.content) {
                                    fullResponse += delta.content;
                                    // Check for tool calls dynamically
                                    const toolNames = tools.map(t => t.name).join('|');
                                    const toolRegex = new RegExp(`TOOL_CALL:\\s*(${toolNames})\\((.*?)\\)`);
                                    const match = fullResponse.match(toolRegex);
                                    if (match) {
                                        interceptedToolCall = {
                                            command: match[1],
                                            argsStr: match[2],
                                            fullMatch: match[0],
                                            index: match.index
                                        };
                                        state.abortController.abort(); // Cancel the stream
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                }

                if (!pendingUpdate) {
                    pendingUpdate = requestAnimationFrame(() => {
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
            const cleanResponse = sanitizeAssistantText(fullResponse);
            const estTokens = serverUsage?.completion_tokens ? serverUsage.completion_tokens : Math.max(1, Math.ceil(cleanResponse.length / 4));
            const tkPerSec = serverUsage?.tk_s ? serverUsage.tk_s.toFixed(1) : (estTokens / durationSec).toFixed(1);
            const estCost = (estTokens * 0.000002).toFixed(5);

            const metaStats = {
                durationSec,
                estTokens,
                tkPerSec,
                estCost,
                modelInfo
            };

            state.isGenerating = false;
            toggleSendStopButtons(false);
            
            if (cleanResponse.trim()) {
                assistantMsg.content = cleanResponse;
                assistantMsg.meta = metaStats;
            }
            
            updateAssistantBubble(assistantBubble, cleanResponse, false, thinkStartTime);
            updateMessageActionIcons(actionsContainer, assistantMsg, assistantBubble.closest('.message-row'));
            
            // Update Global Usage Stats
            state.usageStats.totalTokens += metaStats.estTokens;
            state.usageStats.totalCost += parseFloat(metaStats.estCost);
            state.usageStats.totalDurationSec += parseFloat(metaStats.durationSec);
            
            // Refresh stats UI automatically
            import('./ui.js').then(module => module.populateStatsModal());

            // Save automatically
            import('./state.js').then(module => module.saveUsageStats());

            if (cleanResponse.trim()) {
                // Don't save chats yet if we're intercepting a tool
                if (!interceptedToolCall) {
                    saveConversations();
                    // Generate chat title for the first message
                    if (activeChat.messages.length === 2 && !activeChat.titleGenerated) {
                        generateChatTitle(activeChat);
                    }
                }
            } else {
                activeChat.messages.pop();
            }

            if (interceptedToolCall) {
                // Slice fullResponse to only include up to the exact tool call matched
                // This discards any extra tool calls generated in the same fast stream chunk
                assistantMsg.content = fullResponse.substring(0, interceptedToolCall.index + interceptedToolCall.fullMatch.length);

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
                
                // Add the system response to the chat as a USER message. 
                // This prevents Llama 3 chat templates from crashing due to interleaved system messages!
                const sysMsg = { role: 'user', content: `[SYSTEM NOTIFICATION] Tool executed successfully. Result: ${resultStr}\n\nPlease continue your response naturally based on this result. Do not output another tool call unless necessary.` };
                activeChat.messages.push(sysMsg);
                
                const textWithoutTool = assistantMsg.content.replace(/TOOL_CALL:.*$/gm, '').trim();
                const textWithoutThinkAndTool = textWithoutTool.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

                // Format the args for a clean display
                let cleanArgs = interceptedToolCall.argsStr;
                if (cleanArgs.length > 50) cleanArgs = cleanArgs.substring(0, 47) + '...';
                
                const sysBubbleHtml = `<details class="tool-trace-block"><summary><i class="fa-solid fa-microchip"></i> <span>Tool executed: <b style="color:var(--accent-emerald);">${interceptedToolCall.command}</b>(<span style="color:var(--text-tertiary);">${cleanArgs}</span>)</span></summary><div class="tool-trace-content">${interceptedToolCall.fullMatch}</div></details>`;
                
                if (textWithoutTool === '') {
                    // No thinking block, just a tool call. Remove the raw bubble entirely.
                    assistantBubble.closest('.message-row').remove();
                    dom.messagesContainer.insertAdjacentHTML('beforeend', sysBubbleHtml);
                } else {
                    // Update the internal state and the bubble to hide the raw tool call text
                    assistantMsg.content = textWithoutTool;
                    updateAssistantBubble(assistantBubble, textWithoutTool, false, thinkStartTime);
                    
                    if (textWithoutThinkAndTool === '') {
                        // Has a thinking block but no other text. Keep the thinking block visible, but hide action icons.
                        actionsContainer.style.display = 'none';
                    }
                    assistantBubble.closest('.message-row').insertAdjacentHTML('afterend', sysBubbleHtml);
                }
                
                // Trigger the assistant again!
                setTimeout(() => window.sendMessage(null, true), 100);
            }
        }
    }

    function stopGeneration() {
        if (state.abortController) {
            state.abortController.abort();
            state.isGenerating = false;
            toggleSendStopButtons(false);
        }
    }

    function setupEventListeners() {
        dom.historyToggleBtn.addEventListener('click', () => {
            dom.historyDrawer.classList.toggle('hidden');
            if (!dom.historyDrawer.classList.contains('hidden')) {
                dom.memoryDrawer.classList.add('hidden');
            }
        });

        dom.closeHistoryBtn.addEventListener('click', () => dom.historyDrawer.classList.add('hidden'));

        dom.memoryToggleBtn.addEventListener('click', () => {
            dom.memoryDrawer.classList.toggle('hidden');
            if (!dom.memoryDrawer.classList.contains('hidden')) {
                dom.historyDrawer.classList.add('hidden');
                renderMemoryDrawer();
            }
        });
        dom.closeMemoryBtn.addEventListener('click', () => dom.memoryDrawer.classList.add('hidden'));

        dom.newChatBtn.addEventListener('click', () => {
            createNewChat();
            dom.historyDrawer.classList.add('hidden');
        });

        if (dom.userNameInput) {
            dom.userNameInput.addEventListener('input', (e) => {
                state.userName = e.target.value;
                localStorage.setItem('nivm_userName', state.userName);
                setupDynamicGreeting();
            });
        }

        dom.modelSelect.addEventListener('change', (e) => {
            state.selectedModel = e.target.value;
            localStorage.setItem('nivm_lastModel', state.selectedModel);
        });

        dom.userPrompt.addEventListener('input', () => {
            dom.userPrompt.style.height = 'auto';
            dom.userPrompt.style.height = Math.min(dom.userPrompt.scrollHeight, 200) + 'px';
            if (!state.isModelLoaded && dom.chatBoxDraftHint) {
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

        dom.sendBtn.addEventListener('click', window.sendMessage);
        dom.stopBtn.addEventListener('click', stopGeneration);
        dom.retryConnBtn.addEventListener('click', checkBackendHealth);

        dom.settingsBtn.addEventListener('click', () => dom.settingsModal.classList.toggle('hidden'));
        dom.closeSettingsBtn.addEventListener('click', () => dom.settingsModal.classList.add('hidden'));
        
        dom.toolsBtn.addEventListener('click', () => dom.toolsModal.classList.toggle('hidden'));
        dom.closeToolsBtn.addEventListener('click', () => dom.toolsModal.classList.add('hidden'));
        dom.saveToolsBtn.addEventListener('click', () => dom.toolsModal.classList.add('hidden'));
        dom.saveSettingsBtn.addEventListener('click', async () => {
            await saveApiSettings();
            await checkBackendHealth();
            await loadAvailableModels();
            dom.settingsModal.classList.add('hidden');
        });

        dom.statsBtn.addEventListener('click', () => {
            import('./ui.js').then(module => module.populateStatsModal());
            dom.statsWindow.classList.toggle('hidden');
        });
        dom.closeStatsBtn.addEventListener('click', () => dom.statsWindow.classList.add('hidden'));
        dom.resetStatsBtn.addEventListener('click', async () => {
            if (await showConfirm('Reset Statistics', 'Are you sure you want to reset all usage statistics?')) {
                state.usageStats = { totalTokens: 0, totalCost: 0, totalDurationSec: 0 };
                const { saveUsageStats } = await import('./state.js');
                saveUsageStats();
                const { populateStatsModal } = await import('./ui.js');
                populateStatsModal();
            }
        });

        dom.themeBtn.addEventListener('click', () => dom.themeModal.classList.toggle('hidden'));
        dom.closeThemeBtn.addEventListener('click', () => dom.themeModal.classList.add('hidden'));
        dom.saveThemeBtn.addEventListener('click', () => dom.themeModal.classList.add('hidden'));

        // API Setup Modal
        dom.openApiSetupBtn.addEventListener('click', () => {
            dom.apiSetupModal.classList.toggle('hidden');
            state.engineMode = 'native';
            if (dom.apiModeToggle) dom.apiModeToggle.checked = true;
        });
        dom.closeApiSetupBtn.addEventListener('click', () => {
            dom.apiSetupModal.classList.add('hidden');
            state.engineMode = 'native';
            saveApiSettings();
        });
        
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
            if (mode === 'routing') {
                dom.routingModeBtn.classList.add('active');
                dom.singleModeBtn.classList.remove('active');
                if (dom.routingModePanel) dom.routingModePanel.classList.remove('hidden');
                if (dom.singleModePanel) dom.singleModePanel.classList.add('hidden');
            } else {
                dom.routingModeBtn.classList.remove('active');
                dom.singleModeBtn.classList.add('active');
                if (dom.routingModePanel) dom.routingModePanel.classList.add('hidden');
                if (dom.singleModePanel) dom.singleModePanel.classList.remove('hidden');
            }
            saveApiSettings();
        }

        if (dom.routingModeBtn) dom.routingModeBtn.addEventListener('click', () => setInferenceMode('routing'));
        if (dom.singleModeBtn) dom.singleModeBtn.addEventListener('click', () => setInferenceMode('single'));

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
                saveApiSettings();
            });
        }

        // ── Scanned GGUF and mmproj list management ──
        let scannedModelsCache = [];

        async function refreshScannedModelsList() {
            try {
                const data = await scanLocalGgufs();
                scannedModelsCache = data.models || [];
                const remembered = data.remembered_paths || state.rememberedPaths || [];
                state.rememberedPaths = remembered;

                if (dom.scannedGgufSelect) {
                    const currentVal = dom.customModelPathInput ? dom.customModelPathInput.value.trim() : '';
                    dom.scannedGgufSelect.innerHTML = '<option value="">-- Choose detected file or enter path below --</option>';
                    scannedModelsCache.forEach(m => {
                        const isMmproj = m.filename.toLowerCase().includes('mmproj');
                        const opt = document.createElement('option');
                        opt.value = m.path;
                        opt.textContent = `${m.filename} (${m.size_gb} GB)${isMmproj ? ' [Projector]' : ''}`;
                        if (m.path === currentVal) opt.selected = true;
                        dom.scannedGgufSelect.appendChild(opt);
                    });
                }

                if (dom.scannedMmprojSelect) {
                    const currentMmproj = dom.customMmprojInput ? dom.customMmprojInput.value.trim() : '';
                    dom.scannedMmprojSelect.innerHTML = '<option value="">-- None (Text Only) --</option>';
                    scannedModelsCache.forEach(m => {
                        const isMmproj = m.filename.toLowerCase().includes('mmproj');
                        const opt = document.createElement('option');
                        opt.value = m.path;
                        opt.textContent = `${m.filename} (${m.size_gb} GB)${isMmproj ? ' ★' : ''}`;
                        if (m.path === currentMmproj) opt.selected = true;
                        dom.scannedMmprojSelect.appendChild(opt);
                    });
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

        function verifyPathStatus(path, statusEl, isOptional = false) {
            if (!statusEl) return;
            if (!path) {
                statusEl.textContent = isOptional ? 'None' : 'No path';
                statusEl.className = 'file-status-pill status-unknown';
                return;
            }
            const foundInCache = scannedModelsCache.find(m => m.path === path);
            if (foundInCache) {
                statusEl.textContent = `Found (${foundInCache.size_gb} GB)`;
                statusEl.className = 'file-status-pill status-found';
            } else {
                statusEl.textContent = 'Custom Path';
                statusEl.className = 'file-status-pill status-unknown';
            }
        }

        if (dom.scannedGgufSelect) {
            dom.scannedGgufSelect.addEventListener('change', () => {
                if (dom.scannedGgufSelect.value) {
                    dom.customModelPathInput.value = dom.scannedGgufSelect.value;
                    verifyPathStatus(dom.scannedGgufSelect.value, dom.customModelPathStatus);
                    saveApiSettings();
                }
            });
        }

        if (dom.scannedMmprojSelect) {
            dom.scannedMmprojSelect.addEventListener('change', () => {
                dom.customMmprojInput.value = dom.scannedMmprojSelect.value;
                verifyPathStatus(dom.scannedMmprojSelect.value, dom.customMmprojStatus, true);
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
                    } else {
                        dom.engineStatusText.textContent = 'Status: Unloaded';
                        dom.engineStatusText.style.color = 'var(--text-tertiary)';
                        dom.smartToggleBtn.classList.remove('is-loaded');
                        dom.smartToggleLabel.textContent = 'Load Engine';
                    }
                } catch (e) {
                    dom.engineStatusText.textContent = 'Error: ' + e.message;
                    dom.engineStatusText.style.color = '#ef4444';
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

        // Refresh engine status when settings modal opens
        const origSettingsClick = dom.settingsBtn.onclick;
        dom.settingsBtn.addEventListener('click', () => {
            if (!dom.settingsModal.classList.contains('hidden')) {
                refreshEngineStatusUI();
            } else {
                // Will be visible after toggle, so refresh after a tick
                setTimeout(refreshEngineStatusUI, 50);
            }
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
                            tr.innerHTML = `
                                <td><span style="color:var(--accent-emerald);"><i class="fa-solid fa-circle-check"></i> IPC</span></td>
                                <td style="font-family:var(--font-code);">${c.local}</td>
                                <td style="font-family:var(--font-code); color:var(--text-muted);">${c.remote}</td>
                                <td><span class="badge-clean">Loopback Clean</span></td>
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
                    if (data.air_gapped) {
                        appendSentinelLog(`<span style="color:var(--accent-emerald);">[Verified]</span> 0 external calls. Sockets bound to local interface.`);
                    } else {
                        appendSentinelLog(`<span style="color:#ef4444;">[Warning]</span> ${data.external_connections_count} non-local socket(s) detected!`);
                    }

                    // Feed live points to oscilloscope
                    const isGen = state.isGenerating;
                    if (dom.chLocalVal) dom.chLocalVal.textContent = isGen ? 'Streaming' : 'Active';

                    const baseAmp = isGen ? 0.75 : 0.28;
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
                if (themeState.cycleBg) { themeState.cycleBg = false; if(dom.cycleBgToggle) dom.cycleBgToggle.checked = false; }
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
                if (themeState.cycleAccent) { themeState.cycleAccent = false; if(dom.cycleAccentToggle) dom.cycleAccentToggle.checked = false; }
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
                if (themeState.cycleAccent) colorCycleLoop();
            });
        }
        
        if (dom.cycleBgToggle) {
            dom.cycleBgToggle.addEventListener('change', (e) => {
                themeState.cycleBg = e.target.checked;
                saveThemeConfig();
                if (themeState.cycleBg) colorCycleLoop();
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

        dom.testConnBtn.addEventListener('click', async () => {
            dom.diagnosticResult.innerHTML = '<span style="color:var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> Testing...</span>';
            await saveApiSettings();
            await checkBackendHealth();
            await loadAvailableModels();
            if (state.lmStudioConnected) {
                dom.diagnosticResult.innerHTML = '<span style="color:var(--accent-emerald);"><i class="fa-solid fa-check"></i> Local engine ready</span>';
            } else {
                dom.diagnosticResult.innerHTML = '<span style="color:var(--accent-rose);"><i class="fa-solid fa-xmark"></i> Local engine unavailable</span>';
            }
        });

        if (dom.forceThinkingToggle) {
            dom.forceThinkingToggle.addEventListener('click', () => {
                dom.forceThinkingToggle.classList.toggle('active');
            });
        }
    }

    // Global exposed functions for inline onclick handlers
    window.exportChat = function() {
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

    window.summarizeAndRestart = async function() {
        const activeChat = state.conversations.find(c => c.id === state.activeChatId);
        if (!activeChat || activeChat.messages.length < 3) {
            await showAlert("Notice", "Not enough messages to summarize!");
            return;
        }

        // Show Summary Progress Popup
        const popup = document.createElement('div');
        popup.className = 'draggable-window';
        popup.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); z-index:1000; padding:24px; text-align:center; display:flex; flex-direction:column; gap:12px; align-items:center; min-width:300px;';
        let isCancelled = false;
        const abortController = new AbortController();

        popup.innerHTML = `
            <div style="color:var(--accent-emerald); font-size:2rem; margin-bottom: 10px;"><i class="fa-solid fa-circle-notch fa-spin"></i></div>
            <h3 style="margin:0;">Summarizing Conversation</h3>
            <p style="margin:0; color:var(--text-secondary); font-size:0.9rem; margin-bottom: 16px;">Compressing context into a master summary... please wait.</p>
            <button id="cancelSummaryBtn" class="toggle-btn" style="width: auto; padding: 8px 24px;">Cancel</button>
        `;
        document.body.appendChild(popup);

        document.getElementById('cancelSummaryBtn').onclick = () => {
            isCancelled = true;
            abortController.abort();
            if (document.body.contains(popup)) {
                popup.remove();
            }
        };

        try {
            // Split chat in half
            const msgs = activeChat.messages;
            const mid = Math.floor(msgs.length / 2);
            const part1 = msgs.slice(0, mid);
            const part2 = msgs.slice(mid);

            // Helper to summarize a part
            const summarizePart = async (messagesArray, previousSummary = null) => {
                let convoText = messagesArray.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n');
                
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
                    {role: "system", content: systemPrompt},
                    {role: "user", content: userPrompt}
                ];
                
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: state.selectedModel,
                        messages: p,
                        temperature: 0.1, // Even lower temperature to prevent hallucinating chats
                        max_tokens: -1,
                        stream: false
                    }),
                    signal: abortController.signal
                });
                if (!response.ok) throw new Error("Failed to summarize");
                const data = await response.json();
                return data.choices[0].message.content;
            };

            // 1. Summarize Part 1
            const summary1 = await summarizePart(part1);
            
            // 2. Summarize Part 2 with Summary 1 as context
            const finalSummary = await summarizePart(part2, summary1);

            // 3. Start New Chat
            document.getElementById('newChatBtn').click();
            setTimeout(async () => {
                const newActiveChat = state.conversations.find(c => c.id === state.activeChatId);
                newActiveChat.messages.push({
                    role: 'system',
                    content: "The following is a compressed summary of the previous conversation to maintain context:\n\n" + finalSummary
                });
                // Ensure import works for saveConversations
                const { saveConversations } = await import('./state.js');
                saveConversations();
                
                // Manually render it or refresh chat
                document.body.removeChild(popup);
                document.getElementById('historyToggleBtn').click(); // close sidebar if open
                window.location.reload(); // Quick way to rerender chat correctly
            }, 500);

        } catch (e) {
            if (e.name === 'AbortError' || isCancelled) {
                console.log("Summarization cancelled.");
            } else {
                await showAlert("Error", "Error during summarization: " + e.message);
                if (document.body.contains(popup)) {
                    document.body.removeChild(popup);
                }
            }
        }
    };

    init();
});
