/**
 * Image Studio Modal Controller
 * Dedicated management hub for Anime Characters, Profiles, and LoRA Models.
 * Displays category-based LoRAs (Characters, Concepts, Poses) and provides
 * a collapsible smart importer with disk file sync and NSFW gating controls.
 */

import { state } from '../state.js';
import { dom } from '../dom.js';
import { makeDraggable, escapeHtml, showNotification } from './dialogs.js';
import { refreshAnimeRegistryCache } from '../tools.js';
import { handleBrowseFile, openFileBrowserModal } from './file_browser.js';

function showToast(msg, type = 'info') {
    showNotification({ message: msg }, type);
}

let _registry = null;
let _editingCharKey = null;
let _editingOptionCategory = null; // 'concepts' | 'poses'
let _editingOptionKey = null;
let _selectedLoraFile = null;
let _selectedLoraHostPath = null;
let _activeTab = 'characters'; // 'characters' | 'concepts' | 'poses'

export function setupImageStudioUI() {
    const modal = document.getElementById('imageStudioModal');
    const windowEl = document.getElementById('imageStudioWindow');
    const headerEl = document.getElementById('imageStudioWindowHeader');
    const openBtn = document.getElementById('imageStudioBtn');
    const drawerBtn = document.getElementById('drawerImageStudioBtn');
    const closeBtn = document.getElementById('closeImageStudioBtn');

    if (!modal || !windowEl || !headerEl) return;

    makeDraggable(windowEl, headerEl);

    // Open/Close triggers
    const toggleStudio = () => modal.classList.contains('hidden') ? openImageStudio() : closeImageStudio();
    [openBtn, drawerBtn].forEach(b => b?.addEventListener('click', toggleStudio));
    closeBtn?.addEventListener('click', closeImageStudio);

    document.getElementById('openImageStudioFromSettingsBtn')?.addEventListener('click', () => {
        if (dom.settingsModal) dom.settingsModal.classList.add('hidden');
        openImageStudio();
    });

    document.getElementById('actionToggleImporterBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLoraImporter();
    });

    ['closeLoraImporterBtn', 'cancelLoraImporterBtn'].forEach(id => document.getElementById(id)?.addEventListener('click', closeLoraImporter));

    const triggerHostLoraImporter = (useNative = true) => {
        window._onLoraFileSelectedCallback = (file) => {
            openLoraImporter();
            handleLoraHostFileSelected(file);
        };
        useNative ? handleBrowseFile('lora') : openFileBrowserModal('lora');
    };

    [['studioTabCharacters', 'characters'], ['studioTabConcepts', 'concepts'], ['studioTabPoses', 'poses']].forEach(([id, t]) => {
        document.getElementById(id)?.addEventListener('click', () => switchCategoryTab(t));
    });

    const catSelect = document.getElementById('loraImportCategorySelect');
    if (catSelect) {
        catSelect.addEventListener('change', () => {
            const isChar = catSelect.value === 'character';
            const appField = document.getElementById('loraImportAppearanceField');
            const outfitSec = document.getElementById('loraImportOutfitSection');
            const fieldsRow = document.getElementById('loraImportFieldsRow');
            if (appField) appField.style.display = isChar ? 'block' : 'none';
            if (outfitSec) outfitSec.style.display = isChar ? 'flex' : 'none';
            if (fieldsRow) fieldsRow.style.gridTemplateColumns = isChar ? '1fr 1fr 0.5fr' : '1.5fr 0.5fr';

            const ph = {
                character: ['e.g. megumin, red eyes', 'e.g. megumin', 'e.g. Megumin'],
                concept: ['e.g. breasts on tray, carried breast rest', 'e.g. breasts_on_tray', 'e.g. Breasts on Tray'],
                pose: ['e.g. slav squatting, full body, squatting', 'e.g. slav_squat', 'e.g. Slav Squat']
            }[catSelect.value];
            if (ph) {
                const trigInput = document.getElementById('loraImportTriggerInput');
                const keyInput = document.getElementById('loraImportKeyInput');
                const nameInput = document.getElementById('loraImportNameInput');
                if (trigInput) trigInput.placeholder = ph[0];
                if (keyInput) keyInput.placeholder = ph[1];
                if (nameInput) nameInput.placeholder = ph[2];
            }
        });
    }

    document.getElementById('characterSearchInput')?.addEventListener('input', (e) => renderActiveTab(e.target.value.trim()));
    document.getElementById('newCharacterBtn')?.addEventListener('click', () => _activeTab === 'characters' ? openCharacterEditor(null) : openOptionEditor(_activeTab, null));
    document.getElementById('saveCharacterBtn')?.addEventListener('click', handleSaveCharacter);
    ['cancelCharacterEditBtn', 'cancelCharEditActionBtn'].forEach(id => document.getElementById(id)?.addEventListener('click', closeCharacterEditor));
    document.getElementById('saveOptionBtn')?.addEventListener('click', handleSaveOption);
    ['cancelOptionEditBtn', 'cancelOptionEditActionBtn'].forEach(id => document.getElementById(id)?.addEventListener('click', closeOptionEditor));

    const handleHostLoraPickedForField = async (file, inputId) => {
        if (!file) return;
        const input = document.getElementById(inputId);
        if (!input) return;
        if (file.path) {
            try {
                const resp = await fetch('/api/image/anime/loras/ensure-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source_path: file.path })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    input.value = data.filename || file.name;
                    updateAvailableLorasDatalist();
                    return;
                }
            } catch (e) {
                console.warn('Could not ensure LoRA in directory:', e);
            }
        }
        input.value = file.name;
    };

    [
        ['loraHostBrowseBtn', () => triggerHostLoraImporter(true)],
        ['loraHostExploreBtn', () => triggerHostLoraImporter(false)],
        ['charEditBrowseLoraBtn', () => { window._onLoraFileSelectedCallback = (f) => handleHostLoraPickedForField(f, 'charEditLoraFileInput'); handleBrowseFile('lora'); }],
        ['charEditExploreLoraBtn', () => { window._onLoraFileSelectedCallback = (f) => handleHostLoraPickedForField(f, 'charEditLoraFileInput'); openFileBrowserModal('lora'); }],
        ['optionEditBrowseLoraBtn', () => { window._onLoraFileSelectedCallback = (f) => handleHostLoraPickedForField(f, 'optionEditLoraInput'); handleBrowseFile('lora'); }],
        ['optionEditExploreLoraBtn', () => { window._onLoraFileSelectedCallback = (f) => handleHostLoraPickedForField(f, 'optionEditLoraInput'); openFileBrowserModal('lora'); }]
    ].forEach(([id, fn]) => {
        document.getElementById(id)?.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    });

    document.getElementById('addOutfitRowBtn')?.addEventListener('click', () => addOutfitInputRow('', '', false));
    document.getElementById('addHairstyleRowBtn')?.addEventListener('click', () => addHairstyleInputRow('', ''));
    setupLoraDropZone();
}

export async function openImageStudio() {
    const modal = document.getElementById('imageStudioModal');
    if (!modal) return;
    modal.classList.remove('hidden');

    await loadRegistryData();
    renderActiveTab();
}

export function closeImageStudio() {
    const modal = document.getElementById('imageStudioModal');
    if (modal) modal.classList.add('hidden');
    closeCharacterEditor();
    closeOptionEditor();
    closeLoraImporter();
}

export function switchCategoryTab(tab) {
    _activeTab = tab;

    // Update active tab buttons
    document.querySelectorAll('.studio-cat-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });

    // Update visibility of category sections
    const charSec = document.getElementById('studioCharactersSection');
    const conceptSec = document.getElementById('studioConceptsSection');
    const poseSec = document.getElementById('studioPosesSection');

    if (charSec) charSec.classList.toggle('hidden', tab !== 'characters');
    if (conceptSec) conceptSec.classList.toggle('hidden', tab !== 'concepts');
    if (poseSec) poseSec.classList.toggle('hidden', tab !== 'poses');

    // Update new item button
    const newBtn = document.getElementById('newCharacterBtn');
    if (newBtn) {
        if (tab === 'characters') {
            newBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> <span>Manual Profile</span>';
            newBtn.title = 'Define character profile manually without dropping a file';
        } else if (tab === 'concepts') {
            newBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>Manual Concept</span>';
            newBtn.title = 'Define concept manually without dropping a file';
        } else if (tab === 'poses') {
            newBtn.innerHTML = '<i class="fa-solid fa-person-walking"></i> <span>Manual Pose</span>';
            newBtn.title = 'Define pose manually without dropping a file';
        }
    }

    // Auto sync importer category dropdown to active tab
    const catSelect = document.getElementById('loraImportCategorySelect');
    if (catSelect) {
        const catMap = { characters: 'character', concepts: 'concept', poses: 'pose' };
        if (catMap[tab] && catSelect.value !== catMap[tab]) {
            catSelect.value = catMap[tab];
            catSelect.dispatchEvent(new Event('change'));
        }
    }

    // Update placeholder text
    const searchInput = document.getElementById('characterSearchInput');
    if (searchInput) {
        const placeholders = {
            characters: 'Search characters by name, key, or trigger tags...',
            concepts: 'Search concepts by name, trigger tags, or filename...',
            poses: 'Search poses by name, trigger tags, or filename...',
        };
        searchInput.placeholder = placeholders[tab] || 'Search...';
        renderActiveTab(searchInput.value.trim());
    } else {
        renderActiveTab();
    }
}

// Backward compatibility stub for legacy callers
export function switchStudioTab(tab) {
    if (tab === 'characters' || tab === 'concepts' || tab === 'poses') {
        switchCategoryTab(tab);
    }
}

export function openLoraImporter() {
    closeCharacterEditor();
    closeOptionEditor();
    const section = document.getElementById('smartLoraImporterSection');
    if (section) {
        const catSelect = document.getElementById('loraImportCategorySelect');
        if (catSelect) {
            const catMap = { characters: 'character', concepts: 'concept', poses: 'pose' };
            if (catMap[_activeTab]) {
                catSelect.value = catMap[_activeTab];
                catSelect.dispatchEvent(new Event('change'));
            }
        }
        section.classList.remove('hidden');
        section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

export function closeLoraImporter() {
    const section = document.getElementById('smartLoraImporterSection');
    if (section) {
        section.classList.add('hidden');
    }
}

export function toggleLoraImporter(forceOpen = null) {
    const section = document.getElementById('smartLoraImporterSection');
    if (!section) return false;
    const isCurrentlyOpen = !section.classList.contains('hidden');
    const willOpen = forceOpen !== null ? forceOpen : !isCurrentlyOpen;
    if (willOpen) {
        openLoraImporter();
    } else {
        closeLoraImporter();
    }
    return willOpen;
}

async function loadRegistryData() {
    try {
        const resp = await fetch('/api/image/anime/registry?include_all=true');
        if (resp.ok) {
            _registry = await resp.json();
            updateStatsBadge();
            updateAvailableLorasDatalist();
            if (typeof refreshAnimeRegistryCache === 'function') {
                refreshAnimeRegistryCache();
            }
        }
    } catch (err) {
        console.error('Failed loading anime registry:', err);
    }
}

function updateAvailableLorasDatalist() {
    const datalist = document.getElementById('availableLoraFilesList');
    if (!datalist || !_registry?.available_lora_files) return;
    datalist.innerHTML = '';
    _registry.available_lora_files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        datalist.appendChild(opt);
    });
}

function updateStatsBadge() {
    if (!_registry) return;
    const numChars = Object.keys(_registry.characters || {}).length;
    const numConcepts = Object.keys(_registry.concepts || {}).length;
    const numPoses = Object.keys(_registry.poses || {}).length;

    const charsCountEl = document.getElementById('studioCharsCount');
    const conceptsCountEl = document.getElementById('studioConceptsCount');
    const posesCountEl = document.getElementById('studioPosesCount');

    if (charsCountEl) charsCountEl.textContent = numChars;
    if (conceptsCountEl) conceptsCountEl.textContent = numConcepts;
    if (posesCountEl) posesCountEl.textContent = numPoses;

    const badge = document.getElementById('studioCharCountBadge');
    if (badge) {
        badge.textContent = `${numChars} Chars • ${numConcepts} Concepts • ${numPoses} Poses`;
    }
}

function renderActiveTab(filterQuery = '') {
    if (_activeTab === 'characters') {
        renderCharacterCards(filterQuery);
    } else if (_activeTab === 'concepts') {
        renderConceptCards(filterQuery);
    } else if (_activeTab === 'poses') {
        renderPoseCards(filterQuery);
    }
}

export function renderCharacterCards(filterQuery = '') {
    const listEl = document.getElementById('characterListContainer');
    if (!listEl || !_registry) return;
    listEl.innerHTML = '';

    const query = (filterQuery || '').toLowerCase();
    const characters = _registry.characters || {};
    const entries = Object.entries(characters);

    if (entries.length === 0) {
        listEl.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px 24px; color: var(--text-secondary); background: rgba(0,0,0,0.25); border-radius: 10px; border: 1px dashed var(--glass-border);">
                <i class="fa-solid fa-users-slash" style="font-size: 2.2rem; opacity: 0.35; margin-bottom: 12px; display: block; color: var(--accent-purple);"></i>
                <div style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">No Character LoRAs Registered</div>
                <p style="font-size: 0.78rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 16px; line-height: 1.5;">
                    Drop a character <code>.safetensors</code> LoRA into the importer above, browse your host disk, or create a manual character profile.
                    Even without character LoRAs, Nivm's anime illustration engine will generate pure base model illustrations!
                </p>
                <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
                    <button type="button" class="btn-primary" id="emptyStateImportLoraBtn" style="padding: 6px 14px; font-size: 0.78rem; gap: 6px;">
                        <i class="fa-solid fa-cloud-arrow-up"></i> Import LoRA
                    </button>
                    <button type="button" class="btn-secondary" id="emptyStateNewCharBtn" style="padding: 6px 14px; font-size: 0.78rem; gap: 6px;">
                        <i class="fa-solid fa-user-plus"></i> Create Manual Profile
                    </button>
                </div>
            </div>
        `;
        const impBtn = listEl.querySelector('#emptyStateImportLoraBtn');
        if (impBtn) {
            impBtn.addEventListener('click', openLoraImporter);
        }
        const manBtn = listEl.querySelector('#emptyStateNewCharBtn');
        if (manBtn) {
            manBtn.addEventListener('click', () => openCharacterEditor(null));
        }
        return;
    }

    let matchedCount = 0;

    entries.forEach(([key, char]) => {
        const name = char.display_name || key;
        const trigger = char.trigger_word || '';
        const appearance = char.appearance || '';
        const lora = char.lora_file || '';
        const fileExists = char.file_exists !== false;
        const isNsfw = !!char.nsfw;

        // Skip NSFW character if NSFW mode is off in Nivm
        if (!state.nsfwMode && isNsfw) return;

        if (query) {
            const matches = name.toLowerCase().includes(query) ||
                            key.toLowerCase().includes(query) ||
                            trigger.toLowerCase().includes(query) ||
                            appearance.toLowerCase().includes(query);
            if (!matches) return;
        }

        matchedCount++;
        const card = document.createElement('div');
        card.className = 'character-card';

        const outfits = Object.values(char.outfits || {}).filter(o => !!state.nsfwMode || !o.nsfw);
        const hairstyles = Object.values(char.hairstyles || {});

        card.innerHTML = `
            <div class="character-card-header">
                <div>
                    <div class="character-card-title" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span>${escapeHtml(name)}</span>
                        ${isNsfw ? '<span class="character-tag-pill gated" style="font-size: 0.62rem;">NSFW Profile</span>' : ''}
                    </div>
                    <div class="character-card-meta">
                        <span>key: <strong>${escapeHtml(key)}</strong></span>
                    </div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button type="button" class="icon-btn-sm edit-char-btn" data-key="${escapeHtml(key)}" title="Edit Profile">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button type="button" class="icon-btn-sm delete-char-btn" data-key="${escapeHtml(key)}" title="Delete Character & LoRA File" style="color: #f43f5e;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>

            <div class="character-card-prop">
                <span style="color: var(--text-muted); font-size: 0.7rem; display: block;">LoRA Weight:</span>
                <span style="font-family: monospace; font-size: 0.72rem; color: #38bdf8;">${escapeHtml(lora || 'Base Model Only (No LoRA)')} ${char.lora_file ? `(${char.lora_strength_model || 0.9}x)` : ''}</span>
                ${char.has_lora && !fileExists ? '<span class="lora-missing-badge" style="margin-left: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> Missing on disk</span>' : ''}
            </div>

            <div class="character-card-prop">
                <span style="color: var(--text-muted); font-size: 0.7rem; display: block;">Trigger Word:</span>
                <code style="color: var(--accent-purple); font-size: 0.72rem;">${escapeHtml(trigger || 'None')}</code>
            </div>

            ${appearance ? `
            <div class="character-card-prop">
                <span style="color: var(--text-muted); font-size: 0.7rem; display: block;">Base Appearance:</span>
                <span style="font-size: 0.72rem; color: var(--text-secondary);">${escapeHtml(appearance)}</span>
            </div>
            ` : ''}

            <div style="margin-top: auto; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; gap: 4px;">
                <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 600;">Outfits (${outfits.length}):</span>
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    ${outfits.length > 0 ? outfits.map(o => `<span class="character-tag-pill ${o.nsfw ? 'gated' : ''}" title="${o.nsfw ? 'NSFW outfit (hidden when NSFW mode is OFF)' : 'Outfit'}">${escapeHtml(o.display_name)}</span>`).join('') : '<span style="font-size: 0.68rem; color: var(--text-muted);">Default only</span>'}
                </div>
                ${hairstyles.length > 0 ? `
                <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 600; margin-top: 4px;">Hairstyles (${hairstyles.length}):</span>
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    ${hairstyles.map(h => `<span class="character-tag-pill">${escapeHtml(h.display_name)}</span>`).join('')}
                </div>
                ` : ''}
            </div>
        `;

        card.querySelector('.edit-char-btn').addEventListener('click', () => openCharacterEditor(key));
        card.querySelector('.delete-char-btn').addEventListener('click', () => confirmDeleteCharacter(key, name));
        listEl.appendChild(card);
    });

    if (query && matchedCount === 0) {
        listEl.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.8rem;">
                No characters matching "${escapeHtml(query)}".
            </div>
        `;
    }
}

export function renderConceptCards(filterQuery = '') {
    const listEl = document.getElementById('conceptListContainer');
    if (!listEl || !_registry) return;
    listEl.innerHTML = '';

    const query = (filterQuery || '').toLowerCase();
    const concepts = _registry.concepts || {};
    const entries = Object.entries(concepts);

    if (entries.length === 0) {
        listEl.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 36px 20px; color: var(--text-muted); font-size: 0.82rem; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px dashed var(--glass-border);">
                <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 1.8rem; opacity: 0.4; margin-bottom: 8px; display: block;"></i>
                No concepts registered. Drop a concept LoRA in the importer above.
            </div>
        `;
        return;
    }

    let matchedCount = 0;

    entries.forEach(([key, concept]) => {
        const name = concept.display_name || key;
        const trigger = concept.trigger || '';
        const lora = concept.lora_file || '';
        const fileExists = concept.file_exists !== false;

        if (query) {
            const matches = name.toLowerCase().includes(query) ||
                            key.toLowerCase().includes(query) ||
                            trigger.toLowerCase().includes(query) ||
                            (lora && lora.toLowerCase().includes(query));
            if (!matches) return;
        }

        matchedCount++;
        const card = document.createElement('div');
        card.className = 'character-card';

        const isNsfw = !!concept.nsfw;
        if (!state.nsfwMode && isNsfw) return;
        const isDefault = key === 'none';

        card.innerHTML = `
            <div class="character-card-header">
                <div>
                    <div class="character-card-title" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span>${escapeHtml(name)}</span>
                        ${isNsfw ? '<span class="character-tag-pill gated" style="font-size: 0.62rem;">NSFW</span>' : ''}
                    </div>
                    <div class="character-card-meta">
                        <span>key: <strong>${escapeHtml(key)}</strong></span>
                    </div>
                </div>
                <div>
                    ${!isDefault ? `
                    <div style="display: flex; gap: 4px;">
                        <button type="button" class="icon-btn-sm edit-concept-btn" data-key="${escapeHtml(key)}" title="Edit Concept">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" class="icon-btn-sm delete-concept-btn" data-key="${escapeHtml(key)}" title="Delete Concept & LoRA File" style="color: #f43f5e;">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                    ` : `
                    <span style="font-size: 0.65rem; color: var(--text-muted); padding: 2px 6px; background: rgba(255,255,255,0.05); border-radius: 4px;">Default</span>
                    `}
                </div>
            </div>

            <div class="character-card-prop">
                <span style="color: var(--text-muted); font-size: 0.7rem; display: block;">LoRA File:</span>
                <span style="font-family: monospace; font-size: 0.72rem; color: #38bdf8;">${escapeHtml(lora || 'None (Base Prompt)')} ${lora ? `(${concept.strength || 1.0}x)` : ''}</span>
                ${concept.has_lora && !fileExists ? '<span class="lora-missing-badge" style="margin-left: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> Missing on disk</span>' : ''}
            </div>

            <div class="character-card-prop" style="margin-top: auto;">
                <span style="color: var(--text-muted); font-size: 0.7rem; display: block;">Trigger Tags:</span>
                <code style="color: var(--accent-purple); font-size: 0.72rem; word-break: break-word;">${escapeHtml(trigger || 'None')}</code>
            </div>
        `;

        if (!isDefault) {
            card.querySelector('.edit-concept-btn')?.addEventListener('click', () => openOptionEditor('concepts', key));
            card.querySelector('.delete-concept-btn')?.addEventListener('click', () => confirmDeleteOption('concepts', key, name));
        }
        listEl.appendChild(card);
    });

    if (query && matchedCount === 0) {
        listEl.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.8rem;">
                No concepts matching "${escapeHtml(query)}".
            </div>
        `;
    }
}

export function renderPoseCards(filterQuery = '') {
    const listEl = document.getElementById('poseListContainer');
    if (!listEl || !_registry) return;
    listEl.innerHTML = '';

    const query = (filterQuery || '').toLowerCase();
    const poses = _registry.poses || {};
    const entries = Object.entries(poses);

    if (entries.length === 0) {
        listEl.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 36px 20px; color: var(--text-muted); font-size: 0.82rem; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px dashed var(--glass-border);">
                <i class="fa-solid fa-person-walking" style="font-size: 1.8rem; opacity: 0.4; margin-bottom: 8px; display: block;"></i>
                No poses registered. Drop a pose LoRA in the importer above.
            </div>
        `;
        return;
    }

    let matchedCount = 0;

    entries.forEach(([key, pose]) => {
        const name = pose.display_name || key;
        const trigger = pose.trigger || '';
        const lora = pose.lora_file || '';
        const fileExists = pose.file_exists !== false;

        if (query) {
            const matches = name.toLowerCase().includes(query) ||
                            key.toLowerCase().includes(query) ||
                            trigger.toLowerCase().includes(query) ||
                            (lora && lora.toLowerCase().includes(query));
            if (!matches) return;
        }

        matchedCount++;
        const card = document.createElement('div');
        card.className = 'character-card';

        const isNsfw = !!pose.nsfw;
        if (!state.nsfwMode && isNsfw) return;
        const isDefault = key === 'none';

        card.innerHTML = `
            <div class="character-card-header">
                <div>
                    <div class="character-card-title" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span>${escapeHtml(name)}</span>
                        ${isNsfw ? '<span class="character-tag-pill gated" style="font-size: 0.62rem;">NSFW</span>' : ''}
                    </div>
                    <div class="character-card-meta">
                        <span>key: <strong>${escapeHtml(key)}</strong></span>
                    </div>
                </div>
                <div>
                    ${!isDefault ? `
                    <div style="display: flex; gap: 4px;">
                        <button type="button" class="icon-btn-sm edit-pose-btn" data-key="${escapeHtml(key)}" title="Edit Pose">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" class="icon-btn-sm delete-pose-btn" data-key="${escapeHtml(key)}" title="Delete Pose & LoRA File" style="color: #f43f5e;">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                    ` : `
                    <span style="font-size: 0.65rem; color: var(--text-muted); padding: 2px 6px; background: rgba(255,255,255,0.05); border-radius: 4px;">Default</span>
                    `}
                </div>
            </div>

            <div class="character-card-prop">
                <span style="color: var(--text-muted); font-size: 0.7rem; display: block;">LoRA File:</span>
                <span style="font-family: monospace; font-size: 0.72rem; color: #38bdf8;">${escapeHtml(lora || 'None (Base Prompt)')} ${lora ? `(${pose.strength || 1.0}x)` : ''}</span>
                ${pose.has_lora && !fileExists ? '<span class="lora-missing-badge" style="margin-left: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> Missing on disk</span>' : ''}
            </div>

            <div class="character-card-prop" style="margin-top: auto;">
                <span style="color: var(--text-muted); font-size: 0.7rem; display: block;">Trigger Tags:</span>
                <code style="color: var(--accent-purple); font-size: 0.72rem; word-break: break-word;">${escapeHtml(trigger || 'None')}</code>
            </div>
        `;

        if (!isDefault) {
            card.querySelector('.edit-pose-btn')?.addEventListener('click', () => openOptionEditor('poses', key));
            card.querySelector('.delete-pose-btn')?.addEventListener('click', () => confirmDeleteOption('poses', key, name));
        }
        listEl.appendChild(card);
    });

    if (query && matchedCount === 0) {
        listEl.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.8rem;">
                No poses matching "${escapeHtml(query)}".
            </div>
        `;
    }
}

async function confirmDeleteOption(category, key, displayName) {
    const label = category === 'concepts' ? 'concept' : 'pose';
    if (!confirm(`Are you sure you want to delete ${label} '${displayName}'? This will remove it from the catalog and delete any associated LoRA file on disk.`)) return;

    try {
        const resp = await fetch(`/api/image/anime/options/${category}/${key}`, {
            method: 'DELETE'
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: resp.statusText }));
            throw new Error(err.detail || `Error ${resp.status}`);
        }
        showToast(`Removed ${displayName} and its file from disk.`, 'info');
        await loadRegistryData();
        renderActiveTab();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function openCharacterEditor(charKey) {
    closeOptionEditor();
    closeLoraImporter();
    _editingCharKey = charKey;
    const formCard = document.getElementById('characterEditorCard');
    const titleEl = document.getElementById('characterEditorTitle');
    if (!formCard) return;

    formCard.classList.remove('hidden');
    formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const char = charKey && _registry?.characters?.[charKey] ? _registry.characters[charKey] : null;

    if (titleEl) titleEl.textContent = char ? `Edit: ${char.display_name}` : 'Create Character Profile';

    const keyInput = document.getElementById('charEditKeyInput');
    keyInput.value = charKey || '';
    keyInput.disabled = !!charKey;
    document.getElementById('charEditNameInput').value = char?.display_name || '';
    document.getElementById('charEditLoraFileInput').value = char?.lora_file || '';
    document.getElementById('charEditTriggerInput').value = char?.trigger_word || '';
    document.getElementById('charEditAppearanceInput').value = char?.appearance || '';
    document.getElementById('charEditStrengthInput').value = char?.lora_strength_model || '0.9';

    const nsfwCheck = document.getElementById('charEditNsfwCheck');
    if (nsfwCheck) nsfwCheck.checked = !!char?.nsfw;

    // Populate Outfits Rows
    const outfitsContainer = document.getElementById('charEditOutfitsContainer');
    if (outfitsContainer) {
        outfitsContainer.innerHTML = '';
        if (char?.outfits && Object.keys(char.outfits).length > 0) {
            Object.entries(char.outfits).forEach(([ok, ov]) => {
                addOutfitInputRow(ov.display_name || ok, ov.trigger || '', !!ov.nsfw);
            });
        } else {
            addOutfitInputRow('Default Outfit', '', false);
        }
    }

    // Populate Hairstyles Rows
    const hairContainer = document.getElementById('charEditHairstylesContainer');
    if (hairContainer) {
        hairContainer.innerHTML = '';
        if (char?.hairstyles && Object.keys(char.hairstyles).length > 0) {
            Object.entries(char.hairstyles).forEach(([hk, hv]) => {
                addHairstyleInputRow(hv.display_name || hk, hv.trigger || '');
            });
        }
    }
}

function closeCharacterEditor() {
    _editingCharKey = null;
    const formCard = document.getElementById('characterEditorCard');
    if (formCard) formCard.classList.add('hidden');
}

function addOutfitInputRow(name = '', trigger = '', isNsfw = false) {
    const container = document.getElementById('charEditOutfitsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'outfit-edit-row';
    row.innerHTML = `
        <div class="outfit-edit-top-row">
            <div class="outfit-name-field">
                <i class="fa-solid fa-shirt" style="color: var(--accent-purple); font-size: 0.8rem; flex-shrink: 0;"></i>
                <input type="text" class="outfit-name-input" placeholder="Outfit Name (e.g. Uniform)" value="${escapeHtml(name)}">
            </div>
            <div class="outfit-edit-controls">
                <label class="outfit-nsfw-label" title="Mark this specific outfit as NSFW (hidden when NSFW mode is OFF)">
                    <input type="checkbox" class="outfit-gated-check" ${isNsfw ? 'checked' : ''}>
                    <span>NSFW Outfit</span>
                </label>
                <button type="button" class="icon-btn-sm remove-row-btn" style="color: #f43f5e; width: 28px; height: 28px;" title="Remove Outfit"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        </div>
        <div class="outfit-edit-bottom-row">
            <input type="text" class="outfit-trigger-input" placeholder="Trigger tags (e.g. white shirt, pleated skirt, black socks)" value="${escapeHtml(trigger)}">
        </div>
    `;
    row.querySelector('.remove-row-btn').addEventListener('click', () => row.remove());
    container.appendChild(row);
}

function addHairstyleInputRow(name = '', trigger = '') {
    const container = document.getElementById('charEditHairstylesContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'hairstyle-edit-row';
    row.innerHTML = `
        <div class="hair-edit-top-row">
            <div class="hair-name-field">
                <i class="fa-solid fa-scissors" style="color: var(--accent-purple); font-size: 0.8rem; flex-shrink: 0;"></i>
                <input type="text" class="hair-name-input" placeholder="Hairstyle Name (e.g. Ponytail)" value="${escapeHtml(name)}">
            </div>
            <button type="button" class="icon-btn-sm remove-row-btn" style="color: #f43f5e; width: 28px; height: 28px;" title="Remove Hairstyle"><i class="fa-solid fa-trash-can"></i></button>
        </div>
        <div class="hair-edit-bottom-row">
            <input type="text" class="hair-trigger-input" placeholder="Trigger tags (e.g. ponytail, hair tie)" value="${escapeHtml(trigger)}">
        </div>
    `;
    row.querySelector('.remove-row-btn').addEventListener('click', () => row.remove());
    container.appendChild(row);
}

async function handleSaveCharacter() {
    const key = document.getElementById('charEditKeyInput')?.value?.trim();
    const displayName = document.getElementById('charEditNameInput')?.value?.trim();
    const loraFile = document.getElementById('charEditLoraFileInput')?.value?.trim();
    const triggerWord = document.getElementById('charEditTriggerInput')?.value?.trim();
    const appearance = document.getElementById('charEditAppearanceInput')?.value?.trim();
    const strength = parseFloat(document.getElementById('charEditStrengthInput')?.value || '0.9');
    const isNsfwChar = !!document.getElementById('charEditNsfwCheck')?.checked;

    if (!key || !displayName) {
        showToast('Key and Display Name are required', 'warning');
        return;
    }

    // Collect outfits
    const outfits = {};
    document.querySelectorAll('.outfit-edit-row').forEach((row, i) => {
        const name = row.querySelector('.outfit-name-input')?.value?.trim();
        const trigger = row.querySelector('.outfit-trigger-input')?.value?.trim();
        const isNsfw = !!row.querySelector('.outfit-gated-check')?.checked;
        if (name) {
            const ok = name.toLowerCase().replace(/[^a-z0-9]/g, '_') || `outfit_${i}`;
            outfits[ok] = {
                display_name: name,
                trigger: trigger || '',
                ...(isNsfw ? { nsfw: true } : {})
            };
        }
    });

    // Collect hairstyles
    const hairstyles = {};
    document.querySelectorAll('.hairstyle-edit-row').forEach((row, i) => {
        const name = row.querySelector('.hair-name-input')?.value?.trim();
        const trigger = row.querySelector('.hair-trigger-input')?.value?.trim();
        if (name) {
            const hk = name.toLowerCase().replace(/[^a-z0-9]/g, '_') || `hair_${i}`;
            hairstyles[hk] = {
                display_name: name,
                trigger: trigger || ''
            };
        }
    });

    const charData = {
        display_name: displayName,
        lora_file: loraFile,
        lora_strength_model: strength,
        lora_strength_clip: strength,
        trigger_word: triggerWord,
        appearance: appearance,
        nsfw: isNsfwChar,
        outfits: outfits,
        ...(Object.keys(hairstyles).length > 0 ? { hairstyles } : {})
    };

    try {
        const resp = await fetch('/api/image/anime/characters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, data: charData })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: resp.statusText }));
            throw new Error(err.detail || `Error ${resp.status}`);
        }

        showToast(`Character '${displayName}' saved successfully!`, 'success');
        closeCharacterEditor();
        await loadRegistryData();
        renderCharacterCards();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function confirmDeleteCharacter(key, displayName) {
    if (!confirm(`Are you sure you want to delete '${displayName}'? This will remove it from the catalog and delete its LoRA file from disk.`)) return;

    try {
        const resp = await fetch(`/api/image/anime/characters/${key}`, {
            method: 'DELETE'
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: resp.statusText }));
            throw new Error(err.detail || `Error ${resp.status}`);
        }
        showToast(`Character '${displayName}' and its file removed.`, 'info');
        await loadRegistryData();
        renderCharacterCards();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function setupLoraDropZone() {
    const dropZone = document.getElementById('loraDropZone');
    const fileInput = document.getElementById('loraFileInput');
    const submitBtn = document.getElementById('submitImportLoraBtn');

    if (!dropZone || !fileInput || !submitBtn) return;

    // Clicking dropzone (outside the browse label) triggers file selection
    dropZone.addEventListener('click', (e) => {
        if (e.target.closest('#loraBrowseBtn')) return;
        fileInput.click();
    });

    const highlightDrop = (on) => {
        dropZone.style.borderColor = on ? 'var(--accent-purple)' : 'var(--glass-border)';
        dropZone.style.background = on ? 'rgba(139, 92, 246, 0.15)' : 'rgba(0, 0, 0, 0.25)';
    };

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        highlightDrop(true);
    });

    dropZone.addEventListener('dragleave', () => highlightDrop(false));

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        highlightDrop(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleLoraFileSelected(e.dataTransfer.files[0]);
        }
    });

    // Window-level drag-drop support for .safetensors files
    const studioModal = document.getElementById('imageStudioModal');
    if (studioModal) {
        studioModal.addEventListener('dragover', (e) => e.preventDefault());
        studioModal.addEventListener('drop', (e) => {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.name.toLowerCase().endsWith('.safetensors') || file.name.toLowerCase().endsWith('.pt')) {
                    e.preventDefault();
                    toggleLoraImporter(true);
                    handleLoraFileSelected(file);
                    const sec = document.getElementById('smartLoraImporterSection');
                    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        });
    }

    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
            handleLoraFileSelected(fileInput.files[0]);
        }
    });

    const nameInput = document.getElementById('loraImportNameInput');
    const keyInput = document.getElementById('loraImportKeyInput');
    if (nameInput && keyInput) {
        nameInput.addEventListener('input', () => {
            if (!keyInput.dataset.manualEdit) {
                keyInput.value = nameInput.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
            }
        });
        keyInput.addEventListener('input', () => {
            keyInput.dataset.manualEdit = 'true';
        });
    }

    submitBtn.addEventListener('click', handleUploadLora);
}

function handleLoraFileSelected(file) {
    _selectedLoraFile = file;
    _selectedLoraHostPath = null;
    const nameInput = document.getElementById('loraImportNameInput');
    const keyInput = document.getElementById('loraImportKeyInput');
    const label = document.getElementById('loraDropZoneLabel');
    if (label) {
        label.innerHTML = `<span style="color: #4ade80; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Selected:</span> <strong>${escapeHtml(file.name)}</strong> <span style="color: var(--text-muted); font-size: 0.72rem;">(${(file.size / 1024 / 1024).toFixed(1)} MB)</span>`;
    }
    const cleanSlug = file.name.replace(/\.(safetensors|pt)$/i, '').replace(/^(char_|concept_|pose_|expr_)/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    if (keyInput && !keyInput.value.trim()) {
        keyInput.value = cleanSlug;
        delete keyInput.dataset.manualEdit;
    }
    if (nameInput && !nameInput.value.trim()) {
        const clean = file.name.replace(/\.(safetensors|pt)$/i, '').replace(/^(char_|concept_|pose_|expr_)/i, '').replace(/[_-]/g, ' ');
        nameInput.value = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
}

function handleLoraHostFileSelected(file) {
    _selectedLoraHostPath = file.path;
    _selectedLoraFile = null;
    const nameInput = document.getElementById('loraImportNameInput');
    const keyInput = document.getElementById('loraImportKeyInput');
    const label = document.getElementById('loraDropZoneLabel');
    if (label) {
        label.innerHTML = `<span style="color: #38bdf8; font-weight: 600;"><i class="fa-solid fa-server"></i> Host File:</span> <strong>${escapeHtml(file.name)}</strong> <span style="color: var(--text-muted); font-size: 0.72rem;">(${escapeHtml(file.path)})</span>`;
    }
    const cleanSlug = file.name.replace(/\.(safetensors|pt)$/i, '').replace(/^(char_|concept_|pose_|expr_)/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    if (keyInput && !keyInput.value.trim()) {
        keyInput.value = cleanSlug;
        delete keyInput.dataset.manualEdit;
    }
    if (nameInput && !nameInput.value.trim()) {
        const clean = file.name.replace(/\.(safetensors|pt)$/i, '').replace(/^(char_|concept_|pose_|expr_)/i, '').replace(/[_-]/g, ' ');
        nameInput.value = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
}

async function handleUploadLora() {
    if (!_selectedLoraFile && !_selectedLoraHostPath) {
        showToast('Please drop, upload, or browse a host .safetensors file first', 'warning');
        return;
    }
    const category = document.getElementById('loraImportCategorySelect')?.value || 'character';
    const key = document.getElementById('loraImportKeyInput')?.value?.trim();
    const name = document.getElementById('loraImportNameInput')?.value?.trim();
    const triggerWord = document.getElementById('loraImportTriggerInput')?.value?.trim() || '';
    const appearance = document.getElementById('loraImportAppearanceInput')?.value?.trim() || '';
    const strength = document.getElementById('loraImportStrengthInput')?.value || '0.9';
    const isNsfw = !!document.getElementById('loraImportNsfwCheck')?.checked;

    const outfitName = document.getElementById('loraImportOutfitNameInput')?.value?.trim() || 'Default Outfit';
    const outfitTrigger = document.getElementById('loraImportOutfitTriggerInput')?.value?.trim() || '';
    const outfitIsNsfw = !!document.getElementById('loraImportOutfitNsfwCheck')?.checked;

    if (!name) {
        showToast('Display Name is required', 'warning');
        return;
    }

    const submitBtn = document.getElementById('submitImportLoraBtn');
    if (submitBtn) submitBtn.disabled = true;

    try {
        if (_selectedLoraHostPath) {
            showToast('Registering LoRA from host disk...', 'info');
            const resp = await fetch('/api/image/anime/loras/import-host-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_path: _selectedLoraHostPath,
                    category: category,
                    key: key || undefined,
                    name: name,
                    trigger_word: triggerWord,
                    appearance: appearance,
                    strength: parseFloat(strength) || 0.9,
                    is_nsfw: isNsfw,
                    outfit_name: outfitName,
                    outfit_trigger: outfitTrigger,
                    outfit_is_nsfw: outfitIsNsfw
                })
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                throw new Error(err.detail || `Host import failed ${resp.status}`);
            }

            const resData = await resp.json();
            showToast(`LoRA registered successfully as ${resData.filename}!`, 'success');
        } else {
            showToast('Uploading and registering LoRA...', 'info');
            const formData = new FormData();
            formData.append('file', _selectedLoraFile);
            formData.append('category', category);
            if (key) formData.append('key', key);
            formData.append('name', name);
            formData.append('trigger_word', triggerWord);
            formData.append('appearance', appearance);
            formData.append('strength', strength);
            formData.append('is_nsfw', isNsfw);
            formData.append('outfit_name', outfitName);
            formData.append('outfit_trigger', outfitTrigger);
            formData.append('outfit_is_nsfw', outfitIsNsfw);

            const resp = await fetch('/api/image/anime/loras/import', {
                method: 'POST',
                body: formData,
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                throw new Error(err.detail || `Upload failed ${resp.status}`);
            }

            const resData = await resp.json();
            showToast(`LoRA registered successfully as ${resData.filename}!`, 'success');
        }

        _selectedLoraFile = null;
        _selectedLoraHostPath = null;
        const fileInput = document.getElementById('loraFileInput');
        if (fileInput) fileInput.value = '';
        const label = document.getElementById('loraDropZoneLabel');
        if (label) label.textContent = 'Drop .safetensors LoRA file here or browse';
        const keyInput = document.getElementById('loraImportKeyInput');
        if (keyInput) {
            keyInput.value = '';
            delete keyInput.dataset.manualEdit;
        }
        const nameInput = document.getElementById('loraImportNameInput');
        if (nameInput) nameInput.value = '';
        const trigInput = document.getElementById('loraImportTriggerInput');
        if (trigInput) trigInput.value = '';
        const appInput = document.getElementById('loraImportAppearanceInput');
        if (appInput) appInput.value = '';
        const nsfwCheck = document.getElementById('loraImportNsfwCheck');
        if (nsfwCheck) nsfwCheck.checked = false;
        const outfitNameInput = document.getElementById('loraImportOutfitNameInput');
        if (outfitNameInput) outfitNameInput.value = 'Default Outfit';
        const outfitTrigInput = document.getElementById('loraImportOutfitTriggerInput');
        if (outfitTrigInput) outfitTrigInput.value = '';
        const outfitNsfwCheck = document.getElementById('loraImportOutfitNsfwCheck');
        if (outfitNsfwCheck) outfitNsfwCheck.checked = false;

        // Collapse importer and switch to the category that was imported
        toggleLoraImporter(false);
        const tabTarget = category === 'character' ? 'characters' : (category === 'concept' ? 'concepts' : 'poses');
        await loadRegistryData();
        switchCategoryTab(tabTarget);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function openOptionEditor(category, key) {
    closeCharacterEditor();
    closeLoraImporter();
    _editingOptionCategory = category; // 'concepts' | 'poses'
    _editingOptionKey = key;

    const card = document.getElementById('optionEditorCard');
    const titleEl = document.getElementById('optionEditorTitle');
    const iconEl = document.getElementById('optionEditorIcon');
    const saveBtnText = document.getElementById('saveOptionBtnText');
    if (!card) return;

    card.classList.remove('hidden');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const isConcept = category === 'concepts';
    const singular = isConcept ? 'Concept' : 'Pose';
    if (iconEl) {
        iconEl.className = isConcept ? 'fa-solid fa-wand-magic-sparkles' : 'fa-solid fa-person-walking';
    }

    const item = key && _registry?.[category]?.[key] ? _registry[category][key] : null;

    if (titleEl) {
        titleEl.textContent = item ? `Edit ${singular}: ${item.display_name || key}` : `Create ${singular} Profile`;
    }
    if (saveBtnText) {
        saveBtnText.textContent = `Save ${singular} to JSON`;
    }

    const keyInput = document.getElementById('optionEditKeyInput');
    if (keyInput) {
        keyInput.value = key || '';
        keyInput.disabled = !!key;
    }
    const nameInput = document.getElementById('optionEditNameInput');
    if (nameInput) nameInput.value = item?.display_name || '';

    const loraInput = document.getElementById('optionEditLoraInput');
    if (loraInput) loraInput.value = item?.lora_file || '';

    const strengthInput = document.getElementById('optionEditStrengthInput');
    if (strengthInput) strengthInput.value = item?.strength != null ? item.strength : '1.0';

    const triggerInput = document.getElementById('optionEditTriggerInput');
    if (triggerInput) triggerInput.value = item?.trigger || '';

    const nsfwCheck = document.getElementById('optionEditNsfwCheck');
    if (nsfwCheck) nsfwCheck.checked = !!item?.nsfw;
}

function closeOptionEditor() {
    _editingOptionCategory = null;
    _editingOptionKey = null;
    const card = document.getElementById('optionEditorCard');
    if (card) card.classList.add('hidden');
}

async function handleSaveOption() {
    if (!_editingOptionCategory) return;
    const isConcept = _editingOptionCategory === 'concepts';
    const singular = isConcept ? 'Concept' : 'Pose';
    const isEdit = !!_editingOptionKey;
    const rawKey = isEdit ? _editingOptionKey : document.getElementById('optionEditKeyInput')?.value?.trim();
    const key = (rawKey || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const displayName = document.getElementById('optionEditNameInput')?.value?.trim();
    const loraFile = document.getElementById('optionEditLoraInput')?.value?.trim() || null;
    const strength = parseFloat(document.getElementById('optionEditStrengthInput')?.value || '1.0');
    const trigger = document.getElementById('optionEditTriggerInput')?.value?.trim() || '';
    const isNsfw = !!document.getElementById('optionEditNsfwCheck')?.checked;

    if (!key || !displayName) {
        showToast('Key and Display Name are required', 'warning');
        return;
    }

    if (key === 'none') {
        showToast('The default item cannot be modified', 'error');
        return;
    }

    const payload = {
        key,
        data: {
            display_name: displayName,
            lora_file: loraFile,
            strength: isNaN(strength) ? 1.0 : strength,
            trigger: trigger,
            nsfw: isNsfw
        }
    };

    try {
        const resp = await fetch(`/api/image/anime/options/${_editingOptionCategory}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: resp.statusText }));
            throw new Error(err.detail || `Save failed ${resp.status}`);
        }
        showToast(`${singular} '${displayName}' saved successfully!`, 'success');
        closeOptionEditor();
        await loadRegistryData();
        renderActiveTab();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
