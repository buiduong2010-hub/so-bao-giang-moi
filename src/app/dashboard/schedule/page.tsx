'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import * as XLSX from 'xlsx'
import { Upload, RefreshCw, Calendar, Plus, Trash2, X } from 'lucide-react'

interface ScheduleItem {
  id: string
  week_number: number
  session: string       // 'Sáng' hoặc 'Chiều'
  day_of_week: string   // 'Thứ 2', 'Thứ 3'...
  period_number: number // Tiết số (1, 2, 3...)
  class_name: string    // Tên lớp (Ví dụ: 12SỬ)
  subject_code: string  // Mã môn học
}

const DAYS_MAPPING = [
  { id: 'Thứ 2', name: 'Thứ Hai' },
  { id: 'Thứ 3', name: 'Thứ Ba' },
  { id: 'Thứ 4', name: 'Thứ Tư' },
  { id: 'Thứ 5', name: 'Thứ Năm' },
  { id: 'Thứ 6', name: 'Thứ Sáu' },
  { id: 'Thứ 7', name: 'Thứ Bảy' },
]

const VALID_CLASS_CODES = [
  '10T1', '10T2', '10L', '10H', '10S', '10TIN', '10V1', '10V2', '10SỬ', '10Đ', '10A1', '10A2', '10P', '10N', '10TQ',
  '11T', '11L', '11H', '11S', '11TIN', '11V', '11SỬ', '11Đ', '11A1', '11A2', '11P', '11N', '11TQ',
  '12T', '12L', '12H', '12S', '12TIN', '12V', '12SỬ', '12Đ', '12A1', '12A2', '12P', '12N', '12TQ'
]

const VALID_SUBJECTS = [
  'TOAN', 'T', 'NGU_VAN', 'V', 'ANH', 'A', 'LY', 'L', 'HOA', 'H', 'SINH', 'S', 
  'SU', 'DIA', 'GDCD', 'TIN', 'CN', 'KTPL', 'QPAN', 'GDTC', 'GDĐP', 'TrN'
]

// Hàm tự động tính tuần hiện tại theo thời gian thực (Tuần 1 bắt đầu từ 07/09/2026)
const getCurrentWeekNumber = () => {
  const startDate = new Date(2026, 8, 7) // Tháng 9 là 8 trong JavaScript (0-indexed)
  const today = new Date()
  
  startDate.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  
  const diffTime = today.getTime() - startDate.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  
  if (diffDays < 0) return 1
  const currentWeek = Math.floor(diffDays / 7) + 1
  return Math.min(Math.max(currentWeek, 1), 35)
}

export default function SchedulePage() {
  const supabase = createClient()
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeekNumber())
  const [schedule, setSchedule] = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(false)

  const [availableClasses] = useState<string[]>(VALID_CLASS_CODES)
  const [availableSubjects] = useState<string[]>(VALID_SUBJECTS)

  const [editingCell, setEditingCell] = useState<{
    session: string
    dayId: string
    period: number
    subject: string
    classCode: string
    isExisting: boolean
  } | null>(null)

  const loadSchedule = async () => {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    // 1. Kiểm tra dữ liệu của tuần đang chọn trong DB
    const { data: sData, error } = await supabase
      .from('weekly_timetables')
      .select('*')
      .eq('week_number', selectedWeek)
      .eq('teacher_id', user.id)

    if (error) {
      console.error('Lỗi tải TKB:', error.message)
      setLoading(false)
      return
    }

    if (sData && sData.length > 0) {
      setSchedule(sData)
    } else {
      // 2. Nếu tuần này chưa có dữ liệu thực tế và là tuần > 1 -> Tự động clone từ Tuần 1 xuống DB
      if (selectedWeek > 1) {
        const { data: week1Data } = await supabase
          .from('weekly_timetables')
          .select('*')
          .eq('week_number', 1)
          .eq('teacher_id', user.id)

        if (week1Data && week1Data.length > 0) {
          const copiedEntries = week1Data.map((item: any) => ({
            teacher_id: user.id,
            week_number: selectedWeek,
            session: item.session,
            day_of_week: item.day_of_week,
            period_number: item.period_number,
            class_name: item.class_name,
            subject_code: item.subject_code,
          }))

          // Insert thật xuống DB để tuần này có dữ liệu độc lập, tránh mất tiết khi sửa lẻ
          const { error: insertErr } = await supabase
            .from('weekly_timetables')
            .insert(copiedEntries)

          if (!insertErr) {
            // Tải lại dữ liệu sau khi đã clone thành công
            const { data: reloadedData } = await supabase
              .from('weekly_timetables')
              .select('*')
              .eq('week_number', selectedWeek)
              .eq('teacher_id', user.id)
            
            setSchedule(reloadedData || [])
          } else {
            setSchedule([])
          }
        } else {
          setSchedule([])
        }
      } else {
        setSchedule([])
      }
    }

    setLoading(false)
  }

  useEffect(() => {
    loadSchedule()
  }, [selectedWeek])

  // Hàm xử lý Upload File Excel theo đúng tọa độ lưới
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        alert('Vui lòng đăng nhập lại!')
        setLoading(false)
        return
      }

      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1 })

      const rawEntries: any[] = []

      const colToDayMap: { [key: number]: string } = {
        1: 'Thứ 2',
        2: 'Thứ 3',
        3: 'Thứ 4',
        4: 'Thứ 5',
        5: 'Thứ 6',
        6: 'Thứ 7',
      }

      for (let r = 0; r < jsonData.length; r++) {
        const row = jsonData[r]
        if (!row || row.length === 0) continue

        const rowLabel = String(row[0] || '').trim()
        let session = 'Sáng'
        let periodNumber = 0

        if (r >= 1 && r <= 5) {
          session = 'Sáng'
          periodNumber = parseInt(rowLabel, 10)
        } else if (r >= 7 && r <= 9) {
          session = 'Chiều'
          periodNumber = parseInt(rowLabel, 10)
        }

        if (isNaN(periodNumber) || periodNumber < 1) continue

        for (let colIdx = 1; colIdx <= 6; colIdx++) {
          const cellValue = String(row[colIdx] || '').trim()
          if (cellValue && cellValue !== 'NaN' && cellValue !== '-') {
            const dayId = colToDayMap[colIdx]
            if (!dayId) continue

            const parts = cellValue.split('-').map((p) => p.trim())
            if (parts.length >= 2) {
              rawEntries.push({
                session: session,
                day_of_week: dayId,
                period_number: periodNumber,
                subject_code: parts[0].toUpperCase(),
                class_name: parts[1].toUpperCase()
              })
            }
          }
        }
      }

      if (rawEntries.length === 0) {
        alert('Không tìm thấy tiết học hợp lệ theo tọa độ Excel! Vui lòng kiểm tra lại file mẫu.')
        setLoading(false)
        return
      }

      await supabase
        .from('weekly_timetables')
        .delete()
        .eq('week_number', selectedWeek)
        .eq('teacher_id', user.id)

      const finalEntriesToInsert = rawEntries.map(entry => ({
        teacher_id: user.id,
        week_number: selectedWeek,
        session: entry.session,
        day_of_week: entry.day_of_week,
        period_number: entry.period_number,
        class_name: entry.class_name,
        subject_code: entry.subject_code,
      }))

      const { error: insertErr } = await supabase
        .from('weekly_timetables')
        .insert(finalEntriesToInsert)

      if (insertErr) throw insertErr

      alert(`Đã quét tọa độ và nạp thành công ${finalEntriesToInsert.length} tiết học cho Tuần ${selectedWeek}!`)
      loadSchedule()
    } catch (err: any) {
      alert('Lỗi nhập file Excel: ' + err.message)
    } finally {
      setLoading(false)
      const fileInput = document.getElementById('excel-upload') as HTMLInputElement
      if (fileInput) fileInput.value = ''
    }
  }

  const handleSaveCell = async (session: string, dayId: string, period: number, subject: string, classCode: string) => {
    setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        alert('Vui lòng đăng nhập lại!')
        setLoading(false)
        return
      }

      const subSubject = subject.trim()
      const subClassCode = classCode.trim().toUpperCase()

      if (!subSubject || !subClassCode) {
        alert('Vui lòng chọn đầy đủ Môn học và Tên lớp!')
        setLoading(false)
        return
      }

      const { data: currentEntry } = await supabase
        .from('weekly_timetables')
        .select('id')
        .eq('week_number', selectedWeek)
        .eq('session', session)
        .eq('day_of_week', dayId)
        .eq('period_number', period)
        .eq('teacher_id', user.id)
        .maybeSingle()

      if (currentEntry) {
        const { error: updateErr } = await supabase
          .from('weekly_timetables')
          .update({ subject_code: subSubject, class_name: subClassCode })
          .eq('id', currentEntry.id)
        if (updateErr) throw updateErr
      } else {
        const { error: insertErr } = await supabase.from('weekly_timetables').insert({
          teacher_id: user.id,
          week_number: selectedWeek,
          session: session,
          day_of_week: dayId,
          period_number: period,
          class_name: subClassCode,
          subject_code: subSubject,
        })
        if (insertErr) throw insertErr
      }

      setEditingCell(null)
      await loadSchedule()
    } catch (err: any) {
      alert('Lỗi khi lưu tiết học: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteCell = async () => {
    if (!editingCell) return
    if (!confirm('Bạn có chắc chắn muốn xóa tiết học này khỏi ô TKB?')) return

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase
        .from('weekly_timetables')
        .delete()
        .eq('week_number', selectedWeek)
        .eq('session', editingCell.session)
        .eq('day_of_week', editingCell.dayId)
        .eq('period_number', editingCell.period)
        .eq('teacher_id', user.id)

      setEditingCell(null)
      await loadSchedule()
    } catch (err: any) {
      alert('Lỗi khi xóa tiết: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4 font-sans pb-8">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b pb-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 leading-tight">Thời Khóa Biểu (Tuần {selectedWeek})</h1>
          <p className="text-xs text-slate-500">
            💡 Mẹo: Upload file Excel để hệ thống tự quét tọa độ hoặc click vào ô bất kỳ để chỉnh sửa thủ công.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white px-2.5 py-1.5 border rounded-xl shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-emerald-600 shrink-0"/>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
              className="font-black text-emerald-800 bg-transparent text-xs focus:outline-none cursor-pointer"
            >
              {Array.from({ length: 35 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  Tuần {w < 10 ? '0' + w : w}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition shadow-2xs cursor-pointer">
            <Upload className="w-3.5 h-3.5"/>
            <span>Nhập Excel Tuần {selectedWeek}</span>
            <input
              id="excel-upload"
              type="file"
              accept=".xlsx, .xls"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          <button
            onClick={loadSchedule}
            disabled={loading}
            className="p-2 border rounded-xl bg-white hover:bg-slate-50 text-slate-700 shadow-2xs transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/>
          </button>
        </div>
      </div>

      {/* LƯỚI HIỂN THỊ SÁNG & CHIỀU */}
      <div className="space-y-6">
        {['Sáng', 'Chiều'].map((sessionName) => (
          <div key={sessionName} className="bg-white rounded-2xl border border-slate-300 shadow-xs overflow-hidden">
            <div className={`p-3 font-black text-xs uppercase tracking-wider border-b ${sessionName === 'Sáng' ? 'bg-sky-50 text-sky-900 border-sky-200' : 'bg-amber-50 text-amber-900 border-amber-200'}`}>
              ☀️ Buổi {sessionName}
            </div>
            <table className="w-full table-fixed border-collapse text-left text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300 uppercase tracking-tight text-[11px]">
                  <th className="w-[10%] p-3 border-r border-slate-300 text-center">TIẾT</th>
                  {DAYS_MAPPING.map((d) => (
                    <th key={d.id} className="w-[15%] p-3 border-r border-slate-300 text-center">
                      {d.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {(sessionName === 'Sáng' ? [1, 2, 3, 4, 5] : [1, 2, 3]).map((periodNum) => (
                  <tr key={periodNum} className="hover:bg-slate-50/50">
                    <td className="p-3 border-r border-slate-300 text-center font-black text-slate-900 bg-slate-50">
                      Tiết {periodNum}
                    </td>
                    {DAYS_MAPPING.map((day) => {
                      const item = schedule.find(
                        (s) => s.session === sessionName && s.day_of_week === day.id && s.period_number === periodNum
                      )

                      return (
                        <td
                          key={day.id}
                          onClick={() => {
                            setEditingCell({
                              session: sessionName,
                              dayId: day.id,
                              period: periodNum,
                              subject: item?.subject_code || '',
                              classCode: item?.class_name || '',
                              isExisting: !!item,
                            })
                          }}
                          className="p-2.5 border-r border-slate-300 text-center align-middle cursor-pointer transition group relative hover:bg-emerald-50/60 h-16"
                        >
                          {item ? (
                            <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-1.5 shadow-2xs group-hover:border-emerald-500 flex flex-col items-center justify-center h-full">
                              <span className="font-black text-emerald-950 text-xs block">
                                {item.subject_code}
                              </span>
                              <span className="text-[10px] font-bold text-slate-600">
                                {item.class_name}
                              </span>
                            </div>
                          ) : (
                            <div className="text-slate-300 group-hover:text-emerald-600 font-bold text-base">
                              +
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* POPUP THÊM / SỬA / XÓA TIẾT HỌC */}
      {editingCell && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl border">
            <div className="flex justify-between items-center border-b pb-3">
              <span className="font-black text-slate-800 text-sm uppercase">
                {editingCell.dayId} — Tiết {editingCell.period} ({editingCell.session}) — Tuần {selectedWeek}
              </span>
              <button
                onClick={() => setEditingCell(null)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4"/>
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Mã môn học:</label>
                <select
                  value={editingCell.subject}
                  onChange={(e) => setEditingCell({ ...editingCell, subject: e.target.value })}
                  className="w-full p-2.5 border rounded-xl font-bold text-slate-900 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value="">-- Chọn mã môn học --</option>
                  {availableSubjects.map((sub, idx) => (
                    <option key={idx} value={sub}>{sub}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Tên lớp học:</label>
                <select
                  value={editingCell.classCode}
                  onChange={(e) => setEditingCell({ ...editingCell, classCode: e.target.value })}
                  className="w-full p-2.5 border rounded-xl font-bold text-slate-900 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value="">-- Chọn lớp học --</option>
                  {availableClasses.map((cls, idx) => (
                    <option key={idx} value={cls}>Lớp {cls}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                {editingCell.isExisting && (
                  <button
                    onClick={handleDeleteCell}
                    disabled={loading}
                    className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs cursor-pointer flex items-center gap-1"
                  >
                    <Trash2 className="w-4 h-4"/>
                    <span>Xóa</span>
                  </button>
                )}

                <button
                  onClick={async () => {
                    await handleSaveCell(editingCell.session, editingCell.dayId, editingCell.period, editingCell.subject, editingCell.classCode)
                  }}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl shadow-xs cursor-pointer flex items-center justify-center gap-1"
                >
                  <Plus className="w-4 h-4"/>
                  <span>Lưu tiết học</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}