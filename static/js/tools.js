import { state } from './state.js';
import { saveMemoryAPI, executeTerminalAPI } from './api.js';

const recentlyReadKeys = new Set();

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

            const securityMode = state.terminalSecurityMode || 'dangerous';
            let needsPermission = false;
            let safetyReport = { isDangerous: false, reasons: [] };

            if (securityMode === 'always') {
                needsPermission = true;
                safetyReport = analyzeCommandSafety(cmd);
            } else if (securityMode === 'dangerous') {
                safetyReport = analyzeCommandSafety(cmd);
                if (safetyReport.isDangerous) {
                    needsPermission = true;
                }
            }

            if (needsPermission) {
                if (typeof window.promptTerminalPermission === 'function') {
                    const allowed = await window.promptTerminalPermission(cmd, safetyReport.reasons);
                    if (!allowed) {
                        return `Command execution denied by user: Permission was not granted to run '${cmd}'.`;
                    }
                }
            }

            return await executeTerminalAPI(cmd);
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
        instruction += `4. The user CANNOT see raw terminal output. When you receive the tool result, you MUST convey and explain the results to the user while staying in character.\n`;
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
    // Strip all completed thoughts (<think>...</think>, <thought>...</thought>, <reasoning>...</reasoning>)
    // AND strip any currently streaming unclosed thought (<think>...) so private reasoning is NEVER parsed as tools.
    const actionableText = text
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
