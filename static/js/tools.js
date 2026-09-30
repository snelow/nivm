import { state, saveConversations } from './state.js';
import { executeTerminalAPI } from './api.js';
import { createImageProgressCard, saveImageDuration } from './image_editor.js';
import { normalizeThinkTags } from './think_tags.js';

function mountImageProgressCard(cardElement) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    if (container.querySelector('.image-gen-progress-card')) return;

    // Attach card directly to active assistant message wrapper below thinking bubble
    const lastAssistantRow = container.querySelector('.message-row.assistant-row:last-of-type');
    const assistantWrapper = lastAssistantRow ? lastAssistantRow.querySelector('.message-wrapper') : null;
    const assistantBubble = assistantWrapper ? assistantWrapper.querySelector('.message-bubble') : null;

    if (lastAssistantRow) {
        const existingTrace = lastAssistantRow.querySelector('.tool-trace-block');
        if (existingTrace) {
            existingTrace.replaceWith(cardElement);
            container.scrollTop = container.scrollHeight;
            return;
        }
    }

    if (assistantWrapper && assistantBubble) {
        const actions = assistantWrapper.querySelector('.message-actions');
        if (actions) actions.style.display = 'none';
        assistantBubble.insertAdjacentElement('afterend', cardElement);
    } else {
        container.appendChild(cardElement);
    }
    container.scrollTop = container.scrollHeight;
}

const recentlyReadKeys = new Set();

let _animeRegistryCache = null;

export async function refreshAnimeRegistryCache() {
    try {
        const isUnfiltered = !!state.nsfwMode;
        const resp = await fetch(`/api/image/anime/registry?nsfw_enabled=${isUnfiltered}`);
        if (resp.ok) {
            _animeRegistryCache = await resp.json();
            return _animeRegistryCache;
        }
    } catch (_) {}
    return null;
}

// Eager initial load of registry
refreshAnimeRegistryCache();

export function mergeMemoryValues(existingVal, newVal) {
    if (!existingVal || !String(existingVal).trim()) return newVal;
    if (!newVal || !String(newVal).trim()) return existingVal;

    const existStr = String(existingVal).trim();
    const newStr = String(newVal).trim();

    // Try parsing both as JSON objects
    try {
        const oldJson = JSON.parse(existStr);
        const newJson = JSON.parse(newStr);
        if (typeof oldJson === 'object' && oldJson !== null && typeof newJson === 'object' && newJson !== null) {
            if (Array.isArray(oldJson) && Array.isArray(newJson)) {
                return JSON.stringify([...new Set([...oldJson, ...newJson])]);
            }
            if (!Array.isArray(oldJson) && !Array.isArray(newJson)) {
                return JSON.stringify({ ...oldJson, ...newJson });
            }
        }
    } catch (_) {
        // Fallback to text merge
    }

    if (newStr.includes(existStr)) return newStr;
    if (existStr.includes(newStr)) return existStr;

    return `${existStr} | ${newStr}`;
}

function normalizeAspectRatio(val, fallback = 'square') {
    if (!val) return fallback;
    const s = String(val).toLowerCase().trim();
    if (s.includes('1:1') || s.includes('square')) return 'square';
    if (s.includes('16:9') || s.includes('landscape')) return 'landscape';
    if (s.includes('9:16') || s.includes('portrait')) return 'portrait';
    if (s.includes('4:3')) return '4:3';
    if (s.includes('3:4')) return '3:4';
    if (s.includes('original')) return 'original';
    return fallback;
}

function _trackImageTask(taskId, progressCard, defaultFilename, successDesc, originalUrl = null) {
    return new Promise((resolve) => {
        let completed = false, pollTimer = null;
        const authToken = localStorage.getItem('nivm_auth_token') || '';
        const sseUrl = authToken ? `/api/image/progress/${taskId}?token=${encodeURIComponent(authToken)}` : `/api/image/progress/${taskId}`;
        let evtSource = window.EventSource ? new EventSource(sseUrl) : null;

        const cleanup = () => {
            if (pollTimer) clearInterval(pollTimer);
            if (evtSource) try { evtSource.close(); } catch (_) {}
            document.removeEventListener('visibilitychange', onVisibilityChange);
            try {
                const stored = JSON.parse(localStorage.getItem('nivm_pending_image_task') || 'null');
                if (stored && stored.taskId === taskId) {
                    localStorage.removeItem('nivm_pending_image_task');
                }
            } catch (_) {}
        };

        const finishSuccess = (imgData, finalOrigUrl) => {
            if (completed) return;
            completed = true;
            cleanup();
            const srcUrl = finalOrigUrl || originalUrl;
            const durationSec = progressCard.finish(imgData.url, srcUrl) || null;
            const filename = imgData.filename || (imgData.url ? imgData.url.split('/').pop() : defaultFilename);
            state.lastGeneratedImage = filename;
            const durStr = durationSec ? ` (Duration: ${durationSec}s)` : '';
            const srcStr = srcUrl ? ` (original: ${srcUrl})` : '';
            resolve(`[GENERATION SUCCESSFUL: ${filename}]${durStr} ${successDesc}: ${imgData.url}${srcStr} - Display this image to the user, note filename "${filename}", and describe the scene.`);
        };

        const finishInterrupted = (reason) => {
            if (completed) return;
            completed = true;
            cleanup();
            progressCard.stop(reason || 'Generation stopped by user');
            resolve(`[GENERATION INTERRUPTED] Image processing was explicitly stopped/cancelled by the user. No image was generated.`);
        };

        const finishFail = (errMsg) => {
            if (completed) return;
            completed = true;
            cleanup();
            progressCard.fail(errMsg || 'Generation failed');
            resolve(`[GENERATION FAILED] Image processing failed: ${errMsg || 'Unknown error'}. No image was produced.`);
        };

        progressCard.onStop(() => finishInterrupted());

        const handleData = (evData) => {
            progressCard.update(evData);
            if (evData.status === 'complete' && (evData.image || evData.url || evData.result)) {
                finishSuccess(evData.image || evData.result || { url: evData.url, filename: evData.filename || defaultFilename }, evData.original_url || originalUrl);
            } else if (evData.status === 'interrupted') {
                finishInterrupted(evData.stage_text || evData.error);
            } else if (evData.status === 'error') {
                finishFail(evData.error);
            }
        };

        const connectSSE = () => {
            if (evtSource) try { evtSource.close(); } catch (_) {}
            evtSource = window.EventSource ? new EventSource(sseUrl) : null;
            if (evtSource) evtSource.onmessage = (e) => { try { handleData(JSON.parse(e.data)); } catch (_) {} };
        };

        // Immediately poll task status on unlock / tab refocus (browser suspends
        // timers and kills EventSource connections during laptop sleep/lock)
        const onVisibilityChange = async () => {
            if (document.visibilityState === 'visible' && !completed) {
                // Reconnect SSE — the old connection is likely dead after sleep
                connectSSE();
                // Immediate poll so we don't wait for the next interval tick
                try {
                    const pRes = await fetch(`/api/image/task/${taskId}`);
                    if (pRes.ok) handleData(await pRes.json());
                } catch (_) {}
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        if (evtSource) evtSource.onmessage = (e) => { try { handleData(JSON.parse(e.data)); } catch (_) {} };

        let consecutiveFetchFailures = 0;
        pollTimer = setInterval(async () => {
            if (completed) return;
            try {
                const pRes = await fetch(`/api/image/task/${taskId}`);
                if (pRes.ok) {
                    consecutiveFetchFailures = 0;
                    handleData(await pRes.json());
                } else if (pRes.status === 404) {
                    consecutiveFetchFailures++;
                    if (consecutiveFetchFailures >= 5) {
                        finishFail('Task not found on backend (server may have restarted)');
                    }
                }
            } catch (_) {
                consecutiveFetchFailures++;
                if (consecutiveFetchFailures >= 15) {
                    finishFail('Backend server is unreachable or offline');
                }
            }
        }, 1500);
    });
}

export const tools = [
    {
        name: 'execute_terminal',
        description: 'Run non-interactive shell commands on the local machine (Linux).',
        instruction: 'Execute commands to inspect files, query system status, or check current date/time.',
        usageFormat: 'TOOL_CALL: execute_terminal(command_string)',
        execute: async (argsStr) => {
            // Remove bounding quotes if the model wrapped the command in quotes
            let cmd = argsStr.trim();
            if ((cmd.startsWith('"') && cmd.endsWith('"')) || (cmd.startsWith("'") && cmd.endsWith("'"))) {
                cmd = cmd.substring(1, cmd.length - 1);
            }

            if (!cmd) {
                return 'Error: No command provided to execute.';
            }

            try {
                const res = await executeTerminalAPI(cmd);
                let output = typeof res === 'string' ? res : (res?.output || res?.stdout || '');
                if (typeof res === 'object' && res.stderr && res.stderr.trim()) {
                    if (output && !output.includes(res.stderr.trim())) {
                        output += `\n[STDERR]\n${res.stderr.trim()}`;
                    }
                }
                if (!output || !output.trim()) {
                    output = '(Command executed with exit code 0, no output produced)';
                }
                return output.trim();
            } catch (err) {
                return `Execution error: ${err.message}`;
            }
        }
    },
    {
        name: 'end_conversation',
        description: 'Allows nivm to gracefully conclude the conversation if requested, or establish firm boundaries if interactions turn hostile.',
        instruction: 'Call this ONLY if the user is abusive/hostile or explicitly asks to end/stop the conversation. Provide a concise reason.',
        usageFormat: 'TOOL_CALL: end_conversation(reason)',
        execute: async (argsStr) => {
            let reason = argsStr ? argsStr.trim().replace(/^['"]|['"]$/g, '') : 'User requested or safety threshold reached.';
            return `Conversation ended: ${reason}`;
        }
    },
    {
        name: 'read_skill',
        description: 'Read the complete guidelines and instructions for a specific skill (e.g. "anime_generation", "image_studio", "terminal").',
        instruction: 'Call this when you need detailed parameter documentation, examples, or capabilities for a skill.',
        usageFormat: 'TOOL_CALL: read_skill(skill_name)',
        execute: async (argsStr) => {
            let skillId = (argsStr || '').trim();
            if (skillId.startsWith('{') && skillId.endsWith('}')) {
                try {
                    const parsed = JSON.parse(skillId);
                    skillId = parsed.skill || parsed.skill_name || parsed.id || parsed.name || skillId;
                } catch (_) {}
            }
            skillId = skillId.replace(/^['"\s\(\)]+|['"\s\(\)]+$/g, '').toLowerCase();
            if (!skillId) return 'Error: No skill specified to read. Available skills: anime_generation, image_studio, terminal';
            try {
                const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}`);
                if (!res.ok) return `Skill '${skillId}' not found. Available skills: anime_generation, image_studio, terminal`;
                const data = await res.json();
                return `[SKILL LOADED: ${data.name}]\n${data.content}`;
            } catch (err) {
                return `Failed to read skill '${skillId}': ${err.message}`;
            }
        }
    },
    {
        name: 'generate_anime_image',
        description: 'Synthesize an anime character illustration or anime artwork using Illustrious SDXL with character LoRAs.',
        instruction: 'Call this for ANY anime character (e.g. Orihime, Makima, Reze), waifu, or anime styled scene. Specify character key and prompt.',
        usageFormat: 'TOOL_CALL: generate_anime_image({"character": "character_key", "prompt": "scene description"})',
        execute: async (argsStr) => {
            let charKey = '';
            let outfit = null;
            let hairstyle = null;
            let expression = 'smile';
            let concept = 'none';
            let pose = 'none';
            let userPrompt = '';
            let useLcm = false;
            let resolution = 'portrait';

            let trimmed = (argsStr || '').trim();
            // Handle cases where small models wrap JSON in outer quotes: "{"..."}" or '{"..."}' or "{"...""
            if (/^['"]\s*\{/.test(trimmed)) {
                trimmed = trimmed.replace(/^['"]\s*/, '');
                trimmed = trimmed.replace(/['"\s]+$/, '');
            }
            // Auto-close JSON if small model omitted closing brace
            if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
                trimmed = trimmed.replace(/['"\s]+$/, '') + '}';
            }

            let parsed = null;
            if (trimmed.startsWith('{')) {
                try {
                    parsed = JSON.parse(trimmed);
                } catch (_) {
                    // Resilient fallback for small models: regex-extract keys if JSON.parse failed
                    const getField = (field) => {
                        const m = trimmed.match(new RegExp(`"${field}"\\s*:\\s*(?:"([^"]*)"|'([^']*)'|([^,}]+))`));
                        return m ? (m[1] ?? m[2] ?? m[3]?.trim()) : null;
                    };
                    const extractedChar = getField('character') || getField('char');
                    if (extractedChar) {
                        parsed = {
                            character: extractedChar,
                            outfit: getField('outfit'),
                            hairstyle: getField('hairstyle') || getField('hair'),
                            expression: getField('expression') || getField('expr'),
                            concept: getField('concept'),
                            pose: getField('pose'),
                            prompt: getField('prompt') || getField('user_prompt'),
                            resolution: getField('resolution') || getField('aspect_ratio'),
                            use_lcm: getField('use_lcm') === 'true' || getField('lcm') === 'true' || getField('turbo') === 'true'
                        };
                    }
                }
            }

            if (parsed) {
                charKey = parsed.character || parsed.char || '';
                outfit = parsed.outfit || null;
                hairstyle = parsed.hairstyle || parsed.hair || null;
                expression = parsed.expression || parsed.expr || 'smile';
                concept = parsed.concept || 'none';
                pose = parsed.pose || 'none';
                userPrompt = parsed.prompt || parsed.user_prompt || '';
                useLcm = !!parsed.use_lcm || !!parsed.turbo || !!parsed.lcm;
                resolution = parsed.resolution || parsed.aspect_ratio || 'portrait';
            } else {
                const parts = trimmed.match(/(?:[^\s,"']+|"[^"]*"|'[^']*')+/g) || [];
                const cleanParts = parts.map(p => p.trim().replace(/^['"]|['"]$/g, ''));
                if (cleanParts.length > 0) charKey = cleanParts[0].toLowerCase().replace(/\s+/g, '_');
                if (cleanParts.length > 1) userPrompt = cleanParts[1];
                if (cleanParts.length > 2) expression = cleanParts[2];
            }

            // Clean up literal placeholder text if a small model copied the system prompt example literally
            if (/rich scene and lighting description/i.test(userPrompt)) {
                userPrompt = '';
            }

            if (!charKey && _animeRegistryCache?.characters) {
                const keys = Object.keys(_animeRegistryCache.characters);
                if (keys.length > 0) charKey = keys[0];
            }

            if (!charKey) {
                charKey = 'none';
            }

            if (!useLcm && /\b(fast|faster|quick|turbo|lcm)\b/i.test(userPrompt)) {
                useLcm = true;
            }

            const titlePrefix = charKey && charKey !== 'none' ? `Anime (${charKey}):` : 'Anime:';
            const progressCard = createImageProgressCard(`${titlePrefix} ${userPrompt}`.trim(), false, resolution);
            mountImageProgressCard(progressCard.element);
            progressCard.update({ max_steps: useLcm ? 6 : 28 });

            try {
                const resp = await fetch('/api/image/anime/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        character: charKey,
                        hairstyle: hairstyle,
                        outfit: outfit,
                        expression: expression,
                        concept: concept,
                        pose: pose,
                        user_prompt: userPrompt,
                        resolution: resolution,
                        use_lcm: useLcm,
                    })
                });

                if (!resp.ok) {
                    const errData = await resp.json().catch(() => ({ detail: resp.statusText }));
                    throw new Error(errData.detail || `Server error ${resp.status}`);
                }

                const data = await resp.json();
                const taskId = data.task_id;
                if (!taskId) throw new Error('No task_id returned from server');
                progressCard.setTaskId(taskId);
                if (data.prompt) {
                    progressCard.setRawPrompt(data.prompt);
                }
                if (data.max_steps || data.steps) {
                    progressCard.update({ max_steps: data.max_steps || data.steps });
                }

                localStorage.setItem('nivm_pending_image_task', JSON.stringify({
                    taskId,
                    chatId: state.activeChatId,
                    command: 'generate_anime_image',
                    promptText: `${titlePrefix} ${userPrompt}`.trim(),
                    isEdit: false,
                    aspectRatio: resolution,
                    defaultFilename: 'anime_generated.png',
                    successDesc: 'Anime illustration synthesized successfully',
                    originalUrl: null,
                    startTime: Date.now()
                }));

                return await _trackImageTask(taskId, progressCard, 'anime_generated.png', 'Anime illustration synthesized successfully');
            } catch (err) {
                try {
                    const stored = JSON.parse(localStorage.getItem('nivm_pending_image_task') || 'null');
                    if (stored && stored.command === 'generate_anime_image') {
                        localStorage.removeItem('nivm_pending_image_task');
                    }
                } catch (_) {}
                progressCard.fail(err.message);
                return `[GENERATION FAILED] Anime generation failed: ${err.message}. No image was produced.`;
            }
        }
    },
    {
        name: 'generate_image',
        description: 'Synthesize a photorealistic, cinematic, or general real-world image (NON-ANIME) using local Qwen-Rapid diffusion model.',
        instruction: 'Call this for realistic photos, 3D renders, or real-world scenes. DO NOT call this for anime characters (use generate_anime_image instead).',
        usageFormat: 'TOOL_CALL: generate_image("prompt", "aspect_ratio")',
        execute: async (argsStr) => {
            let prompt = '';
            let aspectRatio = 'square';

            const trimmed = (argsStr || '').trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    prompt = parsed.prompt || '';
                    aspectRatio = normalizeAspectRatio(parsed.aspect_ratio, 'square');
                } catch (_) {}
            }

            if (!prompt) {
                const parts = trimmed.match(/(?:[^\s,"']+|"[^"]*"|'[^']*')+/g) || [];
                const cleanParts = parts.map(p => p.trim().replace(/^['"]|['"]$/g, ''));
                prompt = cleanParts[0] || trimmed;
                if (cleanParts.length > 1) {
                    aspectRatio = normalizeAspectRatio(cleanParts[1], 'square');
                }
            }

            const progressCard = createImageProgressCard(prompt, false, aspectRatio);
            mountImageProgressCard(progressCard.element);

            try {
                const resp = await fetch('/api/image/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt, aspect_ratio: aspectRatio })
                });

                if (!resp.ok) {
                    const errData = await resp.json().catch(() => ({ detail: resp.statusText }));
                    throw new Error(errData.detail || `Server error ${resp.status}`);
                }

                const data = await resp.json();
                const taskId = data.task_id;
                if (!taskId) throw new Error('No task_id returned from server');
                progressCard.setTaskId(taskId);
                if (data.prompt) {
                    progressCard.setRawPrompt(data.prompt);
                }
                if (data.max_steps || data.steps) {
                    progressCard.update({ max_steps: data.max_steps || data.steps });
                }

                localStorage.setItem('nivm_pending_image_task', JSON.stringify({
                    taskId,
                    chatId: state.activeChatId,
                    command: 'generate_image',
                    promptText: prompt,
                    isEdit: false,
                    aspectRatio: aspectRatio,
                    defaultFilename: 'generated.png',
                    successDesc: 'Image synthesized successfully',
                    originalUrl: null,
                    startTime: Date.now()
                }));

                return await _trackImageTask(taskId, progressCard, 'generated.png', 'Image synthesized successfully');
            } catch (err) {
                try {
                    const stored = JSON.parse(localStorage.getItem('nivm_pending_image_task') || 'null');
                    if (stored && stored.command === 'generate_image') {
                        localStorage.removeItem('nivm_pending_image_task');
                    }
                } catch (_) {}
                progressCard.fail(err.message);
                return `[GENERATION FAILED] Image generation failed: ${err.message}. No image was produced.`;
            }
        }
    },
    {
        name: 'edit_image',
        description: 'Edit or transform an existing attached or generated image using natural language instructions.',
        instruction: 'Call this whenever the user asks to alter, edit, modify, or transform an image. Pass the target image filename, the edit prompt instruction, and aspect_ratio (always pass "original" to preserve source dimensions unless the user explicitly asks for a format change).',
        usageFormat: 'TOOL_CALL: edit_image("image_filename", "prompt", "original")',
        execute: async (argsStr) => {
            let imageFilename = '';
            let prompt = '';
            let aspectRatio = 'original';
            let denoise = 0.85;

            const trimmed = (argsStr || '').trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    imageFilename = parsed.image_filename || parsed.filename || parsed.image || '';
                    prompt = parsed.prompt || parsed.instruction || '';
                    aspectRatio = normalizeAspectRatio(parsed.aspect_ratio, 'original');
                    if (parsed.denoise_strength !== undefined) denoise = parsed.denoise_strength;
                } catch (_) {}
            }

            if (!imageFilename || !prompt) {
                const parts = trimmed.match(/(?:[^\s,"']+|"[^"]*"|'[^']*')+/g) || [];
                const cleanParts = parts.map(p => p.trim().replace(/^['"]|['"]$/g, ''));
                if (cleanParts.length === 1) {
                    prompt = cleanParts[0] || '';
                    imageFilename = state.lastGeneratedImage || '';
                } else {
                    imageFilename = cleanParts[0] || '';
                    prompt = cleanParts[1] || '';
                    if (cleanParts.length > 2) {
                        const third = cleanParts[2].toLowerCase();
                        if (!isNaN(parseFloat(third)) && !third.includes(':')) {
                            denoise = parseFloat(third);
                        } else {
                            aspectRatio = normalizeAspectRatio(third, 'original');
                        }
                    }
                }
            }

            // Fallback resolution for generic pronouns or missing filenames
            const genericTerms = ['it', 'this', 'that', 'the image', 'image', 'latest', 'recent', 'current', 'last', 'photo', 'picture'];
            if (!imageFilename || genericTerms.includes(imageFilename.toLowerCase().trim())) {
                if (state.lastGeneratedImage) {
                    imageFilename = state.lastGeneratedImage;
                } else if (state.attachedImages && state.attachedImages.length > 0 && state.attachedImages[0].file) {
                    imageFilename = state.attachedImages[0].file.name;
                } else {
                    const activeChat = state.conversations?.find(c => c.id === state.activeChatId);
                    if (activeChat && activeChat.messages) {
                        for (let i = activeChat.messages.length - 1; i >= 0; i--) {
                            const content = activeChat.messages[i].content;
                            if (typeof content === 'string') {
                                const m = content.match(/\[(?:Generated|Attached)\s+Image:\s*([^\]]+)\]/i);
                                if (m && m[1]) {
                                    imageFilename = m[1].trim();
                                    break;
                                }
                            }
                        }
                    }
                }
                if (!imageFilename) {
                    imageFilename = 'latest';
                }
            }

            if (!prompt && imageFilename && !genericTerms.includes(imageFilename.toLowerCase().trim())) {
                prompt = imageFilename;
                imageFilename = state.lastGeneratedImage || 'latest';
            }

            const progressCard = createImageProgressCard(prompt, true, aspectRatio);
            mountImageProgressCard(progressCard.element);

            try {
                const resp = await fetch('/api/image/edit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image_filename: imageFilename,
                        prompt: prompt,
                        aspect_ratio: aspectRatio,
                        denoise_strength: denoise
                    })
                });

                if (!resp.ok) {
                    const errData = await resp.json().catch(() => ({ detail: resp.statusText }));
                    throw new Error(errData.detail || `Server error ${resp.status}`);
                }

                const data = await resp.json();
                const taskId = data.task_id;
                const origUrl = data.original_url || null;
                if (!taskId) throw new Error('No task_id returned from server');
                progressCard.setTaskId(taskId);
                if (data.prompt) {
                    progressCard.setRawPrompt(data.prompt);
                }
                if (data.max_steps || data.steps) {
                    progressCard.update({ max_steps: data.max_steps || data.steps });
                }

                localStorage.setItem('nivm_pending_image_task', JSON.stringify({
                    taskId,
                    chatId: state.activeChatId,
                    command: 'edit_image',
                    promptText: prompt,
                    isEdit: true,
                    aspectRatio: aspectRatio,
                    defaultFilename: 'edited.png',
                    successDesc: 'Image edited successfully',
                    originalUrl: origUrl,
                    startTime: Date.now()
                }));

                return await _trackImageTask(taskId, progressCard, 'edited.png', 'Image edited successfully', origUrl);
            } catch (err) {
                try {
                    const stored = JSON.parse(localStorage.getItem('nivm_pending_image_task') || 'null');
                    if (stored && stored.command === 'edit_image') {
                        localStorage.removeItem('nivm_pending_image_task');
                    }
                } catch (_) {}
                progressCard.fail(err.message);
                return `[GENERATION FAILED] Image editing failed: ${err.message}. No edited image was produced.`;
            }
        }
    }
];

/**
 * Analyzes a shell command to detect dangerous or destructive operations.
 * Returns { isDangerous: boolean, reasons: string[] }
 */
export function analyzeCommandSafety(command) {
    if (!command || typeof command !== 'string') {
        return { isDangerous: false, reasons: [] };
    }

    const trimmed = command.trim();
    const reasons = [];

    // 1. Pipe to shell or dynamic script execution
    if (/\|\s*(?:bash|sh|zsh|dash|ksh|fish|python|python3|perl|ruby)\b/i.test(trimmed)) {
        reasons.push('Pipes remote or dynamic output directly into a shell interpreter.');
    }

    // 2. Dangerous redirects to system or root configuration paths
    if (/>\s*(?:\/etc\/|\/dev\/|\/boot\/|\/usr\/|\/bin\/|\/sbin\/|\/lib|\/var\/|~?\/\.bash|~?\/\.profile|~?\/\.zsh|~?\/\.ssh|run\.sh)/i.test(trimmed)) {
        reasons.push('Redirects or overwrites critical system paths, root files, or shell startup scripts.');
    }

    // 3. Destructive git actions
    if (/\bgit\s+(?:reset\s+--hard|clean\s+-[a-zA-Z]*f|restore\s+\.|checkout\s+--\s+\.|push\s+.*--force)/i.test(trimmed)) {
        reasons.push('Executes destructive git operations that discard or force-rewrite repository history.');
    }

    // 4. Destructive package management
    if (/\b(?:apt|apt-get)\s+(?:remove|purge|autoremove)\b/i.test(trimmed)) {
        reasons.push('Uninstalls or purges system packages via apt/apt-get.');
    }
    if (/\bpacman\s+-[a-zA-Z]*[RU]\b/i.test(trimmed)) {
        reasons.push('Uninstalls system packages via pacman.');
    }
    if (/\b(?:dnf|yum|zypper)\b.*\b(?:remove|erase|rm)\b/i.test(trimmed)) {
        reasons.push('Uninstalls system packages.');
    }
    if (/\bpip3?\s+uninstall\b/i.test(trimmed)) {
        reasons.push('Uninstalls Python packages via pip.');
    }
    if (/\bnpm\s+(?:uninstall|remove|rm)\b/i.test(trimmed)) {
        reasons.push('Uninstalls Node.js packages via npm.');
    }

    // 5. Systemctl destructive actions
    if (/\bsystemctl\s+(?:stop|disable|restart|mask|daemon-reload|poweroff|reboot|isolate)\b/i.test(trimmed)) {
        reasons.push('Modifies, restarts, or stops system services via systemctl.');
    }

    // 6. Tokenize subcommands separated by ;, &&, ||, |, &, or newlines
    const subCommands = trimmed
        .replace(/\$\(([^)]+)\)/g, '; $1 ;')
        .replace(/`([^`]+)`/g, '; $1 ;')
        .split(/(?:[;&|]+|\n)/)
        .map(s => s.trim())
        .filter(Boolean);

    const DANGEROUS_BINARIES = {
        'rm': 'Permanently deletes files or directories (rm).',
        'srm': 'Securely removes/shreds files (srm).',
        'shred': 'Overwrites and shreds files permanently (shred).',
        'truncate': 'Truncates or destroys file contents (truncate).',
        'unlink': 'Deletes filesystem links or files (unlink).',
        'sudo': 'Executes with elevated superuser/root privileges (sudo).',
        'su': 'Switches user or elevates to root (su).',
        'doas': 'Executes commands with superuser privileges (doas).',
        'pkexec': 'Executes commands as root or administrator (pkexec).',
        'chmod': 'Modifies file system permissions (chmod).',
        'chown': 'Modifies file owner or group ownership (chown).',
        'chgrp': 'Modifies file group ownership (chgrp).',
        'setfacl': 'Modifies file access control lists (setfacl).',
        'dd': 'Performs raw drive/disk writes (dd).',
        'mkfs': 'Formats disk drives or filesystems (mkfs).',
        'fdisk': 'Alters disk partition tables (fdisk).',
        'gdisk': 'Alters GPT partition tables (gdisk).',
        'parted': 'Modifies disk partitions (parted).',
        'wipefs': 'Wipes filesystem partition signatures (wipefs).',
        'mount': 'Mounts filesystems (mount).',
        'umount': 'Unmounts filesystems (umount).',
        'kill': 'Sends termination signals to processes (kill).',
        'killall': 'Kills processes by executable name (killall).',
        'pkill': 'Kills processes by name or pattern (pkill).',
        'xkill': 'Force-kills desktop window processes (xkill).',
        'reboot': 'Reboots the host machine (reboot).',
        'shutdown': 'Powers down or halts the host machine (shutdown).',
        'poweroff': 'Powers off the system immediately (poweroff).',
        'halt': 'Halts the host hardware (halt).',
        'init': 'Changes system runlevel (init).',
        'telinit': 'Changes system runlevel (telinit).'
    };

    for (const sub of subCommands) {
        // Strip leading variable assignments like FOO=bar
        const tokens = sub.split(/\s+/).filter(t => t.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
        if (tokens.length === 0) continue;

        let binary = tokens[0].toLowerCase();
        if (binary.includes('/')) {
            binary = binary.split('/').pop();
        }

        if (binary.startsWith('mkfs')) {
            reasons.push('Formats disk drives or filesystems (mkfs).');
            continue;
        }

        if (DANGEROUS_BINARIES[binary]) {
            reasons.push(DANGEROUS_BINARIES[binary]);
        }

        // Subshell execution (e.g. bash -c "rm ...")
        if ((binary === 'bash' || binary === 'sh' || binary === 'zsh') && tokens.includes('-c')) {
            const inner = tokens.slice(tokens.indexOf('-c') + 1).join(' ');
            const innerSafety = analyzeCommandSafety(inner);
            if (innerSafety.isDangerous) {
                reasons.push(...innerSafety.reasons);
            }
        }
    }

    const uniqueReasons = [...new Set(reasons)];
    return {
        isDangerous: uniqueReasons.length > 0,
        reasons: uniqueReasons
    };
}

export const TOOL_SKILL_MAP = {
    'generate_anime_image': 'Anime Generation',
    'generate_image': 'Image Studio',
    'edit_image': 'Image Studio',
    'execute_terminal': 'Terminal',
    'read_skill': 'Skill Reader'
};

export function detectSkillsForPrompt(userPromptText) {
    if (!userPromptText || typeof userPromptText !== 'string') return [];
    const text = userPromptText.toLowerCase();
    const matched = [];

    // Dynamically match against registered anime characters
    let matchesRegisteredChar = false;
    if (_animeRegistryCache?.characters) {
        for (const [k, c] of Object.entries(_animeRegistryCache.characters)) {
            const charKeyWords = k.split('_');
            const dispWords = (c.display_name || '').toLowerCase().split(/\s+/);
            const allWords = [...new Set([...charKeyWords, ...dispWords])].filter(w => w.length > 2);
            for (const word of allWords) {
                const rx = new RegExp(`\\b${word}\\b`, 'i');
                if (rx.test(text)) {
                    matchesRegisteredChar = true;
                    break;
                }
            }
            if (matchesRegisteredChar) break;
        }
    }

    // Anime Generation triggers
    const isAnime = matchesRegisteredChar ||
        /\b(anime|waifu|manga|danbooru|illustrat\w*|orihime|makima|remi|chisato|reze|hori|waguri|asanagi|nikaidou)\b/i.test(text) ||
        /\bdraw\b.*?\banime\b/i.test(text) ||
        /\b2d\s+(girl|boy|art|character)\b/i.test(text);

    if (isAnime) {
        matched.push('anime_generation');
    }

    // Image Studio triggers (generation or editing)
    const isEdit = /\b(edit|modify|alter|transform|change|inpaint)\s+(this\s+|the\s+)?image\b/i.test(text) ||
        /\bchange\s+(her|his|their|the)\s+(outfit|clothes|hair|expression|background)\b/i.test(text) ||
        (state.lastGeneratedImage && /\b(edit|change|make her|add|remove|transform|fix|dress)\b/i.test(text));

    const isPhotorealOrGeneral = /\bphotoreal\w*\b/i.test(text) ||
        /\b(photo|picture)\s+of\b/i.test(text) ||
        /\brealistic\b/i.test(text) ||
        /\bcinematic\s+photo\b/i.test(text);

    const isNewImage = /\b(generate|create|render|paint|draw|make)\s+(an?\s+)?image\b/i.test(text);

    // Only include image_studio if it is an edit request OR if it's a non-anime new image request
    if (isEdit || (!isAnime && (isNewImage || isPhotorealOrGeneral))) {
        matched.push('image_studio');
    }

    // Terminal triggers
    if (/\b(terminal|shell|bash)\b/i.test(text) ||
        /\b(execute|run)\s+(command|script|shell)\b/i.test(text) ||
        /\b(what\s+is\s+the\s+)?(time|date)\b/i.test(text) ||
        /\b(system|server)\s+(specs|stats|info|status|uptime)\b/i.test(text) ||
        /\b(disk\s+space|free\s+memory|ram\s+usage)\b/i.test(text) ||
        /\bls\s+-/i.test(text) || /\bcat\s+\//i.test(text)) {
        matched.push('terminal');
    }

    return matched;
}

export function buildToolsInstruction(memoryKeys, enabledTools, isPendingResume = false) {
    let activeTools = tools.filter(t => enabledTools[t.name] !== false);
    if (isPendingResume) {
        activeTools = activeTools.filter(t => t.name !== 'end_conversation');
    }
    if (activeTools.length === 0) {
        return '';
    }

    const hasEndConvo = activeTools.some(t => t.name === 'end_conversation');

    let instruction = `\n\n[TOOLS & ACTIONS SYSTEM]\n`;
    instruction += `To call a tool, your entire message must output EXACTLY:\n`;
    instruction += `TOOL_CALL: tool_name(arguments)\n\n`;

    instruction += `Active Tools:\n`;
    activeTools.forEach(tool => {
        instruction += `- ${tool.name}: ${tool.description} -> ${tool.usageFormat}\n`;
    });

    if (hasEndConvo) {
        instruction += `\nConversation Closure Rules (end_conversation):\n`;
        instruction += `1. You have the authority to end the conversation using end_conversation only if the user is abusive/hostile or explicitly asks to end/stop.\n`;
        instruction += `2. Output: TOOL_CALL: end_conversation(reason)\n`;
    }

    instruction += `\n[AVAILABLE SKILLS SYSTEM]\n`;
    instruction += `Skills are modular on-demand capabilities. When you need parameter schemas, registered character keys (e.g. Orihime, Makima, Reze), or detailed instructions for any capability, call: TOOL_CALL: read_skill("skill_name")\n`;
    instruction += `Skills Catalog:\n`;
    instruction += `- anime_generation: Illustrious SDXL anime character & scene synthesis (supports registered anime characters, custom outfits, hairstyles, expressions, poses) [tool: generate_anime_image]\n`;
    instruction += `- image_studio: Qwen-Rapid photorealistic image generation (NON-ANIME) & universal image editing (realistic & anime) [tools: generate_image, edit_image]\n`;
    instruction += `- terminal: Host Linux shell command execution [tool: execute_terminal]\n`;

    instruction += `\nCRITICAL WORKFLOW & SELECTION RULES:\n`;
    instruction += `1. Anime Requests: For any anime character (e.g. Orihime, Makima) or anime-style artwork, call read_skill("anime_generation") first to read the character keys and parameter rules, then output TOOL_CALL: generate_anime_image(...). NEVER use generate_image for anime characters.\n`;
    instruction += `2. Real-World / Photorealistic Requests: For realistic photos or real-world scenes, use generate_image (or read_skill("image_studio")).\n`;
    instruction += `3. Universal Image Editing: To edit ANY existing image (realistic OR anime), use edit_image.\n`;
    instruction += `4. Single Turn Execution: Output only ONE tool call at a time. Do NOT describe the tool result before it is produced.\n`;

    return instruction;
}

/**
 * Robustly parses a tool call from model response text.
 * Handles standard "TOOL_CALL: name(args)", raw "name(args)", backticked, and XML-style formats.
 * Safely ignores tool mentions inside <think>...</think> blocks.
 */
export function parseToolCall(text, activeTools = tools) {
    if (!text) return null;
    const toolList = activeTools && activeTools.length > 0 ? activeTools : tools;
    const toolNames = toolList.map(t => t.name);
    const toolNamesPattern = toolNames.join('|');

    // 1. Separate thoughts from actionable content.
    // Normalize all model-specific tags first, then strip thoughts so they're NEVER parsed as tools.
    const normalizedForParse = normalizeThinkTags(text);
    const actionableText = normalizedForParse
        .replace(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(think|thought|reasoning)>[\s\S]*$/gi, '')
        .trim();

    if (!actionableText) return null;

    const explicitRegex = new RegExp(`(?:TOOL_CALL:|tool_call:|call:)\\s*(${toolNamesPattern})\\s*\\(([\\s\\S]*?)\\)`, 'i');
    const xmlRegex = new RegExp(`<function=(${toolNamesPattern})>[\\s\\S]*?<parameter=[^>]*>([\\s\\S]*?)<\\/parameter>`, 'i');

    // 2. Check for explicit TOOL_CALL: prefix anywhere in actionableText
    if (actionableText) {
        let match = actionableText.match(explicitRegex);
        if (match) {
            return {
                command: match[1].toLowerCase(),
                argsStr: match[2].trim(),
                fullMatch: match[0],
                index: text.indexOf(match[0])
            };
        }

        // 3. Check for XML format: <function=name> ... <parameter=...
        let xmlMatch = actionableText.match(xmlRegex);
        if (xmlMatch) {
            const fullXml = actionableText.match(/<tool_call>[\s\S]*?<\/tool_call>/i);
            const matchedSnippet = fullXml ? fullXml[0] : xmlMatch[0];
            return {
                command: xmlMatch[1].toLowerCase(),
                argsStr: xmlMatch[2].trim(),
                fullMatch: matchedSnippet,
                index: text.indexOf(matchedSnippet)
            };
        }

        // 4. Check for direct tool call outside <think> (e.g. read_memory(user_profile) or `read_memory(...)`)
        const directRegex = new RegExp(`(?:^|\\n|[\`\\s])\\s*(${toolNamesPattern})\\s*\\(([\\s\\S]*?)\\)(?:[\`\\s]|$)`, 'i');
        let directMatch = actionableText.match(directRegex);
        if (directMatch) {
            const matchedSnippet = directMatch[0].trim();
            return {
                command: directMatch[1].toLowerCase(),
                argsStr: directMatch[2].trim(),
                fullMatch: matchedSnippet,
                index: text.indexOf(matchedSnippet)
            };
        }
    }

    // 5. Fallback: If model emitted an explicit TOOL_CALL: or XML <tool_call> inside or after an unclosed <think> tag
    const fallbackMatch = text.match(explicitRegex);
    if (fallbackMatch) {
        return {
            command: fallbackMatch[1].toLowerCase(),
            argsStr: fallbackMatch[2].trim(),
            fullMatch: fallbackMatch[0],
            index: text.indexOf(fallbackMatch[0])
        };
    }

    let xmlMatchFallback = text.match(xmlRegex);
    if (xmlMatchFallback) {
        const fullXml = text.match(/<tool_call>[\s\S]*?<\/tool_call>/i);
        const matchedSnippet = fullXml ? fullXml[0] : xmlMatchFallback[0];
        return {
            command: xmlMatchFallback[1].toLowerCase(),
            argsStr: xmlMatchFallback[2].trim(),
            fullMatch: matchedSnippet,
            index: text.indexOf(matchedSnippet)
        };
    }

    return null;
}

/**
 * Strips tool calls from text so they do not leak into the user's visible bubble.
 * Preserves and properly seals the <think>...</think> block intact.
 */
export function stripToolCallFromText(text, activeTools = tools) {
    if (!text) return '';
    const toolList = activeTools && activeTools.length > 0 ? activeTools : tools;
    const toolNamesPattern = toolList.map(t => t.name).join('|');

    let thinkPart = '';
    let bodyPart = text;
    if (text.includes('</think>')) {
        const idx = text.indexOf('</think>') + 8;
        thinkPart = text.substring(0, idx);
        bodyPart = text.substring(idx);
    } else if (text.includes('<think>')) {
        // Unclosed think tag before tool call or end of text:
        // Everything up to tool call (or entire text) belongs inside thinking
        const toolRegex = new RegExp(`(?:TOOL_CALL:|tool_call:|call:)?\\s*(?:${toolNamesPattern})\\s*\\([\\s\\S]*?\\)|<tool_call>[\\s\\S]*?<\\/tool_call>|TOOL_CALL:.*$`, 'i');
        const toolMatch = text.match(toolRegex);
        if (toolMatch) {
            const toolIdx = text.indexOf(toolMatch[0]);
            thinkPart = text.substring(0, toolIdx).trim() + '\n</think>';
            bodyPart = text.substring(toolIdx);
        } else {
            thinkPart = text.trim() + '\n</think>';
            bodyPart = '';
        }
    }

    bodyPart = bodyPart.replace(new RegExp(`(?:TOOL_CALL:|tool_call:|call:)?\\s*(?:${toolNamesPattern})\\s*\\([\\s\\S]*?\\)`, 'gi'), '');
    bodyPart = bodyPart.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
    bodyPart = bodyPart.replace(/TOOL_CALL:.*$/gm, '');

    return (thinkPart + (thinkPart && bodyPart.trim() ? '\n\n' : '') + bodyPart.trim()).trim();
}

let _resumedTrackingTaskId = null;

export async function checkAndResumeActiveImageTask(targetChatId = null) {
    let pendingRaw = null;
    try {
        pendingRaw = localStorage.getItem('nivm_pending_image_task');
    } catch (_) {}
    if (!pendingRaw) return;

    let pending = null;
    try {
        pending = JSON.parse(pendingRaw);
    } catch (_) {
        localStorage.removeItem('nivm_pending_image_task');
        return;
    }

    if (!pending || !pending.taskId) {
        localStorage.removeItem('nivm_pending_image_task');
        return;
    }

    // Stale check (e.g. older than 2 hours)
    if (pending.startTime && (Date.now() - pending.startTime > 7200000)) {
        localStorage.removeItem('nivm_pending_image_task');
        return;
    }

    const currentChatId = targetChatId || state.activeChatId;

    // If currently tracking and progress card is already in DOM, do not re-mount
    if (_resumedTrackingTaskId === pending.taskId && document.querySelector('.image-gen-progress-card')) {
        return;
    }

    // Query backend for task status
    let taskData = null;
    try {
        const resp = await fetch(`/api/image/task/${pending.taskId}`, { cache: 'no-store' });
        if (resp.status === 404) {
            localStorage.removeItem('nivm_pending_image_task');
            return;
        }
        if (resp.ok) {
            taskData = await resp.json();
        }
    } catch (err) {
        console.warn('[Image-Resume] Error checking task status:', err);
        return;
    }

    if (!taskData) return;

    const chat = state.conversations?.find(c => c.id === (pending.chatId || currentChatId));
    if (!chat) {
        localStorage.removeItem('nivm_pending_image_task');
        return;
    }

    const status = taskData.status;

    const findAssistantMsg = () => {
        if (!chat.messages || chat.messages.length === 0) return null;
        for (let i = chat.messages.length - 1; i >= 0; i--) {
            const m = chat.messages[i];
            if (m.role === 'assistant') return m;
        }
        return null;
    };

    if (status === 'complete') {
        _resumedTrackingTaskId = null;
        localStorage.removeItem('nivm_pending_image_task');

        const imgData = taskData.result || taskData.image || { url: taskData.url, filename: taskData.filename };
        const imageUrl = imgData?.url || (imgData?.filename ? `/images/${imgData.filename}` : null);
        const filename = imgData?.filename || (imageUrl ? imageUrl.split('/').pop() : pending.defaultFilename);
        const durationSec = taskData.time_elapsed ? Number(taskData.time_elapsed).toFixed(1) : null;
        if (filename) state.lastGeneratedImage = filename;
        if (imageUrl && durationSec) saveImageDuration(imageUrl, durationSec);

        const durStr = durationSec ? ` (Duration: ${durationSec}s)` : '';
        const srcUrl = taskData.original_url || pending.originalUrl;
        const srcStr = srcUrl ? ` (original: ${srcUrl})` : '';
        const resultStr = `[GENERATION SUCCESSFUL: ${filename}]${durStr} ${pending.successDesc}: ${imageUrl}${srcStr} - Display this image to the user, note filename "${filename}", and describe the scene.`;

        const assistantMsg = findAssistantMsg();
        if (assistantMsg) {
            assistantMsg.toolExecution = {
                command: pending.command,
                argsStr: pending.promptText,
                resultStr: resultStr,
                imageUrl: imageUrl,
                imageFilename: filename,
                duration: durationSec ? parseFloat(durationSec) : null
            };
        }

        const hasSysMsg = chat.messages.some(m => typeof m.content === 'string' && m.content.startsWith('[SYSTEM NOTIFICATION]') && m.content.includes(filename || pending.command));
        if (!hasSysMsg) {
            const sysNotificationHeader = "[SYSTEM NOTIFICATION] Image generated successfully.";
            const toolAdvice = `IMPORTANT: Image processing succeeded. The image filename is "${filename}". The rendered image is already displayed in the UI. Describe the visual scene warmly in your active persona/character without mentioning technical file paths or markdown image tags. Note this filename: if the user later asks to edit, alter, or transform this image, call edit_image("${filename}", "<edit instruction>", "original").`;
            chat.messages.push({
                role: 'user',
                content: `${sysNotificationHeader} Result: ${resultStr}\n\n${toolAdvice}`
            });
        }

        saveConversations();

        if (state.activeChatId === (pending.chatId || currentChatId)) {
            if (window.renderActiveChat) window.renderActiveChat();
            const lastMsg = chat.messages[chat.messages.length - 1];
            if (lastMsg && typeof lastMsg.content === 'string' && lastMsg.content.startsWith('[SYSTEM NOTIFICATION]')) {
                if (typeof window.sendMessage === 'function') {
                    setTimeout(() => window.sendMessage(null, true), 150);
                }
            }
        }
        return;
    }

    if (status === 'interrupted' || status === 'error') {
        _resumedTrackingTaskId = null;
        localStorage.removeItem('nivm_pending_image_task');

        const isInterrupted = status === 'interrupted';
        const resultStr = isInterrupted
            ? `[GENERATION INTERRUPTED] Image processing was explicitly stopped/cancelled by the user. No image was generated.`
            : `[GENERATION FAILED] Image processing failed: ${taskData.error || 'Unknown error'}. No image was produced.`;

        const assistantMsg = findAssistantMsg();
        if (assistantMsg) {
            assistantMsg.toolExecution = {
                command: pending.command,
                argsStr: pending.promptText,
                resultStr: resultStr
            };
        }

        const hasSysMsg = chat.messages.some(m => typeof m.content === 'string' && m.content.startsWith('[SYSTEM NOTIFICATION]') && m.content.includes(pending.command));
        if (!hasSysMsg) {
            const sysNotificationHeader = isInterrupted
                ? "[SYSTEM NOTIFICATION] Image generation was CANCELLED / STOPPED by the user."
                : "[SYSTEM NOTIFICATION] Image generation FAILED.";
            const toolAdvice = isInterrupted
                ? "IMPORTANT: The user explicitly clicked STOP to cancel this image generation while it was running. No completed image was generated. Acknowledge that the generation was stopped as requested in your active persona/character. Do NOT describe or pretend an image was generated."
                : `IMPORTANT: Image generation failed due to an error. Inform the user in character that generation could not complete. Error details: ${resultStr}`;
            chat.messages.push({
                role: 'user',
                content: `${sysNotificationHeader} Result: ${resultStr}\n\n${toolAdvice}`
            });
        }

        saveConversations();
        if (state.activeChatId === (pending.chatId || currentChatId)) {
            if (window.renderActiveChat) window.renderActiveChat();
        }
        return;
    }

    // Actively running
    _resumedTrackingTaskId = pending.taskId;

    // Only mount progress card if currently viewing the target chat
    if (state.activeChatId === (pending.chatId || currentChatId)) {
        if (!document.querySelector('.image-gen-progress-card')) {
            const progressCard = createImageProgressCard(
                pending.promptText,
                pending.isEdit,
                pending.aspectRatio,
                pending.startTime
            );
            progressCard.setTaskId(pending.taskId);
            if (taskData.max_steps) {
                progressCard.update({ max_steps: taskData.max_steps });
            }
            mountImageProgressCard(progressCard.element);
            progressCard.update(taskData);

            _trackImageTask(
                pending.taskId,
                progressCard,
                pending.defaultFilename,
                pending.successDesc,
                pending.originalUrl
            ).then((resultStr) => {
                _resumedTrackingTaskId = null;
                localStorage.removeItem('nivm_pending_image_task');

                const imgMatch = resultStr.match(/(?:\/images\/|\/uploads\/)[^\s,)"';:]+/i);
                const imageUrl = imgMatch ? imgMatch[0].replace(/[.,:;]+$/, '') : null;
                const filename = imageUrl ? imageUrl.split('/').pop() : pending.defaultFilename;
                if (filename) state.lastGeneratedImage = filename;

                const durMatch = resultStr.match(/Duration:\s*([0-9.]+)\s*s/i);
                const durationSec = durMatch ? parseFloat(durMatch[1]) : null;

                const assistantMsg = findAssistantMsg();
                if (assistantMsg) {
                    assistantMsg.toolExecution = {
                        command: pending.command,
                        argsStr: pending.promptText,
                        resultStr: resultStr,
                        imageUrl: imageUrl,
                        imageFilename: filename,
                        duration: durationSec
                    };
                }

                const isSuccess = !resultStr.includes('[GENERATION INTERRUPTED]') && !resultStr.includes('[GENERATION FAILED]');
                const hasSysMsg = chat.messages.some(m => typeof m.content === 'string' && m.content.startsWith('[SYSTEM NOTIFICATION]') && m.content.includes(filename || pending.command));
                if (!hasSysMsg) {
                    let sysNotificationHeader = "[SYSTEM NOTIFICATION] Image generated successfully.";
                    let toolAdvice = `IMPORTANT: Image processing succeeded. The image filename is "${filename}". The rendered image is already displayed in the UI. Describe the visual scene warmly in your active persona/character without mentioning technical file paths or markdown image tags. Note this filename: if the user later asks to edit, alter, or transform this image, call edit_image("${filename}", "<edit instruction>", "original").`;

                    if (resultStr.includes('[GENERATION INTERRUPTED]')) {
                        sysNotificationHeader = "[SYSTEM NOTIFICATION] Image generation was CANCELLED / STOPPED by the user.";
                        toolAdvice = "IMPORTANT: The user explicitly clicked STOP to cancel this image generation while it was running. No completed image was generated. Acknowledge that the generation was stopped as requested in your active persona/character. Do NOT describe or pretend an image was generated.";
                    } else if (resultStr.includes('[GENERATION FAILED]')) {
                        sysNotificationHeader = "[SYSTEM NOTIFICATION] Image generation FAILED.";
                        toolAdvice = `IMPORTANT: Image generation failed due to an error. Inform the user in character that generation could not complete. Error details: ${resultStr}`;
                    }

                    chat.messages.push({
                        role: 'user',
                        content: `${sysNotificationHeader} Result: ${resultStr}\n\n${toolAdvice}`
                    });
                }

                saveConversations();

                if (isSuccess && state.activeChatId === (pending.chatId || currentChatId)) {
                    if (typeof window.sendMessage === 'function') {
                        setTimeout(() => window.sendMessage(null, true), 100);
                    }
                }
            });
        }
    }
}
window.checkAndResumeActiveImageTask = checkAndResumeActiveImageTask;

