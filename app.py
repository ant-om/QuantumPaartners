import math
import io
import re
import zipfile
import logging
import requests
import numpy as np
import pandas as pd
from scipy.stats import norm
import yfinance as yf
from datetime import datetime
from arch import arch_model
import statsmodels.api as sm
from flask import Flask, request, jsonify

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# ============================================================
# Constants
# ============================================================
START_DATE = datetime(2019, 1, 1)
FF_URLS = {
    3: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip",
    5: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_CSV.zip",
}


# ============================================================
# Helpers
# ============================================================
def safe_float(value):
    """Convert a value (possibly a Series/NaN) to a plain float or None."""
    try:
        if isinstance(value, pd.Series):
            val = value.values[0]
        else:
            val = value
        if pd.isna(val):
            return None
        return float(val)
    except (ValueError, TypeError, IndexError):
        logger.warning(f"Could not convert value to float: {value}")
        return None


def log_returns(df):
    return np.log(1 + df['Close'].pct_change()).dropna()


def volatility_calc(lr):
    return np.std(lr)


# ----- Monte Carlo -----
def run_MonteCarlo(num_simulations, num_days, last_price, log_return):
    vol = volatility_calc(log_return)
    sims = []
    for _ in range(num_simulations):
        s = [last_price]
        for _ in range(1, num_days):
            s.append(s[-1] * (1 + np.random.normal(0, vol)))
        sims.append(s)
    return pd.DataFrame(sims).T


# ----- Moving averages -----
def simple_exp_ma(data, windows):
    smas = {w: data.rolling(window=w).mean() for w in windows}
    ewms = {w: data.ewm(span=w, adjust=False).mean() for w in windows}
    return smas, ewms


# ----- Bollinger Bands -----
def bollinger_bands(close, window=20, n_std=2):
    mid = close.rolling(window).mean()
    sd = close.rolling(window).std(ddof=0)
    upper = mid + n_std * sd
    lower = mid - n_std * sd
    return mid, upper, lower


def build_bollinger_payload(close, last_price, window=20, n_std=2):
    mid, upper, lower = bollinger_bands(close, window, n_std)
    u = safe_float(upper.iloc[-1])
    m = safe_float(mid.iloc[-1])
    l = safe_float(lower.iloc[-1])
    # %B = where price sits inside the band (0 = lower, 1 = upper); bandwidth = width / mid
    pct_b = (last_price - l) / (u - l) if (u is not None and l is not None and u != l) else None
    bandwidth = (u - l) / m if (u is not None and l is not None and m not in (None, 0)) else None
    return {
        "window": window,
        "n_std": n_std,
        "upper": u,
        "middle": m,
        "lower": l,
        "pct_b": safe_float(pct_b),
        "bandwidth": safe_float(bandwidth),
    }


# ----- MACD -----
def calculate_macd(close, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


def build_macd_payload(close, fast=12, slow=26, signal=9):
    macd_line, signal_line, hist = calculate_macd(close, fast, slow, signal)
    return {
        "fast": fast,
        "slow": slow,
        "signal": signal,
        "macd_last": safe_float(macd_line.iloc[-1]),
        "signal_last": safe_float(signal_line.iloc[-1]),
        "histogram_last": safe_float(hist.iloc[-1]),
        "crossover": "bullish" if macd_line.iloc[-1] > signal_line.iloc[-1] else "bearish",
    }


# ----- EMA 50/200 golden / death crosses -----
def last_ma_cross(fast, slow):
    """Most recent crossover of two MAs. fast over slow = golden; fast under slow = death."""
    diff = (fast - slow).dropna()
    sign = np.sign(diff)
    changes = sign.diff().fillna(0)
    crosses = changes[changes != 0]
    if len(crosses) == 0:
        return {"last_cross_type": None, "last_cross_date": None, "days_since_last_cross": None}
    last_idx = crosses.index[-1]
    return {
        "last_cross_type": "golden" if changes.loc[last_idx] > 0 else "death",
        "last_cross_date": last_idx.strftime("%Y-%m-%d"),
        "days_since_last_cross": int((diff.index[-1] - last_idx).days),
    }


def crosses_in_window(fast, slow, lookback_days=90):
    """All golden/death crosses within the trailing `lookback_days` calendar days."""
    diff = (fast - slow).dropna()
    sign = np.sign(diff)
    changes = sign.diff().fillna(0)
    crosses = changes[changes != 0]
    if len(crosses) == 0:
        return []
    cutoff = diff.index[-1] - pd.Timedelta(days=lookback_days)
    recent = crosses[crosses.index >= cutoff]
    return [
        {
            "type": "golden" if val > 0 else "death",
            "date": idx.strftime("%Y-%m-%d"),
            "days_ago": int((diff.index[-1] - idx).days),
        }
        for idx, val in recent.items()
    ]


def build_golden_death_cross(ema_50, ema_200, lookback_days=90):
    crosses = crosses_in_window(ema_50, ema_200, lookback_days)
    return {
        "current_state": "golden" if ema_50.iloc[-1] > ema_200.iloc[-1] else "death",
        **last_ma_cross(ema_50, ema_200),
        "crosses_last_3m": crosses,
        "n_golden_last_3m": sum(1 for c in crosses if c["type"] == "golden"),
        "n_death_last_3m": sum(1 for c in crosses if c["type"] == "death"),
    }


# ----- RSI -----
def calculate_rsi(close, days=14):
    diff = close.diff(1)
    gain = diff.clip(lower=0)
    loss = (-diff).clip(lower=0)
    avg_gain = gain.rolling(window=days).mean()
    avg_loss = loss.rolling(window=days).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def rsi_state(v, ob=70, os=30):
    if v is None or np.isnan(v):
        return "n/a"
    if v >= ob:
        return "overbought"
    if v <= os:
        return "oversold"
    return "neutral"


def days_since_cross(rsi_series, threshold, direction='above'):
    """Calendar days since RSI was last above/below the threshold."""
    s = rsi_series.dropna()
    hits = s.index[s >= threshold] if direction == 'above' else s.index[s <= threshold]
    if len(hits) == 0:
        return None
    return int((s.index[-1] - hits[-1]).days)


def regime_share(rsi_series, ob=70, os=30):
    s = rsi_series.dropna()
    return {
        "pct_overbought": float((s >= ob).mean()),
        "pct_oversold": float((s <= os).mean()),
        "pct_neutral": float(((s > os) & (s < ob)).mean()),
    }


def recent_divergence(close, rsi_series, lookback=30):
    """Compare slope of price vs slope of RSI over `lookback` sessions."""
    px = close.dropna().tail(lookback)
    rsi = rsi_series.dropna().tail(lookback)
    if len(px) < 5 or len(rsi) < 5:
        return "n/a"
    px_slope = np.polyfit(range(len(px)), px.values, 1)[0]
    rsi_slope = np.polyfit(range(len(rsi)), rsi.values, 1)[0]
    if px_slope > 0 and rsi_slope < 0:
        return "bearish_divergence"
    if px_slope < 0 and rsi_slope > 0:
        return "bullish_divergence"
    return "no_divergence"


def build_rsi_payload(close):
    rsi_9 = calculate_rsi(close, 9).dropna()
    rsi_14 = calculate_rsi(close, 14)
    rsi_21 = calculate_rsi(close, 21).dropna()
    rsi14 = rsi_14.dropna()
    return {
        "RSI_9_last": safe_float(rsi_9.iloc[-1]) if len(rsi_9) else None,
        "RSI_14_last": safe_float(rsi14.iloc[-1]) if len(rsi14) else None,
        "RSI_21_last": safe_float(rsi_21.iloc[-1]) if len(rsi_21) else None,
        "RSI_14_state": rsi_state(rsi14.iloc[-1]) if len(rsi14) else "n/a",
        "RSI_14_last_5_sessions": [float(x) for x in rsi14.tail(5).values],
        "RSI_14_mean_30d": safe_float(rsi14.tail(30).mean()),
        "RSI_14_min_30d": safe_float(rsi14.tail(30).min()),
        "RSI_14_max_30d": safe_float(rsi14.tail(30).max()),
        "RSI_14_pctile_in_sample": safe_float((rsi14 <= rsi14.iloc[-1]).mean()) if len(rsi14) else None,
        "days_since_overbought": days_since_cross(rsi_14, 70, 'above'),
        "days_since_oversold": days_since_cross(rsi_14, 30, 'below'),
        "regime_share_full_sample": regime_share(rsi_14),
        "recent_divergence_30d": recent_divergence(close, rsi_14, 30),
    }


# ----- VaR -----
def calculateVaR(risk, confidenceLevel, principal=1, numMonths=1):
    vol = math.sqrt(risk)
    return abs(principal * norm.ppf(1 - confidenceLevel, 0, 1) * vol * math.sqrt(numMonths))


# ----- Sharpe / drawdown / Calmar -----
def sharpe_ratio(returns, rf_per_period=0.0, periods_per_year=252):
    excess = returns - rf_per_period
    sd = excess.std(ddof=1)
    return np.nan if sd == 0 or np.isnan(sd) else (excess.mean() / sd) * np.sqrt(periods_per_year)


def max_drawdown(price_series):
    cum_max = price_series.cummax()
    drawdown = price_series / cum_max - 1
    mdd = drawdown.min()
    trough = drawdown.idxmin()
    peak = price_series.loc[:trough].idxmax()
    return mdd, peak, trough


def calmar_ratio(price_series, periods_per_year=252):
    years = (len(price_series) - 1) / periods_per_year
    if years <= 0:
        return np.nan
    cagr = (price_series.iloc[-1] / price_series.iloc[0]) ** (1 / years) - 1
    mdd, _, _ = max_drawdown(price_series)
    return np.nan if mdd == 0 else cagr / abs(mdd)


# ----- Fama-French / CAPM -----
# Cache layer removed per request: download the FF dataset directly on each call.
def fetch_fama_french(n_factors=3):
    """Download and parse the Fama-French factor dataset (no caching)."""
    logger.info(f"Downloading Fama-French {n_factors}-factor data")
    r = requests.get(FF_URLS[n_factors], timeout=30)
    r.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        with z.open(z.namelist()[0]) as f:
            raw = f.read().decode('utf-8', errors='ignore')
    lines = raw.splitlines()
    start = next(i for i, ln in enumerate(lines)
                 if ln.lstrip().startswith(',') and 'Mkt-RF' in ln)
    end = start + 1
    while end < len(lines) and re.match(r'^\s*\d{6}\s*,', lines[end]):
        end += 1
    df = pd.read_csv(io.StringIO('\n'.join(lines[start:end])), index_col=0)
    df.index = pd.to_datetime(df.index.astype(str), format='%Y%m').to_period('M')
    return df.apply(pd.to_numeric, errors='coerce') / 100


def run_fama_french(monthly_ret, n_factors=5):
    ff = fetch_fama_french(n_factors)
    stock_m = monthly_ret.copy()
    stock_m.index = stock_m.index.to_period('M')
    df = ff.join(stock_m.rename('stock'), how='inner').dropna()
    df['excess'] = df['stock'] - df['RF']
    factor_cols = (['Mkt-RF', 'SMB', 'HML'] if n_factors == 3
                   else ['Mkt-RF', 'SMB', 'HML', 'RMW', 'CMA'])
    X = sm.add_constant(df[factor_cols])
    res = sm.OLS(df['excess'], X).fit()
    alpha_annual = (1 + res.params['const']) ** 12 - 1
    return res, alpha_annual, res.params.drop('const'), df


# ============================================================
# API endpoints
# ============================================================
@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "message": "Stock Analysis API is running"})


@app.route('/analyze/<ticker>', methods=['GET'])
def analyze_get(ticker):
    """GET shorthand: /analyze/TSLA  (simulations=1000, days=3 defaults)"""
    return analyze_ticker(ticker, simulations=1000, days=3)


@app.route('/analyze', methods=['POST'])
def analyze():
    """POST: {"ticker": "TSLA", "simulations": 1000, "days": 3}"""
    data = request.json or {}
    return analyze_ticker(
        data.get('ticker', 'TSLA'),
        simulations=data.get('simulations', 1000),
        days=data.get('days', 3)
    )


def analyze_ticker(ticker_sym, simulations=1000, days=3):
    num_simulations = simulations
    num_days = days
    try:
        ticker_sym = ticker_sym.strip().upper()
        start_date = START_DATE
        end_date = datetime.now()
        logger.info(f"Fetching data for {ticker_sym} from {start_date.date()} to {end_date.date()}")

        # --- Price data ---
        try:
            stock_data = yf.download(ticker_sym, start=start_date, end=end_date,
                                     auto_adjust=False, progress=False)
        except Exception as e:
            logger.error(f"yfinance download failed for {ticker_sym}: {e}", exc_info=True)
            return jsonify({"error": f"Failed to fetch market data for {ticker_sym}"}), 500

        if stock_data.empty:
            logger.warning(f"No data returned for ticker: {ticker_sym}")
            return jsonify({"error": f"No data found for ticker {ticker_sym}"}), 404

        if isinstance(stock_data.columns, pd.MultiIndex):
            stock_data.columns = stock_data.columns.get_level_values(0)
        if stock_data.index.tz is not None:
            stock_data.index = stock_data.index.tz_localize(None)

        logger.info(f"Fetched {len(stock_data)} rows for {ticker_sym}")
        close = stock_data['Close']

        # --- Returns ---
        daily_returns = close.pct_change().dropna()
        monthly_returns = close.resample('ME').last().pct_change().dropna()
        log_return = log_returns(stock_data)
        last_price = float(close.iloc[-1])
        stock_vol = volatility_calc(log_return)

        # --- Monte Carlo ---
        simulation_df = run_MonteCarlo(num_simulations, num_days, last_price, log_return)
        day_prices = simulation_df.iloc[-1].to_numpy(dtype=float)
        mc_lower = float(np.percentile(day_prices, 2.5))
        mc_upper = float(np.percentile(day_prices, 97.5))
        mc_mean = float(day_prices.mean())

        # --- Moving averages ---
        smas, ewms = simple_exp_ma(close, [20, 50, 200])
        ema_50, ema_200 = ewms[50], ewms[200]

        # --- Bollinger Bands / MACD / golden-death cross ---
        bollinger_payload = build_bollinger_payload(close, last_price, 20, 2)
        macd_payload = build_macd_payload(close)
        golden_death_cross = build_golden_death_cross(ema_50, ema_200, 90)

        # --- RSI payload ---
        rsi_payload = build_rsi_payload(close)

        # --- GARCH(1,1) ---
        try:
            logger.info(f"Fitting GARCH(1,1) for {ticker_sym} with {len(log_return)} observations")
            garch_norm = arch_model(log_return * 100, p=1, q=1,
                                    mean='constant', vol='GARCH', dist='normal')
            garch_result = garch_norm.fit(update_freq=4, disp='off')
            garch_cond_vol = garch_result.conditional_volatility / 100
            garch_last_vol_ann = float(garch_cond_vol.iloc[-1] * np.sqrt(252))
            garch_params = {
                "omega": float(garch_result.params['omega']),
                "alpha": float(garch_result.params['alpha[1]']),
                "beta": float(garch_result.params['beta[1]']),
            }
            garch_persistence = garch_params["alpha"] + garch_params["beta"]
            logger.info(f"GARCH fit complete. Persistence: {garch_persistence:.4f}")
        except Exception as e:
            logger.error(f"GARCH fitting failed for {ticker_sym}: {e}", exc_info=True)
            return jsonify({"error": "GARCH model fitting failed"}), 500

        # --- Parametric VaR ---
        VaR_5 = float(calculateVaR(stock_vol, 0.05))
        VaR_1 = float(calculateVaR(stock_vol, 0.01))

        # --- Fama-French 5-factor + CAPM (network; degrade gracefully) ---
        factor_model = None
        rf_annual = rf_monthly_avg = rf_daily = None
        try:
            ff_result, ff_alpha_ann, ff_betas, ff_df = run_fama_french(monthly_returns, n_factors=5)

            window = min(60, len(ff_df))
            recent = ff_df.tail(window)
            X_uni = sm.add_constant(recent[['Mkt-RF']])
            capm_uni = sm.OLS(recent['excess'], X_uni).fit()
            capm_beta_univariate = float(capm_uni.params['Mkt-RF'])
            capm_alpha_uni_annual = (1 + capm_uni.params['const']) ** 12 - 1

            capm_beta = float(ff_betas['Mkt-RF'])
            rf_monthly_avg = float(ff_df['RF'].mean())
            rf_annual = (1 + rf_monthly_avg) ** 12 - 1
            rf_daily = (1 + rf_annual) ** (1 / 252) - 1

            factor_model = {
                "model": "Fama-French 5-Factor + univariate CAPM",
                "capm_beta_univariate_60m": capm_beta_univariate,   # Yahoo-like
                "capm_beta_multivariate_ff5": capm_beta,            # FF5-controlled
                "capm_alpha_univariate_annual": float(capm_alpha_uni_annual),
                "fama_french_beta_SMB": float(ff_betas['SMB']),
                "fama_french_beta_HML": float(ff_betas['HML']),
                "fama_french_beta_RMW": float(ff_betas['RMW']),
                "fama_french_beta_CMA": float(ff_betas['CMA']),
                "fama_french_alpha_annual": float(ff_alpha_ann),
                "r_squared": float(ff_result.rsquared),
                "adj_r_squared": float(ff_result.rsquared_adj),
            }
        except Exception as e:
            logger.warning(f"Fama-French/CAPM step failed for {ticker_sym}: {e}")
            factor_model = {"error": "Fama-French data unavailable"}

        # --- Sharpe / drawdown / Calmar ---
        sharpe_daily = sharpe_ratio(daily_returns, rf_daily or 0.0, 252)
        sharpe_monthly = sharpe_ratio(monthly_returns, rf_monthly_avg or 0.0, 12)
        mdd, peak_date, trough_date = max_drawdown(close)
        calmar = calmar_ratio(close)

        # --- VIX levels + coupling (network; degrade gracefully) ---
        vix_coupling = None
        vix_levels = None
        try:
            vix_data = yf.Ticker("^VIX").history(start=start_date, end=end_date)
            if vix_data.index.tz is not None:
                vix_data.index = vix_data.index.tz_localize(None)
            vix_close = vix_data['Close']

            # --- Absolute VIX levels + trailing 30-day series ---
            vix_clean = vix_close.dropna()
            vix_levels = {
                "vix_level_last": safe_float(vix_clean.iloc[-1]),
                "vix_mean_30d": safe_float(vix_clean.tail(30).mean()),
                "vix_min_30d": safe_float(vix_clean.tail(30).min()),
                "vix_max_30d": safe_float(vix_clean.tail(30).max()),
                "vix_pctile_in_sample": safe_float((vix_clean <= vix_clean.iloc[-1]).mean()),
                "vix_last_30d": [
                    {"date": idx.strftime("%Y-%m-%d"), "vix": safe_float(val)}
                    for idx, val in vix_clean.tail(30).items()
                ],
            }

            combined = pd.concat([
                daily_returns.rename('stock'),
                vix_close.pct_change().rename('vix_chg'),
                vix_close.rename('vix_level'),
            ], axis=1).dropna()

            corr_stock_vix_chg = combined['stock'].corr(combined['vix_chg'])
            corr_stock_vix_level = combined['stock'].corr(combined['vix_level'])

            downturn_mask = combined['stock'] < combined['stock'].quantile(0.25)
            corr_downturn = combined.loc[downturn_mask, 'stock'].corr(
                combined.loc[downturn_mask, 'vix_chg'])

            rolling_vol = daily_returns.rolling(30).std()
            rolling_VaR_5 = (abs(norm.ppf(0.05)) * rolling_vol).rename('rolling_VaR_5')
            var_vix = pd.concat([rolling_VaR_5, vix_close.rename('vix')], axis=1).dropna()
            corr_VaR_VIX = var_vix['rolling_VaR_5'].corr(var_vix['vix'])
            corr_realvol_VIX = pd.concat(
                [rolling_vol.rename('rv'), vix_close.rename('vix')], axis=1
            ).dropna().corr().iloc[0, 1]

            high_vix = combined['vix_level'] > combined['vix_level'].quantile(0.90)
            mean_high_vix = combined.loc[high_vix, 'stock'].mean()
            mean_other = combined.loc[~high_vix, 'stock'].mean()

            vix_coupling = {
                "pearson_stock_vix_pct_change": safe_float(corr_stock_vix_chg),
                "pearson_stock_vix_level": safe_float(corr_stock_vix_level),
                "pearson_stock_vix_pct_in_downturns": safe_float(corr_downturn),
                "pearson_rolling_VaR5_vs_vix": safe_float(corr_VaR_VIX),
                "pearson_rolling_realvol_vs_vix": safe_float(corr_realvol_VIX),
                "mean_return_high_vix_days": safe_float(mean_high_vix),
                "mean_return_other_days": safe_float(mean_other),
            }
        except Exception as e:
            logger.warning(f"VIX step failed for {ticker_sym}: {e}")
            vix_coupling = {"error": "VIX data unavailable"}
            if vix_levels is None:
                vix_levels = {"error": "VIX data unavailable"}

        # --- Assemble analyst-ready payload ---
        output_data = {
            "ticker": ticker_sym,
            "analysis_date": end_date.strftime("%Y-%m-%d %H:%M:%S"),
            "sample": {"start": str(start_date.date()), "end": str(end_date.date())},
            "price": {
                "last_close": last_price,
                "last_30d_close": [
                    {"date": idx.strftime("%Y-%m-%d"), "close": safe_float(val)}
                    for idx, val in close.dropna().tail(30).items()
                ],
            },
            "returns": {
                "annualized_rf_from_ff": rf_annual,
                "sharpe_daily_annualized": safe_float(sharpe_daily),
                "sharpe_monthly_annualized": safe_float(sharpe_monthly),
                "daily_return_latest": safe_float(daily_returns.iloc[-1]),
                "avg_daily_return": safe_float(daily_returns.mean()),
                "avg_monthly_return": safe_float(monthly_returns.mean()),
            },
            "drawdown": {
                "max_drawdown": safe_float(mdd),
                "peak_date": str(peak_date.date()),
                "trough_date": str(trough_date.date()),
                "calmar_ratio": safe_float(calmar),
            },
            "volatility": {
                "log_return_daily_std": float(stock_vol),
                "annualized_volatility": float(stock_vol * np.sqrt(252)),
                "garch11_last_cond_vol_ann": garch_last_vol_ann,
            },
            "garch_model": {
                "model_type": "GARCH(1,1)",
                "parameters": garch_params,
                "persistence": float(garch_persistence),
            },
            "VaR": {
                "VaR_5pct_daily": VaR_5,
                "VaR_1pct_daily": VaR_1,
            },
            "monte_carlo": {
                "horizon_days": num_days,
                "n_simulations": num_simulations,
                "mean_price": mc_mean,
                "ci_95_lower": mc_lower,
                "ci_95_upper": mc_upper,
                "potential_return_pct": float((mc_mean - last_price) / last_price * 100),
                "downside_risk_pct": float((mc_lower - last_price) / last_price * 100),
                "upside_potential_pct": float((mc_upper - last_price) / last_price * 100),
            },
            "factor_model": factor_model,
            "vix_levels": vix_levels,
            "vix_coupling": vix_coupling,
            "technicals": {
                "RSI": rsi_payload,
                "SMA_20_last": safe_float(smas[20].dropna().iloc[-1]),
                "SMA_50_last": safe_float(smas[50].dropna().iloc[-1]),
                "SMA_200_last": safe_float(smas[200].dropna().iloc[-1]),
                "EWM_20_last": safe_float(ewms[20].dropna().iloc[-1]),
                "EMA_50_last": safe_float(ema_50.iloc[-1]),
                "EMA_200_last": safe_float(ema_200.iloc[-1]),
                "golden_death_cross": golden_death_cross,
                "bollinger_bands": bollinger_payload,
                "MACD": macd_payload,
            },
        }

        return jsonify(output_data)

    except Exception:
        logger.exception(
            f"Unhandled error analyzing {ticker_sym} "
            f"(simulations={num_simulations}, days={num_days})"
        )
        return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    import os

    port = int(os.environ.get('PORT', 8080))
    logger.info(f"Starting Stock Analysis API on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
