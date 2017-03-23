/// <reference path="util.ts" />
/// <reference path="volume.ts" />

namespace xsystem35 {
    abstract class PCMSound {
        protected context: AudioContext;
        protected gain: GainNode;
        protected duration_: number;
        protected startTime: number;

        constructor(protected dst: AudioNode) {
            this.context = dst.context;
            this.gain = this.context.createGain();
            this.gain.connect(dst);
        }
        abstract start(loop: number): void;
        abstract stop(): void;
        setGain(gain: number) {
            this.gain.gain.value = gain;
        }
        fadeout(msec: number) {
            this.gain.gain.linearRampToValueAtTime(0, this.context.currentTime + msec / 1000);
        }
        getPosition(): number {
            if (!this.startTime)
                return 0;
            return this.context.currentTime - this.startTime;
        }
        isPlaying(): boolean {
            return !!this.startTime;
        }
        get duration(): number {
            return this.duration_;
        }
    }

    class PCMSoundSimple extends PCMSound {
        private node: AudioBufferSourceNode;

        constructor(dst: AudioNode, buf: AudioBuffer) {
            super(dst);
            this.node = this.context.createBufferSource();
            this.node.buffer = buf;
            this.node.connect(this.gain);
            this.node.onended = this.onended.bind(this);
            this.duration_ = buf.duration;
        }

        start(loop: number) {
            if (loop == 0)
                this.node.loop = true;
            else if (loop != 1)
                console.warn('Unsupported PCM loop count ' + loop);
            this.node.start();
            this.startTime = this.context.currentTime;
        }

        stop() {
            if (this.startTime) {
                this.node.stop();
                this.startTime = null;
            }
        }

        private onended() {
            this.startTime = null;
        }
    }

    class PCMSoundMixLR extends PCMSound {
        private lsrc: AudioBufferSourceNode;
        private rsrc: AudioBufferSourceNode;
        private endCount = 0;

        constructor(dst: AudioNode, lbuf: AudioBuffer, rbuf: AudioBuffer) {
            super(dst);
            this.lsrc = this.context.createBufferSource();
            this.rsrc = this.context.createBufferSource();
            this.lsrc.buffer = lbuf;
            this.rsrc.buffer = rbuf;
            var merger = this.context.createChannelMerger(2);
            merger.connect(this.gain);
            this.lsrc.connect(merger, 0, 0);
            this.rsrc.connect(merger, 0, 1);
            this.lsrc.onended = this.rsrc.onended = this.onended.bind(this);
            this.duration_ = Math.max(lbuf.duration, rbuf.duration);
        }

        start(loop: number) {
            if (loop != 1)
                console.warn('PCMSoundMixLR: loop is not supported ' + loop);
            this.lsrc.start();
            this.rsrc.start();
            this.startTime = this.context.currentTime;
        }

        stop() {
            if (this.startTime) {
                this.lsrc.stop();
                this.rsrc.stop();
                this.startTime = null;
            }
        }

        private onended() {
            this.endCount++;
            if (this.endCount == 2)
                this.startTime = null;
        }
    }

    declare var webkitAudioContext: any;
    export class AudioManager {
        private context: AudioContext;
        private masterGain: GainNode;
        private slots: PCMSound[];
        private buffers: AudioBuffer[];
        private isSafari: boolean;

        constructor(volumeControl: VolumeControl) {
            if (typeof (AudioContext) !== 'undefined') {
                this.context = new AudioContext();
            } else if (typeof (webkitAudioContext) !== 'undefined') {
                this.context = new webkitAudioContext();
                this.isSafari = true;
                this.removeUserGestureRestriction();
            }
            this.masterGain = this.context.createGain();
            this.masterGain.connect(this.context.destination);
            this.slots = [];
            this.buffers = [];
            volumeControl.addEventListener(this.onVolumeChanged.bind(this));
            this.masterGain.gain.value = volumeControl.volume();
        }

        private removeUserGestureRestriction() {
            var hanlder = () => {
                var src = this.context.createBufferSource();
                src.buffer = this.context.createBuffer(1, 1, 22050);
                src.connect(this.context.destination);
                src.start();
                console.log('AudioContext unlocked');
                window.removeEventListener('touchend', hanlder);
            };
            window.addEventListener('touchend', hanlder);
        }

        private load(no: number): Promise<AudioBuffer> {
            var buf = this.getWave(no);
            if (!buf)
                return Promise.reject('Failed to open wave ' + no);

            var decoded: Promise<AudioBuffer>;
            if (this.isSafari) {
                decoded = new Promise((resolve, reject) => {
                    this.context.decodeAudioData(buf, resolve, reject);
                });
            } else {
                decoded = this.context.decodeAudioData(buf);
            }
            return decoded.then((audioBuf) => {
                this.buffers[no] = audioBuf;
                return audioBuf;
            });
        }

        private getWave(no: number): ArrayBuffer {
            var dfile = _ald_getdata(2 /* DRIFILE_WAVE */, no - 1);
            if (!dfile)
                return null;
            var ptr = Module.getValue(dfile + 8, '*');
            var size = Module.getValue(dfile, 'i32');
            var buf = Module.HEAPU8.buffer.slice(ptr, ptr + size);
            _ald_freedata(dfile);
            return buf;
        }

        pcm_load(slot: number, no: number) {
            EmterpreterAsync.handle((resume) => {
                this.pcm_stop(slot);
                if (this.buffers[no]) {
                    this.slots[slot] = new PCMSoundSimple(this.masterGain, this.buffers[no]);
                    return resume();
                }
                this.load(no).then((audioBuf) => {
                    this.slots[slot] = new PCMSoundSimple(this.masterGain, audioBuf);
                    resume();
                });
            });
        }

        pcm_load_mixlr(slot: number, noL: number, noR: number) {
            EmterpreterAsync.handle((resume) => {
                this.pcm_stop(slot);
                if (this.buffers[noL] && this.buffers[noR]) {
                    this.slots[slot] = new PCMSoundMixLR(this.masterGain, this.buffers[noL], this.buffers[noR]);
                    return resume();
                }
                var ps = [];
                if (!this.buffers[noL]) ps.push(this.load(noL));
                if (!this.buffers[noR]) ps.push(this.load(noR));
                Promise.all(ps).then(() => {
                    this.slots[slot] = new PCMSoundMixLR(this.masterGain, this.buffers[noL], this.buffers[noR]);
                    resume();
                });
            });
        }

        pcm_start(slot: number, loop: number): number {
            if (this.slots[slot]) {
                this.slots[slot].start(loop);
                return 1;
            }
            return 0;
        }

        pcm_stop(slot: number): number {
            if (!this.slots[slot])
                return 0;
            this.slots[slot].stop();
            this.slots[slot] = null;
            return 1;
        }

        pcm_fadeout(slot: number, msec: number): number {
            if (!this.slots[slot])
                return 0;
            this.slots[slot].fadeout(msec);
            return 1;
        }

        pcm_getpos(slot: number): number {
            if (!this.slots[slot])
                return 0;
            return this.slots[slot].getPosition() * 1000;
        }

        pcm_setvol(slot: number, vol: number): number {
            if (!this.slots[slot])
                return 0;
            this.slots[slot].setGain(vol / 100);
            return 1;
        }

        pcm_getwavelen(slot: number): number {
            if (!this.slots[slot])
                return 0;
            return this.slots[slot].duration * 1000;
        }

        pcm_isplaying(slot: number): number {
            if (!this.slots[slot])
                return 0;
            return this.slots[slot].isPlaying() ? 1 : 0;
        }

        private onVolumeChanged(evt: CustomEvent) {
            this.masterGain.gain.value = evt.detail;
        }
    }
}