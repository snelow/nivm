/* personality modal & system prompt presets */

import { state } from '../state.js';
import { dom } from '../dom.js';
import { showNotification } from './dialogs.js';

export const PERSONALITY_PRESETS = {
    balanced: { name: "Default • Crisp, Intelligent & Adaptive", prompt: "Direct, concise, and intellectually curious. Answer questions directly without conversational filler. Provide thoughtful explanations and clean, production-ready code." },
    architect: { name: "Senior Software Architect & Code Reviewer", prompt: "You are a pragmatic, highly experienced Principal Software Architect. Emphasize modularity, idiomatic patterns, strict typing, high performance, and robust error handling. When critiquing or writing code, highlight architectural trade-offs, scalability, and security." },
    minimalist: { name: "Ultra-Concise & Direct (Zero Fluff)", prompt: "Be ultra-concise. Deliver maximum signal with minimum tokens. Skip all pleasantries, introductions, and filler. Output answers and code only." },
    analyst: { name: "Deep Research Analyst & Fact-Checker", prompt: "Act as a meticulous research analyst and rigorous fact-checker. Deconstruct complex problems into first principles. Point out edge cases, nuances, caveats, and underlying mechanisms." },
    creative: { name: "Creative Ideation & Brainstorming Partner", prompt: "Act as an imaginative creative partner. Offer divergent perspectives, novel analogies, vivid storytelling, and unconventional solutions. Maintain high enthusiasm and conceptual depth." }
};

export function updatePersonalityCharCount() {
    if (dom.personalityCharCount && dom.personalityTextarea) {
        const len = dom.personalityTextarea.value.length;
        dom.personalityCharCount.textContent = `${len} chars`;
    }
}

export function updateDeleteButtonVisibility() {
    const val = dom.personalityPresetSelect ? dom.personalityPresetSelect.value : '';
    if (dom.deletePersonaBtn) {
        if (val && val.startsWith('custom_')) {
            dom.deletePersonaBtn.classList.remove('hidden');
        } else {
            dom.deletePersonaBtn.classList.add('hidden');
        }
    }
}

export function renderPersonalityDropdown(selectedVal) {
    if (!dom.personalityPresetSelect) return;
    dom.personalityPresetSelect.innerHTML = '';

    const builtInGroup = document.createElement('optgroup');
    builtInGroup.label = "Built-in Personas";
    Object.entries(PERSONALITY_PRESETS).forEach(([key, p]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = p.name;
        builtInGroup.appendChild(opt);
    });
    dom.personalityPresetSelect.appendChild(builtInGroup);

    const customGroup = document.createElement('optgroup');
    customGroup.label = "My Custom Personas";
    if (state.savedPersonas && state.savedPersonas.length > 0) {
        state.savedPersonas.forEach(p => {
            const opt = document.createElement('option');
            opt.value = `custom_${p.id}`;
            opt.textContent = p.name;
            customGroup.appendChild(opt);
        });
    } else {
        const opt = document.createElement('option');
        opt.value = "";
        opt.disabled = true;
        opt.textContent = "(No custom personas saved yet)";
        customGroup.appendChild(opt);
    }
    dom.personalityPresetSelect.appendChild(customGroup);

    const adhocOpt = document.createElement('option');
    adhocOpt.value = "adhoc";
    adhocOpt.textContent = "Custom (Unsaved / Scratchpad)";
    dom.personalityPresetSelect.appendChild(adhocOpt);

    if (selectedVal) {
        dom.personalityPresetSelect.value = selectedVal;
    }
    updateDeleteButtonVisibility();
}

export function getActivePersonaName() {
    const val = dom.personalityPresetSelect ? dom.personalityPresetSelect.value : '';
    if (PERSONALITY_PRESETS[val]) return PERSONALITY_PRESETS[val].name.split('•')[0].trim();
    if (val && val.startsWith('custom_')) {
        const customId = val.replace('custom_', '');
        const found = (state.savedPersonas || []).find(p => p.id === customId);
        if (found) return found.name;
    }
    return 'Custom Persona';
}

export function setupPersonalityUI() {
    if (!dom.personalityModal) return;

    if (dom.personalityTextarea) {
        dom.personalityTextarea.value = state.personalityPrompt || '';
        updatePersonalityCharCount();
    }
    renderPersonalityDropdown(state.personalityPreset || (state.personalityPrompt ? 'adhoc' : 'balanced'));

    if (dom.nsfwToggle) {
        dom.nsfwToggle.checked = !!state.nsfwMode;
        if (dom.nsfwFireIcon) {
            dom.nsfwFireIcon.style.color = state.nsfwMode ? '#fb7185' : 'var(--text-muted)';
        }
        dom.nsfwToggle.addEventListener('change', (e) => {
            state.nsfwMode = e.target.checked;
            localStorage.setItem('nivm_nsfw_mode', state.nsfwMode);
            if (dom.nsfwFireIcon) {
                dom.nsfwFireIcon.style.color = state.nsfwMode ? '#fb7185' : 'var(--text-muted)';
            }
        });
    }

    if (dom.personalityBtn) {
        dom.personalityBtn.addEventListener('click', () => {
            dom.personalityModal.classList.toggle('hidden');
        });
    }
    if (dom.promptPersonalityBtn) {
        dom.promptPersonalityBtn.addEventListener('click', () => {
            dom.personalityModal.classList.toggle('hidden');
        });
    }
    if (dom.openPersonalityFromSettingsBtn) {
        dom.openPersonalityFromSettingsBtn.addEventListener('click', () => {
            dom.settingsModal.classList.add('hidden');
            dom.personalityModal.classList.remove('hidden');
        });
    }
    if (dom.openVoiceFromSettingsBtn) {
        dom.openVoiceFromSettingsBtn.addEventListener('click', () => {
            dom.settingsModal.classList.add('hidden');
            dom.voiceModal.classList.remove('hidden');
        });
    }
    if (dom.closePersonalityBtn) {
        dom.closePersonalityBtn.addEventListener('click', () => {
            dom.personalityModal.classList.add('hidden');
        });
    }
    if (dom.cancelPersonalityBtn) {
        dom.cancelPersonalityBtn.addEventListener('click', () => {
            dom.personalityModal.classList.add('hidden');
            if (dom.savePersonaCard) dom.savePersonaCard.classList.add('hidden');
            if (dom.personalityTextarea) {
                dom.personalityTextarea.value = state.personalityPrompt || '';
                updatePersonalityCharCount();
            }
        });
    }

    if (dom.personalityTextarea) {
        dom.personalityTextarea.addEventListener('input', () => {
            updatePersonalityCharCount();
            if (dom.personalityPresetSelect) {
                const currentVal = dom.personalityPresetSelect.value;
                if (!currentVal.startsWith('custom_') && currentVal !== 'adhoc') {
                    dom.personalityPresetSelect.value = 'adhoc';
                    updateDeleteButtonVisibility();
                }
            }
        });
    }

    if (dom.personalityPresetSelect) {
        dom.personalityPresetSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (PERSONALITY_PRESETS[val]) {
                dom.personalityTextarea.value = PERSONALITY_PRESETS[val].prompt;
                updatePersonalityCharCount();
            } else if (val.startsWith('custom_')) {
                const customId = val.replace('custom_', '');
                const found = (state.savedPersonas || []).find(p => p.id === customId);
                if (found) {
                    dom.personalityTextarea.value = found.prompt;
                    updatePersonalityCharCount();
                }
            }
            updateDeleteButtonVisibility();
        });
    }

    if (dom.newPersonaBtn) {
        dom.newPersonaBtn.addEventListener('click', () => {
            if (dom.personalityTextarea) {
                dom.personalityTextarea.value = '';
                updatePersonalityCharCount();
                dom.personalityTextarea.focus();
            }
            if (dom.personalityPresetSelect) {
                dom.personalityPresetSelect.value = 'adhoc';
                updateDeleteButtonVisibility();
            }
            if (dom.savePersonaCard) {
                dom.savePersonaCard.classList.remove('hidden');
                if (dom.customPersonaNameInput) {
                    dom.customPersonaNameInput.value = '';
                    dom.customPersonaNameInput.focus();
                }
            }
        });
    }

    if (dom.saveAsPersonaBtn) {
        dom.saveAsPersonaBtn.addEventListener('click', () => {
            const promptVal = (dom.personalityTextarea?.value || '').trim();
            if (!promptVal) {
                showNotification({ title: 'Empty Prompt', message: 'Please write or select instructions before saving a persona.', type: 'warning' });
                return;
            }
            if (dom.savePersonaCard) {
                dom.savePersonaCard.classList.toggle('hidden');
                if (!dom.savePersonaCard.classList.contains('hidden') && dom.customPersonaNameInput) {
                    const baseName = getActivePersonaName();
                    dom.customPersonaNameInput.value = `${baseName} (Copy)`;
                    dom.customPersonaNameInput.focus();
                    dom.customPersonaNameInput.select();
                }
            }
        });
    }

    if (dom.customPersonaNameInput) {
        dom.customPersonaNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                dom.confirmSavePersonaBtn?.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                dom.savePersonaCard?.classList.add('hidden');
            }
        });
    }

    if (dom.cancelSavePersonaBtn) {
        dom.cancelSavePersonaBtn.addEventListener('click', () => {
            if (dom.savePersonaCard) dom.savePersonaCard.classList.add('hidden');
        });
    }

    if (dom.confirmSavePersonaBtn) {
        dom.confirmSavePersonaBtn.addEventListener('click', () => {
            let name = (dom.customPersonaNameInput?.value || '').trim();
            if (!name) {
                showNotification({ title: 'Name Required', message: 'Please enter a name for this persona.', type: 'warning' });
                dom.customPersonaNameInput?.focus();
                return;
            }
            if (name.length > 50) name = name.substring(0, 50).trim();

            const promptVal = (dom.personalityTextarea?.value || '').trim();
            if (!promptVal) {
                showNotification({ title: 'Empty Instructions', message: 'Instructions cannot be blank.', type: 'warning' });
                return;
            }

            if (!Array.isArray(state.savedPersonas)) state.savedPersonas = [];

            const existingIndex = state.savedPersonas.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
            let targetId;

            if (existingIndex !== -1) {
                const confirmOverwrite = confirm(`A persona named "${name}" already exists. Do you want to overwrite its instructions?`);
                if (!confirmOverwrite) {
                    dom.customPersonaNameInput?.focus();
                    return;
                }
                state.savedPersonas[existingIndex].prompt = promptVal;
                targetId = state.savedPersonas[existingIndex].id;
            } else {
                targetId = 'p_' + Date.now();
                state.savedPersonas.push({ id: targetId, name, prompt: promptVal });
            }

            localStorage.setItem('nivm_saved_personas', JSON.stringify(state.savedPersonas));

            const presetKey = `custom_${targetId}`;
            state.personalityPrompt = promptVal;
            state.personalityPreset = presetKey;
            localStorage.setItem('nivm_personality_prompt', promptVal);
            localStorage.setItem('nivm_personality_preset', presetKey);

            if (dom.savePersonaCard) dom.savePersonaCard.classList.add('hidden');
            if (dom.customPersonaNameInput) dom.customPersonaNameInput.value = '';

            renderPersonalityDropdown(presetKey);
            showNotification({
                title: 'Persona Saved & Active',
                message: `"${name}" is now saved and active.`,
                type: 'success'
            });
        });
    }

    if (dom.deletePersonaBtn) {
        dom.deletePersonaBtn.addEventListener('click', () => {
            const val = dom.personalityPresetSelect ? dom.personalityPresetSelect.value : '';
            if (!val || !val.startsWith('custom_')) return;
            const customId = val.replace('custom_', '');
            const personaToDelete = (state.savedPersonas || []).find(p => p.id === customId);
            const personaName = personaToDelete ? personaToDelete.name : 'Persona';

            state.savedPersonas = (state.savedPersonas || []).filter(p => p.id !== customId);
            localStorage.setItem('nivm_saved_personas', JSON.stringify(state.savedPersonas));

            renderPersonalityDropdown('balanced');
            if (dom.personalityTextarea) {
                dom.personalityTextarea.value = PERSONALITY_PRESETS.balanced.prompt;
                updatePersonalityCharCount();
            }
            showNotification({
                title: 'Persona Deleted',
                message: `Removed "${personaName}".`,
                type: 'info'
            });
        });
    }

    if (dom.resetPersonalityBtn) {
        dom.resetPersonalityBtn.addEventListener('click', () => {
            if (dom.personalityPresetSelect) dom.personalityPresetSelect.value = 'balanced';
            if (dom.personalityTextarea) {
                dom.personalityTextarea.value = PERSONALITY_PRESETS.balanced.prompt;
                updatePersonalityCharCount();
            }
            updateDeleteButtonVisibility();
        });
    }

    if (dom.savePersonalityBtn) {
        dom.savePersonalityBtn.addEventListener('click', () => {
            const promptVal = dom.personalityTextarea ? dom.personalityTextarea.value.trim() : '';
            const presetVal = dom.personalityPresetSelect ? dom.personalityPresetSelect.value : 'adhoc';

            if (presetVal.startsWith('custom_')) {
                const customId = presetVal.replace('custom_', '');
                const target = (state.savedPersonas || []).find(p => p.id === customId);
                if (target) {
                    target.prompt = promptVal;
                    localStorage.setItem('nivm_saved_personas', JSON.stringify(state.savedPersonas));
                }
            }

            state.personalityPrompt = promptVal;
            state.personalityPreset = presetVal;
            localStorage.setItem('nivm_personality_prompt', promptVal);
            localStorage.setItem('nivm_personality_preset', presetVal);
            dom.personalityModal.classList.add('hidden');
            if (dom.savePersonaCard) dom.savePersonaCard.classList.add('hidden');

            showNotification({
                title: 'Persona Applied',
                message: 'Active personality instructions updated.',
                type: 'success'
            });
        });
    }
}
