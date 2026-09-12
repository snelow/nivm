/* memory drawer */

import { state } from '../state.js';
import { dom } from '../dom.js';
import { escapeHtml, showNotification, showConfirm } from '../modals/dialogs.js';

export function renderMemoryDrawer() {
    dom.memoryList.innerHTML = '';
    const keys = Object.keys(window.__nivm_state.memory || {});
    if (keys.length === 0) {
        dom.memoryList.innerHTML = '<div style="padding: 16px; color: var(--text-tertiary); text-align: center;">No memories saved yet. Ask nivm to remember something!</div>';
        return;
    }

    function getCategoryMeta(key) {
        const lower = key.toLowerCase();
        const CATEGORY_META = {
            user_profile: { label: 'User Profile', icon: 'fa-solid fa-user', color: '#6366f1' },
            user_hardware: { label: 'User Hardware', icon: 'fa-solid fa-microchip', color: '#10b981' },
            user_education: { label: 'User Education', icon: 'fa-solid fa-graduation-cap', color: '#3b82f6' },
            user_university: { label: 'University & Academics', icon: 'fa-solid fa-graduation-cap', color: '#3b82f6' },
            user_academics: { label: 'User Academics', icon: 'fa-solid fa-graduation-cap', color: '#3b82f6' },
            user_projects: { label: 'User Projects', icon: 'fa-solid fa-diagram-project', color: 'var(--accent-purple, #a855f7)' },
            user_preferences: { label: 'User Preferences', icon: 'fa-solid fa-sliders', color: '#f59e0b' },
            user_work: { label: 'User Career & Work', icon: 'fa-solid fa-briefcase', color: '#06b6d4' },
            user_career: { label: 'User Career', icon: 'fa-solid fa-briefcase', color: '#06b6d4' },
            user_relationships: { label: 'User Relationships', icon: 'fa-solid fa-user-group', color: '#f43f5e' },
            user_friends: { label: 'Friends & Social', icon: 'fa-solid fa-user-group', color: '#f43f5e' },
            user_family: { label: 'Family & Loved Ones', icon: 'fa-solid fa-heart', color: '#f43f5e' },
            user_social: { label: 'Social Circle', icon: 'fa-solid fa-user-group', color: '#f43f5e' },
            user_hobbies: { label: 'User Hobbies', icon: 'fa-solid fa-gamepad', color: '#ec4899' },
            user_gaming: { label: 'User Gaming', icon: 'fa-solid fa-gamepad', color: '#ec4899' },
            user_health: { label: 'User Health', icon: 'fa-solid fa-heart-pulse', color: '#ef4444' }
        };

        if (CATEGORY_META[key]) return CATEGORY_META[key];

        let icon = 'fa-solid fa-bookmark';
        let color = 'var(--accent-purple, #a855f7)';
        if (lower.includes('friend') || lower.includes('relat') || lower.includes('social') || lower.includes('fam') || lower.includes('people') || lower.includes('contact')) {
            icon = 'fa-solid fa-user-group';
            color = '#f43f5e';
        } else if (lower.includes('edu') || lower.includes('uni') || lower.includes('school') || lower.includes('college') || lower.includes('acad')) {
            icon = 'fa-solid fa-graduation-cap';
            color = '#3b82f6';
        } else if (lower.includes('work') || lower.includes('job') || lower.includes('career') || lower.includes('company')) {
            icon = 'fa-solid fa-briefcase';
            color = '#06b6d4';
        } else if (lower.includes('code') || lower.includes('dev') || lower.includes('stack') || lower.includes('proj')) {
            icon = 'fa-solid fa-diagram-project';
            color = 'var(--accent-purple, #a855f7)';
        } else if (lower.includes('game') || lower.includes('hobby') || lower.includes('music') || lower.includes('art')) {
            icon = 'fa-solid fa-gamepad';
            color = '#ec4899';
        } else if (lower.includes('health') || lower.includes('fit') || lower.includes('diet') || lower.includes('sport')) {
            icon = 'fa-solid fa-heart-pulse';
            color = '#ef4444';
        } else if (lower.includes('pref') || lower.includes('set') || lower.includes('style')) {
            icon = 'fa-solid fa-sliders';
            color = '#f59e0b';
        }

        const cleanKey = key.replace(/^user_/i, '').replace(/_/g, ' ');
        const label = cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1);
        const fullLabel = key.toLowerCase().startsWith('user_') ? `User ${label}` : label;

        return { label: fullLabel, icon, color };
    }

    keys.forEach(key => {
        const meta = getCategoryMeta(key);

        const item = document.createElement('div');
        item.className = 'chat-history-item';
        item.style.flexDirection = 'column';
        item.style.alignItems = 'flex-start';
        item.style.padding = '12px';
        item.style.marginBottom = '8px';
        
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.width = '100%';
        header.style.marginBottom = '8px';
        
        const titleSpan = document.createElement('div');
        titleSpan.style.display = 'flex';
        titleSpan.style.alignItems = 'center';
        titleSpan.style.gap = '8px';
        titleSpan.innerHTML = `
            <span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:5px; background:${meta.color}22; color:${meta.color}; font-size:0.8em;">
                <i class="${meta.icon}"></i>
            </span>
            <strong style="color:var(--text-primary); font-size: 0.9em;">${meta.label}</strong>
            <span style="font-size:0.75em; opacity:0.6; font-family:monospace;">(${key})</span>
        `;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.style.background = 'transparent';
        deleteBtn.style.border = 'none';
        deleteBtn.style.color = 'var(--text-tertiary)';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.padding = '2px 4px';
        deleteBtn.title = `Delete ${key} category`;
        deleteBtn.onmouseover = () => deleteBtn.style.color = 'var(--accent-rose)';
        deleteBtn.onmouseout = () => deleteBtn.style.color = 'var(--text-tertiary)';
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (await showConfirm('Delete Memory Category', `Are you sure you want to delete the '${key}' category?`)) {
                await import('../api.js').then(m => m.deleteMemoryAPI(key));
                delete window.__nivm_state.memory[key];
                renderMemoryDrawer();
            }
        });

        header.appendChild(titleSpan);
        header.appendChild(deleteBtn);
        
        const contentPreview = document.createElement('div');
        contentPreview.style.fontSize = '0.85em';
        contentPreview.style.color = 'var(--text-secondary)';
        contentPreview.style.lineHeight = '1.5';
        contentPreview.style.padding = '8px 10px';
        contentPreview.style.background = 'rgba(255, 255, 255, 0.03)';
        contentPreview.style.borderRadius = '6px';
        contentPreview.style.border = '1px solid rgba(255, 255, 255, 0.06)';
        contentPreview.style.width = '100%';
        contentPreview.style.boxSizing = 'border-box';
        contentPreview.style.whiteSpace = 'pre-wrap';
        contentPreview.textContent = window.__nivm_state.memory[key];
        
        const editBox = document.createElement('div');
        editBox.style.marginTop = '10px';
        editBox.style.width = '100%';
        editBox.innerHTML = `
            <input type="text" placeholder="Ask nivm to update this category..." class="memory-edit-input" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.2); color: var(--text-primary); font-size: 0.85em;">
        `;
        
        const inputEl = editBox.querySelector('input');
        inputEl.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const text = inputEl.value.trim();
                if (text) {
                    inputEl.disabled = true;
                    inputEl.value = 'Updating...';
                    
                    const currentValue = window.__nivm_state.memory[key];
                    const editPrompt = `[SYSTEM INSTRUCTION] The user is using a UI shortcut to update a long-term memory category.
Target Category: '${key}'
Current Category Data: '${currentValue}'
User's Update Request: '${text}'

INSTRUCTIONS:
1. Analyze the user's request and update the category '${key}'.
2. MERGE the new facts cleanly with the existing data (e.g. using ' | ' separators or clear key-value attributes). Prior facts must NOT be erased unless the user explicitly requests to change or delete them.
3. Ignore all conversational filler (e.g. 'can you add', 'also', 'instead'). Extract ONLY the factual details.
4. Output EXACTLY ONE tool call: TOOL_CALL: write_memory(${key}, <new_merged_value>)
5. DO NOT output any other text before or after the tool call.`;

                    try {
                        const payload = [
                            { role: 'system', content: "You are an expert AI assistant designed to update memory entries accurately." },
                            { role: 'user', content: editPrompt }
                        ];
                        const response = await fetch('/api/chat', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                model: window.__nivm_state.selectedModel,
                                messages: payload,
                                temperature: 0.1,
                                max_tokens: 500,
                                stream: false
                            })
                        });
                        
                        if (!response.ok) throw new Error("API Error");
                        
                        const data = await response.json();
                        const resultText = data.choices[0].message.content;
                        
                        const match = resultText.match(/TOOL_CALL:\s*(read_memory|write_memory)\(([\s\S]*?)\)/);
                        if (match && match[1] === 'write_memory') {
                            const rawArgs = match[2].trim();
                            const firstComma = rawArgs.indexOf(',');
                            let newKey = key;
                            let newVal = rawArgs;
                            if (firstComma !== -1) {
                                newKey = rawArgs.substring(0, firstComma).trim().replace(/['"]/g, '');
                                newVal = rawArgs.substring(firstComma + 1).trim().replace(/^['"]|['"]$/g, '');
                            }
                            
                            await fetch('/api/memory', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ key: newKey, value: newVal })
                            });
                            
                            const { fetchMemoryAPI } = await import('../api.js');
                            window.__nivm_state.memory = await fetchMemoryAPI();
                            renderMemoryDrawer();
                        } else {
                            console.error("Failed to parse tool call from model output:", resultText);
                            inputEl.disabled = false;
                            inputEl.value = text;
                        }
                    } catch (err) {
                        console.error("Error updating memory:", err);
                        inputEl.disabled = false;
                        inputEl.value = text;
                    }
                }
            }
        });

        item.appendChild(header);
        item.appendChild(contentPreview);
        item.appendChild(editBox);
        dom.memoryList.appendChild(item);
    });
}

