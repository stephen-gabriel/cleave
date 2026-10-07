// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";

/// @notice Constant-product pool (one per leg) with fee taken on input.
/// Swaps emit post-swap reserves so the indexer never needs RPC calls.
contract Pool {
    IERC20 public immutable token;
    IERC20 public immutable quote;
    uint16 public immutable feeBps;

    uint256 public reserveToken;
    uint256 public reserveQuote;
    uint256 public totalShares;

    mapping(address => uint256) public shares;

    bool private _locked;

    /// @dev First-deposit shares permanently locked to resist share-price games.
    uint256 private constant DEAD_SHARES = 1000;

    event Swap(
        address indexed trader,
        bool isBuy,
        uint256 amountToken,
        uint256 amountQuote,
        uint256 fee,
        uint256 reserveToken,
        uint256 reserveQuote
    );

    event LiquidityChanged(
        address indexed provider,
        bool added,
        uint256 tokenAmt,
        uint256 quoteAmt,
        uint256 shares,
        uint256 reserveToken,
        uint256 reserveQuote
    );

    modifier nonReentrant() {
        require(!_locked, "Pool: reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    constructor(IERC20 _token, IERC20 _quote, uint16 _feeBps) {
        require(_feeBps <= 1000, "Pool: fee too high");
        token = _token;
        quote = _quote;
        feeBps = _feeBps;
    }

    function addLiquidity(
        uint256 tokenAmt,
        uint256 quoteAmt,
        uint256 minShares
    ) external nonReentrant returns (uint256 sh) {
        require(tokenAmt > 0 && quoteAmt > 0, "Pool: zero amounts");

        if (totalShares == 0) {
            sh = sqrt(tokenAmt * quoteAmt);
            require(sh > DEAD_SHARES, "Pool: tiny first deposit");
            totalShares = sh;
            shares[address(0)] = DEAD_SHARES;
            shares[msg.sender] = sh - DEAD_SHARES;
        } else {
            uint256 sh1 = (tokenAmt * totalShares) / reserveToken;
            uint256 sh2 = (quoteAmt * totalShares) / reserveQuote;
            sh = sh1 < sh2 ? sh1 : sh2;
            require(sh >= minShares, "Pool: slippage");
            require(sh > 0, "Pool: zero shares");
            totalShares += sh;
            shares[msg.sender] += sh;
        }

        reserveToken += tokenAmt;
        reserveQuote += quoteAmt;

        token.transferFrom(msg.sender, address(this), tokenAmt);
        quote.transferFrom(msg.sender, address(this), quoteAmt);

        emit LiquidityChanged(msg.sender, true, tokenAmt, quoteAmt, sh, reserveToken, reserveQuote);
    }

    function removeLiquidity(
        uint256 sh,
        uint256 minToken,
        uint256 minQuote
    ) external nonReentrant returns (uint256 tokenOut, uint256 quoteOut) {
        require(sh > 0, "Pool: zero shares");
        require(sh <= shares[msg.sender], "Pool: insufficient shares");

        tokenOut = (sh * reserveToken) / totalShares;
        quoteOut = (sh * reserveQuote) / totalShares;
        require(tokenOut >= minToken && quoteOut >= minQuote, "Pool: slippage");

        shares[msg.sender] -= sh;
        totalShares -= sh;
        reserveToken -= tokenOut;
        reserveQuote -= quoteOut;

        token.transfer(msg.sender, tokenOut);
        quote.transfer(msg.sender, quoteOut);

        emit LiquidityChanged(msg.sender, false, tokenOut, quoteOut, sh, reserveToken, reserveQuote);
    }

    function getAmountOut(
        bool tokenIn,
        uint256 amountIn
    ) public view returns (uint256 out, uint256 fee, uint256 priceImpactBps) {
        require(amountIn > 0, "Pool: zero input");
        require(reserveToken > 0 && reserveQuote > 0, "Pool: empty pool");

        uint256 amountInWithFee = (amountIn * (10000 - feeBps)) / 10000;
        if (tokenIn) {
            out = (reserveQuote * amountInWithFee) / (reserveToken + amountInWithFee);
        } else {
            out = (reserveToken * amountInWithFee) / (reserveQuote + amountInWithFee);
        }
        fee = amountIn - amountInWithFee;

        uint256 spotPrice = tokenIn
            ? (reserveQuote * 1e18) / reserveToken
            : (reserveToken * 1e18) / reserveQuote;
        uint256 execPrice = (out * 1e18) / amountIn;
        if (execPrice < spotPrice) {
            priceImpactBps = ((spotPrice - execPrice) * 10000) / spotPrice;
        } else {
            priceImpactBps = 0;
        }
    }

    function swapExactIn(
        bool tokenIn,
        uint256 amountIn,
        uint256 minOut
    ) external nonReentrant returns (uint256 out) {
        (out, , ) = getAmountOut(tokenIn, amountIn);
        require(out >= minOut, "Pool: slippage");

        if (tokenIn) {
            token.transferFrom(msg.sender, address(this), amountIn);
            reserveToken += amountIn;
            reserveQuote -= out;
            quote.transfer(msg.sender, out);
        } else {
            quote.transferFrom(msg.sender, address(this), amountIn);
            reserveQuote += amountIn;
            reserveToken -= out;
            token.transfer(msg.sender, out);
        }

        emit Swap(
            msg.sender,
            !tokenIn,
            tokenIn ? amountIn : out,
            tokenIn ? out : amountIn,
            (amountIn * feeBps) / 10000,
            reserveToken,
            reserveQuote
        );
    }

    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
