// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";

/// @notice Dividend declarations fed by the Chainlink CRE workflow (or the
/// labelled demo trigger).
contract DividendOracle is ReceiverTemplate {
    struct Declaration {
        uint64 id; // 1-based
        uint256 seq; // feed sequence (CRE) or 0 (DEMO)
        uint256 amountPerShare; // mUSD (1e18) per 1 mACME
        uint256 refPrice; // reference mACME price in mUSD (1e18), display only
        uint64 declaredAt;
        uint64 exAt; // declaredAt + NOTICE_SECONDS
        Source source;
    }

    enum Source {
        CRE,
        DEMO
    }

    uint64 public constant NOTICE_SECONDS = 60;
    uint64 public constant DEMO_COOLDOWN = 120;

    uint64 public count;
    uint256 public lastSeq;
    uint256 public lastRefPrice = 100e18;
    uint64 public lastDemoAt;

    mapping(uint64 => Declaration) internal _decl;

    event DividendDeclared(
        uint64 indexed id,
        uint256 seq,
        uint256 amountPerShare,
        uint256 refPrice,
        uint64 exAt,
        uint8 source
    );

    constructor(address _forwarderAddress) ReceiverTemplate(_forwarderAddress) {}

    function get(uint64 id) external view returns (Declaration memory) {
        return _decl[id];
    }

    function latest() external view returns (Declaration memory) {
        require(count > 0, "DividendOracle: no declarations");
        return _decl[count];
    }

    /// @dev CRE path: report = abi.encode(uint256 seq, uint256 amountPerShare, uint256 refPrice).
    /// Only callable by the configured forwarder (enforced by ReceiverTemplate).
    function _processReport(bytes calldata report) internal override {
        (uint256 seq, uint256 amountPerShare, uint256 refPrice) =
            abi.decode(report, (uint256, uint256, uint256));

        require(seq > lastSeq, "DividendOracle: seq must increase");
        _validate(amountPerShare, refPrice);

        lastSeq = seq;
        lastRefPrice = refPrice;
        count++;

        uint64 declaredAt = uint64(block.timestamp);
        uint64 exAt = declaredAt + NOTICE_SECONDS;

        _decl[count] = Declaration({
            id: count,
            seq: seq,
            amountPerShare: amountPerShare,
            refPrice: refPrice,
            declaredAt: declaredAt,
            exAt: exAt,
            source: Source.CRE
        });

        emit DividendDeclared(count, seq, amountPerShare, refPrice, exAt, uint8(Source.CRE));
    }

    /// @notice Demo path (anyone, labelled in the UI). Uses lastRefPrice.
    function declareDemo(uint256 amountPerShare) external {
        require(block.timestamp >= uint256(lastDemoAt) + DEMO_COOLDOWN, "DividendOracle: cooldown");
        _validate(amountPerShare, lastRefPrice);

        lastDemoAt = uint64(block.timestamp);
        uint256 seq = lastSeq + 1;
        lastSeq = seq;
        count++;

        uint64 declaredAt = uint64(block.timestamp);
        uint64 exAt = declaredAt + NOTICE_SECONDS;

        _decl[count] = Declaration({
            id: count,
            seq: seq,
            amountPerShare: amountPerShare,
            refPrice: lastRefPrice,
            declaredAt: declaredAt,
            exAt: exAt,
            source: Source.DEMO
        });

        emit DividendDeclared(count, seq, amountPerShare, lastRefPrice, exAt, uint8(Source.DEMO));
    }

    function _validate(uint256 amountPerShare, uint256 refPrice) internal pure {
        require(
            amountPerShare >= 0.01e18 && amountPerShare <= 5e18,
            "DividendOracle: bad amount"
        );
        require(refPrice >= 1e18 && refPrice <= 10_000e18, "DividendOracle: bad refPrice");
    }
}
