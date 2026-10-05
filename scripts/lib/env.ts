import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ENV_FILE = '.env'

export function envFilePath(): string {
  return join(process.cwd(), ENV_FILE)
}

export async function setEnvValue(key: string, value: string): Promise<void> {
  const path = envFilePath()
  const existing = existsSync(path) ? await readFile(path, 'utf8') : ''
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  const next = pattern.test(existing)
    ? existing.replace(pattern, line)
    : `${existing.replace(/\n*$/, '')}\n${line}\n`
  await writeFile(path, next, 'utf8')
}