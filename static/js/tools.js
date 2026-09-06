import { state } from './state.js';
import { saveMemoryAPI, executeTerminalAPI } from './api.js';

export const tools = [
    {
        name: 'read_memory',
        description: 'Read the stored value of a memory category (e.g., user_profile, user_hardware, user_preferences, user_projects).',
        instruction: 'Use to retrieve saved facts about the user from their categorical long-term memory.',
        usageFormat: 'TOOL_CALL: read_memory(category_name)',
        execute: async (argsStr) => {
            const key = argsStr.split(',')[0].trim().replace(/['"]/g, '');
            if (state.memory && state.memory[key] !== undefined) {
                return `Value for '${key}' is: ${state.memory[key]}`;
            } else {
                return `Memory category '${key}' not found. Available categories: ${Object.keys(state.memory || {}).join(', ') || 'none'}`;
            }
        }
    },
    {
        name: 'write_memory',
        description: 'Save or update structured facts in a memory category (e.g., user_profile, user_hardware, user_preferences, user_projects).',
        instruction: 'Save or update category facts. ALWAYS call read_memory first on the target category to merge new facts with existing data rather than overwriting.',
        usageFormat: 'TOOL_CALL: write_memory(category_name, merged_value)',
        execute: async (argsStr) => {
            const key = argsStr.split(',')[0].trim().replace(/['"]/g, '');
            const val = argsStr.substring(argsStr.indexOf(',') + 1).trim().replace(/^['"]|['"]$/g, '');
            await saveMemoryAPI(key, val);
            state.memory[key] = val;
            
            // Refresh memory UI if needed
            if (window.renderMemoryDrawer) window.renderMemoryDrawer();
            
            return `Successfully updated memory category '${key}'.`;
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
            return await executeTerminalAPI(cmd);
        }
    }
];

export function buildToolsInstruction(memoryKeys, enabledTools) {
    const activeTools = tools.filter(t => enabledTools[t.name] !== false);
    if (activeTools.length === 0) return '';
    
    const hasTerminal = activeTools.some(t => t.name === 'execute_terminal');
    const hasMemory = activeTools.some(t => t.name === 'read_memory' || t.name === 'write_memory');

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
        instruction += `4. READ BEFORE MODIFYING (CRITICAL):\n`;
        instruction += `   - Before updating any existing category, ALWAYS call read_memory(<category>) first to inspect existing facts.\n`;
        instruction += `   - Merge new information cleanly into the category (e.g. "University: Stanford | Major: CS | Year: Sophomore") and call write_memory with the complete merged value.\n`;
        instruction += `   - NEVER overwrite or wipe out prior facts unless the user explicitly asks to replace or delete them.\n`;
        instruction += `5. Examples (CRITICAL: Always use the exact TOOL_CALL: prefix):\n`;
        instruction += `   - User shares info about friends/people ("Remember my friend Dave") -> TOOL_CALL: read_memory(user_relationships)\n`;
        instruction += `   - User shares university info ("I study CS at Stanford") -> TOOL_CALL: read_memory(user_education)\n`;
        instruction += `   - User shares personal info ("My name is Alex") -> TOOL_CALL: read_memory(user_profile)\n`;
        instruction += `   - User shares hardware specs ("I have an RTX 3050 and 16GB RAM") -> TOOL_CALL: read_memory(user_hardware)\n`;
        instruction += `   - User asks what you know about them ("What do you know about me?") -> TOOL_CALL: read_memory(user_profile)\n`;
        instruction += `   - User asks to recall specific info ("Who are my friends?", "What is my major?") -> TOOL_CALL: read_memory(user_relationships) or TOOL_CALL: read_memory(user_education)\n`;
        instruction += `6. Seamless & Natural Dialogue (CRITICAL):\n`;
        instruction += `   - NEVER mention memory mechanics, memory files, keys, categories, or technical storage to the user.\n`;
        instruction += `   - NEVER say "I saved this to your profile memory", "stored in memory.json", or "updated category user_profile".\n`;
        instruction += `   - Respond naturally like a human or in character (e.g. "I'll remember that!", "Got it, noted!", or seamlessly continue the conversation).\n`;
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

    // 1. Separate thoughts from actionable content
    let actionableText = text;
    let offset = 0;
    if (text.includes('</think>')) {
        const parts = text.split('</think>');
        offset = text.indexOf('</think>') + 8;
        actionableText = parts.slice(1).join('</think>');
    }

    // 2. Check for explicit TOOL_CALL: prefix anywhere in actionableText
    const explicitRegex = new RegExp(`(?:TOOL_CALL:|tool_call:|call:)\\s*(${toolNamesPattern})\\s*\\(([\\s\\S]*?)\\)`, 'i');
    let match = actionableText.match(explicitRegex);
    if (match) {
        return {
            command: match[1].toLowerCase(),
            argsStr: match[2].trim(),
            fullMatch: match[0],
            index: offset + match.index
        };
    }

    // 3. Check for XML format: <function=name> ... <parameter=...
    const xmlRegex = new RegExp(`<function=(${toolNamesPattern})>[\\s\\S]*?<parameter=[^>]*>([\\s\\S]*?)<\\/parameter>`, 'i');
    let xmlMatch = actionableText.match(xmlRegex);
    if (xmlMatch) {
        const fullXml = actionableText.match(/<tool_call>[\s\S]*?<\/tool_call>/i);
        return {
            command: xmlMatch[1].toLowerCase(),
            argsStr: xmlMatch[2].trim(),
            fullMatch: fullXml ? fullXml[0] : xmlMatch[0],
            index: offset + (fullXml ? fullXml.index : xmlMatch.index)
        };
    }

    // 4. Check for direct tool call outside <think> (e.g. read_memory(user_profile) or `read_memory(...)`)
    const directRegex = new RegExp(`(?:^|\\n|[\`\\s])\\s*(${toolNamesPattern})\\s*\\(([\\s\\S]*?)\\)(?:[\`\\s]|$)`, 'i');
    let directMatch = actionableText.match(directRegex);
    if (directMatch) {
        return {
            command: directMatch[1].toLowerCase(),
            argsStr: directMatch[2].trim(),
            fullMatch: directMatch[0].trim(),
            index: offset + directMatch.index
        };
    }

    return null;
}

/**
 * Strips tool calls from text so they do not leak into the user's visible bubble.
 * Preserves the <think>...</think> block intact.
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
    }

    bodyPart = bodyPart.replace(new RegExp(`(?:TOOL_CALL:|tool_call:|call:)?\\s*(?:${toolNamesPattern})\\s*\\([\\s\\S]*?\\)`, 'gi'), '');
    bodyPart = bodyPart.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
    bodyPart = bodyPart.replace(/TOOL_CALL:.*$/gm, '');

    return (thinkPart + (thinkPart ? '\n\n' : '') + bodyPart.trim()).trim();
}
