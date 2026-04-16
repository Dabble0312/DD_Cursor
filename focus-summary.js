// focus-summary.js — NLP Candle Summary Engine
// Translates raw candle tag data into natural language paragraphs.
// Depends on: nothing (pure functions operating on candle objects).
// Load BEFORE focus-core.js.

/* -----------------------------------------
   IDENTITY — What kind of candle is this?
----------------------------------------- */
function mapIdentity(candle) {
    if (candle.inside_bar === 1)
        return "The market paused today, forming an inside bar — a candle that fits entirely within the previous one. This signals compression, where neither buyers nor sellers are willing to push further. Watch closely, because the market is coiling before its next move.";

    if (candle.outside_bar === 1)
        return "Today expanded the battlefield with an outside bar, swallowing the entire range of the previous candle. This shows the market is agitated and indecisive at a larger scale — a resolution is coming, but the direction is not yet decided.";

    if (candle.engulfing_soft === 1 && candle.bullish === 1)
        return "This candle quietly engulfed the previous one to the upside, hinting at a shift in control toward the buyers. It is not a dramatic takeover, but it suggests the sellers are losing their grip.";

    if (candle.engulfing_soft === 1 && candle.bearish === 1)
        return "This candle quietly engulfed the previous one to the downside, hinting at a shift in control toward the sellers. It is not a dramatic takeover, but it suggests the buyers are losing their grip.";

    if (candle.candle_strength === "strong" && candle.bullish === 1)
        return "Today was a decisive win for the buyers. Price closed much higher than it opened, leaving little room for doubt. When a candle this strong appears, it tells you that buyers were not just present — they were in full control from open to close.";

    if (candle.candle_strength === "strong" && candle.bearish === 1)
        return "Sellers dominated today, pushing price sharply lower with conviction. The large body tells you there was no meaningful fight from the buyers — the bears were in control all day. This kind of candle often signals that the path of least resistance is downward.";

    if (candle.candle_strength === "weak" && candle.body_ratio < 0.20)
        return "Neither side won today. The candle barely moved from where it opened, meaning buyers and sellers ended in a stalemate. On its own this tells you little, but after a strong move it can be an early warning that momentum is fading.";

    if (candle.candle_strength === "medium" && candle.bullish === 1)
        return "Buyers nudged the price higher today with moderate force. This is not a statement candle — it is a continuation nudge. By itself it is unremarkable, but in a sequence of similar candles it builds a case for steady buying pressure.";

    if (candle.candle_strength === "medium" && candle.bearish === 1)
        return "Sellers had the edge today, closing price below the open with moderate force. Not a dramatic move, but a quiet lean in the bears' favour. In a downtrend this is normal; in an uptrend it is worth watching.";

    return "This candle did not fit a clear structural pattern today, suggesting a quiet session with no strong commitment from either side.";
}

/* -----------------------------------------
   ATMOSPHERE — Where is the market?
----------------------------------------- */
function mapAtmosphere(candle) {
    const trend = candle.trend_tag;
    const vol   = candle.volatility_tag;

    let trendSentence;
    if (trend === "uptrend")
        trendSentence = "The broader market is on an upward path — the average price has been rising, which means the general tide is in the buyers' favour.";
    else if (trend === "downtrend")
        trendSentence = "The broader market is stepping downward — the average price has been declining, which means sellers have had the upper hand over recent sessions.";
    else
        trendSentence = "The market is moving sideways without a clear directional bias. In this environment, moves in either direction are less trustworthy until a clearer trend emerges.";

    let volSentence;
    if (vol === "high_volatility")
        volSentence = " On top of that, the market is in an agitated state right now — candles are larger than normal, meaning price is swinging more than usual. In high volatility, moves can be sharp and fast but also unreliable.";
    else if (vol === "low_volatility")
        volSentence = " The market feels calm right now — candles have been smaller than usual and price is moving in a contained way. Low volatility often precedes a breakout, so calm periods are worth paying attention to.";
    else
        volSentence = " Volatility is normal right now — price is moving at a typical pace, neither unusually calm nor unusually agitated.";

    return trendSentence + volSentence;
}

/* -----------------------------------------
   CONVICTION — How much force is behind this move?
----------------------------------------- */
function mapConviction(candle) {
    const parts = [];

    if (candle.volume_tag === "volume_spike" && candle.bullish === 1)
        parts.push("This move came with a surge in volume — the market is shouting its approval. High volume on a bullish candle means more participants were buying, which adds real weight to the move.");
    else if (candle.volume_tag === "volume_spike" && candle.bearish === 1)
        parts.push("Sellers acted with force today, backed by a surge in volume. Heavy selling volume is a meaningful signal — it means this was not a casual decline but a deliberate one.");
    else if (candle.volume_tag === "volume_drop" && candle.bullish === 1)
        parts.push("The price rose today, but the market was only whispering. Low volume on a bullish candle is a caution sign — when fewer participants show up to push price higher, the move may not have the legs to continue.");
    else if (candle.volume_tag === "volume_drop" && candle.bearish === 1)
        parts.push("Price declined today, but without much energy behind it. Low volume selling is less threatening than it looks — it may simply mean buyers stepped aside rather than sellers actively pushing.");
    else
        parts.push("Volume was normal today — neither unusually heavy nor unusually thin, suggesting no special conviction behind the move.");

    if (candle.upper_wick_ratio > 0.6)
        parts.push("The long upper wick is a tell — price tried to go higher but was pushed back down by sellers before the close. That rejection is a warning that the bulls could not hold those higher levels.");
    else if (candle.lower_wick_ratio > 0.6)
        parts.push("The long lower wick shows buyers stepped in aggressively. Price was pushed down at some point during the session, but buyers refused to let it stay there and drove it back up. That kind of demand is meaningful.");

    if (candle.volatility_tag === "high_volatility")
        parts.push("This candle is larger than the market's historical average, which means what you are seeing is not typical behaviour. Unusually large candles can mark turning points or accelerations — either way, they deserve extra attention.");
    else if (candle.volatility_tag === "low_volatility")
        parts.push("This candle is smaller than the market's historical average. A quiet candle in a normally active market can mean the move is losing steam, or that the market is pausing before the next leg.");

    return parts.join(" ");
}

/* -----------------------------------------
   ENERGY — Is this move fresh or running on fumes?
----------------------------------------- */
function mapEnergy(candle) {
    const momentum = candle.momentum_tag;
    const bullish  = candle.bullish === 1;
    const bearish  = candle.bearish === 1;

    if (momentum === "bullish_momentum" && bullish)
        return "The energy behind this move is fresh — momentum is on the buyers' side and has not yet reached extreme levels. This is often the most comfortable environment for a trend to continue.";
    if (momentum === "bullish_momentum" && bearish)
        return "Here is an interesting tension: the candle closed lower, but underlying momentum is still leaning bullish. This could be a brief pullback within a broader buying environment, rather than a true reversal. Worth watching the next candle before drawing conclusions.";
    if (momentum === "bearish_momentum" && bearish)
        return "The energy behind this decline is fresh — momentum is on the sellers' side and has not yet reached extreme levels. This is the kind of environment where downtrends tend to persist.";
    if (momentum === "bearish_momentum" && bullish)
        return "Here is an interesting tension: the candle closed higher, but underlying momentum is still leaning bearish. This could be a relief bounce in a broader selling environment — not necessarily the start of a recovery. Caution is warranted.";
    if (momentum === "neutral_momentum" && bullish)
        return "Momentum is balanced right now — neither overbought nor oversold. A bullish candle from a neutral momentum position is a healthy sign, suggesting the move is not yet stretched or exhausted.";
    if (momentum === "neutral_momentum" && bearish)
        return "Momentum is balanced right now — neither overbought nor oversold. A bearish candle from a neutral momentum position means there is room for further decline if sellers stay in control.";
    if (momentum === "neutral_momentum")
        return "Momentum is sitting in neutral territory — no strong signal in either direction. This reinforces the indecisive nature of today's candle.";

    return "";
}

/* -----------------------------------------
   SUMMARIZE — assembles all four layers
----------------------------------------- */
function summarize(candle) {
    return [
        mapIdentity(candle),
        mapAtmosphere(candle),
        mapConviction(candle),
        mapEnergy(candle),
    ].filter(s => s && s.trim().length > 0).join(" ");
}

/* -----------------------------------------
   LIVE REPORT TEXT HELPER
   Used by Focus UI live tray cards.
----------------------------------------- */
function summarizeToSentencePair(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const parts = raw
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(Boolean);
    return parts.slice(0, 2).join(' ');
}
