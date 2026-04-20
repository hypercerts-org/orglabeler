import { HYPERSCAN_RECORD_URL_BASE } from './config'

export function buildRecordUrl(did: string, collection: string, rkey: string): string {
  const url = new URL(HYPERSCAN_RECORD_URL_BASE)
  url.searchParams.set('did', did)
  url.searchParams.set('collection', collection)
  url.searchParams.set('rkey', rkey)
  return url.toString()
}
