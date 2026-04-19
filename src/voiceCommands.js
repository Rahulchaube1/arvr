/**
 * GMDraw – Voice Commands  (Phase 4)
 *
 * Uses the Web Speech API (continuous recognition) to let the user control
 * the app hands-free.
 *
 * Supported commands
 * ──────────────────
 * Colors  : "red" "blue" "green" "yellow" "white" "black"
 *           "orange" "purple" "pink" "cyan"
 * Size    : "big" / "large" / "thick"  |  "small" / "thin"  |  "medium"
 * Tools   : "pen" "marker" "brush" "eraser"
 * Actions : "undo" "redo" "clear" "export" "save"
 * AI      : "smoothing on/off"  "shape correction on/off"
 * Generate: "draw circle" "draw square" "draw rectangle" "draw triangle" "draw line"
 * Help    : "help"
 */
export class VoiceCommands {
    constructor(onCommand) {
        this.onCommand   = onCommand;
        this.isListening = false;
        this.isSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
        this._rec        = null;
    }

    init() {
        if (!this.isSupported) return false;
        const SR     = window.SpeechRecognition || window.webkitSpeechRecognition;
        this._rec    = new SR();
        this._rec.continuous      = true;
        this._rec.interimResults  = false;
        this._rec.lang            = 'en-US';

        this._rec.onresult = e => {
            const transcript = e.results[e.results.length - 1][0].transcript.toLowerCase().trim();
            this._dispatch(transcript);
        };
        this._rec.onerror = e => {
            if (e.error === 'no-speech') this._restart();
        };
        this._rec.onend = () => {
            if (this.isListening) this._restart();
        };
        return true;
    }

    start() {
        if (!this._rec) return;
        this.isListening = true;
        try { this._rec.start(); } catch (_) { /* already running */ }
    }

    stop() {
        this.isListening = false;
        this._rec?.stop();
    }

    _restart() {
        if (this.isListening) try { this._rec.start(); } catch (_) {}
    }

    _dispatch(t) {
        // ── Colors ──────────────────────────────────────────────────────────────
        const colorMap = {
            red: 0xff3b30, blue: 0x007aff, green: 0x34c759, yellow: 0xffcc00,
            white: 0xffffff, black: 0x000000, orange: 0xff9500, purple: 0xaf52de,
            pink: 0xff2d55, cyan: 0x5ac8fa,
        };
        for (const [name, hex] of Object.entries(colorMap)) {
            if (t.includes(name)) { this.onCommand({ action: 'set_color', value: hex, label: name }); return; }
        }

        // ── Size ────────────────────────────────────────────────────────────────
        if (/\b(big|large|thick)\b/.test(t))          { this.onCommand({ action: 'set_size', value: 'large'  }); return; }
        if (/\b(small|thin|tiny)\b/.test(t))           { this.onCommand({ action: 'set_size', value: 'small'  }); return; }
        if (/\b(medium|normal|regular)\b/.test(t))     { this.onCommand({ action: 'set_size', value: 'medium' }); return; }

        // ── Tools ───────────────────────────────────────────────────────────────
        if (/\bmarker\b/.test(t))                       { this.onCommand({ action: 'set_tool', value: 'marker' }); return; }
        if (/\bbrush\b/.test(t))                        { this.onCommand({ action: 'set_tool', value: 'brush'  }); return; }
        if (/\beraser\b/.test(t))                       { this.onCommand({ action: 'set_tool', value: 'eraser' }); return; }
        if (/\bpen\b/.test(t))                          { this.onCommand({ action: 'set_tool', value: 'pen'    }); return; }

        // ── Actions ─────────────────────────────────────────────────────────────
        if (/\bclear\b|\berase all\b/.test(t))         { this.onCommand({ action: 'clear'  }); return; }
        if (/\bundo\b/.test(t))                         { this.onCommand({ action: 'undo'   }); return; }
        if (/\bredo\b/.test(t))                         { this.onCommand({ action: 'redo'   }); return; }
        if (/\b(export|save|download)\b/.test(t))       { this.onCommand({ action: 'export' }); return; }

        // ── AI toggles ──────────────────────────────────────────────────────────
        if (/smooth(ing)?\s+on\b/.test(t))              { this.onCommand({ action: 'toggle_smooth', value: true  }); return; }
        if (/smooth(ing)?\s+off\b/.test(t))             { this.onCommand({ action: 'toggle_smooth', value: false }); return; }
        if (/shape\s+(correction\s+)?on\b/.test(t))     { this.onCommand({ action: 'toggle_shape',  value: true  }); return; }
        if (/shape\s+(correction\s+)?off\b/.test(t))    { this.onCommand({ action: 'toggle_shape',  value: false }); return; }

        // ── Shape generation ────────────────────────────────────────────────────
        if (/draw\s+circle\b/.test(t))                  { this.onCommand({ action: 'draw_shape', shape: 'circle'    }); return; }
        if (/draw\s+(square|rectangle)\b/.test(t))      { this.onCommand({ action: 'draw_shape', shape: 'rectangle' }); return; }
        if (/draw\s+triangle\b/.test(t))                { this.onCommand({ action: 'draw_shape', shape: 'triangle'  }); return; }
        if (/draw\s+line\b/.test(t))                    { this.onCommand({ action: 'draw_shape', shape: 'line'      }); return; }

        // ── Help ────────────────────────────────────────────────────────────────
        if (/\bhelp\b/.test(t))                         { this.onCommand({ action: 'help' }); return; }
    }
}
