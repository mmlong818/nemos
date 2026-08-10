/**
 * 本地修改（小丑鱼）：上游此文件通过 `./vendor/emf-converter/index.mjs`
 * 把 EMF/WMF 渲染成 PNG data URL。那是一个仅 ESM 的构建产物，与本项目的
 * CommonJS 运行方式不兼容；而小丑鱼在服务端解析文档，没有渲染用的 Canvas，
 * 上游函数在这种环境下本来就返回 null（见其原注释）。
 *
 * 因此这里保留同样的接口与降级语义，去掉 emf-converter 依赖：
 * EMF/WMF 图片的字节在保存时原样透传，只是不生成预览图。
 *
 * 需要预览 EMF/WMF 时再恢复上游实现，并同时引入其 Apache-2.0 声明。
 */
export declare function isMetafileMime(mime: string | undefined): mime is string;
export declare function metafileToDataUrl(_bytes: ArrayBuffer | Uint8Array, _mime: string): Promise<string | null>;
