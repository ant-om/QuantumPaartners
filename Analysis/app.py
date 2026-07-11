from flask import Flask, request, jsonify
import numpy as np
import pandas as pd
from scipy.stats import norm
import yfinance as yf
from datetime import datetime
from arch import arch_model
import math

app = Flask(__name__)


# === HELPER FUNCTIONS (from your original code) ===

def log_returns(stock_data):
    log_returns = np.log(1 + stock_data['Close'].pct_change())
    return log_returns[1:]


def volatility_calc(lr):
    return np.std(lr)


def run_MonteCarlo(num_simulations, num_days, last_price, log_return):
    daily_vol = volatility_calc(log_return)
    all_simulations = []

    for x in range(num_simulations):
        price_series = [last_price]
        for y in range(1, num_days):
            price = price_series[-1] * (1 + np.random.normal(0, daily_vol))
            price_series.append(price)
        all_simulations.append(price_series)

    return pd.DataFrame(all_simulations).transpose()


def calculate_rs(data):
    difference = data["Close"].diff(1)
    difference.dropna(inplace=True)

    positive = difference.copy()
    negative = difference.copy()

    positive[positive < 0] = 0
    negative[negative > 0] = 0

    days = 14
    avg_gain = positive.rolling(window=days).mean()
    avg_loss = abs(negative.rolling(window=days).mean())

    rs = avg_gain / avg_loss
    RSI = 100.0 - (100.0 / (1.0 + rs))
    return RSI


def simple_exp_ma(data, times):
    smas = {}
    ewms = {}
    for i in times:
        smas[i] = data.rolling(window=i).mean()
        ewms[i] = data.ewm(span=i, adjust=False).mean()
    return smas, ewms


def calculateVaR(risk, confidenceLevel, principal=1, numMonths=1):
    vol = math.sqrt(risk)
    return abs(principal * norm.ppf(1 - confidenceLevel, 0, 1) * vol * math.sqrt(numMonths))


def safe_float(value):
    try:
        if isinstance(value, pd.Series):
            val = value.values[0]
        else:
            val = value
        return None if pd.isna(val) else float(val)
    except:
        return None


def build_series(close, smas, ewms, lookback=252):
    """Aligned date/close/MA series for the last `lookback` trading days.

    Returns (price_history, ma_series) — both lists of dicts keyed by ISO date,
    ready to drop straight into the `metrics` JSONB (charts source)."""
    idx = close.index[-lookback:]
    price_history, ma_series = [], []
    for d in idx:
        date = d.strftime("%Y-%m-%d")
        price_history.append({"date": date, "close": safe_float(close.loc[d])})
        ma_series.append({
            "date": date,
            "sma20": safe_float(smas[20].loc[d]),
            "sma50": safe_float(smas[50].loc[d]),
            "sma200": safe_float(smas[200].loc[d]),
        })
    return price_history, ma_series


def build_mc_band(simulation_df):
    """Monte Carlo percentile band per forecast day (p2.5 / p50 / p97.5).

    simulation_df is (num_days x num_simulations); one row per forecast day."""
    band = []
    arr = simulation_df.to_numpy(dtype=float)
    for day in range(arr.shape[0]):
        row = arr[day]
        band.append({
            "day": day + 1,
            "p2_5": float(np.percentile(row, 2.5)),
            "p50": float(np.percentile(row, 50)),
            "p97_5": float(np.percentile(row, 97.5)),
        })
    return band


### API ENDPOINTS

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "message": "Stock Analysis API is running"})


@app.route('/profile', methods=['GET', 'POST'])
def profile():
    """Company metadata for the `stocks` table, sourced from yfinance.

    GET  /profile?ticker=TSLA
    POST /profile  {"ticker": "TSLA"}
    Maps yfinance .info to the schema_v3 `stocks` columns."""
    try:
        if request.method == 'POST':
            ticker_sym = (request.json or {}).get('ticker', '')
        else:
            ticker_sym = request.args.get('ticker', '')
        ticker_sym = (ticker_sym or '').upper().strip()
        if not ticker_sym:
            return jsonify({"error": "ticker is required"}), 400

        info = yf.Ticker(ticker_sym).info or {}
        if not info.get('symbol') and not info.get('shortName') and not info.get('longName'):
            return jsonify({"error": f"No profile found for ticker {ticker_sym}"}), 404

        return jsonify({
            "ticker": ticker_sym,
            "name": info.get('longName') or info.get('shortName') or ticker_sym,
            "exchange": info.get('fullExchangeName') or info.get('exchange'),
            "sector": info.get('sector'),
            "industry": info.get('industry'),
            "country": info.get('country'),
            "description": info.get('longBusinessSummary'),
            "website": info.get('website'),
            "logo_url": info.get('logo_url'),
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/analyze', methods=['POST'])
def analyze():
    """
    Main analysis endpoint
    Expects JSON: {"ticker": "TSLA", "simulations": 10000, "days": 100}
    """
    try:
        data = request.json
        ticker_sym = data.get('ticker', 'TSLA')
        num_simulations = data.get('simulations', 10000)
        num_days = data.get('days', 100)

        # Fetch stock data
        start_date = datetime(2019, 1, 1)
        end_date = datetime.now()
        stock_data = yf.download(ticker_sym, start=start_date, end=end_date, progress=False)

        # Flatten MultiIndex columns from newer yfinance versions
        if isinstance(stock_data.columns, pd.MultiIndex):
            stock_data.columns = stock_data.columns.droplevel(1)

        if stock_data.empty:
            return jsonify({"error": f"No data found for ticker {ticker_sym}"}), 404

        # Calculate metrics
        log_return = log_returns(stock_data)
        last_price = stock_data['Close'].iloc[-1]
        last_price = float(last_price) if not isinstance(last_price, pd.Series) else float(last_price.values[0])
        daily_returns = stock_data['Close'].pct_change()
        monthly_returns = stock_data['Close'].resample('ME').ffill().pct_change()

        # Monte Carlo Simulation
        simulation_df = run_MonteCarlo(num_simulations, num_days, last_price, log_return)
        day_prices = simulation_df.iloc[-1].to_numpy(dtype=float)

        lower_bound = float(np.percentile(day_prices, 2.5))
        upper_bound = float(np.percentile(day_prices, 97.5))
        mean_price = float(np.mean(day_prices))

        # Moving Averages
        smas, ewms = simple_exp_ma(stock_data['Close'], [20, 50, 200])

        # RSI
        rsi_ticker = calculate_rs(stock_data)

        # GARCH Model
        garch_norm = arch_model(log_return, p=1, q=1, mean='constant', vol='GARCH', dist='normal')
        garch_norm_result = garch_norm.fit(disp='off')

        # VaR
        stock_vol = volatility_calc(log_return)
        VaR_5 = calculateVaR(stock_vol, 0.05)
        VaR_1 = calculateVaR(stock_vol, 0.01)

        # Chart series (last year of daily points + per-day Monte Carlo band)
        price_history, ma_series = build_series(stock_data['Close'], smas, ewms)
        mc_band = build_mc_band(simulation_df)

        current_rsi = safe_float(rsi_ticker.iloc[-1])
        rsi_interpretation = (
            "Overbought (>70)" if current_rsi and current_rsi > 70 else
            "Oversold (<30)" if current_rsi and current_rsi < 30 else
            "Neutral"
        ) if current_rsi is not None else None

        # Response matches the `metrics` JSONB contract in doc/data-model-v3.md
        # so the n8n enrichment step can store it as-is.
        output_data = {
            "ticker": ticker_sym,
            "analysis_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "current": {
                "last_price": last_price,
                "daily_volatility": float(stock_vol),
                "annualized_volatility": float(stock_vol * np.sqrt(252)),
                "rsi": current_rsi
            },
            "monte_carlo": {
                "num_simulations": num_simulations,
                "forecast_days": num_days,
                "expected_price": mean_price,
                "ci95": {"lower": lower_bound, "upper": upper_bound},
                "potential_return": float((mean_price - last_price) / last_price * 100),
                "downside_risk": float((lower_bound - last_price) / last_price * 100),
                "upside_potential": float((upper_bound - last_price) / last_price * 100),
                "band_series": mc_band
            },
            "price_history": price_history,
            "moving_averages": {
                "sma": {
                    "20": safe_float(smas[20].iloc[-1]),
                    "50": safe_float(smas[50].iloc[-1]),
                    "200": safe_float(smas[200].iloc[-1])
                },
                "ema": {
                    "20": safe_float(ewms[20].iloc[-1])
                },
                "series": ma_series
            },
            "technical": {
                "rsi_14": current_rsi,
                "interpretation": rsi_interpretation
            },
            "garch": {
                "omega": float(garch_norm_result.params['omega']),
                "alpha": float(garch_norm_result.params['alpha[1]']),
                "beta": float(garch_norm_result.params['beta[1]']),
                "conditional_volatility": float(garch_norm_result.conditional_volatility.iloc[-1]),
                "persistence": float(garch_norm_result.params['alpha[1]'] + garch_norm_result.params['beta[1]'])
            },
            "var": {
                "var_95": float(VaR_5),
                "var_99": float(VaR_1)
            },
            "performance": {
                "daily_return": safe_float(daily_returns.iloc[-1]),
                "avg_daily_return": float(daily_returns.mean()),
                "avg_monthly_return": float(monthly_returns.mean()),
                "sharpe_ratio": float(log_return.mean() / log_return.std() * np.sqrt(252)) if float(
                    log_return.std()) != 0 else None
            }
        }

        return jsonify(output_data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    import os

    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)