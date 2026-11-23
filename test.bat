@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM ============================================================
REM  Flori-Nav 本地测试脚本
REM  跑 nav app 的完整测试套件(不写真实库,测试库用完即删)
REM  用法: test.bat            全部用例
REM        test.bat tests_nav_sites.py   只跑某个文件
REM ============================================================

cd /d "%~dp0"

set "PY="
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
if not defined PY (
    where python >nul 2>nul && set "PY=python"
)
if not defined PY (
    if exist "D:\Program Files\python314\python.exe" set "PY=D:\Program Files\python314\python.exe"
)
if not defined PY (
    echo [错误] 没找到 Python。请安装 Python 3.12+ 并勾选 "Add to PATH"。
    pause
    exit /b 1
)

"%PY%" -c "import django" >nul 2>nul
if errorlevel 1 (
    echo [提示] 缺少依赖,先安装 requirements.txt ...
    "%PY%" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [错误] 依赖安装失败。
        pause
        exit /b 1
    )
)

set "TARGET=nav"
if not "%~1"=="" set "TARGET=nav.%~n1"

echo [测试] %PY% manage.py test %TARGET% -v 2
echo.
"%PY%" manage.py test %TARGET% -v 2
if errorlevel 1 (
    echo.
    echo [失败] 有用例没过,请看上面的 FAIL/ERROR 详情。
    pause
    exit /b 1
)

echo.
echo [通过] 全部用例通过。
endlocal
exit /b 0
