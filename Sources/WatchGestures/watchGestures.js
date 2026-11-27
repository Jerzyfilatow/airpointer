// Wrist turnover, angular swipe L/R, safe click-intent, immediate pause.
// Click is IMU poke + release hysteresis — not Digital Crown press (unsupported).
// Modes: paused | suppress | turnover | swipe | click | pointing.
// Startup, resume, and delivery gaps enter suppress until motion is quiet.

const TWO_PI = Math.PI * 2;

export function wrapDelta(from, to) {
    let d = to - from;
    while (d > Math.PI) d -= TWO_PI;
    while (d < -Math.PI) d += TWO_PI;
    return d;
}

export class WatchGestureDetector {
    constructor({
        swipeWindow = 0.12,
        swipeAngle = 0.35,
        swipeRate = 2.5,
        swipeCooldown = 0.35,
        clickJolt = 4.0,
        clickRelease = 1.5,
        clickMaxYaw = 1.2,
        clickCooldown = 0.4,
        turnoverOn = 2.0,
        turnoverOff = 1.2,
        gapSeconds = 0.25,
        suppressQuiet = 0.08,
        quietRate = 1.5
    } = {}) {
        this.swipeWindow = swipeWindow;
        this.swipeAngle = swipeAngle;
        this.swipeRate = swipeRate;
        this.swipeCooldown = swipeCooldown;
        this.clickJolt = clickJolt;
        this.clickRelease = clickRelease;
        this.clickMaxYaw = clickMaxYaw;
        this.clickCooldown = clickCooldown;
        this.turnoverOn = turnoverOn;
        this.turnoverOff = turnoverOff;
        this.gapSeconds = gapSeconds;
        this.suppressQuiet = suppressQuiet;
        this.quietRate = quietRate;
        this.paused = false;
        this.history = [];
        this.lastClickAt = -Infinity;
        this.lastSwipeAt = -Infinity;
        this.turnover = false;
        this.clickHeld = false;
        this.suppressUntilQuiet = true;
        this.quietFor = 0;
        this.lastT = null;
        this.mode = 'suppress';
    }

    pauseImmediately() {
        this.paused = true;
        this.history = [];
        this.mode = 'paused';
        this.clickHeld = false;
    }

    resume() {
        this.paused = false;
        this.suppressUntilQuiet = true;
        this.quietFor = 0;
        this.clickHeld = false;
        this.history = [];
        this.lastT = null;
        this.mode = 'suppress';
    }

    feed({t, yaw, pitch, roll, yawRate, pitchRate, rollRate}) {
        if (this.paused) return {paused: true, events: [], pointing: false, mode: 'paused'};
        if (![t, yaw, pitch, roll, yawRate, pitchRate, rollRate].every(Number.isFinite)) {
            return {paused: false, events: [], pointing: false, reason: 'nonfinite', mode: this.mode};
        }
        if (this.lastT != null && t <= this.lastT) {
            return {paused: false, events: [], pointing: false, reason: 'order', mode: this.mode};
        }
        if (this.lastT != null && t - this.lastT > this.gapSeconds) {
            this.suppressUntilQuiet = true;
            this.quietFor = 0;
            this.clickHeld = false;
            this.history = [];
            this.mode = 'suppress';
            this.lastT = null;
        }
        const dt = this.lastT == null ? 0 : t - this.lastT;
        this.lastT = t;
        this.history.push({t, yaw, pitch, roll, yawRate, pitchRate, rollRate});
        while (this.history.length && t - this.history[0].t > Math.max(this.swipeWindow, 0.25)) this.history.shift();

        const events = [];
        const absRoll = Math.abs(roll);
        if (!this.turnover && absRoll >= this.turnoverOn) {
            this.turnover = true;
            events.push({type: 'turnover', t});
        } else if (this.turnover && absRoll <= this.turnoverOff) {
            this.turnover = false;
        }

        const quiet = Math.abs(yawRate) < this.quietRate && Math.abs(pitchRate) < this.quietRate && !this.turnover;
        if (this.suppressUntilQuiet) {
            if (quiet) this.quietFor += dt;
            else this.quietFor = 0;
            if (this.quietFor >= this.suppressQuiet) this.suppressUntilQuiet = false;
            this.mode = 'suppress';
            return {paused: false, events, pointing: false, turnover: this.turnover, mode: this.mode};
        }

        const window = this.history.filter(s => t - s.t <= this.swipeWindow);
        if (window.length >= 2) {
            let dyaw = 0;
            for (let i = 1; i < window.length; i++) dyaw += wrapDelta(window[i - 1].yaw, window[i].yaw);
            const meanRate = window.reduce((s, x) => s + x.yawRate, 0) / window.length;
            const cool = t - this.lastSwipeAt >= this.swipeCooldown;
            const sameSign = Math.sign(dyaw) === Math.sign(meanRate) && dyaw !== 0 && meanRate !== 0;
            if (cool && Math.abs(dyaw) >= this.swipeAngle && Math.abs(meanRate) >= this.swipeRate && sameSign && !this.turnover) {
                const direction = dyaw > 0 ? 'right' : 'left';
                this.lastSwipeAt = t;
                this.mode = 'swipe';
                events.push({type: 'swipe', direction, t});
            }
        }

        const recentSwipe = t - this.lastSwipeAt < this.swipeCooldown;
        const recentClick = t - this.lastClickAt < this.clickCooldown;
        const poke = Math.abs(pitchRate);
        if (this.clickHeld && poke <= this.clickRelease) this.clickHeld = false;
        const quietYaw = Math.abs(yawRate) <= this.clickMaxYaw;
        const rising = !this.clickHeld && poke >= this.clickJolt;
        if (rising) {
            this.clickHeld = true;
            if (!this.turnover && !recentSwipe && !recentClick && quietYaw) {
                this.lastClickAt = t;
                this.mode = 'click';
                events.push({type: 'click', button: 'left', t});
            }
        }

        if (this.turnover) this.mode = 'turnover';
        else if (recentSwipe) this.mode = 'swipe';
        else if (this.clickHeld) this.mode = 'click';
        else this.mode = 'pointing';

        const pointing = this.mode === 'pointing';
        return {paused: false, events, pointing, turnover: this.turnover, mode: this.mode};
    }
}
