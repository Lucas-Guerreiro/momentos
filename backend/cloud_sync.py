import os
import logging
import threading
import datetime
import subprocess
import urllib.request
import urllib.parse
import json
import boto3
from botocore.config import Config

logger = logging.getLogger("cloud_sync")

# Configurações do Supabase (Banco de Dados & Realtime)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wdjyxbrlergrvfilulyv.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indkanl4YnJsZXJncnZmaWx1bHl2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY5MDgwMiwiZXhwIjoyMTAzMjY2ODAyfQ.gakenrouBrn9BijWcWwrALFU8WVYjosxaws64nbLUJM"
)

# Configurações do Cloudflare R2 (Armazenamento de Vídeos & Tráfego Ilimitado)
R2_PUBLIC_URL = os.environ.get("R2_PUBLIC_URL", "https://pub-bf1a3aa70cd049a8ad4774397028451d.r2.dev").rstrip("/")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "6052508b67a8dd4885659b38da757964")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "383371debf7542752f5dd4a9111eb2ad353167340d54ccd0e6e91d11dadd6396")
R2_ENDPOINT_URL = os.environ.get("R2_ENDPOINT_URL", "https://308c5270b5e6860cf56874dbf0809d38.r2.cloudflarestorage.com")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "momentos-videos")

_s3_client = None

def get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT_URL,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=Config(s3={"addressing_style": "virtual"}, signature_version="s3v4")
        )
    return _s3_client

def get_supabase_headers(content_type="application/json"):
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": content_type
    }

def upload_file_to_r2(file_path: str, storage_key: str, content_type: str = "video/mp4") -> str:
    """
    Faz upload de um arquivo para o Cloudflare R2 e retorna a URL pública CDN.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Arquivo não encontrado: {file_path}")

    s3 = get_s3_client()
    with open(file_path, "rb") as f:
        s3.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=storage_key,
            Body=f,
            ContentType=content_type
        )

    public_url = f"{R2_PUBLIC_URL}/{storage_key}"
    return public_url

def generate_optimized_preview(input_path: str, output_path: str) -> bool:
    """
    Gera uma versão leve de streaming (720p H.264 CRF 28 + FastStart) para o player mobile.
    Reduz o tamanho em até 85% e permite carregamento instantâneo.
    """
    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-vf", "scale=-2:720",
            "-c:v", "libx264",
            "-crf", "28",
            "-preset", "faster",
            "-movflags", "+faststart",
            output_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        return res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except Exception as e:
        logger.warning(f"Aviso ao gerar preview otimizado com FFmpeg: {e}")
        return False

def save_lance_record(filename: str, video_url: str, thumb_url: str, preview_url: str, camera_name: str, size_bytes: int, created_at_ts: float):
    """
    Salva ou atualiza o registro do lance na tabela 'lances' do Supabase.
    """
    dt_iso = datetime.datetime.fromtimestamp(created_at_ts, tz=datetime.timezone.utc).isoformat()
    record = {
        "filename": filename,
        "video_url": video_url,
        "thumb_url": thumb_url,
        "camera_name": camera_name,
        "size_bytes": size_bytes,
        "created_at": dt_iso
    }
    if preview_url:
        record["preview_url"] = preview_url

    url = f"{SUPABASE_URL}/rest/v1/lances?on_conflict=filename"
    headers = get_supabase_headers()
    headers["Prefer"] = "resolution=merge-duplicates"

    data = json.dumps(record).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status in (200, 201):
                return True
    except Exception as e:
        # Se a coluna preview_url não existir ainda no Supabase, salva sem ela
        if "preview_url" in record:
            del record["preview_url"]
            data = json.dumps(record).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req) as resp:
                if resp.status in (200, 201):
                    return True
        raise e

def upload_clip_worker(file_path: str, camera_name: str = "Câmera Principal"):
    """
    Worker executado em segundo plano:
    1. Envia o vídeo ORIGINAL (Full HD) para Download e WhatsApp.
    2. Gera e envia o PREVIEW otimizado leve para o Player Mobile.
    3. Gera e envia a MINIATURA rápida.
    4. Atualiza o banco de dados Supabase.
    """
    preview_path = None
    try:
        filename = os.path.basename(file_path)
        logger.info(f"Iniciando sincronização inteligente para: {filename}...")
        
        stat = os.stat(file_path)
        size_bytes = stat.st_size
        created_at = stat.st_mtime

        # 1. Upload do vídeo ORIGINAL (Full HD) para Cloudflare R2
        video_url = upload_file_to_r2(file_path, filename, content_type="video/mp4")
        logger.info(f"Vídeo original {filename} enviado com sucesso para o R2!")

        # 2. Gera e envia a versão PREVIEW otimizada (leve para o player)
        previews_dir = os.path.join(os.path.dirname(file_path), ".previews")
        os.makedirs(previews_dir, exist_ok=True)
        preview_path = os.path.join(previews_dir, f"prev_{filename}")
        
        preview_url = None
        if generate_optimized_preview(file_path, preview_path):
            try:
                preview_url = upload_file_to_r2(preview_path, f"previews/{filename}", content_type="video/mp4")
                logger.info(f"Preview leve {filename} enviado com sucesso!")
            except Exception as e:
                logger.warning(f"Aviso ao enviar preview para R2: {e}")
        else:
            preview_url = video_url

        # 3. Gera e envia a miniatura JPEG
        thumbs_dir = os.path.join(os.path.dirname(file_path), ".thumbs")
        thumb_path = os.path.join(thumbs_dir, f"{filename}.jpg")
        thumb_url = None

        if os.path.exists(thumb_path):
            try:
                thumb_url = upload_file_to_r2(thumb_path, f"thumbs/{filename}.jpg", content_type="image/jpeg")
            except Exception as e:
                logger.warning(f"Aviso ao enviar miniatura para R2: {e}")

        # 4. Salva no banco de dados Supabase com os links
        save_lance_record(
            filename=filename,
            video_url=video_url,
            thumb_url=thumb_url,
            preview_url=preview_url,
            camera_name=camera_name,
            size_bytes=size_bytes,
            created_at_ts=created_at
        )
        logger.info(f"Lance {filename} registrado com sucesso (Original + Preview Otimizado)!")

    except Exception as e:
        logger.error(f"Erro ao sincronizar clipe {file_path}: {e}")
    finally:
        if preview_path and os.path.exists(preview_path):
            try:
                os.remove(preview_path)
            except Exception:
                pass

def upload_clip_async(file_path: str, camera_name: str = "Câmera Principal"):
    """
    Dispara o upload em segundo plano sem bloquear a gravação da quadra.
    """
    t = threading.Thread(target=upload_clip_worker, args=(file_path, camera_name), daemon=True)
    t.start()
