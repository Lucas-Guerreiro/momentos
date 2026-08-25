import os
import json
import time
import cv2
import threading
import logging
import queue
from collections import deque

# Configuração simples de logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class CameraCapture:
    def __init__(self, camera_id, source, name="Camera", buffer_seconds=10, fps_override=None):
        self.camera_id = camera_id
        self.name = name
        self.buffer_seconds = buffer_seconds
        
        # Tenta converter source para int caso seja um índice de câmera USB local (ex: "0" -> 0)
        try:
            self.source = int(source)
        except ValueError:
            self.source = source
            
        self.cap = None
        self.is_running = False
        self.thread = None
        self.fps = fps_override or 30
        self.width = 640
        self.height = 480
        
        # Buffer circular para armazenar os frames na memória (tupla: (timestamp, frame))
        self.buffer = deque()
        self.buffer_lock = threading.Lock()
        
        # Para streaming (MJPEG) com cache e detecção de demanda
        self.last_preview_jpeg = None
        self.last_preview_lock = threading.Lock()
        self.last_preview_request_time = 0.0
        
        # Gerenciamento da gravação ativa de recortes (clipes) assíncrona
        self.write_queue = None
        self.writer_thread = None
        self.recording_active = False
        self.recording_frames_needed = 0
        self.recording_frames_written = 0
        self.recording_lock = threading.Lock()
        
        # Callback opcional quando um vídeo termina de ser gravado
        self.on_recording_finished = None

    def start(self):
        if self.is_running:
            return
        self.is_running = True
        self.thread = threading.Thread(target=self._capture_loop, name=f"CapThread-{self.camera_id}", daemon=True)
        self.thread.start()

    def stop(self):
        self.is_running = False
        if self.thread:
            self.thread.join(timeout=2)
            self.thread = None
        
        with self.recording_lock:
            self.recording_active = False
            if self.write_queue is not None:
                self.write_queue.put(None)
                
        if self.cap:
            self.cap.release()
            self.cap = None
            
        logging.info(f"Câmera [{self.name}] parada.")

    def _open_video_capture(self, resolved_source):
        """
        Tenta abrir a câmera de forma robusta e persistente.
        Para economizar banda USB e suportar múltiplas câmeras simultâneas,
        tenta forçar o codec MJPG e resolução de 1280x720 (HD).
        Possui fallback total caso a câmera não suporte estas propriedades.
        """
        cap = None
        import sys
        is_win = sys.platform.startswith("win")
        native_backend = cv2.CAP_DSHOW if is_win else cv2.CAP_V4L2
        backend_name = "DSHOW" if is_win else "V4L2"

        if isinstance(resolved_source, int):
            # 1. Tenta backend nativo (DSHOW no Win, V4L2 no Linux) com MJPG em 1280x720
            logging.info(f"Câmera [{self.name}]: Tentando inicializar via {backend_name} (MJPG 1280x720)...")
            try:
                cap = cv2.VideoCapture(resolved_source, native_backend)
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M', 'J', 'P', 'G'))
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                    ret, _ = cap.read()
                    if ret:
                        logging.info(f"Câmera [{self.name}]: Conectada via {backend_name} (MJPG 1280x720).")
                        return cap
                    cap.release()
            except Exception:
                pass
            
            # 2. Tenta backend padrão com MJPG em 1280x720
            logging.info(f"Câmera [{self.name}]: Tentando via backend padrão (MJPG 1280x720)...")
            try:
                cap = cv2.VideoCapture(resolved_source)
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M', 'J', 'P', 'G'))
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                    ret, _ = cap.read()
                    if ret:
                        logging.info(f"Câmera [{self.name}]: Conectada via backend padrão (MJPG 1280x720).")
                        return cap
                    cap.release()
            except Exception:
                pass

            # 3. Fallback total: Abre com configurações de fábrica (Backend nativo)
            logging.warning(f"Câmera [{self.name}]: Falha ao forçar MJPG 720p. Tentando configurações padrão ({backend_name})...")
            try:
                cap = cv2.VideoCapture(resolved_source, native_backend)
                if cap.isOpened():
                    ret, _ = cap.read()
                    if ret:
                        logging.info(f"Câmera [{self.name}]: Conectada via {backend_name} com configurações padrão.")
                        return cap
                    cap.release()
            except Exception:
                pass

            # 4. Fallback total: Abre com configurações de fábrica (Backend padrão)
            logging.warning(f"Câmera [{self.name}]: Tentando configurações padrão (Backend padrão)...")
            try:
                cap = cv2.VideoCapture(resolved_source)
                if cap.isOpened():
                    ret, _ = cap.read()
                    if ret:
                        logging.info(f"Câmera [{self.name}]: Conectada via backend padrão com configurações padrão.")
                        return cap
                    cap.release()
            except Exception:
                pass
                
            return None
        else:
            logging.info(f"Câmera [{self.name}]: Conectando à fonte de vídeo: {resolved_source}...")
            cap = cv2.VideoCapture(resolved_source)
            if cap.isOpened():
                return cap
                
        return None

    def _capture_loop(self):
        # Resolve caminhos relativos para arquivos de vídeo locais de simulação
        resolved_source = self.source
        if isinstance(self.source, str) and not self.source.startswith("rtsp://") and not self.source.startswith("rtmp://") and not self.source.startswith("http://") and not self.source.startswith("https://"):
            import os
            # Se o caminho bruto não existir, tenta resolver relativo ao script backend/ e ao workspace raiz
            if not os.path.exists(resolved_source):
                # 1. tenta relativo à pasta do script python
                opt1 = os.path.abspath(os.path.join(os.path.dirname(__file__), resolved_source))
                # 2. tenta relativo à pasta do script se já estivermos nela (apenas o nome do arquivo)
                opt2 = os.path.abspath(os.path.join(os.path.dirname(__file__), os.path.basename(resolved_source)))
                
                if os.path.exists(opt1):
                    resolved_source = opt1
                elif os.path.exists(opt2):
                    resolved_source = opt2
                else:
                    # tenta no nível superior se aplicável
                    opt3 = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(__file__)), resolved_source))
                    if os.path.exists(opt3):
                        resolved_source = opt3

        logging.info(f"Conectando à câmera [{self.name}]...")
        
        # Tenta abrir usando nosso método resiliente
        self.cap = self._open_video_capture(resolved_source)
            
        if not self.cap or not self.cap.isOpened():
            logging.error(f"Erro crítico: Não foi possível abrir a fonte {resolved_source} para a câmera [{self.name}]")
            self.is_running = False
            return

        # Busca dados reais do dispositivo
        actual_fps = self.cap.get(cv2.CAP_PROP_FPS)
        if actual_fps and 1.0 < actual_fps < 120.0:
            self.fps = actual_fps
            
        width = self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)
        height = self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if width > 0 and height > 0:
            self.width = int(width)
            self.height = int(height)

        max_buffer_size = int(self.fps * self.buffer_seconds)
        with self.buffer_lock:
            self.buffer = deque(maxlen=max_buffer_size)

        logging.info(f"Câmera [{self.name}] ativa: {self.width}x{self.height} @ {self.fps:.2f} FPS. Buffer max: {max_buffer_size} frames.")

        frame_delay = 1.0 / self.fps
        
        try:
            while self.is_running:
                start_time = time.time()
                ret, frame = self.cap.read()
                if not ret:
                    logging.warning(f"Câmera [{self.name}]: Falha ao ler frame. Tentando reconectar...")
                    time.sleep(2.0)
                    if self.cap:
                        self.cap.release()
                    if not self.is_running:
                        break
                    self.cap = self._open_video_capture(resolved_source)
                    continue

                timestamp = time.time()

                # Salva no buffer circular
                with self.buffer_lock:
                    self.buffer.append((timestamp, frame.copy()))

                # Pre-processa e compacta o frame se houver requisições de preview ativas nos últimos 5 segundos
                if timestamp - self.last_preview_request_time < 5.0:
                    h, w = frame.shape[:2]
                    max_width = 640  # Largura leve para preview
                    if w > max_width:
                        ratio = max_width / w
                        new_h = int(h * ratio)
                        preview_frame = cv2.resize(frame, (max_width, new_h), interpolation=cv2.INTER_LINEAR)
                    else:
                        preview_frame = frame
                    
                    ret_jpeg, jpeg = cv2.imencode('.jpg', preview_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                    if ret_jpeg:
                        with self.last_preview_lock:
                            self.last_preview_jpeg = jpeg.tobytes()

                # Envia frame para a fila de gravação se estiver gravando
                with self.recording_lock:
                    if self.recording_active and self.write_queue is not None:
                        if self.recording_frames_written < self.recording_frames_needed:
                            self.write_queue.put(frame.copy())
                            self.recording_frames_written += 1
                        else:
                            self.recording_active = False
                            self.write_queue.put(None)  # Sentinel para parar o gravador

                # Controla taxa de quadros apenas se a fonte for arquivo (para simular tempo real), 
                # streams e webcams já bloqueiam naturalmente no frame rate do hardware
                elapsed = time.time() - start_time
                sleep_time = frame_delay - elapsed
                if sleep_time > 0 and isinstance(self.source, str) and not self.source.startswith("rtsp://") and not self.source.startswith("rtmp://"):
                    time.sleep(sleep_time)
        finally:
            if self.cap:
                self.cap.release()
                self.cap = None
            logging.info(f"Thread da câmera [{self.name}] finalizada e recursos liberados.")

    def update_buffer_size(self, new_seconds):
        if new_seconds <= self.buffer_seconds:
            return
        with self.buffer_lock:
            old_buffer = list(self.buffer)
            self.buffer_seconds = new_seconds
            new_max_size = int(self.fps * new_seconds)
            self.buffer = deque(old_buffer, maxlen=new_max_size)
            logging.info(f"Câmera [{self.name}]: Buffer aumentado dinamicamente para {new_seconds}s ({new_max_size} frames).")

    def _write_worker(self, output_path, frames_snapshot, fps_to_use, callback):
        logging.info(f"Iniciando gravação de vídeo assíncrona para [{self.name}] a {fps_to_use:.2f} FPS...")
        if not frames_snapshot:
            logging.error(f"Nenhum frame inicial para gravar na câmera [{self.name}].")
            if callback:
                callback()
            return

        h, w = frames_snapshot[0].shape[:2]
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        import shutil
        import subprocess

        ffmpeg_bin = shutil.which("ffmpeg")
        if not ffmpeg_bin:
            try:
                import imageio_ffmpeg
                ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
            except Exception:
                ffmpeg_bin = None

        writer = None
        use_ffmpeg = False

        if ffmpeg_bin:
            try:
                cmd = [
                    ffmpeg_bin,
                    "-y",
                    "-f", "rawvideo",
                    "-vcodec", "rawvideo",
                    "-s", f"{w}x{h}",
                    "-pix_fmt", "bgr24",
                    "-r", str(fps_to_use),
                    "-i", "-",
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-tune", "zerolatency",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    output_path
                ]
                writer = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
                use_ffmpeg = True
                logging.info(f"Gravador de vídeo nativo H.264 (FFmpeg) iniciado: {output_path}")
            except Exception as e:
                logging.warning(f"Falha ao iniciar FFmpeg Popen: {e}. Usando fallback OpenCV...")

        if not use_ffmpeg:
            codecs_to_try = ['avc1', 'mp4v', 'MJPG']
            for codec in codecs_to_try:
                fourcc = cv2.VideoWriter_fourcc(*codec)
                writer = cv2.VideoWriter(output_path, fourcc, fps_to_use, (w, h))
                if writer.isOpened():
                    logging.info(f"VideoWriter aberto via OpenCV com o codec [{codec}] em {w}x{h}!")
                    break
                else:
                    writer.release()
                    writer = None

        if writer is None:
            logging.error(f"Erro crítico: Não foi possível instanciar VideoWriter para a câmera [{self.name}].")
            if callback:
                callback()
            return

        try:
            # 1. Escreve os frames antigos (passado)
            for frame in frames_snapshot:
                if use_ffmpeg:
                    writer.stdin.write(frame.tobytes())
                else:
                    writer.write(frame)

            # 2. Escreve os novos frames (futuro) conforme chegam na fila
            while True:
                frame = self.write_queue.get()
                if frame is None:  # Sinalizador de término da gravação
                    break
                if use_ffmpeg:
                    writer.stdin.write(frame.tobytes())
                else:
                    writer.write(frame)
                self.write_queue.task_done()
        except Exception as e:
            logging.error(f"Erro ao gravar frames no arquivo [{output_path}]: {e}")
        finally:
            if use_ffmpeg:
                try:
                    writer.stdin.close()
                    writer.wait(timeout=10)
                except Exception as e:
                    logging.error(f"Erro ao finalizar processo FFmpeg: {e}")
            else:
                writer.release()
            logging.info(f"Gravação concluída para a câmera [{self.name}]: {output_path}")
            if callback:
                try:
                    callback()
                except Exception as e:
                    logging.error(f"Erro no callback de gravação finalizada: {e}")

    def trigger_clip(self, seconds_before, seconds_after, output_path, callback=None):
        """
        Gera um clipe de vídeo baseado nos frames já guardados no buffer (segundos passados)
        e continua a gravar os frames que entrarem nos próximos segundos (segundos futuros).
        """
        # Aumenta dinamicamente o tamanho do buffer circular na memória se o corte solicitado for maior que o configurado
        if seconds_before > self.buffer_seconds:
            self.update_buffer_size(seconds_before + 5)

        with self.recording_lock:
            if self.recording_active:
                logging.warning(f"Gravação já ativa na câmera [{self.name}]. Ignorando trigger.")
                return False

            with self.buffer_lock:
                buffer_snapshot = list(self.buffer)

            if not buffer_snapshot:
                logging.error(f"Erro: Buffer da câmera [{self.name}] está vazio. Não foi possível gerar recorte.")
                return False

            # Filtra os frames que correspondem aos segundos antes do disparo
            now = time.time()
            start_time_limit = now - seconds_before
            
            # Recupera os frames e seus respectivos timestamps
            frames_to_write_tuples = [(ts, frame) for ts, frame in buffer_snapshot if ts >= start_time_limit]

            # Caso não haja frames suficientes baseados no tempo real (por lag de início), pega os N mais recentes do buffer
            if not frames_to_write_tuples:
                num_frames_needed = int(seconds_before * self.fps)
                frames_to_write_tuples = list(buffer_snapshot)[-num_frames_needed:]

            frames_to_write = [frame for ts, frame in frames_to_write_tuples]

            # Medição do FPS real baseado na distância temporal dos frames capturados
            measured_fps = self.fps
            if len(frames_to_write_tuples) > 1:
                duration = frames_to_write_tuples[-1][0] - frames_to_write_tuples[0][0]
                if duration > 0:
                    measured_fps = len(frames_to_write_tuples) / duration
                    # Garante limites razoáveis de FPS
                    if not (1.0 <= measured_fps <= 120.0):
                        measured_fps = self.fps
                    else:
                        # Arredonda o FPS real medido para melhor compatibilidade com reprodutores de vídeo
                        measured_fps = round(measured_fps, 2)

            # Inicializa a fila e os parâmetros de controle
            self.write_queue = queue.Queue()
            self.recording_frames_needed = int(seconds_after * measured_fps)
            self.recording_frames_written = 0
            self.recording_active = True

            # Dispara a thread secundária para gravar em disco de forma assíncrona
            self.writer_thread = threading.Thread(
                target=self._write_worker,
                args=(output_path, frames_to_write, measured_fps, callback),
                name=f"WriteThread-{self.camera_id}",
                daemon=True
            )
            self.writer_thread.start()

            logging.info(f"Recorte disparado assincronamente na câmera [{self.name}] a {measured_fps} FPS reais. Gravando em background...")
            return True

    def get_preview_frame(self):
        """
        Retorna o frame atual pré-codificado em JPEG de forma ultrarrápida.
        Atualiza o timestamp de última requisição para manter o cache ativo no loop de captura.
        """
        self.last_preview_request_time = time.time()
        with self.last_preview_lock:
            return self.last_preview_jpeg


class CameraManager:
    def __init__(self, config_path="backend/config.json", clips_dir="backend/cortes"):
        self.config_path = config_path
        self.clips_dir = clips_dir
        self.cameras = {} # id -> CameraCapture
        self.configs = [] # lista de dicts com as configs brutas
        self.load_config()

    def load_config(self):
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    self.configs = json.load(f)
            except Exception as e:
                logging.error(f"Erro ao carregar arquivo de configuração: {e}")
                self.configs = []
        else:
            self.configs = []
            self.save_config()

    def save_config(self):
        try:
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(self.configs, f, indent=4, ensure_ascii=False)
        except Exception as e:
            logging.error(f"Erro ao salvar arquivo de configuração: {e}")

    def start_all(self):
        for cam_config in self.configs:
            cam_id = cam_config["id"]
            if cam_id not in self.cameras:
                cam = CameraCapture(
                    camera_id=cam_id,
                    source=cam_config["source"],
                    name=cam_config["name"],
                    buffer_seconds=cam_config.get("buffer_seconds", 10),
                    fps_override=cam_config.get("fps", 30)
                )
                self.cameras[cam_id] = cam
                cam.start()

    def stop_all(self):
        for cam in self.cameras.values():
            cam.stop()
        self.cameras.clear()

    def add_camera(self, name, source, buffer_seconds=10, fps=30):
        cam_id = f"cam_{int(time.time())}"
        config = {
            "id": cam_id,
            "name": name,
            "source": source,
            "buffer_seconds": buffer_seconds,
            "fps": fps
        }
        self.configs.append(config)
        self.save_config()
        
        # Inicia a câmera
        cam = CameraCapture(
            camera_id=cam_id,
            source=source,
            name=name,
            buffer_seconds=buffer_seconds,
            fps_override=fps
        )
        self.cameras[cam_id] = cam
        cam.start()
        return config

    def remove_camera(self, cam_id):
        if cam_id in self.cameras:
            self.cameras[cam_id].stop()
            del self.cameras[cam_id]
            
        self.configs = [c for c in self.configs if c["id"] != cam_id]
        self.save_config()
        return True

    def update_camera(self, cam_id, name, source, buffer_seconds=10, fps=30):
        config_index = -1
        for i, c in enumerate(self.configs):
            if c["id"] == cam_id:
                config_index = i
                break
                
        if config_index == -1:
            logging.error(f"Erro ao editar: Câmera {cam_id} não encontrada.")
            return None

        # Para a captura atual
        if cam_id in self.cameras:
            self.cameras[cam_id].stop()
            del self.cameras[cam_id]

        # Atualiza os dados no config
        self.configs[config_index]["name"] = name
        self.configs[config_index]["source"] = source
        self.configs[config_index]["buffer_seconds"] = buffer_seconds
        self.configs[config_index]["fps"] = fps
        self.save_config()

        # Cria e inicia a nova instância de captura com as configurações atualizadas
        cam = CameraCapture(
            camera_id=cam_id,
            source=source,
            name=name,
            buffer_seconds=buffer_seconds,
            fps_override=fps
        )
        self.cameras[cam_id] = cam
        cam.start()
        
        return self.configs[config_index]

    def get_camera_status(self):
        status_list = []
        for c in self.configs:
            cam_id = c["id"]
            active = cam_id in self.cameras and self.cameras[cam_id].is_running
            status_list.append({
                **c,
                "active": active,
                "fps_real": self.cameras[cam_id].fps if active else 0,
                "resolution": f"{self.cameras[cam_id].width}x{self.cameras[cam_id].height}" if active else "0x0"
            })
        return status_list

    def trigger_camera_clip(self, cam_id, seconds_before, seconds_after, clip_name_prefix="recorte"):
        if cam_id not in self.cameras:
            logging.error(f"Erro: Câmera {cam_id} não está ativa ou não existe.")
            return None

        cam = self.cameras[cam_id]
        clip_filename = f"{clip_name_prefix}_{cam_id}_{int(time.time())}.mp4"
        output_path = os.path.join(self.clips_dir, clip_filename)
        
        # Adiciona um callback para registrar que o clipe foi gravado com sucesso
        def on_finished():
            logging.info(f"O arquivo {clip_filename} foi salvo na pasta {self.clips_dir}")

        success = cam.trigger_clip(
            seconds_before=seconds_before,
            seconds_after=seconds_after,
            output_path=output_path,
            callback=on_finished
        )
        
        if success:
            return clip_filename
        return None
