import { generateOGImage, size, contentType } from '@/lib/og/generate-og-image'

export { size, contentType }
export const runtime = 'edge'

export default async function OGImage() {
  return generateOGImage({
    title: 'Hyperlabel',
    subtitle: 'Automated quality scoring for hypercert activity records',
  })
}
