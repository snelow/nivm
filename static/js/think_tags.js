/**
 * Centralized thinking-tag normalization for all model architectures.
 * 
 * Every model has its own way of marking chain-of-thought blocks.
 * This module normalizes ALL known formats to the canonical <think>...</think>
 * so the rest of the codebase only needs to handle one format.
 * 
 * 
 *  How to add a new model's thinking tags:
 * 
 * When a new model uses custom thinking tags (e.g. <|mystuff>reason),
 * you need to update 3 files. Here's exactly what to do:
 * 
 * 1. THIS FILE (static/js/think_tags.js):
 *    - Add a { regex: /.../, replace: '<think>' } to OPEN_TAGS
 *    - Add a { regex: /.../, replace: '</think>' } to CLOSE_TAGS
 *    - Add the raw open-tag string to KNOWN_OPEN_TAGS / RAW_OPEN_TAGS
 *    - Add the raw close-tag string to RAW_CLOSE_TAGS array
 * 
 * 2. BACKEND (core/chat_manager.py → _normalize_think_tags()):
 *    - Add re.sub() lines for both open and close tags (mirrors this file)
 * 
 * 3. ENGINE (core/engine.py → get_active_info() → PREFILL_MARKERS):
 *    - Add the open-tag string to the PREFILL_MARKERS list if the model's
 *      chat template pre-fills thinking in generation prompt.
 * 
 * Example — adding support for a hypothetical "FooModel" that uses
 *           <|begin_reason|> ... <|end_reason|>:
 * 
 *   think_tags.js OPEN_TAGS:        { regex: /<\|begin_reason\|>/gi, replace: '<think>' },
 *   think_tags.js CLOSE_TAGS:       { regex: /<\|end_reason\|>/gi,   replace: '</think>' },
 *   think_tags.js KNOWN_OPEN_TAGS:  '<|begin_reason|>'
 *   think_tags.js RAW_CLOSE_TAGS:   '<|end_reason|>'
 *   chat_manager.py open:           re.sub(r'<\|begin_reason\|>', '<think>', text, flags=re.IGNORECASE)
 *   chat_manager.py close:          re.sub(r'<\|end_reason\|>',  '</think>', text, flags=re.IGNORECASE)
 *   engine.py PREFILL_MARKERS:      "<|begin_reason|>"
 * 
 * That's it — stream token splitting and boundary buffering are handled automatically.
 */

// Opening tags
// Each regex maps a model-specific "start thinking" token → <think>
const OPEN_TAGS = [
    // Standard variants (QwQ, DeepSeek-R1, Phi-4, etc.)
    { regex: /<thought>/gi, replace: '<think>' },
    { regex: /<reasoning>/gi, replace: '<think>' },
    { regex: /<internal_thought>/gi, replace: '<think>' },

    // Gemma 4: <|channel>thought  or  <|channel|>thought (with optional whitespace / newline)
    { regex: /<\|channel\|?>\s*thought\s*\n?/gi, replace: '<think>' },
    { regex: /<\|channel>thought\n?/gi, replace: '<think>' },
    { regex: /<\|channel\|>thought\n?/gi, replace: '<think>' },

    // Mistral: [THINK]
    { regex: /\[THINK\]/gi, replace: '<think>' },

    // Llama-style: <|thinking|> or <|start_thinking|>
    { regex: /<\|thinking\|>/gi, replace: '<think>' },
    { regex: /<\|start_thinking\|>/gi, replace: '<think>' },
];

// Closing tags
// Each regex maps a model-specific "end thinking" token → </think>
const CLOSE_TAGS = [
    // Standard variants
    { regex: /<\/thought>/gi, replace: '</think>' },
    { regex: /<\/reasoning>/gi, replace: '</think>' },
    { regex: /<\/internal_thought>/gi, replace: '</think>' },

    // Gemma 4: <channel|>  or  <|channel|>model
    { regex: /<channel\|>/gi, replace: '</think>' },
    { regex: /<\|channel\|>model/gi, replace: '</think>' },
    { regex: /<\|channel\|>/gi, replace: '</think>' },

    // Mistral: [/THINK]
    { regex: /\[\/THINK\]/gi, replace: '</think>' },

    // Llama-style: <|/thinking|> or <|end_thinking|>
    { regex: /<\|\/thinking\|>/gi, replace: '</think>' },
    { regex: /<\|end_thinking\|>/gi, replace: '</think>' },
];

// Canonical list of known open tags (for token boundary buffering)
export const KNOWN_OPEN_TAGS = [
    '<think>',
    '<thought>',
    '<reasoning>',
    '<internal_thought>',
    '<|channel>thought',
    '<|channel|>thought',
    '[THINK]',
    '<|thinking|>',
    '<|start_thinking|>',
];

// Raw open-tag strings for direct .includes() fallback checks
export const RAW_OPEN_TAGS = [
    '<|channel>thought',
    '<|channel|>thought',
    '[THINK]',
    '<|thinking|>',
    '<|start_thinking|>',
];

// Raw close-tag strings for direct .includes() fallback checks
export const RAW_CLOSE_TAGS = [
    '<channel|>',
    '<|channel|>model',
    '<|channel|>',
    '[/THINK]',
    '<|/thinking|>',
    '<|end_thinking|>',
];

/**
 * Check if the given text (trimmed of leading whitespace) could be a prefix
 * of any known open tag. Used during stream IDLE phase to buffer split tokens.
 * 
 * @param {string} text - The accumulated idle text
 * @returns {boolean} True if text could be part of an open tag
 */
export function isPotentialOpenTagPrefix(text) {
    if (!text) return true;
    const trimmed = text.trimStart();
    if (!trimmed) return true; // Only whitespace/newlines so far; could be followed by tag
    return KNOWN_OPEN_TAGS.some(tag => tag.toLowerCase().startsWith(trimmed.toLowerCase()));
}

/**
 * Clean reasoning buffer by stripping leading open tags and trailing close tags.
 * Preserves the actual thoughts cleanly.
 * 
 * @param {string} text - Raw reasoning content
 * @returns {string} Cleaned thoughts
 */
export function cleanReasoningText(text) {
    if (!text) return '';
    return text
        .replace(/^(\s*<\|channel\|?>\s*thought\s*\n?|\s*<think>\s*)+/gi, '')
        .replace(/(\s*<\/think>\s*|\s*<channel\|>\s*)+$/gi, '')
        .trimStart();
}

/**
 * Normalize all model-specific thinking tags to <think>...</think>.
 * Safe to call on any text — chunks, full responses, or history content.
 * 
 * @param {string} text - The text to normalize
 * @returns {string} Text with all thinking tags converted to <think>/<\/think>
 */
export function normalizeThinkTags(text) {
    if (!text) return text;
    let result = text;
    for (const { regex, replace } of OPEN_TAGS) {
        result = result.replace(regex, replace);
    }
    for (const { regex, replace } of CLOSE_TAGS) {
        result = result.replace(regex, replace);
    }
    return result;
}

/**
 * Strip all known raw open tags from text (for cleaning reasoningBuffer chunks).
 * Removes the tag text entirely rather than converting it.
 * 
 * @param {string} text - The chunk text to clean
 * @returns {string} Text with raw open tags removed
 */
export function stripRawOpenTags(text) {
    if (!text) return text;
    let result = text;
    result = result.replace(/<think>/gi, '');
    for (const { regex } of OPEN_TAGS) {
        result = result.replace(regex, '');
    }
    return result;
}

/**
 * Check if text contains any raw (un-normalized) open thinking tag.
 * Used as a fallback when regex normalization may not have fired.
 * 
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function hasRawOpenTag(text) {
    if (!text) return false;
    return RAW_OPEN_TAGS.some(tag => text.includes(tag));
}

/**
 * Check if text contains any raw (un-normalized) close thinking tag.
 * 
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function hasRawCloseTag(text) {
    if (!text) return false;
    return RAW_CLOSE_TAGS.some(tag => text.includes(tag));
}

/**
 * Normalize raw close tags in text to </think> for consistent splitting.
 * 
 * @param {string} text - Text to normalize
 * @returns {string} Text with raw close tags converted to </think>
 */
export function normalizeCloseTag(text) {
    if (!text) return text;
    let result = text;
    for (const { regex, replace } of CLOSE_TAGS) {
        result = result.replace(regex, replace);
    }
    return result;
}
