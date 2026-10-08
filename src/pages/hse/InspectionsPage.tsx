// Kiểm tra ATMT — lập biên bản BM-03 / BM-04, liệt kê kết quả.
import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../../lib/api'
import InspectionPhoto from '../../components/hse/InspectionPhoto'
import TrainingCheckPanel, { type TrainingCheck } from '../../components/hse/TrainingCheckPanel'
import { exportFormPdf, type FormSection } from '../../lib/formPdf'
import { fmtDate } from '../../lib/date'

// Mã biểu mẫu QT111-07 theo loại phiếu
const FORM_CODES: Record<string, string> = {
  BM03_INITIAL: 'BM111-07.03', BM03_MONTHLY: 'BM111-07.03',
  BM03_WEEKLY: 'BM111-07.03', BM04_DAILY: 'BM111-07.04',
}

interface Contract {
  id: number; contract_no: string; title: string; contractor_name: string
}
interface InspectionItem {
  id?: number
  item_code: string; item_name: string; category: string
  result: 'pass' | 'fail' | 'na'; note: string
  requires_suspension: boolean; requires_photo: boolean
}
interface Inspection {
  id: number; contract_id: number; contract_no: string; form_type: string
  inspection_date: string; inspector_name: string; overall_result: string
  suspension_required: boolean; note: string | null
  work_type_id?: number | null; work_type_name?: string | null
  training_snapshot?: TrainingCheck | null
}
interface Photo {
  id: number; item_id: number; file_name: string; caption: string; taken_at: string
}
// Ảnh vừa chụp: giữ luôn Blob URL đã tạo. Nếu gọi URL.createObjectURL() trong JSX thì
// mỗi lần render lại sinh một URL mới và không ai thu hồi — vài chục lần chụp là
// trình duyệt phải giữ cả chục bản ảnh trong bộ nhớ, thao tác chậm dần.
interface Shot { blob: Blob; url: string }

const FORM_LABELS: Record<string, string> = {
  BM03_INITIAL: 'BM-03 Lần đầu', BM03_MONTHLY: 'BM-03 Hàng tháng',
  BM03_WEEKLY: 'BM-03 Hàng tuần', BM04_DAILY: 'BM-04 Hàng ngày',
}
const RESULT_COLOR: Record<string, string> = {
  pass: 'bg-green-100 text-green-700', fail: 'bg-rose-100 text-rose-700',
  partial: 'bg-yellow-100 text-yellow-700',
}

// Nhãn nhóm hạng mục theo QT111-07
const CATEGORY_LABELS: Record<string, string> = {
  A: 'Nhóm A — Người lao động',
  B: 'Nhóm B — Yêu cầu ATMT hiện trường',
  C: 'Nhóm C — Thiết bị thi công',
}

export default function InspectionsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [contractId, setContractId] = useState('')
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState('BM04_DAILY')
  const [inspDate, setInspDate] = useState(new Date().toISOString().slice(0, 10))
  const [inspectorName, setInspectorName] = useState('')
  const [items, setItems] = useState<InspectionItem[]>([])
  const [globalNote, setGlobalNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<{ inspection: Inspection; items: InspectionItem[]; photos: Photo[] } | null>(null)

  // Pha 4: camera chụp ảnh minh chứng
  const [cameraItemIdx, setCameraItemIdx] = useState<number | null>(null)
  const [capturedPhotos, setCapturedPhotos] = useState<Map<number, Shot[]>>(new Map())
  const [camBusy, setCamBusy] = useState(false)
  const [shotCount, setShotCount] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [workTypes, setWorkTypes] = useState<Array<{ id: number; code: string; name: string }>>([])
  const [workTypeId, setWorkTypeId] = useState('')
  const [training, setTraining] = useState<TrainingCheck | null>(null)
  const [trainingError, setTrainingError] = useState('')
  const [trainingBusy, setTrainingBusy] = useState(false)
  const [checklistBusy, setChecklistBusy] = useState(false)
  const checklistRequest = useRef(0)
  const capturedRef = useRef(capturedPhotos)
  capturedRef.current = capturedPhotos

  useEffect(() => {
    api<{ workTypes: typeof workTypes }>('/jsa/work-types').then((d) => setWorkTypes(d.workTypes)).catch((e) => setErr(e.message))
    api<{ contracts: Contract[] }>('/hse/contracts').then((d) => setContracts(d.contracts)).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    let active = true
    setTraining(null); setTrainingError('')
    if (!showForm || !contractId || !workTypeId) { setTrainingBusy(false); return }
    setTrainingBusy(true)
    api<{ training: TrainingCheck }>(`/hse/inspection-training?contractId=${contractId}&workTypeId=${workTypeId}`)
      .then((d) => { if (active) setTraining(d.training) })
      .catch((e) => { if (active) setTrainingError(e.message) })
      .finally(() => { if (active) setTrainingBusy(false) })
    return () => { active = false }
  }, [showForm, contractId, workTypeId])

  const load = useCallback(async () => {
    if (!contractId) { setInspections([]); return }
    const d = await api<{ inspections: Inspection[] }>(`/hse/inspections?contractId=${contractId}`)
    setInspections(d.inspections)
  }, [contractId])

  useEffect(() => { load() }, [load])

  // Công việc JSA quyết định checklist; mẫu mặc định giữ tương thích BM-03/BM-04.
  useEffect(() => {
    const request = ++checklistRequest.current
    const code = formType === 'BM04_DAILY' ? 'DEFAULT_DAILY' : 'DEFAULT_FULL'
    setChecklistBusy(true)
    const path = workTypeId ? `/jsa/work-types/${workTypeId}/requirements` : `/jsa/checklist?code=${code}`
    api<{ items?: InspectionItem[]; checklist?: InspectionItem[] }>(path)
      .then((d) => {
        if (request !== checklistRequest.current) return
        setItems((d.checklist ?? d.items ?? []).map((it) => ({ ...it, result: 'pass', note: '', requires_suspension: false })))
        capturedRef.current.forEach((shots) => shots.forEach((s) => URL.revokeObjectURL(s.url)))
        setCapturedPhotos(new Map())
      })
      .catch((e) => { if (request === checklistRequest.current) { setItems([]); setErr('Không tải được checklist: ' + e.message) } })
      .finally(() => { if (request === checklistRequest.current) setChecklistBusy(false) })
    return () => { checklistRequest.current++ }
  }, [formType, workTypeId])

  const changeFormType = (ft: string) => {
    setFormType(ft)
    const selected = workTypes.find((w) => String(w.id) === workTypeId)
    if (!selected || selected.code.startsWith('DEFAULT_')) {
      setWorkTypeId(String(workTypes.find((w) => w.code === (ft === 'BM04_DAILY' ? 'DEFAULT_DAILY' : 'DEFAULT_FULL'))?.id ?? ''))
    }
  }

  const setItemResult = (idx: number, result: 'pass' | 'fail' | 'na') => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, result } : it)))
  }
  const setItemNote = (idx: number, note: string) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, note } : it)))
  }
  const setItemSuspend = (idx: number, v: boolean) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, requires_suspension: v } : it)))
  }

  // Mở camera cho hạng mục. Video chỉ gắn được vào <video> sau khi modal đã render,
  // nên phải đặt cameraItemIdx trước rồi mới gán srcObject trong effect bên dưới.
  const openCamera = async (idx: number) => {
    setErr('')
    setCameraItemIdx(idx)
    setShotCount(capturedPhotos.get(idx)?.length ?? 0)
    setCamBusy(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
    } catch (e) {
      setErr('Không mở được camera: ' + (e as Error).message)
      setCameraItemIdx(null)
    } finally {
      setCamBusy(false)
    }
  }

  // Gán lại stream khi <video> vừa được mount (modal mở sau khi getUserMedia đã xong).
  useEffect(() => {
    if (cameraItemIdx !== null && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [cameraItemIdx])

  const capturePhoto = () => {
    const video = videoRef.current
    if (!video || cameraItemIdx === null || camBusy) return
    // videoWidth = 0 nghĩa là chưa có khung hình nào — canvas 0×0 cho toBlob null,
    // trước đây rơi thẳng vào `if (!blob) return` nên bấm Chụp không có gì xảy ra.
    if (!video.videoWidth || !video.videoHeight) {
      setErr('Camera chưa sẵn sàng, thử lại sau một giây.')
      return
    }
    const idx = cameraItemIdx
    setCamBusy(true)
    // Giảm cạnh dài về tối đa 1600px: ảnh 4000px từ camera điện thoại nén ra ~4MB,
    // mỗi hạng mục vài ảnh là quá 20MB giới hạn multer và upload rất lâu trên 4G.
    const MAX = 1600
    const scale = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) { setCamBusy(false); return }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      setCamBusy(false)
      if (!blob) { setErr('Không tạo được ảnh từ camera.'); return }
      setCapturedPhotos((prev) => {
        const updated = new Map(prev)
        updated.set(idx, [...(updated.get(idx) || []), { blob, url: URL.createObjectURL(blob) }])
        return updated
      })
      setShotCount((n) => n + 1)
    }, 'image/jpeg', 0.8)
  }

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraItemIdx(null)
    setShotCount(0)
  }

  const removePhoto = (itemIdx: number, photoIdx: number) => {
    setCapturedPhotos((prev) => {
      const updated = new Map(prev)
      const photos = updated.get(itemIdx) || []
      const gone = photos[photoIdx]
      if (gone) URL.revokeObjectURL(gone.url)
      updated.set(itemIdx, photos.filter((_, i) => i !== photoIdx))
      return updated
    })
  }

  // Tắt camera nếu người dùng rời trang giữa lúc đang mở — không thì đèn camera
  // vẫn sáng và stream giữ nguyên sau khi component unmount.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    capturedRef.current.forEach((shots) => shots.forEach((s) => URL.revokeObjectURL(s.url)))
  }, [])

  const submit = async () => {
    if (!contractId || !inspectorName) { setErr('Chọn hợp đồng và nhập tên kiểm tra viên.'); return }
    if (!workTypeId || checklistBusy || trainingBusy || trainingError) { setErr('Chọn công việc JSA và chờ tải xong thông tin khóa học/checklist.'); return }
    if (!items.length) { setErr('Công việc chưa có checklist. Cần cấu hình hạng mục kiểm tra trước khi lưu.'); return }
    // Kiểm tra ảnh bắt buộc
    for (let i = 0; i < items.length; i++) {
      if (items[i].requires_photo && !(capturedPhotos.get(i)?.length)) {
        setErr(`Hạng mục "${items[i].item_name}" yêu cầu ảnh minh chứng.`); return
      }
    }
    setErr(''); setBusy(true)
    try {
      // Khóa trong body phải là snake_case: POST /hse/inspections đọc b.contract_id,
      // b.form_type, b.inspection_date, b.inspector_name và it.item_code/item_name/
      // category/requires_suspension. Gửi camelCase thì contract_id là undefined và
      // server trả 400 'Thiếu hợp đồng hoặc loại phiếu không hợp lệ.'
      const res = await api<{ id: number; itemIds: number[] }>('/hse/inspections', {
        method: 'POST',
        body: {
          contract_id: Number(contractId), form_type: formType, work_type_id: Number(workTypeId),
          inspection_date: inspDate, inspector_name: inspectorName,
          items: items.map((it) => ({
            item_code: it.item_code, item_name: it.item_name, category: it.category,
            result: it.result, note: it.note,
            requires_suspension: it.requires_suspension, requires_photo: it.requires_photo,
          })),
          note: globalNote || null,
        },
      })
      // Upload ảnh. itemIds trả về theo đúng thứ tự items đã gửi, nên index khớp nhau.
      const failed: string[] = []
      for (let i = 0; i < items.length; i++) {
        const photos = capturedPhotos.get(i)
        if (!photos?.length) continue
        const itemId = res.itemIds[i]
        if (!itemId) { failed.push(items[i].item_code); continue }
        for (const shot of photos) {
          const fd = new FormData()
          // Tên field phải là 'file' — multer ở server dùng upload.single('file') như mọi
          // endpoint upload khác; đặt tên khác thì req.file rỗng và server trả 400.
          fd.append('file', shot.blob, `inspection-${res.id}-item-${i}-${Date.now()}.jpg`)
          try {
            await api(`/hse/inspection-items/${itemId}/photos`, { method: 'POST', body: fd, isForm: true })
          } catch {
            failed.push(items[i].item_code)
          }
        }
      }
      // Biên bản đã lưu dù ảnh lỗi — nói rõ hạng mục nào thiếu ảnh để chụp bù ở
      // phần Chi tiết, đừng để người dùng tưởng cả biên bản trượt.
      if (failed.length) {
        setErr(`Đã lưu biên bản nhưng chưa tải được ảnh của: ${[...new Set(failed)].join(', ')}.`)
        await load()
        return
      }
      setShowForm(false)
      setItems((prev) => prev.map((it) => ({ ...it, result: 'pass', note: '', requires_suspension: false })))
      setInspectorName('')
      setGlobalNote('')
      capturedPhotos.forEach((shots) => shots.forEach((s) => URL.revokeObjectURL(s.url)))
      setCapturedPhotos(new Map())
      await load()
    } catch (e: any) {
      setErr(e.message || 'Lỗi lưu biên bản.')
    } finally {
      setBusy(false)
    }
  }

  const openDetail = async (id: number) => {
    try {
      const d = await api<{ inspection: Inspection; items: Array<InspectionItem & { id: number }>; photos: Photo[] }>(`/hse/inspections/${id}`)
      setDetail({ inspection: d.inspection, items: d.items, photos: d.photos })
    } catch (e: any) {
      setErr('Lỗi tải chi tiết: ' + e.message)
    }
  }

  const closeDetail = () => {
    setDetail(null)
  }

  const exportPdf = async (id: number, contractNo: string, formType: string) => {
    setBusy(true)
    try {
      const d = await api<{ inspection: Inspection; items: Array<InspectionItem & { id: number }> }>(`/hse/inspections/${id}`)
      const byCategory: Record<string, Array<InspectionItem & { id: number }>> = {}
      for (const it of d.items) {
        if (!byCategory[it.category]) byCategory[it.category] = []
        byCategory[it.category].push(it)
      }
      const sections: FormSection[] = Object.keys(byCategory)
        .sort()
        .map((cat) => ({
          title: CATEGORY_LABELS[cat] || cat,
          rows: byCategory[cat].map((it) => ({ code: it.item_code, name: it.item_name, result: it.result, note: it.note })),
        }))
      await exportFormPdf({
        formCode: FORM_CODES[formType] || formType,
        formTitle: `BIÊN BẢN KIỂM TRA ${FORM_LABELS[formType] || formType}`,
        meta: [
          { label: 'Hợp đồng', value: contractNo },
          { label: 'Ngày kiểm tra', value: fmtDate(d.inspection.inspection_date) },
          { label: 'Kiểm tra viên', value: d.inspection.inspector_name },
          { label: 'Kết quả', value: d.inspection.overall_result === 'pass' ? 'Đạt' : d.inspection.overall_result === 'fail' ? 'Không đạt' : 'Đạt một phần' },
        ],
        sections,
        footerNote: d.inspection.note || undefined,
        verifyCode: `INSP-${id}`,
        fileName: `${FORM_CODES[formType] || formType}_${contractNo}_${fmtDate(d.inspection.inspection_date)}.pdf`,
      })
    } catch (e: any) {
      setErr('Lỗi xuất PDF: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const groupedItems = items.reduce((acc, it) => {
    if (!acc[it.category]) acc[it.category] = []
    acc[it.category].push(it)
    return acc
  }, {} as Record<string, InspectionItem[]>)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Kiểm tra ATMT — BM-03 / BM-04</h1>
        <button onClick={() => {
          setShowForm(true); setErr('')
          if (!workTypeId) setWorkTypeId(String(workTypes.find((w) => w.code === (formType === 'BM04_DAILY' ? 'DEFAULT_DAILY' : 'DEFAULT_FULL'))?.id ?? ''))
        }} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">+ Tạo biên bản mới</button>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Hợp đồng</label>
        <select value={contractId} onChange={(e) => setContractId(e.target.value)} className="w-full border rounded px-3 py-2">
          <option value="">-- Tất cả --</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>{c.contract_no} — {c.title}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Biên bản</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ngày kiểm tra</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kiểm tra viên</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kết quả</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {inspections.map((insp) => (
              <tr key={insp.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm">
                  <div className="font-medium">{FORM_LABELS[insp.form_type] || insp.form_type}</div>
                  <div className="text-gray-500 text-xs">{insp.contract_no}</div>
                </td>
                <td className="px-4 py-3 text-sm">{fmtDate(insp.inspection_date)}</td>
                <td className="px-4 py-3 text-sm">{insp.inspector_name}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${RESULT_COLOR[insp.overall_result] || ''}`}>{insp.overall_result === 'pass' ? 'Đạt' : insp.overall_result === 'fail' ? 'Không đạt' : 'Đạt một phần'}</span>
                  {insp.suspension_required && <span className="ml-2 inline-block px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">Yêu cầu đình chỉ</span>}
                </td>
                <td className="px-4 py-3 text-sm space-x-2">
                  <button onClick={() => openDetail(insp.id)} className="text-blue-600 hover:underline">Chi tiết</button>
                  <button onClick={() => exportPdf(insp.id, insp.contract_no, insp.form_type)} className="text-green-600 hover:underline">Xuất PDF</button>
                </td>
              </tr>
            ))}
            {!inspections.length && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Chưa có biên bản nào</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Lập biên bản kiểm tra</h2>
              <button onClick={() => { setShowForm(false); setErr('') }} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Hợp đồng <span className="text-red-500">*</span></label>
                  <select value={contractId} onChange={(e) => setContractId(e.target.value)} className="w-full border rounded px-3 py-2">
                    <option value="">-- Chọn --</option>
                    {contracts.map((c) => (
                      <option key={c.id} value={c.id}>{c.contract_no} — {c.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Loại biên bản</label>
                  <select value={formType} onChange={(e) => changeFormType(e.target.value)} className="w-full border rounded px-3 py-2">
                    <option value="BM04_DAILY">BM-04 Hàng ngày</option>
                    <option value="BM03_WEEKLY">BM-03 Hàng tuần</option>
                    <option value="BM03_MONTHLY">BM-03 Hàng tháng</option>
                    <option value="BM03_INITIAL">BM-03 Lần đầu</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Ngày kiểm tra</label>
                  <input type="date" value={inspDate} onChange={(e) => setInspDate(e.target.value)} className="w-full border rounded px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Kiểm tra viên <span className="text-red-500">*</span></label>
                  <input type="text" value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} placeholder="Họ tên" className="w-full border rounded px-3 py-2" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Công việc JSA <span className="text-red-500">*</span></label>
                <select aria-label="Công việc JSA" value={workTypeId} onChange={(e) => setWorkTypeId(e.target.value)} disabled={busy} className="w-full border rounded px-3 py-2">
                  <option value="">-- Chọn công việc --</option>
                  {workTypes.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
              </div>
              {trainingBusy && <p className="text-sm text-gray-500">Đang đối chiếu khóa học và chứng chỉ…</p>}
              {trainingError && <p className="text-sm text-red-700">Không tải được thông tin khóa học: {trainingError}</p>}
              {training && <TrainingCheckPanel training={training} />}

              <div className="border-t pt-4">
                <h3 className="font-bold mb-3">Danh sách hạng mục kiểm tra</h3>
                {checklistBusy && <p className="text-sm text-gray-500">Đang tải checklist…</p>}
                {!checklistBusy && !items.length && <p className="text-sm text-amber-700">Công việc chưa có checklist. Hãy cấu hình trong Danh mục công việc JSA.</p>}
                {Object.entries(groupedItems).sort(([a], [b]) => a.localeCompare(b)).map(([cat, catItems]) => (
                  <div key={cat} className="mb-4">
                    <div className="bg-gray-100 px-3 py-2 font-medium text-sm">{CATEGORY_LABELS[cat] || cat}</div>
                    <div className="space-y-2 mt-2">
                      {catItems.map((it) => {
                        const globalIdx = items.indexOf(it)
                        const photos = capturedPhotos.get(globalIdx) || []
                        return (
                          <div key={globalIdx} className="border rounded p-3">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <div className="font-medium text-sm">{it.item_code} — {it.item_name}</div>
                                {it.requires_photo && <span className="text-xs text-orange-600">⚠ Yêu cầu ảnh minh chứng</span>}
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => setItemResult(globalIdx, 'pass')} className={`px-3 py-1 rounded text-sm ${it.result === 'pass' ? 'bg-green-600 text-white' : 'bg-gray-200'}`}>Đạt</button>
                                <button onClick={() => setItemResult(globalIdx, 'fail')} className={`px-3 py-1 rounded text-sm ${it.result === 'fail' ? 'bg-red-600 text-white' : 'bg-gray-200'}`}>Không đạt</button>
                                <button onClick={() => setItemResult(globalIdx, 'na')} className={`px-3 py-1 rounded text-sm ${it.result === 'na' ? 'bg-gray-600 text-white' : 'bg-gray-200'}`}>N/A</button>
                              </div>
                            </div>
                            <textarea value={it.note} onChange={(e) => setItemNote(globalIdx, e.target.value)} placeholder="Ghi chú (tùy chọn)" className="w-full border rounded px-3 py-2 text-sm mb-2" rows={2} />
                            <div className="flex items-center gap-4">
                              <label className="flex items-center text-sm">
                                <input type="checkbox" checked={it.requires_suspension} onChange={(e) => setItemSuspend(globalIdx, e.target.checked)} className="mr-2" />
                                Yêu cầu đình chỉ tức thì
                              </label>
                              <button onClick={() => openCamera(globalIdx)} className="text-blue-600 hover:underline text-sm">📷 Chụp ảnh</button>
                            </div>
                            {photos.length > 0 && (
                              <div className="flex gap-2 mt-2 flex-wrap">
                                {photos.map((shot, pIdx) => (
                                  <div key={shot.url} className="relative">
                                    <img src={shot.url} alt="" className="w-20 h-20 object-cover rounded border" />
                                    <button onClick={() => removePhoto(globalIdx, pIdx)} className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white rounded-full text-xs">✕</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Ghi chú chung</label>
                <textarea value={globalNote} onChange={(e) => setGlobalNote(e.target.value)} placeholder="Ghi chú (tùy chọn)" className="w-full border rounded px-3 py-2" rows={3} />
              </div>

              {err && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{err}</div>}
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button onClick={() => { setShowForm(false); setErr('') }} disabled={busy} className="px-4 py-2 border rounded hover:bg-gray-50">Hủy</button>
              <button onClick={submit} disabled={busy || checklistBusy || trainingBusy || !!trainingError} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{busy ? 'Đang lưu...' : 'Lưu biên bản'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Camera modal */}
      {cameraItemIdx !== null && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-3xl mx-4">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Chụp ảnh minh chứng</h2>
              <button onClick={closeCamera} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6">
              {/* muted là bắt buộc để autoPlay chạy trên iOS/Safari; thiếu nó video đứng khung đen. */}
              <video ref={videoRef} autoPlay playsInline muted className="w-full rounded border mb-2 bg-black" />
              <div className="text-center text-sm text-gray-600 mb-3 min-h-5">
                {camBusy ? 'Đang xử lý…' : shotCount > 0 ? `Đã chụp ${shotCount} ảnh cho hạng mục này.` : 'Hướng camera vào hiện trường rồi bấm Chụp.'}
              </div>
              {err && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm mb-3">{err}</div>}
              <div className="flex justify-center gap-4">
                <button onClick={capturePhoto} disabled={camBusy} className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 text-lg disabled:opacity-50">📷 Chụp</button>
                <button onClick={closeCamera} className="px-6 py-3 border rounded hover:bg-gray-50">Xong</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Chi tiết biên bản</h2>
              <button onClick={closeDetail} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="font-medium">Biên bản:</span> {FORM_LABELS[detail.inspection.form_type] || detail.inspection.form_type}</div>
                <div><span className="font-medium">Hợp đồng:</span> {detail.inspection.contract_no}</div>
                <div><span className="font-medium">Ngày kiểm tra:</span> {fmtDate(detail.inspection.inspection_date)}</div>
                <div><span className="font-medium">Kiểm tra viên:</span> {detail.inspection.inspector_name}</div>
                <div><span className="font-medium">Kết quả:</span> <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${RESULT_COLOR[detail.inspection.overall_result] || ''}`}>{detail.inspection.overall_result === 'pass' ? 'Đạt' : detail.inspection.overall_result === 'fail' ? 'Không đạt' : 'Đạt một phần'}</span></div>
                {detail.inspection.suspension_required && <div className="col-span-2"><span className="inline-block px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">⚠ Yêu cầu đình chỉ tức thì</span></div>}
              </div>
              {detail.inspection.work_type_name && <p className="text-sm"><span className="font-medium">Công việc JSA:</span> {detail.inspection.work_type_name}</p>}
              {detail.inspection.training_snapshot ? <TrainingCheckPanel training={detail.inspection.training_snapshot} snapshot /> :
                <p className="text-sm text-gray-500">Biên bản cũ chưa lưu thông tin đối chiếu khóa học JSA.</p>}
              {detail.inspection.note && (
                <div className="bg-gray-50 border rounded p-3">
                  <div className="font-medium text-sm mb-1">Ghi chú chung:</div>
                  <div className="text-sm text-gray-700">{detail.inspection.note}</div>
                </div>
              )}
              <div className="border-t pt-4">
                <h3 className="font-bold mb-3">Kết quả kiểm tra từng hạng mục</h3>
                {(() => {
                  const detailGrouped = detail.items.reduce((acc, it) => {
                    if (!acc[it.category]) acc[it.category] = []
                    acc[it.category].push(it)
                    return acc
                  }, {} as Record<string, Array<(typeof detail.items)[0]>>)
                  return Object.entries(detailGrouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, catItems]) => (
                    <div key={cat} className="mb-4">
                      <div className="bg-gray-100 px-3 py-2 font-medium text-sm">{CATEGORY_LABELS[cat] || cat}</div>
                      <div className="space-y-2 mt-2">
                        {catItems.map((it) => {
                        const itemPhotos = detail.photos.filter((p) => p.item_id === it.id)
                        return (
                          <div key={it.id} className="border rounded p-3">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <div className="font-medium text-sm">{it.item_code} — {it.item_name}</div>
                                {it.note && <div className="text-xs text-gray-600 mt-1">Ghi chú: {it.note}</div>}
                              </div>
                              <span className={`px-3 py-1 rounded text-sm font-medium ${it.result === 'pass' ? 'bg-green-100 text-green-700' : it.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                                {it.result === 'pass' ? 'Đạt' : it.result === 'fail' ? 'Không đạt' : 'N/A'}
                              </span>
                            </div>
                            {it.requires_suspension && <div className="text-xs text-red-600 mb-2">⚠ Yêu cầu đình chỉ tức thì</div>}
                            {itemPhotos.length > 0 && (
                              <div className="mt-2">
                                <div className="text-xs font-medium text-gray-600 mb-1">Ảnh minh chứng ({itemPhotos.length}):</div>
                                <div className="flex gap-2 flex-wrap">
                                  {itemPhotos.map((photo) => (
                                    <InspectionPhoto key={photo.id} id={photo.id} fileName={photo.file_name} takenAt={photo.taken_at} />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  ))
                })()}
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end">
              <button onClick={closeDetail} className="px-4 py-2 border rounded hover:bg-gray-50">Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
