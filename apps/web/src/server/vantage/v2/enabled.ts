/** Gate the owner workflow and its background worker with the same switch. */
export function vantageV2Enabled(): boolean {
    return process.env.VANTAGE_V2_ENABLED === "true";
}
