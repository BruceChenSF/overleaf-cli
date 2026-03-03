@echo off
REM Overleaf CC - 一键修复和构建脚本
REM 自动安装依赖、构建所有组件、运行验证

REM 设置 UTF-8 编码
chcp 65001 >nul 2>&1

echo.
echo ========================================
echo Overleaf CC - 一键修复和构建
echo ========================================
echo.

set ERROR_OCCURRED=0

REM 函数：检查错误
if errorlevel 1 (
    set ERROR_OCCURRED=1
)

echo [1/5] 安装扩展依赖...
call npm install
if errorlevel 1 (
    echo   ✗ 失败
    set ERROR_OCCURRED=1
) else (
    echo   ✓ 完成
)

echo.
echo [2/5] 构建 Chrome 扩展...
call npm run build
if errorlevel 1 (
    echo   ✗ 失败
    set ERROR_OCCURRED=1
) else (
    echo   ✓ 完成
)

echo.
echo [3/5] 安装 Bridge 依赖...
cd packages\bridge
call npm install
if errorlevel 1 (
    echo   ✗ 失败
    set ERROR_OCCURRED=1
) else (
    echo   ✓ 完成
)
cd ..\

echo.
echo [4/5] 构建 Bridge CLI...
cd packages\bridge
call npm run build
if errorlevel 1 (
    echo   ✗ 失败
    set ERROR_OCCURRED=1
) else (
    echo   ✓ 完成
)
cd ..\

echo.
echo ========================================
echo 运行验证测试...
echo ========================================
echo.

call test-quick-verify.bat

echo.
echo ========================================
echo 修复完成！
echo ========================================
echo.

if %ERROR_OCCURRED%==0 (
    echo ✓ 所有步骤成功完成！
    echo.
    echo 下一步：
    echo 1. 启动 Bridge 服务器：
    echo    cd packages\bridge
    echo    node dist\cli.js
    echo.
    echo 2. 加载扩展到 Chrome：
    echo    打开 chrome://extensions/
    echo    启用"开发者模式"
    echo    点击"加载已解压的扩展程序"
    echo    选择 dist 目录
    echo.
    echo 3. 在 Overleaf 中点击 Terminal 按钮
) else (
    echo ⚠ 部分步骤失败，请检查上面的错误信息
    echo.
    echo 常见问题解决：
    echo 1. Node.js 未安装：从 https://nodejs.org/ 下载安装
    echo 2. 网络问题：尝试使用 npm 镜像
    echo 3. 权限问题：以管理员身份运行
)

echo.
pause
