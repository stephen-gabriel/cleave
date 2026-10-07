import hardhatToolboxViemPlugin from '@nomicfoundation/hardhat-toolbox-viem'
import { defineConfig } from 'hardhat/config'

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        compilers: [{ version: '0.8.28', settings: { evmVersion: 'paris' } }],
      },
    },
  },
  networks: {
    monadTestnet: {
      type: 'http',
      chainType: 'generic',
      url: process.env.MONAD_TESTNET_RPC ?? 'https://testnet-rpc.monad.xyz',
      chainId: 10143,
    },
  },
})
