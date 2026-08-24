import { describe, expect, it } from 'vitest'
import { parseStoreUri, storeUri } from '../../src/objectStoreService/uri'
import { isTBError } from '../../src/errors'

const ID = 'Abcdefghijklmnopqrstuv12'

describe('store:// URI', () => {
  it('default store opaque id 往返', () => {
    expect(storeUri(ID)).toBe(`store://default/${ID}`)
    expect(parseStoreUri(`store://default/${ID}`)).toEqual({ store: 'default', objectId: ID })
  })

  it.each([
    'store://other/Abcdefghijklmnopqrstuv12',
    'store://default/short',
    'store://default/Abcdefghijklmnopqrstuv12/',
    'store://default/Abcdefghijklmnopqrstuv12?x=1',
    'store://default/Abcdefghijklmnopqrstuv%31',
    'STORE://default/Abcdefghijklmnopqrstuv12',
    'node://default/Abcdefghijklmnopqrstuv12',
  ])('严格拒绝非法 URI: %s', (uri) => {
    expect(() => parseStoreUri(uri)).toThrowError()
    try {
      parseStoreUri(uri)
    } catch (error) {
      expect(isTBError(error) && error.code === 'invalid_argument').toBe(true)
    }
  })
})
