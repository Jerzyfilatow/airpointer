// Experimental per-user OPEN / FIST / REST collector + bounded classifier.
// Inference labels: open | closed | UNKNOWN. REST is a negative/unknown class, not closed.
// NOT wired to cursor/click. No HealthKit, optics, or PPG. Local logs only.
// No established physiological mapping. Synthetic tests are not hardware validation.
//
// Units match public Core Motion: userAcceleration in g, rotationRate in rad/s
// (CMDeviceMotion.rotationRate / CMGyroData — radians per second).
// Feature names are windowed mean/variance of magnitudes, not instantaneous squares.
// receiverNow is required and authoritative; sensor tMono is the sample clock.

export const HAND_STATE_SCHEMA_VERSION = 2;
export const HAND_COLLECTION_LABELS = Object.freeze(['open', 'fist', 'rest']);
export const HAND_INFERENCE_LABELS = Object.freeze(['open', 'closed', 'UNKNOWN']);
export const HAND_FEATURE_KEYS = Object.freeze(['accelMagMean', 'gyroMagMean', 'accelMagVar', 'gyroMagVar']);
export const HAND_UNITS = Object.freeze({
    accel: 'g',
    gyro: 'rad_per_s',
    timestamp: 'seconds_monotonic_sensor'
});
export const HAND_COORDINATE_FRAME = 'device-motion-synthetic-v2';
export const HAND_WINDOW_MIN = 4;

export function contextKey({wrist, wristPosition, strapFit}) {
    return `${wrist}|${wristPosition}|${strapFit}`;
}

function mean(arr) {
    return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function variance(arr, m) {
    return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
}

export function featuresFromWindow(frames) {
    if (!Array.isArray(frames) || frames.length < HAND_WINDOW_MIN) return {ok: false, reason: 'window-short', features: null};
    const acc = [], gyr = [];
    for (const f of frames) {
        const a = f?.userAcceleration, w = f?.rotationRate;
        const am = Math.hypot(a?.x, a?.y, a?.z);
        const wm = Math.hypot(w?.x, w?.y, w?.z);
        if (![am, wm].every(Number.isFinite) || am < 0 || wm < 0) return {ok: false, reason: 'nonfinite', features: null};
        acc.push(am);
        gyr.push(wm);
    }
    const aMean = mean(acc), wMean = mean(gyr);
    return {
        ok: true,
        reason: null,
        features: {
            accelMagMean: aMean,
            gyroMagMean: wMean,
            accelMagVar: variance(acc, aMean),
            gyroMagVar: variance(gyr, wMean)
        }
    };
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
    for (const k of HAND_FEATURE_KEYS) {
        if (!Number.isFinite(f[k]) || f[k] < 0) return 'nonfinite-feature';
    }
    return null;
}

function centroid(rows) {
    const out = {};
    for (const k of HAND_FEATURE_KEYS) out[k] = mean(rows.map(r => r.features[k]));
    return out;
}

function dist(features, c) {
    let s = 0;
    for (const k of HAND_FEATURE_KEYS) {
        const d = features[k] - c[k];
        s += d * d;
    }
    return Math.sqrt(s);
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

export function evaluateHeldOut(classifier, testRows, {now} = {}) {
    const counts = {open: 0, closed: 0, UNKNOWN: 0};
    const byLabel = {open: [], fist: [], rest: []};
    for (const row of testRows) {
        const got = classifier.infer(row, {now: now ?? row.tMono});
        counts[got.label] = (counts[got.label] ?? 0) + 1;
        if (byLabel[row.label]) byLabel[row.label].push(got);
    }
    return {counts, byLabel};
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

function sessionsOf(rows) {
    return new Set(rows.map(r => r.sessionId)).size;
}

export class HandStateClassifier {
    constructor({
        minPerClass = 20,
        minSessionsPerClass = 2,
        overlapRatio = 0.65,
        margin = 0.08,
        cooldown = 0.4,
        staleSeconds = 0.5,
        futureSlack = 0.05
    } = {}) {
        this.minPerClass = minPerClass;
        this.minSessionsPerClass = minSessionsPerClass;
        this.overlapRatio = overlapRatio;
        this.margin = margin;
        this.cooldown = cooldown;
        this.staleSeconds = staleSeconds;
        this.futureSlack = futureSlack;
        this.models = new Map();
        this.armed = false;
        this.lastActionAt = -Infinity;
        this.sessionCursor = new Map();
    }

    arm() {this.armed = true;}
    disarm() {this.armed = false;}

    modelKey(userId, ctx) {return `${userId}::${ctx}`;}

    separable(aRows, bRows, aC, bC) {
        if (!aRows.length || !bRows.length) return false;
        const sep = dist(aC, bC);
        const aSpread = mean(aRows.map(r => dist(r.features, aC)));
        const bSpread = mean(bRows.map(r => dist(r.features, bC)));
        return sep >= this.overlapRatio * (aSpread + bSpread) && sep >= this.margin;
    }

    train(samples) {
        const valid = [];
        for (const s of samples) {
            if (validateSample({...s, label: s.label ?? 'rest'})) continue;
            if (!HAND_COLLECTION_LABELS.includes(s.label)) continue;
            valid.push(s);
        }
        this.models.clear();
        this.sessionCursor.clear();
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
            const enough = open.length >= this.minPerClass && fist.length >= this.minPerClass && rest.length >= this.minPerClass
                && sessionsOf(open) >= this.minSessionsPerClass
                && sessionsOf(fist) >= this.minSessionsPerClass
                && sessionsOf(rest) >= this.minSessionsPerClass;
            if (!enough) {
                this.models.set(key, {status: 'insufficient', open: null, fist: null, rest: null});
                report.push({key, status: 'insufficient', restCount: rest.length});
                continue;
            }
            const openC = centroid(open);
            const fistC = centroid(fist);
            const restC = centroid(rest);
            const openFist = this.separable(open, fist, openC, fistC);
            const restOpen = this.separable(rest, open, restC, openC);
            const restFist = this.separable(rest, fist, restC, fistC);
            if (!openFist || !restOpen || !restFist) {
                this.models.set(key, {status: 'nonseparable', open: openC, fist: fistC, rest: restC});
                report.push({key, status: 'nonseparable', openFist, restOpen, restFist});
                continue;
            }
            const spread = Math.max(
                mean(open.map(r => dist(r.features, openC))),
                mean(fist.map(r => dist(r.features, fistC))),
                1e-6
            );
            this.models.set(key, {status: 'ready', open: openC, fist: fistC, rest: restC, spread, sep: dist(openC, fistC)});
            report.push({key, status: 'ready'});
        }
        return report;
    }

    infer(sample, {now} = {}) {
        const base = {label: 'UNKNOWN', action: null, reason: null};
        if (!this.armed) return {...base, reason: 'not-armed'};
        if (!Number.isFinite(now)) return {...base, reason: 'missing-receiver-now'};
        const err = validateSample({...sample, label: sample.label ?? 'rest'});
        if (err) return {...base, reason: err};
        const prev = this.sessionCursor.get(sample.sessionId);
        if (prev && (sample.sequence <= prev.sequence || sample.tMono <= prev.tMono)) {
            return {...base, reason: 'replay-or-order'};
        }
        if (sample.tMono - now > this.futureSlack) return {...base, reason: 'future'};
        if (now - sample.tMono > this.staleSeconds) return {...base, reason: 'stale'};
        this.sessionCursor.set(sample.sessionId, {sequence: sample.sequence, tMono: sample.tMono});
        const key = this.modelKey(sample.userId, contextKey(sample));
        const model = this.models.get(key);
        if (!model) return {...base, reason: 'untrained'};
        if (model.status === 'insufficient') return {...base, reason: 'insufficient'};
        if (model.status === 'nonseparable') return {...base, reason: 'nonseparable'};
        if (now - this.lastActionAt < this.cooldown) return {...base, reason: 'cooldown'};
        const dOpen = dist(sample.features, model.open);
        const dFist = dist(sample.features, model.fist);
        const dRest = dist(sample.features, model.rest);
        const nearest = Math.min(dOpen, dFist, dRest);
        if (dRest <= nearest + this.margin) return {...base, reason: 'rest-like'};
        if (Math.abs(dOpen - dFist) < this.margin) return {...base, reason: 'overlap'};
        if (Math.min(dOpen, dFist) > 4 * model.spread) return {...base, reason: 'far'};
        const label = dOpen < dFist ? 'open' : 'closed';
        this.lastActionAt = now;
        return {label, action: null, reason: 'classified'};
    }
}
