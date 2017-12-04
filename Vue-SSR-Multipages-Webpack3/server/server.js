/**
 * Created by kenkozheng on 2017/11/27.
 */

const fs = require('fs');
const path = require('path');
const LRU = require('lru-cache');
const express = require('express');
const server = express();
const { createBundleRenderer } = require('vue-server-renderer');
const router = require('../server/router.js');

const isProd = process.env.NODE_ENV === 'production';
const resolve = file => path.resolve(__dirname, file);
const serve = (path, cache) => express.static(resolve(path), {
    maxAge: cache && isProd ? 1000 * 60 * 60 * 24 * 30 : 0
});
const createRenderer = (bundle, options) => createBundleRenderer(bundle, Object.assign(options, {
    // for component caching
    cache: LRU({
        max: 1000,
        maxAge: 1000 * 60 * 15
    }),
    // recommended for performance
    runInNewContext: false
}));

let render;
let rendererMap = {};
const templatePath = resolve('../web/tpl.html');
let baseRender = (renderer, pageName, req, res) => {
    //context是一个对象，在模版中，使用<title>{{ title }}</title>方式填充 https://ssr.vuejs.org/zh/basic.html
    let context = {title: 'VueSSR Multipages'};
    let routeConfig = router[pageName];
    //console.log(pageName);
    require(routeConfig.server);        //todo 这里可以做一些关联的处理
    renderer.renderToString(context, (err, html) => {
        if (err) {
            console.log(err);
            res.status(500).end('Internal Server Error');
            return
        }
        res.send(html);
        res.end();
    });
};

if (isProd) {
    // In production: create server renderer using template and built server bundle.
    // The server bundle is generated by vue-ssr-webpack-plugin.
    const template = fs.readFileSync(templatePath, 'utf-8');
    for (let pageName in router) {
        const bundle = require(`../dist/${pageName}/vue-ssr-server-bundle.json`);
        // The client manifests are optional, but it allows the renderer
        // to automatically infer preload/prefetch links and directly add <script>
        // tags for any async chunks used during render, avoiding waterfall requests.
        const clientManifest = require(`../dist/${pageName}/vue-ssr-client-manifest.json`);
        rendererMap[pageName] = createRenderer(bundle, {
            template,
            clientManifest
        });
    }
    render = (pageName, req, res) => {
        baseRender(rendererMap[pageName], pageName, req, res);
    };
} else {
    // In development: setup the dev server with watch and hot-reload,
    // and create a new renderer on bundle / index template update.
    // devserver使用的是webpack-dev-middleware，过程文件存储在内存
    const devServerSetup = require('../build/setup-dev-server');
    const appEntry = require('../build/generateAppEntry');
    var promiseMap = {};
    for (let pageName in appEntry) {
        let entry = appEntry[pageName];
        promiseMap[pageName] = devServerSetup(server, templatePath, pageName, entry.clientConfig, entry.serverConfig, (pageName, bundle, options) => {
            rendererMap[pageName] = createRenderer(bundle, options);     //刷新renderer
        });
    }
    render = (pageName, req, res) => {
        promiseMap[pageName].then(() => baseRender(rendererMap[pageName], pageName, req, res));     //需要等待文件初始化
    };
}

server.use('/dist', serve('../dist'));      //静态目录
server.use('/public', serve('../web/public'));

/**
 * 不建议在server.js中写太多路由的事情，如果路由多了，建议迁移到额外一个配置表中
 */
for (let pageName in router) {
    let pageConfig = router[pageName];
    server.get(pageConfig.url, ((pageName) => {
        return (req, res) => {
            render(pageName, req, res);
        }
    })(pageName));
}

const port = 80;
server.listen(port, () => {
    console.log(`server started at localhost:${port}`)
});