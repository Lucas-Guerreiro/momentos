@echo off
chcp 65001 >nul
title Momentos - Servidor de Recorte de Vídeos
color 0A

echo =======================================================================
echo                 MOMENTOS - RECORTE DE VÍDEOS ESPORTIVOS
echo =======================================================================
echo.

:: Garante que o diretório de trabalho é o local do script
cd /d "%~dp0"

:: 1. Verifica se o Python está instalado no sistema
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Python não foi encontrado no PATH do sistema.
    echo.
    echo Por favor, instale o Python (3.10 ou superior) em https://www.python.org/
    echo Certifique-se de marcar a opcao "Add Python to PATH" durante a instalacao.
    echo.
    pause
    exit /b 1
)

:: 2. Entra na pasta do backend
cd backend

:: 3. Verifica ou cria o ambiente virtual (venv)
if not exist "venv\Scripts\python.exe" (
    echo [1/3] Criando ambiente virtual Python (venv)...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao criar o ambiente virtual venv.
        pause
        exit /b 1
    )

    echo [2/3] Instalando dependencias (FastAPI, OpenCV, Uvicorn)...
    echo Isso pode levar alguns instantes na primeira inicializacao...
    venv\Scripts\pip install --upgrade pip >nul 2>&1
    venv\Scripts\pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar as dependencias. Verifique sua conexao com a internet.
        pause
        exit /b 1
    )
) else (
    echo [1/2] Ambiente virtual (venv) verificado com sucesso.
)

:: 4. Gera vídeo de teste se necessário
if not exist "video_teste.mp4" (
    if exist "generate_test_video.py" (
        echo [2/3] Gerando video de demonstracao para testes...
        venv\Scripts\python generate_test_video.py >nul 2>&1
    )
)

echo.
echo =======================================================================
echo [SUCESSO] Servidor iniciando na porta 8000!
echo Endereço local: http://localhost:8000
echo.
echo Abrindo o navegador automaticamente...
echo Pressione CTRL+C para encerrar o servidor a qualquer momento.
echo =======================================================================
echo.

:: Abre o navegador padrão diretamente no sistema
start "" "http://localhost:8000"

:: Inicia o servidor FastAPI com Uvicorn
venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000

if %errorlevel% neq 0 (
    echo.
    echo [AVISO] O servidor foi encerrado.
    pause
)
