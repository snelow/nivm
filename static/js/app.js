/* main app coordinator */

import { state, themeState, saveConversations, saveUsageStats } from './state.js';
import { dom } from './dom.js';
import { fetchApiSettings, saveApiSettings, checkBackendHealth, fetchEngineStatus, loadAvailableModels, fetchChats, fetchMemoryAPI, fetchBackendConfig } from './api.js';
import { setupNodesCanvas, setupMatrixCanvas, setupFluidCanvas, setupFlowFieldCanvas, applyThemeState, saveThemeConfig } from './theme.js';
import { makeDraggable, setupDynamicGreeting, renderChatHistory, renderActiveChat, switchChat, createNewChat, appendMessageToDOM, renderMemoryDrawer, renderToolsSettings, initImageStudioSettings, showAlert, showConfirm, showNotification, setupHistoryUI, setupMobileNav, setupVisionUI, setupAudioRecording, updateVisionAvailabilityUI, populateStatsModal, updateChatInputState } from './ui.js';
import { setupVoiceUI, stopSpeaking } from './voice.js';
import { initExtras } from './extras.js';
import { sendMessage, stopGeneration, checkAndResumeActiveGeneration } from './chat/chat_stream.js';
import { setupSettingsUI, refreshEngineStatusUI, refreshScannedModelsList, updateModelAvailabilityUI, handleUnloadAllModels } from './modals/settings_modal.js';
import { setupPersonalityUI } from './modals/personality_modal.js';
import { setupFileBrowserUI } from './modals/file_browser.js';
import { setupSentinelUI } from './modals/sentinel_modal.js';

// Global references for UI modules and HTML onclick handlers
window.__nivm_state = state;
window.renderMemoryDrawer = renderMemoryDrawer;
window.sendMessage = sendMessage;
window.stopGeneration = stopGeneration;
window.checkAndResumeActiveGeneration = checkAndResumeActiveGeneration;
window.handleUnloadAllModels = handleUnloadAllModels;
window.refreshEngineStatusUI = refreshEngineStatusUI;
window.updateModelAvailabilityUI = updateModelAvailabilityUI;

const startApp = async () => {
    // Markdown parser options
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
            setupSettingsUI();
            setupPersonalityUI();
            setupFileBrowserUI();
            setupSentinelUI();

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
            setupMobileNav();

            // Cache hydration: render cached chats immediately
            try {
                const cachedChats = localStorage.getItem('nivm_saved_chats');
                if (cachedChats) {
                    const parsed = JSON.parse(cachedChats);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        state.conversations = parsed;
                        if (!state.activeChatId) {
                            state.activeChatId = parsed[0].id;
                        }
                        renderChatHistory();
                        renderActiveChat();
                    }
                }
            } catch (e) {
                console.warn('Instant chat cache hydration:', e);
            }

            setupVisionUI();
            setupAudioRecording();
            updateModelAvailabilityUI(false);

            await fetchApiSettings();
            await fetchBackendConfig();
            await checkBackendHealth();
            await fetchEngineStatus();
            await loadAvailableModels();
            updateVisionAvailabilityUI();
            initImageStudioSettings();

            // Sync server chats
            try {
                const serverChats = await fetchChats();
                if (Array.isArray(serverChats) && serverChats.length > 0) {
                    state.conversations = serverChats;
                }
            } catch (err) {
                console.warn('Server chats fetch warning:', err);
            }

            // Sync memory
            state.memory = await fetchMemoryAPI();

            if (state.conversations.length > 0) {
                if (!state.activeChatId || !state.conversations.some(c => c.id === state.activeChatId)) {
                    state.activeChatId = state.conversations[0].id;
                    switchChat(state.activeChatId);
                }
                renderChatHistory();
                checkAndResumeActiveGeneration(state.activeChatId);
            } else {
                renderChatHistory();
            }
        } catch (error) {
            await showAlert("Initialization Error", error.stack);
        }
    }

    function setupEventListeners() {
        if (dom.historyToggleBtn) {
            dom.historyToggleBtn.addEventListener('click', () => {
                if (dom.historyDrawer) dom.historyDrawer.classList.toggle('hidden');
                if (dom.historyDrawer && !dom.historyDrawer.classList.contains('hidden')) {
                    if (dom.memoryDrawer) dom.memoryDrawer.classList.add('hidden');
                    const drawerBody = dom.historyDrawer.querySelector('.drawer-body');
                    if (drawerBody) drawerBody.scrollTop = 0;
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

                currentActiveChat.isPendingResume = true;
                currentActiveChat.pendingAppealText = appealText;

                if (dom.convoEndedReason) {
                    dom.convoEndedReason.textContent = 'Reviewing your appeal...';
                }
                if (dom.convoEndedResumeBtn) {
                    dom.convoEndedResumeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deciding...';
                    dom.convoEndedResumeBtn.disabled = true;
                }

                const appealMsg = {
                    role: 'user',
                    content: appealText
                        ? `[Appeal to Resume]: "${appealText}"`
                        : `[Appeal to Resume]: The user requested to resume the conversation.`
                };
                currentActiveChat.messages.push(appealMsg);
                appendMessageToDOM(appealMsg, false);
                saveConversations();

                setTimeout(() => sendMessage(null, true), 100);
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
                        dom.chatBoxDraftHint.textContent = `Draft saved (${text.length} chars) • Tap Settings`;
                    } else {
                        dom.chatBoxDraftHint.textContent = 'Tap Settings to load a model';
                    }
                }
            });

            dom.userPrompt.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.shiftKey) {
                    // New line
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    sendMessage();
                }
            });
        }

        if (dom.sendBtn) dom.sendBtn.addEventListener('click', () => sendMessage());
        if (dom.stopBtn) dom.stopBtn.addEventListener('click', stopGeneration);
        if (dom.retryConnBtn) dom.retryConnBtn.addEventListener('click', checkBackendHealth);

        if (dom.settingsBtn) {
            dom.settingsBtn.addEventListener('click', () => {
                if (dom.settingsModal) {
                    dom.settingsModal.classList.toggle('hidden');
                    if (!dom.settingsModal.classList.contains('hidden')) {
                        initImageStudioSettings();
                    }
                }
            });
        }
        if (dom.closeSettingsBtn) dom.closeSettingsBtn.addEventListener('click', () => dom.settingsModal && dom.settingsModal.classList.add('hidden'));

        if (dom.toolsBtn) {
            dom.toolsBtn.addEventListener('click', () => {
                if (dom.toolsModal) {
                    dom.toolsModal.classList.toggle('hidden');
                    if (!dom.toolsModal.classList.contains('hidden')) {
                        renderToolsSettings();
                    }
                }
            });
        }
        if (dom.closeToolsBtn) dom.closeToolsBtn.addEventListener('click', () => dom.toolsModal && dom.toolsModal.classList.add('hidden'));
        if (dom.saveToolsBtn) dom.saveToolsBtn.addEventListener('click', () => dom.toolsModal && dom.toolsModal.classList.add('hidden'));

        if (dom.saveSettingsBtn) {
            dom.saveSettingsBtn.addEventListener('click', async () => {
                await saveApiSettings();
                await checkBackendHealth();
                await loadAvailableModels();
                if (dom.settingsModal) dom.settingsModal.classList.add('hidden');
            });
        }

        if (dom.statsBtn) {
            dom.statsBtn.addEventListener('click', () => {
                populateStatsModal();
                dom.statsWindow.classList.toggle('hidden');
            });
        }
        if (dom.closeStatsBtn) dom.closeStatsBtn.addEventListener('click', () => dom.statsWindow.classList.add('hidden'));
        if (dom.resetStatsBtn) {
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
        }

        if (dom.themeBtn) dom.themeBtn.addEventListener('click', () => dom.themeModal && dom.themeModal.classList.toggle('hidden'));
        if (dom.closeThemeBtn) dom.closeThemeBtn.addEventListener('click', () => dom.themeModal && dom.themeModal.classList.add('hidden'));
        if (dom.saveThemeBtn) dom.saveThemeBtn.addEventListener('click', () => dom.themeModal && dom.themeModal.classList.add('hidden'));

        // Appearance & Background Motion
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
                applyThemeState();
                saveThemeConfig();
            });
        }

        if (dom.sidebarTonePicker) {
            dom.sidebarTonePicker.addEventListener('input', (e) => {
                themeState.sidebarTone = e.target.value;
                applyThemeState();
                saveThemeConfig();
            });
        }

        if (dom.accentColorPicker) {
            dom.accentColorPicker.addEventListener('input', (e) => {
                themeState.accentColor = e.target.value;
                if (themeState.cycleAccent) { themeState.cycleAccent = false; if (dom.cycleAccentToggle) dom.cycleAccentToggle.checked = false; }
                applyThemeState();
                saveThemeConfig();
            });
        }

        if (dom.mutedColorPicker) {
            dom.mutedColorPicker.addEventListener('input', (e) => {
                themeState.mutedColor = e.target.value;
                applyThemeState();
                saveThemeConfig();
            });
        }

        if (dom.brandColorPicker) {
            dom.brandColorPicker.addEventListener('input', (e) => {
                themeState.brandColor = e.target.value;
                applyThemeState();
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
                const val = Number(e.target.value) || 15;
                themeState.fontSize = val;
                if (dom.fontSizeVal) dom.fontSizeVal.textContent = val + 'px';
                document.documentElement.style.setProperty('--font-size-base', `${val}px`);
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
                    brandColor: '#a855f7',
                    mutedColor: null,
                    cycleAccent: false,
                    cycleBg: false,
                    cycleSpeed: 50,
                    chatWidth: 'default',
                    fontSize: 15
                });
                document.documentElement.style.setProperty('--font-size-base', '15px');
                if (dom.fontSizeSlider) dom.fontSizeSlider.value = 15;
                if (dom.fontSizeVal) dom.fontSizeVal.textContent = '15px';
                applyThemeState();
                saveThemeConfig();
                showNotification('Appearance and font size reset to default', 'info');
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

    // Export active chat to markdown
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

    // Summarize active chat and start fresh
    window.summarizeAndRestart = async function () {
        if (window.__isSummarizing) return;

        if (state.isGenerating || state.isEditing) {
            await showAlert("Busy", "Please wait for nivm to finish the current response before summarizing.");
            return;
        }

        if (!state.isModelLoaded && state.inferenceMode !== 'api') {
            await showAlert("Engine Offline", "Please configure and load a model in Settings before summarizing.");
            return;
        }

        const activeChat = state.conversations.find(c => c.id === state.activeChatId);
        if (!activeChat) {
            await showAlert("Notice", "No active conversation to summarize.");
            return;
        }

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
            const mid = Math.max(1, Math.floor(meaningfulMsgs.length / 2));
            const part1 = meaningfulMsgs.slice(0, mid);
            const part2 = meaningfulMsgs.slice(mid);

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

            const summary1 = await summarizePart(part1);
            const finalSummary = part2.length > 0
                ? await summarizePart(part2, summary1)
                : summary1;

            if (isCancelled) return;

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
