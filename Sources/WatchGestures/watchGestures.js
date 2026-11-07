// Wrist turnover, angular swipe L/R, safe click-intent, immediate pause.
// Click is IMU poke + cooldown/hysteresis — not Digital Crown press (unsupported).

export class WatchGestureDetector {
    constructor({
        swipeWindow = 0.12,
        swipeAngle = 0.35,
        swipeRate = 2.5,
        swipeCooldown = 0.35,
        clickJolt = 4.0,
        clickMaxYaw = 1.2,
        clickCooldown = 0.4,
        turnoverOn = 2.0,
        turnoverOff = 1.2
    } = {}) {
        this.swipeWindow = swipeWindow;
        this.swipeAngle = swipeAngle;
        this.swipeRate = swipeRate;
        this.swipeCooldown = swipeCooldown;
        this.clickJolt = clickJolt;
        this.clickMaxYaw = clickMaxYaw;
        this.clickCooldown = clickCooldown;
        this.turnoverOn = turnoverOn;
        this.turnoverOff = turnoverOff;
        this.paused = false;
        this.history = [];
        this.lastClickAt = -Infinity;
        this.lastSwipeAt = -Infinity;
        this.turnover = false;
        this.lastT = null;
    }

    pauseImmediately() {
        this.paused = true;
        this.history = [];
    }

    resume() {
        this.paused = false;
    }

    feed({t, yaw, pitch, roll, yawRate, pitchRate, rollRate}) {
        if (this.paused) return {paused: true, events: [], pointing: false};
        if (![t, yaw, pitch, roll, yawRate, pitchRate, rollRate].every(Number.isFinite)) {
            return {paused: false, events: [], pointing: false, reason: 'nonfinite'};
        }
        if (this.lastT != null && t <= this.lastT) return {paused: false, events: [], pointing: false, reason: 'order'};
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

        const window = this.history.filter(s => t - s.t <= this.swipeWindow);
        if (window.length >= 2) {
            const dyaw = window[window.length - 1].yaw - window[0].yaw;
            const meanRate = window.reduce((s, x) => s + x.yawRate, 0) / window.length;
            const cool = t - this.lastSwipeAt >= this.swipeCooldown;
            if (cool && Math.abs(dyaw) >= this.swipeAngle && Math.abs(meanRate) >= this.swipeRate && !this.turnover) {
                const direction = dyaw > 0 ? 'right' : 'left';
                this.lastSwipeAt = t;
                events.push({type: 'swipe', direction, t});
            }
        }

        const recentSwipe = t - this.lastSwipeAt < this.swipeCooldown;
        const recentClick = t - this.lastClickAt < this.clickCooldown;
        const poke = Math.abs(pitchRate);
        const quietYaw = Math.abs(yawRate) <= this.clickMaxYaw;
        if (!this.turnover && !recentSwipe && !recentClick && poke >= this.clickJolt && quietYaw) {
            this.lastClickAt = t;
            events.push({type: 'click', button: 'left', t});
        }

        const busy = this.turnover || recentSwipe;
        const pointing = !busy && Math.abs(yawRate) < 1.5 && Math.abs(pitchRate) < 1.5;
        return {paused: false, events, pointing, turnover: this.turnover};
    }
}
