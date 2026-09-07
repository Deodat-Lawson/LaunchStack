/** The trade-data tool's environment reads — the only module here that touches process.env. */
export function getTradeDataProviderName(): string | undefined {
    return process.env.TRADE_DATA_PROVIDER;
}
