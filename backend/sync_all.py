import os
import sys
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
import cloud_sync

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def sync_all():
    clips_dir = os.path.join(os.path.dirname(__file__), "cortes")
    all_files = [f for f in os.listdir(clips_dir) if f.endswith(".mp4") and not f.startswith("temp_")]
    all_files.sort(key=lambda f: os.path.getmtime(os.path.join(clips_dir, f)), reverse=True)

    logging.info(f"Iniciando sincronização de {len(all_files)} vídeos para o Cloudflare R2...")

    def process_file(f):
        path = os.path.join(clips_dir, f)
        cam = "Câmera 2" if "cam_1787010398" in f or "cam_1787619412" in f else "Câmera Principal"
        try:
            cloud_sync.upload_clip_worker(path, camera_name=cam)
            return True, f
        except Exception as err:
            return False, f"{f}: {err}"

    success_count = 0
    # Upload paralelo com 4 threads para máxima velocidade
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(process_file, f): f for f in all_files}
        for future in as_completed(futures):
            ok, name = future.result()
            if ok:
                success_count += 1
                logging.info(f"[{success_count}/{len(all_files)}] Sincronizado com sucesso: {name}")
            else:
                logging.error(f"Falha ao sincronizar: {name}")

    logging.info(f"Sincronização com Cloudflare R2 concluída! {success_count}/{len(all_files)} vídeos ativos.")

if __name__ == "__main__":
    sync_all()
