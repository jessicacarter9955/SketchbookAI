// Browser effects run only after a source transaction commits. Never execute
// them from the interpreter: failed Blueprint calls must not make sound/VFX.
import {validNativeComponentReference} from './ue2three-objects.mjs';
const key = identity => JSON.stringify(identity);
const engine = '/Script/Engine';
const niagara = '/Script/Niagara';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const componentKey = reference => JSON.stringify([reference?.realm, reference?.actor_id,
    reference?.source_package, reference?.source_owner_index, reference?.source_field, reference?.declared_class]);

export class EffectUnavailable extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

export class NativeEffectBridge {
    constructor({limit = 256, onReceipt = () => {}} = {}) {
        if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Invalid effect queue limit');
        this.limit = limit; this.onReceipt = onReceipt;
        this.handlers = new Map(); this.receipts = []; this.pending = 0;
        this.tail = Promise.resolve(); this.nextId = 1; this.closed = false;
    }
    register(identity, handler) {
        if (!Array.isArray(identity) || identity.length !== 3 || identity.some(x => typeof x !== 'string')
            || typeof handler !== 'function' || this.handlers.has(key(identity))) throw Error('Invalid or duplicate native effect handler');
        this.handlers.set(key(identity), handler);
        return () => { if (this.handlers.get(key(identity)) === handler) this.handlers.delete(key(identity)); };
    }
    record(receipt) {
        const copy = structuredClone(receipt);
        this.receipts.push(copy);
        if (this.receipts.length > this.limit) this.receipts.shift();
        try { this.onReceipt(structuredClone(copy)); } catch { /* A status widget cannot replay an effect. */ }
        return copy;
    }
    enqueue(effects) {
        if (this.closed) throw Error('Native effect bridge disposed');
        if (!Array.isArray(effects)) throw Error('Invalid committed native effects');
        const jobs = effects.filter(effect => effect?.op === 'native_audio_vfx').map(effect => structuredClone(effect));
        for (const effect of jobs) {
            const id = this.nextId++;
            if (this.pending >= this.limit) {
                this.record({id, identity: effect.identity, status:'blocked', code:'queue_full'});
                continue;
            }
            this.pending++;
            this.tail = this.tail.then(async () => {
                try {
                    if (this.closed) return this.record({id, identity:effect.identity, status:'cancelled'});
                    const handler = this.handlers.get(key(effect.identity));
                    if (!handler) throw new EffectUnavailable('adapter_missing', 'Original native runtime adapter is unavailable');
                    const result = await handler(effect);
                    return this.record({id, identity:effect.identity, package:effect.package,
                        status:result?.status || 'executed', ...result});
                } catch (error) {
                    return this.record({id, identity:effect.identity, package:effect.package, status:'blocked',
                        code:error.code || 'adapter_failed', message:String(error.message || error)});
                } finally { this.pending--; }
            });
        }
        return this.tail;
    }
    flush() { return this.tail; }
    dispose() { this.closed = true; this.handlers.clear(); }
}

export function attachNativeEffects(runtime, bridge) {
    // Only future commits are delivered. Audit history/snapshot restore is not
    // an event queue and must never replay a shot, sound or network operation.
    return runtime.onCommittedEffects(effects => bridge.enqueue(effects));
}

export class SourceComponentEffects {
    constructor() { this.bindings = new Map(); }
    bind(reference, target) {
        if (!validNativeComponentReference(reference)) throw Error('Invalid source native component identity');
        const id = componentKey(reference);
        if (this.bindings.has(id)) throw Error('Source component already bound');
        this.bindings.set(id, target);
        return () => this.bindings.delete(id);
    }
    install(bridge) {
        const removers = [];
        const receiver = (effect, identity) => {
            if (key(effect.receiver?.declared_class) !== key(identity)) throw new EffectUnavailable('receiver_class', 'Source component class differs');
            const binding = this.bindings.get(componentKey(effect.receiver));
            if (!binding) throw new EffectUnavailable('component_unbound', 'Original component is not bound to a browser resource');
            return binding;
        };
        removers.push(bridge.register([engine,'AudioComponent','SetVolumeMultiplier'], effect => {
            const target = receiver(effect, [engine,'AudioComponent']);
            const value = effect.arguments?.[0];
            if (!finite(value) || value < 0 || !target.gain?.gain?.setValueAtTime || !finite(target.context?.currentTime)
                || !finite(target.sourceVolume) || target.sourceVolume < 0)
                throw new EffectUnavailable('audio_binding', 'Original volume requires a bound audio gain and nonnegative finite multiplier');
            target.gain.gain.setValueAtTime(Math.fround(value) * target.sourceVolume, target.context.currentTime);
            return {scope:'bound_audio_component'};
        }));
        removers.push(bridge.register([niagara,'NiagaraComponent','SetVariableLinearColor'], effect => {
            const target = receiver(effect, [niagara,'NiagaraComponent']);
            const [name, value] = effect.arguments || [];
            const parameter = target.linearColors?.get(name);
            if (!parameter || !value || !['R','G','B','A'].every(k => finite(value[k])))
                throw new EffectUnavailable('niagara_parameter_unbound', 'Original Niagara color parameter has no translated render binding');
            // Binding belongs to the converted effect graph. Never recolor the
            // character/material heuristically to stand in for a Niagara system.
            parameter.set(Math.fround(value.R), Math.fround(value.G), Math.fround(value.B), Math.fround(value.A));
            return {scope:'bound_niagara_parameter', parameter:name};
        }));
        return () => removers.forEach(remove => remove());
    }
}

export class SourceWaveAudio {
    constructor(context, manifest, {fetchImpl = globalThis.fetch, digest = async data =>
        Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2,'0')).join('')} = {}) {
        if (!context || manifest?.schema_version !== 1 || !manifest.assets || Array.isArray(manifest.assets)) throw Error('Invalid source audio manifest');
        this.context = context; this.manifest = manifest; this.fetch = fetchImpl; this.digest = digest;
        this.buffers = new Map(); this.voices = new Set(); this.closed = false;
    }
    async buffer(asset) {
        const row = this.manifest.assets[asset];
        if (!row || row.kind !== 'SoundWave' || !/^[a-f0-9]{64}$/i.test(row.sha256 || '')
            || !/^\/build\/local-scenes\/[A-Za-z0-9_./-]+\.wav$/.test(row.url || '')
            || row.url.includes('..')) throw new EffectUnavailable('audio_asset_missing', 'Original SoundWave has no verified local WAV export');
        if (row.source_settings_verified !== true || !finite(row.volume) || row.volume < 0
            || !finite(row.pitch) || row.pitch <= 0 || typeof row.loop !== 'boolean')
            throw new EffectUnavailable('audio_settings_missing', 'Sound class, concurrency and source wave settings require verified export');
        const cacheKey = row.url + ':' + row.sha256;
        if (!this.buffers.has(cacheKey)) {
            // Decoded PCM can dwarf the WAV size. Keep the laptop cache bounded.
            if (this.buffers.size >= 32) this.buffers.delete(this.buffers.keys().next().value);
            const task = (async () => {
                const response = await this.fetch(row.url + '?revision=' + row.sha256);
                if (!response.ok) throw new EffectUnavailable('audio_fetch_failed', 'Original WAV export is unavailable');
                const data = await response.arrayBuffer();
                if (await this.digest(data) !== row.sha256.toLowerCase()) throw new EffectUnavailable('audio_hash_mismatch', 'Original WAV checksum differs');
                return this.context.decodeAudioData(data.slice(0));
            })();
            this.buffers.set(cacheKey, task);
            task.catch(() => { if (this.buffers.get(cacheKey) === task) this.buffers.delete(cacheKey); });
        }
        return {row, buffer:await this.buffers.get(cacheKey)};
    }
    async play2D(effect) {
        if (this.closed) throw new EffectUnavailable('audio_disposed','Audio driver disposed');
        const args = effect.arguments;
        if (effect.dispatch !== 'EX_CallMath' || effect.receiver !== null || !Array.isArray(args) || args.length !== 8)
            throw new EffectUnavailable('audio_contract', 'Original PlaySound2D signature differs');
        const [world,sound,volume,pitch,start,concurrency,owner,isUI] = args;
        if (sound === null) return {status:'skipped', scope:'source_null_sound'};
        if (world?.kind !== 'source_self' || world.source_package !== effect.package)
            throw new EffectUnavailable('world_unbound', 'Original audio world context is unavailable');
        if (concurrency !== null || owner !== null || isUI !== true)
            throw new EffectUnavailable('audio_policy_untranslated', 'Concurrency, actor audio parameters and non-UI pause behavior require source adapters');
        if (![volume,pitch,start].every(finite) || volume < 0 || pitch <= 0)
            throw new EffectUnavailable('audio_parameters', 'Unsupported original audio multipliers');
        const {row,buffer} = await this.buffer(sound?.asset);
        if (this.closed) throw new EffectUnavailable('audio_disposed','Audio driver disposed');
        if (this.context.state !== 'running') throw new EffectUnavailable('audio_gesture_required','Enable audio with a user gesture before playing');
        if (this.voices.size >= 64) throw new EffectUnavailable('audio_voice_limit','Browser audio resource limit reached');
        const offset = Math.max(0, Math.fround(start));
        if (!row.loop && offset >= buffer.duration) return {status:'skipped', scope:'source_past_sound_end'};
        const source = this.context.createBufferSource(), gain = this.context.createGain();
        source.buffer = buffer; source.loop = row.loop;
        source.playbackRate.value = Math.fround(pitch) * row.pitch;
        gain.gain.value = Math.fround(volume) * row.volume;
        source.connect(gain); gain.connect(this.context.destination);
        const voice = {source,gain}; this.voices.add(voice);
        source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(voice); };
        try { source.start(0, row.loop ? offset % buffer.duration : offset); }
        catch (error) { source.onended(); throw error; }
        return {scope:'verified_wave_ui_2d', asset:sound.asset, sha256:row.sha256};
    }
    install(bridge) { return bridge.register([engine,'GameplayStatics','PlaySound2D'], effect => this.play2D(effect)); }
    dispose() {
        this.closed = true;
        for (const {source,gain} of this.voices) { try { source.stop(); } catch {} source.disconnect(); gain.disconnect(); }
        this.voices.clear(); this.buffers.clear();
    }
}

export function nativeEffectCoverage(report) {
    const calls = new Map();
    const walk = (value, source) => {
        if (!value || typeof value !== 'object') return;
        if (value.op === 'native_audio_vfx') {
            const id = key(value.identity);
            const row = calls.get(id) || {identity:value.identity, call_sites:0, sources:[]};
            row.call_sites++;
            if (!row.sources.some(s => s.package === source.package && s.function === source.function)) row.sources.push(source);
            calls.set(id,row);
        }
        for (const child of Object.values(value)) walk(child,source);
    };
    for (const [name,pkg] of Object.entries(report?.packages || {}))
        for (const [fn,program] of Object.entries({...pkg.functions,...pkg.event_programs}))
            walk(program.steps,{package:name,function:fn,source_bytecode_sha256:program.source_bytecode_sha256});
    return [...calls.values()];
}
