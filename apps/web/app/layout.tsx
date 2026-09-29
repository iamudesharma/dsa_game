import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from '@/components/ui/Providers'

export const metadata: Metadata = {
  title: 'Play the Algorithms',
  description: 'Learn data structures and algorithms by playing generated mini-games.',
}

export const viewport: Viewport = {
  themeColor: '#fbf6e9',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
