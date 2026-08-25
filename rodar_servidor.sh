#!/usr/bin/env bash

# Muda para o diretório raiz do projeto
cd "$(dirname "$0")"

echo "======================================================================="
echo "                MOMENTOS - RECORTE DE VÍDEOS ESPORTIVOS                "
echo "======================================================================="
echo ""

# 1. Verifica se python3 está instalado
if ! command -v python3 &> /dev/null; then
    echo "[ERRO] Python 3 não foi encontrado no sistema."
    echo "Instale usando: sudo apt update && sudo apt install -y python3 python3-venv python3-pip"
    exit 1
fi

# 2. Entra no backend
cd backend || exit 1

# 3. Verifica ou recria o ambiente virtual (venv) para Linux
if [ -d "venv" ] && [ ! -f "venv/bin/python" ]; then
    echo "[AVISO] Pasta venv incompatível com Linux detectada. Recriando venv limpo..."
    rm -rf venv
fi

if [ ! -f "venv/bin/python" ] || [ ! -f "venv/bin/pip" ]; then
    echo "[1/3] Criando ambiente virtual Python (venv) no Linux..."
    rm -rf venv
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo ""
        echo "======================================================================="
        echo "[ERRO] O pacote 'python3-venv' precisa ser instalado no seu Linux."
        echo ""
        echo "Para resolver, abra o terminal e execute o comando abaixo:"
        echo "   sudo apt update && sudo apt install -y python3-venv python3-pip"
        echo ""
        echo "Depois disso, execute ./iniciar_servidor.sh novamente."
        echo "======================================================================="
        exit 1
    fi
fi

# 4. Verifica e instala dependências do requirements.txt
./venv/bin/pip install -r requirements.txt > /dev/null 2>&1

# 5. Verifica se o pacote de sistema ffmpeg está instalado
if ! command -v ffmpeg &> /dev/null; then
    echo "[DICA] Para máxima velocidade e compatibilidade de vídeo com todos os celulares/navegadores:"
    echo "       Recomendamos rodar no terminal: sudo apt install -y ffmpeg"
    echo ""
fi

# 6. Gera vídeo de simulação caso não exista
if [ ! -f "video_teste.mp4" ] && [ -f "generate_test_video.py" ]; then
    echo "[2/3] Gerando vídeo de demonstração para testes..."
    ./venv/bin/python generate_test_video.py > /dev/null 2>&1
fi

echo ""
echo "======================================================================="
echo "[SUCESSO] Servidor pronto!"
echo "Acesse no navegador: http://localhost:8000"
echo "Pressione CTRL+C para encerrar o servidor a qualquer momento."
echo "======================================================================="
echo ""

# Tenta abrir o navegador automaticamente se xdg-open estiver disponível
if command -v xdg-open &> /dev/null; then
    (sleep 1 && xdg-open "http://localhost:8000" &> /dev/null) &
fi

# Executa o servidor FastAPI com Uvicorn (com reload automático de alterações)
./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
