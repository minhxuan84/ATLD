> ⚠️ **Đã lỗi thời** — nguồn cập nhật: [`docs/DEPLOY-OPS.md`](docs/DEPLOY-OPS.md). Giữ file này chỉ để tham khảo lịch sử.

# Hướng dẫn triển khai ATLĐ VICEM Hà Tiên với Docker

## Yêu cầu
- Docker Desktop 20.10+ (Windows/Mac) hoặc Docker Engine + Docker Compose (Linux)
- PostgreSQL database `vicem_cms` đã có sẵn với schema `atld`
- 2GB RAM, 5GB disk trống

## Cấu trúc triển khai
- **App container**: Node.js server + React frontend (đã build)
- **Database**: Kết nối tới Postgres `vicem_cms` ngoài container (trên host hoặc máy chủ khác)
- **Volumes**: `/app/server/uploads` (lưu ảnh nhận diện & nội dung)

## Bước 1: Chuẩn bị môi trường

### 1.1. Khởi động Docker Desktop
- **Windows/Mac**: Mở Docker Desktop từ Start Menu hoặc Applications
- Chờ biểu tượng Docker trên system tray hiển thị "Docker Desktop is running"

### 1.2. Cấu hình kết nối database
Sao chép file mẫu và điền thông tin thật:
```bash
cp .env.docker.example .env.docker
```

Chỉnh sửa `.env.docker`:
- `PGHOST`: Để `host.docker.internal` (Docker Desktop) hoặc IP máy chủ DB thật
- `PGPASSWORD`: Mật khẩu Postgres thật
- `JWT_SECRET`: Chuỗi bí mật dài ngẫu nhiên (dùng cho production)
- `CORS_ORIGIN`: Domain/cổng mà người dùng truy cập (vd: `https://atld.vicem.com`)

## Bước 2: Tạo schema (chỉ lần đầu)

Schema `atld` và các bảng được tạo bằng file `server/db/schema.sql` (dùng `CREATE ... IF NOT EXISTS`, an toàn chạy lại). Áp dụng vào database:
```bash
psql -h <host> -U vicem_admin -d vicem_cms -f server/db/schema.sql
```

> ⚠️ **Quan trọng**: KHÔNG chạy `npm run seed` trên database production — lệnh seed dùng `TRUNCATE` sẽ xóa toàn bộ dữ liệu schema `atld`. Chỉ seed cho môi trường dev/test trống.

## Bước 3: Build & chạy

Có **hai file env** với vai trò khác nhau:
- **`.env`** — docker compose đọc để thay thế `${APP_PORT}` (cổng public trên host)
- **`.env.docker`** — nạp biến môi trường VÀO trong container (DB, JWT, CORS...)

```bash
# Build image
docker compose build

# Chạy nền
docker compose up -d

# Xem log
docker compose logs -f app
```

Ứng dụng chạy tại `http://localhost:4001` (theo `APP_PORT` trong `.env`).

> Nếu cổng bị trùng với server dev đang chạy, đổi `APP_PORT` trong `.env`. Cổng nội bộ container luôn là 4000.

## Bước 4: Kiểm tra

```bash
# Health check
curl http://localhost:4001/api/health
# -> {"ok":true,"service":"atld-api"}

# Trạng thái container (mong đợi: Up ... (healthy))
docker compose ps
```

## Truy cập từ máy khác trong cùng mạng LAN

Stack gồm 2 container: **app** (nội bộ) + **nginx** (HTTPS reverse proxy, self-signed cert).
Máy khác truy cập qua HTTPS: `https://172.16.7.246:8443`

> Cổng 80/443 đã bị Apache (httpd) của hệ CMS chiếm, nên nginx dùng **8080/8443**.

### 1. Mở firewall Windows (chạy PowerShell/CMD **với quyền Admin**)
```powershell
netsh advfirewall firewall add rule name="ATLD HTTPS 8443" dir=in action=allow protocol=TCP localport=8443
netsh advfirewall firewall add rule name="ATLD HTTP 8080" dir=in action=allow protocol=TCP localport=8080
```

### 2. Nếu mạng là "Public", đổi sang "Private" (PowerShell Admin)
```powershell
Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private
```

### 3. URL truy cập
```
https://172.16.7.246:8443   (máy khác trong LAN)
```
> Trình duyệt sẽ cảnh báo "Not secure" do dùng self-signed cert — bấm **Advanced → Proceed** để vào. Đây là bình thường cho mạng nội bộ.

### 4. Khi đổi IP hoặc domain
Sửa `CORS_ORIGIN` trong `.env.docker`, cập nhật `server_name` + cổng redirect trong `nginx/nginx.conf`, sinh lại cert cho IP mới, rồi:
```bash
docker compose down && docker compose up -d
```

## Vận hành

```bash
# Dừng
docker compose down

# Rebuild sau khi cập nhật code
docker compose up -d --build

# Xem dung lượng volume ảnh
docker volume inspect atld_atld-uploads
```

## Tài khoản mặc định (nếu đã seed dev)
| Vai trò | Username | Password |
|---------|----------|----------|
| Admin | `admin` | `Admin@123` |
| Cán bộ ATLĐ | `canbo` | `Canbo@123` |
| Học viên | `hocvien` | `Hocvien@123` |

> Đổi toàn bộ mật khẩu mặc định ngay khi lên production.

## Xử lý sự cố

**Không kết nối được database:**
- Kiểm tra Postgres cho phép kết nối từ Docker: sửa `pg_hba.conf` + `listen_addresses='*'`
- Trên Linux, `host.docker.internal` không có sẵn — dùng IP host thật hoặc `network_mode: host`

**Ảnh upload mất sau khi rebuild:**
- Đảm bảo volume `atld-uploads` không bị xóa (`docker compose down` giữ volume, `down -v` xóa volume)

**Lỗi CSP / ảnh không hiển thị:**
- Kiểm tra `CORS_ORIGIN` khớp domain thật đang truy cập
