/**
 * Host-neutral ports: the clock and the logger. Feature-specific ports live
 * with their features (@launchstack/orchestration, @launchstack/conversion);
 * these two are the only interfaces every feature shares.
 */
export interface ClockPort {
    now(): Date;
}

export interface LoggerPort {
    debug(obj: Record<string, unknown> | string, msg?: string): void;
    info(obj: Record<string, unknown> | string, msg?: string): void;
    warn(obj: Record<string, unknown> | string, msg?: string): void;
    error(obj: Record<string, unknown> | string, msg?: string): void;
}
