#!/usr/bin/env node
// Hardware-free suite. No Apple SDK, no app launch. Exit 0 on all pass.

import {Orientation, Grip, norm, rotation, multiply, inverse} from '../../Sources/AirPointer/Session/Orientation.js';
import {PointerSourceRouter, PointerCommand} from '../../Sources/PointerAdapter/pointerRouter.js';
import {MotionClock} from '../../Sources/WatchCalibration/motionClock.js';
import {relativeAngles, WristNeutralStore, canonicalQuaternion, typicalCrown} from '../../Sources/WatchCalibration/wristNeutral.js';
import {CornerGrip, validateCorners, cornersFromAngularOffsets, inverseBilinear} from '../../Sources/WatchCalibration/cornerCalibration.js';
import {toCG, fromCG, logicalTarget, clamp01} from '../../Sources/WatchCalibration/displayMapping.js';
import {WatchGestureDetector} from '../../Sources/WatchGestures/watchGestures.js';
import {
    HAND_STATE_SCHEMA_VERSION, HAND_UNITS, HAND_COORDINATE_FRAME,
    validateSample, splitBySession, LocalHandLog, HandStateClassifier, contextKey
} from '../../Sources/WatchHandState/handState.js';

let passed = 0, failed = 0;
const failures = [];

function assert(cond, msg) {
    if (cond) passed++;
    else {failed++; failures.push(msg);}
}

function qPoint(ax, ay) {
    const theta = Math.hypot(ax, ay);
    if (theta < 1e-12) return [1, 0, 0, 0];
    const s = Math.sin(theta / 2), c = Math.cos(theta / 2);
    return [c, (ax / theta) * s, (ay / theta) * s, 0];
}

function unitAirpodsRegression() {
    let seq = 0, stamp = 1_000_000;
    const o = new Orientation();
    function sample(g, w) {
        stamp += 20_000;
        o.feed([++seq, 11, stamp, stamp / 1e6, ...g.map(x => Math.round(x * 1e5))]);
        o.feed([++seq, 12, stamp + 3759, stamp / 1e6, ...w.map(x => Math.round(x * 1e5))]);
    }
    for (let i = 0; i < 110; i++) sample([0, 0, 1], [0.8, -0.3, 0.4]);
    for (let i = 0; i < 50; i++) sample([0, 0, 1], [0.8, -0.3, 30.4]);
    assert(o.ready === true, 'airpods: fusion ready');
    const degrees = norm(rotation(o.q)) * 180 / Math.PI;
    assert(Math.abs(degrees - 30) < 0.04, `airpods: 30deg integration got ${degrees}`);

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
    assert(dropped.generation === 1, 'airpods: short drop holds generation');
    assert(Math.abs(shortDeg - 29.4) < 0.1, `airpods: short drop angle ${shortDeg}`);
    stamp += 2_500_000;
    sample2([0, 0, 1], [0, 0, 0]);
    assert(dropped.generation === 2, 'airpods: long drop resets');

    const saved = {right: [0.3, 0, 0], up: [0, 0.3, 0], gravity: [0, 0, 1]};
    const grip = new Grip(saved);
    assert(grip.recenter([1, 0, 0, 0], [0, 0, 1]) === true, 'airpods: recenter kept');
    const center = grip.point([1, 0, 0, 0]);
    const right = grip.point([Math.cos(0.075), Math.sin(0.075), 0, 0]);
    assert(center && Math.abs(center[0] - 0.5) < 1e-6 && Math.abs(center[1] - 0.5) < 1e-6, 'airpods: center 0.5,0.5');
    assert(right && Math.abs(right[0] - 0.75) < 1e-6 && Math.abs(right[1] - 0.5) < 1e-6, 'airpods: right 0.75,0.5');
    assert(new Grip({right: [0.3, 0, 0], up: [0.3, 0.01, 0], gravity: [0, 0, 1]}).edges === null, 'airpods: parallel edges rejected');
    assert(new Grip(saved).recenter([Math.SQRT1_2, Math.SQRT1_2, 0, 0], [0, 0, 1]) === false, 'airpods: different hold refuses saved edges');
    assert(new Grip().edges === null, 'airpods: fresh grip has no edges');

    let stamp3 = 1_000_000, seq3 = 0;
    function sampleSeed(o, g, w) {
        stamp3 += 5000;
        o.feed([++seq3, 11, stamp3, stamp3 / 1e6, ...g.map(x => Math.round(x * 1e5))]);
        o.feed([++seq3, 12, stamp3 + 1000, stamp3 / 1e6, ...w.map(x => Math.round(x * 1e5))]);
    }
    const seeded = new Orientation({bias: [0.5, 0.7, -0.2], gravity: [1, 0, 0]});
    sampleSeed(seeded, [0, 0, 1], [0.5, 0.7, -0.2]);
    assert(seeded.ready === true && seeded.seedUsed === true && seeded.measured === 0, 'airpods: saved offset applies at once');
    for (let i = 0; i < 500; i++) sampleSeed(seeded, [0, 0, 1], [0.6, 0.7, -0.2]);
    assert(Math.abs(seeded.bias[0] - 0.55) < 0.005 && seeded.measured === 1, 'airpods: later offset moves gently');
    const freshO = new Orientation();
    let readyAt = null;
    for (let i = 0; i < 400 && readyAt === null; i++) {
        const k = Math.sin(i * 0.55) * 0.5;
        sampleSeed(freshO, [0, 0, 1], [0.4 + k, 0.7 - k, -0.2 + k * 0.5]);
        if (freshO.ready) readyAt = i * 0.005;
    }
    assert(readyAt != null && readyAt < 1.5, `airpods: first handheld offset ${readyAt}`);
    assert(Math.abs(freshO.bias[0] - 0.4) < 0.1 && Math.abs(freshO.bias[1] - 0.7) < 0.1 && Math.abs(freshO.bias[2] + 0.2) < 0.1, 'airpods: first offset near hold');
}

function unitRouter() {
    const r = new PointerSourceRouter();
    assert(r.allows('airpods') && !r.allows('watch'), 'router: default airpods');
    const a = r.emit('airpods', PointerCommand.move([0.2, 0.3], 'main'));
    const w = r.emit('watch', PointerCommand.move([0.9, 0.9], 'main'));
    assert(a && a.kind === 'move' && w === null, 'router: exclusive airpods');
    r.select('watch');
    assert(r.emit('airpods', PointerCommand.click('left', [0.1, 0.1])) === null, 'router: airpods blocked after switch');
    assert(r.emit('watch', PointerCommand.click('left', [0.1, 0.1])), 'router: watch after switch');
    r.pauseImmediately();
    assert(r.emit('watch', PointerCommand.move([0, 0], 'main')) === null, 'router: pause blocks');
    r.resume();
    assert(r.emit('watch', PointerCommand.pause()), 'router: resume');
    assert(r.emitCount.airpods === 1 && r.emitCount.watch === 2, 'router: no double-count from blocked');
    try { r.select('both'); assert(false, 'router: invalid source'); }
    catch { assert(true, 'router: invalid source throws'); }
}

function unitClock() {
    const c = new MotionClock({staleSeconds: 0.5});
    assert(c.accept({stamp: 1, host: 10, now: 10.1}).ok, 'clock: first ok');
    assert(c.accept({stamp: 1, host: 10.2, now: 10.2}).reason === 'order-or-replay', 'clock: replay');
    assert(c.accept({stamp: 0.5, host: 10.2, now: 10.2}).reason === 'order-or-replay', 'clock: out of order');
    assert(c.accept({stamp: 2, host: 10, now: 11}).reason === 'stale', 'clock: stale');
    assert(c.accept({stamp: 3, host: 12, now: 12}).ok, 'clock: later ok');
    assert(c.accept({stamp: NaN, host: 12, now: 12}).reason === 'invalid-stamp', 'clock: nan');
}

function unitCalibration() {
    const nq = [1, 0, 0, 0];
    const corners = cornersFromAngularOffsets({left: 0.3, right: 0.3, up: 0.25, down: 0.25});
    assert(validateCorners(corners) == null, 'cal: rectangle ok');
    const grip = new CornerGrip({wrist: 'left', crown: 'right', neutralQ: nq, corners});
    const mid = grip.point(nq);
    assert(mid.ok && Math.abs(mid.u - 0.5) < 0.05 && Math.abs(mid.v - 0.5) < 0.05, `cal: center got ${mid.u},${mid.v}`);
    const tl = grip.point(qPoint(-0.3, 0.25));
    assert(tl.ok && tl.u < 0.08 && tl.v < 0.08, `cal: TL got ${tl.u},${tl.v}`);
    const br = grip.point(qPoint(0.3, -0.25));
    assert(br.ok && br.u > 0.92 && br.v > 0.92, `cal: BR got ${br.u},${br.v}`);
    const outside = grip.point(qPoint(0.8, 0));
    assert(outside.ok && outside.clamped && outside.u === 1, 'cal: clamp out of range');

    const wrap = canonicalQuaternion([-0.5, 0.5, 0.5, 0.5]);
    const wrap2 = canonicalQuaternion([0.5, -0.5, -0.5, -0.5]);
    assert(wrap && wrap2 && wrap.every((c, i) => Math.abs(c - wrap2[i]) < 1e-12), 'cal: quaternion wrap');

    const store = new WristNeutralStore();
    store.setNeutral('left', typicalCrown('left'), nq);
    store.setNeutral('right', typicalCrown('right'), nq);
    const leftA = relativeAngles(nq, qPoint(0.2, 0), 'left', 'right');
    const rightA = relativeAngles(nq, qPoint(0.2, 0), 'right', 'left');
    assert(leftA.ax > 0 && rightA.ax < 0, 'cal: per-wrist horizontal flip');
    assert(store.get('left', 'left') == null, 'cal: missing crown context');

    assert(validateCorners({tl: {ax: 0.3, ay: 0.2}, tr: {ax: -0.3, ay: 0.2}, bl: {ax: -0.3, ay: -0.2}, br: {ax: 0.3, ay: -0.2}}) === 'badly-ordered-horizontal', 'cal: badly ordered');
    const crossed = {
        tl: {ax: -0.3, ay: 0.2}, tr: {ax: 0.3, ay: -0.05},
        bl: {ax: -0.3, ay: -0.2}, br: {ax: 0.3, ay: 0.2}
    };
    const crossReason = validateCorners(crossed);
    assert(crossReason === 'crossed-quad' || crossReason === 'badly-ordered-vertical', `cal: crossed/bad ${crossReason}`);
    assert(validateCorners({
        tl: {ax: 0, ay: 0}, tr: {ax: 0.001, ay: 0}, bl: {ax: 0, ay: 0.001}, br: {ax: 0.001, ay: 0.001}
    }) === 'corners-too-close', 'cal: degenerate close');

    const tlxy = [-0.3, 0.25], trxy = [0.3, 0.25], blxy = [-0.3, -0.25], brxy = [0.3, -0.25];
    const inv = inverseBilinear([0, 0], tlxy, trxy, blxy, brxy);
    assert(inv && Math.abs(inv.u - 0.5) < 1e-6 && Math.abs(inv.v - 0.5) < 1e-6, 'cal: inverse bilinear center');
}

function unitDisplay() {
    const main = {id: 'main', originX: 0, originY: 0, width: 1920, height: 1080};
    const side = {id: 'side', originX: -1920, originY: -200, width: 1920, height: 1200};
    const mirrorA = {id: 'm1', originX: 0, originY: 0, width: 1920, height: 1080, mirroredGroup: 'desk'};
    const mirrorB = {id: 'm2', originX: 0, originY: 0, width: 1920, height: 1080, mirroredGroup: 'desk'};
    const tl = toCG(0, 0, main);
    const br = toCG(1, 1, main);
    assert(tl.ok && Math.abs(tl.x - 1) < 1e-9 && Math.abs(tl.y - 1079) < 1e-9, `display: TL ${tl.x},${tl.y}`);
    assert(br.ok && Math.abs(br.x - 1919) < 1e-9 && Math.abs(br.y - 1) < 1e-9, `display: BR ${br.x},${br.y}`);
    const neg = toCG(0, 1, side);
    assert(neg.ok && neg.x === -1919 && neg.y === -199, `display: negative origin ${neg.x},${neg.y}`);
    const back = fromCG(neg.x, neg.y, side);
    assert(back.ok && Math.abs(back.u) < 1e-9 && Math.abs(back.v - 1) < 1e-9, 'display: roundtrip');
    const logical = logicalTarget([mirrorA, mirrorB], {mirroredGroup: 'desk'});
    assert(logical.id === 'm1', 'display: mirrored one logical');
    const chosen = logicalTarget([main, side], {preferredId: 'side'});
    assert(chosen.id === 'side', 'display: second display select');
    assert(toCG(2, -1, main).ok && toCG(2, -1, main).x === 1919, 'display: clamp');
    assert(clamp01(NaN) === 0, 'display: nan clamp');
}

function unitGestures() {
    const g = new WatchGestureDetector();
    let clicks = 0, swipes = 0, turns = 0;
    for (let i = 1; i <= 40; i++) {
        const r = g.feed({t: i * 0.02, yaw: i * 0.002, pitch: 0, roll: 0, yawRate: 0.1, pitchRate: 0.1, rollRate: 0});
        clicks += r.events.filter(e => e.type === 'click').length;
        swipes += r.events.filter(e => e.type === 'swipe').length;
    }
    assert(clicks === 0 && swipes === 0, 'gestures: ordinary pointing silent');

    const poke = g.feed({t: 1.0, yaw: 0.08, pitch: 0, roll: 0, yawRate: 0.2, pitchRate: 6, rollRate: 0});
    assert(poke.events.some(e => e.type === 'click'), 'gestures: poke click');
    const echo = g.feed({t: 1.1, yaw: 0.08, pitch: 0, roll: 0, yawRate: 0.2, pitchRate: 6, rollRate: 0});
    assert(!echo.events.some(e => e.type === 'click'), 'gestures: click cooldown');

    const s = new WatchGestureDetector();
    let dir = null;
    for (let i = 1; i <= 10; i++) {
        const r = s.feed({t: i * 0.01, yaw: i * 0.05, pitch: 0, roll: 0, yawRate: 5, pitchRate: 0.2, rollRate: 0});
        const sw = r.events.find(e => e.type === 'swipe');
        if (sw) dir = sw.direction;
    }
    assert(dir === 'right', `gestures: swipe right got ${dir}`);
    const suppressed = s.feed({t: 0.2, yaw: 0.5, pitch: 0, roll: 0, yawRate: 0.2, pitchRate: 8, rollRate: 0});
    assert(!suppressed.events.some(e => e.type === 'click'), 'gestures: swipe suppresses click');

    const tdet = new WatchGestureDetector();
    const on = tdet.feed({t: 1, yaw: 0, pitch: 0, roll: 2.2, yawRate: 0, pitchRate: 0, rollRate: 0});
    const hold = tdet.feed({t: 1.1, yaw: 0, pitch: 0, roll: 1.6, yawRate: 0, pitchRate: 0, rollRate: 0});
    const off = tdet.feed({t: 1.2, yaw: 0, pitch: 0, roll: 1.0, yawRate: 0, pitchRate: 0, rollRate: 0});
    assert(on.events.some(e => e.type === 'turnover') && hold.turnover && !off.turnover, 'gestures: turnover hysteresis');

    tdet.pauseImmediately();
    const paused = tdet.feed({t: 2, yaw: 0, pitch: 0, roll: 0, yawRate: 0, pitchRate: 9, rollRate: 0});
    assert(paused.paused && paused.events.length === 0, 'gestures: immediate pause');
}

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

function cluster(label, n, sessionId, base, jitter, t0) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        const j = () => (Math.random() - 0.5) * jitter;
        rows.push(makeHand({
            label, sessionId, sequence: i, tMono: t0 + i * 0.02,
            features: {
                accelMag: base.accelMag + j(),
                gyroMag: base.gyroMag + j() * 4,
                accelVar: base.accelVar + Math.abs(j()) * 0.01,
                gyroVar: base.gyroVar + Math.abs(j()) * 4
            }
        }));
    }
    return rows;
}

function unitHandState() {
    const openF = {accelMag: 0.04, gyroMag: 3, accelVar: 0.002, gyroVar: 10};
    const fistF = {accelMag: 0.55, gyroMag: 45, accelVar: 0.3, gyroVar: 2000};
    const restF = {accelMag: 0.22, gyroMag: 18, accelVar: 0.05, gyroVar: 320};
    const train = [
        ...cluster('open', 25, 'sess-1', openF, 0.01, 0),
        ...cluster('fist', 25, 'sess-1', fistF, 0.02, 10),
        ...cluster('rest', 25, 'sess-1', restF, 0.02, 20),
        ...cluster('open', 25, 'sess-2', openF, 0.01, 30),
        ...cluster('fist', 25, 'sess-2', fistF, 0.02, 40)
    ];
    const split = splitBySession([...train, ...cluster('open', 10, 'sess-3', openF, 0.01, 50)]);
    assert(split.heldOutSession === 'sess-3' && split.test.every(s => s.sessionId === 'sess-3'), 'hand: session split not random rows');
    assert(split.train.every(s => s.sessionId !== 'sess-3'), 'hand: train excludes held-out session');

    const log = new LocalHandLog();
    let hooked = 0;
    log.onStream(() => {hooked++;});
    assert(log.append(train[0]).ok && hooked === 1, 'hand: local log + hook');
    assert(log.append({...train[0], userId: 'not-pseudo'}).ok === false, 'hand: reject non-pseudonymous');

    const clf = new HandStateClassifier({minPerClass: 20, minSessionsPerClass: 2});
    const report = clf.train(train);
    assert(report.some(r => r.status === 'ready'), `hand: trained ${JSON.stringify(report)}`);
    const probeOpen = makeHand({label: 'rest', sessionId: 'sess-9', sequence: 0, tMono: 100, features: openF});
    assert(clf.infer(probeOpen, {now: 100}).reason === 'not-armed', 'hand: not armed');
    clf.arm();
    const got = clf.infer(probeOpen, {now: 100});
    assert(got.label === 'open' && got.action === null, `hand: infer open ${got.label} ${got.reason}`);
    const gotFist = clf.infer(makeHand({sessionId: 'sess-9', sequence: 1, tMono: 101, features: fistF}), {now: 101});
    assert(gotFist.label === 'closed' && gotFist.action === null, `hand: fist=>closed ${gotFist.label}`);
    const cool = clf.infer(makeHand({sessionId: 'sess-9', sequence: 2, tMono: 101.1, features: openF}), {now: 101.1});
    assert(cool.label === 'UNKNOWN' && cool.reason === 'cooldown', 'hand: cooldown no action');
    const rest = clf.infer(makeHand({sessionId: 'sess-9', sequence: 3, tMono: 102, features: restF}), {now: 102});
    assert(rest.label === 'UNKNOWN', `hand: rest is UNKNOWN not closed (${rest.reason})`);

    const otherUser = clf.infer(makeHand({userId: 'user-local-b', sessionId: 'sess-9', tMono: 110, features: openF}), {now: 110});
    assert(otherUser.label === 'UNKNOWN' && otherUser.reason === 'untrained', 'hand: new user UNKNOWN');
    const otherCtx = clf.infer(makeHand({strapFit: 'loose', sessionId: 'sess-9', tMono: 111, features: openF}), {now: 111});
    assert(otherCtx.label === 'UNKNOWN', 'hand: new context UNKNOWN');
    const stale = clf.infer(makeHand({sessionId: 'sess-9', sequence: 8, tMono: 50, features: openF}), {now: 200});
    assert(stale.label === 'UNKNOWN' && stale.reason === 'stale', 'hand: stale sample UNKNOWN');
    const midF = {
        accelMag: (openF.accelMag + fistF.accelMag) / 2,
        gyroMag: (openF.gyroMag + fistF.gyroMag) / 2,
        accelVar: (openF.accelVar + fistF.accelVar) / 2,
        gyroVar: (openF.gyroVar + fistF.gyroVar) / 2
    };
    const noisy = clf.infer(makeHand({sessionId: 'sess-9', sequence: 9, tMono: 210, features: midF}), {now: 210});
    assert(noisy.label === 'UNKNOWN', `hand: noisy/overlap transition UNKNOWN (${noisy.reason})`);
    const nanInf = clf.infer(makeHand({sessionId: 'sess-9', sequence: 10, tMono: 211, features: {accelMag: Infinity, gyroMag: 1, accelVar: 1, gyroVar: 1}}), {now: 211});
    assert(nanInf.label === 'UNKNOWN' && nanInf.reason === 'nonfinite-feature', 'hand: nonfinite infer UNKNOWN');

    const tiny = new HandStateClassifier();
    tiny.train(cluster('open', 5, 'sess-1', openF, 0.01, 0));
    tiny.arm();
    const insuff = tiny.infer(makeHand({tMono: 1, features: openF}), {now: 1});
    assert(insuff.label === 'UNKNOWN' && insuff.reason === 'insufficient', 'hand: insufficient calibration');

    const overlapSet = [
        ...cluster('open', 25, 'sess-1', openF, 0.2, 0),
        ...cluster('fist', 25, 'sess-1', openF, 0.2, 10),
        ...cluster('open', 25, 'sess-2', openF, 0.2, 20),
        ...cluster('fist', 25, 'sess-2', openF, 0.2, 30)
    ];
    const ov = new HandStateClassifier({minPerClass: 20, minSessionsPerClass: 2, overlapRatio: 0.9});
    const ovReport = ov.train(overlapSet);
    ov.arm();
    assert(ovReport.some(r => r.status === 'nonseparable'), `hand: overlap nonseparable ${JSON.stringify(ovReport)}`);
    const ovInf = ov.infer(makeHand({tMono: 200, features: openF}), {now: 200});
    assert(ovInf.label === 'UNKNOWN', 'hand: nonseparable => UNKNOWN');

    const bad = makeHand({tMono: 300, features: {accelMag: NaN, gyroMag: 1, accelVar: 1, gyroVar: 1}});
    assert(validateSample(bad) === 'nonfinite-feature', 'hand: NaN rejected');
    const miss = {...makeHand({tMono: 1, features: openF})};
    delete miss.features;
    assert(validateSample(miss) === 'features', 'hand: missing features');

    const router = new PointerSourceRouter();
    const before = router.totalEmits();
    clf.infer(probeOpen, {now: 400});
    assert(router.totalEmits() === before, 'hand: classifier not wired to pointer router');
    assert(contextKey({wrist: 'left', wristPosition: 'neutral', strapFit: 'snug'}) === 'left|neutral|snug', 'hand: context key');
}

function unitWatchDraftGuards() {
    assert(HAND_STATE_SCHEMA_VERSION === 1, 'draft: schema version pinned');
    assert(typicalCrown('left') === 'right' && typicalCrown('right') === 'left', 'draft: typical crown');
}

unitAirpodsRegression();
unitRouter();
unitClock();
unitCalibration();
unitDisplay();
unitGestures();
unitHandState();
unitWatchDraftGuards();

const total = passed + failed;
console.log(`Hardware-free tests: ${passed} passed, ${failed} failed, ${total} assertions`);
if (failures.length) {
    for (const f of failures) console.log('FAIL:', f);
    process.exit(1);
}
console.log('PASS: isolated pointer-core, gestures, calibration, exclusive router, AirPods Orientation.js regression, experimental hand-state');
process.exit(0);
