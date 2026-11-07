// Accept or reject motion packets by timestamp. Matches AirPods freshness intent
// (reject stale / replay / out-of-order) without touching ClosedCaseSession.

export class MotionClock {
    constructor({staleSeconds = 0.5} = {}) {
        this.staleSeconds = staleSeconds;
        this.lastStamp = null;
    }

    reset() {
        this.lastStamp = null;
    }

    accept({stamp, host, now}) {
        if (!Number.isFinite(stamp) || stamp <= 0) return {ok: false, reason: 'invalid-stamp'};
        if (!Number.isFinite(host) || !Number.isFinite(now)) return {ok: false, reason: 'invalid-host'};
        if (this.lastStamp != null && stamp <= this.lastStamp) return {ok: false, reason: 'order-or-replay'};
        if (now - host > this.staleSeconds) return {ok: false, reason: 'stale'};
        if (host - now > 0.05) return {ok: false, reason: 'host-in-future'};
        this.lastStamp = stamp;
        return {ok: true, reason: null};
    }
}
