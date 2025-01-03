const Binance = require("binance-api-node").default;
const express = require("express");
dotenv = require("dotenv").config();

const totalMarginSize = process.env.TOTAL_MARGIN_SIZE;
const targetLeverage = process.env.TARGET_LEVERAGE;
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;

const binanceClient = Binance({
  apiKey: BINANCE_API_KEY,
  apiSecret: BINANCE_API_SECRET,
  futures: true,
});

const app = express();
app.use(express.json());

// const signal = parseSignal({
//   symbol: "XRPUSDT",
//   price: "0.2745",
//   signal: "Buy",
// });

// if (signal) {
//   placeOrder(signal);
// }

// Function to parse incoming webhook messages
function parseSignal(jsonSignal) {
  try {
    const { symbol, price, signal } = jsonSignal;
    let newSymbol = symbol;
    if (!signal) {
      return "No actionable signal found";
    }
    // Remove .P suffix if it exists
    if (symbol.includes(".P")) {
      newSymbol = symbol.replace(".P", "").trim();
    }

    return {
      symbol: newSymbol,
      signal,
      entry: parseFloat(price),
    };
  } catch (err) {
    return `Error parsing signal: ${err}`;
  }
}

async function placeOrder(signal) {
  try {
    const side = signal.signal.toUpperCase() === "BUY" ? "BUY" : "SELL";
    // Fetch market price and instrument details
    const marketPriceData = await binanceClient.futuresPrices({
      symbol: signal.symbol,
    });

    if (!marketPriceData || !marketPriceData[signal.symbol]) {
      return `Failed to get tickers`;
    }

    const symbolPrice = parseFloat(marketPriceData[signal.symbol]);

    // Fetch symbol info to get LOT_SIZE filter
    const symbolInfo = await binanceClient.futuresExchangeInfo();
    const symbolDetails = symbolInfo.symbols.find(
      (s) => s.symbol === signal.symbol
    );

    if (!symbolDetails) {
      return `Symbol details not found for ${signal.symbol}`;
    }

    const lotSizeFilter = symbolDetails.filters.find(
      (f) => f.filterType === "LOT_SIZE"
    );
    const minQty = parseFloat(lotSizeFilter.minQty);
    const stepSize = parseFloat(lotSizeFilter.stepSize);

    // Calculate the correct quantity for the target leverage
    const targetNotional = totalMarginSize * targetLeverage;
    let calculatedQuantity = (targetNotional / symbolPrice).toFixed(8);

    // Adjust quantity to match LOT_SIZE filter
    calculatedQuantity = Math.max(
      minQty,
      Math.floor(calculatedQuantity / stepSize) * stepSize
    ).toFixed(8);

    // Check and close opposite position if exists
    const positionInfo = await binanceClient.futuresPositionRisk({
      symbol: signal.symbol,
    });

    if (positionInfo && positionInfo.length > 0) {
      const position = positionInfo[0];

      if (
        (side === "BUY" && parseFloat(position.positionAmt) > 0) ||
        (side === "SELL" && parseFloat(position.positionAmt) < 0)
      ) {
        return `Position already exists for ${signal.symbol}`;
      } else if (
        (side === "BUY" && parseFloat(position.positionAmt) < 0) ||
        (side === "SELL" && parseFloat(position.positionAmt) > 0)
      ) {
        // Close opposite position
        const closeOrderParams = {
          symbol: signal.symbol,
          side: side,
          type: "MARKET",
          quantity: Math.abs(parseFloat(position.positionAmt)),
        };
        await binanceClient.futuresOrder(closeOrderParams);
      }
    }

    // Create order parameters
    const orderParams = {
      symbol: signal.symbol,
      side: side,
      type: "MARKET",
      quantity: calculatedQuantity,
    };

    // Send order request
    const response = await binanceClient.futuresOrder(orderParams);

    if (!response || response.status !== "NEW") {
      return `Order rejected: ${response.msg}`;
    } else {
      console.log(
        `Market Order placed: ${signal.symbol} ${side}, Quantity: ${calculatedQuantity}`
      );
    }

    // // Set Take Profit and Stop Loss
    // const takeProfitPrice1 =
    //   side === "BUY"
    //     ? (symbolPrice * 1.01).toFixed(4)
    //     : (symbolPrice * 0.99).toFixed(4); // %1 yukarı/aşağı fiyat

    // const takeProfitPrice2 =
    //   side === "BUY"
    //     ? (symbolPrice * 1.02).toFixed(4)
    //     : (symbolPrice * 0.98).toFixed(4); // %2 yukarı/aşağı fiyat
    // const stopLossPrice =
    //   side === "BUY"
    //     ? (symbolPrice * 0.98).toFixed(4)
    //     : (symbolPrice * 1.02).toFixed(4); // %1.8 aşağı/yukarı fiyat

    // // Create Take Profit order
    // const takeProfitParams1 = {
    //   symbol: signal.symbol,
    //   side: side === "BUY" ? "SELL" : "BUY",
    //   type: "TAKE_PROFIT_MARKET",
    //   quantity: calculatedQuantity,
    //   stopPrice: takeProfitPrice1,
    //   reduceOnly: true,
    // };

    // const takeProfitParams2 = {
    //   ...takeProfitParams1,
    //   stopPrice: takeProfitPrice2,
    // };

    // try {
    //   const takeProfitResponse1 = await binanceClient.futuresOrder(
    //     takeProfitParams1
    //   );
    //   if (!takeProfitResponse1 || takeProfitResponse1.status !== "NEW") {
    //     console.log(`Take profit 1 rejected: ${takeProfitResponse1.msg}`);
    //   } else {
    //     console.log(
    //       `Take profit order 1 placed: ${signal.symbol} at ${takeProfitPrice1}`
    //     );
    //   }

    //   const takeProfitResponse2 = await binanceClient.futuresOrder(
    //     takeProfitParams2
    //   );
    //   if (!takeProfitResponse2 || takeProfitResponse2.status !== "NEW") {
    //     console.log(`Take profit 2 rejected: ${takeProfitResponse2.msg}`);
    //   } else {
    //     console.log(
    //       `Take profit order 2 placed: ${signal.symbol} at ${takeProfitPrice2}`
    //     );
    //   }
    // } catch (error) {
    //   console.log(
    //     `An error occurred while placing take profit orders: ${JSON.stringify(
    //       error
    //     )}`
    //   );
    // }

    // // Create Stop Loss order
    // const stopLossParams = {
    //   symbol: signal.symbol,
    //   side: side === "BUY" ? "SELL" : "BUY",
    //   type: "STOP_MARKET",
    //   quantity: calculatedQuantity,
    //   stopPrice: stopLossPrice,
    //   reduceOnly: true,
    // };

    // try {
    //   const stopLossResponse = await binanceClient.futuresOrder(stopLossParams);
    //   if (!stopLossResponse || stopLossResponse.status !== "NEW") {
    //     console.log(`Stop Loss rejected: ${stopLossResponse.msg}`);
    //   } else {
    //     console.log(`Stop Loss set for ${signal.symbol} at ${stopLossPrice}`);
    //   }
    // } catch (error) {
    //   console.log(
    //     `An error occurred while placing the stop loss order: ${JSON.stringify(
    //       error
    //     )}`
    //   );
    // }
  } catch (error) {
    return `An error occurred while placing the order: ${JSON.stringify(
      error
    )}`;
  }
}

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  const signal = parseSignal(req.body);

  if (signal) {
    const response = await placeOrder(signal);
    res.status(200).send(response);
  } else {
    res.status(400).send("Invalid signal received.");
  }
});

// Root endpoint
app.get("/", (req, res) => {
  res.status(200).send(`BINANCE TRADING BOT IS RUNNING`);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// //WebSocket client for order updates
// binanceClient.ws.futuresUser(async (data) => {
//   if (data.eventType === "ORDER_TRADE_UPDATE") {
//     const orderData = data.order;
//     const orderStatus = orderData.orderStatus;

//     if (orderStatus === "FILLED" && orderData.type === "TAKE_PROFIT_MARKET") {
//       // Cancel existing Stop Loss order if any
//       const existingOrders = await binanceClient.futuresOpenOrders({
//         symbol: orderData.symbol,
//       });

//       for (const order of existingOrders) {
//         if (order.type === "STOP_MARKET") {
//           const cancelResponse = await binanceClient.futuresCancelOrder({
//             symbol: orderData.symbol,
//             orderId: order.orderId,
//           });

//           if (!cancelResponse || cancelResponse.status !== "CANCELED") {
//             console.error(
//               `Failed to cancel existing Stop Loss order: ${cancelResponse.msg}`
//             );
//           } else {
//             console.log(`Existing Stop Loss order ${order.orderId} cancelled.`);
//           }
//         }
//       }

//       // Calculate Stop Loss price
//       const symbolPrice = orderData.avgPrice;
//       const side = orderData.side;
//       const stopLossPrice =
//         side === "SELL"
//           ? (symbolPrice * 0.981).toFixed(4)
//           : (symbolPrice * 1.019).toFixed(4);

//       // Create Stop Loss order
//       const stopLossResponse = await binanceClient.futuresOrder({
//         symbol: orderData.symbol,
//         side: side === "SELL" ? "BUY" : "SELL",
//         type: "STOP_MARKET",
//         quantity: orderData.origQty,
//         stopPrice: stopLossPrice,
//         reduceOnly: true,
//       });

//       if (!stopLossResponse || stopLossResponse.status !== "NEW") {
//         return `Stop Loss rejected: ${stopLossResponse.msg}`;
//       } else {
//         return `Stop Loss set for ${orderData.symbol} at ${stopLossPrice}`;
//       }
//     }
//   }
// });
