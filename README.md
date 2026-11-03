# 刚好天气

一个为手机设计的简体中文天气 PWA。首页优先回答两件事：今天要不要带伞，以及怎么穿更舒服。

## 功能

- 优先请求浏览器精确定位，失败时自动回退到湖北恩施
- 支持搜索全球城市、区县与地区，并按所在地时区显示天气
- 当前天气、体感温度、湿度、风速、降雨概率、紫外线
- 未来 12 小时和未来 7 天天气
- AQI、PM2.5、PM10 和臭氧
- 综合体感、风、降雨、湿度、紫外线和昼夜温差生成穿衣建议
- 综合短时降水和未来降雨概率生成带伞提醒
- 根据天气和当地时间，为“小湘”显示自然、不重复堆砌的贴心小语
- PWA 安装、离线应用外壳和每 15 分钟自动更新
- GitHub Pages 自动部署

天气和空气质量来自 [Open-Meteo](https://open-meteo.com/)，空气质量模型数据来自 CAMS。全球多语言地点搜索来自 [OpenStreetMap Nominatim](https://nominatim.org/)，GPS 位置名称使用 BigDataCloud 的免密钥反向地理编码；无法获取名称时仍会使用 GPS 坐标查询天气。

## 本地预览

```bash
python3 -m http.server 4173
```

浏览器打开 `http://localhost:4173`。定位在正式部署时需要 HTTPS，GitHub Pages 会自动提供。

## 部署

推送到 `main` 后，`.github/workflows/pages.yml` 会自动发布。第一次使用时，请在仓库的 **Settings → Pages** 将 Source 设为 **GitHub Actions**。
