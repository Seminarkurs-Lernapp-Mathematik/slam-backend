import { describe, it, expect } from 'vitest'
import { toFsFields, fromFsDoc, fromFsValue } from './firestore'

describe('toFsFields', () => {
  it('converts string values', () => {
    expect(toFsFields({ name: 'Anna' })).toEqual({
      name: { stringValue: 'Anna' },
    })
  })

  it('converts integer values', () => {
    expect(toFsFields({ count: 5 })).toEqual({
      count: { integerValue: '5' },
    })
  })

  it('converts boolean values', () => {
    expect(toFsFields({ active: true })).toEqual({
      active: { booleanValue: true },
    })
  })

  it('converts null values', () => {
    expect(toFsFields({ x: null })).toEqual({
      x: { nullValue: null },
    })
  })

  it('converts arrays', () => {
    expect(toFsFields({ ids: ['a', 'b'] })).toEqual({
      ids: {
        arrayValue: {
          values: [{ stringValue: 'a' }, { stringValue: 'b' }],
        },
      },
    })
  })

  it('converts nested objects', () => {
    expect(toFsFields({ grid: { rows: 4, cols: 5 } })).toEqual({
      grid: {
        mapValue: {
          fields: {
            rows: { integerValue: '4' },
            cols: { integerValue: '5' },
          },
        },
      },
    })
  })
})

describe('fromFsDoc', () => {
  it('extracts id from document name', () => {
    const doc = {
      name: 'projects/p/databases/(default)/documents/classes/abc123',
      fields: { name: { stringValue: '11a' } },
    }
    const result = fromFsDoc(doc)
    expect(result.id).toBe('abc123')
    expect(result.name).toBe('11a')
  })

  it('converts nested mapValue', () => {
    const doc = {
      name: 'projects/p/databases/(default)/documents/classes/x',
      fields: {
        gridConfig: {
          mapValue: {
            fields: {
              rows: { integerValue: '4' },
              cols: { integerValue: '5' },
            },
          },
        },
      },
    }
    const result = fromFsDoc(doc)
    expect(result.gridConfig).toEqual({ rows: 4, cols: 5 })
  })

  it('converts arrayValue', () => {
    const doc = {
      name: 'projects/p/databases/(default)/documents/classes/x',
      fields: {
        studentIds: {
          arrayValue: {
            values: [{ stringValue: 'uid1' }, { stringValue: 'uid2' }],
          },
        },
      },
    }
    const result = fromFsDoc(doc)
    expect(result.studentIds).toEqual(['uid1', 'uid2'])
  })
})

describe('fromFsValue', () => {
  it('handles empty arrayValue', () => {
    expect(fromFsValue({ arrayValue: {} })).toEqual([])
  })
})
