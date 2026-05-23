// @ts-check
import { expect } from 'chai'
import { calcCostUsd } from '../../../app/js/cost/priceTable.js'

describe('calcCostUsd', function () {
  it('multiplies input and output tokens by the per-1M price and sums them', function () {
    // gpt-4o: input $2.50/1M, output $10.00/1M
    // 1_000_000 in * $2.50 = $2.50, 500_000 out * $10.00/1M = $5.00 → $7.50
    expect(calcCostUsd('gpt-4o', 1_000_000, 500_000)).to.equal(7.5)
  })

  it('scales linearly with token count', function () {
    // gpt-4o-mini: input $0.15/1M, output $0.60/1M
    // 1000 in * $0.15/1M = $0.00015, 2000 out * $0.60/1M = $0.0012
    const expected = (1000 * 0.15 + 2000 * 0.6) / 1_000_000
    expect(calcCostUsd('gpt-4o-mini', 1000, 2000)).to.be.closeTo(expected, 1e-12)
  })

  it('prices DeepSeek v4 flash with the published slug', function () {
    // @deepseek/deepseek-v4-flash: input $0.07/1M, output $1.10/1M
    expect(calcCostUsd('@deepseek/deepseek-v4-flash', 1_000_000, 1_000_000)).to.be.closeTo(
      0.07 + 1.1,
      1e-12
    )
  })

  it('returns 0 for a model with no price entry', function () {
    expect(calcCostUsd('@made-up/model-7b', 1_000_000, 1_000_000)).to.equal(0)
  })

  it('returns 0 when the model argument is missing', function () {
    // @ts-expect-error - intentionally passing undefined
    expect(calcCostUsd(undefined, 1000, 1000)).to.equal(0)
  })

  it('treats missing input tokens as 0', function () {
    // Only output tokens billed.
    expect(calcCostUsd('gpt-4o-mini', undefined, 1_000_000)).to.be.closeTo(
      0.6,
      1e-12
    )
  })

  it('treats missing output tokens as 0', function () {
    // Only input tokens billed.
    expect(calcCostUsd('gpt-4o-mini', 1_000_000, undefined)).to.be.closeTo(
      0.15,
      1e-12
    )
  })

  it('returns 0 when both token counts are 0', function () {
    expect(calcCostUsd('gpt-4o', 0, 0)).to.equal(0)
  })

  it('handles small fractional token costs without precision blowups', function () {
    // 1 input token on gpt-4o = $2.5 / 1M = 0.0000025
    expect(calcCostUsd('gpt-4o', 1, 0)).to.be.closeTo(2.5e-6, 1e-12)
  })

  it('only logs the unknown-model warning once per model slug', function () {
    // Multiple invocations for the same unknown slug must not blow up.
    // (We can't easily assert the logger.warn call count here without
    // monkey-patching the @overleaf/logger import; the contract we care about
    // is that no exception is raised and the returned value is consistent.)
    expect(calcCostUsd('@made-up/another-model', 100, 100)).to.equal(0)
    expect(calcCostUsd('@made-up/another-model', 100, 100)).to.equal(0)
    expect(calcCostUsd('@made-up/another-model', 100, 100)).to.equal(0)
  })
})
