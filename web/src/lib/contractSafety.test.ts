import { BaseError, ContractFunctionZeroDataError, HttpRequestError } from "viem";
import { describe, expect, it } from "vitest";
import { isUnsupportedContractError } from "./contractSafety";

describe("contract safety error classification", () => {
  it("recognizes a missing contract function through a wrapped viem error", () => {
    const error = new BaseError("read failed", {
      cause: new ContractFunctionZeroDataError({ functionName: "SESSION_BOOTSTRAP" }),
    });
    expect(isUnsupportedContractError(error)).toBe(true);
  });

  it("does not misclassify an RPC failure as a legacy contract", () => {
    const error = new HttpRequestError({
      body: { method: "eth_call" },
      url: "https://testnet-rpc.monad.xyz",
    });
    expect(isUnsupportedContractError(error)).toBe(false);
  });

  it("does not classify an unknown error as a legacy contract", () => {
    expect(isUnsupportedContractError(new Error("TLS handshake EOF"))).toBe(false);
  });
});
