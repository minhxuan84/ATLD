/**
 * Video job manager — spawns auto-video-gen pipeline (child process)
 * và theo dõi trạng thái job trong bộ nhớ.
 *
 * Fire-and-forget: spawn trả ngay lập tức, client poll /status.
 * State in-memory (reset khi restart) — phù hợp cho môi trường DEV.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Trong Docker: dist/ → /app/server/dist, nên:
//   AUTO_VIDEO_DIR → /app/auto-video-gen
//   VIDEOS_DIR     → /app/server/uploads/videos
const AUTO_VIDEO_DIR =
  process.env.AUTO_VIDEO_GEN_DIR ?? join(__dirname, '..', '..', 'auto-video-gen')
const VIDEOS_DIR = join(__dirname, '..', 'uploads', 'videos')

export type JobStatus = 'pending' | 'running' | 'done' | 'error'

export interface VideoJob {
  jobId: string
  status: JobStatus
  topic: string
  createdAt: Date
  videoPath?: string
  error?: string
}

// In-memory store — reset khi restart server
const jobs = new Map<string, VideoJob>()

/** Tạo job mới, trả về jobId */
export function createJob(topic: string): string {
  const jobId = randomUUID()
  jobs.set(jobId, { jobId, status: 'pending', topic, createdAt: new Date() })
  return jobId
}

/** Lấy thông tin job */
export function getJob(jobId: string): VideoJob | undefined {
  return jobs.get(jobId)
}

/**
 * Ghi script.json rồi spawn pipeline auto-video-gen trong child process.
 * await chỉ chờ mkdir + writeFile (~vài ms), không chờ pipeline xong.
 */
export async function spawnVideoJob(jobId: string, script: object): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) throw new Error(`Job ${jobId} không tồn tại.`)

  const outputDir = join(VIDEOS_DIR, jobId)
  await mkdir(outputDir, { recursive: true })

  const scriptPath = join(outputDir, 'script.json')
  await writeFile(scriptPath, JSON.stringify(script, null, 2), 'utf8')

  job.status = 'running'

  // tsx được cài trong auto-video-gen/node_modules/.bin/ (devDep, cần cho runtime tsx)
  const tsxBin = join(AUTO_VIDEO_DIR, 'node_modules', '.bin', 'tsx')
  const cliScript = join(AUTO_VIDEO_DIR, 'src', 'cli.ts')

  const child = spawn(tsxBin, [cliScript, scriptPath], {
    cwd: AUTO_VIDEO_DIR,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const prefix = `[video:${jobId.slice(0, 8)}]`

  child.stdout?.on('data', (d: Buffer) => {
    process.stdout.write(`${prefix} ${d}`)
  })
  child.stderr?.on('data', (d: Buffer) => {
    process.stderr.write(`${prefix} ${d}`)
  })

  child.on('close', (code) => {
    const videoPath = join(outputDir, 'video.mp4')
    if (code === 0 && existsSync(videoPath)) {
      job.status = 'done'
      job.videoPath = videoPath
      console.log(`${prefix} ✅ video.mp4 sẵn sàng`)
    } else {
      job.status = 'error'
      job.error =
        code === 0
          ? 'Pipeline hoàn thành nhưng không tìm thấy video.mp4'
          : `Pipeline kết thúc với code ${code}`
      console.error(`${prefix} ❌ ${job.error}`)
    }
  })

  child.on('error', (err) => {
    job.status = 'error'
    job.error = err.message
    console.error(`${prefix} spawn error: ${err.message}`)
  })
}
