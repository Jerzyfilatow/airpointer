#!/usr/bin/env node
// Hardware-free adversarial suite. No Apple SDK, no app launch. Exit 0 on all pass.

import {Orientation, Grip, norm, rotation, multiply, inverse} from '../../Sources/AirPointer/Session/Orientation.js';
import {PointerSourceRouter, PointerCommand} from '../../Sources/PointerAdapter/pointerRouter.js';
import {MotionClock} from '../../Sources/WatchCalibration/motionClock.js';
import {relativeAngles, WristNeutralStore, canonicalQuaternion, typicalCrown} from '../../Sources/WatchCalibration/wristNeutral.js';
import {CornerGrip, validateCorners, cornersFromAngularOffsets, inverseBilinear} from '../../Sources/WatchCalibration/cornerCalibration.js';
import {toEvent, fromEvent, logicalTarget} from '../../Sources/WatchCalibration/displayMapping.js';
import {WatchGestureDetector, wrapDelta} from '../../Sources/WatchGestures/watchGestures.js';
import {
    HAND_STATE_SCHEMA_VERSION, HAND_UNITS, HAND_COORDINATE_FRAME, HAND_FEATURE_KEYS,
    validateSample, splitBySession, LocalHandLog, HandStateClassifier, contextKey,
    featuresFromWindow, evaluateHeldOut
} from '../../Sources/WatchHandState/handState.js';

const cases = [];
let assertions = 0, assertionFails = 0;

function assert(cond, msg) {
    assertions++;
    if (!cond) {
        assertionFails++;
        throw new Error(msg);
    }
}

function test(name, fn) {
    try {
        fn();
        cases.push({name, ok: true});
    } catch (e) {
        cases.push({name, ok: false, error: e.message});
    }
}

function qPoint(ax, ay) {
    const theta = Math.hypot(ax, ay);
    if (theta < 1e-12) return [1, 0, 0, 0];
    const s = Math.sin(theta / 2), c = Math.cos(theta / 2);
    return [c, (ax / theta) * s, (ay / theta) * s, 0];
}

function feats(accelMagMean, gyroMagMean, accelMagVar = 0.001, gyroMagVar = 0.001) {
    return {accelMagMean, gyroMagMean, accelMagVar, gyroMagVar};
}

test('airpods-orientation-regression', () => {
    let seq = 0, stamp = 1_000_000;
    const o = new Orientation();
    function sample(g, w) {
        stamp += 20_000;
        o.feed([++seq, 11, stamp, stamp / 1e6, ...g.map(x => Math.round(x * 1e5))]);
        o.feed([++seq, 12, stamp + 3759, stamp / 1e6, ...w.map(x => Math.round(x * 1e5))]);
    }
    for (let i = 0; i < 110; i++) sample([0, 0, 1], [0.8, -0.3, 0.4]);
    for (let i = 0; i < 50; i++) sample([0, 0, 1], [0.8, -0.3, 30.4]);
    assert(o.ready === true, 'fusion ready');
    const degrees = norm(rotation(o.q)) * 180 / Math.PI;
    assert(Math.abs(degrees - 30) < 0.04, `30deg got ${degrees}`);

    const dropped = new Orientation();
    seq = 0; stamp = 1_000_000;
    function sample2(g, w) {
        stamp += 20_000;
        dropped.feed([++seq, 11, stamp, stamp / 1e6, ...g.map(x => Math.round(x * 1e5))]);
        dropped.feed([++seq, 12, stamp + 3759, stamp / 1e6, ...w.map(x => Math.round(x * 1e5))]);
    }
    for (let i = 0; i < 110; i++) sample2([0, 0, 1], [0, 0, 0]);
    const before = [...dropped.q];
    stamp += 1_500_000;
    for (let i = 0; i < 50; i++) sample2([0, 0, 1], [0, 0, 30]);
    const shortDeg = norm(rotation(multiply(inverse(before), dropped.q))) * 180 / Math.PI;
    assert(dropped.generation === 1, 'short drop holds generation');
    assert(Math.abs(shortDeg - 29.4) < 0.1, `short drop ${shortDeg}`);
    stamp += 2_500_000;
    sample2([0, 0, 1], [0, 0, 0]);
    assert(dropped.generation === 2, 'long drop resets');

    const saved = {right: [0.3, 0, 0], up: [0, 0.3, 0], gravity: [0, 0, 1]};
    const grip = new Grip(saved);
    assert(grip.recenter([1, 0, 0, 0], [0, 0, 1]) === true, 'recenter kept');
    const center = grip.point([1, 0, 0, 0]);
    const right = grip.point([Math.cos(0.075), Math.sin(0.075), 0, 0]);
    assert(center && Math.abs(center[0] - 0.5) < 1e-6 && Math.abs(center[1] - 0.5) < 1e-6, 'center');
    assert(right && Math.abs(right[0] - 0.75) < 1e-6 && Math.abs(right[1] - 0.5) < 1e-6, 'right');
    assert(new Grip({right: [0.3, 0, 0], up: [0.3, 0.01, 0], gravity: [0, 0, 1]}).edges === null, 'parallel rejected');
    assert(new Grip(saved).recenter([Math.SQRT1_2, Math.SQRT1_2, 0, 0], [0, 0, 1]) === false, 'different hold');
    assert(new Grip().edges === null, 'fresh grip');

    let stamp3 = 1_000_000, seq3 = 0;
    function sampleSeed(o, g, w) {
        stamp3 += 5000;
        o.feed([++seq3, 11, stamp3, stamp3 / 1e6, ...g.map(x => Math.round(x * 1e5))]);
        o.feed([++seq3, 12, stamp3 + 1000, stamp3 / 1e6, ...w.map(x => Math.round(x * 1e5))]);
    }
    const seeded = new Orientation({bias: [0.5, 0.7, -0.2], gravity: [1, 0, 0]});
    sampleSeed(seeded, [0, 0, 1], [0.5, 0.7, -0.2]);
    assert(seeded.ready === true && seeded.seedUsed === true && seeded.measured === 0, 'saved offset applies');
    for (let i = 0; i < 500; i++) sampleSeed(seeded, [0, 0, 1], [0.6, 0.7, -0.2]);
    assert(Math.abs(seeded.bias[0] - 0.55) < 0.005 && seeded.measured === 1, 'later offset gentle');
});

function liveMeta(r, t, seq) {
    return {
        sessionId: r.sessionId,
        generation: r.generation,
        sensorStamp: t,
        hostReceived: t,
        receiverNow: t,
        sequence: seq
    };
}

test('router-exclusive-and-invalidate-on-switch', () => {
    const r = new PointerSourceRouter();
    assert(!r.allows('airpods'), 'disconnected default');
    r.connect({sessionId: 'sess-r1'});
    const m1 = liveMeta(r, 1, 1);
    assert(r.emit('airpods', PointerCommand.move([0.2, 0.3], 'main'), m1), 'rearm move');
    assert(r.emit('watch', PointerCommand.move([0.9, 0.9], 'main'), liveMeta(r, 1.1, 2)) === null, 'watch blocked');
    r.select('watch');
    assert(r.lastReject === 'switch', 'switch invalidates');
    assert(r.emit('watch', PointerCommand.click('left', [0.1, 0.1]), liveMeta(r, 2, 3)) === null, 'queued click after switch');
    assert(r.lastReject === 'stale-command-before-rearm', 'stale click');
    assert(r.emit('watch', PointerCommand.move([0.2, 0.2], 'main'), liveMeta(r, 2.1, 4)), 'fresh move rearms');
    assert(r.emit('watch', PointerCommand.click('left', [0.1, 0.1]), liveMeta(r, 2.2, 5)), 'click after rearm');
    r.select('airpods');
    r.select('watch');
    assert(r.emit('watch', PointerCommand.click('left', [0.1, 0.1]), liveMeta(r, 3, 6)) === null, 'switch away and back still needs rearm');
});

test('router-pause-disconnect-generation-clock', () => {
    const r = new PointerSourceRouter();
    r.connect({sessionId: 'sess-r2'});
    assert(r.emit('airpods', PointerCommand.move([0, 0], 'main'), liveMeta(r, 1, 1)), 'rearm');
    const gen = r.generation;
    r.pauseImmediately();
    assert(r.generation !== gen, 'pause bumps generation');
    assert(r.emit('airpods', PointerCommand.move([0, 0], 'main'), liveMeta(r, 2, 2)) === null, 'paused');
    r.resume();
    const staleGen = { ...liveMeta(r, 3, 3), generation: gen };
    assert(r.emit('airpods', PointerCommand.move([0, 0], 'main'), staleGen) === null, 'stale generation');
    assert(r.emit('airpods', PointerCommand.move([0, 0], 'main'), liveMeta(r, 3.1, 4)), 'new generation move');
    r.disconnect();
    assert(r.emit('airpods', PointerCommand.move([0, 0], 'main'), liveMeta(r, 4, 5)) === null, 'disconnected');
    try { r.select('both'); assert(false, 'invalid source'); }
    catch { assert(true, 'invalid source throws'); }
});

test('clock-sensor-vs-receiver', () => {
    const c = new MotionClock({staleSeconds: 0.5});
    assert(c.accept({sensorStamp: 1, hostReceived: 10, receiverNow: 10.1, sequence: 1}).ok, 'first ok');
    assert(c.accept({sensorStamp: 1, hostReceived: 10.2, receiverNow: 10.2, sequence: 2}).reason === 'order-or-replay', 'replay stamp');
    assert(c.accept({sensorStamp: 2, hostReceived: 10.2, receiverNow: 10.2, sequence: 1}).reason === 'order-or-replay', 'replay sequence');
    assert(c.accept({sensorStamp: 2, hostReceived: 10, receiverNow: 11, sequence: 3}).reason === 'stale-host', 'stale host');
    assert(c.accept({sensorStamp: 3, hostReceived: 12, receiverNow: 12, sequence: 4}).ok, 'later ok');
    assert(c.accept({sensorStamp: NaN, hostReceived: 12, receiverNow: 12, sequence: 5}).reason === 'invalid-stamp', 'nan stamp');
    assert(c.accept({sensorStamp: 4, hostReceived: 12, sequence: 6}).reason === 'missing-receiver-now', 'now required');
    assert(c.accept({sensorStamp: 5, hostReceived: 13, receiverNow: 13, sequence: 7, sensorAgeSeconds: 2}).reason === 'stale-sensor', 'stale sensor age');
    assert(c.accept({sensorStamp: 6, hostReceived: 14, receiverNow: 14, sequence: 8, sensorAgeSeconds: -1}).reason === 'sensor-in-future', 'future sensor');
});

test('cal-all-four-corners-and-skewed', () => {
    const nq = [1, 0, 0, 0];
    const corners = cornersFromAngularOffsets({left: 0.3, right: 0.3, up: 0.25, down: 0.25});
    assert(validateCorners(corners) == null, 'rectangle ok');
    const grip = new CornerGrip({wrist: 'left', crown: 'right', neutralQ: nq, corners});
    const mid = grip.point(nq);
    assert(mid.ok && Math.abs(mid.u - 0.5) < 0.05 && Math.abs(mid.v - 0.5) < 0.05, `center ${mid.u},${mid.v}`);
    const tl = grip.point(qPoint(-0.3, 0.25));
    const tr = grip.point(qPoint(0.3, 0.25));
    const bl = grip.point(qPoint(-0.3, -0.25));
    const br = grip.point(qPoint(0.3, -0.25));
    assert(tl.ok && tl.u < 0.08 && tl.v < 0.08, `TL ${tl.u},${tl.v}`);
    assert(tr.ok && tr.u > 0.92 && tr.v < 0.08, `TR ${tr.u},${tr.v}`);
    assert(bl.ok && bl.u < 0.08 && bl.v > 0.92, `BL ${bl.u},${bl.v}`);
    assert(br.ok && br.u > 0.92 && br.v > 0.92, `BR ${br.u},${br.v}`);
    assert(tl.residual < 1e-6 && br.residual < 1e-6, 'residuals');
    const outside = grip.point(qPoint(0.8, 0));
    assert(outside.ok && outside.clamped && outside.u === 1, 'clamp out of range');

    const skewed = {
        tl: {ax: -0.4, ay: 0.22}, tr: {ax: 0.35, ay: 0.28},
        bl: {ax: -0.28, ay: -0.32}, br: {ax: 0.42, ay: -0.18}
    };
    assert(validateCorners(skewed) == null, `skewed convex ${validateCorners(skewed)}`);
    const sg = new CornerGrip({wrist: 'left', crown: 'right', neutralQ: nq, corners: skewed});
    const sTL = sg.point(qPoint(skewed.tl.ax, skewed.tl.ay));
    const sBR = sg.point(qPoint(skewed.br.ax, skewed.br.ay));
    assert(sTL.ok && sTL.u < 0.1 && sTL.v < 0.1, `skewed TL ${sTL.u},${sTL.v}`);
    assert(sBR.ok && sBR.u > 0.9 && sBR.v > 0.9, `skewed BR ${sBR.u},${sBR.v}`);
});

test('cal-concave-cross-near-singular-residual', () => {
    assert(validateCorners({
        tl: {ax: 0.3, ay: 0.2}, tr: {ax: -0.3, ay: 0.2},
        bl: {ax: -0.3, ay: -0.2}, br: {ax: 0.3, ay: -0.2}
    }) === 'badly-ordered-horizontal', 'badly ordered');
    const crossed = {
        tl: {ax: -0.3, ay: 0.2}, tr: {ax: 0.3, ay: -0.05},
        bl: {ax: -0.3, ay: -0.2}, br: {ax: 0.3, ay: 0.2}
    };
    const cr = validateCorners(crossed);
    assert(cr === 'crossed-quad' || cr === 'badly-ordered-vertical' || cr === 'concave-or-folded', `crossed ${cr}`);
    const concave = {
        tl: {ax: -0.3, ay: 0.25}, tr: {ax: 0.3, ay: 0.25},
        bl: {ax: 0.0, ay: 0.10}, br: {ax: 0.3, ay: -0.25}
    };
    assert(validateCorners(concave) === 'concave-or-folded', `concave ${validateCorners(concave)}`);
    assert(validateCorners({
        tl: {ax: 0, ay: 0}, tr: {ax: 0.001, ay: 0}, bl: {ax: 0, ay: 0.001}, br: {ax: 0.001, ay: 0.001}
    }) === 'corners-too-close', 'too close');
    const skinny = {
        tl: {ax: -0.2, ay: 0.09}, tr: {ax: 0.2, ay: 0.09},
        bl: {ax: -0.2, ay: 0}, br: {ax: 0.2, ay: 0}
    };
    const sk = validateCorners(skinny);
    assert(sk === 'near-singular' || sk === 'degenerate-turn', `skinny ${sk}`);
    const bowtie = inverseBilinear([0.5, 0.5], [0, 0], [1, 1], [1, 0], [0, 1]);
    assert(bowtie == null, 'crossed inverse rejected');
});

test('cal-quaternion-wrap-and-wrist', () => {
    const wrap = canonicalQuaternion([-0.5, 0.5, 0.5, 0.5]);
    const wrap2 = canonicalQuaternion([0.5, -0.5, -0.5, -0.5]);
    assert(wrap && wrap2 && wrap.every((c, i) => Math.abs(c - wrap2[i]) < 1e-12), 'q wrap');
    const nq = [1, 0, 0, 0];
    const store = new WristNeutralStore();
    store.setNeutral('left', typicalCrown('left'), nq);
    store.setNeutral('right', typicalCrown('right'), nq);
    const leftA = relativeAngles(nq, qPoint(0.2, 0), 'left', 'right');
    const rightA = relativeAngles(nq, qPoint(0.2, 0), 'right', 'left');
    assert(leftA.ax > 0 && rightA.ax < 0, 'per-wrist flip');
    assert(store.get('left', 'left') == null, 'missing crown');
});

test('display-cgevent-y-down-all-corners-negative-origin', () => {
    const main = {id: 'main', originX: 0, originY: 0, width: 1920, height: 1080};
    const side = {id: 'side', originX: -1920, originY: -200, width: 1920, height: 1200};
    const tl = toEvent(0, 0, main);
    const tr = toEvent(1, 0, main);
    const bl = toEvent(0, 1, main);
    const br = toEvent(1, 1, main);
    assert(tl.ok && tl.x === 1 && tl.y === 1, `TL ${tl.x},${tl.y}`);
    assert(tr.ok && tr.x === 1919 && tr.y === 1, `TR ${tr.x},${tr.y}`);
    assert(bl.ok && bl.x === 1 && bl.y === 1079, `BL ${bl.x},${bl.y}`);
    assert(br.ok && br.x === 1919 && br.y === 1079, `BR ${br.x},${br.y}`);
    const negTL = toEvent(0, 0, side);
    const negBR = toEvent(1, 1, side);
    assert(negTL.ok && negTL.x === -1919 && negTL.y === -199, `neg TL ${negTL.x},${negTL.y}`);
    assert(negBR.ok && negBR.x === -1 && negBR.y === 999, `neg BR ${negBR.x},${negBR.y}`);
    const back = fromEvent(negTL.x, negTL.y, side);
    assert(back.ok && Math.abs(back.u) < 1e-9 && Math.abs(back.v) < 1e-9, 'roundtrip TL');
    const mirrorA = {id: 'm1', originX: 0, originY: 0, width: 1920, height: 1080, mirroredGroup: 'desk'};
    const mirrorB = {id: 'm2', originX: 0, originY: 0, width: 1920, height: 1080, mirroredGroup: 'desk'};
    assert(logicalTarget([mirrorA, mirrorB], {mirroredGroup: 'desk'}).id === 'm1', 'descriptor not OS discovery');
    assert(logicalTarget([main, side], {preferredId: 'side'}).id === 'side', 'second display');
    assert(toEvent(NaN, 0, main).ok === false && toEvent(NaN, 0, main).reason === 'nonfinite', 'NaN reject not edge');
    assert(fromEvent(Infinity, 1, main).ok === false, 'nonfinite fromEvent');
    const clamped = toEvent(2, -1, main);
    assert(clamped.ok && clamped.clamped && clamped.x === 1919 && clamped.y === 1, 'finite oob clamped');
});

function quiet(g, t0, n = 8, dt = 0.02) {
    for (let i = 1; i <= n; i++) {
        g.feed({t: t0 + i * dt, yaw: 0, pitch: 0, roll: 0, yawRate: 0.05, pitchRate: 0.05, rollRate: 0});
    }
    return t0 + n * dt;
}

test('gestures-startup-suppress-ordinary-pointing', () => {
    const g = new WatchGestureDetector();
    const startup = g.feed({t: 0.02, yaw: 0, pitch: 0, roll: 0, yawRate: 0.1, pitchRate: 8, rollRate: 0});
    assert(!startup.events.some(e => e.type === 'click'), 'startup high pitch no click');
    assert(startup.mode === 'suppress', 'startup suppress');
    quiet(g, 0.02);
    let clicks = 0, swipes = 0;
    for (let i = 1; i <= 20; i++) {
        const r = g.feed({t: 0.3 + i * 0.02, yaw: i * 0.002, pitch: 0, roll: 0, yawRate: 0.1, pitchRate: 0.1, rollRate: 0});
        clicks += r.events.filter(e => e.type === 'click').length;
        swipes += r.events.filter(e => e.type === 'swipe').length;
    }
    assert(clicks === 0 && swipes === 0, 'ordinary pointing silent');
});

test('gestures-click-release-hysteresis-not-sustained', () => {
    const g = new WatchGestureDetector();
    const t0 = quiet(g, 0);
    const poke = g.feed({t: t0 + 0.02, yaw: 0, pitch: 0, roll: 0, yawRate: 0.2, pitchRate: 6, rollRate: 0});
    assert(poke.events.some(e => e.type === 'click'), 'rising click');
    let extra = 0;
    for (let i = 1; i <= 30; i++) {
        const r = g.feed({t: t0 + 0.02 + i * 0.05, yaw: 0, pitch: 0, roll: 0, yawRate: 0.2, pitchRate: 6, rollRate: 0});
        extra += r.events.filter(e => e.type === 'click').length;
    }
    assert(extra === 0, `sustained pitch retrigger ${extra}`);
    const tRelease = t0 + 0.02 + 31 * 0.05;
    g.feed({t: tRelease, yaw: 0, pitch: 0, roll: 0, yawRate: 0.1, pitchRate: 0.4, rollRate: 0});
    g.feed({t: tRelease + 0.05, yaw: 0, pitch: 0, roll: 0, yawRate: 0.1, pitchRate: 0.2, rollRate: 0});
    const again = g.feed({t: tRelease + 0.10, yaw: 0, pitch: 0, roll: 0, yawRate: 0.2, pitchRate: 6, rollRate: 0});
    assert(again.events.some(e => e.type === 'click'), 'click after release');
});

test('gestures-resume-and-gap-suppress', () => {
    const g = new WatchGestureDetector();
    quiet(g, 0);
    g.pauseImmediately();
    g.resume();
    const after = g.feed({t: 5, yaw: 0, pitch: 0, roll: 0, yawRate: 0.1, pitchRate: 9, rollRate: 0});
    assert(!after.events.some(e => e.type === 'click') && after.mode === 'suppress', 'resume suppress');
    const g2 = new WatchGestureDetector();
    const t0 = quiet(g2, 0);
    g2.feed({t: t0 + 0.02, yaw: 0, pitch: 0, roll: 0, yawRate: 0.1, pitchRate: 0.1, rollRate: 0});
    const gapped = g2.feed({t: t0 + 1.5, yaw: 0, pitch: 0, roll: 0, yawRate: 0.1, pitchRate: 8, rollRate: 0});
    assert(!gapped.events.some(e => e.type === 'click'), 'gap suppress');
});

test('gestures-swipe-left-right-wrap-disagree', () => {
    assert(Math.abs(wrapDelta(3.0, -3.0) - ( -3.0 - 3.0 + 2 * Math.PI)) < 1e-9, 'wrap shortest');
    const right = new WatchGestureDetector();
    let t = quiet(right, 0);
    let dir = null;
    for (let i = 1; i <= 10; i++) {
        t += 0.01;
        const r = right.feed({t, yaw: i * 0.05, pitch: 0, roll: 0, yawRate: 5, pitchRate: 0.2, rollRate: 0});
        const sw = r.events.find(e => e.type === 'swipe');
        if (sw) dir = sw.direction;
    }
    assert(dir === 'right', `swipe right ${dir}`);

    const left = new WatchGestureDetector();
    t = quiet(left, 0);
    dir = null;
    for (let i = 1; i <= 10; i++) {
        t += 0.01;
        const r = left.feed({t, yaw: -i * 0.05, pitch: 0, roll: 0, yawRate: -5, pitchRate: 0.2, rollRate: 0});
        const sw = r.events.find(e => e.type === 'swipe');
        if (sw) dir = sw.direction;
    }
    assert(dir === 'left', `swipe left ${dir}`);

    const wrap = new WatchGestureDetector();
    t = quiet(wrap, 0);
    wrap.feed({t: t + 0.02, yaw: 3.0, pitch: 0, roll: 0, yawRate: 5, pitchRate: 0.1, rollRate: 0});
    const falseFire = wrap.feed({t: t + 0.04, yaw: -3.0, pitch: 0, roll: 0, yawRate: 5, pitchRate: 0.1, rollRate: 0});
    assert(!falseFire.events.some(e => e.type === 'swipe'), 'raw wrap subtraction must not swipe');

    const disagree = new WatchGestureDetector();
    t = quiet(disagree, 0);
    let fired = false;
    for (let i = 1; i <= 10; i++) {
        t += 0.01;
        const r = disagree.feed({t, yaw: i * 0.05, pitch: 0, roll: 0, yawRate: -5, pitchRate: 0.2, rollRate: 0});
        if (r.events.some(e => e.type === 'swipe')) fired = true;
    }
    assert(!fired, 'rate vs displacement disagree');
});

test('gestures-turnover-pause', () => {
    const tdet = new WatchGestureDetector();
    quiet(tdet, 0);
    const on = tdet.feed({t: 1, yaw: 0, pitch: 0, roll: 2.2, yawRate: 0, pitchRate: 0, rollRate: 0});
    const hold = tdet.feed({t: 1.1, yaw: 0, pitch: 0, roll: 1.6, yawRate: 0, pitchRate: 0, rollRate: 0});
    const off = tdet.feed({t: 1.2, yaw: 0, pitch: 0, roll: 1.0, yawRate: 0, pitchRate: 0, rollRate: 0});
    assert(on.events.some(e => e.type === 'turnover') && hold.turnover && !off.turnover, 'turnover hysteresis');
    tdet.pauseImmediately();
    const paused = tdet.feed({t: 2, yaw: 0, pitch: 0, roll: 0, yawRate: 0, pitchRate: 9, rollRate: 0});
    assert(paused.paused && paused.events.length === 0, 'immediate pause');
});

function makeHand({userId = 'user-local-a', sessionId = 'sess-1', label = 'open', sequence = 0, tMono = 0, strapFit = 'snug', wristPosition = 'neutral', features}) {
    return {
        schemaVersion: HAND_STATE_SCHEMA_VERSION,
        userId, sessionId, label, sequence, tMono,
        units: HAND_UNITS,
        coordinateFrame: HAND_COORDINATE_FRAME,
        wrist: 'left', wristPosition, strapFit,
        features
    };
}

function cluster(label, n, sessionId, base, amp, t0, seq0 = 0) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        const j = ((i % 5) - 2) * amp;
        rows.push(makeHand({
            label, sessionId, sequence: seq0 + i, tMono: t0 + i * 1,
            features: feats(
                Math.max(0, base.accelMagMean + j),
                Math.max(0, base.gyroMagMean + j * 0.2),
                Math.max(0, base.accelMagVar + Math.abs(j) * 0.0002),
                Math.max(0, base.gyroMagVar + Math.abs(j) * 0.0002)
            )
        }));
    }
    return rows;
}

const openF = feats(0.04, 0.2, 0.0004, 0.002);
const fistF = feats(0.55, 2.4, 0.04, 0.12);
const restF = feats(0.22, 1.0, 0.01, 0.03);

function allClassSessions() {
    const out = [];
    for (const sess of ['sess-1', 'sess-2', 'sess-3']) {
        const t = Number(sess.slice(-1)) * 1000;
        let seq = 0;
        out.push(...cluster('open', 25, sess, openF, 0.002, t, seq)); seq += 25;
        out.push(...cluster('fist', 25, sess, fistF, 0.004, t + 30, seq)); seq += 25;
        out.push(...cluster('rest', 25, sess, restF, 0.003, t + 60, seq));
    }
    return out;
}

test('hand-session-heldout-train-eval-all-classes', () => {
    const all = allClassSessions();
    const split = splitBySession(all);
    assert(split.heldOutSession === 'sess-3', 'held sess-3');
    assert(split.test.every(s => s.sessionId === 'sess-3'), 'test is session not rows');
    assert(split.train.every(s => s.sessionId !== 'sess-3'), 'train excludes held');
    assert(new Set(split.test.map(s => s.label)).size === 3, 'heldout has all classes');
    const clf = new HandStateClassifier({minPerClass: 20, minSessionsPerClass: 2, cooldown: 0});
    const report = clf.train(split.train);
    assert(report.some(r => r.status === 'ready'), `train ${JSON.stringify(report)}`);
    clf.arm();
    const evaled = evaluateHeldOut(clf, split.test);
    const opens = evaled.byLabel.open.filter(g => g.label === 'open').length;
    const fists = evaled.byLabel.fist.filter(g => g.label === 'closed').length;
    const rests = evaled.byLabel.rest.filter(g => g.label === 'UNKNOWN').length;
    assert(opens === split.test.filter(s => s.label === 'open').length, `heldout open ${opens}`);
    assert(fists === split.test.filter(s => s.label === 'fist').length, `heldout fist ${fists}`);
    assert(rests === split.test.filter(s => s.label === 'rest').length, `heldout rest UNKNOWN ${rests}`);
});

test('hand-rest-collision-insufficient-nonseparable', () => {
    const collide = [
        ...cluster('open', 25, 'sess-1', openF, 0.002, 0),
        ...cluster('fist', 25, 'sess-1', fistF, 0.004, 30),
        ...cluster('rest', 25, 'sess-1', openF, 0.002, 60),
        ...cluster('open', 25, 'sess-2', openF, 0.002, 100),
        ...cluster('fist', 25, 'sess-2', fistF, 0.004, 130),
        ...cluster('rest', 25, 'sess-2', openF, 0.002, 160)
    ];
    const c1 = new HandStateClassifier({minPerClass: 20, minSessionsPerClass: 2});
    const r1 = c1.train(collide);
    c1.arm();
    assert(r1.some(r => r.status === 'nonseparable'), `REST=OPEN ${JSON.stringify(r1)}`);
    const inf = c1.infer(makeHand({sessionId: 'sess-9', sequence: 0, tMono: 10, features: openF}), {now: 10});
    assert(inf.label === 'UNKNOWN', 'REST=OPEN infer UNKNOWN');

    const noRest = [
        ...cluster('open', 25, 'sess-1', openF, 0.002, 0),
        ...cluster('fist', 25, 'sess-1', fistF, 0.004, 30),
        ...cluster('open', 25, 'sess-2', openF, 0.002, 100),
        ...cluster('fist', 25, 'sess-2', fistF, 0.004, 130)
    ];
    const c2 = new HandStateClassifier({minPerClass: 20, minSessionsPerClass: 2});
    const r2 = c2.train(noRest);
    c2.arm();
    assert(r2.some(r => r.status === 'insufficient'), `insufficient REST ${JSON.stringify(r2)}`);
    assert(c2.infer(makeHand({sessionId: 'sess-9', sequence: 0, tMono: 10, features: openF}), {now: 10}).label === 'UNKNOWN', 'insufficient UNKNOWN');
});

test('hand-freshness-units-window-local-log', () => {
    const all = allClassSessions().filter(s => s.sessionId !== 'sess-3');
    const clf = new HandStateClassifier({minPerClass: 20, minSessionsPerClass: 2, cooldown: 0});
    clf.train(all);
    clf.arm();
    assert(clf.infer(makeHand({sessionId: 'sess-9', sequence: 0, tMono: 10, features: openF})).reason === 'missing-receiver-now', 'now required');
    assert(clf.infer(makeHand({sessionId: 'sess-9', sequence: 0, tMono: 50, features: openF}), {now: 10}).reason === 'future', 'future');
    const a = clf.infer(makeHand({sessionId: 'sess-9', sequence: 1, tMono: 20, features: openF}), {now: 20});
    assert(a.label === 'open', `open ${a.reason}`);
    assert(clf.infer(makeHand({sessionId: 'sess-9', sequence: 1, tMono: 21, features: fistF}), {now: 21}).reason === 'replay-or-order', 'replay seq');
    assert(clf.infer(makeHand({sessionId: 'sess-9', sequence: 2, tMono: 19, features: fistF}), {now: 22}).reason === 'replay-or-order', 'out of order t');
    const closed = clf.infer(makeHand({sessionId: 'sess-9', sequence: 3, tMono: 23, features: fistF}), {now: 23});
    assert(closed.label === 'closed' && closed.action === null, 'fist=>closed');
    const rest = clf.infer(makeHand({sessionId: 'sess-9', sequence: 4, tMono: 24, features: restF}), {now: 24});
    assert(rest.label === 'UNKNOWN', `rest ${rest.reason}`);
    assert(clf.infer(makeHand({sessionId: 'sess-9', sequence: 5, tMono: 25, features: openF}), {now: 200}).reason === 'stale', 'stale');
    assert(clf.infer(makeHand({userId: 'user-local-b', sessionId: 'sess-9', sequence: 6, tMono: 30, features: openF}), {now: 30}).reason === 'untrained', 'new user');
    assert(clf.infer(makeHand({strapFit: 'loose', sessionId: 'sess-9', sequence: 7, tMono: 31, features: openF}), {now: 31}).label === 'UNKNOWN', 'new context');
    const mid = feats((openF.accelMagMean + fistF.accelMagMean) / 2, (openF.gyroMagMean + fistF.gyroMagMean) / 2);
    assert(clf.infer(makeHand({sessionId: 'sess-9', sequence: 8, tMono: 32, features: mid}), {now: 32}).label === 'UNKNOWN', 'noisy midpoint');
    assert(validateSample(makeHand({tMono: 1, features: feats(NaN, 1)})) === 'nonfinite-feature', 'NaN');
    assert(validateSample(makeHand({tMono: 1, features: feats(-1, 1)})) === 'nonfinite-feature', 'negative domain');
    const win = featuresFromWindow([
        {userAcceleration: {x: 0.04, y: 0, z: 0}, rotationRate: {x: 0.2, y: 0, z: 0}},
        {userAcceleration: {x: 0.05, y: 0, z: 0}, rotationRate: {x: 0.21, y: 0, z: 0}},
        {userAcceleration: {x: 0.03, y: 0, z: 0}, rotationRate: {x: 0.19, y: 0, z: 0}},
        {userAcceleration: {x: 0.04, y: 0, z: 0}, rotationRate: {x: 0.2, y: 0, z: 0}}
    ]);
    assert(win.ok && win.features.accelMagVar >= 0 && HAND_FEATURE_KEYS.every(k => k in win.features), 'windowed variance');
    assert(HAND_UNITS.gyro === 'rad_per_s', 'gyro rad/s not deg/s');
    const log = new LocalHandLog();
    let hooked = 0;
    log.onStream(() => {hooked++;});
    assert(log.append(all[0]).ok && hooked === 1, 'local log');
    assert(log.append({...all[0], userId: 'not-pseudo'}).ok === false, 'reject non-pseudo');
    const router = new PointerSourceRouter();
    const before = router.totalEmits();
    clf.infer(makeHand({sessionId: 'sess-9', sequence: 9, tMono: 40, features: openF}), {now: 40});
    assert(router.totalEmits() === before, 'not wired to router');
    assert(contextKey({wrist: 'left', wristPosition: 'neutral', strapFit: 'snug'}) === 'left|neutral|snug', 'context key');
});

test('draft-guards', () => {
    assert(HAND_STATE_SCHEMA_VERSION === 2, 'schema v2');
    assert(typicalCrown('left') === 'right' && typicalCrown('right') === 'left', 'typical crown');
});

const failed = cases.filter(c => !c.ok);
for (const c of cases) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : ' — ' + c.error}`);
}
console.log(`Cases: ${cases.filter(c => c.ok).length} passed, ${failed.length} failed, ${cases.length} total`);
console.log(`Assertions: ${assertions - assertionFails} passed, ${assertionFails} failed`);
if (failed.length) {
    process.exit(1);
}
console.log('PASS: isolated adversarial suite (not hardware / not physiology)');
process.exit(0);
