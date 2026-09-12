# JavaScript Architecture

This directory contains the client-side JavaScript for nivm. The code is split into domain-focused ES modules, with `app.js` serving as the main entrypoint and `ui.js` acting as a backward-compatible barrel for UI utilities.

## Directory Structure

```
static/js/
├── app.js                   # Main application bootstrap and coordination
├── ui.js                    # Barrel export for UI modules
├── api.js                   # Backend HTTP API client
├── state.js                 # Global application state and localStorage sync
├── dom.js                   # Cached DOM element references
├── theme.js                 # Theme engine, canvas backgrounds, color pickers
├── tools.js                 # Local tool definitions, parsing, and execution
├── voice.js                 # Voice mode stage, audio visualizer, TTS/STT
├── image_editor.js          # In-chat before/after sliders and image previews
├── flowfield.js             # Flow field canvas background
├── extras.js                # Easter eggs and credits modal
│
├── chat/
│   ├── chat_stream.js       # SSE stream consumer, token metrics, generation loop
│   ├── chat_messages.js     # Message bubble rendering, tool traces, markdown
│   └── chat_history.js      # Conversation manager, drawer, search, delete
│
├── modals/
│   ├── dialogs.js           # Draggable windows, toasts, alerts, confirms
│   ├── settings_modal.js    # Inference modes, engine controls, remote models
│   ├── personality_modal.js # System prompt presets and custom personas
│   ├── file_browser.js      # GGUF file picker and aria2 downloader
│   ├── sentinel_modal.js    # Network monitor and real-time oscilloscope
│   └── tools_settings.js    # Tools toggles and usage stats modal
│
├── media/
│   └── media_manager.js     # Vision upload, audio recording, lightbox, video
│
└── memory/
    └── memory_drawer.js     # Long-term memory drawer and category viewer
```

## Module Overview

### Entrypoints
- **`app.js`**: Initializes canvas backgrounds, Marked options, event listeners, and global window bindings (`window.sendMessage`, `window.stopGeneration`, `window.summarizeAndRestart`, `window.exportChat`).
- **`ui.js`**: Re-exports all sub-modules so any script importing from `ui.js` continues to work without path changes.

### Chat (`chat/`)
- **`chat_stream.js`**: Handles `sendMessage`, SSE response parsing, thinking tags, tool execution calls, and stream reconnection.
- **`chat_messages.js`**: Formats assistant and user bubbles, attaches code block copy buttons, renders tool traces, and handles dynamic greetings.
- **`chat_history.js`**: Handles creating new chats, switching chats, saving to localStorage, and chat drawer search.

### Modals (`modals/`)
- **`dialogs.js`**: `makeDraggable` window helper, custom notifications, alerts, and confirmation dialogs.
- **`settings_modal.js`**: Manages routing, single-model, and API inference modes, local GGUF scan results, and engine start/stop.
- **`personality_modal.js`**: Pre-built prompt personas (architect, analyst, minimalist) and user custom persona storage.
- **`file_browser.js`**: Directory listing modal for selecting models or mmproj projectors, plus aria2 download cards.
- **`sentinel_modal.js`**: Network security telemetry, loopback verification, and real-time canvas oscilloscope.
- **`tools_settings.js`**: Checkboxes for enabling/disabling tools and usage stats display.

### Media & Memory
- **`media/media_manager.js`**: Drag-and-drop file attachments, vision compatibility checks, voice recording, lightbox image viewer, and video player.
- **`memory/memory_drawer.js`**: Displays key-value memories saved by nivm with categorized badges.
