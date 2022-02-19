const ethers = require('ethers');
const input = require("input");
require('dotenv').config();
const addresses = {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    pancakeRouter: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    buyContract: '0xDC56800e179964C3C00a73f73198976397389d26',
    recipient: process.env.recipient
}
const mnemonic = process.env.mnemonic;
const node = 'https://bsc-dataseed.binance.org/';
const wallet = new ethers.Wallet.fromMnemonic(mnemonic);
const provider = new ethers.providers.JsonRpcProvider(node);
const account = wallet.connect(provider);
const pancakeAbi = [
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
    'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)'
];
const pancakeRouter = new ethers.Contract(addresses.pancakeRouter, pancakeAbi, account);
let tokenAbi = [
    'function approve(address spender, uint amount) public returns(bool)',
    'function balanceOf(address account) external view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint amount)',
    'function name() view returns (string)',
    'function buyTokens(address tokenAddress, address to) payable',
    'function decimals() external view returns (uint8)'
];
let token = [];
var sellCount = 0;
var buyCount = 0;
const buyContract = new ethers.Contract(addresses.buyContract, tokenAbi, account);
const myGasPriceForApproval = ethers.utils.parseUnits('6', 'gwei');
const myGasLimit = 1500000;

/**
 * 
 * Buy tokens
 * 
 * */
async function buy() {

    const value = ethers.utils.parseUnits(token[buyCount].investmentAmount, 'ether').toString();
    const tx = await buyContract.buyTokens(token[buyCount].tokenAddress, addresses.recipient,
        {
            value: value,
            gasPrice: token[buyCount].gasPrice,
            gasLimit: myGasLimit

        });
    const receipt = await tx.wait();
    console.log("Buy transaction hash: ", receipt.transactionHash);
    token[buyCount].didBuy = true;
    buyCount++;
    approve();


}
/**
 * 
 * Approve tokens
 * 
 * */
async function approve() {
    let contract = token[buyCount - 1].contract;
    const valueToApprove = ethers.constants.MaxUint256;
    const tx = await contract.approve(
        pancakeRouter.address,
        valueToApprove, {
        gasPrice: myGasPriceForApproval,
        gasLimit: 210000
    }
    );
    const receipt = await tx.wait();
    console.log("Approve transaction hash: ", receipt.transactionHash);
    token[buyCount - 1].checkProfit();

}

/**
 * 
 * Check for profit
 * 
 * */
async function getCurrentValue(token) {
    let bal = await token.contract.balanceOf(addresses.recipient);
    const amount = await pancakeRouter.getAmountsOut(bal, token.sellPath);
    let currentValue = amount[1];
    return currentValue;
}
async function setStopLoss(token) {
    token.intitialValue = await getCurrentValue(token);
    token.stopLoss = ethers.utils.parseUnits((parseFloat(ethers.utils.formatUnits(await getCurrentValue(token))) - parseFloat(ethers.utils.formatUnits(await getCurrentValue(token))) * (token.stopLossPercent / 100)).toFixed(18).toString());
}
function setStopLossTrailing(token, stopLossTrailing) {
    token.trailingStopLossPercent += token.initialTrailingStopLossPercent;
    token.stopLoss = stopLossTrailing;
}

async function checkForProfit(token) {
    var sellAttempts = 0;
    await setStopLoss(token);
    token.contract.on("Transfer", async (from, to, value, event) => {
        const tokenName = await token.contract.name();
        let currentValue = await getCurrentValue(token);
        const takeProfit = (parseFloat(ethers.utils.formatUnits(token.intitialValue)) * (token.profitPercent + token.tokenSellTax) / 100 + parseFloat(ethers.utils.formatUnits(token.intitialValue))).toFixed(18).toString();
        const profitDesired = ethers.utils.parseUnits(takeProfit);
        let stopLossTrailing = ethers.utils.parseUnits((parseFloat(ethers.utils.formatUnits(token.intitialValue)) * (token.trailingStopLossPercent / 100 - token.tokenSellTax / 100) + parseFloat(ethers.utils.formatUnits(token.intitialValue))).toFixed(18).toString());
        let stopLoss = token.stopLoss;

        console.log(ethers.utils.formatUnits(stopLossTrailing));
        if (currentValue.gt(stopLossTrailing) && token.trailingStopLossPercent > 0) {
            setStopLossTrailing(token, stopLossTrailing);
            console.log(true, token.trailingStopLossPercent);
        }
        let timeStamp = new Date().toLocaleString();
        const enc = (s) => new TextEncoder().encode(s);
        process.stdout.write(enc(`${timeStamp} --- ${tokenName} --- Current Value in BNB: ${ethers.utils.formatUnits(currentValue)} --- Profit At: ${ethers.utils.formatUnits(profitDesired)} --- Stop Loss At: ${ethers.utils.formatUnits(stopLoss)}  \r`));
        //console.log(`${timeStamp} --- ${tokenName} --- Current Value in BNB: ${ethers.utils.formatUnits(currentValue)} --- Profit At: ${ethers.utils.formatUnits(profitDesired)} --- Stop Loss At: ${ethers.utils.formatUnits(token.stopLoss)} `);
        if (currentValue.gte(profitDesired)) {
            if (buyCount <= numberOfTokensToBuy && !token.didSell && token.didBuy && sellAttempts == 0) {
                sellAttempts++;
                console.log("Selling", tokenName, "now profit target reached", "\n");
                sell(token, true);
                token.contract.removeAllListeners();
            }
        }

        if (currentValue.lte(stopLoss)) {
            console.log("less than");
            if (buyCount <= numberOfTokensToBuy && !token.didSell && token.didBuy && sellAttempts == 0) {
                sellAttempts++;
                console.log("Selling", tokenName, "now stoploss reached", "\n");
                sell(token, false);
                token.contract.removeAllListeners();
            }
        }
    });
}

/**
 * 
 * Sell tokens
 * 
 * */
async function sell(tokenObj, isProfit) {
    try {
        const bal = await tokenObj.contract.balanceOf(addresses.recipient);
        const decimals = await tokenObj.contract.decimals();
        var balanceString;
        if (isProfit) {
            balanceString = (parseFloat(ethers.utils.formatUnits(bal.toString(), decimals)) * (tokenObj.percentOfTokensToSellProfit / 100)).toFixed(decimals).toString();
        } else {
            balanceString = (parseFloat(ethers.utils.formatUnits(bal.toString(), decimals)) * (tokenObj.percentOfTokensToSellLoss / 100)).toFixed(decimals).toString();
        }
        const balanceToSell = ethers.utils.parseUnits(balanceString, decimals);
        const sellAmount = await pancakeRouter.getAmountsOut(balanceToSell, tokenObj.sellPath);
        const sellAmountsOutMin = sellAmount[1].sub(sellAmount[1].div(2));

        const tx = await pancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(
            sellAmount[0].toString(),
            0,
            tokenObj.sellPath,
            addresses.recipient,
            Math.floor(Date.now() / 1000) + 60 * 3, {
            gasPrice: myGasPriceForApproval,
            gasLimit: myGasLimit,

        }
        );
        const receipt = await tx.wait();
        console.log("Sell transaction hash: ", receipt.transactionHash);
        sellCount++;
        token[tokenObj.index].didSell = true;

        if (sellCount == numberOfTokensToBuy) {
            console.log("All tokens sold");
            process.exit();
        }

    } catch (e) {
    }
}
(async () => {
    const address = await input.text("Enter Contract Address to buy");
    const investmentAmount = await input.text("Enter Investment Amount in BNB");
    const tokenTax = parseInt(await input.text("Enter token's approximate tax"));
    const gasPrice = ethers.utils.parseUnits(await input.text("Enter Gas Price"), 'gwei');
    const profitPercent = parseFloat(await input.text("Enter profit percent you want"));
    const stopLossPercent = parseFloat(await input.text("Enter max loss percent"));
    const trailingStopLossPercent = parseFloat(await input.text("Enter trailing stop loss percent"));
    const percentOfTokensToSellProfit = parseFloat(await input.text("Enter percent of tokens to sell when profit reached"));
    const percentOfTokensToSellLoss = parseFloat(await input.text("Enter percent of tokens to sell when stop loss reached"));
    const choices = ['Buy Now', 'No']
    await input.select('Confirm buy now', choices).then(async function (answers) {
        if (answers == 'Buy Now') {
            if (ethers.utils.isAddress(address)) {
                token.push({
                    tokenAddress: address,
                    didBuy: false,
                    hasSold: false,
                    tokenSellTax: tokenTax,
                    buyPath: [addresses.WBNB, address],
                    sellPath: [address, addresses.WBNB],
                    contract: new ethers.Contract(address, tokenAbi, account),
                    index: buyCount,
                    investmentAmount: investmentAmount,
                    profitPercent: profitPercent,
                    stopLossPercent: stopLossPercent,
                    gasPrice: gasPrice,
                    checkProfit: function () { checkForProfit(this); },
                    percentOfTokensToSellProfit: percentOfTokensToSellProfit,
                    percentOfTokensToSellLoss: percentOfTokensToSellLoss,
                    initialTrailingStopLossPercent: 0,
                    trailingStopLossPercent: trailingStopLossPercent,
                    stopLoss: 0,
                    intitialValue: 0
                });
                buy();
            }
        } else {
            process.exit();
        }
    });

})();
