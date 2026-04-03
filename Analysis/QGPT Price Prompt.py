import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.stats import norm
import yfinance as yf
from datetime import datetime, timedelta
from arch import arch_model
import statsmodels as sm
import math
from var import VaR
import fear_and_greed
import json


ticker_sym = input("Enter stock ticker symbol: ").upper()

vix_ticker_symbol = "^VIX"
vix_ticker = yf.Ticker(vix_ticker_symbol)

fear_and_greed.get()
start_date = datetime(2019,1,1)
end_date = datetime.now()

stock_data = yf.download(ticker_sym, start=start_date,end=end_date)
vix_data = vix_ticker.history(start=start_date, end=end_date)

print(stock_data.head())

print(vix_data.tail())

#Returns
daily_returns = stock_data['Close'].pct_change()
monthly_returns = stock_data['Close'].resample('ME').ffill().pct_change()

print(daily_returns)
print(monthly_returns)


def log_returns(stock_data):
    # Assuming you're interested in the 'Close' prices
    log_returns = np.log(1 + stock_data['Close'].pct_change())
    log_returns = log_returns[1:]

    return log_returns

log_return = log_returns(stock_data)

#Monte Carlo Sim

def volatility_calc(lr):
    daily_volatility = np.std(lr)
    return daily_volatility

num_simulations = 10000
num_days = 3

# Get the closing price for the last day of the stock data
last_price = stock_data['Close'].iloc[-1]

def run_MonteCarlo(num_simulations,num_days,last_price,log_return):
    # Calculate daily volatility
    daily_vol = volatility_calc(log_return)

    # Initialize a list to store all simulation results
    all_simulations = []

    for x in range(num_simulations):
        price_series = [last_price]

        for y in range(1, num_days):
            price = price_series[-1] * (1 + np.random.normal(0, daily_vol))
            price_series.append(price)

        all_simulations.append(price_series)

    # Convert the list of simulations into a DataFrame all at once
    simulation_df = pd.DataFrame(all_simulations).transpose()

    return simulation_df

simulation_df = run_MonteCarlo(num_simulations, num_days, last_price, log_return)

# Prices at the final simulated day (across all simulations)
day_prices = simulation_df.iloc[-1].to_numpy(dtype=float)  # <- key fix

# 95% confidence interval
lower_bound = np.percentile(day_prices, 2.5)
upper_bound = np.percentile(day_prices, 97.5)

# Mean (expected) price
mean_price = np.mean(day_prices)

print(f"The expected price for {num_days} days later is: {mean_price}")
print(f"The 95% confidence interval for the price {num_days} days later is: ({lower_bound}, {upper_bound})")


#Moving averages

def simple_exp_ma (data, times):
    smas = {}
    ewms = {}
    for i in times:
        smas[i] = data.rolling(window=i).mean()
        ewms[i] = data.ewm(span=i, adjust=False).mean()

    return smas, ewms

# Get moving averages
smas, ewms = simple_exp_ma(stock_data['Close'], [20, 50, 200])

#Relative Strength Index

def calculate_rs(data):
    # Will use the positive and negative difference values in closing prices
    # to get an average gain and loss value (using a moving average specified as "days")
    # for a stock, then calculate the RSI using these values


    difference = data["Close"].diff(1) # Calculate adjusted close difference using the current row and previous row
    difference.dropna(inplace=True) # Uses pandas method dropna to remove rows that contain NULL values

    positive = difference.copy() # Create a new DF for positive differences
    negative = difference.copy() # Create a new DF for negative differences

    positive[positive < 0] = 0 # All negative values become 0 and positive values stay the same
    negative[negative > 0] = 0 # All positive values become 0 and negative values stay the same

    days = 14 # Moving average timeframe
    avg_gain = positive.rolling(window=days).mean() # Calculates the moving average based on close price using set amount of days
    avg_loss = abs(negative.rolling(window=days).mean()) # Calculates the moving average based on close price using set amount of days (made absolute to avoid negative numbers)

    ## Calculate RSI
    rs = avg_gain / avg_loss
    RSI = 100.0 - (100.0 / (1.0 + rs))
    return RSI


rsi_ticker = calculate_rs(stock_data)

print(rsi_ticker)
#GARCH volatility

# GARCH normal model
garch_norm= arch_model(log_return, p = 1, q = 1,
                      mean = 'constant', vol = 'GARCH', dist = 'normal')
# Fit the model
garch_norm_result = garch_norm.fit(update_freq = 4)

# Get summary
print(garch_norm_result.summary())

#VAR

def calculateVaR(risk, confidenceLevel, principal = 1, numMonths = 1):
    vol = math.sqrt(risk)
    return abs(principal * norm.ppf(1-confidenceLevel, 0, 1) * vol * math.sqrt(numMonths))

stock_vol = volatility_calc(log_return)
VaR_5 = calculateVaR(stock_vol, 0.05)
VaR_1 = calculateVaR(stock_vol, 0.01)


#Helper function to safely extract float values
def safe_float(value):
    """Safely convert pandas Series or scalar to float, return None if NaN"""
    try:
        if isinstance(value, pd.Series):
            val = value.values[0]
        else:
            val = value
        return None if pd.isna(val) else float(val)
    except:
        return None

# Create output data
output_data = {
    "ticker": ticker_sym,
    "analysis_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "data_range": {
        "start": start_date.strftime("%Y-%m-%d"),
        "end": end_date.strftime("%Y-%m-%d")
    },

    "current_metrics": {
        "last_price": float(last_price),
        "daily_volatility": float(stock_vol),
        "annualized_volatility": float(stock_vol * np.sqrt(252)),
        "current_rsi": safe_float(rsi_ticker.iloc[-1]),
        "vix_current": safe_float(vix_data['Close'].iloc[-1]) if len(vix_data) > 0 else None
    },

    "monte_carlo_simulation": {
        "num_simulations": num_simulations,
        "forecast_days": num_days,
        "expected_price": float(mean_price),
        "confidence_interval_95": {
            "lower": float(lower_bound),
            "upper": float(upper_bound)
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
        "annualized_volatility": float(garch_norm_result.conditional_volatility.iloc[-1] * np.sqrt(252)),
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
        "sharpe_ratio": float(log_return.mean() / log_return.std() * np.sqrt(252)) if float(log_return.std()) != 0 else None
    }
}

# Save to JSON file
output_filename = "stock_analysis_latest.json"
with open(output_filename, 'w') as f:
    json.dump(output_data, f, indent=2)

print(f"\n✅ Analysis saved to: {output_filename}")
print("\nNow push this file to GitHub!")
print("\nCommands:")
print("git add stock_analysis_latest.json")
print("git commit -m 'Update stock analysis'")
print("git push")

# Print summary
print("\n" + "=" * 60)
print("ANALYSIS SUMMARY")
print("=" * 60)
print(f"Ticker: {ticker_sym}")
print(f"Current Price: ${float(last_price):.2f}")
print(f"Expected Price (100d): ${mean_price:.2f}")
print(f"Expected Return: {output_data['monte_carlo_simulation']['potential_return']:.2f}%")
print(f"Volatility: {output_data['current_metrics']['daily_volatility'] * 100:.2f}%")
print(f"RSI: {output_data['technical_indicators']['rsi_14']:.2f}")
print(f"GARCH Persistence: {output_data['garch_model']['persistence']:.4f}")
print(f"VaR (95%): ${float(VaR_5):.4f}")
print(f"Sharpe Ratio: {output_data['performance']['sharpe_ratio']:.2f}")
print("=" * 60)