// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";

contract SplitToken is IERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public immutable splitter;
    bool public immutable isDividendLeg;

    // Dividend accumulator
    uint256 public constant SCALE = 1e36;
    uint256 public accPerToken;
    mapping(address => uint256) public paid;
    mapping(address => uint256) public owed;

    event Claimed(address indexed account, uint256 amount);

    modifier onlySplitter() {
        require(msg.sender == splitter, "SplitToken: not splitter");
        _;
    }

    constructor(string memory _name, string memory _symbol, bool _isDividendLeg) {
        name = _name;
        symbol = _symbol;
        isDividendLeg = _isDividendLeg;
        splitter = msg.sender;
    }

    function mint(address to, uint256 value) external onlySplitter {
        _mint(to, value);
    }

    function burn(address from, uint256 value) external onlySplitter {
        _burn(from, value);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _update(msg.sender, to, value);
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "ERC20: insufficient allowance");
            unchecked {
                allowance[from][msg.sender] = allowed - value;
            }
        }
        _update(from, to, value);
        emit Transfer(from, to, value);
        return true;
    }

    function _mint(address to, uint256 value) private {
        if (isDividendLeg && totalSupply > 0) {
            _settle(to);
        } else if (isDividendLeg) {
            paid[to] = accPerToken;
        }
        require(to != address(0), "ERC20: mint to zero");
        totalSupply += value;
        unchecked {
            balanceOf[to] += value;
        }
        if (isDividendLeg && totalSupply > 0) {
            // After mint, need to adjust paid? No - accPerToken unchanged; _settle not needed if just minted; but easier to handle in update/mint
        }
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) private {
        if (isDividendLeg) {
            _settle(from);
        }
        uint256 bal = balanceOf[from];
        require(bal >= value, "ERC20: insufficient balance");
        unchecked {
            balanceOf[from] = bal - value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }

    function _update(address from, address to, uint256 value) internal {
        if (isDividendLeg) {
            _settle(from);
            _settle(to);
        }
        uint256 fromBal = balanceOf[from];
        require(fromBal >= value, "ERC20: insufficient balance");
        unchecked {
            balanceOf[from] = fromBal - value;
            balanceOf[to] += value;
        }
    }

    function _settle(address a) internal {
        if (a == address(0)) return;
        if (totalSupply == 0) {
            paid[a] = accPerToken;
            return;
        }
        owed[a] += (balanceOf[a] * (accPerToken - paid[a])) / SCALE;
        paid[a] = accPerToken;
    }

    function notifyDividend(uint256 total) external onlySplitter {
        require(isDividendLeg, "SplitToken: not dividend leg");
        require(totalSupply > 0, "SplitToken: zero supply");
        accPerToken += (total * SCALE) / totalSupply;
    }

    function pending(address a) public view returns (uint256) {
        if (!isDividendLeg || totalSupply == 0) {
            return owed[a];
        }
        return owed[a] + (balanceOf[a] * (accPerToken - paid[a])) / SCALE;
    }

    function claim() external {
        require(isDividendLeg, "SplitToken: not dividend leg");
        _settle(msg.sender);
        uint256 o = owed[msg.sender];
        owed[msg.sender] = 0;
        // Note: mUSD transfer handled by caller context? No wait - need to know mUSD address
        // mUSD is set by Splitter after deployment
        emit Claimed(msg.sender, o);
    }

    // Need to store mUSD reference for dividend leg claims
    address public usd;
    
    function setUSD(address _usd) external onlySplitter {
        usd = _usd;
    }

    function claimWithToken(address token) external {
        require(isDividendLeg, "SplitToken: not dividend leg");
        _settle(msg.sender);
        uint256 o = owed[msg.sender];
        owed[msg.sender] = 0;
        IERC20(token).transfer(msg.sender, o);
        emit Claimed(msg.sender, o);
    }
}
