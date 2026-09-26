'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // Chuyển thẳng vào trang báo cáo luôn, bỏ qua hoàn toàn trang login
    router.push('/dashboard/reports')
  }, [router])

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
      <p className="font-bold text-lg">Đang vào hệ thống Sổ Báo Giảng...</p>
    </div>
  )
}