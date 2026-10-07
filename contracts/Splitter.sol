// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";
import {SplitToken} from "./SplitToken.sol";
import {DividendOracle} from "./DividendOracle.sol";
import {MockUSD} from "./MockUSD.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Splitter {
    using SafeERC20 for IERC20;
    using SafeERC20 for MockUSD;

    IERC20 public immutable stock;
    MockUSD public immutable usd;
    DividendOracle public immutable oracle;
    uint64 public immutable maturity;
    uint8 public immutable plannedDividends;

    SplitToken public priceLeg;
    SplitToken public dividendLeg;

    uint64 public nextDistributionId = 1;

    bool private _locked;

    event Split(address indexed user, uint256 amount);
    event Merge(address indexed user, uint256 amount);
    event Redeem(address indexed user, uint256 amount);
    event DividendDistributed(uint64 indexed id, uint256 total, uint256 supply, address caller);

    modifier nonReentrant() {
        require(!_locked, "Splitter: reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    constructor(
        IERC20 _stock,
        MockUSD _usd,
        DividendOracle _oracle,
        uint64 _maturity,
        uint8 _plannedDividends
    ) {
        stock = _stock;
        usd = _usd;
        oracle = _oracle;
        maturity = _maturity;
        plannedDividends = _plannedDividends > 0 ? _plannedDividends : 6;
        
        priceLeg = new SplitToken("Cleave Price Leg ACME-A", "pACME-A", false);
        dividendLeg = new SplitToken("Cleave Dividend Leg ACME-A", "dACME-A", true);
        dividendLeg.setUSD(address(_usd));
    }

    function split(uint256 amount) external nonReentrant {
        require(block.timestamp < maturity, "Splitter: matured");
        require(amount > 0, "Splitter: zero amount");
        
        stock.transferFrom(msg.sender, address(this), amount);
        priceLeg.mint(msg.sender, amount);
        dividendLeg.mint(msg.sender, amount);
        
        emit Split(msg.sender, amount);
    }

    function merge(uint256 amount) external nonReentrant {
        require(block.timestamp < maturity, "Splitter: matured");
        require(amount > 0, "Splitter: zero amount");
        
        // Settle dividends before burning
        dividendLeg.claimWithToken(address(usd));
        priceLeg.burn(msg.sender, amount);
        dividendLeg.burn(msg.sender, amount);
        stock.transfer(msg.sender, amount);
        
        emit Merge(msg.sender, amount);
    }

    function redeem(uint256 amount) external nonReentrant {
        require(block.timestamp >= maturity, "Splitter: not matured");
        require(amount > 0, "Splitter: zero amount");
        
        priceLeg.burn(msg.sender, amount);
        stock.transfer(msg.sender, amount);
        
        emit Redeem(msg.sender, amount);
    }

    function distribute() external nonReentrant {
        uint64 id = nextDistributionId;
        require(id <= oracle.count(), "Splitter: no declaration");
        
        DividendOracle.Declaration memory d = oracle.get(id);
        require(block.timestamp >= d.exAt, "Splitter: too early");
        require(block.timestamp < maturity, "Splitter: matured");
        
        uint256 locked = dividendLeg.totalSupply();
        uint256 total = 0;
        if (locked > 0) {
            total = (d.amountPerShare * locked) / 1e18;
            usd.mintTo(address(dividendLeg), total);
            dividendLeg.notifyDividend(total);
        }
        
        nextDistributionId++;
        emit DividendDistributed(id, total, locked, msg.sender);
    }

    function distributedCount() external view returns (uint64) {
        return nextDistributionId > 0 ? nextDistributionId - 1 : 0;
    }

    function remainingDividends() external view returns (uint256) {
        uint64 dist = nextDistributionId > 0 ? nextDistributionId - 1 : 0;
        if (dist >= plannedDividends) return 0;
        return plannedDividends - dist;
    }
}
