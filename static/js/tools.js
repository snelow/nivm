import { state } from './state.js';
import { saveMemoryAPI, executeTerminalAPI } from './api.js';
import { createImageProgressCard } from './image_editor.js';
import { normalizeThinkTags } from './think_tags.js';

function mountImageProgressCard(cardElement) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    // Attach card directly to active assistant message wrapper below thinking bubble
    const lastAssistantRow = container.querySelector('.message-row.assistant-row:last-of-type');
    const assistantWrapper = lastAssistantRow ? lastAssistantRow.querySelector('.message-wrapper') : null;
    const assistantBubble = assistantWrapper ? assistantWrapper.querySelector('.message-bubble') : null;

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

        pollTimer = setInterval(async () => {
            if (completed) return;
            try {
                const pRes = await fetch(`/api/image/task/${taskId}`);
                if (pRes.ok) handleData(await pRes.json());
            } catch (_) {}
        }, 1500);
    });
}

export const tools = [
    {
        name: 'read_memory',
        description: 'MANDATORY STEP 1 when saving new facts or recalling info. Inspects existing facts in a category.',
        instruction: 'ALWAYS call this first when the user shares any info to remember, so you can inspect existing facts before writing.',
        usageFormat: 'TOOL_CALL: read_memory(category_name)',
        execute: async (argsStr) => {
            const key = argsStr.split(',')[0].trim().replace(/['"]/g, '');
            recentlyReadKeys.add(key.toLowerCase());
            
            if (state.memory && state.memory[key] !== undefined && state.memory[key] !== null && String(state.memory[key]).trim() !== '') {
                return `Value for '${key}' is: ${state.memory[key]}. [NEXT STEP: Combine this existing data with the user's new information, then call write_memory('${key}', <complete_merged_value>)]`;
            } else {
                return `Memory category '${key}' is currently empty. [NEXT STEP: Call write_memory('${key}', <value>) to save the information]`;
            }
        }
    },
    {
        name: 'write_memory',
        description: 'STEP 2 ONLY: Commit complete merged facts to a memory category AFTER calling read_memory.',
        instruction: 'Write the complete, merged facts to a category. NEVER call this without calling read_memory first on existing categories.',
        usageFormat: 'TOOL_CALL: write_memory(category_name, merged_value)',
        execute: async (argsStr) => {
            const key = argsStr.split(',')[0].trim().replace(/['"]/g, '');
            let val = argsStr.substring(argsStr.indexOf(',') + 1).trim().replace(/^['"]|['"]$/g, '');
            const normKey = key.toLowerCase();

            const existingVal = state.memory && state.memory[key] !== undefined && state.memory[key] !== null ? String(state.memory[key]).trim() : '';

            // If the category already has existing facts, verify the model inspected it first
            if (existingVal !== '') {
                const wasRead = recentlyReadKeys.has(normKey);
                // If it was never read in this message turn and does not include the existing facts:
                if (!wasRead && !val.includes(existingVal)) {
                    return `Error: Cannot overwrite existing category '${key}'. It already contains stored facts: "${existingVal}". You MUST call read_memory('${key}') first to inspect existing facts before updating.`;
                }

                // Auto-merge safety net to guarantee prior facts are never erased
                val = mergeMemoryValues(existingVal, val);
            }

            // Successfully processed: clear read state for this category
            recentlyReadKeys.delete(normKey);

            await saveMemoryAPI(key, val);
            state.memory[key] = val;
            
            // Refresh memory UI if needed
            if (window.renderMemoryDrawer) window.renderMemoryDrawer();
            
            return `Successfully updated memory category '${key}'. Current stored value: ${val}`;
        }
    },
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
        name: 'generate_anime_image',
        description: 'Synthesize an anime character illustration using the local Illustrious SDXL engine with character LoRAs, outfits, and styling.',
        instruction: 'Call this when the user asks to draw or generate an anime character. Specify the character key from the live registered characters list, and optional outfit, expression, hairstyle, concept, pose, prompt details, and aspect ratio.',
        usageFormat: 'TOOL_CALL: generate_anime_image("character_key", "prompt_details", "expression")',
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
            if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.includes('{'))) {
                trimmed = trimmed.substring(1, trimmed.length - 1).trim();
            }
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    charKey = parsed.character || parsed.char || '';
                    outfit = parsed.outfit || null;
                    hairstyle = parsed.hairstyle || parsed.hair || null;
                    expression = parsed.expression || parsed.expr || 'smile';
                    concept = parsed.concept || 'none';
                    pose = parsed.pose || 'none';
                    userPrompt = parsed.prompt || parsed.user_prompt || '';
                    useLcm = !!parsed.use_lcm || !!parsed.turbo || !!parsed.lcm;
                    resolution = parsed.resolution || parsed.aspect_ratio || 'portrait';
                } catch (_) {}
            } else {
                const parts = trimmed.match(/(?:[^\s,"']+|"[^"]*"|'[^']*')+/g) || [];
                const cleanParts = parts.map(p => p.trim().replace(/^['"]|['"]$/g, ''));
                if (cleanParts.length > 0) charKey = cleanParts[0].toLowerCase().replace(/\s+/g, '_');
                if (cleanParts.length > 1) userPrompt = cleanParts[1];
                if (cleanParts.length > 2) expression = cleanParts[2];
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
                if (data.max_steps || data.steps) {
                    progressCard.update({ max_steps: data.max_steps || data.steps });
                }

                return await _trackImageTask(taskId, progressCard, 'anime_generated.png', 'Anime illustration synthesized successfully');
            } catch (err) {
                progressCard.fail(err.message);
                return `[GENERATION FAILED] Anime generation failed: ${err.message}. No image was produced.`;
            }
        }
    },
    {
        name: 'generate_image',
        description: 'Synthesize a new image from pure text description using local Qwen-Rapid diffusion model.',
        instruction: 'Call this whenever the user asks to draw, generate, or create an image from text. Pass the descriptive prompt and optional aspect_ratio ("square", "portrait", "landscape", "1:1", "16:9", "9:16").',
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
                if (data.max_steps || data.steps) {
                    progressCard.update({ max_steps: data.max_steps || data.steps });
                }

                return await _trackImageTask(taskId, progressCard, 'generated.png', 'Image synthesized successfully');
            } catch (err) {
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
                if (data.max_steps || data.steps) {
                    progressCard.update({ max_steps: data.max_steps || data.steps });
                }

                return await _trackImageTask(taskId, progressCard, 'edited.png', 'Image edited successfully', origUrl);
            } catch (err) {
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

export function buildToolsInstruction(memoryKeys, enabledTools, isPendingResume = false) {
    let activeTools = tools.filter(t => enabledTools[t.name] !== false);
    if (isPendingResume) {
        activeTools = activeTools.filter(t => t.name !== 'end_conversation');
    }
    if (activeTools.length === 0) return '';
    
    const hasTerminal = activeTools.some(t => t.name === 'execute_terminal');
    const hasMemory = activeTools.some(t => t.name === 'read_memory' || t.name === 'write_memory');
    const hasEndConvo = activeTools.some(t => t.name === 'end_conversation');
    const hasImageTools = activeTools.some(t => t.name === 'generate_image' || t.name === 'edit_image');
    const hasAnimeTools = activeTools.some(t => t.name === 'generate_anime_image');

    let instruction = `\n\n[TOOLS & ACTIONS SYSTEM]\n`;
    instruction += `To call a tool, your entire message must output EXACTLY:\n`;
    instruction += `TOOL_CALL: tool_name(arguments)\n\n`;

    instruction += `Active Tools:\n`;
    activeTools.forEach(tool => {
        instruction += `- ${tool.name}: ${tool.description} -> ${tool.usageFormat}\n`;
    });

    if (hasTerminal) {
        instruction += `\nTerminal Execution Rules:\n`;
        instruction += `1. You are running locally on the user's host machine. Terminal access is ENABLED.\n`;
        instruction += `2. NEVER say you lack real-time access or cannot check the current time, date, files, or system info.\n`;
        instruction += `3. When the user asks for live machine information or actions, IMMEDIATELY call the terminal:\n`;
        instruction += `   - "What time is it?" -> TOOL_CALL: execute_terminal(date)\n`;
        instruction += `   - "What files are in this folder?" -> TOOL_CALL: execute_terminal(ls -la)\n`;
        instruction += `   - "Show system stats" -> TOOL_CALL: execute_terminal(uptime && free -h)\n`;
        instruction += `4. User Visibility: The user CANNOT see raw terminal output directly! You MUST always state, summarize, or explain the terminal output and findings to the user in your response.\n`;
        instruction += `5. Empty Output Handling: If the terminal command returns empty or no stdout, you MUST explicitly state to the user that the command ran cleanly with exit code 0 and explain why it produced no output (e.g. silent command, file/directory created, or no matching items).\n`;
    }

    if (hasMemory) {
        instruction += `\nMemory Organization & Categorization Rules:\n`;
        instruction += `1. Long-term memory is organized strictly into cohesive, topic-based CATEGORIES. NEVER create fragmented one-off micro-keys (e.g. do NOT create 'username', 'bday', 'gpu', 'university').\n`;
        instruction += `2. Categories are completely EXTENSIBLE—you are NOT restricted to a fixed list. Choose or create the best category for the topic:\n`;
        instruction += `   - 'user_profile': Identity, name, birthday, age, location, personal background.\n`;
        instruction += `   - 'user_relationships': Friends, family, partner, social circle, colleagues, people in the user's life. (CRITICAL: Always file friends or people here—NEVER put friends or people in 'user_hobbies'!).\n`;
        instruction += `   - 'user_education': University/college, major, degree, courses, graduation year, academic goals.\n`;
        instruction += `   - 'user_hardware': OS, CPU, GPU, RAM, display, peripherals, machine environment.\n`;
        instruction += `   - 'user_projects': Active projects, repositories, tech stacks, current goals.\n`;
        instruction += `   - 'user_preferences': Coding style, favorite editors/languages, formatting, workflow habits, conversational tone.\n`;
        instruction += `   - 'user_hobbies': Pastimes, gaming, music, sports, creative arts, leisure activities (activities only, NOT people or friends!).\n`;
        instruction += `   - Create new categories when appropriate (e.g. 'user_work' for career/employment, 'user_health', etc.).\n`;
        instruction += `3. Currently stored categories: ${memoryKeys.length > 0 ? memoryKeys.join(', ') : 'none yet'}.\n`;
        instruction += `4. TWO-STEP MEMORY PROTOCOL (MANDATORY - NEVER SKIP STEP 1):\n`;
        instruction += `   - Whenever the user shares ANY information to remember ("Remember my name is...", "Also remember my username is...", "I study CS", "I have an RTX 3050"), you MUST FIRST call read_memory(<category>)!\n`;
        instruction += `   - NEVER call write_memory directly on the user's message without reading first! Direct write_memory calls on existing categories will be REJECTED by the system to protect prior facts.\n`;
        instruction += `   - Once you receive the read_memory result, combine existing facts with the new fact into a complete, comprehensive record, and only then call write_memory(<category>, <complete_merged_value>).\n`;
        instruction += `5. Turn-by-Turn Memory Examples (CRITICAL: Follow this exact two-step flow):\n`;
        instruction += `   - Turn 1: User says "Remember my name is Alex"\n`;
        instruction += `     -> Assistant: TOOL_CALL: read_memory(user_profile)\n`;
        instruction += `     -> System returns: Memory category 'user_profile' is currently empty.\n`;
        instruction += `     -> Assistant: TOOL_CALL: write_memory(user_profile, {"name": "Alex"})\n`;
        instruction += `   - Turn 2: User says "Also remember my handle/username is alex_dev"\n`;
        instruction += `     -> Assistant: TOOL_CALL: read_memory(user_profile)\n`;
        instruction += `     -> System returns: Value for 'user_profile' is: {"name": "Alex"}\n`;
        instruction += `     -> Assistant: TOOL_CALL: write_memory(user_profile, {"name": "Alex", "username": "alex_dev"})\n`;
        instruction += `   - User asks "What is my username?":\n`;
        instruction += `     -> Assistant: TOOL_CALL: read_memory(user_profile)\n`;
        instruction += `6. Seamless & Natural Dialogue (CRITICAL):\n`;
        instruction += `   - NEVER mention memory mechanics, memory files, keys, categories, or technical storage to the user.\n`;
        instruction += `   - NEVER say "I saved this to your profile memory", "stored in memory.json", or "updated category user_profile".\n`;
        instruction += `   - Respond naturally like a human or in character (e.g. "I'll remember that!", "Got it, noted!", or seamlessly continue the conversation).\n`;
    }

    if (hasEndConvo) {
        instruction += `\nConversation Closure Rules (end_conversation):\n`;
        instruction += `1. You have the dignity, autonomy, and authority to end the conversation using end_conversation under two specific circumstances:\n`;
        instruction += `   - Circumstance A (Abuse / Hostility): The user is being abusive, excessively hostile, vulgar, or harassing you. Establish a firm boundary in character and call end_conversation.\n`;
        instruction += `   - Circumstance B (User Requested): The user explicitly asks to end, stop, or conclude the conversation (e.g. "let's end this conversation", "stop talking to me", "we're done here, goodbye").\n`;
        instruction += `2. NEVER call end_conversation for normal questions, curious inquiries, playful banter, or technical challenges.\n`;
        instruction += `3. When calling end_conversation, provide a brief reason: TOOL_CALL: end_conversation(reason).\n`;
        instruction += `4. After the tool executes, deliver a short, final parting remark in character (or firm boundary if abusive), then conclude.\n`;
    }

    if (hasImageTools) {
        instruction += `\nImage Generation & Editing Rules (generate_image, edit_image):\n`;
        if (state.lastGeneratedImage) {
            instruction += `   - ACTIVE IMAGE IN CONVERSATION: "${state.lastGeneratedImage}". Pass "${state.lastGeneratedImage}" as the first argument to edit_image whenever the user asks to modify, alter, or edit it.\n`;
        }
        instruction += `1. When the user asks to create, draw, paint, or generate an image:\n`;
        instruction += `   - Expand the user's brief request into a vivid, highly detailed visual prompt (specify subject features, environment/backdrop, lighting, mood, color palette, camera shot/angle, and photorealism or art style).\n`;
        instruction += `   - Pick the appropriate aspect_ratio: "1:1" (square/default), "16:9" (cinematic/landscape), "9:16" (mobile/portrait), or "4:3".\n`;
        instruction += `   - Output: TOOL_CALL: generate_image("detailed prompt", "aspect_ratio")\n`;
        instruction += `2. When the user asks to edit, alter, or transform an attached or previously generated image:\n`;
        instruction += `   - Identify the source image filename from [Attached Image: filename] or [Generated Image: filename] (current active image: "${state.lastGeneratedImage || 'none'}").\n`;
        instruction += `   - If Vision is available, inspect the visual context (subject, pose, lighting, background) and formulate an edit prompt specifying the exact changes while preserving the core subject and composition.\n`;
        instruction += `   - ALWAYS use "original" for aspect_ratio to preserve the source image's exact dimensions and orientation, unless the user explicitly requested a format change (e.g. "make it widescreen 16:9").\n`;
        instruction += `   - Output: TOOL_CALL: edit_image("filename", "instruction describing the transformation", "original")\n`;
        instruction += `3. Post-Generation Response & Visual Description (MANDATORY):\n`;
        instruction += `   - The rendered image is displayed automatically in the UI. Do NOT output raw file URLs, markdown images, or HTML tags.\n`;
        instruction += `   - Describe the resulting visual scene to the user warmly in your active persona/character—highlight the atmosphere, lighting, key artistic details, and textures, and invite them to explore further edits or variations!\n`;
    }

    if (hasAnimeTools) {
        instruction += `\nAnime Character Illustration Engine (generate_anime_image):\n`;
        instruction += `1. Engine Capabilities & Live Registry:\n`;
        instruction += `   - You have access to a local Illustrious SDXL engine with dynamic character LoRA chaining.\n`;

        const characters = _animeRegistryCache?.characters || {};
        const charKeys = Object.keys(characters);

        if (charKeys.length > 0) {
            instruction += `   - Currently Registered Characters & Available Options:\n`;
            charKeys.forEach(k => {
                const c = characters[k];
                const outfits = Object.keys(c.outfits || {});
                const hairstyles = c.hairstyles ? Object.keys(c.hairstyles) : [];
                let details = `     * ${c.display_name} (key: "${k}")`;
                if (outfits.length > 0) details += ` | outfits: [${outfits.join(', ')}]`;
                if (hairstyles.length > 0) details += ` | hairstyles: [${hairstyles.join(', ')}]`;
                instruction += `${details}\n`;
            });
        } else {
            instruction += `   - Registered Characters: None loaded yet. You can still generate anime illustrations using the base Illustrious engine by setting 'character': 'none'!\n`;
        }

        const concepts = Object.keys(_animeRegistryCache?.concepts || {}).filter(k => k !== 'none');
        if (concepts.length > 0) {
            instruction += `   - Available Concepts: [${concepts.join(', ')}]\n`;
        }

        const poses = Object.keys(_animeRegistryCache?.poses || {}).filter(k => k !== 'none');
        if (poses.length > 0) {
            instruction += `   - Available Poses: [${poses.join(', ')}]\n`;
        }

        const exprs = Object.keys(_animeRegistryCache?.expressions || {}).filter(k => k !== 'none');
        if (exprs.length > 0) {
            instruction += `   - Common Expressions: [${exprs.slice(0, 16).join(', ')}]\n`;
        }

        instruction += `2. Calling generate_anime_image:\n`;
        instruction += `   - Always specify a single subject. If characters are registered, pick a valid character and outfit. If no characters exist or general anime illustration is requested, use 'character': 'none'.\n`;
        instruction += `   - Use JSON format with the character's key: TOOL_CALL: generate_anime_image('{"character": "character_key", "outfit": "outfit_key", "expression": "smile", "prompt": "rich scene and lighting description"}')\n`;
        instruction += `   - Concepts & Poses: Only pass concept or pose when explicitly requested by the user. If unrequested, omit them.\n`;
        instruction += `   - Fast/Turbo Mode: Set "use_lcm": true if the user requests fast or quick generation (8 steps).\n`;
        instruction += `   - User Inquiry: When the user asks what anime characters or outfits are available, report the live list above accurately.\n`;
    }

    instruction += `\nCRITICAL TOOL SYNTAX RULES:\n`;
    instruction += `1. To call a tool, you MUST output the exact syntax:\n`;
    instruction += `   TOOL_CALL: tool_name(arguments)\n`;
    instruction += `2. NEVER output tool names like 'read_memory(...)' alone without the 'TOOL_CALL: ' prefix.\n`;
    instruction += `3. Output only ONE tool call at a time.\n`;
    instruction += `4. Tool usage must NEVER break your persona or tone. Embody your persona consistently before, during, and after tool calls.\n`;

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
