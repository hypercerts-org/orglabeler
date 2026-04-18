import type { ReactNode } from 'react'
import { Syne, Outfit, Geist, Geist_Mono } from 'next/font/google'
import type { Metadata } from 'next'
import { ThemeProvider } from '@/components/ThemeProvider'
import { GeometricBackground } from '@/components/GeometricBackground'
import { Header } from '@/components/Header'
import './globals.css'

const syne = Syne({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-syne',
  display: 'swap',
})

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
})

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

const siteUrl = (() => {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (configuredUrl) {
    return configuredUrl.startsWith('http://') || configuredUrl.startsWith('https://')
      ? configuredUrl
      : `https://${configuredUrl}`
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }

  return 'http://localhost:3000'
})()

export const metadata: Metadata = {
  title: 'Certified Organization Labeler',
  description: 'Label certified organizations on AT Protocol.',
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: 'Certified Organization Labeler',
    description: 'Label certified organizations on AT Protocol.',
    url: '/',
    siteName: 'Certified Organization Labeler',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Certified Organization Labeler',
    description: 'Label certified organizations on AT Protocol.',
  },
}

const COMMIT_SHA = process.env.NEXT_PUBLIC_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? null
const DEPLOY_TIME = process.env.NEXT_PUBLIC_DEPLOY_TIME ?? new Date().toISOString()

export default function RootLayout({ children }: { children: ReactNode }) {
  const shortSha = COMMIT_SHA ? COMMIT_SHA.slice(0, 7) : null
  const deployDate = new Date(DEPLOY_TIME).toUTCString().replace(' GMT', ' UTC')

  return (
    <html lang='en' suppressHydrationWarning>
      <body
        className={`${syne.variable} ${outfit.variable} ${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <div className='relative min-h-screen overflow-hidden flex flex-col'>
            <GeometricBackground />
            <Header />
            <main className='relative flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 pb-8'>
              {children}
            </main>
            <footer className='relative z-10 border-t border-border/40 py-3 px-4'>
              <p className='text-center text-xs text-muted-foreground font-mono'>
                {shortSha ? (
                  <>deployed <span className='opacity-70'>{deployDate}</span> &middot; <span className='opacity-70'>{shortSha}</span></>
                ) : (
                  <>deployed <span className='opacity-70'>{deployDate}</span></>
                )}
              </p>
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
