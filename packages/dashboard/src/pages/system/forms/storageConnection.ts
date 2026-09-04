export interface StorageConnectionForm {
  accessKeyId: string
  bucket: string
  endpoint: string
  region: string
  secretAccessKey: string
}
export const EMPTY_STORAGE_CONNECTION: StorageConnectionForm = {
  endpoint: '', bucket: '', region: 'us-east-1', accessKeyId: '', secretAccessKey: '',
}
