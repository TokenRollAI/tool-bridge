import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { useState } from 'react'
import {
  INITIAL_MANIFEST_FORM,
  type ManifestFormState,
} from '@/pages/system/forms/pluginManifest'
import { INITIAL_SK_FORM, type SkFormState } from '@/pages/system/forms/skConfig'
import { PluginManifestFields } from '@/pages/system/forms/PluginManifestFields'
import { MountConfigFields } from '@/pages/system/forms/MountConfigFields'
import { SkFormFields } from '@/pages/system/forms/SkFormFields'
import { SchemaFields } from '@/components/SchemaFields'

afterEach(cleanup)

describe('schema 字段安全边界', () => {
  it('mountConfig 只显示 descriptor 字段，并从回调剔除未知字段与 authRef', async () => {
    let latest: Record<string, string> = {}
    function Harness() {
      const [value, setValue] = useState({
        baseUrl: 'https://old.example.com',
        authRef: 'must-not-leak',
      })
      return (
        <MountConfigFields
          fields={[
            { key: 'baseUrl', label: 'Base URL', required: true },
            { key: 'region', label: 'Region' },
          ]}
          idPrefix="mount-config"
          onChange={(next) => {
            latest = next
            setValue(next)
          }}
          value={value}
        />
      )
    }

    render(<Harness />)
    const baseUrl = await screen.findByLabelText(/^baseUrl.*\*$/)
    expect(screen.queryByText(/authRef/i)).toBeNull()
    expect(screen.queryByDisplayValue('must-not-leak')).toBeNull()
    fireEvent.change(baseUrl, {
      target: { value: 'https://new.example.com' },
    })

    await waitFor(() => expect(latest).toEqual({
      baseUrl: 'https://new.example.com',
    }))
  })

  it('保留声明顺序与 radio/boolean/array/null 的真实值，同时剔除未知字段', async () => {
    let latest: Record<string, unknown> = {}
    function Harness() {
      const [value, setValue] = useState<Record<string, unknown>>({
        mode: 'strict',
        enabled: false,
        tags: ['alpha'],
        nullable: null,
        authRef: 'must-not-leak',
      })
      return (
        <SchemaFields
          fields={[
            {
              key: 'mode',
              label: '模式',
              schema: { type: 'string', oneOf: [
                { const: 'strict', title: '严格' }, { const: 'loose', title: '宽松' },
              ] },
              ui: { 'ui:widget': 'radio', 'ui:options': { optionValueFormat: 'realValue' } },
            },
            { key: 'enabled', label: '启用', schema: { type: 'boolean' } },
            {
              key: 'tags',
              label: '标签',
              schema: { type: 'array', items: { type: 'string' } },
            },
            { key: 'nullable', label: '可空值', schema: { type: ['string', 'null'] } },
          ]}
          idPrefix="shape"
          onChange={(next) => {
            latest = next
            setValue(next)
          }}
          value={value}
        />
      )
    }

    render(<Harness />)
    expect((await screen.findByLabelText('严格')).getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByText(/模式|启用|标签|可空值/).map(node => node.textContent)).toEqual([
      '模式', '启用', '标签', '标签-1*', '可空值',
    ])
    fireEvent.click(screen.getByLabelText('启用'))
    await waitFor(() => expect(latest).toMatchObject({
      mode: 'strict', enabled: true, tags: ['alpha'], nullable: null,
    }))
    expect(latest).not.toHaveProperty('authRef')
  })
})

describe('Plugin manifest 表单', () => {
  it('保留默认值，且仅在 bearer 模式显式展示 secret reference', async () => {
    let latest: ManifestFormState = INITIAL_MANIFEST_FORM
    function Harness() {
      const [state, setState] = useState<ManifestFormState>({
        ...INITIAL_MANIFEST_FORM,
        secretRef: 'hidden-credential-name',
      })
      return (
        <MemoryRouter>
          <PluginManifestFields
            idPrefix="plugin-create"
            onChange={(next) => {
              latest = next
              setState(next)
            }}
            state={state}
          />
        </MemoryRouter>
      )
    }

    render(<Harness />)
    expect(await screen.findByLabelText(/^Health path.*\*$/)).toHaveProperty('value', '/healthz')
    expect(screen.getByLabelText('注册后启用调用').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('platform-token — 平台签发').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByDisplayValue('hidden-credential-name')).toBeNull()

    fireEvent.click(screen.getByLabelText('bearer — 引用已存凭证'))
    await waitFor(() => expect(screen.getByLabelText(/^Secret reference.*\*$/)).toBeDefined())
    expect(latest.authKind).toBe('bearer')
    expect(screen.getByDisplayValue('hidden-credential-name')).toBeDefined()

    fireEvent.click(screen.getByLabelText('platform-token — 平台签发'))
    await waitFor(() => expect(screen.queryByLabelText(/^Secret reference/)).toBeNull())
    expect(latest.authKind).toBe('platform-token')
  })
})

describe('SK scope 表单', () => {
  it('呈现初始 allow 规则，并让 RJSF 管理规则的新增、动作与 deny', async () => {
    let latest: SkFormState = INITIAL_SK_FORM
    function Harness() {
      const [state, setState] = useState<SkFormState>({
        ...INITIAL_SK_FORM,
        scopes: INITIAL_SK_FORM.scopes.map(scope => ({
          ...scope,
          authRef: 'nested-secret-must-not-leak',
        })) as SkFormState['scopes'],
      })
      return (
        <SkFormFields
          disabled={false}
          onChange={(next) => {
            latest = next
            setState(next)
          }}
          state={state}
        />
      )
    }

    render(<Harness />)
    expect(await screen.findByLabelText(/^path pattern.*\*$/)).toHaveProperty('value', '**')
    expect(screen.getByLabelText('read').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('call').getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByRole('radio').map(radio => ({
      checked: radio.getAttribute('aria-checked'),
      value: radio.getAttribute('value'),
    }))).toEqual([
      { checked: 'true', value: 'allow' },
      { checked: 'false', value: 'deny' },
    ])

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.queryByLabelText(/^path pattern/)).toBeNull())
    expect(latest.scopes).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: '添加一项' }))
    await waitFor(() => expect(screen.getAllByLabelText(/^path pattern.*\*$/)).toHaveLength(1))
    expect(latest.scopes[0]).toEqual({ pattern: '', actions: ['read'], effect: 'allow' })
    expect(JSON.stringify(latest)).not.toContain('nested-secret-must-not-leak')

    fireEvent.change(screen.getByLabelText(/^path pattern.*\*$/), {
      target: { value: 'private/**' },
    })
    fireEvent.click(screen.getByLabelText('deny（优先于 allow）'))
    await waitFor(() => expect(latest.scopes[0]).toEqual({
      pattern: 'private/**',
      actions: ['read'],
      effect: 'deny',
    }))
  })
})
