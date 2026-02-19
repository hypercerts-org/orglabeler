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

export const metadata: Metadata = {
  title: 'Hyperlabel',
  description: 'Automated quality scoring for hypercert activity records on AT Protocol.',
  metadataBase: new URL('https://hyperlabel-production.up.railway.app'),
  openGraph: {
    title: 'Hyperlabel',
    description: 'Automated quality scoring for hypercert activity records on AT Protocol.',
    url: 'https://hyperlabel-production.up.railway.app',
    siteName: 'Hyperlabel',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hyperlabel',
    description: 'Automated quality scoring for hypercert activity records on AT Protocol.',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
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
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
