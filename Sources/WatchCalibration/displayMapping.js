// Destination: CGEvent mouseCursorPosition on CGDisplayBounds, matching
// Sources/AirPointer/App/AirPointer.swift screenPoint (lines 5–8).
//
// Official: CGDisplayBounds is "a rectangle in the global display coordinate
// space (relative to the upper-left corner of the main display)."
// https://developer.apple.com/documentation/coregraphics/cgdisplaybounds(_:)
// CGEvent.location is the Quartz mouse location in that global space;
// unflippedLocation is the opposite vertical convention.
// https://developer.apple.com/documentation/coregraphics/cgevent/location
//
// So y increases downward. originX/originY may be negative (display left of or
// above the main display). This is NOT AppKit NSScreen.frame (y-up).
//
// Normalized (u,v): u=0 left, u=1 right, v=0 TOP, v=1 BOTTOM — same as AirPointer
// Grip output and the three-dot "up" pose (small y → minY edge → top of screen).
//
// mirroredGroup is a caller-supplied topology descriptor. Actual OS mirror
// discovery (CGDisplayIsInMirrorSet / NSScreen) is unimplemented.

export function validateDisplay(display) {
    if (!display || typeof display.id !== 'string' || !display.id) return 'missing-id';
    if (![display.originX, display.originY, display.width, display.height].every(Number.isFinite)) return 'non-finite';
    if (!(display.width > 2) || !(display.height > 2)) return 'too-small';
    return null;
}

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

function insetMap(t, origin, span) {
    return origin + 1 + t * (span - 2);
}

function insetUnmap(p, origin, span) {
    return (p - origin - 1) / (span - 2);
}

export function toEvent(u, v, display) {
    const err = validateDisplay(display);
    if (err) return {ok: false, reason: err, x: null, y: null, clamped: false};
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
        return {ok: false, reason: 'nonfinite', x: null, y: null, clamped: false};
    }
    const clamped = u < 0 || u > 1 || v < 0 || v > 1;
    const uu = Math.min(1, Math.max(0, u));
    const vv = Math.min(1, Math.max(0, v));
    return {
        ok: true,
        reason: null,
        x: insetMap(uu, display.originX, display.width),
        y: insetMap(vv, display.originY, display.height),
        clamped
    };
}

export function fromEvent(x, y, display) {
    const err = validateDisplay(display);
    if (err) return {ok: false, reason: err, u: null, v: null, clamped: false};
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return {ok: false, reason: 'nonfinite', u: null, v: null, clamped: false};
    }
    const u = insetUnmap(x, display.originX, display.width);
    const v = insetUnmap(y, display.originY, display.height);
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
        return {ok: false, reason: 'nonfinite', u: null, v: null, clamped: false};
    }
    const clamped = u < 0 || u > 1 || v < 0 || v > 1;
    return {
        ok: true,
        reason: null,
        u: Math.min(1, Math.max(0, u)),
        v: Math.min(1, Math.max(0, v)),
        clamped
    };
}

export const toCG = toEvent;
export const fromCG = fromEvent;
