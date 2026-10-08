import {
  CronCapability,
  HTTPClient,
  EVMClient,
  handler,
  consensusIdenticalAggregation,
  Runner,
  type NodeRuntime,
  type Runtime,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  encodeCallMsg,
  bytesToHex,
  hexToBase64,
} from "@chainlink/cre-sdk"
import {
  encodeFunctionData,
  decodeFunctionResult,
  zeroAddress,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem"
import { DividendOracle } from "./contracts/abi/DividendOracle"

type EvmConfig = {
  oracleAddress: string
  chainName: string
  gasLimit: string
}

type Config = {
  schedule: string
  apiUrl: string
  evms: EvmConfig[]
}

type Feed = {
  seq: number
  amountPerShare: string
  refPrice: string
}

type MyResult = {
  feedSeq: number
  amountPerShare: bigint
  refPrice: bigint
  lastSeqOnChain: bigint
  wrote: boolean
  txHash: string
}

const initWorkflow = (config: Config) => {
  const cron = new CronCapability()

  return [
    handler(
      cron.trigger({ schedule: config.schedule }),
      onCronTrigger,
    ),
  ]
}

/// Decimal string -> 1e18 integer without floating point math.
/// "1.05" -> 1050000000000000000n
const toUnit = (value: string): bigint => {
  const s = value.trim()
  if (!/^\d+(\.\d{1,18})?$/.test(s)) {
    throw new Error(`bad decimal string: ${value}`)
  }
  const [int, frac = ""] = s.split(".")
  const fracPadded = (frac + "000000000000000000").slice(0, 18)
  return BigInt(int) * 10n ** 18n + BigInt(fracPadded)
}

const fetchFeed = (
  nodeRuntime: NodeRuntime<Config>,
): Feed => {
  const httpClient = new HTTPClient()

  const req = {
    url: nodeRuntime.config.apiUrl,
    method: "GET" as const,
  }

  const resp = httpClient.sendRequest(nodeRuntime, req).result()
  const bodyText = new TextDecoder().decode(resp.body)

  const json = JSON.parse(bodyText) as Feed

  return {
    seq: json.seq,
    amountPerShare: String(json.amountPerShare),
    refPrice: String(json.refPrice),
  }
}

const onCronTrigger = (
  runtime: Runtime<Config>,
): MyResult => {
  // 1. Fetch the dividend feed
  const feed = runtime
    .runInNodeMode(
      fetchFeed,
      consensusIdenticalAggregation<Feed>(),
    )()
    .result()

  runtime.log(
    `Feed fetched: seq=${feed.seq} amountPerShare=${feed.amountPerShare} refPrice=${feed.refPrice}`,
  )

  const evmConfig = runtime.config.evms[0]

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: evmConfig.chainName,
  })

  if (!network) {
    throw new Error(
      `Unknown chain name: ${evmConfig.chainName}`,
    )
  }

  const evmClient = new EVMClient(
    network.chainSelector.selector,
  )

  // 2. Read DividendOracle.lastSeq()
  const callData = encodeFunctionData({
    abi: DividendOracle,
    functionName: "lastSeq",
  })

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: evmConfig.oracleAddress as `0x${string}`,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const lastSeq = decodeFunctionResult({
    abi: DividendOracle,
    functionName: "lastSeq",
    data: bytesToHex(contractCall.data),
  }) as bigint

  runtime.log(
    `DividendOracle.lastSeq on-chain: ${lastSeq}`,
  )

  // 3. Skip when the feed has nothing newer
  if (BigInt(feed.seq) <= lastSeq) {
    runtime.log(
      `no new declaration (feed seq ${feed.seq} <= on-chain lastSeq ${lastSeq}); skipping write`,
    )
    return {
      feedSeq: feed.seq,
      amountPerShare: toUnit(feed.amountPerShare),
      refPrice: toUnit(feed.refPrice),
      lastSeqOnChain: lastSeq,
      wrote: false,
      txHash: "",
    }
  }

  // 4. Encode the report: abi.encode(uint256 seq, uint256 amountPerShare, uint256 refPrice)
  const reportData = encodeAbiParameters(
    parseAbiParameters(
      "uint256 seq, uint256 amountPerShare, uint256 refPrice",
    ),
    [
      BigInt(feed.seq),
      toUnit(feed.amountPerShare),
      toUnit(feed.refPrice),
    ],
  )

  // 5. Create the CRE signed report
  const report = runtime
    .report({
      encodedPayload: hexToBase64(reportData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result()

  runtime.log("CRE report generated successfully")

  // 6. Write the report through the Monad forwarder to the oracle
  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: evmConfig.oracleAddress,
      report,
      gasConfig: {
        gasLimit: evmConfig.gasLimit,
      },
    })
    .result()

  const txHash = writeResult.txHash
    ? bytesToHex(writeResult.txHash)
    : ""

  runtime.log(
    `DividendOracle transaction: ${txHash}`,
  )

  return {
    feedSeq: feed.seq,
    amountPerShare: toUnit(feed.amountPerShare),
    refPrice: toUnit(feed.refPrice),
    lastSeqOnChain: lastSeq,
    wrote: true,
    txHash,
  }
}

export async function main() {
  const runner =
    await Runner.newRunner<Config>()

  await runner.run(initWorkflow)
}