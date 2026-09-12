/* file explorer modal & aria2 downloader */

import { dom } from '../dom.js';
import { listDirectory, openNativeFileDialog, startModelDownload, pollDownloadStatus, cancelModelDownload, saveApiSettings } from '../api.js';
import { makeDraggable, showNotification, showAlert } from './dialogs.js';
import { verifyPathStatus, refreshScannedModelsList } from './settings_modal.js';

let fileBrowserTarget = 'model'; // 'model' | 'mmproj'
let currentBrowserData = null;
let selectedBrowserFile = null;
let downloadPollTimer = null;

export async function openFileBrowserModal(target = 'model') {
    fileBrowserTarget = target;
    selectedBrowserFile = null;
    if (dom.fileBrowserModalTitle) {
        dom.fileBrowserModalTitle.textContent = target === 'mmproj'
            ? 'Browse & Select Vision Projector (mmproj)'
            : 'Browse & Select GGUF Model';
    }
    if (dom.fileBrowserSelectBtn) {
        dom.fileBrowserSelectBtn.disabled = true;
        dom.fileBrowserSelectBtn.textContent = target === 'mmproj' ? 'Select Projector' : 'Select Model';
    }
    if (dom.fileBrowserSelectionInfo) {
        dom.fileBrowserSelectionInfo.innerHTML = '<span class="file-browser-none-selected">No file selected</span>';
    }
    if (dom.fileBrowserSearchInput) dom.fileBrowserSearchInput.value = '';

    if (dom.fileBrowserModal) dom.fileBrowserModal.classList.remove('hidden');

    const win = dom.fileBrowserWindow || document.getElementById('fileBrowserWindow');
    const header = dom.fileBrowserHeader || document.getElementById('fileBrowserHeader');
    if (win && header && !win.dataset.draggableInitialized) {
        makeDraggable(win, header);
        win.dataset.draggableInitialized = 'true';
    }

    let initialPath = null;
    const inputVal = target === 'mmproj' ? dom.customMmprojInput?.value.trim() : dom.customModelPathInput?.value.trim();
    if (inputVal && inputVal.includes('/')) {
        initialPath = inputVal.substring(0, inputVal.lastIndexOf('/'));
    }
    await loadBrowserDirectory(initialPath);
}

export async function loadBrowserDirectory(path = null) {
    if (dom.fileBrowserList) {
        dom.fileBrowserList.innerHTML = '<div class="file-browser-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading directory contents...</div>';
    }
    selectedBrowserFile = null;
    if (dom.fileBrowserSelectBtn) dom.fileBrowserSelectBtn.disabled = true;
    if (dom.fileBrowserSelectionInfo) {
        dom.fileBrowserSelectionInfo.innerHTML = '<span class="file-browser-none-selected">No file selected</span>';
    }

    const data = await listDirectory(path);
    currentBrowserData = data;

    if (dom.fileBrowserCurrentPathInput) {
        dom.fileBrowserCurrentPathInput.value = data.current_path || '';
    }

    if (dom.fileBrowserUpBtn) {
        dom.fileBrowserUpBtn.disabled = !data.parent_path;
    }

    if (dom.fileBrowserShortcuts && data.shortcuts) {
        dom.fileBrowserShortcuts.innerHTML = '';
        data.shortcuts.forEach(s => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'file-browser-shortcut';
            if (data.current_path === s.path) btn.classList.add('active');
            btn.innerHTML = `<i class="fa-solid ${s.icon || 'fa-folder'}"></i> ${s.name}`;
            btn.addEventListener('click', () => loadBrowserDirectory(s.path));
            dom.fileBrowserShortcuts.appendChild(btn);
        });
    }

    renderBrowserFileList();
}

export function renderBrowserFileList() {
    if (!dom.fileBrowserList || !currentBrowserData) return;
    dom.fileBrowserList.innerHTML = '';

    const onlyGguf = dom.fileBrowserOnlyGguf ? dom.fileBrowserOnlyGguf.checked : true;
    const query = dom.fileBrowserSearchInput ? dom.fileBrowserSearchInput.value.trim().toLowerCase() : '';

    const folders = (currentBrowserData.folders || []).filter(f => !query || f.name.toLowerCase().includes(query));
    folders.forEach(f => {
        const item = document.createElement('div');
        item.className = 'file-browser-item';
        item.innerHTML = `
            <div class="file-browser-item-left">
                <span class="file-browser-item-icon"><i class="fa-solid fa-folder" style="color: #fbbf24;"></i></span>
                <span class="file-browser-item-name">${f.name}</span>
            </div>
            <div class="file-browser-item-right">
                <i class="fa-solid fa-chevron-right" style="color: var(--text-tertiary); font-size: 0.75rem;"></i>
            </div>
        `;
        item.addEventListener('click', () => loadBrowserDirectory(f.path));
        dom.fileBrowserList.appendChild(item);
    });

    let files = currentBrowserData.files || [];
    if (onlyGguf) {
        files = files.filter(f => f.is_gguf);
    }
    if (query) {
        files = files.filter(f => f.name.toLowerCase().includes(query));
    }

    if (folders.length === 0 && files.length === 0) {
        dom.fileBrowserList.innerHTML = '<div class="file-browser-empty">No matching files or folders found</div>';
        return;
    }

    files.forEach(f => {
        const item = document.createElement('div');
        item.className = 'file-browser-item';
        if (selectedBrowserFile && selectedBrowserFile.path === f.path) {
            item.classList.add('active');
        }

        const iconHtml = f.is_gguf
            ? '<i class="fa-solid fa-cube" style="color: var(--accent-purple);"></i>'
            : '<i class="fa-regular fa-file" style="color: var(--text-tertiary);"></i>';

        const badgeHtml = f.is_gguf
            ? `<span class="file-browser-gguf-badge">GGUF</span>`
            : '';

        const sizeStr = f.size_gb >= 1 ? `${f.size_gb} GB` : `${f.size_mb || 0} MB`;

        item.innerHTML = `
            <div class="file-browser-item-left">
                <span class="file-browser-item-icon">${iconHtml}</span>
                <span class="file-browser-item-name">${f.name}</span>
            </div>
            <div class="file-browser-item-right">
                ${badgeHtml}
                <span class="file-browser-size-badge">${sizeStr}</span>
            </div>
        `;

        item.addEventListener('click', () => {
            document.querySelectorAll('.file-browser-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            selectedBrowserFile = f;
            if (dom.fileBrowserSelectionInfo) {
                dom.fileBrowserSelectionInfo.innerHTML = `<b>${f.name}</b> <span style="color: var(--text-tertiary);">(${sizeStr})</span>`;
            }
            if (dom.fileBrowserSelectBtn) {
                dom.fileBrowserSelectBtn.disabled = false;
            }
        });

        item.addEventListener('dblclick', () => {
            selectedBrowserFile = f;
            applyBrowserSelection();
        });

        dom.fileBrowserList.appendChild(item);
    });
}

export async function applyBrowserSelection() {
    if (!selectedBrowserFile) return;
    const p = selectedBrowserFile.path;
    const isMmproj = fileBrowserTarget === 'mmproj';

    if (isMmproj) {
        if (dom.customMmprojInput) dom.customMmprojInput.value = p;
        verifyPathStatus(p, dom.customMmprojStatus, true);
    } else {
        if (dom.customModelPathInput) dom.customModelPathInput.value = p;
        verifyPathStatus(p, dom.customModelPathStatus);
    }

    await saveApiSettings();
    await refreshScannedModelsList();

    if (dom.fileBrowserModal) dom.fileBrowserModal.classList.add('hidden');

    showNotification({
        title: isMmproj ? 'Projector Selected' : 'Model Selected',
        message: `${selectedBrowserFile.name} (${selectedBrowserFile.size_gb || 0} GB)`,
        type: 'success',
        icon: isMmproj ? 'fa-eye' : 'fa-cube'
    });
}

export async function handleBrowseFile(target = 'model') {
    if (window.innerWidth <= 768) {
        openFileBrowserModal(target);
        return;
    }

    const btn = target === 'mmproj' ? dom.browseMmprojBtn : dom.browseCustomPathBtn;
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Selecting...';
    }

    try {
        const currentVal = target === 'mmproj' ? dom.customMmprojInput?.value.trim() : dom.customModelPathInput?.value.trim();
        let initialDir = null;
        if (currentVal && currentVal.includes('/')) {
            initialDir = currentVal.substring(0, currentVal.lastIndexOf('/'));
        }

        const title = target === 'mmproj' ? 'Select Vision Projector GGUF' : 'Select GGUF Model File';
        const result = await openNativeFileDialog(initialDir, title);

        if (result && result.success && result.path) {
            if (dom.fileBrowserModal) dom.fileBrowserModal.classList.add('hidden');
            const isMmproj = target === 'mmproj';
            if (isMmproj) {
                if (dom.customMmprojInput) dom.customMmprojInput.value = result.path;
                verifyPathStatus(result.path, dom.customMmprojStatus, true);
            } else {
                if (dom.customModelPathInput) dom.customModelPathInput.value = result.path;
                verifyPathStatus(result.path, dom.customModelPathStatus);
            }

            await saveApiSettings();
            await refreshScannedModelsList();

            showNotification({
                title: isMmproj ? 'Projector Selected' : 'Model Selected',
                message: `${result.filename} (${result.size_gb} GB)`,
                type: 'success',
                icon: isMmproj ? 'fa-eye' : 'fa-cube'
            });
        } else if (result && result.fallback) {
            openFileBrowserModal(target);
        }
    } catch (err) {
        console.warn('Native browse error, opening explorer modal:', err);
        openFileBrowserModal(target);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

export async function updateDownloadUI() {
    const status = await pollDownloadStatus();
    if (!status) return;

    if (dom.downloadEngineBadge) {
        dom.downloadEngineBadge.innerHTML = status.aria2_available
            ? '<i class="fa-solid fa-shield-halved"></i> aria2 (Isolated)'
            : '<i class="fa-solid fa-shield-halved"></i> Stream (Isolated)';
    }

    if (status.status === 'downloading') {
        if (dom.downloadProgressCard) dom.downloadProgressCard.classList.remove('hidden');
        if (dom.downloadCardFilename) dom.downloadCardFilename.textContent = status.filename || 'Downloading...';
        if (dom.downloadCardSize) dom.downloadCardSize.textContent = `${status.downloaded_str} / ${status.total_str}`;
        if (dom.downloadCardSpeed) dom.downloadCardSpeed.textContent = status.speed_str;
        if (dom.downloadCardEta) dom.downloadCardEta.textContent = `ETA: ${status.eta_str}`;
        if (dom.downloadProgressBar) dom.downloadProgressBar.style.width = `${Math.min(status.percent, 100)}%`;
        if (dom.downloadPercentLabel) dom.downloadPercentLabel.textContent = `${status.percent}%`;
        if (dom.downloadEngineLabel) dom.downloadEngineLabel.textContent = `Engine: ${status.engine}`;
    } else if (status.status === 'completed') {
        if (downloadPollTimer) {
            clearInterval(downloadPollTimer);
            downloadPollTimer = null;
        }
        if (dom.downloadProgressBar) dom.downloadProgressBar.style.width = '100%';
        if (dom.downloadPercentLabel) dom.downloadPercentLabel.textContent = '100% Complete';
        if (dom.downloadCardSpeed) dom.downloadCardSpeed.textContent = 'Done';
        if (dom.downloadCardEta) dom.downloadCardEta.textContent = status.total_str;

        await refreshScannedModelsList();
        if (status.filename && status.filename.toLowerCase().includes('mmproj')) {
            if (dom.customMmprojInput) dom.customMmprojInput.value = status.path;
            verifyPathStatus(status.path, dom.customMmprojStatus, true);
        } else {
            if (dom.customModelPathInput) dom.customModelPathInput.value = status.path;
            verifyPathStatus(status.path, dom.customModelPathStatus);
        }
        saveApiSettings();
        showAlert("Download Finished", `Successfully downloaded ${status.filename}!`);
    } else if (status.status === 'error') {
        if (downloadPollTimer) {
            clearInterval(downloadPollTimer);
            downloadPollTimer = null;
        }
        if (dom.downloadCardSpeed) dom.downloadCardSpeed.textContent = 'Error';
        if (dom.downloadCardEta) dom.downloadCardEta.textContent = status.error || 'Failed';
        showAlert("Download Error", status.error || "Failed to download model.");
    } else if (status.status === 'cancelled') {
        if (downloadPollTimer) {
            clearInterval(downloadPollTimer);
            downloadPollTimer = null;
        }
        if (dom.downloadProgressCard) dom.downloadProgressCard.classList.add('hidden');
    }
}

export function setupFileBrowserUI() {
    if (dom.browseCustomPathBtn) {
        dom.browseCustomPathBtn.addEventListener('click', () => handleBrowseFile('model'));
    }
    if (dom.exploreCustomPathBtn) {
        dom.exploreCustomPathBtn.addEventListener('click', () => openFileBrowserModal('model'));
    }

    if (dom.browseMmprojBtn) {
        dom.browseMmprojBtn.addEventListener('click', () => handleBrowseFile('mmproj'));
    }
    if (dom.exploreMmprojBtn) {
        dom.exploreMmprojBtn.addEventListener('click', () => openFileBrowserModal('mmproj'));
    }

    if (dom.closeFileBrowserBtn) {
        dom.closeFileBrowserBtn.addEventListener('click', () => dom.fileBrowserModal.classList.add('hidden'));
    }
    if (dom.fileBrowserCancelBtn) {
        dom.fileBrowserCancelBtn.addEventListener('click', () => dom.fileBrowserModal.classList.add('hidden'));
    }
    if (dom.fileBrowserSelectBtn) {
        dom.fileBrowserSelectBtn.addEventListener('click', applyBrowserSelection);
    }
    if (dom.fileBrowserUpBtn) {
        dom.fileBrowserUpBtn.addEventListener('click', () => {
            if (currentBrowserData && currentBrowserData.parent_path) {
                loadBrowserDirectory(currentBrowserData.parent_path);
            }
        });
    }
    if (dom.fileBrowserGoBtn) {
        dom.fileBrowserGoBtn.addEventListener('click', () => {
            if (dom.fileBrowserCurrentPathInput) {
                loadBrowserDirectory(dom.fileBrowserCurrentPathInput.value.trim());
            }
        });
    }
    if (dom.fileBrowserCurrentPathInput) {
        dom.fileBrowserCurrentPathInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                loadBrowserDirectory(dom.fileBrowserCurrentPathInput.value.trim());
            }
        });
    }
    if (dom.fileBrowserSearchInput) {
        dom.fileBrowserSearchInput.addEventListener('input', renderBrowserFileList);
    }
    if (dom.fileBrowserOnlyGguf) {
        dom.fileBrowserOnlyGguf.addEventListener('change', renderBrowserFileList);
    }
    if (dom.fileBrowserNativeBtn) {
        dom.fileBrowserNativeBtn.addEventListener('click', () => handleBrowseFile(fileBrowserTarget));
    }

    if (dom.startDownloadBtn) {
        dom.startDownloadBtn.addEventListener('click', async () => {
            const url = dom.modelDownloadUrlInput ? dom.modelDownloadUrlInput.value.trim() : '';
            if (!url) {
                showAlert("Download", "Please enter a Hugging Face or direct GGUF URL.");
                return;
            }
            try {
                dom.startDownloadBtn.disabled = true;
                await startModelDownload(url);
                if (dom.downloadProgressCard) dom.downloadProgressCard.classList.remove('hidden');
                if (downloadPollTimer) clearInterval(downloadPollTimer);
                downloadPollTimer = setInterval(updateDownloadUI, 800);
                updateDownloadUI();
                showNotification({
                    title: 'Download Started',
                    message: 'Downloading model in background...',
                    type: 'info',
                    icon: 'fa-cloud-arrow-down'
                });
            } catch (err) {
                showAlert("Download Failed", err.message);
            } finally {
                dom.startDownloadBtn.disabled = false;
            }
        });
    }

    if (dom.cancelDownloadBtn) {
        dom.cancelDownloadBtn.addEventListener('click', async () => {
            await cancelModelDownload();
            if (downloadPollTimer) {
                clearInterval(downloadPollTimer);
                downloadPollTimer = null;
            }
            if (dom.downloadProgressCard) dom.downloadProgressCard.classList.add('hidden');
            showNotification({
                title: 'Download Cancelled',
                message: 'Model download has been cancelled.',
                type: 'warning'
            });
        });
    }
}
