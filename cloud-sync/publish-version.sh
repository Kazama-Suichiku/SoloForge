#!/bin/bash
# 发布新版本的脚本
# 用法: ./publish-version.sh <版本号> <版本代码> <下载链接> [更新说明]
#
# 示例:
# ./publish-version.sh 2.2.0 220 "https://github.com/yourrepo/releases/download/v2.2.0/app-release.apk" "修复若干问题"

SERVER_URL="https://soloforge-sync.fengzhongcuizhu.workers.dev"

# P0-1 修复：不再硬编码 SECRET。读取顺序：环境变量 SYNC_SECRET → 本地 .dev.vars 文件。
# 任一来源都没有则报错退出，避免误用空密钥或默认密钥发布。
SECRET="${SYNC_SECRET:-}"
DEV_VARS_PATH="${DEV_VARS_PATH:-$(dirname "$0")/.dev.vars}"

if [ -z "$SECRET" ] && [ -f "$DEV_VARS_PATH" ]; then
  # 仅取 SYNC_SECRET=... 行，剥离引号
  SECRET=$(grep -E '^SYNC_SECRET=' "$DEV_VARS_PATH" | head -n1 | sed -E 's/^SYNC_SECRET=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
fi

if [ -z "$SECRET" ]; then
  echo "❌ 未找到 SYNC_SECRET。" >&2
  echo "   请通过环境变量提供：export SYNC_SECRET='your-secret'" >&2
  echo "   或在 $DEV_VARS_PATH 写入：SYNC_SECRET=\"your-secret\"" >&2
  echo "   生产密钥用 wrangler secret put SYNC_SECRET 设置于 Worker 侧。" >&2
  exit 1
fi

VERSION="$1"
VERSION_CODE="$2"
DOWNLOAD_URL="$3"
RELEASE_NOTES="${4:-新版本发布}"
APK_SIZE="${5:-67000000}"

if [ -z "$VERSION" ] || [ -z "$VERSION_CODE" ] || [ -z "$DOWNLOAD_URL" ]; then
    echo "用法: $0 <版本号> <版本代码> <下载链接> [更新说明] [APK大小]"
    echo ""
    echo "示例:"
    echo "  $0 2.2.0 220 'https://example.com/app.apk' '新增功能'"
    echo ""
    echo "参数说明:"
    echo "  版本号     - 如 2.1.0, 2.2.0"
    echo "  版本代码   - 整数，每次发布递增，如 210, 220"
    echo "  下载链接   - APK 文件的直接下载链接"
    echo "  更新说明   - 可选，本次更新内容"
    echo "  APK大小    - 可选，文件大小（字节）"
    exit 1
fi

echo "📦 发布新版本..."
echo "   版本: v${VERSION} (${VERSION_CODE})"
echo "   链接: ${DOWNLOAD_URL}"
echo "   说明: ${RELEASE_NOTES}"
echo ""

RESPONSE=$(curl -s -X POST \
    "${SERVER_URL}/app/publish" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Secret: ${SECRET}" \
    -d "{
        \"version\": \"${VERSION}\",
        \"versionCode\": ${VERSION_CODE},
        \"releaseNotes\": \"${RELEASE_NOTES}\",
        \"downloadUrl\": \"${DOWNLOAD_URL}\",
        \"apkSize\": ${APK_SIZE}
    }")

echo "📋 服务器响应:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

if echo "$RESPONSE" | grep -q '"success":true'; then
    echo ""
    echo "✅ 版本发布成功!"
    echo "📱 用户可在应用内检查更新"
else
    echo ""
    echo "❌ 版本发布失败"
    exit 1
fi
