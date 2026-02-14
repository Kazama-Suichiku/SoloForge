# 应用图标占位符

请添加以下图标文件以用于打包：

| 平台 | 文件路径 | 规格 |
|------|----------|------|
| macOS | `build/icon.icns` | 多尺寸 .icns，建议含 16/32/64/128/256/512 |
| Windows | `build/icon.ico` | 多尺寸 .ico，建议含 16/32/48/256 |

若未提供，electron-builder 将使用默认图标。

生成建议：
- **macOS**: 从 1024x1024 PNG 生成 icns，可用 `iconutil` 或在线工具
- **Windows**: 从 256x256 PNG 生成 ico，可用 ImageMagick 或在线工具
