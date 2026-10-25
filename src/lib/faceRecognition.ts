/**
 * faceRecognition.ts — helper nhận diện khuôn mặt dựa trên face-api.js.
 *
 * - Lazy-load model từ /models (public/models) ở lần gọi đầu tiên để tránh
 *   tải model trên mỗi lần import.
 * - enrollFace(): phát hiện 1 khuôn mặt, tính descriptor 128 chiều, trả về number[]
 *   (dạng plain array để lưu JSONB xuống DB).
 * - matchFace(): so khớp descriptor với danh sách ứng viên bằng khoảng cách Euclid,
 *   trả về ứng viên gần nhất nếu khoảng cách < ngưỡng (mặc định 0.6).
 */
import * as faceapi from 'face-api.js'

const MODEL_URL = '/models'
const MATCH_THRESHOLD = 0.6

let modelsLoaded = false
let loadPromise: Promise<void> | null = null

/** Tải model face-api.js (chỉ chạy 1 lần, các lần sau dùng lại promise). */
export function loadModels(): Promise<void> {
  if (modelsLoaded) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
    modelsLoaded = true
  })()
  return loadPromise
}

export type FaceInput =
  | HTMLVideoElement
  | HTMLImageElement
  | HTMLCanvasElement

export interface FaceCandidate {
  id: number
  name: string
  type: string
  descriptor: number[]
}

export interface FaceMatch {
  id: number
  name: string
  type: string
  distance: number
}

/**
 * Phát hiện 1 khuôn mặt trong input và trả về descriptor 128 chiều.
 * Ném lỗi nếu không tìm thấy khuôn mặt nào.
 */
export async function enrollFace(input: FaceInput): Promise<number[]> {
  await loadModels()
  const detection = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!detection) {
    throw new Error('Không phát hiện được khuôn mặt. Vui lòng nhìn thẳng vào camera.')
  }
  return Array.from(detection.descriptor)
}

/**
 * So khớp một descriptor với danh sách ứng viên.
 * Trả về ứng viên gần nhất nếu khoảng cách < threshold, ngược lại null.
 */
export function matchFace(
  descriptor: number[],
  candidates: FaceCandidate[],
  threshold: number = MATCH_THRESHOLD,
): FaceMatch | null {
  if (!descriptor?.length || !candidates.length) return null

  const query = new Float32Array(descriptor)
  let best: FaceMatch | null = null

  for (const c of candidates) {
    if (!c.descriptor?.length) continue
    const dist = faceapi.euclideanDistance(query, new Float32Array(c.descriptor))
    if (best === null || dist < best.distance) {
      best = { id: c.id, name: c.name, type: c.type, distance: dist }
    }
  }

  if (best && best.distance < threshold) return best
  return null
}

/**
 * Phát hiện khuôn mặt trực tiếp từ video và trả về descriptor cùng vị trí box
 * (dùng cho luồng quét liên tục ở cổng). Trả về null nếu không có khuôn mặt.
 */
export async function detectFaceWithBox(
  input: FaceInput,
): Promise<{ descriptor: number[]; box: faceapi.Box } | null> {
  await loadModels()
  const detection = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!detection) return null
  return {
    descriptor: Array.from(detection.descriptor),
    box: detection.detection.box,
  }
}
