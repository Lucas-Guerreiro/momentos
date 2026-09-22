import os
import json
import logging
import asyncio
from typing import Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from camera_manager import CameraManager

# Configura logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

# Caminhos
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLIPS_DIR = os.path.join(BASE_DIR, "cortes")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
CONTROLS_PATH = os.path.join(BASE_DIR, "controls.json")
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

# Cria pastas necessárias
os.makedirs(CLIPS_DIR, exist_ok=True)
os.makedirs(FRONTEND_DIR, exist_ok=True)

import sys

def download_openh264_dll():
    if not sys.platform.startswith("win"):
        # No Linux, os codecs padrão FFmpeg / V4L2 já são suportados nativamente
        return
        
    import urllib.request
    import bz2
    import shutil
    
    dll_name = "openh264-2.5.0-win64.dll"
    dll_path = os.path.join(BASE_DIR, dll_name)
    
    # Se a DLL já existe, não faz nada
    if os.path.exists(dll_path):
        return
        
    url = f"https://github.com/cisco/openh264/releases/download/v2.5.0/{dll_name}.bz2"
    bz2_path = dll_path + ".bz2"
    
    logger.info("Instalando codec Cisco OpenH264 para gravacao H.264 nativa no Windows...")
    try:
        urllib.request.urlretrieve(url, bz2_path)
        with bz2.open(bz2_path, 'rb') as source, open(dll_path, 'wb') as dest:
            shutil.copyfileobj(source, dest)
        os.remove(bz2_path)
        logger.info("OpenH264 DLL instalada na pasta backend!")
        
        # Copia também para o diretório de Scripts do venv se existir
        venv_scripts_dir = os.path.join(BASE_DIR, "venv", "Scripts")
        if os.path.exists(venv_scripts_dir):
            shutil.copy2(dll_path, os.path.join(venv_scripts_dir, dll_name))
            logger.info("OpenH264 DLL copiada para venv/Scripts!")
    except Exception as e:
        logger.error(f"Erro ao baixar codec OpenH264: {e}. O sistema usará fallbacks como MP4V/MJPG.")


app = FastAPI(title="Momentos - Sistema de Recorte de Vídeo")

# Habilita CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inicializa o gerenciador de câmeras
camera_manager = CameraManager(config_path=CONFIG_PATH, clips_dir=CLIPS_DIR)

# Modelos Pydantic para APIs
class CameraCreate(BaseModel):
    name: str
    source: str
    buffer_seconds: int = 10
    fps: int = 30

class TriggerRequest(BaseModel):
    camera_id: str
    seconds_before: int = 5
    seconds_after: int = 3
    clip_name_prefix: str = "recorte"

class ControlBinding(BaseModel):
    camera_id: str
    binding_type: str # "keyboard" ou "gamepad"
    key: Optional[str] = None # Ex: "Space", "Enter"
    gamepad_index: Optional[int] = None
    button_index: Optional[int] = None

class EditClipRequest(BaseModel):
    filename: str
    start_time: float = 0.0
    end_time: float = 10.0
    aspect_ratio: str = "9-16" # "9-16", "1-1", "16-9"
    pan_pct: float = 50.0 # 0 a 100
    text: Optional[str] = None
    text_style: Optional[str] = "black-pill"
    text_pos: Optional[str] = "middle"

def fix_incompatible_clips():
    """
    Verifica se existem vídeos salvos em formatos antigos (ex: FMP4/mp4v)
    e converte para H.264 nativo (avc1) para que todos os navegadores e celulares possam reproduzir.
    """
    import shutil
    import subprocess
    import cv2
    
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        try:
            import imageio_ffmpeg
            ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ffmpeg_bin = None

    if not ffmpeg_bin or not os.path.exists(CLIPS_DIR):
        return

    for f in os.listdir(CLIPS_DIR):
        if not f.endswith(".mp4") or f.startswith("temp_"):
            continue
        path = os.path.join(CLIPS_DIR, f)
        try:
            cap = cv2.VideoCapture(path)
            fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
            fourcc_str = ''.join([chr((fourcc >> 8 * i) & 0xFF) for i in range(4)])
            cap.release()

            # Se o vídeo está em FMP4 ou mp4v, transcodifica para H.264
            if fourcc_str.upper() in ['FMP4', 'MP4V', 'MJPG', '']:
                temp_path = os.path.join(CLIPS_DIR, f"temp_{f}")
                logger.info(f"Convertendo vídeo incompatível para H.264 nativo: {f}...")
                cmd = [
                    ffmpeg_bin,
                    "-y",
                    "-i", path,
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    temp_path
                ]
                res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if res.returncode == 0 and os.path.exists(temp_path) and os.path.getsize(temp_path) > 1000:
                    stat = os.stat(path)
                    os.replace(temp_path, path)
                    # Preserva a data de modificação original do arquivo
                    os.utime(path, (stat.st_atime, stat.st_mtime))
                    logger.info(f"Vídeo {f} convertido com sucesso para H.264 nativo!")
                else:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
        except Exception as e:
            logger.warning(f"Não foi possível converter {f}: {e}")

# Ciclo de vida: Iniciar câmeras ao iniciar a API
@app.on_event("startup")
async def startup_event():
    try:
        download_openh264_dll()
    except Exception as e:
        logger.error(f"Falha ao iniciar codec OpenH264: {e}")
        
    # Dispara a correção de vídeos incompatíveis em background
    asyncio.get_event_loop().run_in_executor(None, fix_incompatible_clips)
    
    logger.info("Iniciando conexões com as câmeras...")
    camera_manager.start_all()

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Encerrando conexões com as câmeras...")
    camera_manager.stop_all()

# --- Endpoints da API ---

@app.get("/api/cameras")
async def get_cameras():
    return camera_manager.get_camera_status()

@app.get("/api/devices/cameras")
async def get_device_cameras():
    import cv2
    import sys
    available_cameras = []
    # No Windows usamos CAP_DSHOW, no Linux usamos CAP_V4L2
    backend_flag = cv2.CAP_DSHOW if sys.platform.startswith("win") else cv2.CAP_V4L2
    
    for i in range(6):
        try:
            cap = cv2.VideoCapture(i, backend_flag)
            if cap.isOpened():
                ret, _ = cap.read()
                if ret:
                    available_cameras.append({
                        "id": str(i),
                        "name": f"Câmera USB / Placa Captura (Index {i})"
                    })
                cap.release()
        except Exception:
            pass
    return available_cameras


@app.post("/api/cameras")
async def add_camera(cam: CameraCreate):
    try:
        config = camera_manager.add_camera(
            name=cam.name,
            source=cam.source,
            buffer_seconds=cam.buffer_seconds,
            fps=cam.fps
        )
        return {"status": "success", "camera": config}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/cameras/{cam_id}")
async def update_camera(cam_id: str, cam: CameraCreate):
    try:
        config = camera_manager.update_camera(
            cam_id=cam_id,
            name=cam.name,
            source=cam.source,
            buffer_seconds=cam.buffer_seconds,
            fps=cam.fps
        )
        if config:
            return {"status": "success", "camera": config}
        raise HTTPException(status_code=404, detail="Câmera não encontrada")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/cameras/{cam_id}")
async def remove_camera(cam_id: str):
    success = camera_manager.remove_camera(cam_id)
    if success:
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Câmera não encontrada")

@app.post("/api/trigger")
async def trigger_clip(req: TriggerRequest):
    clip_filename = camera_manager.trigger_camera_clip(
        cam_id=req.camera_id,
        seconds_before=req.seconds_before,
        seconds_after=req.seconds_after,
        clip_name_prefix=req.clip_name_prefix
    )
    if clip_filename:
        return {"status": "success", "clip_filename": clip_filename}
    raise HTTPException(status_code=400, detail="Não foi possível gerar o recorte. Verifique se a câmera está ativa e possui frames no buffer.")

# Stream de vídeo MJPEG em tempo real
@app.get("/api/cameras/{cam_id}/stream")
async def get_camera_stream(cam_id: str):
    if cam_id not in camera_manager.cameras:
        raise HTTPException(status_code=404, detail="Câmera não encontrada ou inativa")
    
    cam = camera_manager.cameras[cam_id]
    
    async def generate():
        while cam.is_running:
            frame_bytes = cam.get_preview_frame()
            if frame_bytes:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            # FPS do stream limitado a no máximo 15 FPS para economizar CPU e rede
            await asyncio.sleep(1.0 / min(cam.fps, 15))

    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

# Listar clipes recortados
@app.get("/api/clips")
async def get_clips():
    clips = []
    if os.path.exists(CLIPS_DIR):
        for f in os.listdir(CLIPS_DIR):
            if f.endswith(".mp4"):
                path = os.path.join(CLIPS_DIR, f)
                stat = os.stat(path)
                clips.append({
                    "filename": f,
                    "size_bytes": stat.st_size,
                    "created_at": stat.st_mtime
                })
    # Ordena pelo mais recente
    clips.sort(key=lambda x: x["created_at"], reverse=True)
    return clips

# Servir clipe de vídeo (suporta Range HTTP localmente ou redireciona para R2)
@app.get("/api/clips/{clip_filename}")
async def serve_clip(clip_filename: str):
    path = os.path.join(CLIPS_DIR, clip_filename)
    if os.path.exists(path):
        return FileResponse(path, media_type="video/mp4")
    from cloud_sync import R2_PUBLIC_URL
    return RedirectResponse(url=f"{R2_PUBLIC_URL}/{clip_filename}", status_code=307)

# Servir miniatura do vídeo com geração local ou fallback no R2
@app.get("/api/clips/{clip_filename}/thumb")
async def get_clip_thumbnail(clip_filename: str):
    thumbs_dir = os.path.join(CLIPS_DIR, ".thumbs")
    os.makedirs(thumbs_dir, exist_ok=True)
    thumb_path = os.path.join(thumbs_dir, f"{clip_filename}.jpg")
    
    if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
        return FileResponse(thumb_path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})

    video_path = os.path.join(CLIPS_DIR, clip_filename)
    if os.path.exists(video_path):
        try:
            import cv2
            cap = cv2.VideoCapture(video_path)
            cap.set(cv2.CAP_PROP_POS_FRAMES, 10)
            ret, frame = cap.read()
            if not ret:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret, frame = cap.read()
            cap.release()
            
            if ret and frame is not None:
                h, w = frame.shape[:2]
                target_w = 480
                target_h = int(target_w * h / w) if w > 0 else 270
                resized = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)
                cv2.imwrite(thumb_path, resized, [cv2.IMWRITE_JPEG_QUALITY, 85])
                return FileResponse(thumb_path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})
        except Exception as e:
            logger.warning(f"Aviso ao gerar miniatura local: {e}")

    from cloud_sync import R2_PUBLIC_URL
    return RedirectResponse(url=f"{R2_PUBLIC_URL}/thumbs/{clip_filename}.jpg", status_code=307)

# Excluir clipe (Local + Cloudflare R2 + Supabase)
@app.delete("/api/clips/{clip_filename}")
async def delete_clip(clip_filename: str):
    local_deleted = False
    
    # 1. Deleta arquivos locais (vídeo, miniatura, preview) se existirem
    path = os.path.join(CLIPS_DIR, clip_filename)
    thumb_path = os.path.join(CLIPS_DIR, ".thumbs", f"{clip_filename}.jpg")
    preview_path = os.path.join(CLIPS_DIR, ".previews", f"prev_{clip_filename}")

    for p in [path, thumb_path, preview_path]:
        if os.path.exists(p):
            try:
                os.remove(p)
                local_deleted = True
                logger.info(f"Arquivo local removido: {p}")
            except Exception as e:
                logger.warning(f"Erro ao remover arquivo local {p}: {e}")

    # 2. Deleta arquivos no Cloudflare R2 e registro no Supabase
    cloud_deleted = False
    try:
        from cloud_sync import delete_clip_cloud
        cloud_deleted = await asyncio.to_thread(delete_clip_cloud, clip_filename)
    except Exception as e:
        logger.warning(f"Erro ao processar exclusão na nuvem para {clip_filename}: {e}")

    # Retorna sucesso se foi deletado localmente, na nuvem, ou simplesmente confirmado
    return {
        "status": "success",
        "filename": clip_filename,
        "deleted_local": local_deleted,
        "deleted_cloud": cloud_deleted
    }

def create_text_overlay_image(width: int, height: int, text: Optional[str] = None, style: str = "black-pill", pos: str = "middle", output_path: Optional[str] = None) -> str:
    """
    Gera uma imagem PNG transparente com a marca d'água oficial e o badge de legenda
    personalizado estilizado do atleta para queima direta via FFmpeg.
    """
    from PIL import Image, ImageDraw, ImageFont
    import tempfile

    if not output_path:
        fd, output_path = tempfile.mkstemp(suffix=".png", prefix="overlay_")
        os.close(fd)

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    def get_font(size: int, bold: bool = True):
        candidates = [
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf" if bold else "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
            "C:\\Windows\\Fonts\\arialbd.ttf" if bold else "C:\\Windows\\Fonts\\arial.ttf",
            "C:\\Windows\\Fonts\\segoeui.ttf",
        ]
        for c in candidates:
            if os.path.exists(c):
                try:
                    return ImageFont.truetype(c, size)
                except Exception:
                    pass
        try:
            return ImageFont.load_default()
        except Exception:
            return None

    # 1. Marca d'água MOMENTOS no canto superior direito
    wm_font = get_font(max(13, int(width * 0.024)), bold=True)
    wm_text = "MOMENTOS"
    try:
        wm_bbox = draw.textbbox((0, 0), wm_text, font=wm_font) if wm_font else (0, 0, 80, 20)
        wm_w = wm_bbox[2] - wm_bbox[0]
        wm_h = wm_bbox[3] - wm_bbox[1]
    except Exception:
        wm_w, wm_h = 80, 20

    wm_x = width - wm_w - 28
    wm_y = 28
    draw.rounded_rectangle([wm_x - 10, wm_y - 6, wm_x + wm_w + 10, wm_y + wm_h + 6], radius=6, fill=(0, 0, 0, 140))
    draw.text((wm_x, wm_y - 2), wm_text, fill=(255, 255, 255, 230), font=wm_font)

    # 2. Legenda / Frase personalizada
    if text and text.strip():
        text_clean = text.strip()
        font_size = max(22, int(width * 0.052))
        font = get_font(font_size, bold=True)

        if pos == "top":
            cy = int(height * 0.20)
        elif pos == "bottom":
            cy = int(height * 0.78)
        else: # middle
            cy = int(height * 0.48)

        try:
            t_bbox = draw.textbbox((0, 0), text_clean, font=font) if font else (0, 0, len(text_clean) * 15, 30)
            tw = t_bbox[2] - t_bbox[0]
            th = t_bbox[3] - t_bbox[1]
        except Exception:
            tw = len(text_clean) * 15
            th = 30

        cx = width // 2
        pad_x = 24
        pad_y = 14
        box_w = min(width - 40, tw + (pad_x * 2))
        box_h = th + (pad_y * 2)
        box_x0 = max(10, cx - (box_w // 2))
        box_y0 = cy - (box_h // 2)
        box_x1 = min(width - 10, box_x0 + box_w)
        box_y1 = box_y0 + box_h

        if style == "black-pill":
            draw.rounded_rectangle([box_x0, box_y0, box_x1, box_y1], radius=14, fill=(0, 0, 0, 220), outline=(255, 255, 255, 75), width=2)
            draw.text((cx - tw // 2, cy - th // 2 - 2), text_clean, fill=(255, 255, 255, 255), font=font)
        elif style == "gold-pill":
            draw.rounded_rectangle([box_x0, box_y0, box_x1, box_y1], radius=14, fill=(245, 158, 11, 240))
            draw.text((cx - tw // 2, cy - th // 2 - 2), text_clean, fill=(0, 0, 0, 255), font=font)
        elif style == "cyan-pill":
            draw.rounded_rectangle([box_x0, box_y0, box_x1, box_y1], radius=14, fill=(6, 182, 212, 240))
            draw.text((cx - tw // 2, cy - th // 2 - 2), text_clean, fill=(255, 255, 255, 255), font=font)
        else: # clean-text
            for dx, dy in [(-2, 0), (2, 0), (0, -2), (0, 2), (2, 2), (-2, -2), (2, -2), (-2, 2)]:
                draw.text((cx - tw // 2 + dx, cy - th // 2 + dy - 2), text_clean, fill=(0, 0, 0, 240), font=font)
            draw.text((cx - tw // 2, cy - th // 2 - 2), text_clean, fill=(255, 255, 255, 255), font=font)

    img.save(output_path, "PNG")
    return output_path

# Editar clipe (Corte, Crop 9:16/1:1, Pan, Queima de Texto e Otimização para Instagram)
@app.post("/api/clips/edit")
async def edit_clip(req: EditClipRequest):
    import subprocess
    input_path = os.path.join(CLIPS_DIR, req.filename)

    # Se o arquivo não existir localmente, tenta baixar do Cloudflare R2
    if not os.path.exists(input_path):
        from cloud_sync import R2_PUBLIC_URL
        import urllib.request
        r2_url = f"{R2_PUBLIC_URL}/{req.filename}"
        try:
            os.makedirs(CLIPS_DIR, exist_ok=True)
            await asyncio.to_thread(urllib.request.urlretrieve, r2_url, input_path)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Clipe não encontrado: {str(e)}")

    output_filename = f"editado_{req.filename}"
    output_path = os.path.join(CLIPS_DIR, output_filename)

    start_sec = max(0.0, req.start_time)
    duration = max(0.5, req.end_time - start_sec)
    pan_ratio = max(0.0, min(1.0, req.pan_pct / 100.0))

    target_w, target_h = 720, 1280
    if req.aspect_ratio == "9-16":
        target_w, target_h = 720, 1280
        scale_crop_filter = f"crop=w=ih*9/16:h=ih:x=(iw-ow)*{pan_ratio}:y=0,scale=720:1280:flags=lanczos"
    elif req.aspect_ratio == "1-1":
        target_w, target_h = 720, 720
        scale_crop_filter = f"crop=w=ih:h=ih:x=(iw-ow)*{pan_ratio}:y=0,scale=720:720:flags=lanczos"
    else:
        target_w, target_h = 1280, 720
        scale_crop_filter = "scale=1280:720:flags=lanczos"

    overlay_path = None
    try:
        overlay_path = create_text_overlay_image(
            width=target_w,
            height=target_h,
            text=req.text,
            style=req.text_style or "black-pill",
            pos=req.text_pos or "middle"
        )

        filter_complex = f"[0:v]{scale_crop_filter}[v0];[v0][1:v]overlay=0:0[outv]"

        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start_sec),
            "-t", str(duration),
            "-i", input_path,
            "-i", overlay_path,
            "-filter_complex", filter_complex,
            "-map", "[outv]",
            "-map", "0:a?",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "22",
            "-c:a", "aac",
            "-movflags", "+faststart",
            output_path
        ]

        res = await asyncio.to_thread(subprocess.run, cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return FileResponse(
                output_path,
                media_type="video/mp4",
                filename=f"lance_{req.filename}",
                headers={"Content-Disposition": f'attachment; filename="lance_{req.filename}"'}
            )
        else:
            raise HTTPException(status_code=500, detail="Falha ao processar vídeo com FFmpeg")
    except Exception as e:
        logger.error(f"Erro ao editar clipe: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if overlay_path and os.path.exists(overlay_path):
            try:
                os.remove(overlay_path)
            except Exception:
                pass

# --- Controles / Mapeamento de Botões Arcade ---
@app.get("/api/config/controls")
async def get_controls():
    if os.path.exists(CONTROLS_PATH):
        try:
            with open(CONTROLS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

@app.post("/api/config/controls")
async def save_controls(bindings: list[ControlBinding]):
    try:
        data = [b.dict() for b in bindings]
        with open(CONTROLS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Informações de Rede e Acesso dos Atletas ---
def get_local_ip():
    import socket
    import subprocess
    import sys
    
    # 1. Tenta método do socket UDP ativo
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass

    # 2. No Linux, busca IP da interface de rede local via comando hostname
    if not sys.platform.startswith("win"):
        try:
            out = subprocess.check_output(["hostname", "-I"], text=True).strip()
            ips = out.split()
            for ip in ips:
                if not ip.startswith("127.") and not ip.startswith("172.17.") and not ip.startswith("172.18."):
                    return ip
            if ips:
                return ips[0]
        except Exception:
            pass

    # 3. Tenta através do hostname do sistema
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127."):
                return ip
    except Exception:
        pass

    return "127.0.0.1"

@app.get("/api/system/network")
async def get_network_info():
    ip = get_local_ip()
    port = 8000
    athlete_url = f"http://{ip}:{port}/atleta"
    return {
        "local_ip": ip,
        "port": port,
        "athlete_url": athlete_url
    }

# --- Servir Front-end ---
@app.get("/atleta", response_class=HTMLResponse)
@app.get("/atleta/", response_class=HTMLResponse)
async def serve_atleta():
    atleta_index_path = os.path.join(FRONTEND_DIR, "atleta", "index.html")
    if os.path.exists(atleta_index_path):
        with open(atleta_index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Portal do Atleta não encontrado. Crie a pasta 'frontend/atleta' com 'index.html'.</h1>")

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Frontend não encontrado. Crie a pasta 'frontend' com o 'index.html'.</h1>")

# Monta o diretório do frontend como arquivos estáticos para CSS/JS/Assets
app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="static")
