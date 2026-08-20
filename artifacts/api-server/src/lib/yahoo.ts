// eslint-disable-next-line @typescript-eslint/no-explicit-any
import YahooFinanceClass from "yahoo-finance2";

// yahoo-finance2 v4: the default export is a class, must be instantiated.
// Suppress the one-time survey notice so server logs stay clean.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const yahooFinance = new (YahooFinanceClass as any)({ suppressNotices: ["yahooSurvey"] });