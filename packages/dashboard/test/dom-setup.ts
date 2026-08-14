/**
 * jsdom 的缺口补齐(只补,不改行为)。
 *
 * Radix 的 Select/Dialog 依赖几个 jsdom 未实现的浏览器 API。它们**不是**被测逻辑的一部分
 * (真实浏览器里本来就有),不补则组件一挂载就抛,把"组件行为"测成"jsdom 完整度"。
 * 真实浏览器行为仍由 gateway 的 ui.integration 与人工核对负责。
 */

// Radix Select 打开时把选中项滚进视口。
if (!('scrollIntoView' in Element.prototype)) {
  Element.prototype.scrollIntoView = () => {}
}
// Radix 用它判断指针是否落在浮层内。
if (!('hasPointerCapture' in Element.prototype)) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
// Dialog 的滚动锁定会读它。
if (!('matchMedia' in globalThis)) {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
