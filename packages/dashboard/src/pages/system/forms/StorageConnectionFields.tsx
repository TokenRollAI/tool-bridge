import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { StorageConnectionForm } from './storageConnection'

export function StorageConnectionFields({ value, onChange, disabled = false, credentialsOnly = false }: {
  credentialsOnly?: boolean
  disabled?: boolean
  onChange: (value: StorageConnectionForm) => void
  value: StorageConnectionForm
}) {
  const fields = [
    ...credentialsOnly
      ? []
      : [
          { key: 'endpoint', label: 'S3 服务地址', placeholder: 'https://s3.example.com' },
          { key: 'bucket', label: 'Bucket', placeholder: 'tool-bridge' },
          { key: 'region', label: 'Region', placeholder: 'us-east-1' },
        ],
    { key: 'accessKeyId', label: 'Access Key ID', placeholder: '' },
    { key: 'secretAccessKey', label: 'Secret Access Key', placeholder: '' },
  ] as Array<{ key: keyof StorageConnectionForm, label: string, placeholder: string }>
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map(({ key, label, placeholder }) => (
        <div className="grid gap-2" key={key}>
          <Label htmlFor={`storage-${key}`}>{label}</Label>
          <Input
            autoComplete={key.includes('Key') ? 'new-password' : 'off'}
            disabled={disabled}
            id={`storage-${key}`}
            onChange={event => onChange({ ...value, [key]: event.target.value })}
            placeholder={placeholder}
            required
            type={key.includes('Key') ? 'password' : 'text'}
            value={value[key]}
          />
        </div>
      ))}
    </div>
  )
}
