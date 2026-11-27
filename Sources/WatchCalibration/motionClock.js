// Freshness of a motion packet.
// sensorStamp: monotonic time from the *sensor* (same unit across a session).
// hostReceived: when the *receiver* (Mac process) got the packet.
// receiverNow: authoritative receiver clock at the decision (must be finite).
// sensorAgeSeconds: optional, receiverNow - sensorTime when both are in seconds.
// Do not compare a microsecond sensor stamp to a seconds receiver clock.

export class MotionClock {
    constructor({staleSeconds = 0.5, futureSlack = 0.05} = {}) {
        this.staleSeconds = staleSeconds;
        this.futureSlack = futureSlack;
        this.lastSensorStamp = null;
        this.lastSequence = null;
    }

    reset() {
        this.lastSensorStamp = null;
        this.lastSequence = null;
    }

    accept({sensorStamp, hostReceived, receiverNow, sequence, sensorAgeSeconds} = {}) {
        const stamp = sensorStamp;
        const host = hostReceived;
        const now = receiverNow;
        if (!Number.isFinite(now)) return {ok: false, reason: 'missing-receiver-now'};
        if (!Number.isFinite(stamp) || stamp <= 0) return {ok: false, reason: 'invalid-stamp'};
        if (!Number.isFinite(host)) return {ok: false, reason: 'invalid-host'};
        if (sequence != null && (!Number.isInteger(sequence) || sequence < 0)) return {ok: false, reason: 'invalid-sequence'};
        if (this.lastSensorStamp != null && stamp <= this.lastSensorStamp) return {ok: false, reason: 'order-or-replay'};
        if (this.lastSequence != null && sequence != null && sequence <= this.lastSequence) return {ok: false, reason: 'order-or-replay'};
        if (!Number.isFinite(sensorAgeSeconds)) return {ok: false, reason: 'missing-sensor-age'};
        if (now - host > this.staleSeconds) return {ok: false, reason: 'stale-host'};
        if (host - now > this.futureSlack) return {ok: false, reason: 'host-in-future'};
        if (sensorAgeSeconds > this.staleSeconds) return {ok: false, reason: 'stale-sensor'};
        if (sensorAgeSeconds < -this.futureSlack) return {ok: false, reason: 'sensor-in-future'};
        this.lastSensorStamp = stamp;
        if (sequence != null) this.lastSequence = sequence;
        return {ok: true, reason: null};
    }
}
