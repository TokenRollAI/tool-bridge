import { describe, expect, it } from 'vitest'
import { safeToolReturnPath, toolHref } from '../src/lib/toolNavigation'

describe('工具导航', () => {
  it('定位命令仅编码 owner 与命令名', () => {
    expect(toolHref('team/天气', 'read now')).toBe('/tools/team/%E5%A4%A9%E6%B0%94?tool=read%20now')
    expect(toolHref('', 'help')).toBe('/tools/?tool=help')
  })

  it('保留搜索上下文，丢弃非导航字段', () => {
    expect(safeToolReturnPath('/search?q=weather&federation=local&args=secret#token')).toBe('/search?q=weather&federation=local')
    expect(safeToolReturnPath('/manage/devices?token=secret')).toBe('/manage/devices')
    expect(safeToolReturnPath('/nodes/team/weather?tab=invoke')).toBe('/nodes/team/weather?tab=invoke')
    expect(safeToolReturnPath('/canvas')).toBe('/canvas')
    expect(safeToolReturnPath('/tools?path=team%2Fweather&args=secret')).toBe('/tools?path=team%2Fweather')
  })

  it.each([undefined, null, {}, 'https://evil.test', '//evil.test', '/\\evil.test', '/login', '/search/../login', '/tools/%2f%2fevil.test', '/nodes/%', '/search\n'])('拒绝非应用内返回目标 %j', (value) => {
    expect(safeToolReturnPath(value)).toBe('/tools')
  })
})
