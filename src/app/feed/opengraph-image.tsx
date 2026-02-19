import { generateOGImage, size, contentType } from '@/lib/og/generate-og-image'

export { size, contentType }
export const runtime = 'edge'

export default async function OGImage() {
  return generateOGImage({
    title: 'Activity Feed',
    subtitle: 'Browse scored hypercert activities by quality tier',
  })
}
