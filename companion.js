// ================================================================
//        Furby Companion — browser version (with vibration toggle)
// ================================================================
(function () {
    'use strict';

    class Companion {
        constructor() {
            this.channel = new BroadcastChannel('furby-comair');
            this.channel.onmessage = (e) => this.onMessage(e.data);
            this.lastStatusAt = 0;
            this.vibrateOn = true;
            this.vibeSupported = true;

            this.setupUI();
            this.log('companion ready');

            this.requestStatus();
            setInterval(() => this.requestStatus(), 3000);
            setInterval(() => this.tickConnection(), 1000);
        }

        setupUI() {
            document.querySelectorAll('.tab').forEach(btn => {
                btn.onclick = () => {
                    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
                    btn.classList.add('active');
                    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
                };
            });
            document.querySelectorAll('[data-action]').forEach(btn => {
                btn.onclick = () => {
                    this.sendAction(btn.dataset.action);
                    btn.animate([{ transform: 'scale(0.9)' }, { transform: 'scale(1)' }], { duration: 180 });
                };
            });
            document.querySelectorAll('.swatch').forEach(btn => {
                btn.onclick = () => this.sendAction('set_color', { color: btn.dataset.color });
            });

            // Vibration toggle
            const vibeBtn = document.getElementById('vibe-toggle');
            if (vibeBtn) {
                vibeBtn.onclick = () => {
                    this.vibrateOn = !this.vibrateOn;
                    vibeBtn.classList.toggle('off', !this.vibrateOn);
                    this.sendAction('vibrate_toggle', { enabled: this.vibrateOn });
                    this.log(`vibration → ${this.vibrateOn ? 'ON' : 'OFF'}`);
                };
            }
        }

        sendAction(action, extra = {}) {
            this.channel.postMessage({ type: 'app_command', action, from: 'companion', ts: Date.now(), ...extra });
            this.log(`→ ${action}${extra.color ? ' ' + extra.color : ''}${extra.enabled !== undefined ? ' ' + extra.enabled : ''}`);
        }

        requestStatus() {
            this.channel.postMessage({ type: 'status_request', from: 'companion', ts: Date.now() });
        }

        onMessage(msg) {
            if (!msg) return;
            if (msg.type === 'status') {
                this.lastStatusAt = Date.now();
                this.updateStatusUI(msg);
            } else if (msg.type === 'app_response') {
                this.log(`✓ ${msg.model || '?'} ack ${msg.command}`);
            } else if (msg.type === 'command') {
                this.log(`👂 heard: ${msg.name || msg.value} [${msg.model || '?'}]`);
            }
        }

        updateStatusUI(f) {
            document.getElementById('mood-val').textContent = f.mood || '—';
            this.setBar('hunger', f.hunger || 0);
            this.setBar('energy', f.energy || 0);
            this.setBar('friendship', f.friendship || 0);
            document.getElementById('model-label').textContent = f.model || '—';

            // Sync vibration state
            const vibeBtn = document.getElementById('vibe-toggle');
            if (vibeBtn) {
                if (typeof f.vibrationSupported === 'boolean') {
                    this.vibeSupported = f.vibrationSupported;
                    vibeBtn.classList.toggle('unsupported', !this.vibeSupported);
                }
                if (typeof f.vibrationEnabled === 'boolean' && f.vibrationEnabled !== this.vibrateOn) {
                    this.vibrateOn = f.vibrationEnabled;
                    vibeBtn.classList.toggle('off', !this.vibrateOn);
                }
            }
        }

        setBar(name, value) {
            const bar = document.getElementById(name + '-bar');
            const num = document.getElementById(name + '-num');
            if (bar) bar.style.width = Math.min(100, value) + '%';
            if (num) num.textContent = Math.round(value) + '%';
        }

        tickConnection() {
            const el = document.getElementById('connection');
            const online = Date.now() - this.lastStatusAt < 8000;
            el.className = 'conn ' + (online ? 'online' : 'offline');
            el.textContent = online ? 'online' : 'offline';
        }

        log(msg) {
            const el = document.getElementById('log');
            if (!el) return;
            const line = document.createElement('div');
            line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            el.prepend(line);
            while (el.children.length > 60) el.removeChild(el.lastChild);
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        window.companion = new Companion();
    });
})();