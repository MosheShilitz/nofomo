import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "NO-FOMO.AI — חדשות AI בעברית",
  description: "כל מה שקרה ב-AI — בלי שתפספסו כלום. פיד ידיעות AI מנותח בעברית עם ניתוח עומק, מדד השפעה ומכונת זמן.",
  openGraph: {
    title: "NO-FOMO.AI",
    description: "כל מה שקרה ב-AI — בלי שתפספסו כלום",
    locale: "he_IL",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
