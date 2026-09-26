import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sổ Báo Giảng Điện Tử - Trường THPT Chuyên HVT',
  description: 'Hệ thống quản lý chuyên môn giáo viên',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="vi">
      <body className="font-sans antialiased bg-slate-950 text-slate-800">
        {children}
      </body>
    </html>
  )
}