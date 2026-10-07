// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Mock USD (mUSD) — testnet quote token with a public faucet.
/// The Splitter is an allowed minter so `distribute()` can pay dividends.
contract MockUSD is IERC20, Ownable {
    string public constant name = "Mock USD";
    string public constant symbol = "mUSD";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    mapping(address => bool) public minters;

    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);

    modifier onlyMinter() {
        require(minters[msg.sender], "MockUSD: not a minter");
        _;
    }

    constructor() Ownable(msg.sender) {}

    /// @notice Mints 10,000e18 mUSD to the caller. Unlimited: testnet mock.
    function faucet() external {
        _mint(msg.sender, 10_000e18);
    }

    /// @notice Owner mint, used for seeding.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Owner toggles an address's ability to call `mintTo`.
    function setMinter(address minter, bool allowed) external onlyOwner {
        require(minter != address(0), "MockUSD: zero address");
        if (allowed && !minters[minter]) {
            minters[minter] = true;
            emit MinterAdded(minter);
        } else if (!allowed && minters[minter]) {
            minters[minter] = false;
            emit MinterRemoved(minter);
        }
    }

    /// @notice Mint by an allowed minter only (used by Splitter.distribute).
    function mintTo(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
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
        _transfer(from, to, value);
        return true;
    }

    function _mint(address to, uint256 value) private {
        require(to != address(0), "ERC20: mint to the zero address");
        totalSupply += value;
        unchecked {
            balanceOf[to] += value;
        }
        emit Transfer(address(0), to, value);
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "ERC20: transfer to the zero address");
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= value, "ERC20: insufficient balance");
        unchecked {
            balanceOf[from] = fromBalance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
