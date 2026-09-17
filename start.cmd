@echo off
rem Hexbound 一键启动（双击或命令行均可）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
