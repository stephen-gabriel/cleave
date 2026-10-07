// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";

contract CalculatorConsumer is ReceiverTemplate {
    struct CalculatorResult {
        uint256 offchainValue;
        int256 onchainValue;
        uint256 finalResult;
    }

    CalculatorResult public latestResult;
    uint256 public resultCount;

    mapping(uint256 => CalculatorResult) public results;

    event ResultUpdated(
        uint256 indexed resultId,
        uint256 finalResult
    );

    constructor(address _forwarderAddress)
        ReceiverTemplate(_forwarderAddress)
    {}

    function _processReport(
        bytes calldata report
    ) internal override {
        CalculatorResult memory calculatorResult =
            abi.decode(report, (CalculatorResult));

        resultCount++;
        results[resultCount] = calculatorResult;
        latestResult = calculatorResult;

        emit ResultUpdated(
            resultCount,
            calculatorResult.finalResult
        );
    }

    function isResultAnomalous(
        CalculatorResult memory _prospectiveResult
    ) public view returns (bool) {
        if (resultCount == 0) {
            return false;
        }

        return
            _prospectiveResult.finalResult >
            (latestResult.finalResult * 2);
    }
}