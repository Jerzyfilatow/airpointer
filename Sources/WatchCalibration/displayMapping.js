// CG-style display mapping. Isolated from AirPointer.swift screenPoint.
// Normalized (u,v): u=0 left, u=1 right, v=0 top, v=1 bottom.
// CG y increases upward; origin may be negative (non-primary displays).

export function clamp01(x) {
    if (!Number.isFinite(x)) return 0;
    return Math.min(1, Math.max(0, x));
}

export function validateDisplay(display) {
    if (!display || typeof display.id !== 'string' || !display.id) return 'missing-id';
    if (![display.originX, display.originY, display.width, display.height].every(Number.isFinite)) return 'non-finite';
    if (!(display.width > 2) || !(display.height > 2)) return 'too-small';
    return null;
}

// One logical target. Mirrored copies share bounds; callers must emit once.
export function logicalTarget(displays, {preferredId, mirroredGroup} = {}) {
    const list = Array.isArray(displays) ? displays : [];
    if (mirroredGroup) {
        const group = list.filter(d => d.mirroredGroup === mirroredGroup);
        if (group.length) return group[0];
    }
    if (preferredId) {
        const hit = list.find(d => d.id === preferredId);
        if (hit) return hit;
    }
    return list[0] ?? null;
}

export function toCG(u, v, display) {
    const err = validateDisplay(display);
    if (err) return {ok: false, reason: err, x: null, y: null};
    const uu = clamp01(u);
    const vv = clamp01(v);
    const x = display.originX + 1 + uu * (display.width - 2);
    const y = display.originY + (display.height - 1) - vv * (display.height - 2);
    return {ok: true, reason: null, x, y};
}

export function fromCG(x, y, display) {
    const err = validateDisplay(display);
    if (err) return {ok: false, reason: err, u: null, v: null};
    const u = (x - display.originX - 1) / (display.width - 2);
    const v = (display.originY + display.height - 1 - y) / (display.height - 2);
    return {ok: true, reason: null, u: clamp01(u), v: clamp01(v)};
}
