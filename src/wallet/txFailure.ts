import { BaseError, formatEther, formatGwei } from 'viem'

/**
 * Why a transaction was rejected before it could be mined. The node's raw
 * wording differs per failure, so both the raw text and the account's actual
 * coverage are used to decide.
 *
 * Probed against Monad Testnet (2026-10-08):
 *   - short balance: Details = "Signer had insufficient balance"
 *   - fee cap under the block base fee: Details = "Transaction fee too low"
 *   - the UI has also seen the literal "not enough balance for gas"
 */
export type TxCause = 'balance' | 'fee-cap' | 'other'

const BALANCE_RE =
  /not enough balance|insufficient balance|insufficient funds|not enough funds|balance (?:is )?too low/i
const FEE_RE = /base fee|fee too low|FeeTooLow|max fee per gas|underpriced|fee cap/i

export type TxDiagnostics = {
  cause: TxCause
  address: `0x${string}`
  /** The account's MON balance at failure time; null when the RPC read failed. */
  monBalance: bigint | null
  /** Declared gas limit the transaction was sent with (Monad bills the limit). */
  gasLimit: bigint
  /** The chain's live gas price at failure time. */
  gasPrice: bigint
  /** The fee cap actually sent (chain gas price × 1.2). */
  maxFeePerGas: bigint
  /** gasLimit × maxFeePerGas — the amount the node requires up front. */
  required: bigint
  rawError: string
}

export function rawErrorMessage(error: unknown): string {
  if (error instanceof BaseError) {
    // BaseError.message carries shortMessage + Details + metaMessages; the
    // node's own wording (e.g. "Signer had insufficient balance") only shows
    // up in Details, so keep the whole thing.
    return error.message
  }
  if (error instanceof Error) return error.message
  return String(error)
}

export function classifyTxCause(
  rawError: string,
  monBalance: bigint | null,
  required: bigint,
): TxCause {
  if (FEE_RE.test(rawError)) return 'fee-cap'
  if (BALANCE_RE.test(rawError)) return 'balance'
  if (monBalance !== null && monBalance < required) return 'balance'
  return 'other'
}

export function buildTxDiagnostics(input: {
  address: `0x${string}`
  gasLimit: bigint
  gasPrice: bigint
  maxFeePerGas: bigint
  monBalance: bigint | null
  error: unknown
}): TxDiagnostics {
  const rawError = rawErrorMessage(input.error)
  const required = input.gasLimit * input.maxFeePerGas
  return {
    cause: classifyTxCause(rawError, input.monBalance, required),
    address: input.address,
    monBalance: input.monBalance,
    gasLimit: input.gasLimit,
    gasPrice: input.gasPrice,
    maxFeePerGas: input.maxFeePerGas,
    required,
    rawError,
  }
}

/**
 * One grep-able line per failed transaction: cause, MON balance, the required
 * amount (gasLimit × maxFeePerGas) and the raw node error.
 */
export function txFailureLogLine(d: TxDiagnostics): string {
  return [
    '[cleave:tx-failure]',
    `cause=${d.cause}`,
    `address=${d.address}`,
    `monBalance=${d.monBalance === null ? 'unknown' : `${formatEther(d.monBalance)} MON`}`,
    `gasLimit=${d.gasLimit.toString()}`,
    `gasPrice(chain)=${formatGwei(d.gasPrice)} gwei`,
    `maxFeePerGas=${formatGwei(d.maxFeePerGas)} gwei (chain gas price x 1.2)`,
    `required=${formatEther(d.required)} MON (gasLimit x maxFeePerGas)`,
    `rawError=${JSON.stringify(d.rawError)}`,
  ].join(' ')
}

const causes = new WeakMap<object, TxCause>()

export function rememberTxCause(error: unknown, cause: TxCause): void {
  if (typeof error === 'object' && error !== null) causes.set(error, cause)
}

function causeOf(error: unknown): TxCause | null {
  if (typeof error === 'object' && error !== null) return causes.get(error) ?? null
  return null
}

/** ui_spec §15: "You're out of network fee credit." */
export function isOutOfFeeCredit(error: unknown): boolean {
  const annotated = causeOf(error)
  if (annotated !== null) return annotated === 'balance'
  return BALANCE_RE.test(rawErrorMessage(error))
}
