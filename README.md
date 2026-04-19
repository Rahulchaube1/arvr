# GMDraw – Spatial AI Drawing Platform

A browser-based Augmented Reality drawing platform that lets you paint in
3-D space using only your hands.  No controllers, no special hardware —
just a webcam and a modern browser.

---

## ✨ Features

| Phase | Capability |
|-------|-----------|
| 1 – Baseline | Hand tracking (MediaPipe), pinch-to-draw, undo/redo, local session persistence (IndexedDB) |
| 2 – AI Layer | Catmull-Rom + Douglas-Peucker stroke smoothing, shape recognition & correction (circle / rectangle / triangle / line), 4 brush types |
| 3 – Collaboration | Real-time multi-tab drawing via BroadcastChannel, room codes, peer cursors |
| 4 – Advanced AI | Voice commands (Web Speech API), AI shape generation, keyboard shortcuts |

---

## 🤏 Gesture Guide

| Gesture | Action |
|---------|--------|
| Pinch (thumb + index close) | Draw |
| Open hand | Finish stroke |
| Fist | Undo last stroke |
| Two fingers (index + middle) | Eraser |
| Three fingers | Shape snap mode |

---

## 🎤 Voice Commands

Say any of the following after enabling the microphone button:

- **Colors:** `red`, `blue`, `green`, `yellow`, `white`, `black`, `orange`, `purple`, `pink`, `cyan`
- **Size:** `big`, `large`, `thick` / `small`, `thin` / `medium`
- **Tools:** `pen`, `marker`, `brush`, `eraser`
- **Actions:** `undo`, `redo`, `clear`, `export`, `save`
- **AI:** `smoothing on/off`, `shape correction on/off`
- **Generate:** `draw circle`, `draw square`, `draw triangle`, `draw line`
- **Help:** `help`

---

## 🚀 Quick Start

```bash
# Serve locally (requires Node.js)
npm start
# Then open http://localhost:8080
```

Or use any static file server — the app is pure HTML + ES modules.

> **Note:** Camera access requires HTTPS or `localhost`.  
> File:// URLs will not work due to ES module CORS restrictions.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Export JSON |

---

## 🗂️ Project Structure

```
index.html          Main app shell & UI
styles/main.css     Application styles
src/
  app.js            Orchestrator – wires all modules together
  renderer.js       Three.js scene, camera, WebGL renderer
  drawing.js        Stroke engine: TubeGeometry, undo/redo, eraser
  gestures.js       MediaPipe Hands wrapper & gesture classifier
  aiProcessor.js    Stroke smoothing + shape recognition/correction
  voiceCommands.js  Web Speech API integration
  collaboration.js  BroadcastChannel multi-tab real-time sync
  persistence.js    IndexedDB auto-save + JSON/PNG/SVG export
  notifications.js  Toast notification system
package.json        Dev server script (npx serve)
```

---

## 🏗️ Architecture

```
  Webcam → MediaPipe Hands → GestureProcessor
                                    ↓
              DrawingEngine ← App Orchestrator → UIManager
                    ↓                ↓                ↓
             AIProcessor       Collaboration     Persistence
          (smooth/shapes)    (BroadcastChannel)  (IndexedDB)
                    ↓
             Three.js Renderer (TubeGeometry strokes)
                    ↓
             AR Canvas overlay on live video feed
```

---

## 🔮 Roadmap

- [ ] WebSocket backend for true cross-device collaboration
- [ ] ARKit / ARCore native app (Phase 3+)
- [ ] LLM-assisted contextual drawing suggestions
- [ ] Wearable AR device support (smart glasses)
- [ ] Surface-aware SLAM-based stroke placement