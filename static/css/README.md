# nivm Frontend CSS Architecture

This directory contains the stylesheets for the `nivm` sovereign AI interface.

## Entrypoints
- `main.css`: The root stylesheet loaded in `index.html`. It imports all base, background, layout, chat, and modal stylesheets in order.
- `chat.css`: Entrypoint for chat layout and messaging. Imports domain sheets from `chat/`.
- `modals.css`: Entrypoint for floating windows and dialogs. Imports domain sheets from `modals/`.

---

## Directory Sitemaps

### `static/css/modals/` (Modals & Windows)
| File | Lines | What it Styles |
|---|---|---|
| `modals_base.css` | ~460 | Draggable window framing, headers, bodies, footers, action buttons, color pickers, confirm/alert dialogs, image lightbox |
| `settings_modal.css` | ~750 | Inference mode segmented buttons, model paths, API settings, preferences 2-column quick action grid, smart load/unload toggle |
| `sentinel_modal.css` | ~320 | Air-gap network monitor, security logs, oscilloscope canvas frame, active socket connection tables |
| `downloader_modal.css` | ~320 | In-browser file explorer modal, breadcrumb navigation, aria2 accelerated download progress cards |
| `voice_modal.css` | ~555 | Voice customizer, animated glowing orb, 5 color preset circles, pace/warmth sliders, pronunciation lexicon table, single-row action footer |
| `extras_modal.css` | ~610 | Project credits / creator modal, holographic glitch animations, Reze interactive Easter egg |
| `modals_mobile.css` | ~465 | Mobile responsive modal sheets (`@media (max-width: 768px)`), safe-area insets, mobile in-browser file explorer sheet |

### `static/css/chat/` (Chat Interface & Controls)
| File | Lines | What it Styles |
|---|---|---|
| `chat_drawers.css` | ~150 | Desktop & slide-out history drawer, drawer brand, search input, conversation list items, ghost delete button |
| `chat_layout.css` | ~60 | Main content viewport, landing hero dynamic greeting, empty state container |
| `chat_messages.css` | ~280 | User and assistant message bubbles, consecutive step chains, message action icons, stats popover, code block containers |
| `chat_input.css` | ~305 | Floating Gemini-style input wrapper, textarea auto-expand, input controls, thumbnail attachment previews, collapsible messages |
| `chat_media.css` | ~480 | In-bubble media gallery, waveform audio player, audio/video/document pills, microphone recording button, no-model overlay |
| `chat_events.css` | ~200 | Conversation ended / locked timeline markers, history lock badges, resume appeal chips and submission form |
| `chat_notifications.css` | ~300 | Dropdown toast notification system (info, success, warning, error) with progress bars |
| `chat_voice.css` | ~535 | Floating docked speech orb visualizer (orb + 5-band frequency bars) & pure Voice Conversation Mode stage |
| `chat_mobile.css` | ~575 | Mobile responsive chat viewport (`@media (max-width: 768px)`), mobile header, 8-item quick control center footer, touch-friendly visualizer |

---

## Modifying Styles
When adding or updating styles:
1. Locate the specific feature's file from the table above (e.g. for voice customizer, edit `modals/voice_modal.css`).
2. Avoid adding styles to `main.css`, `modals.css`, or `chat.css` directly—keep them as clean entrypoints.
3. Every sub-sheet is under 800 lines for fast reading and maintenance.
