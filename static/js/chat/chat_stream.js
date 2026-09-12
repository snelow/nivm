/* chat stream & generation */

import { state, saveConversations, saveUsageStats } from '../state.js';
import { dom } from '../dom.js';
import { tools, buildToolsInstruction, parseToolCall, stripToolCallFromText } from '../tools.js';
import { renderActiveChat, appendMessageToDOM, scrollToBottom, toggleSendStopButtons, updateAssistantBubble, updateMessageActionIcons, buildToolTraceHtml, updateChatInputState } from './chat_messages.js';
import { renderChatHistory, createNewChat } from './chat_history.js';
import { clearAttachedImage, isVisionSupported } from '../media/media_manager.js';
import { generateChatTitle, uploadImage } from '../api.js';
import { voiceConfig, speakText, stopSpeaking, setVoiceOrbGeneratingState } from '../voice.js';
import { showAlert, showNotification } from '../modals/dialogs.js';
import { populateStatsModal } from '../modals/tools_settings.js';
import { openCreatorModal } from '../extras.js';

export function sanitizeAssistantText(text) {
    if (!text) return '';
    let cleaned = stripToolCallFromText(text, tools);
    cleaned = cleaned.replace(/<thought>/gi, '<think>').replace(/<\/thought>/gi, '</think>');
    cleaned = cleaned.replace(/<reasoning>/gi, '<think>').replace(/<\/reasoning>/gi, '</think>');
    cleaned = cleaned.replace(/<think>\s*<\/think>/gi, '');
    if (cleaned.includes('</think>') && !cleaned.includes('<think>')) {
        cleaned = '<think>' + cleaned;
    }
    return cleaned;
}

export async function sendMessage(text, triggerAssistantOnly = false, isHiddenUserMsg = false) {
    if (state.isGenerating || state.isEditing) return;
    try { stopSpeaking(); } catch (e) { }

    if (!state.isModelLoaded && state.inferenceMode !== 'api') {
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
    const turnChatId = activeChat.id;

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
                chat_id: turnChatId,
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
                            if (!activeChat.isPendingResume) {
                                const detectedTool = parseToolCall(fullResponse, tools);
                                if (detectedTool) {
                                    interceptedToolCall = detectedTool;
                                    setVoiceOrbGeneratingState(true, `Running ${detectedTool.command}…`);
                                    state.abortController.abort();
                                }
                            }
                        }
                    } catch (e) { }
                }
            }

            if (!pendingUpdate) {
                pendingUpdate = requestAnimationFrame(() => {
                    assistantMsg.content = fullResponse;
                    if (state.activeChatId === turnChatId) {
                        updateAssistantBubble(assistantBubble, sanitizeAssistantText(fullResponse), true, thinkStartTime);
                        scrollToBottom();
                    }
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

        state.usageStats.totalTokens += metaStats.estTokens;
        state.usageStats.totalCost += parseFloat(metaStats.estCost);
        state.usageStats.totalDurationSec += parseFloat(metaStats.durationSec);
        populateStatsModal();
        saveUsageStats();

        if (interceptedToolCall) {
            if (actionsContainer) actionsContainer.style.display = 'none';

            let preToolText = fullResponse.substring(0, interceptedToolCall.index);
            preToolText = preToolText.replace(/<thought>/gi, '<think>').replace(/<\/thought>/gi, '</think>');
            preToolText = preToolText.replace(/<reasoning>/gi, '<think>').replace(/<\/reasoning>/gi, '</think>');
            if (preToolText.includes('<think>') && !preToolText.includes('</think>')) {
                preToolText = preToolText.trim() + '\n</think>\n';
            }
            preToolText = preToolText.replace(/<think>\s*<\/think>/gi, '').trim();

            assistantMsg.content = (preToolText ? preToolText + '\n' : '') + fullResponse.substring(interceptedToolCall.index, interceptedToolCall.index + interceptedToolCall.fullMatch.length);
            if (thinkDurationSec !== null) {
                assistantMsg.thinkTime = thinkDurationSec;
            }
            assistantMsg.meta = metaStats;

            const textWithoutTool = stripToolCallFromText(assistantMsg.content, tools).trim();
            const textOutsideThoughts = textWithoutTool
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/<think>[\s\S]*$/gi, '')
                .trim();

            let completedThoughtContent = '';
            const mThought = textWithoutTool.match(/<think>([\s\S]*?)<\/think>/i);
            if (mThought && mThought[1].trim()) {
                completedThoughtContent = mThought[1].trim();
            }
            const hasCompletedThought = Boolean(completedThoughtContent);

            if (hasCompletedThought || textOutsideThoughts) {
                updateAssistantBubble(assistantBubble, assistantMsg.content, false, assistantMsg.thinkTime || thinkDurationSec);
            } else {
                updateAssistantBubble(assistantBubble, '', false);
            }

            let resultStr = "";
            const matchedTool = tools.find(t => t.name === interceptedToolCall.command);
            const isEnabled = state.enabledTools[interceptedToolCall.command] !== false;

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

            assistantMsg.toolExecution = {
                command: interceptedToolCall.command,
                argsStr: interceptedToolCall.argsStr,
                resultStr: resultStr
            };

            if (interceptedToolCall.command === 'generate_image' || interceptedToolCall.command === 'edit_image') {
                const imgMatch = resultStr.match(/(?:\/images\/|\/uploads\/)[^\s,)"';:]+/i);
                if (imgMatch) {
                    assistantMsg.toolExecution.imageUrl = imgMatch[0].replace(/[.,:;]+$/, '');
                }
            }

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
            const isImageTool = interceptedToolCall.command === 'generate_image' || interceptedToolCall.command === 'edit_image';

            if (state.activeChatId === turnChatId) {
                if (isImageTool) {
                    if (hasCompletedThought || textOutsideThoughts) {
                        updateAssistantBubble(assistantBubble, assistantMsg.content, false, assistantMsg.thinkTime || thinkDurationSec);
                    } else {
                        updateAssistantBubble(assistantBubble, '', false);
                    }
                    if (actionsContainer) actionsContainer.style.display = 'none';
                } else if (textOutsideThoughts === '' && !hasCompletedThought) {
                    const row = assistantBubble.closest('.message-row');
                    if (row) row.remove();
                    dom.messagesContainer.insertAdjacentHTML('beforeend', sysBubbleHtml);
                } else {
                    updateAssistantBubble(assistantBubble, assistantMsg.content, false, assistantMsg.thinkTime || thinkDurationSec);
                    actionsContainer.style.display = 'none';
                    assistantBubble.insertAdjacentHTML('afterend', sysBubbleHtml);
                }
            }

            saveConversations();

            if (state.activeChatId === turnChatId) {
                setTimeout(() => sendMessage(null, true), 100);
            }
        } else {
            if (activeChat.isPendingResume) {
                try {
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
window.sendMessage = sendMessage;

export function stopGeneration() {
    if (state.activeChatId) {
        fetch('/api/chat/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: state.activeChatId })
        }).catch(() => {});
    }
    if (state.abortController) {
        state.abortController.abort();
    }
    state.isGenerating = false;
    toggleSendStopButtons(false);
    setVoiceOrbGeneratingState(false);
    try { stopSpeaking(); } catch (e) { }
}
window.stopGeneration = stopGeneration;

export async function checkAndResumeActiveGeneration(chatId) {
    if (!chatId) return;
    try {
        const res = await fetch(`/api/chat/status?chat_id=${encodeURIComponent(chatId)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const statusData = await res.json();
        if (statusData.status !== 'generating') return;

        console.log(`[Auto-Resume] Found background generation in progress for chat ${chatId}. Reconnecting...`);
        const activeChat = state.conversations.find(c => c.id === chatId);
        if (!activeChat) return;

        let assistantMsg = activeChat.messages[activeChat.messages.length - 1];
        if (!assistantMsg || assistantMsg.role !== 'assistant') {
            assistantMsg = { role: 'assistant', content: '' };
            activeChat.messages.push(assistantMsg);
        }

        const assistantBubble = dom.messagesContainer.querySelector('.message-row:last-child .message-bubble.assistant') ||
            appendMessageToDOM(assistantMsg, true).bubble;

        state.isGenerating = true;
        toggleSendStopButtons(true);
        setVoiceOrbGeneratingState(true, 'Responding…');
        state.abortController = new AbortController();

        const streamRes = await fetch(`/api/chat/resume?chat_id=${encodeURIComponent(chatId)}`, {
            signal: state.abortController.signal
        });

        if (!streamRes.ok) return;

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let fullResponse = assistantMsg.content || '';
        let pendingUpdate = false;
        let thinkStartTime = null;

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
                        const delta = json.choices && json.choices[0] ? json.choices[0].delta : null;
                        if (delta) {
                            if (delta.reasoning_content) {
                                fullResponse += delta.reasoning_content;
                            }
                            if (delta.content) {
                                fullResponse += delta.content;
                            }
                        }
                    } catch (e) { }
                }
            }

            if (!pendingUpdate) {
                pendingUpdate = requestAnimationFrame(() => {
                    assistantMsg.content = fullResponse;
                    if (state.activeChatId === chatId) {
                        updateAssistantBubble(assistantBubble, sanitizeAssistantText(fullResponse), true, thinkStartTime);
                        scrollToBottom();
                    }
                    pendingUpdate = false;
                });
            }
        }

        if (pendingUpdate) {
            cancelAnimationFrame(pendingUpdate);
            pendingUpdate = false;
        }

        let cleanResponse = sanitizeAssistantText(fullResponse);
        assistantMsg.content = cleanResponse;
        updateAssistantBubble(assistantBubble, cleanResponse, false);
        state.isGenerating = false;
        toggleSendStopButtons(false);
        setVoiceOrbGeneratingState(false);
        saveConversations();
        renderChatHistory();

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.warn('[Auto-Resume] Stream error:', err);
        }
        state.isGenerating = false;
        toggleSendStopButtons(false);
        setVoiceOrbGeneratingState(false);
    }
}
window.checkAndResumeActiveGeneration = checkAndResumeActiveGeneration;
