// Exclusive AirPods-or-Watch source router. Test twin of PointerSourceRouter.swift.
// Not imported by the live AirPods session. Default active source is airpods.
//
// Composes MotionClock: session + generation + connected + rearm.
// Pause, source switch, and disconnect invalidate generation, reset the clock,
// and require a fresh non-click sample before any click is emitted.
// Swift mirror is logically aligned and UNTESTED on hardware (no XCTest here).

import {MotionClock} from '../WatchCalibration/motionClock.js';

export const POINTER_SOURCES = Object.freeze(['airpods', 'watch']);

export class PointerSourceRouter {
    constructor() {
        this.active = 'airpods';
        this.paused = false;
        this.connected = false;
        this.sessionId = null;
        this.generation = 0;
        this.rearmPending = true;
        this.clock = new MotionClock();
        this.lastEmit = null;
        this.emitCount = {airpods: 0, watch: 0};
        this.lastReject = null;
    }

    select(source) {
        if (!POINTER_SOURCES.includes(source)) throw new Error('Unknown pointer source.');
        if (source !== this.active) this.invalidate('switch');
        this.active = source;
    }

    connect({sessionId} = {}) {
        this.connected = true;
        this.sessionId = sessionId ?? this.sessionId ?? 'sess-router';
        this.invalidate('connect');
    }

    disconnect() {
        this.connected = false;
        this.invalidate('disconnect');
    }

    pauseImmediately() {
        this.paused = true;
        this.invalidate('pause');
    }

    resume() {
        this.paused = false;
        this.rearmPending = true;
        this.clock.reset();
        this.generation += 1;
    }

    invalidate(reason) {
        this.generation += 1;
        this.rearmPending = true;
        this.clock.reset();
        this.lastReject = reason;
    }

    allows(source) {
        return this.connected && !this.paused && this.active === source;
    }

    emit(source, payload, meta = {}) {
        if (!this.connected) return this.reject('disconnected');
        if (this.paused) return this.reject('paused');
        if (this.active !== source) return this.reject('inactive-source');
        if (typeof meta.sessionId !== 'string' || !meta.sessionId) return this.reject('missing-session');
        if (this.sessionId == null || meta.sessionId !== this.sessionId) return this.reject('session-mismatch');
        if (!Number.isInteger(meta.generation)) return this.reject('missing-generation');
        if (meta.generation !== this.generation) return this.reject('stale-generation');
        if (!Number.isFinite(meta.receiverNow)) return this.reject('missing-receiver-now');
        if (!Number.isFinite(meta.hostReceived)) return this.reject('invalid-host');
        if (!Number.isFinite(meta.sensorAgeSeconds)) return this.reject('missing-sensor-age');
        const clocked = this.clock.accept({
            sensorStamp: meta.sensorStamp,
            hostReceived: meta.hostReceived,
            receiverNow: meta.receiverNow,
            sequence: meta.sequence,
            sensorAgeSeconds: meta.sensorAgeSeconds
        });
        if (!clocked.ok) return this.reject(clocked.reason);

        const kind = payload?.kind;
        if (this.rearmPending) {
            if (kind === 'click' || kind === 'swipe') return this.reject('stale-command-before-rearm');
            this.rearmPending = false;
        }
        this.lastEmit = {source, payload, generation: this.generation};
        this.emitCount[source] += 1;
        this.lastReject = null;
        return payload;
    }

    reject(reason) {
        this.lastReject = reason;
        return null;
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
