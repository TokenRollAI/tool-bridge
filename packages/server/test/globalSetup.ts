import { startTestInfra } from './helpers/infra'

export default async function setup() {
  const infrastructure = await startTestInfra()
  Object.assign(process.env, infrastructure.env)
  return infrastructure.close
}
