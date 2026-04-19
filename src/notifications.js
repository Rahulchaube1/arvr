/**
 * GMDraw – Notification System
 * Provides non-blocking toast messages for all user-facing feedback.
 */
export class NotificationSystem {
    constructor() {
        this.container = this._createContainer();
    }

    _createContainer() {
        const el = document.createElement('div');
        el.id = 'gmdraw-notifications';
        Object.assign(el.style, {
            position: 'fixed',
            top: '76px',
            right: '20px',
            zIndex: '9999',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            pointerEvents: 'none',
            maxWidth: '320px',
        });
        document.body.appendChild(el);
        return el;
    }

    /**
     * @param {string} message
     * @param {'info'|'success'|'warning'|'error'} type
     * @param {number} duration ms before auto-dismiss
     */
    show(message, type = 'info', duration = 3000) {
        const palette = {
            info:    { bg: 'rgba(0,122,255,0.92)',  icon: 'ℹ️' },
            success: { bg: 'rgba(52,199,89,0.92)',  icon: '✅' },
            warning: { bg: 'rgba(255,204,0,0.92)',  icon: '⚠️' },
            error:   { bg: 'rgba(255,59,48,0.92)',  icon: '❌' },
        };
        const { bg, icon } = palette[type] || palette.info;

        const toast = document.createElement('div');
        Object.assign(toast.style, {
            background: bg,
            color: 'white',
            padding: '10px 16px',
            borderRadius: '12px',
            fontSize: '13px',
            fontWeight: '500',
            fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            backdropFilter: 'blur(12px)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
            transform: 'translateX(110%)',
            transition: 'transform 0.28s ease, opacity 0.28s ease',
            wordBreak: 'break-word',
        });
        toast.textContent = `${icon}  ${message}`;
        this.container.appendChild(toast);

        requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });

        const dismiss = () => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(110%)';
            setTimeout(() => toast.remove(), 300);
        };
        setTimeout(dismiss, duration);
        toast.addEventListener('click', dismiss);
    }

    info(msg, ms)    { this.show(msg, 'info',    ms); }
    success(msg, ms) { this.show(msg, 'success', ms); }
    warning(msg, ms) { this.show(msg, 'warning', ms); }
    error(msg, ms)   { this.show(msg, 'error',   ms); }
}
