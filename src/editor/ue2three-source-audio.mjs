// Audio adapter for source-witnessed Blueprint calls. It is deliberately strict:
// a missing Unreal SoundWave export must never become a generated/replacement SFX.
const PROJECT_PATH = /^build\/local-scenes\/ue2three\/projects\/([A-Za-z0-9_-]+)\/(?:[A-Za-z0-9_-]+\/)*maps\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.glb$/;
const RECOVERED_PATH = /^build\/local-scenes\/ue2three\/projects\/([A-Za-z0-9_-]+)\/recovered-maps\/[a-f0-9]{20}\/model\.glb$/;
const SHA = /^[a-f0-9]{64}$/i;
const SOURCE_SOUND = /^\/Game\/[A-Za-z0-9_/-]+\.[A-Za-z0-9_]+$/;

export function sourceAudioManifestPath(mapPath) {
    const match = PROJECT_PATH.exec(mapPath || '') || RECOVERED_PATH.exec(mapPath || '');
    if (!match) throw new Error('Invalid source map path for audio');
    return `build/local-scenes/ue2three/projects/${match[1]}/audio-manifest.json`;
}

export function verifiedSourceSounds(manifest, mapPath) {
    const root = sourceAudioManifestPath(mapPath).replace(/audio-manifest\.json$/, '');
    if (manifest?.schema_version !== 1 || !Array.isArray(manifest.sounds))
        throw new Error('Invalid source audio manifest');
    const outputs = new Map();
    for (const entry of manifest.sounds) {
        if (!SOURCE_SOUND.test(entry?.asset || '') || !SHA.test(entry?.source_sha256 || '') ||
            !SHA.test(entry?.output_sha256 || '') || entry?.kind !== 'SoundWave' ||
            typeof entry?.filename !== 'string' ||
            !/^audio\/[A-Za-z0-9_.-]+\.(?:wav|ogg|mp3)$/i.test(entry.filename) ||
            outputs.has(entry.asset)) throw new Error('Invalid or duplicate original audio export');
        outputs.set(entry.asset, '/' + root + entry.filename);
    }
    return outputs;
}

export class SourceAudioPlayback {
    constructor({sounds = new Map(), createAudio = src => new Audio(src), onStatus = () => {}} = {}) {
        this.sounds = sounds;
        this.createAudio = createAudio;
        this.onStatus = onStatus;
        this.seen = new WeakSet();
        this.playing = new Set();
        this.counts = {played: 0, missing: 0, unsupported: 0, errors: 0};
    }

    handle(request) {
        if (this.disposed) return {status:'unsupported',reason:'Original audio runtime disposed'};
        const signature = request?.identity?.join(':');
        if (signature !== '/Script/Engine:GameplayStatics:PlaySound2D') {
            this.counts.unsupported++;
            return {status:'unsupported', identity: request?.identity};
        }
        const args = request.arguments;
        if (!Array.isArray(args) || args.length !== 8 ||
            (args[5] !== null && args[5] !== undefined) ||
            (args[6] !== null && args[6] !== undefined) ||
            typeof args[2] !== 'number' || !Number.isFinite(args[2]) || args[2] < 0 || args[2] > 1 ||
            typeof args[3] !== 'number' || args[3] <= 0 || !Number.isFinite(args[3]) ||
            typeof args[4] !== 'number' || args[4] < 0 || !Number.isFinite(args[4])) {
            this.counts.unsupported++;
            return {status:'unsupported', reason:'Unreal audio parameters require a richer backend'};
        }
        const asset = args[1]?.asset;
        const source = this.sounds.get(asset);
        if (!source) {this.counts.missing++; return {status:'missing', asset};}
        try {
            const audio = this.createAudio(source);
            audio.volume = args[2];
            audio.playbackRate = args[3];
            audio.currentTime = args[4];
            this.playing.add(audio);
            audio.addEventListener?.('ended', () => this.playing.delete(audio), {once:true});
            const pending = audio.play();
            if (pending?.then) pending.then(() => {
                this.counts.played++;
                this.onStatus({status:'played', asset});
            }, error => {this.counts.errors++;this.playing.delete(audio);
                this.onStatus({status:'error', reason:error.message});});
            else {this.counts.played++;this.onStatus({status:'played', asset});}
            return {status:'requested', asset};
        } catch (error) {this.counts.errors++;return {status:'error', reason:error.message};}
    }

    update(runtime) {
        for (const request of runtime?.audioVfxRequests || []) {
            if (!request || typeof request !== 'object' || this.seen.has(request)) continue;
            this.seen.add(request);
            const status = this.handle(request);
            this.onStatus(status);
        }
    }
    dispose() {
        this.disposed = true;
        for (const audio of this.playing) {audio.pause?.();audio.removeAttribute?.('src');audio.load?.();}
        this.playing.clear();
    }
}

export async function loadSourceAudioPlayback(mapPath, fetchImpl = fetch, options = {}) {
    const response = await fetchImpl('/' + sourceAudioManifestPath(mapPath), {cache:'no-store'});
    if (response.status === 404) return new SourceAudioPlayback(options);
    if (!response.ok) throw new Error('Original DDS audio manifest could not be loaded');
    return new SourceAudioPlayback({...options,sounds:verifiedSourceSounds(await response.json(),mapPath)});
}
