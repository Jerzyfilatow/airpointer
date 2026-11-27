// Per-wrist / crown-orientation neutral pose. Axis signs are a SYNTHETIC test
// convention, not a verified Core Motion device-frame mapping (hardware gate).

import {inverse, multiply, rotation} from '../AirPointer/Session/Orientation.js';

export function calibrationKey(wrist, crown) {
    if (wrist !== 'left' && wrist !== 'right') throw new Error('wrist must be left or right');
    if (crown !== 'left' && crown !== 'right') throw new Error('crown must be left or right');
    return `${wrist}:${crown}`;
}

// Typical Apple Watch: crown toward the thumb (left wrist → crown right, and the reverse).
export function typicalCrown(wrist) {
    return wrist === 'left' ? 'right' : 'left';
}

export function axisSigns(wrist, crown) {
    const typical = crown === typicalCrown(wrist);
    const x = wrist === 'right' ? -1 : 1;
    return {x: typical ? x : -x, y: 1};
}

export function canonicalQuaternion(q) {
    if (!Array.isArray(q) || q.length !== 4 || !q.every(Number.isFinite)) return null;
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    if (n < 1e-12) return null;
    const u = q.map(c => c / n);
    return u[0] < 0 ? u.map(c => -c) : u;
}

export function relativeAngles(neutralQ, currentQ, wrist, crown) {
    const n = canonicalQuaternion(neutralQ);
    const c = canonicalQuaternion(currentQ);
    if (!n || !c) return null;
    const rel = multiply(inverse(n), c);
    const r = rotation(rel);
    const s = axisSigns(wrist, crown);
    return {ax: r[0] * s.x, ay: r[1] * s.y, roll: r[2] * s.x};
}

export class WristNeutralStore {
    constructor() {
        this.byKey = new Map();
    }

    setNeutral(wrist, crown, q) {
        const key = calibrationKey(wrist, crown);
        const canon = canonicalQuaternion(q);
        if (!canon) throw new Error('Invalid neutral quaternion.');
        this.byKey.set(key, canon);
        return key;
    }

    get(wrist, crown) {
        return this.byKey.get(calibrationKey(wrist, crown)) ?? null;
    }
}
