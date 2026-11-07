// Exclusive AirPods-or-Watch source router. Test twin of PointerSourceRouter.swift.
// Not imported by the live AirPods session. Default active source is airpods so a
// future wiring can keep today's path unless Watch is explicitly selected.

export const POINTER_SOURCES = Object.freeze(['airpods', 'watch']);

export class PointerSourceRouter {
    constructor() {
        this.active = 'airpods';
        this.paused = false;
        this.lastEmit = null;
        this.emitCount = {airpods: 0, watch: 0};
    }

    select(source) {
        if (!POINTER_SOURCES.includes(source)) throw new Error('Unknown pointer source.');
        this.active = source;
    }

    pauseImmediately() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
    }

    allows(source) {
        return !this.paused && this.active === source;
    }

    // One payload per call. Rejects the inactive source and all sources while paused.
    emit(source, payload) {
        if (!this.allows(source)) return null;
        this.lastEmit = {source, payload};
        this.emitCount[source] += 1;
        return payload;
    }

    totalEmits() {
        return this.emitCount.airpods + this.emitCount.watch;
    }
}

export class PointerCommand {
    static move(normalized, displayId) {
        return {kind: 'move', normalized, displayId};
    }
    static click(button, normalized) {
        return {kind: 'click', button, normalized};
    }
    static pause() {
        return {kind: 'pause'};
    }
    static swipe(direction) {
        return {kind: 'swipe', direction};
    }
}
