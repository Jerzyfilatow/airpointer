// Experimental per-user OPEN / FIST / REST collector + bounded classifier.
// Inference labels: open | closed | UNKNOWN. REST is a negative/unknown class, not closed.
// NOT wired to cursor/click. No HealthKit, optics, or PPG. Local logs only.
// No established physiological mapping. Synthetic tests are not hardware validation.

export const HAND_STATE_SCHEMA_VERSION = 1;
export const HAND_COLLECTION_LABELS = Object.freeze(['open', 'fist', 'rest']);
export const HAND_INFERENCE_LABELS = Object.freeze(['open', 'closed', 'UNKNOWN']);
export const HAND_UNITS = Object.freeze({
    accel: 'g',
    gyro: 'deg_per_s',
    timestamp: 'seconds_monotonic'
});
export const HAND_COORDINATE_FRAME = 'device-motion-synthetic-v1';

export function contextKey({wrist, wristPosition, strapFit}) {
    return `${wrist}|${wristPosition}|${strapFit}`;
}

export function validateSample(sample) {
    if (!sample || sample.schemaVersion !== HAND_STATE_SCHEMA_VERSION) return 'schema';
    if (typeof sample.userId !== 'string' || !sample.userId.startsWith('user-local-')) return 'user';
    if (typeof sample.sessionId !== 'string' || !sample.sessionId.startsWith('sess-')) return 'session';
    if (!HAND_COLLECTION_LABELS.includes(sample.label) && sample.label != null) return 'label';
    if (!Number.isFinite(sample.tMono) || sample.tMono < 0) return 'timestamp';
    if (!Number.isInteger(sample.sequence) || sample.sequence < 0) return 'sequence';
    if (sample.units?.accel !== HAND_UNITS.accel || sample.units?.gyro !== HAND_UNITS.gyro) return 'units';
    if (sample.coordinateFrame !== HAND_COORDINATE_FRAME) return 'frame';
    if (sample.wrist !== 'left' && sample.wrist !== 'right') return 'wrist';
    if (typeof sample.wristPosition !== 'string' || !sample.wristPosition) return 'wristPosition';
    if (typeof sample.strapFit !== 'string' || !sample.strapFit) return 'strapFit';
    const f = sample.features;
    if (!f) return 'features';
    for (const k of ['accelMag', 'gyroMag', 'accelVar', 'gyroVar']) {
        if (!Number.isFinite(f[k])) return 'nonfinite-feature';
    }
    return null;
}

export function featuresFromMotion({userAcceleration, rotationRate}) {
    const a = userAcceleration, w = rotationRate;
    if (![a?.x, a?.y, a?.z, w?.x, w?.y, w?.z].every(Number.isFinite)) return null;
    const accelMag = Math.hypot(a.x, a.y, a.z);
    const gyroMag = Math.hypot(w.x, w.y, w.z);
    return {accelMag, gyroMag, accelVar: accelMag * accelMag, gyroVar: gyroMag * gyroMag};
}

function mean(rows, key) {
    return rows.reduce((s, r) => s + r.features[key], 0) / rows.length;
}

function centroid(rows) {
    return {
        accelMag: mean(rows, 'accelMag'),
        gyroMag: mean(rows, 'gyroMag'),
        accelVar: mean(rows, 'accelVar'),
        gyroVar: mean(rows, 'gyroVar')
    };
}

function dist(features, c) {
    const da = features.accelMag - c.accelMag;
    const dg = features.gyroMag - c.gyroMag;
    const va = features.accelVar - c.accelVar;
    const vg = features.gyroVar - c.gyroVar;
    return Math.hypot(da, dg * 0.05, va, vg * 0.002);
}

export function splitBySession(samples) {
    const by = new Map();
    for (const s of samples) {
        if (!by.has(s.sessionId)) by.set(s.sessionId, []);
        by.get(s.sessionId).push(s);
    }
    const sessions = [...by.keys()].sort();
    if (sessions.length < 2) return {train: samples, test: [], heldOutSession: null};
    const held = sessions[sessions.length - 1];
    return {
        train: samples.filter(s => s.sessionId !== held),
        test: samples.filter(s => s.sessionId === held),
        heldOutSession: held
    };
}

export class LocalHandLog {
    constructor() {
        this.rows = [];
        this.hooks = [];
    }

    onStream(fn) {this.hooks.push(fn);}

    append(sample) {
        const err = validateSample(sample);
        if (err) return {ok: false, reason: err};
        this.rows.push(sample);
        for (const hook of this.hooks) hook(sample);
        return {ok: true, reason: null};
    }
}

export class HandStateClassifier {
    constructor({
        minPerClass = 20,
        minSessionsPerClass = 2,
        overlapRatio = 0.65,
        margin = 0.08,
        cooldown = 0.4
    } = {}) {
        this.minPerClass = minPerClass;
        this.minSessionsPerClass = minSessionsPerClass;
        this.overlapRatio = overlapRatio;
        this.margin = margin;
        this.cooldown = cooldown;
        this.models = new Map();
        this.armed = false;
        this.lastActionAt = -Infinity;
    }

    arm() {this.armed = true;}
    disarm() {this.armed = false;}

    modelKey(userId, ctx) {return `${userId}::${ctx}`;}

    train(samples) {
        const valid = [];
        for (const s of samples) {
            if (validateSample({...s, label: s.label ?? 'rest'}) ) continue;
            if (!HAND_COLLECTION_LABELS.includes(s.label)) continue;
            valid.push(s);
        }
        this.models.clear();
        const groups = new Map();
        for (const s of valid) {
            const key = this.modelKey(s.userId, contextKey(s));
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(s);
        }
        const report = [];
        for (const [key, rows] of groups) {
            const open = rows.filter(r => r.label === 'open');
            const fist = rows.filter(r => r.label === 'fist');
            const rest = rows.filter(r => r.label === 'rest');
            const openSessions = new Set(open.map(r => r.sessionId)).size;
            const fistSessions = new Set(fist.map(r => r.sessionId)).size;
            const ready = open.length >= this.minPerClass && fist.length >= this.minPerClass
                && openSessions >= this.minSessionsPerClass && fistSessions >= this.minSessionsPerClass;
            if (!ready) {
                this.models.set(key, {status: 'insufficient', open: null, fist: null, rest: null});
                report.push({key, status: 'insufficient'});
                continue;
            }
            const openC = centroid(open);
            const fistC = centroid(fist);
            const restC = rest.length ? centroid(rest) : null;
            const sep = dist(openC, fistC);
            const openSpread = open.reduce((s, r) => s + dist(r.features, openC), 0) / open.length;
            const fistSpread = fist.reduce((s, r) => s + dist(r.features, fistC), 0) / fist.length;
            const spread = Math.max(openSpread, fistSpread, 1e-6);
            if (sep < this.overlapRatio * (openSpread + fistSpread) || sep < this.margin) {
                this.models.set(key, {status: 'nonseparable', open: openC, fist: fistC, rest: restC, spread});
                report.push({key, status: 'nonseparable', sep, spread});
                continue;
            }
            this.models.set(key, {status: 'ready', open: openC, fist: fistC, rest: restC, spread, sep});
            report.push({key, status: 'ready', sep, spread});
        }
        return report;
    }

    infer(sample, {now} = {}) {
        const t = now ?? sample.tMono;
        const base = {label: 'UNKNOWN', action: null, reason: null};
        if (!this.armed) return {...base, reason: 'not-armed'};
        const err = validateSample({...sample, label: sample.label ?? 'rest'});
        if (err) return {...base, reason: err};
        if (Number.isFinite(t) && t - sample.tMono > 0.5) return {...base, reason: 'stale'};
        const key = this.modelKey(sample.userId, contextKey(sample));
        const model = this.models.get(key);
        if (!model) return {...base, reason: 'untrained'};
        if (model.status === 'insufficient') return {...base, reason: 'insufficient'};
        if (model.status === 'nonseparable') return {...base, reason: 'nonseparable'};
        if (t - this.lastActionAt < this.cooldown) return {...base, reason: 'cooldown'};
        const dOpen = dist(sample.features, model.open);
        const dFist = dist(sample.features, model.fist);
        const dRest = model.rest ? dist(sample.features, model.rest) : Infinity;
        if (dRest + this.margin < Math.min(dOpen, dFist)) return {...base, reason: 'rest-like'};
        if (Math.abs(dOpen - dFist) < this.margin) return {...base, reason: 'overlap'};
        if (Math.min(dOpen, dFist) > 4 * model.spread) return {...base, reason: 'far'};
        const label = dOpen < dFist ? 'open' : 'closed';
        this.lastActionAt = t;
        return {label, action: null, reason: 'classified'};
    }
}
