/**
 * The dense linear algebra the policies need, in plain loops over typed
 * arrays: double precision throughout, no library, same result on every run.
 */
import { createRng } from "../lib/rng";

/** Rows of a raw [n × d] matrix, scaled to unit length. */
export function unitRows(raw: Float32Array, n: number, d: number): Float64Array {
    const out = new Float64Array(n * d);
    for (let i = 0; i < n; i++) {
        const o = i * d;
        let sum = 0;
        for (let k = 0; k < d; k++) sum += raw[o + k]! * raw[o + k]!;
        const scale = sum > 0 ? 1 / Math.sqrt(sum) : 0;
        for (let k = 0; k < d; k++) out[o + k] = raw[o + k]! * scale;
    }
    return out;
}

/** a · b over `d` entries starting at the given offsets (d must be a multiple of 4). */
export function dotAt(a: Float64Array, ao: number, b: Float64Array, bo: number, d: number): number {
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let k = 0; k < d; k += 4) {
        s0 += a[ao + k]! * b[bo + k]!;
        s1 += a[ao + k + 1]! * b[bo + k + 1]!;
        s2 += a[ao + k + 2]! * b[bo + k + 2]!;
        s3 += a[ao + k + 3]! * b[bo + k + 3]!;
    }
    return s0 + s1 + s2 + s3;
}

/** X Xᵀ of [n × d] rows, as a symmetric single-precision [n × n] matrix. */
export function gramMatrix(x: Float64Array, n: number, d: number): Float32Array {
    const out = new Float32Array(n * n);
    for (let i = 0; i < n; i++) {
        const io = i * d;
        for (let j = i; j < n; j++) {
            const v = dotAt(x, io, x, j * d, d);
            out[i * n + j] = v;
            out[j * n + i] = v;
        }
    }
    return out;
}

/** X v for [n × d] rows. */
export function timesVector(x: Float64Array, n: number, d: number, v: Float64Array): Float64Array {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = dotAt(x, i * d, v, 0, d);
    return out;
}

/** The mean row of [n × d]. */
export function meanRow(x: Float64Array, n: number, d: number): Float64Array {
    const out = new Float64Array(d);
    for (let i = 0; i < n; i++) {
        const o = i * d;
        for (let k = 0; k < d; k++) out[k]! += x[o + k]!;
    }
    for (let k = 0; k < d; k++) out[k]! /= Math.max(1, n);
    return out;
}

/** A vector scaled to unit length. */
export function unitVector(v: Float32Array | Float64Array): Float64Array {
    const out = Float64Array.from(v);
    let sum = 0;
    for (const x of out) sum += x * x;
    const scale = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    for (let k = 0; k < out.length; k++) out[k]! *= scale;
    return out;
}

/**
 * The top `k` principal directions of the rows about their mean, as [k × d]
 * orthonormal rows. Subspace iteration on the covariance from a seeded start:
 * the span is what matters to the models built on it, so a fixed number of
 * rounds is enough.
 */
export function principalDirections(
    x: Float64Array,
    n: number,
    d: number,
    mean: Float64Array,
    k: number,
    seed: number,
    rounds = 20
): Float64Array {
    // Covariance, upper triangle first.
    const cov = new Float64Array(d * d);
    const row = new Float64Array(d);
    for (let i = 0; i < n; i++) {
        const o = i * d;
        for (let a = 0; a < d; a++) row[a] = x[o + a]! - mean[a]!;
        for (let a = 0; a < d; a++) {
            const va = row[a]!;
            const ao = a * d;
            for (let b = a; b < d; b++) cov[ao + b]! += va * row[b]!;
        }
    }
    for (let a = 0; a < d; a++)
        for (let b = a; b < d; b++) {
            const v = cov[a * d + b]! / Math.max(1, n);
            cov[a * d + b] = v;
            cov[b * d + a] = v;
        }

    const rng = createRng(seed);
    let basis = new Float64Array(k * d);
    for (let i = 0; i < basis.length; i++) basis[i] = rng.normal();
    orthonormalise(basis, k, d);
    for (let round = 0; round < rounds; round++) {
        const next = new Float64Array(k * d);
        for (let c = 0; c < k; c++)
            for (let a = 0; a < d; a++) next[c * d + a] = dotAt(cov, a * d, basis, c * d, d);
        orthonormalise(next, k, d);
        basis = next;
    }
    return basis;
}

/** Modified Gram–Schmidt on [k × d] rows, in place. */
function orthonormalise(rows: Float64Array, k: number, d: number): void {
    for (let c = 0; c < k; c++) {
        const co = c * d;
        for (let p = 0; p < c; p++) {
            const po = p * d;
            const proj = dotAt(rows, co, rows, po, d);
            for (let a = 0; a < d; a++) rows[co + a]! -= proj * rows[po + a]!;
        }
        const norm = Math.sqrt(dotAt(rows, co, rows, co, d));
        const scale = norm > 0 ? 1 / norm : 0;
        for (let a = 0; a < d; a++) rows[co + a]! *= scale;
    }
}

/**
 * Lower Cholesky factor of a symmetric positive-definite [p × p] matrix
 * (row-major). A pivot that rounding pushed to zero or below is floored, so a
 * covariance that has collapsed in one direction still factors.
 */
export function choleskyLower(a: Float64Array, p: number): Float64Array {
    const l = new Float64Array(p * p);
    for (let i = 0; i < p; i++) {
        for (let j = 0; j <= i; j++) {
            let sum = a[i * p + j]!;
            for (let k = 0; k < j; k++) sum -= l[i * p + k]! * l[j * p + k]!;
            if (i === j) l[i * p + i] = Math.sqrt(Math.max(sum, 1e-18));
            else l[i * p + j] = sum / l[j * p + j]!;
        }
    }
    return l;
}
