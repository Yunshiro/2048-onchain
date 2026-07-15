import { BaseError, ContractFunctionZeroDataError } from "viem";

/**
 * A missing V2 function returns no data. Transport failures, rate limits and
 * timeouts must not be treated as proof that the deployed contract is legacy.
 */
export function isUnsupportedContractError(error: unknown): boolean {
  if (error instanceof ContractFunctionZeroDataError) return true;
  if (!(error instanceof BaseError)) return false;
  return error.walk((cause) => cause instanceof ContractFunctionZeroDataError) !== null;
}
