# 底图配置

底图列表定义在 `src/views/config.ts` 的 `BASE_MAPS` 数组中。右上角工具栏会自动读取这个数组，在 2D／3D 按钮下方生成底图入口；点击后在左侧选择底图。

默认提供卫星影像、街道地图、无底图。数组的第一项是初始底图，调整顺序即可修改默认值。可直接增加或删除数组项，无需修改组件。每个 `id` 必须唯一。

## 添加底图

在 `BASE_MAPS` 中追加：

```ts
{
  id: 'my-map',
  name: '自定义底图',
  description: '可选的说明文字',
  options: {
    urlTemplate: 'https://your-tile-server.example/{z}/{x}/{y}.png',
    attribution: '© 地图服务提供方',
    crossOrigin: 'anonymous',
    maxAvailableZoom: 18,
  },
},
```

- `id`：底图唯一标识。
- `name`：弹窗内显示的名称。
- `description`：可选说明。
- `options`：Maptalks `TileLayer` 的配置，直接传给图层构造函数。支持 `urlTemplate`、`subdomains`、`tileSize`、`maxAvailableZoom`、`tileSystem` 等选项。
- `options: null`：不显示底图，仍保留保护区图层。

示例地址是占位符，需要替换为实际可访问的服务。当前地图使用 `EPSG:3857`；新增地图应使用与之匹配的瓦片坐标和投影，不能直接混用存在坐标偏移的瓦片。带鉴权或子域名的服务请按提供方要求配置。自定义服务需要支持浏览器跨域请求。

`attribution` 会显示在地图左下角边缘，随底图同步更新；它支持 HTML，请仅填写可信的本地配置。内置在线底图需要联网，正式使用时请确认服务方的授权、署名、访问限额等要求。

## 与保护区的关系

底图切换只替换地图的底图图层，不重建保护区，也不改变中心、缩放、二维／三维视角或已选分区的拔高状态。

保护区拔高后的顶面继续使用卫星影像，其独立数据源为同文件中的 `RASTER_SOURCE_CONFIG`，不会跟随街道底图切换。若需要更换顶面影像，可单独修改该配置。
