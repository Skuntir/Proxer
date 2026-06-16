import type { Metadata } from 'next'
import { Geist, Geist_Mono, JetBrains_Mono, Fira_Code, Source_Code_Pro } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from '@/components/ui/sonner'
import { RuntimeLogger } from '@/components/runtime-logger'
import '@xyflow/react/dist/style.css'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' })
const firaCode = Fira_Code({ subsets: ['latin'], variable: '--font-fira-code' })
const sourceCodePro = Source_Code_Pro({ subsets: ['latin'], variable: '--font-source-code-pro' })

export const metadata: Metadata = {
  title: 'Proxer - Web Security Proxy',
  description: 'Web security testing and proxy analysis tool',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/logo.png'
      },
    ],
    apple: '/logo.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${jetbrainsMono.variable} ${firaCode.variable} ${sourceCodePro.variable} dark palette-amoled-red bg-background`}
    >
      <body className="font-sans antialiased overflow-hidden">
        <RuntimeLogger />
        {children}
        <Toaster />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
