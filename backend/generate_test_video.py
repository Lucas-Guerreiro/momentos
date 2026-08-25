import cv2
import numpy as np
import os

def generate_video(output_path="backend/video_teste.mp4", duration_seconds=60, fps=30):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    width, height = 640, 480
    # Tenta usar avc1. Fallback para mp4v.
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
    
    if not writer.isOpened():
        print("Erro ao abrir VideoWriter para o vídeo de teste.")
        return False
        
    num_frames = duration_seconds * fps
    
    for frame_idx in range(num_frames):
        # Cria uma imagem de fundo gradiente azul/preto
        img = np.zeros((height, width, 3), dtype=np.uint8)
        for y in range(height):
            img[y, :, 0] = int(10 + (y / height) * 40) # Azul
            img[y, :, 1] = int(5 + (y / height) * 15)  # Verde escuro
            img[y, :, 2] = int(15 + (y / height) * 20) # Vermelho escuro
            
        # Calcula o tempo simulado
        time_elapsed = frame_idx / fps
        time_str = f"MOMENTOS TESTE: {time_elapsed:05.2f}s"
        frame_str = f"FRAME: {frame_idx}"
        
        # Desenha um círculo giratório na tela para simular movimento
        angle = (frame_idx * 5) % 360
        rad = np.deg2rad(angle)
        center_x = int(width / 2 + 150 * np.cos(rad))
        center_y = int(height / 2 + 100 * np.sin(rad))
        cv2.circle(img, (center_x, center_y), 20, (0, 242, 254), -1) # Círculo neon
        
        # Desenha o cronômetro no centro
        cv2.putText(img, time_str, (80, 240), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3, cv2.LINE_AA)
        cv2.putText(img, frame_str, (220, 290), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (156, 163, 175), 2, cv2.LINE_AA)
        
        # Desenha uma borda neon sutil
        cv2.rectangle(img, (10, 10), (width - 10, height - 10), (79, 172, 254), 2)
        
        writer.write(img)
        
    writer.release()
    print(f"Vídeo de simulação gerado com sucesso em: {output_path}")
    return True

if __name__ == "__main__":
    generate_video()
