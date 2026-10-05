import type { HardhatUserConfig } from 'hardhat/config'

const config: HardhatUserConfig = {
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
}

export default config