/**
 * **调试模式的「本机门禁」**（⟪**2026-09-25 船长令**⟫：
 * 「**是否可以设置只有本地开启，上传后的版本都是关闭隐藏的**」）。
 *
 * 本文件钉住 `isLocalDebugOrigin` 的判定表 —— 它是"发布版一律关闭且隐藏"的唯一开关，
 * 一旦判宽了（把公网域名也算本机），等于把开发工具发给了玩家；判窄了船长本地就用不了。
 *
 * 口径（见 `src/debugGate.ts` 头注释）：
 * - 只认 `http:` / `https:`（`file:` 等非 http 协议 = 桌面打包版 ⇒ 按发布版处理）；
 * - 本机 = `localhost` / `127.0.0.1` / `::1` / `*.local` / **内网 IPv4**（10/8 · 172.16/12 · 192.168/16）；
 * - 公网域名、公网 IP、`127.0.0.2`（非 127.0.0.1 的环回）、空值 ⇒ 一律 **false**。
 */
import { describe, expect, it } from 'vitest'
import { isLocalDebugOrigin } from '../src/debugGate'

describe('调试模式的本机门禁', () => {
  it('本机宿主 ⇒ 放行（http/https 都算）', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', 'LOCALHOST', 'my-pc.local']) {
      expect(isLocalDebugOrigin('http:', host), host).toBe(true)
      expect(isLocalDebugOrigin('https:', host), host).toBe(true)
    }
  })

  it('内网 IPv4 ⇒ 放行（船长要用手机连电脑内网地址测网页版）', () => {
    for (const host of ['10.0.0.5', '10.255.255.254', '172.16.0.1', '172.31.255.9', '192.168.1.7']) {
      expect(isLocalDebugOrigin('http:', host), host).toBe(true)
    }
  })

  it('公网域名 / 公网 IP / 边界内网外的地址 ⇒ 关闭', () => {
    for (const host of [
      'game.example.com',
      'example.com',
      'sub.game.example.com',
      '8.8.8.8',
      '1.1.1.1',
      '172.15.0.1', // 172.16/12 的下界之外
      '172.32.0.1', // 上界之外
      '11.0.0.1',
      '192.169.1.1',
      '127.0.0.2', // 环回但不是 127.0.0.1（实测"发布版"路径用的就是它）
      '0.0.0.0',
      'localhost.game.example.com', // 后缀不合规：只有 *.local 才算
    ]) {
      expect(isLocalDebugOrigin('http:', host), host).toBe(false)
    }
  })

  it('非 http(s) 协议 ⇒ 关闭（桌面打包版走 file: ⇒ 按发布版处理）', () => {
    for (const proto of ['file:', 'app:', 'chrome-extension:', 'data:', '']) {
      expect(isLocalDebugOrigin(proto, 'localhost'), proto).toBe(false)
    }
  })

  it('空宿主 / 空协议 ⇒ 关闭（失败即关，拿不准按发布版）', () => {
    expect(isLocalDebugOrigin('http:', '')).toBe(false)
    expect(isLocalDebugOrigin('', 'localhost')).toBe(false)
    expect(isLocalDebugOrigin('http:', undefined as unknown as string)).toBe(false)
  })
})
