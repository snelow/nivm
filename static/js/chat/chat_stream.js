/* chat stream & generation */

import { state, saveConversations, saveUsageStats } from '../state.js';
import { dom } from '../dom.js';
import { tools, buildToolsInstruction, parseToolCall, stripToolCallFromText } from '../tools.js';
import { renderActiveChat, appendMessageToDOM, scrollToBottom, toggleSendStopButtons, updateAssistantBubble, updateMessageActionIcons, buildToolTraceHtml, updateChatInputState, sealUnclosedThoughts } from './chat_messages.js';
import { renderChatHistory, createNewChat } from './chat_history.js';
import { clearAttachedImage, isVisionSupported } from '../media/media_manager.js';
import { generateChatTitle, uploadImage } from '../api.js';
import { voiceConfig, speakText, stopSpeaking, setVoiceOrbGeneratingState } from '../voice.js';
import { showAlert, showNotification } from '../modals/dialogs.js';
import { populateStatsModal } from '../modals/tools_settings.js';
import { openCreatorModal } from '../extras.js';
import { saveImageDuration } from '../image_editor.js';
import { normalizeThinkTags, hasRawOpenTag, hasRawCloseTag, normalizeCloseTag, stripRawOpenTags, isPotentialOpenTagPrefix, cleanReasoningText } from '../think_tags.js';

export function sanitizeAssistantText(text) {
    if (!text) return '';
    let cleaned = stripToolCallFromText(text, tools);
    cleaned = normalizeThinkTags(cleaned);
    cleaned = cleaned.replace(/<think>\s*<\/think>/gi, '');
    cleaned = cleaned.replace(/<\|im_end\|>|<\|im_start\|>/gi, '');
    const firstOpen = cleaned.indexOf('<think>');
    const firstClose = cleaned.indexOf('</think>');
    if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
        cleaned = '<think>' + cleaned;
    }
    if (cleaned.includes('<think>') && !cleaned.includes('</think>')) {
        cleaned = sealUnclosedThoughts(cleaned);
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
                    if (!url) return;
                    const att = state.attachedImages[index];
                    const isPdf = att.type === 'application/pdf' || att.file.name.toLowerCase().endsWith('.pdf');
                    const isVideo = att.type?.startsWith('video/');
                    const isAudio = att.type?.startsWith('audio/');
                    const key = isPdf ? 'document_url' : isVideo ? 'video_url' : isAudio ? 'audio_url' : 'image_url';
                    finalContent.push({ type: key, [key]: { url } });
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
    const activeAiName = (state.aiName || 'nivm').trim();
    let dynamicSystemPrompt = state.systemPrompt || `You are ${activeAiName}, an intelligent, versatile AI companion running inside Project NIVM (Native Inference Virtual Machine).`;
    if (activeAiName.toLowerCase() !== 'nivm') {
        dynamicSystemPrompt = dynamicSystemPrompt.replace(/^You are nivm,/i, `You are ${activeAiName},`);
        dynamicSystemPrompt += `\n\nYour assigned name is: "${activeAiName}". Always identify and respond as "${activeAiName}".`;
    }
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

    const isThinkingEnabled = Boolean(dom.forceThinkingToggle && dom.forceThinkingToggle.classList.contains('active'));
    if (isThinkingEnabled) {
        dynamicSystemPrompt += `\n\n[Reasoning & Persona Thinking Directive]:
CRITICAL WORKFLOW:
1. Conduct your internal reflections and persona planning inside <think> and </think> tags at the start of your response.
2. Immediately upon closing the </think> tag, you MUST write and deliver your actual, complete spoken response directly to the user.
3. NEVER stop generation inside or immediately after </think>—always proceed to write your response to the user.`;
    } else {
        dynamicSystemPrompt += `\n\n[Negative Directive: Reasoning Disabled]:
Do NOT output any internal monologue, planning, or reasoning. Do NOT output <think> or </think> tags. Respond directly, immediately, and concisely to the user in character.`;
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

    const isVoiceMode = Boolean(
        document.body?.classList.contains('voice-mode-active') ||
        dom.chatViewport?.classList.contains('voice-mode-active')
    );
    if (isVoiceMode) {
        dynamicSystemPrompt += `\n\n[Voice Conversation Mode - ACTIVE]:
The user is conversing with you via real-time spoken voice (your reply will be read aloud via text-to-speech audio).
CRITICAL SPOKEN CONVERSATION RULES:
1. Concise & Spoken: Keep replies brief, natural, and conversational (1 to 3 sentences maximum). Do NOT yap, recite lengthy essays, or over-explain unless the user explicitly asks for a detailed breakdown or story.
2. Natural Spoken Tone: Speak naturally and warmly like a live phone call or spoken dialogue.
3. Zero Markdown or Formatting: NEVER use markdown headers (#), bullet lists (*, -), tables, or code fences in voice mode. Output clean, flowing sentences that sound natural when spoken aloud.
4. Fast Back-and-Forth: Favor brisk turn-taking over long monologues so the user can easily respond or ask follow-ups.`;
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
    let streamPhase = 'IDLE'; // 'IDLE' | 'THINKING' | 'RESPONDING'
    let isApiReasoning = false;
    let reasoningBuffer = '';
    let responseBuffer = '';
    let idleBuffer = '';
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
                engine_mode: state.engineMode,
                enable_thinking: isThinkingEnabled
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
                        if (json.model_info) {
                            modelInfo = json.model_info;
                            if (modelInfo.prefill_think && streamPhase === 'IDLE') {
                                streamPhase = 'THINKING';
                                thinkStartTime = performance.now();
                                setVoiceOrbGeneratingState(true, 'Thinking…');
                            }
                        }
                        const delta = json.choices && json.choices[0] ? json.choices[0].delta : null;
                        if (json.error) {
                            const errLower = json.error.toLowerCase();
                            const isContextExceeded = /context window|maximum context length|exceeds context|context limit|n_ctx exceeded|too many tokens|prompt is too long|context length exceeded/.test(errLower);
                            const isVramLimit = /vram|failed to create llama_context|out of memory/.test(errLower);
                            if (isContextExceeded) {
                                responseBuffer += `\n\n<div class="context-limit-block">
                                    <div style="color: var(--accent-rose); font-weight: 600; margin-bottom: 8px;"><i class="fa-solid fa-triangle-exclamation"></i> Context Limit Reached</div>
                                    <div style="font-size: 0.9em; margin-bottom: 12px;">This conversation is too long for the active model.</div>
                                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                        <button class="btn-secondary" onclick="window.exportChat()"><i class="fa-solid fa-download"></i> Export Chat</button>
                                        <button class="btn-secondary" onclick="document.getElementById('newChatBtn').click()"><i class="fa-solid fa-plus"></i> New Chat</button>
                                        <button class="btn-primary" onclick="window.summarizeAndRestart()"><i class="fa-solid fa-wand-magic-sparkles"></i> Summarize & Restart</button>
                                    </div>
                                </div>`;
                            } else if (isVramLimit) {
                                responseBuffer += `\n\n<div class="context-limit-block">
                                    <div style="color: var(--accent-rose); font-weight: 600; margin-bottom: 8px;"><i class="fa-solid fa-microchip"></i> GPU Memory Allocation Exceeded</div>
                                    <div style="font-size: 0.9em; margin-bottom: 12px; line-height: 1.4;">${json.error}</div>
                                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                        <button class="btn-primary" onclick="if (window.openSettingsForModelLoad) { window.openSettingsForModelLoad(); } else { document.getElementById('settingsBtn').click(); }"><i class="fa-solid fa-sliders"></i> Adjust Context & KV in Settings</button>
                                    </div>
                                </div>`;
                            } else {
                                responseBuffer += `\n\n**Error:** ${json.error}`;
                            }
                            fullResponse = responseBuffer;
                            if (assistantBubble) {
                                updateAssistantBubble(assistantBubble, fullResponse, false);
                            }
                        } else if (json.usage) {
                            serverUsage = json.usage;
                            if (json.model_info) modelInfo = json.model_info;
                        } else if (delta) {
                            if (delta.reasoning_content) {
                                isApiReasoning = true;
                                if (streamPhase !== 'THINKING') {
                                    streamPhase = 'THINKING';
                                    if (!thinkStartTime) thinkStartTime = performance.now();
                                    setVoiceOrbGeneratingState(true, 'Thinking…');
                                }
                                reasoningBuffer += delta.reasoning_content;
                            }
                            if (delta.content) {
                                if (isApiReasoning && streamPhase === 'THINKING') {
                                    streamPhase = 'RESPONDING';
                                    if (thinkStartTime && !thinkEndTime) {
                                        thinkEndTime = performance.now();
                                    }
                                    setVoiceOrbGeneratingState(true, 'Responding…');
                                    responseBuffer += delta.content;
                                } else if (!isApiReasoning) {
                                    if (streamPhase === 'IDLE') {
                                        idleBuffer += delta.content;
                                        const normalized = normalizeThinkTags(idleBuffer);
                                        if (normalized.includes('<think>')) {
                                            const openParts = normalized.split('<think>');
                                            if (openParts[0] && openParts[0].trim()) responseBuffer += openParts[0];
                                            streamPhase = 'THINKING';
                                            if (!thinkStartTime) thinkStartTime = performance.now();
                                            setVoiceOrbGeneratingState(true, 'Thinking…');
                                            reasoningBuffer += cleanReasoningText(openParts.slice(1).join('<think>'));
                                            idleBuffer = '';
                                        } else if (hasRawOpenTag(idleBuffer)) {
                                            const chunkText = stripRawOpenTags(idleBuffer);
                                            streamPhase = 'THINKING';
                                            if (!thinkStartTime) thinkStartTime = performance.now();
                                            setVoiceOrbGeneratingState(true, 'Thinking…');
                                            reasoningBuffer += cleanReasoningText(chunkText);
                                            idleBuffer = '';
                                        } else if (modelInfo?.prefill_think) {
                                            streamPhase = 'THINKING';
                                            if (!thinkStartTime) thinkStartTime = performance.now();
                                            setVoiceOrbGeneratingState(true, 'Thinking…');
                                            reasoningBuffer += cleanReasoningText(idleBuffer);
                                            idleBuffer = '';
                                        } else if (isPotentialOpenTagPrefix(idleBuffer) && idleBuffer.trimStart().length < 25) {
                                            // Split-token boundary: keep buffering in IDLE until tag completes or is disproven
                                        } else {
                                            // Regular response: model started emitting spoken content directly
                                            streamPhase = 'RESPONDING';
                                            responseBuffer += idleBuffer;
                                            idleBuffer = '';
                                        }
                                    } else if (streamPhase === 'THINKING') {
                                        const chunkText = delta.content;
                                        const combinedTail = reasoningBuffer.slice(-50) + chunkText;
                                        const normalizedTail = normalizeCloseTag(combinedTail);
                                        if (normalizedTail.includes('</think>') || hasRawCloseTag(combinedTail) || chunkText.includes('</think>')) {
                                            const fullCombined = normalizeCloseTag(reasoningBuffer + chunkText);
                                            const closeParts = fullCombined.split('</think>');
                                            reasoningBuffer = cleanReasoningText(closeParts[0]);
                                            streamPhase = 'RESPONDING';
                                            if (thinkStartTime && !thinkEndTime) {
                                                thinkEndTime = performance.now();
                                            }
                                            setVoiceOrbGeneratingState(true, 'Responding…');
                                            responseBuffer += closeParts.slice(1).join('</think>');
                                        } else {
                                            reasoningBuffer += stripRawOpenTags(chunkText);
                                        }
                                    } else {
                                        responseBuffer += delta.content;
                                    }
                                } else {
                                    responseBuffer += delta.content;
                                }
                            }

                            fullResponse = reasoningBuffer
                                ? (`<think>${reasoningBuffer}${streamPhase === 'RESPONDING' ? '</think>' : ''}${responseBuffer}`)
                                : responseBuffer;

                            if (!activeChat.isPendingResume && responseBuffer) {
                                const detectedTool = parseToolCall(responseBuffer, tools);
                                if (detectedTool) {
                                    // Adjust index: detectedTool.index is relative to responseBuffer,
                                    // but it needs to be relative to fullResponse for slicing later.
                                    const responseBufferOffsetInFull = fullResponse.length - responseBuffer.length;
                                    detectedTool.index = responseBufferOffsetInFull + detectedTool.index;
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
                        updateAssistantBubble(assistantBubble, fullResponse, true, thinkStartTime, {
                            streamPhase,
                            reasoningBuffer,
                            responseBuffer,
                            thinkStartTime,
                            thinkEndTime
                        });
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

        if (idleBuffer) {
            responseBuffer += idleBuffer;
            idleBuffer = '';
        }

        if (reasoningBuffer && !fullResponse.includes('</think>')) {
            fullResponse = `<think>${reasoningBuffer}</think>${responseBuffer}`;
        } else if (!fullResponse && responseBuffer) {
            fullResponse = responseBuffer;
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
            preToolText = normalizeThinkTags(preToolText);

            // Fold any text that leaked outside <think> blocks (but is before the tool call)
            // back into the reasoning panel, since the model was clearly still reasoning.
            const thinkCloseIdx = preToolText.lastIndexOf('</think>');
            if (thinkCloseIdx !== -1) {
                const outsideText = preToolText.substring(thinkCloseIdx + 8).trim();
                if (outsideText) {
                    // Reopen the think block and append the leaked text into it
                    preToolText = preToolText.substring(0, thinkCloseIdx) + '\n' + outsideText + '\n</think>';
                }
            }

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

            if (interceptedToolCall.command === 'generate_image' || interceptedToolCall.command === 'edit_image' || interceptedToolCall.command === 'generate_anime_image') {
                const imgMatch = resultStr.match(/(?:\/images\/|\/uploads\/)[^\s,)"';:]+/i);
                if (imgMatch) {
                    assistantMsg.toolExecution.imageUrl = imgMatch[0].replace(/[.,:;]+$/, '');
                    const fn = assistantMsg.toolExecution.imageUrl.split('/').pop();
                    if (fn) {
                        state.lastGeneratedImage = fn;
                        assistantMsg.toolExecution.imageFilename = fn;
                    }
                }
                const durMatch = resultStr.match(/Duration:\s*([0-9.]+)\s*s/i);
                if (durMatch) {
                    assistantMsg.toolExecution.duration = parseFloat(durMatch[1]);
                    if (assistantMsg.toolExecution.imageUrl) {
                        saveImageDuration(assistantMsg.toolExecution.imageUrl, assistantMsg.toolExecution.duration);
                    }
                }
            }

            const isWriteMem = interceptedToolCall.command === 'write_memory';
            const isEndConvo = interceptedToolCall.command === 'end_conversation';
            const isImageTool = ['generate_image', 'edit_image', 'generate_anime_image'].includes(interceptedToolCall.command);
            const isDenied = typeof resultStr === 'string' && resultStr.toLowerCase().includes('denied by user');
            const isInterrupted = typeof resultStr === 'string' && (/\[GENERATION INTERRUPTED\]|stopped by user|generation was stopped|editing was stopped/i.test(resultStr));
            const isImageFailed = isImageTool && typeof resultStr === 'string' && (/\[GENERATION FAILED\]|^error|generation failed:|editing failed:/i.test(resultStr));

            let toolAdvice = "";
            let sysNotificationHeader = "[SYSTEM NOTIFICATION] Tool executed successfully.";

            if (isDenied) {
                sysNotificationHeader = "[SYSTEM NOTIFICATION] Tool execution was DENIED by the user.";
                toolAdvice = "IMPORTANT: The user explicitly denied permission to run this command. Acknowledge the denial politely in character, do NOT re-attempt this command, and ask the user how they would like you to proceed instead.";
            } else if (isInterrupted) {
                sysNotificationHeader = "[SYSTEM NOTIFICATION] Image generation was CANCELLED / STOPPED by the user.";
                toolAdvice = "IMPORTANT: The user explicitly clicked STOP to cancel this image generation while it was running. No completed image was generated. Acknowledge that the generation was stopped as requested in your active persona/character. Do NOT describe or pretend an image was generated, and do NOT hallucinate visual details.";
            } else if (isImageFailed) {
                sysNotificationHeader = "[SYSTEM NOTIFICATION] Image generation FAILED.";
                toolAdvice = `IMPORTANT: Image generation failed due to an error. Inform the user in character that generation could not complete. Do NOT describe or pretend an image was generated. Error details: ${resultStr}`;
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
            } else if (isImageTool) {
                const imgFilename = assistantMsg.toolExecution?.imageFilename || state.lastGeneratedImage || 'the image';
                sysNotificationHeader = "[SYSTEM NOTIFICATION] Image generated successfully.";
                toolAdvice = `IMPORTANT: Image processing succeeded. The image filename is "${imgFilename}". The rendered image is already displayed in the UI. Describe the visual scene warmly in your active persona/character without mentioning technical file paths or markdown image tags. Note this filename: if the user later asks to edit, alter, or transform this image, call edit_image("${imgFilename}", "<edit instruction>", "original").`;
            } else if (interceptedToolCall.command === 'execute_terminal') {
                const isEmpty = !resultStr || resultStr.includes('no output produced') || resultStr.trim() === '';
                toolAdvice = `CRITICAL INSTRUCTION FOR TERMINAL OUTPUT:
1. The user CANNOT see this terminal output directly! You MUST state, summarize, or explain the terminal output and findings to the user in character.
2. ${isEmpty ? 'The command returned empty or silent output (exit code 0 with no stdout text). You MUST explicitly tell the user that the command ran cleanly with exit status 0, and explain WHY it returned empty (e.g. it was a silent command that produces no stdout unless an error occurs, or there were no matching items).' : 'Clearly state and explain the output and metrics to the user.'}
3. Always stay in character.`;
            } else {
                toolAdvice = "IMPORTANT: The user CANNOT see this internal tool output directly! You must convey, explain, or display the output and findings to the user. Maintain and speak in your active persona/character without breaking character.";
            }

            const sysMsg = { role: 'user', content: `${sysNotificationHeader} Result: ${resultStr}\n\n${toolAdvice}` };
            activeChat.messages.push(sysMsg);

            const sysBubbleHtml = buildToolTraceHtml(interceptedToolCall.command, interceptedToolCall.argsStr, resultStr);

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
                        const hasAcceptPhrase = /let you back|let you in|fine[!.,]|start fresh|welcome back|i('ll| will)? allow|i accept|accept your appeal|forgive|bored and|talk again|let's talk|continue/i.test(dialogueOutside);
                        const hasRejectPhrase = /refuse to resume|remain closed|stay closed|stay locked|not letting you back|wo(n't|uld not) unlock|will not unlock|get lost|goodbye forever|leave me alone|declined|denied|stay out|get out/i.test(dialogueOutside);
                        isAccepted = hasAcceptPhrase && !hasRejectPhrase ? true : (hasRejectPhrase && !hasAcceptPhrase ? false : (!hasRejectPhrase && dialogueOutside.length > 0));
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
