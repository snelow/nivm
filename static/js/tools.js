import { state } from './state.js';
import { saveMemoryAPI } from './api.js';

export const tools = [
    {
        name: 'read_memory',
        description: 'Read the contents of a specific memory key.',
        instruction: 'IF you need to recall facts from the available keys, you MUST use the read tool BEFORE responding.\nNEVER assume you know the contents of a memory key without reading it first. Even if you think it\'s empty, you MUST call read_memory to verify!',
        usageFormat: 'TOOL_CALL: read_memory(key_name)',
        execute: async (argsStr) => {
            const key = argsStr.split(',')[0].trim().replace(/['"]/g, '');
            if (state.memory && state.memory[key] !== undefined) {
                return `Value for '${key}' is: ${state.memory[key]}`;
            } else {
                return `Memory key '${key}' not found.`;
            }
        }
    },
    {
        name: 'write_memory',
        description: 'Save or update factual information to a specific memory key.',
        instruction: 'IF the user asks you to remember, save, or update information, you MUST use the write tool BEFORE responding.\nIMPORTANT: If you are updating an existing key, you MUST first read the memory key to check its current value, so you can merge or append the new information without accidentally deleting existing details!\nIMPORTANT: When writing values, extract ONLY the pure factual information. IGNORE conversational filler and slang (e.g. "as well", "asw", "also", "instead", "you can call me"). BUT, if the user provides multiple factual details (e.g., a real name AND a nickname, or multiple skills), you MUST preserve all of them in the value.',
        usageFormat: 'TOOL_CALL: write_memory(key_name, value_to_save)',
        execute: async (argsStr) => {
            const key = argsStr.split(',')[0].trim().replace(/['"]/g, '');
            const val = argsStr.substring(argsStr.indexOf(',') + 1).trim().replace(/^['"]|['"]$/g, '');
            await saveMemoryAPI(key, val);
            state.memory[key] = val;
            
            // Refresh memory UI if needed
            if (window.renderMemoryDrawer) window.renderMemoryDrawer();
            
            return `Successfully updated memory key '${key}'.`;
        }
    }
];

export function buildToolsInstruction(memoryKeys, enabledTools) {
    const activeTools = tools.filter(t => enabledTools[t.name] !== false);
    if (activeTools.length === 0) return '';
    
    let instruction = `\n\n[CRITICAL INSTRUCTION: TOOLS SYSTEM]\n`;
    instruction += `You have access to the following tools. If you need to use a tool, you must output EXACTLY the usage format.\n\n`;
    
    // Add memory context since tools heavily depend on it right now
    instruction += `Available memory keys you can read/write: ${memoryKeys.length > 0 ? memoryKeys.join(', ') : 'none yet'}.\n\n`;
    
    activeTools.forEach(tool => {
        instruction += `--- TOOL: ${tool.name} ---\n`;
        instruction += `Description: ${tool.description}\n`;
        instruction += `Instructions: ${tool.instruction}\n`;
        instruction += `Usage Format: ${tool.usageFormat}\n\n`;
    });
    
    instruction += `EXAMPLES OF CORRECT BEHAVIOR:\n`;
    instruction += `User: "I also know Python"\n`;
    instruction += `Assistant: TOOL_CALL: write_memory(user_skills, Python)\n`;
    instruction += `User: "What's my name?"\n`;
    instruction += `Assistant: TOOL_CALL: read_memory(user_name)\n\n`;
    
    return instruction;
}
