// ================================================================
//      Furby 2012 — virtual pet with companion + vibration
//      Browser version (BroadcastChannel)
// ================================================================

const VIB = {
    ack:         [30],
    pet:         [25, 60, 25, 60, 25],
    speechPulse: [15],
    happy:       [40, 60, 40, 60, 40],
    excited:     [30, 25, 30, 25, 30, 25, 30, 25, 30, 25, 30],
    grumpy:      [150, 80, 150],
    sleepy:      [300],
    dizzy:       [100, 40, 100, 40, 100, 40, 150, 50, 200],
    flip:        [150, 60, 150, 60, 150, 60, 200, 80, 200],
    shake:       [50, 30, 50, 30, 50, 30, 50, 30, 50],
    dance:       [80, 50, 80, 50, 80, 50, 80, 50, 80],
    feed:        [60, 40, 60],
    play:        [30, 40, 30, 40, 30, 40, 30],
    sing:        [40, 60, 40, 60, 40, 60, 40]
};

// ================================================================
//                        PERSONALITY
// ================================================================
class Personality {
    constructor() {
        this.energy      = 0.2 + Math.random() * 0.8;
        this.curiosity   = 0.2 + Math.random() * 0.8;
        this.playfulness = 0.2 + Math.random() * 0.8;
        this.grumpiness  = 0.1 + Math.random() * 0.6;
        this.sociability = 0.3 + Math.random() * 0.7;
    }
    describe() {
        const t = [];
        if (this.energy > 0.6) t.push('energetic'); else if (this.energy < 0.35) t.push('lazy');
        if (this.curiosity > 0.6) t.push('curious'); else if (this.curiosity < 0.35) t.push('aloof');
        if (this.playfulness > 0.6) t.push('playful'); else if (this.playfulness < 0.35) t.push('serious');
        if (this.grumpiness > 0.55) t.push('grumpy');
        if (this.sociability > 0.6) t.push('social'); else if (this.sociability < 0.35) t.push('reserved');
        return t.length ? t.join(', ') : 'balanced';
    }
}

// ================================================================
//                        MAIN CLASS
// ================================================================
class Furby {
    constructor(manifest) {
        this.manifest = manifest;
        this.MODEL = '2012';

        this.eyes  = document.getElementById('eyes');
        this.state = 'off';
        this.eyeTimer = null;
        this._autoSpeakTimer = null;
        this._heartbeatTimer = null;
        this._pingTimer = null;
        this._statusTimer = null;
        this._vibInterval = null;
        this.bootPhase = true;
        this.id = Math.random().toString(36).slice(2, 8);

        this.audioA = new Audio(); this.audioA.preload = 'auto';
        this.audioB = new Audio(); this.audioB.preload = 'auto';
        this.audioLocked = false;

        this._prefetched = new Set();
        this._prefetchQueue = [];
        this._prefetchMax = 250;
        this._prefetching = false;

        this.micAnalyser = null;
        this.micData = null;
        this.threshold = 0.15;
        this.lastSoundAt = 0;

        this.channel = new BroadcastChannel('furby-comair');
        this.channel.onmessage = (e) => this.onRemoteCommand(e.data);
        this.comairEncoder = null;
        this.comairDecoder = null;
        this._audioCtx = null;
        this._micStream = null;

        this.personality = new Personality();
        this.mood = 'neutral';
        this.moodUntil = 0;
        this.friendship = 50;
        this.energy = 100;
        this.hunger = 30;
        this.furColor = null;
        this.lastInteractionAt = Date.now();

        this.vibrationEnabled = true;
        this.vibrationSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

        this.sensorsActive = false;
        this._wasFlipped = false;
        this.lastFlipAt = 0;
        this.lastShakeAt = 0;
        this._motionMagAvg = 9.8;
    }

    log(m) { console.log('[Furby 2012] ' + m); }
    setState(s) { this.state = s; console.log('[Furby 2012] state:', s); }

    // ---------------- Vibration ----------------
    vibrate(pattern) {
        if (!this.vibrationEnabled || !this.vibrationSupported) return;
        try { navigator.vibrate(pattern); } catch {}
    }
    stopVibration() {
        if (this._vibInterval) { clearInterval(this._vibInterval); this._vibInterval = null; }
        if (this.vibrationSupported) { try { navigator.vibrate(0); } catch {} }
    }
    startSpeechVibration() {
        this.stopVibration();
        if (!this.vibrationEnabled || !this.vibrationSupported) return;
        this._vibInterval = setInterval(() => {
            if (this.state !== 'speaking') return;
            try { navigator.vibrate(VIB.speechPulse); } catch {}
        }, 150);
    }

    // ---------------- BMP prefetch ----------------
    prefetch(p) {
        if (this._prefetched.has(p)) return;
        if (this._prefetched.size >= this._prefetchMax) {
            this._prefetched.delete(this._prefetched.values().next().value);
        }
        this._prefetched.add(p);
        this._prefetchQueue.push(p);
        this.drainPrefetch();
    }
    drainPrefetch() {
        if (this._prefetching) return;
        this._prefetching = true;
        const run = () => {
            if (!this._prefetchQueue.length) { this._prefetching = false; return; }
            const p = this._prefetchQueue.shift();
            const img = new Image();
            img.onload = img.onerror = () => setTimeout(run, 5);
            img.src = encodeURI(p);
        };
        run();
    }

    // ---------------- 2012 parameters ----------------
    get autoSpeakDelay() {
        const base = 8000 + Math.random() * 12000;
        return base / (0.5 + this.personality.sociability * 1.5);
    }
    get micCooldown() { return 1500 / (0.5 + this.personality.curiosity * 1.5); }
    get phraseLength() {
        const base = 2 + Math.floor(Math.random() * 4);
        return this.mood === 'excited' ? Math.min(6, base + 2)
             : this.mood === 'sleepy'  ? Math.max(1, base - 2) : base;
    }
    get eyeFrameCount() {
        const base = 10 + Math.floor(Math.random() * 10);
        const scale = 0.7 + this.personality.playfulness * 0.6;
        const boost = this.mood === 'excited' ? 1.4 : this.mood === 'sleepy' ? 0.6 : 1.0;
        return Math.max(5, Math.floor(base * scale * boost));
    }

    // ---------------- Mood ----------------
    setMood(m, d = 20000) {
        if (this.mood === m) { this.moodUntil = Date.now() + d; return; }
        const o = this.mood;
        this.mood = m; this.moodUntil = Date.now() + d;
        this.log(`mood: ${o} → ${m}`);
        switch (m) {
            case 'happy':   this.vibrate(VIB.happy);   break;
            case 'excited': this.vibrate(VIB.excited); break;
            case 'grumpy':  this.vibrate(VIB.grumpy);  break;
            case 'sleepy':  this.vibrate(VIB.sleepy);  break;
            case 'dizzy':   this.vibrate(VIB.dizzy);   break;
        }
    }

    tickMood() {
        const now = Date.now();
        if (['excited','grumpy','sleepy','dizzy','happy'].includes(this.mood) && now > this.moodUntil) this.setMood('neutral');
        this.hunger = Math.min(100, this.hunger + 0.3);
        if (this.hunger > 70 && this.mood === 'neutral' && Math.random() < 0.15) {
            this.setMood('grumpy', 15000);
            this.log('hungry — grumpy');
        }
        if (this.mood === 'neutral' && this.friendship < 60 && now - this.lastInteractionAt > 60000) {
            if (Math.random() < this.personality.grumpiness) { this.setMood('grumpy', 30000); this.log('ignored — grumpy'); }
        }
        this.energy = Math.min(100, this.energy + 2);
        if (this.energy < 20 && this.mood !== 'sleepy' && Math.random() < 0.3) {
            this.setMood('sleepy', 25000);
            this.log('low energy — sleepy');
        }
    }

    // ---------------- Idle ----------------
    startIdle() {
        this.clearAllTimers();
        this.setState('idle');
        this.scheduleIdleStep();
        this.scheduleAutoSpeak();
    }
    scheduleIdleStep() {
        const sleep = this.mood === 'sleepy';
        const d = sleep ? 3000 + Math.random() * 4000 : 1200 + Math.random() * 2000;
        this.eyeTimer = setTimeout(() => {
            if (this.state !== 'idle' && this.state !== 'boot') return;
            const f = this.manifest.images[Math.floor(Math.random() * this.manifest.images.length)];
            this.setEyes(f.path);
            this.prefetch(f.path);
            this.scheduleIdleStep();
        }, d);
    }
    scheduleAutoSpeak() {
        this.clearAutoSpeak();
        if (this.mood === 'grumpy' || this.mood === 'sleepy') return;
        this._autoSpeakTimer = setTimeout(() => {
            if (this.state === 'idle' && !this.bootPhase) { this.log('bored — speaking'); this.speak(); }
        }, this.autoSpeakDelay);
    }

    async start() {
        if (this.state === 'speaking' || this.state === 'reacting') return;
        this.setState('boot');
        if (!this.eyeTimer) this.scheduleIdleStep();
        const d = Math.random() * 2000;
        this.log(`boot: first sound in ${(d / 1000).toFixed(1)}s`);
        await this.sleep(d);
        this.bootPhase = false;
        this.speak();
    }

    async speak() {
        if (this.state === 'speaking') return;
        if (this.mood === 'grumpy' && Math.random() < this.personality.grumpiness * 0.7) {
            this.log('grumpy — refuses');
            this.setState('reacting');
            const fr = this.pickEyeFrames(3);
            let i = 0;
            const tick = () => {
                if (this.state !== 'reacting') return;
                this.setEyes(fr[i]); i++;
                if (i < fr.length) this.eyeTimer = setTimeout(tick, 180);
                else this.toIdle();
            };
            tick();
            return;
        }
        this.clearAllTimers();
        this.setState('speaking');
        this.lastInteractionAt = Date.now();

        const phrase = this.pickAudioPhrase();
        if (!phrase.length) { this.toIdle(); return; }
        this.log(`phrase (${phrase.length}): ${phrase.map(p => p.name).join(', ')}`);

        this.broadcastCommand();
        this.startSpeechVibration();

        const frames = this.pickEyeFrames(this.eyeFrameCount);
        const interval = this.mood === 'excited' ? 90 : this.mood === 'sleepy' ? 200 : 130;
        this.log(`eyes: ${frames.length} frames @ ${interval}ms`);

        let fi = 0;
        const tick = () => {
            if (this.state !== 'speaking') return;
            this.setEyes(frames[fi % frames.length]);
            fi++;
            this.eyeTimer = setTimeout(tick, interval);
        };
        tick();

        const total = await this.playPhrase(phrase);
        this.log(`audio done (${total.toFixed(1)}s)`);
        this.energy = Math.max(0, this.energy - phrase.length * 2);

        const minAnim = frames.length * interval;
        const audioMs = total * 1000;
        await this.sleep(audioMs < minAnim ? minAnim - audioMs : 200);

        if (this.mood === 'neutral' && this.friendship > 50 && Math.random() < 0.4) this.setMood('happy', 8000);
        if (this.state === 'speaking') this.toIdle();
    }

    pickAudioPhrase() {
        const all = this.manifest.audio;
        if (!all.length) return [];
        const len = Math.min(this.phraseLength, all.length);
        const start = Math.floor(Math.random() * Math.max(1, all.length - len));
        return all.slice(start, start + len);
    }
    pickEyeFrames(count) {
        const all = this.manifest.images;
        if (!all.length) return [];
        const start = Math.floor(Math.random() * Math.max(1, all.length - count));
        const out = [];
        for (let i = 0; i < count; i++) {
            const f = all[Math.min(start + i, all.length - 1)];
            out.push(f.path);
            this.prefetch(f.path);
            const ahead = all[Math.min(start + i + 5, all.length - 1)];
            this.prefetch(ahead.path);
        }
        return out;
    }

    playPhrase(files) {
        return new Promise(async (resolve) => {
            let total = 0;
            let cur = this.audioA, nxt = this.audioB;
            if (files[0]) cur.src = encodeURI(files[0].path);
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                if (i + 1 < files.length) { try { nxt.src = encodeURI(files[i + 1].path); nxt.load(); } catch {} }
                try {
                    await cur.play();
                    await new Promise((res, rej) => {
                        let done = false;
                        const fin = () => { if (done) return; done = true; cur.onended = null; cur.onerror = null; res(); };
                        cur.onended = fin;
                        cur.onerror = () => { if (done) return; done = true; rej(new Error('err')); };
                        setTimeout(fin, 15000);
                    });
                    total += cur.duration || 0.3;
                } catch (e) {
                    if (!this.audioLocked && e.name === 'NotAllowedError') {
                        this.audioLocked = true;
                        this.log('audio locked — unlock on touch');
                    }
                    total += 0.3;
                }
                [cur, nxt] = [nxt, cur];
                if (this.state !== 'speaking') break;
            }
            try { this.audioA.pause(); } catch {}
            try { this.audioB.pause(); } catch {}
            resolve(total);
        });
    }

    setEyes(p) {
        this.eyes.src = encodeURI(p);
        this.eyes.style.filter = this.furColor || '';
    }
    clearEyeTimer() { if (this.eyeTimer) { clearTimeout(this.eyeTimer); this.eyeTimer = null; } }
    clearAutoSpeak() { if (this._autoSpeakTimer) { clearTimeout(this._autoSpeakTimer); this._autoSpeakTimer = null; } }
    clearAllTimers() { this.clearEyeTimer(); this.clearAutoSpeak(); }
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    toIdle() {
        this.clearAllTimers();
        this.stopVibration();
        try { this.audioA.pause(); } catch {}
        try { this.audioB.pause(); } catch {}
        this.startIdle();
    }

    async react(intensity) {
        this.clearAllTimers();
        this.log(`react: ${intensity.toFixed(2)}`);
        this.lastInteractionAt = Date.now();
        if (this.mood === 'grumpy' && Math.random() < 0.5) { this.toIdle(); return; }
        const voiceChance = 0.4 + this.personality.sociability * 0.4 + this.friendship * 0.002;
        if (Math.random() < voiceChance) { this.speak(); return; }
        this.setState('reacting');
        this.vibrate(VIB.ack);
        const fr = this.pickEyeFrames(3 + Math.floor(Math.random() * 4));
        let i = 0;
        const tick = () => {
            if (this.state !== 'reacting') return;
            this.setEyes(fr[i]); i++;
            if (i < fr.length) this.eyeTimer = setTimeout(tick, 100 + Math.random() * 80);
            else this.toIdle();
        };
        tick();
    }

    async reactToFlip() {
        this.lastInteractionAt = Date.now();
        this.log('FLIP');
        this.friendship = Math.min(100, this.friendship + 3);
        this.setMood('dizzy', 6000);
        this.vibrate(VIB.flip);
        this.clearAllTimers();
        try { this.audioA.pause(); } catch {}
        try { this.audioB.pause(); } catch {}
        this.setState('reacting');
        const fr = this.pickEyeFrames(8 + Math.floor(Math.random() * 6));
        let i = 0;
        const tick = () => {
            if (this.state !== 'reacting') return;
            this.setEyes(fr[i]); i++;
            if (i < fr.length) this.eyeTimer = setTimeout(tick, 70 + Math.random() * 60);
            else { if (this.personality.grumpiness < 0.5) this.setMood('excited', 12000); this.toIdle(); }
        };
        tick();
    }

    async reactToShake() {
        this.lastInteractionAt = Date.now();
        this.log('SHAKE');
        this.friendship = Math.min(100, this.friendship + 2);
        this.setMood('excited', 12000);
        this.vibrate(VIB.shake);
        if (this.state !== 'speaking') this.speak();
    }

    onPetting() {
        this.lastInteractionAt = Date.now();
        this.friendship = Math.min(100, this.friendship + 4);
        this.log(`petting — friendship ${this.friendship}`);
        this.vibrate(VIB.pet);
        if (this.mood === 'grumpy' && this.friendship < 40 && Math.random() < this.personality.grumpiness * 0.6) return;
        this.setMood('happy', 8000);
        if (this.state === 'idle' || this.state === 'boot') this.react(0.5);
    }
    onTap() {
        this.lastInteractionAt = Date.now();
        this.friendship = Math.min(100, this.friendship + 2);
        this.log(`tap — friendship ${this.friendship}`);
        this.vibrate(VIB.ack);
        if (this.state === 'idle' || this.state === 'boot') this.react(0.3);
    }

    installTouchHandlers() {
        const el = document.body;
        const s = { active: false, lastX: 0, rev: 0, dir: 0, dist: 0, t0: 0 };
        const start = (x) => { s.active = true; s.lastX = x; s.rev = 0; s.dir = 0; s.dist = 0; s.t0 = Date.now(); };
        const move = (x) => {
            if (!s.active) return;
            const dx = x - s.lastX;
            s.dist += Math.abs(dx);
            s.lastX = x;
            if (Math.abs(dx) > 4) {
                const d = Math.sign(dx);
                if (s.dir !== 0 && d !== s.dir) s.rev++;
                s.dir = d;
            }
            if (s.rev >= 3) { s.rev = 0; s.t0 = Date.now(); this.onPetting(); }
        };
        const end = () => {
            if (!s.active) return;
            s.active = false;
            if (Date.now() - s.t0 < 400 && s.dist < 40) this.onTap();
        };
        el.addEventListener('touchstart', e => { if (e.touches[0]) start(e.touches[0].clientX); }, { passive: true });
        el.addEventListener('touchmove', e => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
        el.addEventListener('touchend', end, { passive: true });
        el.addEventListener('touchcancel', end, { passive: true });
        el.addEventListener('mousedown', e => start(e.clientX));
        el.addEventListener('mousemove', e => { if (s.active) move(e.clientX); });
        el.addEventListener('mouseup', end);
        el.addEventListener('mouseleave', end);
    }

    // ---------------- ComAir ----------------
    broadcastCommand() {
        const cmd = 100 + Math.floor(Math.random() * 900);
        const name = (window.ComAir2012Commands && window.ComAir2012Commands[cmd]) || 'unknown';
        this.channel.postMessage({ type: 'command', value: cmd, name, model: '2012', from: this.id });
        if (this.comairEncoder && this.comairEncoder.canUltrasound) {
            try { this.comairEncoder.play(this.comairEncoder.encode(cmd)); } catch {}
        }
    }

    // ---------------- App commands ----------------
    handleAppCommand(payload) {
        const a = payload.action;
        this.log(`app: ${a}`);
        this.lastInteractionAt = Date.now();
        switch (a) {
            case 'feed':
                this.hunger = Math.max(0, this.hunger - 40);
                this.friendship = Math.min(100, this.friendship + 3);
                this.setMood('happy', 10000);
                this.vibrate(VIB.feed);
                this.respondToApp(900);
                if (this.state !== 'speaking') this.speak();
                break;
            case 'play':
                this.friendship = Math.min(100, this.friendship + 5);
                this.energy = Math.max(0, this.energy - 10);
                this.setMood('excited', 15000);
                this.vibrate(VIB.play);
                this.respondToApp(865);
                if (this.state !== 'speaking') this.speak();
                break;
            case 'pet': this.onPetting(); this.respondToApp(843); break;
            case 'sing':
                this.setMood('happy', 10000);
                this.vibrate(VIB.sing);
                this.respondToApp(833);
                if (this.state !== 'speaking') this.speak();
                break;
            case 'dance':
                this.setMood('excited', 15000);
                this.vibrate(VIB.dance);
                this.respondToApp(865);
                if (this.state !== 'speaking') this.speak();
                break;
            case 'joke':
                this.vibrate(VIB.happy);
                this.respondToApp(863);
                if (this.state !== 'speaking') this.speak();
                break;
            case 'magic':
                this.vibrate(VIB.excited);
                this.respondToApp(864);
                if (this.state !== 'speaking') this.speak();
                break;
            case 'sleep':
                this.setMood('sleepy', 60000);
                this.respondToApp(901);
                break;
            case 'wake':
                this.setMood('neutral');
                this.energy = Math.min(100, this.energy + 20);
                this.vibrate(VIB.ack);
                this.respondToApp(820);
                if (this.state !== 'speaking') this.speak();
                break;
            case 'set_color':
                this.furColor = payload.color === 'none' ? null : payload.color;
                this.eyes.style.filter = this.furColor || '';
                this.respondToApp(910);
                break;
            case 'vibrate_toggle':
                this.vibrationEnabled = !!payload.enabled;
                if (!this.vibrationEnabled) this.stopVibration();
                else this.vibrate(VIB.ack);
                this.respondToApp(920);
                this.log(`vibration: ${this.vibrationEnabled ? 'ON' : 'OFF'}`);
                break;
        }
    }

    respondToApp(cmd) {
        this.channel.postMessage({ type: 'app_response', command: cmd, model: '2012', from: this.id });
        if (this.comairEncoder && this.comairEncoder.canUltrasound) {
            try { this.comairEncoder.play(this.comairEncoder.encode(cmd)); } catch {}
        }
    }

    broadcastStatus() {
        this.channel.postMessage({
            type: 'status', from: this.id, model: '2012',
            mood: this.mood,
            friendship: Math.round(this.friendship),
            energy: Math.round(this.energy),
            hunger: Math.round(this.hunger),
            furColor: this.furColor,
            vibrationEnabled: this.vibrationEnabled,
            vibrationSupported: this.vibrationSupported,
            ts: Date.now()
        });
    }
    startStatusBroadcast() {
        if (this._statusTimer) clearInterval(this._statusTimer);
        this._statusTimer = setInterval(() => this.broadcastStatus(), 2000);
        this.broadcastStatus();
        this.log('status broadcast started (2s)');
    }

    onRemoteCommand(payload) {
        if (!payload) return;
        if (payload.type === 'heartbeat') return;
        if (payload.type === 'status') return;
        if (payload.type === 'app_response') return;

        if (payload.type === 'status_request') { this.broadcastStatus(); return; }
        if (payload.type === 'app_command') { this.handleAppCommand(payload); return; }

        if (payload.from === this.id) return;

        this.log(`remote: ${payload.value} (${payload.name || '?'}) from ${payload.from} [${payload.model || '?'}]`);
        this.lastInteractionAt = Date.now();
        this.friendship = Math.min(100, this.friendship + 1);
        if (this.state === 'idle' || this.state === 'boot') this.react(0.5);
    }

    // ---------------- Persistent connection ----------------
    startHeartbeat() {
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = setInterval(() => {
            this.channel.postMessage({ type: 'heartbeat', from: this.id, model: this.MODEL, ts: Date.now() });
        }, 5000);
        this.log('heartbeat started (5s)');
    }
    startUltrasonicPing() {
        if (this._pingTimer) clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => {
            if (this.comairEncoder && this.comairEncoder.canUltrasound) {
                try { this.comairEncoder.play(this.comairEncoder.encode(800)); } catch {}
            }
        }, 15000);
        this.log('ultrasonic ping started (15s)');
    }

    // ---------------- Microphone ----------------
    async startMic() {
        if (!navigator.mediaDevices?.getUserMedia) { this.log('mic not supported'); return false; }
        if (!window.ComAir2012Encoder || !window.ComAir2012Decoder) {
            this.log('ComAir 2012 module not loaded — check comair-2012.js');
            return false;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this._micStream = stream;
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.comairEncoder = new window.ComAir2012Encoder(this._audioCtx);
            this.log('ultrasound capable: ' + this.comairEncoder.canUltrasound);
            if (this.comairEncoder.canUltrasound) {
                this.comairDecoder = new window.ComAir2012Decoder(this._audioCtx, stream, (r) => {
                    this.log(`ultrasound: ${r.command} (${r.name}) [src=${r.source || '?'}]`);
                    this.onRemoteCommand({
                        type: 'command', value: r.command, name: r.name,
                        model: '2012', from: 'ultrasound-2012'
                    });
                });
                this.log('ComAir 2012 decoder started (17 000 Hz)');
            }
            const src = this._audioCtx.createMediaStreamSource(stream);
            this.micAnalyser = this._audioCtx.createAnalyser();
            this.micAnalyser.fftSize = 512;
            src.connect(this.micAnalyser);
            this.micData = new Uint8Array(this.micAnalyser.frequencyBinCount);
            this.log('mic on');
            this.monitorMic();
            return true;
        } catch (e) { this.log('mic err: ' + e.message); return false; }
    }

    monitorMic() {
        const check = () => {
            if (!this.micAnalyser) return;
            this.micAnalyser.getByteTimeDomainData(this.micData);
            let sum = 0;
            for (let i = 0; i < this.micData.length; i++) { const v = (this.micData[i] - 128) / 128; sum += v * v; }
            const rms = Math.sqrt(sum / this.micData.length);
            const now = performance.now();
            if (rms > this.threshold && !this.bootPhase && this.state === 'idle' && now - this.lastSoundAt > this.micCooldown) {
                this.lastSoundAt = now;
                this.react(rms);
            }
            requestAnimationFrame(check);
        };
        check();
    }

    // ---------------- Sensors ----------------
    async startSensors() {
        try {
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                const p = await DeviceOrientationEvent.requestPermission();
                if (p !== 'granted') return false;
            }
            if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
                try { await DeviceMotionEvent.requestPermission(); } catch {}
            }
        } catch { return false; }
        if (!('DeviceOrientationEvent' in window) && !('DeviceMotionEvent' in window)) return false;
        window.addEventListener('deviceorientation', (e) => this.onOrientation(e));
        window.addEventListener('devicemotion', (e) => this.onMotion(e));
        this.sensorsActive = true;
        this.log('sensors: enabled');
        return true;
    }
    onOrientation(e) {
        const { beta, gamma } = e;
        if (beta == null) return;
        const flip = Math.abs(beta - 90) > 130 || Math.abs(gamma || 0) > 70;
        const now = Date.now();
        if (flip && !this._wasFlipped && now - this.lastFlipAt > 3000) { this.lastFlipAt = now; this.reactToFlip(); }
        this._wasFlipped = flip;
    }
    onMotion(e) {
        const a = e.accelerationIncludingGravity || e.acceleration;
        if (!a || a.x == null) return;
        const mag = Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z);
        this._motionMagAvg = this._motionMagAvg * 0.85 + mag * 0.15;
        const now = Date.now();
        if (mag - this._motionMagAvg > 8 && now - this.lastShakeAt > 2500) { this.lastShakeAt = now; this.reactToShake(); }
    }
}

// ================================================================
//                        AUTO-START
// ================================================================
let furby = null;
let micAttempted = false;

async function unlockAll() {
    if (!furby) return;
    if (furby._audioCtx && furby._audioCtx.state === 'suspended') { try { await furby._audioCtx.resume(); } catch {} }
    try {
        const s = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
        s.volume = 0;
        await s.play().catch(() => {});
        furby.audioLocked = false;
    } catch {}
    if (furby.vibrationSupported && furby.vibrationEnabled) {
        try { navigator.vibrate(1); } catch {}
    }
    if (!micAttempted || !furby.micAnalyser) { micAttempted = true; await furby.startMic().catch(() => {}); }
    if (!furby.sensorsActive) await furby.startSensors().catch(() => {});
}

function installAutoWake() {
    const once = () => {
        unlockAll();
        document.removeEventListener('touchstart', once);
        document.removeEventListener('mousedown', once);
        document.removeEventListener('keydown', once);
    };
    document.addEventListener('touchstart', once, { passive: true });
    document.addEventListener('mousedown', once);
    document.addEventListener('keydown', once);
}

(async function init() {
    try {
        console.log('[Furby] loading manifest ...');
        const res = await fetch('manifest.json');
        if (!res.ok) throw new Error('manifest.json not found (HTTP ' + res.status + ')');
        const m = await res.json();
        console.log(`[Furby] model: ${m.model || '?'}, ${m.images.length} images, ${m.audio.length} audio`);
        if (!m.images.length || !m.audio.length) throw new Error('manifest empty');
        if (m.model !== '2012') console.warn(`[Furby] manifest is for ${m.model}, expected 2012`);

        furby = new Furby(m);
        console.log('[Furby] personality: ' + furby.personality.describe());
        console.log('[Furby] friendship: 50/100, energy: 100/100');
        console.log('[Furby] vibration supported: ' + furby.vibrationSupported);

        const first = m.images[Math.floor(Math.random() * m.images.length)];
        furby.eyes.src = encodeURI(first.path);
        furby.prefetch(first.path);

        furby.setState('idle');
        furby.scheduleIdleStep();
        furby.installTouchHandlers();

        micAttempted = true;
        furby.startMic().catch(() => {});
        furby.startSensors().catch(() => {});
        installAutoWake();
        furby.start();

        furby.startHeartbeat();
        furby.startUltrasonicPing();
        furby.startStatusBroadcast();

        setInterval(() => furby && furby.tickMood(), 5000);
        console.log('[Furby] ready. Open companion.html in another tab to control.');
    } catch (e) {
        console.error('[Furby] init error:', e);
        document.body.innerHTML = '<p style="color:#f55;font-family:sans-serif;padding:24px;font-size:14px">' + e.message + ' — run through local server</p>';
    }
})();