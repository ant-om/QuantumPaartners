from flask import Flask, request, jsonify
import numpy as np
import pandas as pd
from scipy.stats import norm
import yfinance as yf
from datetime import datetime
from arch import arch_model
import math
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

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
    except (ValueError, TypeError, IndexError):
        logger.warning(f"Could not convert value to float: {value}")
        return None


### API ENDPOINTS

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "message": "Stock Analysis API is running"})


@app.route('/analyze/<ticker>', methods=['GET'])
def analyze_get(ticker):
    """GET shorthand: /analyze/TSLA  (simulations=10000, days=100 defaults)"""
    return analyze_ticker(ticker, simulations=10000, days=100)


@app.route('/analyze', methods=['POST'])
def analyze():
    """POST: {"ticker": "TSLA", "simulations": 10000, "days": 100}"""
    data = request.json
    return analyze_ticker(
        data.get('ticker', 'TSLA'),
        simulations=data.get('simulations', 10000),
        days=data.get('days', 100)
    )


def analyze_ticker(ticker_sym, simulations=1000, days=2):
    try:
        num_simulations = simulations
        num_days = days

        # Fetch stock data
        start_date = datetime(2019, 1, 1)
        end_date = datetime.now()
        logger.info(f"Fetching data for {ticker_sym} from {start_date.date()} to {end_date.date()}")
        try:
            stock_data = yf.download(ticker_sym, start=start_date, end=end_date, progress=False)
        except Exception as e:
            logger.error(f"yfinance download failed for {ticker_sym}: {e}", exc_info=True)
            return jsonify({"error": f"Failed to fetch market data for {ticker_sym}"}), 500

        if stock_data.empty:
            logger.warning(f"No data returned for ticker: {ticker_sym}")
            return jsonify({"error": f"No data found for ticker {ticker_sym}"}), 404

        logger.info(f"Fetched {len(stock_data)} rows for {ticker_sym}")

        # Flatten MultiIndex columns (yfinance returns ticker-level column index)
        if isinstance(stock_data.columns, pd.MultiIndex):
            stock_data.columns = stock_data.columns.get_level_values(0)

        # Calculate metrics
        log_return = log_returns(stock_data)
        last_price = float(stock_data['Close'].iloc[-1])
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
        try:
            logger.info(f"Fitting GARCH(1,1) for {ticker_sym} with {len(log_return)} observations")
            garch_norm_result = garch_norm.fit(disp='off')
            logger.info(f"GARCH fit complete. Persistence: {garch_norm_result.params['alpha[1]'] + garch_norm_result.params['beta[1]']:.4f}")
        except Exception as e:
            logger.error(f"GARCH fitting failed for {ticker_sym}: {e}", exc_info=True)
            return jsonify({"error": "GARCH model fitting failed"}), 500

        # VaR
        stock_vol = volatility_calc(log_return)
        VaR_5 = calculateVaR(stock_vol, 0.05)
        VaR_1 = calculateVaR(stock_vol, 0.01)

        # Build response
        output_data = {
            "ticker": ticker_sym,
            "analysis_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "data_range": {
                "start": start_date.strftime("%Y-%m-%d"),
                "end": end_date.strftime("%Y-%m-%d")
            },
            "current_metrics": {
                "last_price": last_price,
                "daily_volatility": float(stock_vol),
                "annualized_volatility": float(stock_vol * np.sqrt(252)),
                "current_rsi": safe_float(rsi_ticker.iloc[-1])
            },
            "monte_carlo_simulation": {
                "num_simulations": num_simulations,
                "forecast_days": num_days,
                "expected_price": mean_price,
                "confidence_interval_95": {
                    "lower": lower_bound,
                    "upper": upper_bound
                },
                "potential_return": float((mean_price - last_price) / last_price * 100),
                "downside_risk": float((lower_bound - last_price) / last_price * 100),
                "upside_potential": float((upper_bound - last_price) / last_price * 100)
            },
            "moving_averages": {
                "simple": {
                    "20": safe_float(smas[20].iloc[-1]),
                    "50": safe_float(smas[50].iloc[-1]),
                    "200": safe_float(smas[200].iloc[-1])
                },
                "exponential": {
                    "20": safe_float(ewms[20].iloc[-1])
                }
            },
            "technical_indicators": {
                "rsi_14": safe_float(rsi_ticker.iloc[-1]),
                "rsi_interpretation": (
                    "Overbought (>70)" if safe_float(rsi_ticker.iloc[-1]) and safe_float(rsi_ticker.iloc[-1]) > 70 else
                    "Oversold (<30)" if safe_float(rsi_ticker.iloc[-1]) and safe_float(rsi_ticker.iloc[-1]) < 30 else
                    "Neutral"
                ) if safe_float(rsi_ticker.iloc[-1]) is not None else None
            },
            "garch_model": {
                "model_type": "GARCH(1,1)",
                "parameters": {
                    "omega": float(garch_norm_result.params['omega']),
                    "alpha": float(garch_norm_result.params['alpha[1]']),
                    "beta": float(garch_norm_result.params['beta[1]'])
                },
                "conditional_volatility_latest": float(garch_norm_result.conditional_volatility.iloc[-1]),
                "persistence": float(garch_norm_result.params['alpha[1]'] + garch_norm_result.params['beta[1]'])
            },
            "value_at_risk": {
                "var_95_percent": {
                    "value": float(VaR_5),
                    "interpretation": f"95% confidence: Maximum expected loss is ${VaR_5:.2f} per $1 invested"
                },
                "var_99_percent": {
                    "value": float(VaR_1),
                    "interpretation": f"99% confidence: Maximum expected loss is ${VaR_1:.2f} per $1 invested"
                }
            },
            "performance": {
                "daily_return_latest": safe_float(daily_returns.iloc[-1]),
                "avg_daily_return": float(daily_returns.mean()),
                "avg_monthly_return": float(monthly_returns.mean()),
                "sharpe_ratio": float(log_return.mean() / log_return.std() * np.sqrt(252)) if float(
                    log_return.std()) != 0 else None
            }
        }

        return jsonify(output_data)

    except Exception as e:
        logger.exception(f"Unhandled error analyzing {ticker_sym} (simulations={num_simulations}, days={num_days})")
        return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    import os

    port = int(os.environ.get('PORT', 8080))
    logger.info(f"Starting Stock Analysis API on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)