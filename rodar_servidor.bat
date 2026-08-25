@echo off
chcp 65001 >nul
title Servidor Momentos - Recortes de Videos
color 0A

echo =======================================================
echo           INICIANDO SERVIDOR DO MOMENTOS
echo =======================================================
echo.

cd /d "%~dp0"

:: 1. Verifica se o Python esta instalado
where python >nul 2>&1
if %errorlevel% neq 0 goto ERROR_NO_PYTHON

:: 2. Entra no backend
cd backend
if not exist venv goto CREATE_VENV

:: 3. Se venv existe, valida se e valido e funcional para esta maquina
if not exist venv\Scripts\python.exe goto RECREATE_VENV
venv\Scripts\python.exe --version >nul 2>&1
if %errorlevel% neq 0 goto RECREATE_VENV
goto RUN_SERVER

:RECREATE_VENV
echo [AVISO] Pasta venv invalida ou incompativel. Recriando...
rd /s /q venv

:CREATE_VENV
echo [1/3] Criando ambiente virtual Python (venv) local...
python -m venv venv
if %errorlevel% neq 0 goto ERROR_VENV

echo [2/3] Instalando dependencias do projeto (FastAPI, OpenCV)...
echo Isso pode levar de 1 a 2 minutos na primeira vez...
venv\Scripts\pip install -r requirements.txt
if %errorlevel% neq 0 goto ERROR_DEPS

:RUN_SERVER
if not exist video_teste.mp4 (
    echo [3/3] Gerando video de teste/simulacao...
    venv\Scripts\python generate_test_video.py
)

echo.
echo =======================================================
echo [SUCESSO] Servidor pronto para iniciar!
echo Link de acesso local: http://localhost:8000
echo Abrindo o navegador...
echo =======================================================
echo.

start "" "http://localhost:8000"
venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
if %errorlevel% neq 0 goto ERROR_RUN
goto END

:ERROR_NO_PYTHON
echo [ERRO] O Python nao foi encontrado instalado neste computador.
echo.
echo Para resolver isso:
echo 1. Baixe o instalador do Python em: https://www.python.org/downloads/
echo 2. Execute o instalador e MARQUE a opcao "Add Python.exe to PATH".
echo 3. Apos instalar, execute este arquivo novamente.
echo.
pause
exit /b

:ERROR_VENV
echo [ERRO] Falha ao criar o ambiente virtual venv.
pause
exit /b

:ERROR_DEPS
echo [ERRO] Falha ao instalar as dependencias com o pip.
echo Verifique sua conexao com a internet.
pause
exit /b

:ERROR_RUN
echo [ERRO] O servidor falhou ao iniciar ou foi encerrado com erro.
pause
exit /b

:END
echo Servidor encerrado.
pause
