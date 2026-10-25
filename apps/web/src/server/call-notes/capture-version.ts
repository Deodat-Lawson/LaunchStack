export type CaptureVersion = {
    major: string;
    minor: string;
    patch: string;
    prerelease: string[];
};

const VERSION =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseCaptureVersion(value: string): CaptureVersion | null {
    const match = VERSION.exec(value);
    // JavaScript's `$` also matches before a trailing newline; SemVer does not.
    if (!match || match[0] !== value) return null;
    const prerelease = match[4]?.split(".") ?? [];
    if (prerelease.some(part => /^[0-9]+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
        return null;
    }
    return { major: match[1]!, minor: match[2]!, patch: match[3]!, prerelease };
}

export function isCaptureVersion(value: string): boolean {
    return parseCaptureVersion(value) !== null;
}

function compareNumericIdentifier(left: string, right: string): number {
    // SemVer numbers are unbounded; Number would lose ordering above 2^53.
    if (left.length !== right.length) return left.length < right.length ? -1 : 1;
    return left === right ? 0 : left < right ? -1 : 1;
}

export function compareCaptureVersions(left: string, right: string): number | null {
    const leftVersion = parseCaptureVersion(left);
    const rightVersion = parseCaptureVersion(right);
    if (!leftVersion || !rightVersion) return null;
    for (const key of ["major", "minor", "patch"] as const) {
        const order = compareNumericIdentifier(leftVersion[key], rightVersion[key]);
        if (order !== 0) return order;
    }
    if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) return 0;
    if (leftVersion.prerelease.length === 0) return 1;
    if (rightVersion.prerelease.length === 0) return -1;
    const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = leftVersion.prerelease[index];
        const rightPart = rightVersion.prerelease[index];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        if (leftPart === rightPart) continue;
        const leftNumeric = /^[0-9]+$/.test(leftPart);
        const rightNumeric = /^[0-9]+$/.test(rightPart);
        if (leftNumeric && rightNumeric) return compareNumericIdentifier(leftPart, rightPart);
        if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
        return leftPart < rightPart ? -1 : 1;
    }
    return 0;
}
