// Orientation-relative angular pointing. Four corner poses (TL/TR/BL/BR) in the
// plane of relative rotation vs a per-wrist/crown neutral quaternion.
// NOT hand translation / dead reckoning.
//
// Forward map (v=0 top, u=0 left):
//   P(u,v) = (1-u)(1-v) TL + u(1-v) TR + (1-u)v BL + uv BR
// Inverse: Newton on that map. Accept only when residual is small and Jacobian
// stays well-conditioned on the unit square. Convex non-degenerate quads only.

import {relativeAngles, calibrationKey} from './wristNeutral.js';

const MIN_CORNER_SEP = 5 * Math.PI / 180;
const MIN_TURN = 1e-4;
const MIN_JAC = 0.05;
const NEWTON_ITERS = 16;
const RESIDUAL_TOL = 1e-6;
const DIVERGE = 8;

function sub(a, b) {return [a[0] - b[0], a[1] - b[1]];}
function add(a, b) {return [a[0] + b[0], a[1] + b[1]];}
function scale(a, k) {return [a[0] * k, a[1] * k];}
function cross2(a, b) {return a[0] * b[1] - a[1] * b[0];}
function dist(a, b) {return Math.hypot(a[0] - b[0], a[1] - b[1]);}

function asXY(corner) {
    if (!corner || !Number.isFinite(corner.ax) || !Number.isFinite(corner.ay)) return null;
    return [corner.ax, corner.ay];
}

function segmentsIntersect(p, p2, q, q2) {
    const r = sub(p2, p), s = sub(q2, q);
    const den = cross2(r, s);
    if (Math.abs(den) < 1e-12) return false;
    const t = cross2(sub(q, p), s) / den;
    const u = cross2(sub(q, p), r) / den;
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

function bilinearTerms(tl, tr, bl, br) {
    const e = sub(tr, tl), f = sub(bl, tl), g = add(sub(tl, tr), sub(br, bl));
    return {a: tl, e, f, g};
}

function jacAt(u, v, e, f, g) {
    return cross2(e, f) + u * cross2(e, g) + v * cross2(g, f);
}

function bilinearP(u, v, a, e, f, g) {
    return add(a, add(scale(e, u), add(scale(f, v), scale(g, u * v))));
}

export function validateCorners(corners) {
    if (!corners) return 'missing-corners';
    const tl = asXY(corners.tl), tr = asXY(corners.tr), bl = asXY(corners.bl), br = asXY(corners.br);
    if (!tl || !tr || !bl || !br) return 'non-finite-corner';
    const pts = [tl, tr, bl, br];
    for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
            if (dist(pts[i], pts[j]) < MIN_CORNER_SEP) return 'corners-too-close';
        }
    }
    if (tl[0] >= tr[0] || bl[0] >= br[0]) return 'badly-ordered-horizontal';
    if (tl[1] <= bl[1] || tr[1] <= br[1]) return 'badly-ordered-vertical';
    if (segmentsIntersect(tl, tr, bl, br) || segmentsIntersect(tl, bl, tr, br)) return 'crossed-quad';

    // Strict convexity: TL→TR→BR→BL all left (or all right) turns.
    const turns = [
        cross2(sub(tr, tl), sub(br, tr)),
        cross2(sub(br, tr), sub(bl, br)),
        cross2(sub(bl, br), sub(tl, bl)),
        cross2(sub(tl, bl), sub(tr, tl))
    ];
    if (turns.some(t => !Number.isFinite(t) || Math.abs(t) < MIN_TURN)) return 'degenerate-turn';
    const sign = Math.sign(turns[0]);
    if (turns.some(t => Math.sign(t) !== sign)) return 'concave-or-folded';

    const {e, f, g} = bilinearTerms(tl, tr, bl, br);
    const jacs = [jacAt(0, 0, e, f, g), jacAt(1, 0, e, f, g), jacAt(0, 1, e, f, g), jacAt(1, 1, e, f, g)];
    if (jacs.some(j => !Number.isFinite(j))) return 'nonfinite-jacobian';
    const jSign = Math.sign(jacs[0]);
    if (jSign === 0 || jacs.some(j => Math.sign(j) !== jSign)) return 'singular-jacobian';
    const minJac = Math.min(...jacs.map(j => Math.abs(j)));
    if (minJac < MIN_JAC) return 'near-singular';
    return null;
}

export function inverseBilinear(p, tl, tr, bl, br) {
    if (!p || !tl || !tr || !bl || !br) return null;
    if (![p, tl, tr, bl, br].every(q => Number.isFinite(q[0]) && Number.isFinite(q[1]))) return null;
    const {a, e, f, g} = bilinearTerms(tl, tr, bl, br);
    let u = 0.5, v = 0.5, residual = Infinity, converged = false;
    for (let i = 0; i < NEWTON_ITERS; i++) {
        const Pu = add(e, scale(g, v));
        const Pv = add(f, scale(g, u));
        const pred = bilinearP(u, v, a, e, f, g);
        const r = sub(pred, p);
        residual = Math.hypot(r[0], r[1]);
        const det = cross2(Pu, Pv);
        if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
        u -= (r[0] * Pv[1] - r[1] * Pv[0]) / det;
        v -= (Pu[0] * r[1] - Pu[1] * r[0]) / det;
        if (!Number.isFinite(u) || !Number.isFinite(v) || Math.abs(u) > DIVERGE || Math.abs(v) > DIVERGE) return null;
        if (residual < RESIDUAL_TOL && i > 0) {
            converged = true;
            break;
        }
    }
    const pred = bilinearP(u, v, a, e, f, g);
    residual = Math.hypot(pred[0] - p[0], pred[1] - p[1]);
    if (!converged && residual >= RESIDUAL_TOL) return null;
    if (!Number.isFinite(residual) || residual >= RESIDUAL_TOL) return null;
    return {u, v, residual, converged: true};
}

export class CornerGrip {
    constructor({wrist, crown, neutralQ, corners}) {
        this.wrist = wrist;
        this.crown = crown;
        this.key = calibrationKey(wrist, crown);
        this.neutralQ = neutralQ;
        this.corners = corners;
        this.error = validateCorners(corners);
    }

    get ready() {return this.error == null && this.neutralQ != null;}

    anglesOf(q) {
        return relativeAngles(this.neutralQ, q, this.wrist, this.crown);
    }

    point(q) {
        if (!this.ready) return {ok: false, reason: this.error || 'not-ready', u: null, v: null, clamped: false};
        const ang = this.anglesOf(q);
        if (!ang) return {ok: false, reason: 'bad-quaternion', u: null, v: null, clamped: false};
        const tl = asXY(this.corners.tl), tr = asXY(this.corners.tr), bl = asXY(this.corners.bl), br = asXY(this.corners.br);
        const raw = inverseBilinear([ang.ax, ang.ay], tl, tr, bl, br);
        if (!raw) return {ok: false, reason: 'unsolvable', u: null, v: null, clamped: false};
        const clamped = raw.u < 0 || raw.u > 1 || raw.v < 0 || raw.v > 1;
        return {
            ok: true,
            reason: null,
            u: Math.min(1, Math.max(0, raw.u)),
            v: Math.min(1, Math.max(0, raw.v)),
            clamped,
            residual: raw.residual,
            roll: ang.roll
        };
    }
}

export function cornersFromAngularOffsets({left, right, up, down}) {
    return {
        tl: {ax: -left, ay: up},
        tr: {ax: right, ay: up},
        bl: {ax: -left, ay: -down},
        br: {ax: right, ay: -down}
    };
}
