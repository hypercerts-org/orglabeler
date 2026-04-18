import { generateOGImage, size, contentType } from '@/lib/og/generate-og-image'

export { size, contentType }
export const runtime = 'edge'

export default async function OGImage() {
  return generateOGImage({
    title: 'OrgLabeler',
    subtitle: 'Label certified organizations on AT Protocol',
  })
}
