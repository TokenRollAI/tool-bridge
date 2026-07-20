/** 返回去掉指定键的浅拷贝(不改原对象);等价于 `const { k, ...rest } = obj` 的剔除语义。 */
export function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const rest = { ...obj }
  for (const key of keys) delete rest[key]
  return rest
}
