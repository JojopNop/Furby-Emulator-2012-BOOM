// ============================================================
//         ComAir for Furby Boom
//         Regular: 17.5 kHz, 12-symbol packets
//         Boost:   17 kHz + 18 kHz carriers, 26-symbol packets
// ============================================================
(function () {
    'use strict';

    const CENTER_FREQ = 17500;
    const BOOST_CARRIER_1 = 17000;
    const BOOST_CARRIER_2 = 18000;
    const FREQ_STEP = 557;
    const SLOT_DURATION_MS = 500 / 12;
    const BOOST_SYMBOL_DURATION_MS = 20;
    const PACKET_DURATION_MS = 500;
    const NOISE_FLOOR = -85;

    const DATA_FREQS = [
        CENTER_FREQ - FREQ_STEP * 2,
        CENTER_FREQ - FREQ_STEP,
        CENTER_FREQ + FREQ_STEP,
        CENTER_FREQ + FREQ_STEP * 2
    ];
    const BOOST_DATA_FREQS_1 = [
        BOOST_CARRIER_1 - FREQ_STEP * 2,
        BOOST_CARRIER_1 - FREQ_STEP,
        BOOST_CARRIER_1 + FREQ_STEP,
        BOOST_CARRIER_1 + FREQ_STEP * 2
    ];
    const BOOST_DATA_FREQS_2 = [
        BOOST_CARRIER_2 - FREQ_STEP * 2,
        BOOST_CARRIER_2 - FREQ_STEP,
        BOOST_CARRIER_2 + FREQ_STEP,
        BOOST_CARRIER_2 + FREQ_STEP * 2
    ];

    const CHECKSUMS_FIRST = [
        '0000','0110','0210','0300','1023','1133','1233','1323',
        '0120','0201','0330','1021','1103','1222','1313','2021',
        '0220','0330','1000','1110','1203','1313','2000','2110',
        '0300','1011','1120','1201','1323','2011','2120','2201'
    ];
    const CHECKSUMS_SECOND = [
        '1033','1123','1223','1333','2033','2123','2223','2333',
        '1113','1232','1303','2031','2113','2232','2303','3012',
        '1213','1303','2010','2100','2213','2303','3033','3123',
        '1333','2001','2130','2211','2333','3022','3113','3232'
    ];

    const COMMANDS = {
        800:'identify', 801:'identify_boom', 820:'listen', 821:'twitter',
        823:'burp', 824:'laugh', 825:'hiccup', 826:'sneeze', 833:'sing',
        843:'kiss', 863:'tell_joke', 864:'do_magic', 865:'dance',
        900:'feed', 901:'sleep', 902:'burp_loud',
        910:'change_personality', 911:'start_game', 912:'stop_game',
        913:'level_up', 914:'sync_friend', 920:'hologram_on', 921:'hologram_off'
    };

    class ComAirBoomEncoder {
        constructor(audioCtx) {
            this.ctx = audioCtx;
            this.sampleRate = audioCtx.sampleRate;
            this.canUltrasound = (this.sampleRate / 2) >= 19000;
        }

        encode(command) {
            const cmd = command & 0x3FF;
            const high5 = (cmd >> 5) & 0x1F;
            const low5  = (cmd & 0x1F);
            const firstStr  = this._binToQuad('11' + high5.toString(2).padStart(4, '0'))
                            + CHECKSUMS_FIRST[high5] + '1032';
            const secondStr = this._binToQuad('11' + (low5 + 32).toString(2).padStart(4, '0'))
                            + CHECKSUMS_SECOND[low5] + '1032';
            const freqs1 = this._strToFreqs(firstStr, DATA_FREQS);
            const freqs2 = this._strToFreqs(secondStr, DATA_FREQS);
            return this._buildRegularBuffer(freqs1, freqs2);
        }

        encodeBoostResponse(identity) {
            let bits = 0n;
            const str = `${identity.name || 'Furby'}|${identity.furStyle || 0}|${identity.hunger || 0}|${identity.sickness || 0}`;
            for (let i = 0; i < str.length; i++) {
                bits = (bits * 31n + BigInt(str.charCodeAt(i))) & 0xFFFFFFFFFn;
            }
            const symbols = [];
            let temp = bits;
            for (let i = 0; i < 26; i++) {
                symbols.push(Number(temp & 3n));
                temp >>= 2n;
            }
            return this._buildBoostBuffer(symbols);
        }

        _binToQuad(binStr) {
            while (binStr.length < 6) binStr = '0' + binStr;
            let out = '';
            for (let i = 0; i < 6; i += 2) {
                out += parseInt(binStr.slice(i, i + 2), 2).toString();
            }
            return out;
        }

        _strToFreqs(str, freqsArray) {
            return [...str].map(ch => {
                const q = parseInt(ch, 10);
                return q >= 0 && q <= 3 ? freqsArray[q] : freqsArray[0];
            });
        }

        _buildRegularBuffer(f1, f2) {
            const length = Math.floor(this.sampleRate * 1.5);
            const buffer = this.ctx.createBuffer(1, length, this.sampleRate);
            const data = buffer.getChannelData(0);
            this._writeRegularPacket(data, f1, 0);
            this._writeRegularPacket(data, f2, 1.0);
            return buffer;
        }

        _writeRegularPacket(data, freqs, startSec) {
            const slotSamples = Math.floor(this.sampleRate * (SLOT_DURATION_MS / 1000));
            const offset = Math.floor(this.sampleRate * startSec);
            const fade = Math.floor(this.sampleRate * 0.005);
            for (let i = 0; i < freqs.length; i++) {
                const inc = 2 * Math.PI * freqs[i] / this.sampleRate;
                let phase = 0;
                for (let j = 0; j < slotSamples; j++) {
                    const idx = offset + i * slotSamples + j;
                    if (idx >= data.length) break;
                    let amp = 0.8;
                    if (j < fade) amp *= j / fade;
                    if (j > slotSamples - fade) amp *= (slotSamples - j) / fade;
                    data[idx] = Math.sin(phase) * amp;
                    phase += inc;
                }
            }
        }

        _buildBoostBuffer(symbols) {
            const symDur = BOOST_SYMBOL_DURATION_MS / 1000;
            const length = Math.floor(this.sampleRate * symbols.length * symDur);
            const buffer = this.ctx.createBuffer(1, length, this.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < symbols.length; i++) {
                const sym = symbols[i];
                const f1 = BOOST_DATA_FREQS_1[sym % 4];
                const f2 = BOOST_DATA_FREQS_2[sym % 4];
                const start = Math.floor(i * symDur * this.sampleRate);
                const end = Math.min(Math.floor((i + 1) * symDur * this.sampleRate), length);
                for (let j = start; j < end; j++) {
                    const t = j / this.sampleRate;
                    data[j] = 0.5 * (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t));
                }
            }
            return buffer;
        }

        play(buffer) {
            const src = this.ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(this.ctx.destination);
            src.start();
        }
    }

    class ComAirBoomDecoder {
        constructor(audioCtx, micStream, onCommand) {
            this.ctx = audioCtx;
            this.onCommand = onCommand;
            this.sampleRate = this.ctx.sampleRate;

            this.analyser = this.ctx.createAnalyser();
            this.analyser.fftSize = 8192;
            this.analyser.smoothingTimeConstant = 0.3;
            this.binHz = this.sampleRate / this.analyser.fftSize;

            const src = this.ctx.createMediaStreamSource(micStream);
            src.connect(this.analyser);
            this.data = new Float32Array(this.analyser.frequencyBinCount);

            this.centerBin = Math.round(CENTER_FREQ / this.binHz);
            this.boostBin1 = Math.round(BOOST_CARRIER_1 / this.binHz);
            this.boostBin2 = Math.round(BOOST_CARRIER_2 / this.binHz);
            this.otherBin  = Math.round(17000 / this.binHz);
            this.dataBins  = DATA_FREQS.map(f => Math.round(f / this.binHz));

            this.state = 'IDLE';
            this.captureBuffer = [];
            this.captureTimer = null;
            this.pendingFirstPacket = null;
            this.running = true;

            this._loop();
        }

        _loop() {
            if (!this.running) return;
            requestAnimationFrame(() => this._loop());
            this.analyser.getFloatFrequencyData(this.data);
            if (this.state !== 'IDLE') return;

            const boost1 = this._peak(this.data, this.boostBin1);
            const boost2 = this._peak(this.data, this.boostBin2);

            if (boost1 > NOISE_FLOOR + 5 && boost2 > NOISE_FLOOR + 5) {
                this._startBoostCapture();
                return;
            }

            const own   = this._peak(this.data, this.centerBin);
            const other = this._peak(this.data, this.otherBin);

            if (own > NOISE_FLOOR) this._startRegularCapture('own');
            else if (other > NOISE_FLOOR + 3) this._startRegularCapture('other');
        }

        _startBoostCapture() {
            this.state = 'BOOST_COOLDOWN';
            console.log('[ComAir-Boom] Boost request detected');
            if (this.onCommand) {
                this.onCommand({ model: 'Boom', command: 'boost_request', name: 'status_request', source: 'boost' });
            }
            setTimeout(() => { this.state = 'IDLE'; }, 3000);
        }

        _startRegularCapture(source) {
            this.state = 'CAPTURING';
            this.captureBuffer = [];
            const start = performance.now();
            console.log(`[ComAir-Boom] capture from ${source}`);

            this.captureTimer = setInterval(() => {
                const snap = new Float32Array(this.data.length);
                this.analyser.getFloatFrequencyData(snap);
                this.captureBuffer.push({ t: performance.now() - start, data: snap });
            }, 5);

            setTimeout(() => {
                clearInterval(this.captureTimer);
                this._processRegular(source);
                setTimeout(() => { this.state = 'IDLE'; }, 600);
            }, PACKET_DURATION_MS + 60);
        }

        _processRegular(source) {
            if (this.captureBuffer.length < 10) return;
            const quads = [];
            for (let slot = 0; slot < 12; slot++) {
                const t0 = slot * SLOT_DURATION_MS;
                const t1 = t0 + SLOT_DURATION_MS;
                const snaps = this.captureBuffer.filter(s => s.t >= t0 && s.t < t1);
                if (!snaps.length) { quads.push(-1); continue; }
                const powers = this.dataBins.map(bin => {
                    let sum = 0;
                    for (const s of snaps) sum += this._peak(s.data, bin);
                    return sum / snaps.length;
                });
                const max = Math.max(...powers);
                if (max < -90) { quads.push(-1); continue; }
                quads.push(powers.indexOf(max));
            }
            this._decodeRegular(quads, source);
        }

        _decodeRegular(quads, source) {
            if (quads.includes(-1)) return;
            const str = quads.join('');
            if (str.slice(8) !== '1032') return;
            const headerBin = [...str.slice(0, 4)].map(q =>
                parseInt(q, 10).toString(2).padStart(2, '0')
            ).join('');
            if (!headerBin.startsWith('11')) return;
            const isSecond = headerBin[2] === '1';
            const data5    = parseInt(headerBin.slice(3), 2);
            const checksum = str.slice(4, 8);

            if (!isSecond) {
                if (CHECKSUMS_FIRST[data5] !== checksum) return;
                this.pendingFirstPacket = { data: data5, t: performance.now() };
                console.log(`[ComAir-Boom] first packet OK (data=${data5}, src=${source})`);
            } else {
                if (CHECKSUMS_SECOND[data5] !== checksum) return;
                if (!this.pendingFirstPacket) return;
                if (performance.now() - this.pendingFirstPacket.t > 3000) return;
                const cmd = (this.pendingFirstPacket.data << 5) | data5;
                const name = COMMANDS[cmd] || 'unknown';
                console.log(`[ComAir-Boom] COMMAND ${cmd} (${name}) [src=${source}]`);
                this.onCommand({ model: 'Boom', command: cmd, name, source });
                this.pendingFirstPacket = null;
            }
        }

        _peak(data, bin) {
            let p = -Infinity;
            for (let d = -2; d <= 2; d++) {
                const i = bin + d;
                if (i >= 0 && i < data.length) p = Math.max(p, data[i]);
            }
            return p;
        }

        stop() {
            this.running = false;
            if (this.captureTimer) clearInterval(this.captureTimer);
        }
    }

    window.ComAirBoomEncoder = ComAirBoomEncoder;
    window.ComAirBoomDecoder = ComAirBoomDecoder;
    window.ComAirBoomCommands = COMMANDS;
    window.ComAirBoomInfo = { centerFreq: CENTER_FREQ, boostCarriers: [BOOST_CARRIER_1, BOOST_CARRIER_2] };
})();