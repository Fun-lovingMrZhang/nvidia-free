@echo off
chcp 65001 >nul
title NVIDIA Free Proxy

echo.
echo ╔══════════════════════════════════════════════╗
echo ║         NVIDIA Free Proxy 启动中...          ║
echo ╚══════════════════════════════════════════════╝
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 未检测到 Node.js，请先安装 Node.js 16+
    echo    下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查 node_modules
if not exist "node_modules" (
    echo 📦 首次运行，正在安装依赖...
    npm install
    echo.
)

:: 启动服务
echo 🚀 正在启动服务...
echo.
node server.js

pause
