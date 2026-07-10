import { Editor } from '@tinymce/tinymce-react'
import { getToken } from '../lib/api'

// Tải ảnh chèn trong nội dung lên máy chủ (thư mục uploads/content), trả về URL.
// Dùng cho images_upload_handler của TinyMCE: nhận blobInfo, POST kèm JWT, trả location.
async function uploadContentImage(blob: Blob, fileName: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', blob, fileName)
  const token = getToken()
  const res = await fetch('/api/media/content', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.location) {
    throw new Error((data as { error?: string })?.error ?? 'Tải ảnh thất bại.')
  }
  return data.location as string
}

// Trình soạn thảo TinyMCE tự host (offline, không cần API key).
// Tài nguyên nạp từ /tinymce (copy sẵn trong public/tinymce).
export default function RichText({
  value,
  onChange,
  height = 360,
}: {
  value: string
  onChange: (html: string) => void
  height?: number
}) {
  return (
    <Editor
      tinymceScriptSrc="/tinymce/tinymce.min.js"
      licenseKey="gpl"
      value={value}
      onEditorChange={(html) => onChange(html)}
      init={{
        height,
        menubar: false,
        branding: false,
        promotion: false,
        skin_url: '/tinymce/skins/ui/oxide',
        content_css: '/tinymce/skins/content/default/content.min.css',
        plugins: [
          'advlist', 'autolink', 'lists', 'link', 'image', 'charmap',
          'searchreplace', 'visualblocks', 'code', 'fullscreen',
          'insertdatetime', 'media', 'table', 'wordcount',
        ],
        toolbar:
          'undo redo | blocks | bold italic underline forecolor | ' +
          'alignleft aligncenter alignright | bullist numlist outdent indent | ' +
          'link image table | removeformat | code fullscreen',
        image_title: true,
        // Tải ảnh trực tiếp trong editor: lưu vào thư mục nội dung trên máy chủ.
        automatic_uploads: true,
        // Cho phép chọn file từ máy (nút "Tải lên" trong hộp thoại chèn ảnh)
        file_picker_types: 'image',
        images_upload_handler: (blobInfo) => uploadContentImage(blobInfo.blob(), blobInfo.filename()),
        content_style: 'body{font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6}',
      }}
    />
  )
}
