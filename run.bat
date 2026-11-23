@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM ============================================================
REM  Flori-Nav 本地启动脚本
REM  1) 找 Python(优先 .venv,其次 PATH,最后常见安装路径)
REM  2) 缺依赖就装 requirements.txt
REM  3) 迁移数据库 -> 启动开发服务器 -> 端口就绪后打开浏览器
REM ============================================================

cd /d "%~dp0"

set "HOST=127.0.0.1"
set "PORT=8010"
set "URL=http://%HOST%:%PORT%/"

REM ---------- 1. 解释器 ----------
set "PY="
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
if not defined PY (
    where python >nul 2>nul && set "PY=python"
)
if not defined PY (
    if exist "D:\Program Files\python314\python.exe" set "PY=D:\Program Files\python314\python.exe"
)
if not defined PY (
    echo [错误] 没找到 Python。请安装 Python 3.12+ 并勾选 "Add to PATH",
    echo        或在项目根目录建虚拟环境: python -m venv .venv
    echo.
    pause
    exit /b 1
)
echo [1/4] 解释器: %PY%

REM ---------- 2. 依赖 ----------
"%PY%" -c "import django" >nul 2>nul
if errorlevel 1 (
    echo [2/4] 缺少依赖,正在安装 requirements.txt ...
    "%PY%" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [错误] 依赖安装失败,请检查网络或 pip 源。
        pause
        exit /b 1
    )
) else (
    echo [2/4] 依赖已就绪
)

REM ---------- 3. 数据库 ----------
echo [3/4] 应用数据库迁移 ...
"%PY%" manage.py migrate --noinput
if errorlevel 1 (
    echo [错误] 迁移失败。若设了 DATABASE_URL,请确认数据库可连通。
    pause
    exit /b 1
)
"%PY%" manage.py check
if errorlevel 1 (
    echo [错误] Django 自检未通过,请看上面的输出。
    pause
    exit /b 1
)

REM ---------- 4. 起服务 ----------
echo [4/4] 启动开发服务器 %URL%
REM 单独开一个窗口跑服务:关掉本窗口不会带走服务器
start "Flori-Nav" "%PY%" manage.py runserver %HOST%:%PORT%

set /a COUNT=0
:WAIT
REM 用 ping 当 sleep:timeout 在输入被重定向时会直接报错退出
ping -n 2 127.0.0.1 >nul
set /a COUNT+=1
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if not errorlevel 1 goto :OPEN
if %COUNT% lss 15 goto :WAIT

echo [提示] 15 秒内没检测到端口 %PORT%,仍尝试打开浏览器。
:OPEN
start "" "%URL%"

echo.
echo 服务器已启动: %URL%
echo 服务在单独的 "Flori-Nav" 窗口里,关掉本窗口不影响它。
echo 停止服务: 关掉那个窗口,或执行
echo     taskkill /FI "WINDOWTITLE eq Flori-Nav*" /T /F
echo.
endlocal
exit /b 0
