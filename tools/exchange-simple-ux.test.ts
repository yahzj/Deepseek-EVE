/** 极简下注金额前馈确定性用例；node --import tsx --test tools/exchange-simple-ux.test.ts */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimateSimpleBet } from '../apps/desktop/src/renderer/src/features/exchange/format'

test('空输入或非法价格不产生股数与费用，余额保持', () => {
  assert.deepEqual(estimateSimpleBet(0, 100, 0.001, 10000), {
    qty: 0, gross: 0, fee: 0, spend: 0, remainCash: 10000, unusedInput: 0,
  })
  assert.deepEqual(estimateSimpleBet(1000, NaN, 0.001, 10000), {
    qty: 0, gross: 0, fee: 0, spend: 0, remainCash: 10000, unusedInput: 0,
  })
})

test('无费率：投入金额按现价取整股数，支出等于成交名义', () => {
  assert.deepEqual(estimateSimpleBet(1050, 100, 0, 10000), {
    qty: 10, gross: 1000, fee: 0, spend: 1000, remainCash: 9000, unusedInput: 50,
  })
})

test('含费率：先折出费后本金，手续费按成交名义向下取整', () => {
  const e = estimateSimpleBet(1010, 100, 0.001, 10000)
  assert.equal(e.qty, 10)
  assert.equal(e.gross, 1000)
  assert.equal(e.fee, 1)
  assert.equal(e.spend, 1001)
  assert.equal(e.remainCash, 8999)
  assert.ok(e.spend <= 1010)
})

test('全仓：费后取整差额可被界面提示，且不会透支', () => {
  const cash = 10000
  const e = estimateSimpleBet(cash, 333, 0.001, cash)
  assert.ok(e.spend <= cash)
  assert.ok(e.unusedInput > 0)
  assert.equal(e.remainCash, cash - e.spend)
  assert.equal(e.fee, Math.floor(e.gross * 0.001))
})

test('金额不足 1 股：股数与费用均为 0', () => {
  assert.deepEqual(estimateSimpleBet(50, 100, 0.001, 10000), {
    qty: 0, gross: 0, fee: 0, spend: 0, remainCash: 10000, unusedInput: 50,
  })
})
