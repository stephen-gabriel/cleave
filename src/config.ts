import { MOCK_STOCK_ABI } from './chain/abis'

export const EVM_ACCOUNT_PATH = "m/44'/60'/0'/0/0"

export const MOCK_STOCK_ADDRESS = import.meta.env.VITE_MOCK_STOCK_ADDRESS
export const DEPLOYER_ADDRESS = import.meta.env.VITE_DEPLOYER_ADDRESS

export { MOCK_STOCK_ABI }

// Transaction params
export const SEND_AMOUNT_MON = '0.01'
export const FUND_DEPLOYER_AMOUNT_MON = '0.25'
export const TRANSFER_GAS_LIMIT = 21_000n
export const MINT_GAS_LIMIT = 100_000n
