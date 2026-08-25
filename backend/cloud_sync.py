import os
import logging
import threading
import datetime
import urllib.request
import urllib.parse
import json

logger = logging.getLogger("cloud_sync")

# Configurações do Supabase
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wdjyxbrlergrvfilulyv.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indkanl4YnJsZXJncnZmaWx1bHl2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY5MDgwMiwiZXhwIjoyMTAzMjY2ODAyfQ.gakenrouBrn9BijWcWwrALFU8WVYjosxaws64nbLUJM"
)
BUCKET_NAME = "videos"

def get_headers(content_type="application/json"):
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": content_type
    }

def upload_file_to_storage(file_path: str, storage_path: str, content_type: str = "video/mp4") -> str:
    """
    Faz upload de um arquivo para o Supabase Storage e retorna a URL pública.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Arquivo não encontrado: {file_path}")

    upload_url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET_NAME}/{storage_path}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": content_type,
        "x-upsert": "true"
    }

    with open(file_path, "rb") as f:
        file_bytes = f.read()

    req = urllib.request.Request(upload_url, data=file_bytes, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        if resp.status in (200, 201):
            public_url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/{storage_path}"
            return public_url
        raise Exception(f"Falha no upload do Supabase Storage: status {resp.status}")

def save_lance_record(filename: str, video_url: str, thumb_url: str, camera_name: str, size_bytes: int, created_at_ts: float):
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

    url = f"{SUPABASE_URL}/rest/v1/lances"
    headers = get_headers()
    headers["Prefer"] = "resolution=merge-duplicates"

    data = json.dumps(record).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        if resp.status in (200, 201):
            return True
        raise Exception(f"Falha ao salvar registro no Supabase: status {resp.status}")

def upload_clip_worker(file_path: str, camera_name: str = "Câmera Principal"):
    """
    Worker executado em segundo plano para fazer upload do vídeo e miniatura.
    """
    try:
        filename = os.path.basename(file_path)
        logger.info(f"Iniciando sincronização na nuvem (Supabase) para: {filename}...")
        
        stat = os.stat(file_path)
        size_bytes = stat.st_size
        created_at = stat.st_mtime

        # 1. Faz upload do vídeo MP4
        video_url = upload_file_to_storage(file_path, filename, content_type="video/mp4")
        logger.info(f"Vídeo {filename} enviado com sucesso para a nuvem!")

        # 2. Gera e faz upload da miniatura se disponível
        thumbs_dir = os.path.join(os.path.dirname(file_path), ".thumbs")
        thumb_path = os.path.join(thumbs_dir, f"{filename}.jpg")
        thumb_url = None

        if os.path.exists(thumb_path):
            try:
                thumb_url = upload_file_to_storage(thumb_path, f"thumbs/{filename}.jpg", content_type="image/jpeg")
            except Exception as e:
                logger.warning(f"Aviso ao enviar miniatura: {e}")

        # 3. Salva no banco de dados
        save_lance_record(
            filename=filename,
            video_url=video_url,
            thumb_url=thumb_url,
            camera_name=camera_name,
            size_bytes=size_bytes,
            created_at_ts=created_at
        )
        logger.info(f"Lance {filename} registrado no banco de dados com sucesso!")

    except Exception as e:
        logger.error(f"Erro ao sincronizar clipe {file_path} com o Supabase: {e}")

def upload_clip_async(file_path: str, camera_name: str = "Câmera Principal"):
    """
    Dispara o upload em segundo plano sem bloquear a gravação da quadra.
    """
    t = threading.Thread(target=upload_clip_worker, args=(file_path, camera_name), daemon=True)
    t.start()
