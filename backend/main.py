import os
import json
import logging
import asyncio
from typing import Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
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

# Servir clipe de vídeo (suporta Range HTTP automaticamente)
@app.get("/api/clips/{clip_filename}")
async def serve_clip(clip_filename: str):
    path = os.path.join(CLIPS_DIR, clip_filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Clipe não encontrado")
    return FileResponse(path, media_type="video/mp4")

# Servir miniatura ultra leve do vídeo (JPEG 10KB) com cache
@app.get("/api/clips/{clip_filename}/thumb")
async def get_clip_thumbnail(clip_filename: str):
    video_path = os.path.join(CLIPS_DIR, clip_filename)
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Clipe não encontrado")
        
    thumbs_dir = os.path.join(CLIPS_DIR, ".thumbs")
    os.makedirs(thumbs_dir, exist_ok=True)
    thumb_path = os.path.join(thumbs_dir, f"{clip_filename}.jpg")
    
    if not os.path.exists(thumb_path):
        import cv2
        cap = cv2.VideoCapture(video_path)
        # Pula para frame 10 para evitar eventuais telas pretas iniciais
        cap.set(cv2.CAP_PROP_POS_FRAMES, 10)
        ret, frame = cap.read()
        if not ret:
            # Fallback para frame 0 se o vídeo for muito curto
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = cap.read()
        cap.release()
        
        if ret and frame is not None:
            h, w = frame.shape[:2]
            target_w = 360
            target_h = int(target_w * h / w) if w > 0 else 202
            resized = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)
            cv2.imwrite(thumb_path, resized, [cv2.IMWRITE_JPEG_QUALITY, 80])
        else:
            # Se não conseguiu ler o frame, gera uma miniatura escura padrão com gradiente
            import numpy as np
            blank = np.zeros((202, 360, 3), dtype=np.uint8)
            cv2.imwrite(thumb_path, blank)
            
    return FileResponse(
        thumb_path, 
        media_type="image/jpeg", 
        headers={"Cache-Control": "public, max-age=604800"}
    )

# Excluir clipe
@app.delete("/api/clips/{clip_filename}")
async def delete_clip(clip_filename: str):
    path = os.path.join(CLIPS_DIR, clip_filename)
    if os.path.exists(path):
        try:
            os.remove(path)
            return {"status": "success"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Erro ao deletar arquivo: {str(e)}")
    raise HTTPException(status_code=404, detail="Clipe não encontrado")

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
