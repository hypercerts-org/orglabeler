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
  title: 'Certified Labeler',
  description: 'Monitoring hypercert activity quality across the hypersphere.',
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
