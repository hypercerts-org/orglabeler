'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeToggle'

const navLinks = [
  { label: 'dashboard', href: '/' },
  { label: 'feed', href: '/feed' },
  { label: 'docs', href: '/docs' },
]

export function Header() {
  const pathname = usePathname()

  return (
    <header className='sticky top-0 z-50 glass-panel border-b border-border'>
      <div className='max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between'>
        <Link href='/' className='flex items-center'>
          <span className='font-[family-name:var(--font-syne)] text-sm font-bold tracking-tight'>
            certified organization labeler
          </span>
          <span className='w-1.5 h-1.5 rounded-full bg-emerald-400 ml-2' aria-hidden='true' />
        </Link>

        <nav className='flex items-center gap-1'>
          {navLinks.map(({ label, href }) => {
            const isActive = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                {label}
              </Link>
            )
          })}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}
