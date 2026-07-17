import { describe, expect, it } from 'vitest'
import { describeAllow, isCommandAllowed } from '../../src/device/shellAllow'

describe('isCommandAllowed:默认拒(allow 缺省/空)', () => {
  it('undefined → 全拒', () => {
    expect(isCommandAllowed('echo hi', undefined)).toBe(false)
  })
  it('[] → 全拒', () => {
    expect(isCommandAllowed('echo hi', [])).toBe(false)
  })
})

describe('isCommandAllowed:[\'*\'] 全放行', () => {
  it('普通命令放行', () => {
    expect(isCommandAllowed('rm -rf /tmp/x', ['*'])).toBe(true)
  })
  it('含元字符也放行(复合命令由用户显式授权)', () => {
    expect(isCommandAllowed('echo hi; rm -rf /', ['*'])).toBe(true)
    expect(isCommandAllowed('cat a | grep b > c', ['*'])).toBe(true)
  })
  it('\'*\' 混在列表里不算全放行(仅单值)', () => {
    expect(isCommandAllowed('anything', ['*', 'echo'])).toBe(false)
    expect(isCommandAllowed('echo hi', ['*', 'echo'])).toBe(true)
  })
})

describe('isCommandAllowed:argv[0] basename 精确匹配', () => {
  it('命中:裸名 / 绝对路径 / 前导空白 / 多参数', () => {
    expect(isCommandAllowed('echo hi', ['echo', 'git'])).toBe(true)
    expect(isCommandAllowed('/bin/echo hi', ['echo'])).toBe(true)
    expect(isCommandAllowed('  git status', ['git'])).toBe(true)
    expect(isCommandAllowed('git log --oneline -5', ['git'])).toBe(true)
  })
  it('引号包裹的 argv[0] 取引号内整词', () => {
    expect(isCommandAllowed('"my tool" --arg', ['my tool'])).toBe(true)
    expect(isCommandAllowed('\'my tool\' --arg', ['my tool'])).toBe(true)
  })
  it('不命中:相似名 / 前缀 / 其他命令', () => {
    expect(isCommandAllowed('echoo hi', ['echo'])).toBe(false)
    expect(isCommandAllowed('ech', ['echo'])).toBe(false)
    expect(isCommandAllowed('rm -rf /', ['echo', 'git'])).toBe(false)
  })
  it('精确匹配不做 glob(条目 git* 不匹配 git)', () => {
    expect(isCommandAllowed('git status', ['git*'])).toBe(false)
  })
  it('边界拒:空命令 / 纯空白 / 未闭合引号 / 目录形态', () => {
    expect(isCommandAllowed('', ['echo'])).toBe(false)
    expect(isCommandAllowed('   ', ['echo'])).toBe(false)
    expect(isCommandAllowed('"echo hi', ['echo'])).toBe(false)
    expect(isCommandAllowed('/bin/ hi', ['bin'])).toBe(false)
  })
})

describe('isCommandAllowed:非 [\'*\'] 时元字符直接拒', () => {
  const injections = [
    'echo hi; rm -rf /',
    'echo a | cat',
    'echo a & whoami',
    'echo $(whoami)',
    'echo `whoami`',
    'echo hi > /etc/passwd',
    'cat < /etc/passwd',
  ]
  it.each(injections)('拒:%s', (command) => {
    expect(isCommandAllowed(command, ['echo', 'cat'])).toBe(false)
  })
  it('非元字符的 \'$\'(如 $HOME)不拒', () => {
    expect(isCommandAllowed('echo $HOME', ['echo'])).toBe(true)
  })
})

describe('describeAllow', () => {
  it('三种形态', () => {
    expect(describeAllow(undefined)).toBe('allowed commands: none (deny all by default)')
    expect(describeAllow([])).toBe('allowed commands: none (deny all by default)')
    expect(describeAllow(['*'])).toBe('allowed commands: *')
    expect(describeAllow(['echo', 'git'])).toBe(
      'allowed commands: echo, git; everything else denied',
    )
  })
})
